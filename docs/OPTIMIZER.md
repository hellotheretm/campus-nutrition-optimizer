# Meal optimizer

The optimizer picks dishes and servings from the stored menus for the meals you choose, so the day covers vitamins,
minerals, protein and fiber well while staying gentle on sodium, saturated fat and added sugars. It is a
mixed-integer linear program (MILP) solved with HiGHS (WebAssembly) on the server. Code: `src/lib/optimizer/`.

## Inputs

- Date, the meals to plan (breakfast, brunch, lunch, dinner, late night), and for each meal either specific dining
  locations or all of them. Only locations with a stored menu for that meal are offered.
- Dietary pattern (vegetarian, vegan, pescatarian), allergens to avoid, "avoid gluten/dairy/nuts", excluded ingredients,
  dislikes and preferred foods.
- Reference values: FDA Daily Values (default) or Dietary Reference Intakes by optional age range and sex.
- There is one goal: cover as many of the day's vitamin, mineral, protein and fiber references as the menus allow, and
  hit any calorie and macro targets that were set.
- Strategy: balanced, protein-forward, plant-forward, lower sodium, or fewer items.
- Optional **daily targets** for calories, protein, fat and carbs, available to everyone. Any may be left blank; with
  three of the four set the fourth is calculated (calories = 4P + 9F + 4C), and four set must add up exactly. A
  tolerance of ±3, 5 or 10% applies to each. Signed-in users can save default targets in Settings.
- Locks, exclusions and "don't repeat" constraints coming from the editing tools.

## Candidates

`candidates.ts` loads every item on the stored menus for the date, meal and locations, with per-serving nutrients from
the estimator. Items that fail a filter are removed (and counted, so infeasibility can be explained).
Items whose single published serving is a batch or bulk record (about a pound or more, or 1,000+ kcal, such as UW's
"1 lbs" grain and vegetable components) are never chosen automatically; they stay on menus and in the "choose from the
menu" picker with that reason, and a locked one is always kept. The same food
served at two locations becomes two candidates, one per location. Very large menus are pruned to the 45 most useful
items per meal while keeping every location represented and every locked item.

## Model

Variables, for each candidate *j* in meal *m*:

- `n_j` integer servings in steps of the item's serving increment (0.5 or 1), up to the per-item maximum
- `y_j` binary "item is on the plate", linked by `n_j ≤ max·y_j` and `n_j ≥ y_j`
- `h_{m,l}` binary "meal *m* is at location *l*", with `Σ_l h_{m,l} = 1` and `y_j ≤ h_{m,loc(j)}`: **each meal is
  eaten at one dining location**

Per meal: between 1 and the maximum number of items, and a cap on total servings.

### Objective (minimized)

- **Goals with diminishing returns** (day level; protein is also nudged to spread across meals). For each goal
  nutrient, coverage of the reference is built from the *conservative* value of each item (the estimate moved part-way toward the low end of its range by confidence:
  0%, 15% or 35% for high, medium and low). Shortfall is penalized piecewise: the first 25% short costs 1×, the next 25%
  costs 1.8×, the rest 3×. Over-delivering earns nothing extra, so one nutrient never crowds out the others.
- **Soft limits** for sodium, saturated fat and added sugars, using the *pessimistic* value (moved toward the high end).
  Going up to 25% over costs 1×, beyond that 3×.
- **Tolerable upper intake levels (ULs)** for nutrients whose UL applies to food (vitamin A as retinol, C, D, B6,
  choline, calcium, copper, iron, manganese, phosphorus, selenium, zinc), using the high end of every range. A slack
  variable with a very large penalty keeps the model solvable but makes exceeding a UL a last resort, and any remaining
  risk is reported as a warning.
- **Macronutrient distribution** (no targets set): small penalties for protein, fat and carbohydrate energy outside the AMDR.
- **Calorie and macro targets** (when set, for anyone): only the targets that were set are modeled, and they always agree
  with 4/9/4 math (see Inputs). For each target, `Σ value·n + under − over = target`; `under` and `over` cost
  `40/target` each (a pull toward exact), and each must stay within ±tolerance (3, 5 or 10%). The band is hard: its
  slack costs `5000/target` and exists only so an impossible request is explained ("the closest plan these menus
  allow has 2,610 kcal, outside your 2,300 ±5% target"). Items with an unknown value for a targeted macro can't be
  counted, so they are not chosen unless locked. Targets replace the AMDR penalties. Label rounding
  means a food's calories rarely equal its 4/9/4 math exactly, which is why a tolerance exists at all.
- **Practical portions:** a small cost per item and per serving, a larger one for second servings of the same dish,
  a bonus for preferred foods, a small cost for low-confidence items, and a variety cost when the same dish appears in
  several meals. Strategies adjust weights (for example plant-forward rewards labeled vegetarian/vegan items; lower
  sodium tightens the sodium limit to 75% and triples its weight).

### Editing constraints

- **Lock:** a locked item must appear with exactly its servings. A locked food served at several locations may be taken
  from any location that serves *all* the meal's locked foods; if none does, the plan is infeasible with that reason.
- **Exclude / replace:** excluded items are left out of the candidates; "replace with the optimizer's pick" locks
  everything else and excludes the item.
- **Another option:** a no-good cut on each plan already shown (`Σ y over its items ≤ k − 1`) guarantees a different
  plan.
- **New meal:** a cut keeps at most half of the meal's previous items (`≤ ⌊k/2⌋`), applied to the current version and
  up to three earlier ones, so repeated clicks don't cycle.

## Infeasibility

Before solving, the optimizer checks for closed meals, empty menus, everything filtered out and conflicting locks, and
reports each with a suggestion (another date or location, relaxing a filter, unlocking an item). If the solver still
finds no plan, the result says which hard requirements could not be met together (locked items, one location per meal,
item caps, not repeating earlier plans) and what to relax, instead of returning an empty plan.

## Editing in the browser

The plan arrives with every item's per-serving nutrients, so totals, coverage and "why this item" notes update instantly
while you change servings, lock, remove or add items (`coverage.ts`, shared by server and client). Edited plans are
marked "Edited by you". Saving or adding to the diary sends only the selection (food ids, servings, locks); the server
rebuilds the plan from stored menu data (`evaluate.ts`), so nothing the browser sends can change nutrition values.

- **Re-plan this and later meals / Re-plan around my changes:** locks your current items, solves again, and shows a
  before/after diff (items added, removed, changed; references met; nutrients that changed; limits) before you accept.
- **Compare strategies:** solves the other strategies and measures every option against the same baseline references,
  so a lower-sodium plan isn't judged by its own stricter limit.

## Output

Meals with items (servings, why each was chosen, confidence, allergens and labels), coverage rows for every goal and
limit with ranges and unknown counts, energy with its range, each calorie and macro target with how close the plan came, warnings (including UL risk), a plain
summary, assumptions, and solver statistics. Plans can be saved to History or added to the diary as planned or eaten.

## Performance

Typical three-meal demo plans have ~50 candidates and ~270 variables and solve in 1–2 seconds. Requests are rate
limited per user or client.
