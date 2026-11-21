# Menu data integration

## Summary

| Campus | Source | Automatic retrieval | How menus get in today |
|---|---|---|---|
| UW–Madison | UW Housing Dining via Nutrislice (`wisc-housingdining.nutrislice.com`) | **Unofficial sync** when `NUTRISLICE_SYNC_ENABLED=true` (no agreement); off otherwise | Daily sync, or imports |
| Demo University | Generated from USDA-based sample recipes | On (fictional data) | Automatic, clearly labeled, off in production by default |

The app never invents menus. When no data is stored, pages say so and link to the official menus.

## Findings for UW–Madison

- UW Housing Dining lists its dining markets and hours at housing.wisc.edu and publishes menus, nutrition and allergen
  details through Nutrislice. It notes that recipes and ingredients can change and that its markets are not
  allergen-free.
- Nutrislice's general terms of use restrict automated access to the service (scraping, crawlers, and use of its
  interfaces outside the public apps) unless Nutrislice agrees otherwise, and the API host's robots.txt disallows
  crawlers.
- No public, documented API or open-data license for UW's menus was found.

**Decision (project owner, 2026-11-20):** enable an unofficial sync from Nutrislice's public menu API, the same
method other student projects use (for example [uw-dining](https://github.com/wchen0808-ctrl/uw-dining)), without an
agreement with Nutrislice. This goes against items (vii) and (viii) of the restrictions in Nutrislice's General Terms of
Use, so:

- Nutrislice or UW can block the server or ask for the data to be taken down at any time. If that happens, turn the
  sync off (`NUTRISLICE_SYNC_ENABLED=false`) and fall back to imports.
- The interface never claims permission: UW–Madison is labeled "Synced from public menus", the menu browser says the
  menus are an unofficial copy not endorsed by the university or Nutrislice, and the footer states that the site isn't
  affiliated with either.
- Traffic is kept low: one request for the location list and one per market, meal and week (about 30–45 requests a
  day for UW), 1.5 s apart, with a plain User-Agent.

Getting permission is still the better long-term route; the request templates below remain valid, and an agreement
switches the label to "Menus sync automatically".

The dining market list (Carson's, Four Lakes, Gordon Avenue, Liz's and Rheta's markets) and their hours are entered in
`src/lib/universities/catalog.ts` from housing.wisc.edu, each with the date it was checked. Re-check them each term.

## Asking for access

Send one of these (edit freely). Keep the reply; its date and author become the authorization reference.

**To UW Housing Dining** (registered dietitian: dietitian@housing.wisc.edu)

> Subject: Request to use dining menu and nutrition data in a student nutrition app
>
> Hello, I'm a UW–Madison student building a free, non-commercial web app that helps students browse dining menus and
> understand vitamins and minerals, with clear labels for estimated values and no allergen guarantees. I would like
> permission to use UW Housing Dining's menu, nutrition and allergen data. Would you be able to (1) authorize access to
> the Nutrislice feed for this purpose, or (2) share a periodic export (CSV or JSON)? I will credit UW Housing Dining,
> link to the official menus, state that the app is not affiliated with the university, and remove data on request.
> Thank you!

**To Nutrislice** (support@nutrislice.com)

> Subject: Referencing/API agreement for a student nutrition app (UW–Madison)
>
> Hello, I'm building a non-commercial student app for UW–Madison that would show menus from
> wisc-housingdining.nutrislice.com with nutrition and allergen information, attributed to Nutrislice and UW Housing
> Dining with links back. Your terms require an agreement for automated access. Could you tell me how to request one,
> including the permitted endpoints, request limits and attribution requirements?

## Turning the Nutrislice sync on

**Unofficial (current setup for UW–Madison):**

```bash
NUTRISLICE_SYNC_ENABLED=true
```

The connector reads `/menu/api/schools/` to match each dining market to its Nutrislice school (by the location's
`externalRef`, e.g. `gordon-avenue-market`) and uses that school's active breakfast, lunch and dinner menu types.
Menus come from `/menu/api/weeks/school/<school>/menu-type/<meal>/<YYYY>/<MM>/<DD>/`. Station names come from
`menu_info[menu_id].section_options.display_name`; mobile-ordering placeholders ("OrderIt") are dropped.

**Authorized (after written permission):**

```bash
NUTRISLICE_SYNC_AUTHORIZED=true
NUTRISLICE_AUTHORIZATION_REF="Approved by <name, organization> on <date>, ref <ticket or agreement>"
NUTRISLICE_LOCATION_MAP='{"four-lakes-market":{"school":"<id>","menuTypes":{"breakfast":"<id>","lunch":"<id>","dinner":"<id>"}}}'
# Optional, if the agreement names a different host or a request rate:
NUTRISLICE_API_BASE=
NUTRISLICE_REQUEST_DELAY_MS=1500
```

`NUTRISLICE_LOCATION_MAP` is optional in both modes; without it, locations are discovered as above. In authorized
mode the connector identifies itself with the reference in its User-Agent. In both modes it waits between requests, retrieves yesterday through seven days ahead, and keeps earlier data when a request
fails (the menu is then labeled "cached"). The status shown to users ("Synced from public menus" or "Menus sync
automatically") follows the mode; nothing in the catalog needs to change.

Syncs run daily from `/api/cron/sync` and can be started from `/admin`. Each run is recorded with its trigger, date
range, counts of new/changed/unchanged foods, and warnings. Foods are deduplicated by a content hash: an unchanged
dish is reused; a dish whose serving, nutrition, ingredients or labels change gets a new revision under the same name,
and earlier revisions stay in history (diary entries keep their own nutrition snapshot either way).

### Everyday staples (UW–Madison)

Some foods are served every day but never appear on the posted menu. `src/lib/menus/staples.ts` lists them, and each
sync adds them to every day that has a published menu (never to a closed or missing day):

- Every dining market, every meal: skim milk, 2% milk, chocolate milk, non-fat plain Greek yogurt, bananas, oranges
  and apples.
- Four Lakes Market salad bar, lunch and dinner: sunflower seeds, fresh spinach and hard-boiled eggs.

They are shown at an "(always available)" station with a note that this site added them. Their portions are standard
USDA portions (1 cup of milk, a 6 oz yogurt, one medium fruit, 2 tbsp seeds, 2 cups spinach, one large egg), not UW's
own scoops, and their nutrition is a USDA FoodData Central estimate for a fixed food (the FDC id is stored with the
item), so it is labeled as an estimate. If a posted menu already lists a food with the same name, the posted one is
kept and the staple is skipped. To change the list, edit the file and re-run the sync.

## Approved imports

Use imports only for data the dining operator provided or approved. Every import records its source, where it came
from and who approved it; the admin page shows this next to the run.

- Web: `/admin` → *Approved menu import* → choose the university and file → **Check file** (validates, saves nothing) →
  **Import**. Files up to 5 MB; split larger ranges by date.
- Command line: `npm run menus:import -- --university uw-madison --file menus.json` (dry run), then add `--commit`.

An import replaces the stored menu for each location, date and meal it contains, and leaves everything else alone.

### JSON format

```json
{
  "format": "cno-menu-import",
  "version": 1,
  "university": "uw-madison",
  "source": {
    "name": "UW Housing Dining menu export",
    "obtainedFrom": "Emailed by <name>, UW Housing Dining",
    "permission": "Approved for this app by <name> on <date>",
    "retrievedAt": "2026-11-20"
  },
  "days": [
    {
      "location": "four-lakes-market",
      "date": "2026-11-23",
      "period": "lunch",
      "items": [
        {
          "id": "optional-source-id",
          "name": "Chicken Tikka Masala",
          "station": "Global",
          "serving": { "amount": 1, "unit": "cup", "grams": 245 },
          "nutrients": { "calories": 320, "protein_g": 24, "total_fat": 14, "sodium_mg": 780, "vitamin_d_mcg": null },
          "ingredients": "Chicken, Tomatoes, Cream (Milk), Onions, Spices, Salt",
          "allergens": ["milk"],
          "dietaryLabels": ["halal"]
        }
      ]
    },
    { "location": "four-lakes-market", "date": "2026-11-23", "period": "breakfast", "status": "closed" }
  ]
}
```

- `period`: `breakfast`, `brunch`, `lunch`, `dinner`, `late_night` or `other`.
- `status`: `available` (default) or `closed`. A closed meal lists no items. An available meal with no items is stored
  as "no menu published".
- `location`: the location slug shown on the admin page (or its external reference).
- Nutrients use common names with unit suffixes (`calories`, `protein_g`, `sodium_mg`, `vitamin_d_mcg`, `iron_mg`…).
  Leave out or set `null` anything not published: **missing values stay unknown**.

### CSV format

One row per item; the source fields are entered in the form (or with `--source-name`, `--obtained-from`,
`--permission` on the command line).

```csv
location,date,period,status,station,name,serving_amount,serving_unit,serving_grams,calories,protein_g,sodium_mg,ingredients,allergens,dietary_labels
four-lakes-market,2026-11-23,lunch,,Global,Chicken Tikka Masala,1,cup,245,320,24,780,"Chicken, Tomatoes, Cream (Milk)",milk,halal
four-lakes-market,2026-11-23,breakfast,closed,,,,,,,,,,,
```

`allergens` and `dietary_labels` are separated by `;` or `|`.

## Adding another university

1. Add an entry to `src/lib/universities/catalog.ts` (locations, hours with source URLs, official links, allergen
   notice, `integrationStatus`).
2. If the operator provides an authorized feed, implement a provider in `src/lib/menus/` (`MenuProvider` in
   `types.ts`) and register it in `providers.ts`; otherwise use `import`.
3. Requests from the "Don't see your university?" form are listed on `/admin`, merged by normalized name with a supporter
   count.
