#!/usr/bin/env python3
"""
Upload a compute_all.py CSV into the Supabase `crops` table.

Reads credentials from the environment or from climate-observer/.env
(SUPABASE_URL, SUPABASE_KEY). Nothing is written unless --commit is passed.

Modes
-----
merge    (preferred) Upsert on (date, latitude, longitude). Sends only the
         columns you ask for -- by default just `date, latitude, longitude,
         WRSI`, which is all a recompute of the index changes, so the upload is
         roughly 8x smaller than a full replace. Idempotent: re-running is safe.
         Requires a unique constraint on those three columns:

             ALTER TABLE crops
               ADD CONSTRAINT crops_block_date_key UNIQUE (date, latitude, longitude);

replace  Delete the rows covered by the CSV, then insert the full CSV. Works
         without any schema change, but is not atomic, so an interrupted run can
         leave the table partly empty. Use only when you cannot add the
         constraint.

Usage
-----
    python upload_to_supabase.py --dry-run                     # validate only
    python upload_to_supabase.py --commit --mode merge         # WRSI only
    python upload_to_supabase.py --commit --mode merge --columns all
    python upload_to_supabase.py --commit --mode replace
"""

import argparse
import csv
import json
import os
import sys
import time
import urllib.error
import urllib.request

DEFAULT_CSV = 'blocks_monthly.csv'
DEFAULT_TABLE = 'crops'
KEY_COLUMNS = ['date', 'latitude', 'longitude']
BATCH_SIZE = 1000


def load_env():
    """Credential lookup: process environment first, then climate-observer/.env."""
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
        sys.exit("Missing SUPABASE_URL / SUPABASE_KEY (set them or add ../.env)")
    return url.rstrip('/'), key


def read_csv(path):
    with open(path, newline='') as fh:
        reader = csv.DictReader(fh)
        columns = list(reader.fieldnames or [])
        rows = list(reader)
    missing = [c for c in KEY_COLUMNS if c not in columns]
    if missing:
        sys.exit(f"{path} is missing key column(s): {missing}")
    return columns, rows


def clean(value):
    """CSV empty string -> NULL; keep numbers as numbers."""
    if value is None or value == '':
        return None
    try:
        return float(value)
    except ValueError:
        return value


def as_record(row, columns):
    rec = {}
    for col in columns:
        v = clean(row.get(col))
        if col in KEY_COLUMNS:
            rec[col] = v if col == 'date' else float(v)
        elif v is not None:
            rec[col] = v
        else:
            rec[col] = None
    return rec


def request(url, key, method, path, body=None, extra_headers=None, timeout=180):
    data = json.dumps(body).encode() if body is not None else None
    headers = {
        'apikey': key,
        'Authorization': f'Bearer {key}',
        'Content-Type': 'application/json',
    }
    headers.update(extra_headers or {})
    req = urllib.request.Request(f'{url}/rest/v1/{path}', data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            payload = resp.read().decode()
            return resp.status, payload
    except urllib.error.HTTPError as exc:
        return exc.code, exc.read().decode()


def batched(seq, size):
    for i in range(0, len(seq), size):
        yield seq[i:i + size]


def request_count(url, key, path, timeout=120):
    """Exact row count for a query, via the Content-Range header (reads no rows)."""
    req = urllib.request.Request(
        f'{url}/rest/v1/{path}',
        headers={'apikey': key, 'Authorization': f'Bearer {key}',
                 'Prefer': 'count=exact', 'Range': '0-0'},
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return int(resp.headers.get('Content-Range', '0-0/0').split('/')[-1])


SENTINEL_DATE = '1900-01'


def preflight_write(url, key, table, sample_row):
    """Prove the key can INSERT and DELETE before anything destructive happens.

    Row-level security blocks writes *silently* for DELETE (HTTP 200, zero rows
    affected) and loudly for POST, so a mode that deletes before inserting can
    empty a month and then be unable to put it back. This writes and removes a
    single throwaway row first, so a read-only key is caught up front.

    Returns None if writes work, otherwise a message explaining why they do not.
    """
    probe = dict(sample_row)
    probe['date'] = SENTINEL_DATE
    probe['latitude'] = 99.0
    probe['longitude'] = 99.0

    try:
        status, body = request(url, key, 'POST', table, body=[probe],
                               extra_headers={'Prefer': 'return=minimal'})
    except Exception as exc:                       # network / unexpected
        return f'insert probe failed: {exc}'

    if status not in (200, 201, 204):
        if 'row-level security' in body or '42501' in body:
            return ('this key cannot INSERT (row-level security blocked it).\n'
                    'Writes need the service_role key, or run the change in the '
                    'Supabase SQL editor instead.')
        return f'insert probe failed: HTTP {status} {body[:300]}'

    # Clean up the probe; if this cannot be removed the table would be polluted.
    status, body = request(url, key, 'DELETE', f'{table}?date=eq.{SENTINEL_DATE}',
                           extra_headers={'Prefer': 'return=minimal'})
    if status not in (200, 204):
        return f'insert worked but cleanup DELETE failed: HTTP {status} {body[:200]}'

    left = request_count(url, key, f'{table}?select=date&date=eq.{SENTINEL_DATE}')
    if left:
        return (f'insert worked but the probe row could not be removed '
                f'({left} left). This key can INSERT but not DELETE, so replace '
                f'mode would leave duplicates.')
    return None


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--csv', default=DEFAULT_CSV, help=f'input CSV (default {DEFAULT_CSV})')
    ap.add_argument('--table', default=DEFAULT_TABLE, help=f'target table (default {DEFAULT_TABLE})')
    ap.add_argument('--mode', choices=['merge', 'replace'], default='merge')
    ap.add_argument('--columns', default='wrsi',
                    help="'wrsi' (default) or 'all' -- which columns to send in merge mode")
    ap.add_argument('--batch-size', type=int, default=BATCH_SIZE)
    ap.add_argument('--commit', action='store_true', help='actually write (otherwise dry run)')
    ap.add_argument('--dry-run', action='store_true', help='validate and stop (the default)')
    args = ap.parse_args()

    if args.commit and args.dry_run:
        sys.exit('Choose either --commit or --dry-run, not both.')

    url, key = load_env()
    columns, rows = read_csv(args.csv)

    # Validate before touching anything
    key_set, dupes = set(), 0
    for r in rows:
        k = (r['date'], r['latitude'], r['longitude'])
        if k in key_set:
            dupes += 1
        key_set.add(k)

    wrsi_missing = sum(1 for r in rows if clean(r.get('WRSI')) is None)
    dates = sorted({r['date'] for r in rows})
    print(f'{args.csv}: {len(rows)} rows, {len(columns)} columns')
    print(f'  distinct blocks : {len({(r["latitude"], r["longitude"]) for r in rows})}')
    print(f'  dates           : {dates[0]} -> {dates[-1]} ({len(dates)} months)')
    print(f'  duplicate keys  : {dupes}')
    print(f'  rows with no WRSI: {wrsi_missing}')

    if dupes:
        print('\nRefusing to upload: duplicate (date, latitude, longitude) rows would')
        print('either violate the unique constraint or create duplicates.')
        sys.exit(1)

    if args.mode == 'merge':
        send_columns = KEY_COLUMNS + (['WRSI'] if args.columns == 'wrsi' else
                                      [c for c in columns if c not in KEY_COLUMNS])
    else:
        send_columns = columns

    payload_rows = [as_record(r, send_columns) for r in rows]
    print(f'  sending columns : {len(send_columns)} ({", ".join(send_columns[:4])}...)' if len(send_columns) > 4
          else f'  sending columns : {", ".join(send_columns)}')

    if not args.commit:
        sample = payload_rows[0]
        print('\nDRY RUN -- nothing written. First row that would be sent:')
        print('  ' + json.dumps(sample)[:300])
        print(f'\nRe-run with --commit to upload {len(payload_rows)} rows.')
        return

    started = time.time()
    written = 0

    # Prove we can write BEFORE any delete: RLS blocks DELETE silently, so a
    # read-only key would otherwise wipe a month and fail to restore it.
    print('\nChecking write access ...')
    problem = preflight_write(url, key, args.table, payload_rows[0])
    if problem:
        print(f'  BLOCKED: {problem}')
        sys.exit('\nAborted before changing anything. The table is untouched.')
    print('  writes OK')

    if args.mode == 'merge':
        extra = {'Prefer': 'resolution=merge-duplicates,return=minimal'}
        query = f'{args.table}?on_conflict={",".join(KEY_COLUMNS)}'

        for batch in batched(payload_rows, args.batch_size):
            status, body = request(url, key, 'POST', query, body=batch, extra_headers=extra)
            if status not in (200, 201, 204):
                hint = ''
                if 'no unique or exclusion constraint' in body:
                    hint = ('\nHint: merge mode needs:\n'
                            '  ALTER TABLE crops ADD CONSTRAINT crops_block_date_key'
                            ' UNIQUE (date, latitude, longitude);')
                sys.exit(f'Insert failed: HTTP {status} {body[:400]}{hint}')
            written += len(batch)
            pct = 100.0 * written / len(payload_rows)
            sys.stdout.write(f'\r  uploaded {written}/{len(payload_rows)} ({pct:5.1f}%)')
            sys.stdout.flush()

    else:
        # Replace, one month at a time: delete that month, put it straight back,
        # then confirm the count. Doing all the deletes up front would leave the
        # whole table empty if the upload failed partway through; this way the
        # worst case is a single month.
        extra = {'Prefer': 'return=minimal'}
        by_month = {}
        for r in payload_rows:
            by_month.setdefault(r['date'], []).append(r)

        for i, d in enumerate(dates, 1):
            rows = by_month.get(d, [])
            expected = len(rows)

            status, body = request(url, key, 'DELETE', f'{args.table}?date=eq.{d}',
                                   extra_headers={'Prefer': 'return=minimal'})
            if status not in (200, 204):
                sys.exit(f'\nDelete failed for {d}: HTTP {status} {body[:300]}')

            for batch in batched(rows, args.batch_size):
                status, body = request(url, key, 'POST', args.table, body=batch,
                                       extra_headers=extra)
                if status not in (200, 201, 204):
                    sys.exit(f'\nInsert failed for {d}: HTTP {status} {body[:400]}\n'
                             f'This month is now EMPTY. Restore it before continuing, e.g.\n'
                             f'  python upload_to_supabase.py --csv {args.csv} '
                             f'--mode replace --commit')
                written += len(batch)

            # Verify before moving on: a truncated month is a silent data loss.
            got = request_count(url, key, f'{args.table}?select=date&date=eq.{d}')
            if got != expected:
                sys.exit(f'\n{d}: uploaded {expected} rows but the table now has {got}. '
                         f'Stopping so the remaining months are left untouched.')

            sys.stdout.write(f'\r  {i}/{len(dates)} months  {written}/{len(payload_rows)} rows')
            sys.stdout.flush()

    print(f'\nDone: {written} rows to {args.table} in {time.time() - started:.0f}s')


if __name__ == '__main__':
    main()
