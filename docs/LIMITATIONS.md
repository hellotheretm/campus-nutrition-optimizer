# Limitations

This app is honest about what it cannot know. These limits also appear in the interface where they matter.

## Menu data

- **UW–Madison menus are an unofficial copy.** They're copied from Nutrislice's public menu API without an agreement;
  Nutrislice's terms don't permit automated access, so the sync can be blocked or stopped at any time. If it stops,
  the last synced menus are labeled "cached", then "no menu data", with links to the official menus. Missing
  menus are never filled in. See [MENU_DATA_INTEGRATION.md](MENU_DATA_INTEGRATION.md).
- **UW's feed has no vitamin A and an unusable vitamin D field** (its units are implausible), so vitamins come from
  the USDA-based estimates, not official values.
- **Everyday staples are added by this site.** Milk, Greek yogurt, fruit (all UW markets) and the Four Lakes salad-bar
  seeds, spinach and eggs aren't on UW's posted menus; they're added from a fixed list with standard USDA portions and
  estimated nutrition, which may not match UW's actual portions or brands, or a day when one runs out.
- **Menus change.** Even synced menus can differ from what is served (substitutions, sold-out items, station changes).
  Every menu shows when it was retrieved and is labeled current, cached or unavailable.
- **Hours** are entered from the dining website and checked each term; holiday and break schedules may differ.

## Nutrition

- **Published values are rounded** (FDA label rounding), so even "official" numbers carry a small range.
- **Vitamins and most minerals are estimates.** They are reconstructed from ingredient lists and USDA data. Recipes,
  brands, fortification, cooking and portioning vary, so a single dish can differ substantially from its estimate.
  Ranges and confidence labels describe this; validation on known recipes found 82% of ranges contained the true value
  ([ESTIMATOR_VALIDATION.md](ESTIMATOR_VALIDATION.md)), and real dishes are harder.
- **Unknown is not zero.** When nothing can be estimated, the value is shown as unknown and totals count those items
  separately, so a daily total may understate the real intake.
- **Portions:** servings assume the published serving size; what lands on a plate varies.
- Vitamin A or E published in IU are not converted (the conversion depends on the chemical form), so they remain
  unknown unless another source provides them.

## Allergens and diets

- **No allergen guarantees.** Allergen and dietary labels are shown as the dining operator publishes them. Ingredient
  matching is used only to exclude more items, never to declare an item safe. Kitchens share equipment and fryers, and
  recipes change. People with allergies should confirm with dining staff (for UW–Madison, the UW Housing registered
  dietitian).
- Dietary patterns rely on the operator's labels; an unlabeled item is not treated as vegetarian or vegan.

## The optimizer

- It plans from stored menus only and assumes each meal is eaten at one location.
- Items listed with bulk servings (about a pound or more, or 1,000+ kcal per serving) are left out of automatic plans,
  because those are batch records rather than plate portions. You can still add them yourself.
- It aims for general reference values (FDA Daily Values or DRIs), which are population benchmarks, not personal
  prescriptions. It does not diagnose deficiencies, treat conditions, or account for supplements, medications,
  pregnancy, athletic training or medical diets.
- Uncertain estimates are counted conservatively, so a plan may contain more of a nutrient than its coverage shows.
- Calorie and macro targets are only ever the numbers a person enters; the app never suggests targets or creates a
  calorie deficit on its own. Anyone can set them, including people under 19, who see a note that teens need enough
  energy to grow.

## Accounts and privacy

- Age range and sex are optional and used only to choose reference values. Weight is never requested.
- Requests from the "Don't see your university?" form may include an optional email, visible to administrators only.

## Not medical advice

The app is an educational tool. For individual nutrition needs, talk to a registered dietitian or a health
professional. UW–Madison students can reach University Health Services and the UW Housing dietitian.
