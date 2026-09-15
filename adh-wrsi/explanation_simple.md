# What This Calculation Does — In Plain English

This file explains, as simply as possible, what the script in `compute_all.py`
is doing, what it is trying to achieve, what it assumes, and what you should be
careful about when reading its results.

---

## 1. The Big Picture: What Are We Trying to Achieve?

We want to know, for every month, **how happy crops are with the amount of
water available across Africa** — and at a few specific locations.

Think of it like this: a plant needs a certain amount of water to be healthy
(its "water demand"). Some months it gets plenty, some months it gets too
little (a drought). We want a single number, each month, that says:

> "On a scale of 0 to 100, how well was the crop's water need satisfied?"

That number is called the **WRSI** (Water Requirement Satisfaction Index).

- **100** = the crop got all the water it wanted (great).
- **Low number** = the crop was thirsty (drought stress).
- **0** = essentially no water satisfied the need.

This is useful for spotting droughts, monitoring agriculture, and comparing
months or regions over time.

---

## 2. Step-by-Step: What the Script Actually Does

### Step 1 — Gather the monthly weather maps
The script reads a stack of monthly data files (`FLDAS...nc`). Each file is
like a weather map of Africa for one month, divided into a grid of small
squares ("cells"). For each square it contains measurements such as:

- Air temperature
- Humidity
- Air pressure
- Wind speed
- Sunlight / radiation
- Actual water loss from the land (evaporation + plant "breathing")

### Step 2 — Look at each square, each month
For every month, the script goes square by square across Africa and uses the
weather numbers to calculate two things (see below).

### Step 3 — Calculate "reference water loss" (ETo)
`ETo` stands for **Reference Evapotranspiration**. In plain terms:

> If we had a field of healthy reference grass, how much water would it lose
> to the air this month from evaporation and plant breathing?

This depends on the weather: hot, windy, dry, sunny weather makes plants lose
more water. The script uses a well-known scientific formula (FAO-56
Penman-Monteith) to estimate this from temperature, humidity, pressure, wind,
and sunlight.

Think of ETo as the crop's **water demand**.

### Step 4 — Get the "actual water loss" (ETa)
The data already includes `Evap_tavg`, which is the **actual**
evapotranspiration — how much water *actually* left the land and plants.

Think of ETa as the water that was **actually used / available**.

### Step 5 — Combine them into the WRSI score
For each square, the script computes:

```
WRSI = (actual water used) ÷ (reference water demand) × 100
```

So if the crop used exactly as much as a healthy reference crop would want,
the score is 100. If it only used half as much, the score is 50.

### Step 6 — Average it up
Finally, the script averages these scores:

- **Across all of Africa** → one number per month (`timeseries.csv`).
- **Around specific locations** → using a 1° × 1° box centered on each
  location's coordinates (`blocks_monthly.csv`).

---

## 3. The Assumptions Being Made

These are the "we'll pretend this is true" choices baked into the method:

1. **The reference plant is a short grass field.** The ETo formula is
   calibrated to a standard "reference crop" (a hypothetical healthy grass),
   not to maize, wheat, etc. So the stored WRSI reflects grass-like demand.
   The Climate Observer divides it by the selected crop's Kc_mid to show a
   specific crop (see `methodology.md`).

2. **Soil heat stored/released underground is ignored** (`G ≈ 0`). For
   monthly averages this is a standard, reasonable simplification.

3. **Wind is measured at 10 m height and converted to 2 m** using a standard
   formula. We assume that conversion is accurate for the area.

4. **The weather maps are correct.** Everything depends on the FLDAS dataset
   being a good representation of real conditions on the ground.

5. **Average first, then compare.** The script calculates WRSI *per square*
   and *then* averages the squares — it does not average the weather first.
   This is the more correct way to do it.

6. **Scores are clamped to 0–100.** Anything below 0 is reported as 0, and
   anything above 100 is reported as 100.

---

## 4. Caveats — Read These Before Trusting the Numbers

1. **WRSI here is model-based, not rainfall-based.** Many people think of
   WRSI as "rainfall ÷ demand." This version uses *actual evapotranspiration*
   from a model as the "supply" side, not measured rainfall. So it reflects
   what the model says plants used, which can differ from reality.

2. **Garbage in, garbage out.** ETo depends heavily on temperature, humidity,
   and radiation. Any error in those inputs flows straight into the final
   score.

3. **The 1° boxes may not match the location perfectly.** A location is
   represented by a 1-degree-by-1-degree square around its coordinates. If the
   real farm/field is small or on a coast/mountain, the box may include very
   different terrain.

4. **Monthly resolution hides detail.** Averaging over a whole month smooths
   out dry spells or floods that happened within that month.

5. **The Africa map is a rectangular cut.** The bounding box (lat −37 to 37,
   lon −20 to 60) is a rectangle that can include non-crop or coastal squares,
   slightly diluting the "agricultural" meaning of the Africa-wide average.

6. **Near-zero demand can cause weird ratios.** In cold months ETo can be
   close to zero, making the division unstable. The code guards against
   crashes, but those months should be interpreted with care.

7. **Clipping hides extremes.** Because scores are forced into 0–100, a
   severe deficit (e.g. −20) is shown as 0, so you lose information about
   *how bad* a bad month really was.

---

## 5. One-Sentence Summary

> The script turns monthly Africa weather maps into a simple 0–100 "crop water
> happiness" score (WRSI) for each month and location, by comparing how much
> water plants actually used versus how much a reference crop would have
> wanted — useful for tracking drought, but dependent on model accuracy and
> several simplifying assumptions. The app scales that score to the crop you
> select using the crop's Kc_mid.
