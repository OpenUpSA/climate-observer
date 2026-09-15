# ETo & WRSI — Methodology

## Reference Evapotranspiration (ETo) — FAO-56 Penman-Monteith

ETo is computed per grid cell using the FAO-56 Penman-Monteith equation
(Allen et al., 1998):

```
ET₀ = [0.408 · Δ · (Rₙ − G) + γ · (900 / (T + 273)) · u₂ · (eₛ − eₐ)]
      / [Δ + γ · (1 + 0.34 · u₂)]
```

### Input variables from FLDAS NetCDF

Each monthly NetCDF file (`FLDAS_NOAH01_C_GL_M.A{YYYYMM}.001.nc`) contains
a single timestep with the following variables used in the calculation:

| Symbol | NetCDF variable       | Units        | Description                     |
|--------|-----------------------|--------------|----------------------------------|
| T      | `Tair_f_tavg`         | K            | Air temperature at 2 m           |
| P      | `Psurf_f_tavg`        | Pa           | Surface pressure                 |
| q      | `Qair_f_tavg`         | kg kg⁻¹      | Specific humidity                |
| u₁₀    | `Wind_f_tavg`         | m s⁻¹        | Wind speed at 10 m               |
| Sₙ     | `Swnet_tavg`          | W m⁻²        | Net downward shortwave radiation  |
| Lₙ     | `Lwnet_tavg`          | W m⁻²        | Net downward longwave radiation   |

### Derived quantities

**Saturation vapour pressure** (kPa):

```
eₛ = 0.6108 · exp(17.27 · T / (T + 237.3))
```

where T is in °C (converted from `Tair_f_tavg` by subtracting 273.15).

**Actual vapour pressure** (kPa):

```
eₐ = q · P / 0.622
```

where q is in kg kg⁻¹ and P is in kPa (`Psurf_f_tavg` / 1000).

**Slope of the saturation vapour pressure curve** (kPa °C⁻¹):

```
Δ = 4098 · eₛ / (T + 237.3)²
```

**Psychrometric constant** (kPa °C⁻¹):

```
γ = 0.665 × 10⁻³ · P
```

where P is in kPa.

**Wind speed at 2 m height** (m s⁻¹):

```
u₂ = u₁₀ × 4.87 / ln(67.8 × 10 − 5.42)
```

This converts the 10 m wind from `Wind_f_tavg` to the standard 2 m
reference height using the log-wind profile for a short-grass surface.

**Net radiation** (MJ m⁻² day⁻¹):

```
Rₙ = (Sₙ + Lₙ) × 86 400 / 10⁶
```

Converts W m⁻² to MJ m⁻² day⁻¹.

**Soil heat flux**:

```
G ≈ 0
```

Neglected for monthly time steps.

### Final conversion

The equation yields ETo in mm day⁻¹. This is converted to the same units
as `Evap_tavg` (kg m⁻² s⁻¹) by dividing by 86 400 (1 mm day⁻¹ ≈
1.157 × 10⁻⁵ kg m⁻² s⁻¹). Values are floored at zero (no negative ETo).

### Spatial aggregation

At the Africa-wide level (`timeseries.csv`), ETo is computed per grid cell
and then averaged over all cells in the Africa bounding box
(lat ∈ (−37, 37), lon ∈ (−20, 60)). The same per-cell-then-average
approach is used for each 1-degree block (`blocks_monthly.csv`).

---

## Water Requirement Satisfaction Index (WRSI)

```
WRSI = ETₐ / ET₀ × 100
```

| Symbol | Source                             | Description                         |
|--------|------------------------------------|-------------------------------------|
| ETₐ    | `Evap_tavg` from FLDAS NetCDF      | Actual evapotranspiration           |
| ET₀    | FAO-56 Penman-Monteith (above)     | Reference evapotranspiration         |

Both ETₐ and ET₀ are computed per grid cell. WRSI is then computed per
cell and spatially averaged (not the ratio of spatial means).

The result is floored at 0 but **deliberately not capped at 100**. WRSI
is expressed relative to a reference crop (ETo is defined for a
hypothetical healthy grass), so a value above 100 carries real
information: the water supply exceeded what a grass crop would have
used. Capping it would destroy the information needed to scale the index
to a crop, because a capped 100 divided by a crop's coefficient reports
"exactly enough water" for a crop that in fact had a surplus, and would
invent water stress in wet months.

It is therefore stored for the reference crop, and the Climate Observer
turns it into a crop-specific figure with the crop's mid-season
coefficient from FAO-56 (Kc_mid):

```
WRSI_crop = clip(WRSI / Kc_mid, 0, 100)
```

A crop that needs more water has a higher Kc_mid and so a lower index in
the same conditions. The cap belongs at this display step, not in the
stored value. The coefficients offered in the interface are listed in
`src/CropYield.js`.

---

## Reference

Allen, R.G., Pereira, L.S., Raes, D. & Smith, M. (1998). *Crop
evapotranspiration — Guidelines for computing crop water requirements.*
FAO Irrigation and Drainage Paper 56. Food and Agriculture Organization
of the United Nations, Rome. ISBN 92-5-104219-5.
