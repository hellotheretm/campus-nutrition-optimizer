# Nutrition estimation

Dining operators usually publish calories, macronutrients, sodium and a few minerals. Vitamins and most minerals are
missing, so the app estimates them from USDA FoodData Central and is explicit about how sure it is. Code:
`src/lib/nutrition/estimator.ts`. Accuracy results: [ESTIMATOR_VALIDATION.md](ESTIMATOR_VALIDATION.md).

## What every number carries

| Field | Meaning |
|---|---|
| `value` | Best estimate per serving, or `null` when unknown |
| `low`, `high` | Plausible range |
| `provenance` | Where it came from (below) |
| `confidence` | `high`, `medium`, `low` or `none` |

| Provenance | Shown as | Source |
|---|---|---|
| `official` | Official | Published by the dining operator. Treated as label-rounded, so it has a small range too. |
| `usda_match` | USDA matched | A matching USDA record scaled to the serving. |
| `usda_recipe` | USDA recipe-derived | Reconstructed from the ingredient list (below). |
| `approximate` | Approximate | A comparable USDA dish or partial data. A rough guide. |
| `unknown` | Unknown | Not enough information. **Never displayed or summed as zero.** |

Totals (a diary day, a plan) add values and ranges, and count how many items had no data for each nutrient, so a total
can say "≈ 40% of the reference, 3 items unknown" instead of hiding the gap.

## Method

Published values are never replaced. The estimator then tries, best first:

1. **Recipe reconstruction** (when an ingredient statement is published). The statement is parsed into ingredients with
   sub-ingredients, stated percentages, the "2% or less" group and any "Contains:" statement. Each ingredient is matched
   to plausible USDA records (Foundation, SR Legacy, FNDDS). The estimator then solves for ingredient amounts that:
   - follow label order (ingredients are listed by descending weight),
   - keep "2% or less" ingredients at or under 2%,
   - respect realistic caps for ingredient types (salt, spices, leaveners…), and
   - reproduce the published calories and macronutrients within their label-rounding intervals
     (a convex quadratic program).

   Ranges come from linear programs that minimize and maximize each nutrient over every formulation consistent with the
   label, using the lowest and highest values among the plausible USDA records for each ingredient. Cooking losses are
   applied to heat-sensitive vitamins (for example vitamin C, thiamin and folate).
2. **Direct match** (no usable ingredient list, dish name matches a USDA record well). The serving weight comes from the
   menu, from USDA portion data, or is anchored on the published calories.
3. **Comparable dish** (weak match). Shown as approximate with wider ranges.

A natural-variation allowance (foods of the same name differ) is added to every estimated range. Nutrients that swing
with fortification, soil or recipe practice (for example vitamin D, iodine, selenium) get wider ranges and lower
confidence.

## Confidence

- **High:** published by the operator, or a close USDA match with a known serving size.
- **Medium:** a reasonable match or recipe reconstruction; expect some difference from the real dish.
- **Low:** a rough estimate; the true amount could be well above or below the value shown.
- **Not available:** no usable data.

Each food page shows the method, the USDA records used (with links to FDC), how much of the recipe matched, and the
assumptions made.

## How uncertainty is used

- The **optimizer** counts uncertain values conservatively toward goals (it moves part-way toward the low end of the
  range: 0% for high, 15% for medium, 35% for low confidence) and uses the high end for limits and upper intake levels.
- The **dashboard and diary** show the estimate with its range and confidence, and say when items are unknown.
- **Allergens** are never inferred as safe. Labels from the operator are shown as published; ingredient matches are only
  ever used to exclude more items, and every allergen display repeats that kitchens share equipment.

## Validation

`npm run estimator:validate` hides the true composition of the demo recipes (built from real USDA records with gram
weights), gives the estimator only what a menu publishes (rounded labels and an ordered ingredient list), and compares.
In the latest run, 82% of estimated ranges contained the true value; the median absolute error was 16% overall (7% for
medium-confidence and 22% for low-confidence estimates). Real dishes add uncertainty this test cannot capture.

## Updating the estimator

Change the logic, bump `ESTIMATOR_VERSION`, run the tests and the validation, and let the daily job (or **Re-estimate**
on `/admin`) recompute stored foods. Each food records the estimator version that produced it.
