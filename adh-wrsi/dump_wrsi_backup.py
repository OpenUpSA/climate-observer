#!/usr/bin/env python3
"""One-off: dump the CURRENT crops.WRSI values so the upload can be rolled back."""
import csv
import gzip
import json
import os
import sys
import urllib.request

env = {}
for line in open('../.env'):
    if '=' in line:
        k, v = line.split('=', 1)
        env[k.strip()] = v.strip().strip('"').strip("'")
url, key = env['SUPABASE_URL'].rstrip('/'), env['SUPABASE_KEY']

def get(path):
    req = urllib.request.Request(url + '/rest/v1/' + path,
                                 headers={'apikey': key, 'Authorization': 'Bearer ' + key})
    return json.load(urllib.request.urlopen(req, timeout=180))

months = [r['date'] for r in get('crops?select=date&order=date&limit=1')]
first = get('crops?select=date&order=date&limit=1')[0]['date']
last = get('crops?select=date&order=date.desc&limit=1')[0]['date']

y, m = int(first[:4]), int(first[5:])
ey, em = int(last[:4]), int(last[5:])
seq = []
while (y, m) <= (ey, em):
    seq.append(f'{y}-{m:02d}')
    m += 1
    if m == 13:
        y, m = y + 1, 1

out = 'backup_wrsi_before.csv.gz'
n = 0
with gzip.open(out, 'wt', newline='') as fh:
    w = csv.writer(fh)
    w.writerow(['date', 'latitude', 'longitude', 'WRSI'])
    for month in seq:
        off = 0
        while True:
            rows = get(f'crops?select=date,latitude,longitude,WRSI&date=eq.{month}'
                       f'&order=latitude,longitude&limit=1000&offset={off}')
            for r in rows:
                w.writerow([r['date'], r['latitude'], r['longitude'],
                            '' if r['WRSI'] is None else repr(r['WRSI'])])
            n += len(rows)
            if len(rows) < 1000:
                break
            off += 1000
        sys.stdout.write(f'\r{n} rows backed up ({month})   ')
        sys.stdout.flush()

size = os.path.getsize(out)
print(f'\nDone: {n} rows -> {out} ({size/1048576:.1f} MB)')
