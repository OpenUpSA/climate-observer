"""
Compute ETo (FAO-56 Penman-Monteith) and the Water Requirement Satisfaction
Index from FLDAS NetCDF files.

Outputs
-------
timeseries.csv       Africa-wide monthly means (one row per month)
blocks_monthly.csv   Monthly means for each 1x1 degree block in locations_rows.csv

About the WRSI value that gets stored
-------------------------------------
WRSI here is the water supply seen by a *reference* crop:

    WRSI = ETa / ETo * 100

where ETo is FAO-56 reference evapotranspiration (a hypothetical healthy grass).
Because the reference is grass, this ratio can legitimately exceed 100: it means
the water supply was more than a grass crop would have used.

It is deliberately NOT capped at 100. Capping destroys exactly the information
needed to scale the index to a real crop: dividing a capped 100 by a crop's Kc
reports "exactly enough water" for a crop that in fact had a surplus, and
invents water stress in wet months. The crop views in the Climate Observer
divide this value by the selected crop's Kc_mid and clip to [0, 100] at display
time, which is the only place the cap belongs.

A floor at 0 is applied: a small negative ratio can occur from modelled
condensation in the FLDAS evaporation field, and a negative index is meaningless.

Usage
-----
    python compute_all.py                 # uses ./FLDAS_NOAH01_C_GL_M_001
    FLDAS_DIR=/path/to/files python compute_all.py
    MAX_FILES=3 python compute_all.py     # smoke test on the first 3 files
"""

import os, re, glob, sys
import numpy as np
import pandas as pd
import xarray as xr

DATA_DIR = os.environ.get('FLDAS_DIR', 'FLDAS_NOAH01_C_GL_M_001')
LOCS_CSV = os.environ.get('LOCS_CSV', 'locations_rows.csv')
OUT_TS   = os.environ.get('OUT_TS', 'timeseries.csv')
OUT_BLOCKS = os.environ.get('OUT_BLOCKS', 'blocks_monthly.csv')
MAX_FILES = int(os.environ.get('MAX_FILES', '0'))  # 0 = all files
AFRICA_LAT = (-37, 37)
AFRICA_LON = (-20, 60)

VARS = [
    'Evap_tavg', 'LWdown_f_tavg', 'Lwnet_tavg', 'Psurf_f_tavg',
    'Qair_f_tavg', 'Qg_tavg', 'Qh_tavg', 'Qle_tavg', 'Qs_tavg',
    'Qsb_tavg', 'RadT_tavg', 'Rainf_f_tavg', 'SWE_inst',
    'SWdown_f_tavg', 'SnowCover_inst', 'SnowDepth_inst', 'Snowf_tavg',
    'Swnet_tavg', 'Tair_f_tavg', 'Wind_f_tavg',
    'SoilMoi00_10cm_tavg', 'SoilMoi10_40cm_tavg',
    'SoilMoi40_100cm_tavg', 'SoilMoi100_200cm_tavg',
    'SoilTemp00_10cm_tavg', 'SoilTemp10_40cm_tavg',
    'SoilTemp40_100cm_tavg', 'SoilTemp100_200cm_tavg',
]
ET_VARS = ['Tair_f_tavg','Qair_f_tavg','Psurf_f_tavg','Wind_f_tavg','Swnet_tavg','Lwnet_tavg']

def fao56_eto_vec(T_k, q, P_pa, wind10, swnet, lwnet):
    T = T_k - 273.15
    P = P_pa / 1000.0
    es = 0.6108 * np.exp(17.27 * T / (T + 237.3))
    ea = q * P / 0.622
    delta = 4098 * es / (T + 237.3) ** 2
    gamma = 0.000665 * P
    u2 = wind10 * 4.87 / np.log(67.8 * 10 - 5.42)
    Rn = (swnet + lwnet) * 86400 / 1e6
    et = (0.408 * delta * Rn + gamma * (900 / (T + 273)) * u2 * (es - ea)) / (delta + gamma * (1 + 0.34 * u2))
    return np.maximum(et / 86400, 0)


def wrsi_reference(et_a, et_o):
    """Water supply relative to reference-crop demand, as a percentage.

    The mean is taken over cells of the per-cell ratio (not the ratio of the cell
    means), matching the original method. Not capped at 100 -- see the module
    docstring. Returns None when nothing usable can be computed.
    """
    with np.errstate(invalid='ignore', divide='ignore'):
        ratio = np.asarray(et_a, dtype='float64') / np.asarray(et_o, dtype='float64') * 100.0
    ratio = np.where(np.isfinite(ratio), ratio, np.nan)

    if not np.any(np.isfinite(ratio)):
        return None

    with np.errstate(invalid='ignore'):
        mean = float(np.nanmean(ratio))

    return max(mean, 0.0) if np.isfinite(mean) else None


locs = pd.read_csv(LOCS_CSV)

# Drop duplicated coordinates: a duplicate would weight that block more heavily
# in any average taken across blocks.
before = len(locs)
locs = locs.drop_duplicates(subset=['latitude', 'longitude']).reset_index(drop=True)
if len(locs) != before:
    print(f"Dropped {before - len(locs)} duplicate rows from {LOCS_CSV}")

blocks = []
for _, row in locs.iterrows():
    clat, clon = float(row['latitude']), float(row['longitude'])
    blocks.append((clat, clon, clat - 0.5, clat + 0.5, clon - 0.5, clon + 0.5))
B = len(blocks)
print(f"{B} blocks to compute")

nc_files = sorted(glob.glob(os.path.join(DATA_DIR, 'FLDAS_NOAH01_C_GL_M.A*.001.nc')))
if MAX_FILES:
    nc_files = nc_files[:MAX_FILES]
if not nc_files:
    sys.exit(f"No FLDAS files found in {DATA_DIR!r} - check FLDAS_DIR / download first.")
print(f"Processing {len(nc_files)} files ...")

# Block cell indices depend only on the grid, which is identical in every file,
# so they are resolved once on the first pass and reused for every month.
block_idx = None
block_has_cells = [True] * B

ts_rows = []
block_rows = {bi: [] for bi in range(B)}

for file_idx, fp in enumerate(nc_files):
    fname = os.path.basename(fp)
    m = re.search(r'A(\d{4})(\d{2})', fname)
    if not m:
        continue
    date_str = f"{m.group(1)}-{m.group(2)}"
    if file_idx % 20 == 0:
        print(f"[{file_idx+1}/{len(nc_files)}] {date_str}")
    else:
        sys.stdout.write(f"\r{date_str}  ")
        sys.stdout.flush()

    ds = xr.open_dataset(fp, engine='netcdf4')
    ds = ds.rename({'X': 'longitude', 'Y': 'latitude'})
    ds = ds.drop_vars([v for v in ['time_bnds'] if v in ds.variables])
    africa = ds.where(
        (ds.latitude > AFRICA_LAT[0]) & (ds.latitude < AFRICA_LAT[1]) &
        (ds.longitude > AFRICA_LON[0]) & (ds.longitude < AFRICA_LON[1]),
        drop=True
    )

    lats = africa['latitude'].values
    lons = africa['longitude'].values

    # Read all variables as 2D arrays once (time dim is 1)
    arrs = {}
    for v in VARS:
        arrs[v] = africa[v].isel(time=0).values  # (nlat, nlon)

    # Africa-wide means
    ts_row = {'date': date_str}
    for v in VARS:
        ts_row[v] = float(np.nanmean(arrs[v]))
    eto_full = fao56_eto_vec(arrs['Tair_f_tavg'], arrs['Qair_f_tavg'],
                              arrs['Psurf_f_tavg'], arrs['Wind_f_tavg'],
                              arrs['Swnet_tavg'], arrs['Lwnet_tavg'])
    ts_row['ETo'] = float(np.nanmean(eto_full))
    ts_row['WRSI'] = wrsi_reference(arrs['Evap_tavg'], eto_full)
    ts_rows.append(ts_row)

    # Resolve block cell indices once (the grid is the same in every file)
    if block_idx is None:
        block_idx = []
        for bi, (clat, clon, lat_min, lat_max, lon_min, lon_max) in enumerate(blocks):
            Yi = np.where((lats >= lat_min) & (lats < lat_max))[0]
            Xi = np.where((lons >= lon_min) & (lons < lon_max))[0]
            if len(Yi) == 0 or len(Xi) == 0:
                block_has_cells[bi] = False
                block_idx.append(None)
            else:
                block_idx.append(np.meshgrid(Yi, Xi, indexing='ij'))
        empty = block_has_cells.count(False)
        if empty:
            print(f"\nWarning: {empty} block(s) fall outside the gridded area and will be written empty")

    for bi in range(B):
        clat, clon = blocks[bi][0], blocks[bi][1]
        r = {'date': date_str, 'latitude': clat, 'longitude': clon}

        if block_idx[bi] is None:
            for v in VARS:
                r[v] = None
            r['ETo'] = None
            r['WRSI'] = None
        else:
            YY, XX = block_idx[bi]
            for v in VARS:
                r[v] = float(np.nanmean(arrs[v][YY, XX]))
            eto_b = fao56_eto_vec(
                arrs['Tair_f_tavg'][YY, XX], arrs['Qair_f_tavg'][YY, XX],
                arrs['Psurf_f_tavg'][YY, XX], arrs['Wind_f_tavg'][YY, XX],
                arrs['Swnet_tavg'][YY, XX], arrs['Lwnet_tavg'][YY, XX],
            )
            r['ETo'] = float(np.nanmean(eto_b))
            r['WRSI'] = wrsi_reference(arrs['Evap_tavg'][YY, XX], eto_b)
        block_rows[bi].append(r)

    ds.close()

print()

ts_df = pd.DataFrame(ts_rows)
ts_df.to_csv(OUT_TS, index=False)
print(f"Saved {OUT_TS} — {len(ts_df)} rows, {len(ts_df.columns)} cols")

all_block_rows = []
for bi in range(B):
    all_block_rows.extend(block_rows[bi])
block_df_out = pd.DataFrame(all_block_rows)
block_df_out.to_csv(OUT_BLOCKS, index=False)
print(f"Saved {OUT_BLOCKS} — {len(block_df_out)} rows, {len(block_df_out.columns)} cols")

# Sanity report so a broken run is obvious immediately
w = block_df_out['WRSI'].dropna()
if len(w):
    print(f"\nWRSI: min {w.min():.2f}  median {w.median():.2f}  max {w.max():.2f}")
    print(f"      {100.0 * (w > 100).mean():.1f}% of values are above 100 "
          f"(surplus over the reference crop - kept on purpose)")

