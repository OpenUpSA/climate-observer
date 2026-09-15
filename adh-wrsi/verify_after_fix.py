#!/usr/bin/env python3
"""
Verify the crops.WRSI values after the SQL fix has been applied.

Run before and after applying:

    UPDATE crops SET "WRSI" = 100.0 * "Evap_tavg" / "ETo"
    WHERE "ETo" > 0 AND "Evap_tavg" IS NOT NULL;

Before: many values sit at exactly 100.
After:  nothing is at 100 unless the water balance genuinely equals it, and
        values above 100 appear.

Usage:  ./venv/bin/python verify_after_fix.py
"""

import json
import os
import sys
import urllib.request

env = {}
env_path = os.path.join(os.path.dirname(__file__), '..', '.env')
for line in open(env_path):
    if '=' in line:
        k, v = line.split('=', 1)
        env[k.strip()] = v.strip().strip('"').strip("'")
url, key = env['SUPABASE_URL'].rstrip('/'), env['SUPABASE_KEY']


def count(path):
    req = urllib.request.Request(
        f'{url}/rest/v1/{path}',
        headers={'apikey': key, 'Authorization': f'Bearer {key}',
                 'Prefer': 'count=exact', 'Range': '0-0'},
    )
    with urllib.request.urlopen(req, timeout=120) as resp:
        return int(resp.headers.get('Content-Range', '0-0/0').split('/')[-1])


def get(path):
    req = urllib.request.Request(
        f'{url}/rest/v1/{path}',
        headers={'apikey': key, 'Authorization': f'Bearer {key}'},
    )
    return json.load(urllib.request.urlopen(req, timeout=120))


print('Checking crops.WRSI ...\n')

total = count('crops?select=date')
at_100 = count('crops?select=date&WRSI=eq.100')
over_100 = count('crops?select=date&WRSI=gt.100')
nulls = count('crops?select=date&WRSI=is.null')
negatives = count('crops?select=date&WRSI=lt.0')

print(f'  total rows          : {total}')
print(f'  WRSI exactly 100    : {at_100}  ({100.0 * at_100 / total:.1f}%)')
print(f'  WRSI above 100      : {over_100}')
print(f'  WRSI NULL           : {nulls}')
print(f'  WRSI negative       : {negatives}' + ('' if negatives == 0 else '   <-- needs the floor'))

# Highest values, to show the recovered surplus
top = get('crops?select=date,latitude,longitude,WRSI&order=WRSI.desc&limit=5')
print('\n  highest values now:')
for r in top:
    print(f'    {r["date"]}  ({r["latitude"]}, {r["longitude"]})  WRSI {r["WRSI"]:.1f}')

# The reference row used throughout testing
ref = get('crops?select=date,WRSI&latitude=eq.-13.5&longitude=eq.33.5'
          '&date=in.(1993-01,1993-06,1993-07)&order=date')
print('\n  Lilongwe (-13.5, 33.5):')
for r in ref:
    print(f'    {r["date"]}  {r["WRSI"]:.1f}')

print()
if negatives:
    print(f'  -> {negatives} negative values present. The pipeline floors these at 0')
    print('     (a negative index is meaningless). Run:')
    print('       UPDATE crops SET "WRSI" = 0 WHERE "WRSI" < 0;')
    sys.exit(1)

if at_100 > total * 0.1 or over_100 == 0:
    print('  -> NOT applied yet (or reverted): values are still largely capped at 100.')
    print('     Expected after the fix: far fewer values at exactly 100, and many above it.')
    sys.exit(1)

print('  -> Fix looks applied: the clip at 100 is gone and real surpluses are visible.')
