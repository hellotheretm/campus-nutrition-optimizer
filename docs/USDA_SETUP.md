# USDA FoodData Central setup

Micronutrient estimates come from USDA FoodData Central (FDC). All FDC data is in the public domain (CC0 1.0); please
cite it as: *U.S. Department of Agriculture, Agricultural Research Service. FoodData Central.* https://fdc.nal.usda.gov/

The app does **not** call the FDC API at runtime. It reads a compact local index built from FDC's bulk downloads, so
there is no API key to manage, no rate limit and no outage risk, and every estimate can be reproduced.

## Datasets

| Dataset | Release used | Why |
|---|---|---|
| Foundation Foods | 2026-10-29 | Most current analytical data for common ingredients |
| SR Legacy | 2018-04 | Broad coverage of ingredients and simple prepared foods |
| FNDDS 2021–2023 (Survey Foods) | 2024-10-31 | Prepared dishes as eaten, with recipe ingredients and portion weights |

Exact URLs are listed in `scripts/usda/datasets.ts`. Branded Foods is not used: it is very large, and label-only
records add little vitamin and mineral data.

## Building the index

The built index (`data/usda/usda-index.json.gz`, about 1.3 MB) is committed, so a fresh clone works offline. To
rebuild it, for example after USDA publishes a new release:

```bash
npm run usda:download      # downloads the three zip files (~18 MB) into data/usda/raw (skips files already there)
npm run usda:build-index   # writes data/usda/usda-index.json.gz
npm run estimator:validate # optional: re-measure accuracy (stop the dev server first if you use PGlite)
```

To change releases, update `scripts/usda/datasets.ts` (file name, URL and release date) and rebuild. Bump
`ESTIMATOR_VERSION` in `src/lib/nutrition/estimator.ts` when estimates change; the scheduled job and the admin page's
"Re-estimate" button then recompute stored foods in batches.

## What the index contains

For each food: FDC id, dataset, description, category, the nutrients the app tracks per 100 g, household portions with
gram weights, and, for FNDDS, recipe ingredients with gram weights. Baby foods and infant formula are excluded.
**Missing USDA values stay `null`; they are never converted to zero.**

`USDA_INDEX_PATH` overrides the index location (useful for serverless bundles). In Next.js the file is included in the
server bundle through `outputFileTracingIncludes` in `next.config.ts`.

## Using the FDC API instead (optional)

If you extend the app to search Branded Foods live, request a free key from api.data.gov, store it only in a server
environment variable, call the API only from server code, cache responses, and respect the published rate limits.
