/**
 * USDA FoodData Central bulk datasets used to build the local reference index.
 * All FoodData Central data is in the public domain (CC0 1.0).
 * Download page: https://fdc.nal.usda.gov/download-datasets/
 */
export interface UsdaDataset {
  key: "foundation" | "sr_legacy" | "fndds";
  label: string;
  release: string;
  /** Local short file name (kept short for Windows path limits). */
  file: string;
  url: string;
  /** Top-level JSON key holding the food array. */
  jsonKey: string;
}

export const USDA_DATASETS: UsdaDataset[] = [
  {
    key: "foundation",
    label: "Foundation Foods",
    release: "2026-10-29",
    file: "foundation-2026-10-29.zip",
    url: "https://fdc.nal.usda.gov/fdc-datasets/FoodData_Central_foundation_food_json_2026-10-29.zip",
    jsonKey: "FoundationFoods",
  },
  {
    key: "sr_legacy",
    label: "SR Legacy",
    release: "2018-04",
    file: "sr-legacy-2018-04.zip",
    url: "https://fdc.nal.usda.gov/fdc-datasets/FoodData_Central_sr_legacy_food_json_2018-04.zip",
    jsonKey: "SRLegacyFoods",
  },
  {
    key: "fndds",
    label: "Food and Nutrient Database for Dietary Studies (FNDDS) 2021–2023",
    release: "2024-10-31",
    file: "fndds-2024-10-31.zip",
    url: "https://fdc.nal.usda.gov/fdc-datasets/FoodData_Central_survey_food_json_2024-10-31.zip",
    jsonKey: "SurveyFoods",
  },
];
