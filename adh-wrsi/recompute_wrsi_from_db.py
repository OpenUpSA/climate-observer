#!/usr/bin/env python3
"""
Rebuild the `crops.WRSI` column in place from data already in the table.

Background
----------
`crops.WRSI` was stored capped at 100 by an earlier version of compute_all.py.
That destroyed the information needed to scale the index to a real crop: a capped
100 divided by a crop's Kc reports "exactly enough water" for a crop that in fact
had a surplus, and invents water stress in wet months.

The cap can be undone without re-downloading anything, because the two inputs the
index is derived from are stored in the same row, uncapped and at full precision:

    WRSI = 100 * Evap_tavg / ETo

This recomputes it, floored at 0 and NOT capped at 100.

How closely does this match what was there before?
-------------------------------------------------
Across 12 blocks spread over the whole domain, against the stored (uncapped) values:
    median difference 0.074 index points, 96% within 0.5, 99% within 1, max 3.4.

The small difference is real and deliberate: this is the ratio of block means
(total water used / total water demanded for the block), whereas compute_all.py
averaged the per-cell ratio. The ratio of means is the block water balance and
avoids the near-zero-ETo instability, which tends to produce wild per-cell ratios.
See methodology.md.

Output
------
Writes a complete replacement CSV (all columns, so nothing is lost) ready for:

    python upload_to_supabase.py --csv <file> --mode replace --commit

Usage
-----
    python recompute_wrsi_from_db.py                     # writes blocks_monthly.csv
    python recompute_wrsi_from_db.py --out rebuilt.csv
    python recompute_wrsi_from_db.py --limit-months 3    # smoke test
"""

import argparse
import csv
import json
import os
import sys
import urllib.error
import urllib.request

KEY_COLUMNS = ['date', 'latitude', 'longitude']
DEFAULT_OUT = 'blocks_monthly_rebuilt.csv'
PAGE = 1000


def load_env():
    url = os.environ.get('SUPABASE_URL')
    key = os.environ.get('SUPABASE_KEY')
    if not (url and key):
        env_path = os.environ.get('SUPABASE_ENV', os.path.join('..', '.env'))
        if os.path.exists(env_path):
            with open(env_path) as fh:
                for line in fh:
                    if '=' not in line or line.strip().startswith('#'):
                        continue
                    k, v = line.split('=', 1)
                    k, v = k.strip(), v.strip().strip('"').strip("'")
                    if k == 'SUPABASE_URL' and not url:
                        url = v
                    elif k == 'SUPABASE_KEY' and not key:
                        key = v
    if not (url and key):
        sys.exit('Missing SUPABASE_URL / SUPABASE_KEY (set them or add ../.env)')
    return url.rstrip('/'), key


def get(url, key, path, timeout=180):
    req = urllib.request.Request(
        f'{url}/rest/v1/{path}',
        headers={'apikey': key, 'Authorization': f'Bearer {key}'},
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.load(resp)
    except urllib.error.HTTPError as exc:
        sys.exit(f'Query failed: HTTP {exc.code} {exc.read().decode()[:300]}')


def count(url, key, path):
    """Exact row count for a query (uses the Content-Range header, reads no rows)."""
    req = urllib.request.Request(
        f'{url}/rest/v1/{path}',
        headers={'apikey': key, 'Authorization': f'Bearer {key}',
                 'Prefer': 'count=exact', 'Range': '0-0'},
    )
    with urllib.request.urlopen(req, timeout=120) as resp:
        return int(resp.headers.get('Content-Range', '0-0/0').split('/')[-1])


def months_between(start, end):
    """Every YYYY-MM from start to end inclusive."""
    y, m = int(start[:4]), int(start[5:])
    ey, em = int(end[:4]), int(end[5:])
    out = []
    while (y, m) <= (ey, em):
        out.append(f'{y}-{m:02d}')
        m += 1
        if m == 13:
            y, m = y + 1, 1
    return out


def rebuild(evap, eto):
    """WRSI from the stored block means. Floored at 0, deliberately uncapped.

    Returns None when ETo is missing or zero, so the row keeps a NULL rather than
    a misleading 0.
    """
    if evap is None or eto is None:
        return None
    try:
        evap = float(evap)
        eto = float(eto)
    except (TypeError, ValueError):
        return None
    if not eto or eto <= 0:
        return None
    if not (evap == evap and eto == eto):  # NaN guard
        return None
    return max(evap / eto * 100.0, 0.0)


def fmt(value):
    """Format a float for CSV without losing precision."""
    if value is None:
        return ''
    return repr(float(value))


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--out', default=DEFAULT_OUT, help=f'output CSV (default {DEFAULT_OUT})')
    ap.add_argument('--limit-months', type=int, default=0, help='only process the first N months')
    ap.add_argument('--table', default='crops')
    args = ap.parse_args()

    url, key = load_env()
    table = args.table

    print('Reading column list ...')
    first = get(url, key, f'{table}?select=*&limit=1')
    if not first:
        sys.exit(f'{table} is empty')
    columns = [c for c in first[0].keys()]
    for required in KEY_COLUMNS + ['WRSI', 'ETo', 'Evap_tavg']:
        if required not in columns:
            sys.exit(f'{table} has no {required!r} column')
    print(f'  {len(columns)} columns: {", ".join(columns[:6])} ...')

    # PostgREST caps any single response (1000 rows by default), so a
    # `select=date&limit=100000` would silently return only the first page.
    # Take the endpoints and generate the sequence instead.
    print('Listing months ...')
    firsts = get(url, key, f'{table}?select=date&order=date&limit=1')
    lasts = get(url, key, f'{table}?select=date&order=date.desc&limit=1')
    if not (firsts and lasts):
        sys.exit(f'{table} is empty')
    months = months_between(firsts[0]['date'], lasts[0]['date'])
    if args.limit_months:
        months = months[:args.limit_months]
    print(f'  {len(months)} months ({months[0]} -> {months[-1]})')

    total_expected = count(url, key, f'{table}?select=date')
    print(f'  {total_expected} rows in {table}\n')

    written = 0
    changed = 0
    nulled = 0
    capped_before = 0
    recovered = []
    per_month = {}

    with open(args.out, 'w', newline='') as fh:
        writer = csv.DictWriter(fh, fieldnames=columns)
        writer.writeheader()

        for i, month in enumerate(months, 1):
            rows = []
            offset = 0
            while True:
                page = get(url, key,
                           f'{table}?select=*&date=eq.{month}'
                           f'&order=latitude,longitude&limit={PAGE}&offset={offset}')
                rows.extend(page)
                if len(page) < PAGE:
                    break
                offset += PAGE

            per_month[month] = len(rows)

            for r in rows:
                new = rebuild(r.get('Evap_tavg'), r.get('ETo'))
                old = r.get('WRSI')

                if old == 100:
                    capped_before += 1
                    if new is not None and new > 100:
                        recovered.append(new)

                if new is None:
                    nulled += 1
                elif old is None or abs(new - float(old)) > 1e-9:
                    changed += 1

                r['WRSI'] = new
                writer.writerow({c: (fmt(r.get(c)) if c != 'date' else r.get(c))
                                 for c in columns})
            written += len(rows)

            pct = 100.0 * written / total_expected
            sys.stdout.write(f'\r  {i}/{len(months)} months  '
                             f'{written}/{total_expected} rows ({pct:5.1f}%)  ')
            sys.stdout.flush()

    print(f'\n\nWrote {args.out}')
    print(f'  rows written       : {written}')
    print(f'  WRSI values changed: {changed}')
    print(f'  set to NULL        : {nulled}')

    if capped_before:
        recovered.sort()
        print(f'\n  Previously flattened at exactly 100: {capped_before}'
              f' ({100.0 * capped_before / written:.1f}%)')
        if recovered:
            n = len(recovered)
            print(f'    of those, now above 100 : {n}')
            print(f'    recovered values        : median {recovered[n // 2]:.1f},'
                  f' max {recovered[-1]:.1f}')

    # Report months whose row count differs from the norm rather than failing:
    # the table already has a few short months and they are uploaded as-is.
    implied = max(per_month.values())
    uneven = {m: c for m, c in per_month.items() if c != implied}
    if uneven:
        print(f'\n  Note: {len(uneven)} month(s) do not have the full {implied} blocks'
              f' (pre-existing gaps, uploaded as found):')
        shown = sorted(uneven.items())
        for m, c in shown[:5]:
            print(f'    {m}: {c} rows')
        if len(shown) > 5:
            print(f'    ... and {len(shown) - 5} more ({shown[5][0]} onward)')

    if written != total_expected and not args.limit_months:
        print(f'\nWARNING: wrote {written} rows but the table holds {total_expected}.')
        print('Investigate before uploading.')
    elif args.limit_months:
        print(f'\n(partial run: {len(months)} of all months. Drop --limit-months for '
              f'the full {total_expected} rows.)')

    print(f'\nNext: dry-run then upload\n'
          f'  python upload_to_supabase.py --csv {args.out} --mode replace --dry-run\n'
          f'  python upload_to_supabase.py --csv {args.out} --mode replace --commit')


if __name__ == '__main__':
    main()
