#!/usr/bin/env python3
"""
Build synthetic FLDAS-shaped NetCDF files and a locations CSV so compute_all.py
can be validated end to end without the (30 GB) real download.

The synthetic fields are deliberately uniform inside each 1x1 degree block, so
the expected WRSI can be derived analytically and compared with the output.

Run:  ./.venv/bin/python make_test_data.py
"""
import os, shutil
import numpy as np
import netCDF4 as nc

OUT = '/tmp/wrsi-test'
FLDAS_DIR = os.path.join(OUT, 'FLDAS_NOAH01_C_GL_M_001')
shutil.rmtree(OUT, ignore_errors=True)
os.makedirs(FLDAS_DIR, exist_ok=True)

RES = 0.5                      # coarse stand-in for the real 0.1 degree grid
LONS = np.arange(-20.0, 60.0, RES)
LATS = np.arange(-37.0, 37.0, RES)

# Synthetic "truth": pick weather inputs, then set Evap so the ETa/ETo ratio is
# a chosen number per longitude band. Some bands exceed 100 on purpose.
WEATHER = dict(Tair=300.0, Qair=0.012, Psurf=90000.0, Wind=3.0, Swnet=200.0, Lwnet=-60.0)

# target ETa/ETo ratio (percent) as a function of longitude band
def target_ratio(lon):
    if lon < 0:
        return 35.0
    if lon < 20:
        return 88.0
    if lon < 40:
        return 100.0
    return 165.0            # wet: more water than a reference grass crop needs


def fao56_eto(T_k, q, P_pa, wind10, swnet, lwnet):
    """Same equation as compute_all.py, scalar form."""
    T = T_k - 273.15
    P = P_pa / 1000.0
    es = 0.6108 * np.exp(17.27 * T / (T + 237.3))
    ea = q * P / 0.622
    delta = 4098 * es / (T + 237.3) ** 2
    gamma = 0.000665 * P
    u2 = wind10 * 4.87 / np.log(67.8 * 10 - 5.42)
    Rn = (swnet + lwnet) * 86400 / 1e6
    et = (0.408 * delta * Rn + gamma * (900 / (T + 273)) * u2 * (es - ea)) / (delta + gamma * (1 + 0.34 * u2))
    return max(et / 86400, 0)


ETO = fao56_eto(
    T_k=WEATHER['Tair'], q=WEATHER['Qair'], P_pa=WEATHER['Psurf'],
    wind10=WEATHER['Wind'], swnet=WEATHER['Swnet'], lwnet=WEATHER['Lwnet'],
)
print(f'uniform ETo = {ETO:.10f} kg m-2 s-1')

MONTHS = ['1993-01', '1993-02', '1993-03']

for month in MONTHS:
    path = os.path.join(FLDAS_DIR, f'FLDAS_NOAH01_C_GL_M.A{month.replace("-", "")}.001.nc')
    with nc.Dataset(path, 'w') as ds:
        ds.createDimension('time', 1)
        ds.createDimension('Y', len(LATS))
        ds.createDimension('X', len(LONS))

        v_time = ds.createVariable('time', 'f8', ('time',))
        v_time[:] = [0]
        v_y = ds.createVariable('Y', 'f4', ('Y',))
        v_y[:] = LATS
        v_x = ds.createVariable('X', 'f4', ('X',))
        v_x[:] = LONS

        ratio2d = np.array([[target_ratio(lo) for lo in LONS] for _ in LATS])  # (Y, X)

        # every variable named in compute_all.VARS
        names = [
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
        for n in names:
            v = ds.createVariable(n, 'f4', ('time', 'Y', 'X'))
            base = {
                'Tair_f_tavg': WEATHER['Tair'], 'Qair_f_tavg': WEATHER['Qair'],
                'Psurf_f_tavg': WEATHER['Psurf'], 'Wind_f_tavg': WEATHER['Wind'],
                'Swnet_tavg': WEATHER['Swnet'], 'Lwnet_tavg': WEATHER['Lwnet'],
            }.get(n)
            if base is not None:
                v[0] = np.full(ratio2d.shape, base, dtype='f4')
            elif n == 'Evap_tavg':
                v[0] = (ETO * ratio2d / 100.0).astype('f4')
            else:
                v[0] = np.full(ratio2d.shape, 1.0, dtype='f4')

# locations: 4 real blocks (one per band), 1 duplicate, 1 outside the grid
rows = [
    (-34.5, -10.5),   # band < 0    -> 35
    (-34.5, 10.5),    # 0..20       -> 88
    (-34.5, 30.5),    # 20..40      -> 100
    (-34.5, 50.5),    # >= 40       -> 165  (expect > 100, previously capped)
    (-34.5, -10.5),   # duplicate  -> dropped
    (55.0, 100.0),    # outside the gridded area -> empty
]
with open(os.path.join(OUT, 'locations_rows.csv'), 'w') as f:
    f.write('latitude,longitude\n')
    for la, lo in rows:
        f.write(f'{la},{lo}\n')

print(f'wrote {len(MONTHS)} synthetic months to {FLDAS_DIR}')
print('expected ratios by band: <-0: 35, 0-20: 88, 20-40: 100, >40: 165')
