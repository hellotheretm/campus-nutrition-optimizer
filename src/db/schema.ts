/**
 * Drizzle table definitions. The SQL source of truth is db/migrations/*.sql;
 * these definitions mirror it for type-safe queries.
 */
import {
  bigint,
  bigserial,
  boolean,
  date,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import type { EstimationResult, NutrientEstimates } from "@/lib/nutrition/estimator";
import type { NutrientId } from "@/lib/nutrition/nutrients";

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

/* ------------------------------------------------------------------ */
/* Auth (Better Auth core schema; JS keys must match Better Auth names) */
/* ------------------------------------------------------------------ */

export const authUser = pgTable("auth_user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const authSession = pgTable(
  "auth_session",
  {
    id: text("id").primaryKey(),
    expiresAt: ts("expires_at").notNull(),
    token: text("token").notNull().unique(),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => authUser.id, { onDelete: "cascade" }),
  },
  (t) => [index("auth_session_user_idx").on(t.userId)],
);

export const authAccount = pgTable(
  "auth_account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => authUser.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: ts("access_token_expires_at"),
    refreshTokenExpiresAt: ts("refresh_token_expires_at"),
    scope: text("scope"),
    password: text("password"),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [index("auth_account_user_idx").on(t.userId)],
);

export const authVerification = pgTable(
  "auth_verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: ts("expires_at").notNull(),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [index("auth_verification_identifier_idx").on(t.identifier)],
);

/* ------------------------------------------------------------------ */
/* Universities, locations, menus (public data)                        */
/* ------------------------------------------------------------------ */

export type IntegrationStatus = "live" | "import_only" | "pending_authorization" | "demo" | "inactive";
/** What the interface shows: the stored status, or "unofficial_sync" when an operator enabled sync without an agreement. */
export type DisplayIntegrationStatus = IntegrationStatus | "unofficial_sync";
export type MenuProviderKind = "nutrislice" | "import" | "demo";

export const universities = pgTable("universities", {
  id: text("id").primaryKey(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  shortName: text("short_name"),
  city: text("city"),
  state: text("state"),
  timezone: text("timezone").notNull().default("America/Chicago"),
  websiteUrl: text("website_url"),
  menuSourceUrl: text("menu_source_url"),
  nutritionInfoUrl: text("nutrition_info_url"),
  integrationStatus: text("integration_status").$type<IntegrationStatus>().notNull().default("import_only"),
  integrationNotes: text("integration_notes"),
  provider: text("provider").$type<MenuProviderKind>().notNull().default("import"),
  providerConfig: jsonb("provider_config").$type<Record<string, unknown>>().notNull().default({}),
  allergenNotice: text("allergen_notice"),
  isDemo: boolean("is_demo").notNull().default(false),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export type MealPeriod = "breakfast" | "lunch" | "dinner" | "brunch" | "late_night" | "other";

export interface HoursRule {
  /** 0 = Sunday … 6 = Saturday */
  days: number[];
  periods: { period: MealPeriod; open: string; close: string }[];
  note?: string;
}

export const diningLocations = pgTable(
  "dining_locations",
  {
    id: text("id").primaryKey(),
    universityId: text("university_id")
      .notNull()
      .references(() => universities.id, { onDelete: "cascade" }),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    building: text("building"),
    address: text("address"),
    kind: text("kind").notNull().default("dining_market"),
    hours: jsonb("hours").$type<HoursRule[]>().notNull().default([]),
    hoursSourceUrl: text("hours_source_url"),
    hoursVerifiedOn: date("hours_verified_on"),
    externalRef: text("external_ref"),
    sortOrder: integer("sort_order").notNull().default(0),
    isActive: boolean("is_active").notNull().default(true),
  },
  (t) => [uniqueIndex("dining_locations_uni_slug").on(t.universityId, t.slug)],
);

export type OfficialNutrients = Partial<Record<NutrientId, number>>;

export const foods = pgTable(
  "foods",
  {
    id: text("id").primaryKey(),
    universityId: text("university_id")
      .notNull()
      .references(() => universities.id, { onDelete: "cascade" }),
    /** Groups revisions of the same dish (normalized name + serving). */
    lineageKey: text("lineage_key").notNull(),
    revision: integer("revision").notNull().default(1),
    name: text("name").notNull(),
    normalizedName: text("normalized_name").notNull(),
    description: text("description"),
    station: text("station"),
    servingAmount: doublePrecision("serving_amount"),
    servingUnit: text("serving_unit"),
    servingGrams: doublePrecision("serving_grams"),
    official: jsonb("official").$type<OfficialNutrients>().notNull().default({}),
    ingredients: text("ingredients"),
    allergens: text("allergens").array().notNull().default([]),
    dietaryLabels: text("dietary_labels").array().notNull().default([]),
    sourceRef: text("source_ref"),
    contentHash: text("content_hash").notNull(),
    estimate: jsonb("estimate").$type<EstimationResult>(),
    estimateVersion: text("estimate_version"),
    estimatedAt: ts("estimated_at"),
    fdcOverride: integer("fdc_override"),
    firstSeen: date("first_seen").notNull(),
    lastSeen: date("last_seen").notNull(),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("foods_uni_hash").on(t.universityId, t.contentHash),
    index("foods_lineage_idx").on(t.universityId, t.lineageKey),
    index("foods_name_idx").on(t.universityId, t.normalizedName),
  ],
);

export type MenuDayStatus = "available" | "closed" | "no_data" | "error";

export const menuDays = pgTable(
  "menu_days",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    universityId: text("university_id")
      .notNull()
      .references(() => universities.id, { onDelete: "cascade" }),
    locationId: text("location_id")
      .notNull()
      .references(() => diningLocations.id, { onDelete: "cascade" }),
    date: date("date").notNull(),
    period: text("period").$type<MealPeriod>().notNull(),
    status: text("status").$type<MenuDayStatus>().notNull(),
    source: text("source").$type<MenuProviderKind>().notNull(),
    contentHash: text("content_hash"),
    fetchedAt: ts("fetched_at").notNull().defaultNow(),
    syncRunId: text("sync_run_id"),
    note: text("note"),
  },
  (t) => [
    uniqueIndex("menu_days_loc_date_period").on(t.locationId, t.date, t.period),
    index("menu_days_uni_date").on(t.universityId, t.date),
  ],
);

export const menuItems = pgTable(
  "menu_items",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    menuDayId: bigint("menu_day_id", { mode: "number" })
      .notNull()
      .references(() => menuDays.id, { onDelete: "cascade" }),
    foodId: text("food_id")
      .notNull()
      .references(() => foods.id),
    station: text("station"),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (t) => [index("menu_items_day_idx").on(t.menuDayId), index("menu_items_food_idx").on(t.foodId)],
);

export interface SyncStats {
  days: number;
  closed: number;
  items: number;
  newFoods: number;
  changedFoods: number;
  unchangedFoods: number;
  changedDays: number;
  estimated: number;
  warnings: string[];
  /** For approved imports: where the file came from and who approved its use. */
  importSource?: { name: string; obtainedFrom: string; permission: string; retrievedAt?: string; fileName?: string };
}

export const syncRuns = pgTable(
  "sync_runs",
  {
    id: text("id").primaryKey(),
    universityId: text("university_id")
      .notNull()
      .references(() => universities.id, { onDelete: "cascade" }),
    provider: text("provider").$type<MenuProviderKind>().notNull(),
    trigger: text("trigger").notNull(),
    status: text("status").$type<"running" | "success" | "partial" | "failed">().notNull(),
    dateFrom: date("date_from"),
    dateTo: date("date_to"),
    stats: jsonb("stats").$type<SyncStats>(),
    error: text("error"),
    triggeredBy: text("triggered_by"),
    startedAt: ts("started_at").notNull().defaultNow(),
    finishedAt: ts("finished_at"),
  },
  (t) => [index("sync_runs_uni_started").on(t.universityId, t.startedAt)],
);

/* ------------------------------------------------------------------ */
/* User data (row-level security: user_id = current_setting('app.user_id')) */
/* ------------------------------------------------------------------ */

export interface DietaryPreferences {
  pattern: "none" | "vegetarian" | "vegan" | "pescatarian";
  avoidGluten: boolean;
  avoidDairy: boolean;
  avoidNuts: boolean;
  avoidAllergens: string[];
  excludedIngredients: string[];
  dislikes: string[];
  preferred: string[];
}

export interface ProfileGoals {
  /** Daily calorie and macro targets (any may be blank), used as optimizer defaults and shown in the diary. */
  targets?: {
    energy: number | null;
    protein: number | null;
    fat: number | null;
    carbohydrate: number | null;
    tolerancePct: 3 | 5 | 10;
  };
  /** Older format: a calorie range and a protein minimum. Read once and converted to `targets`. */
  calorieGoal?: { min: number | null; max: number | null };
  proteinGoal?: number | null;
}

export interface NutrientGoal {
  min?: number;
  max?: number;
}

export const profiles = pgTable("profiles", {
  userId: text("user_id")
    .primaryKey()
    .references(() => authUser.id, { onDelete: "cascade" }),
  displayName: text("display_name"),
  universityId: text("university_id").references(() => universities.id, { onDelete: "set null" }),
  referenceStandard: text("reference_standard").$type<"fda_dv" | "dri">().notNull().default("fda_dv"),
  ageGroup: text("age_group").notNull().default("unspecified"),
  sex: text("sex").notNull().default("unspecified"),
  showCalories: boolean("show_calories").notNull().default(true),
  showPercentages: boolean("show_percentages").notNull().default(true),
  goals: jsonb("goals").$type<ProfileGoals>().notNull().default({}),
  dietary: jsonb("dietary").$type<Partial<DietaryPreferences>>().notNull().default({}),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export type DiaryMeal = "breakfast" | "lunch" | "dinner" | "snack";
export type DiaryStatus = "logged" | "planned";

export interface CustomFood {
  name: string;
  servingLabel: string;
  nutrients: Partial<Record<NutrientId, number>>;
}

export const diaryEntries = pgTable(
  "diary_entries",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => authUser.id, { onDelete: "cascade" }),
    date: date("date").notNull(),
    meal: text("meal").$type<DiaryMeal>().notNull(),
    status: text("status").$type<DiaryStatus>().notNull().default("logged"),
    foodId: text("food_id").references(() => foods.id, { onDelete: "set null" }),
    fdcId: integer("fdc_id"),
    custom: jsonb("custom").$type<CustomFood>(),
    name: text("name").notNull(),
    servingLabel: text("serving_label"),
    servings: doublePrecision("servings").notNull().default(1),
    grams: doublePrecision("grams"),
    locationName: text("location_name"),
    /** Snapshot of nutrients for the logged amount, so history never changes underneath the user. */
    nutrients: jsonb("nutrients").$type<NutrientEstimates>().notNull(),
    planId: text("plan_id"),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [index("diary_user_date").on(t.userId, t.date)],
);

export const favorites = pgTable(
  "favorites",
  {
    userId: text("user_id")
      .notNull()
      .references(() => authUser.id, { onDelete: "cascade" }),
    foodKey: text("food_key").notNull(),
    name: text("name").notNull(),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.foodKey] })],
);

export interface SavedMealItem {
  foodKey: string;
  name: string;
  servings: number;
  grams?: number | null;
}

export const savedMeals = pgTable(
  "saved_meals",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => authUser.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    items: jsonb("items").$type<SavedMealItem[]>().notNull(),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [index("saved_meals_user").on(t.userId)],
);

export const mealPlans = pgTable(
  "meal_plans",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => authUser.id, { onDelete: "cascade" }),
    date: date("date").notNull(),
    universityId: text("university_id").notNull(),
    request: jsonb("request").$type<Record<string, unknown>>().notNull(),
    result: jsonb("result").$type<Record<string, unknown>>().notNull(),
    name: text("name"),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [index("meal_plans_user_date").on(t.userId, t.date)],
);

/* ------------------------------------------------------------------ */
/* University requests, rate limits, dev mail outbox                   */
/* ------------------------------------------------------------------ */

export const universityRequests = pgTable(
  "university_requests",
  {
    id: text("id").primaryKey(),
    universityName: text("university_name").notNull(),
    normalizedKey: text("normalized_key").notNull(),
    city: text("city"),
    state: text("state"),
    country: text("country"),
    websiteUrl: text("website_url"),
    menuUrl: text("menu_url"),
    contactEmail: text("contact_email"),
    message: text("message"),
    requesterUserId: text("requester_user_id"),
    supporters: integer("supporters").notNull().default(1),
    status: text("status").$type<"new" | "reviewing" | "planned" | "declined" | "added">().notNull().default("new"),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("university_requests_key").on(t.normalizedKey)],
);

export const rateLimits = pgTable("rate_limits", {
  key: text("key").primaryKey(),
  count: integer("count").notNull(),
  windowStart: ts("window_start").notNull(),
});

export const emailOutbox = pgTable("email_outbox", {
  id: text("id").primaryKey(),
  to: text("to_address").notNull(),
  subject: text("subject").notNull(),
  text: text("body_text").notNull(),
  html: text("body_html"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const authSchema = {
  user: authUser,
  session: authSession,
  account: authAccount,
  verification: authVerification,
};
