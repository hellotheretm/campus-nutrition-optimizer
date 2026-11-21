/**
 * Provenance and confidence vocabulary shared by the server and the browser.
 * Every nutrient value shown in the app carries one provenance label and one
 * confidence level, and unknown values are never displayed as zero.
 */
export type Provenance = "official" | "usda_match" | "usda_recipe" | "approximate" | "unknown";
export type Confidence = "high" | "medium" | "low" | "none";
export type EstimationMethod = "official_only" | "direct_match" | "recipe" | "comparable" | "none";

export const PROVENANCE_LABELS: Record<Provenance, string> = {
  official: "Official",
  usda_match: "USDA matched",
  usda_recipe: "USDA recipe-derived",
  approximate: "Approximate",
  unknown: "Unknown",
};

export const PROVENANCE_DESCRIPTIONS: Record<Provenance, string> = {
  official: "Published by the dining operation. Label values are rounded, so small differences are expected.",
  usda_match: "Taken from a matching USDA FoodData Central record, scaled to this serving.",
  usda_recipe:
    "Reconstructed from the ingredient list: each ingredient was matched to USDA data and amounts were solved to reproduce the published calories and macros.",
  approximate: "Based on a comparable USDA dish or on partial data. Treat as a rough guide.",
  unknown: "No reliable data is available. Unknown is not the same as zero.",
};

export const CONFIDENCE_LABELS: Record<Confidence, string> = {
  high: "High confidence",
  medium: "Medium confidence",
  low: "Low confidence",
  none: "Not available",
};

export const CONFIDENCE_DESCRIPTIONS: Record<Confidence, string> = {
  high: "Published by the dining operation, or a close USDA match with a known serving size.",
  medium: "A reasonable USDA match or recipe reconstruction. Expect some difference from the real dish.",
  low: "A rough estimate. The true amount could be well above or below the value shown.",
  none: "No usable data. Unknown is not the same as zero.",
};

export const METHOD_LABELS: Record<EstimationMethod, string> = {
  official_only: "Official values only",
  direct_match: "Direct USDA match",
  recipe: "Recipe reconstruction",
  comparable: "Comparable dish",
  none: "No estimate",
};

export const METHOD_DESCRIPTIONS: Record<EstimationMethod, string> = {
  official_only:
    "Only the values the dining operation published are shown. Nutrients they did not publish are listed as unknown.",
  direct_match:
    "The dish closely matches a single USDA FoodData Central record, which was scaled to the serving size.",
  recipe:
    "Each ingredient in the published ingredient list was matched to USDA data. Ingredient amounts were solved so the recipe reproduces the published calories and macronutrients, then vitamins and minerals were added up with cooking losses applied.",
  comparable:
    "No ingredient list was available, so a comparable USDA dish was scaled to the published calories. This is a rough guide.",
  none: "There was not enough information to estimate this food's nutrients.",
};
