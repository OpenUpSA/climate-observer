# WRSI pipeline (FLDAS → Supabase → Climate Observer)

Produces the `crops` table that the Crops section of the Climate Observer reads.

## Files

| File | Purpose |
|------|---------|
| `download.py` | Downloads FLDAS monthly NetCDF files from NASA (CMR / Earthdata) |
| `compute_all.py` | Calculates ETo and the reference-crop WRSI per 1° block → CSV |
| `upload_to_supabase.py` | Loads a CSV into the Supabase `crops` table |
| `recompute_wrsi_from_db.py` | Rebuilds `WRSI` from `Evap_tavg`/`ETo` already in the table (no download) |
| `dump_wrsi_backup.py` | Dumps current `WRSI` values as a rollback point |
| `verify_after_fix.py` | Before/after check that the 100-cap is gone |
| `locations_rows.csv` | **Input**: the 1° grid blocks to compute (`latitude,longitude`) |
| `make_test_data.py` | Builds small synthetic FLDAS files so `compute_all.py` can be tested without the real data |
| `methodology.md` | How ETo and WRSI are calculated |
| `explanation_simple.md` | Plain-language explanation of the method |

Generated (not committed): `FLDAS_NOAH01_C_GL_M_001/`, `timeseries.csv`, `blocks_monthly.csv`,
`blocks_monthly_rebuilt.csv`, `backup_wrsi_before.csv.gz`, `*.log`.

## Fixing an already-loaded table (no download needed)

If `WRSI` was stored by an older `compute_all.py` that capped it at 100, it can be
rebuilt in place — `Evap_tavg` and `ETo` are in the same row, uncapped:

```sql
UPDATE crops SET "WRSI" = 100.0 * "Evap_tavg" / "ETo"
WHERE "ETo" > 0 AND "Evap_tavg" IS NOT NULL;

-- floor at 0: a few hundred rows have negative Evap_tavg (modelled
-- condensation), which divide to a small negative index
UPDATE crops SET "WRSI" = 0 WHERE "WRSI" < 0;
```

The second statement matters: `compute_all.py` floors the index at 0, so without it
the stored values disagree with the documented method. The charts floor at 0 as
well, so the app looks the same either way — but the data should match the method.

This is atomic and needs no upload. Run it in the Supabase SQL editor, then:

```bash
./.venv/bin/python verify_after_fix.py
```

To prepare the change as a CSV instead (`recompute_wrsi_from_db.py`), and to take a
rollback point first (`dump_wrsi_backup.py`), see the scripts above. Note that
`upload_to_supabase.py` cannot write with the anon key — see below.

## Write access

The key in `../.env` is the **anon** role, and row-level security blocks writes
from it. The failure modes are asymmetric and worth knowing:

- `POST` fails loudly: `401 / 42501 new row violates row-level security policy`.
- `DELETE` fails **silently**: HTTP 200, zero rows removed, no error.

Because of that, `upload_to_supabase.py` runs a `preflight_write()` — it inserts
and removes a throwaway row — and aborts before any delete if writes are blocked.
Do not remove that check. Uploading needs a `service_role` key or the SQL editor.


## Setup

```bash
python3 -m venv .venv
./.venv/bin/pip install numpy pandas xarray netCDF4 tqdm requests earthaccess
```

Credentials for the download come from `~/.netrc` (preferred):

```
machine urs.earthdata.nasa.gov login <user> password <pass>
```

```bash
chmod 600 ~/.netrc
```

Alternatively set `EARTHDATA_USERNAME` and `EARTHDATA_PASSWORD`.

## Running

```bash
# 1. See what would be downloaded (~400 files, ~40 GiB) - no login, no files
./.venv/bin/python download.py --list-only

# 2. Download (skips files already present, so it is safe to re-run)
./.venv/bin/python download.py

# 3. Compute. MAX_FILES=N smoke-tests the first N months first
MAX_FILES=3 ./.venv/bin/python compute_all.py
./.venv/bin/python compute_all.py

# 4. Upload - always dry-run first
./.venv/bin/python upload_to_supabase.py --dry-run
./.venv/bin/python upload_to_supabase.py --commit --mode merge
```

`compute_all.py` reads `FLDAS_DIR`, `LOCS_CSV`, `OUT_TS`, `OUT_BLOCKS` and
`MAX_FILES` from the environment if you need to point it elsewhere.

## About the stored WRSI

`crops.WRSI` is the water supply relative to a **reference crop** (grass), as a
percentage. It is floored at 0 but **not capped at 100** — a value above 100 means
there was more water than a grass crop would use. The app divides this value by
the selected crop's Kc_mid and clips to [0, 100] at display time, which is what
makes the crop selector in the charts meaningful. See `methodology.md`.

## Upload modes

- **merge** (default) — upserts on `(date, latitude, longitude)` and sends only
  `WRSI` by default, so a recompute uploads ~8× less data and is safe to re-run.
  Requires a one-off constraint:
  ```sql
  ALTER TABLE crops
    ADD CONSTRAINT crops_block_date_key UNIQUE (date, latitude, longitude);
  ```
- **replace** — deletes the months in the CSV, then inserts every column. No
  schema change needed, but not atomic, so an interrupted run can leave the table
  partly empty.
