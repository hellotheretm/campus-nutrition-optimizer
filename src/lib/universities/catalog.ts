/**
 * Built-in university catalog. Location names, addresses and regular hours
 * come from each university's official pages (source URL and check date are
 * stored with every location). Menus are never part of this catalog: they
 * arrive only through a provider sync or an approved import.
 */
import type { HoursRule, IntegrationStatus, MenuProviderKind } from "@/db/schema";
import { DEMO_HALLS, DEMO_UNIVERSITY } from "@/lib/demo/derive";

export interface CatalogLocation {
  slug: string;
  name: string;
  building: string | null;
  address: string | null;
  kind: "dining_market" | "cafe" | "other";
  hours: HoursRule[];
  hoursSourceUrl: string | null;
  hoursVerifiedOn: string | null;
  externalRef: string | null;
}

export interface CatalogUniversity {
  id: string;
  slug: string;
  name: string;
  shortName: string;
  city: string | null;
  state: string | null;
  timezone: string;
  websiteUrl: string | null;
  menuSourceUrl: string | null;
  nutritionInfoUrl: string | null;
  integrationStatus: IntegrationStatus;
  integrationNotes: string;
  provider: MenuProviderKind;
  providerConfig: Record<string, unknown>;
  allergenNotice: string | null;
  isDemo: boolean;
  locations: CatalogLocation[];
}

const WEEKDAYS = [1, 2, 3, 4, 5];
const UW_HOURS_URL = "https://www.housing.wisc.edu/dining/locations/";
const UW_CHECKED = "2026-11-19";

export const UW_MADISON: CatalogUniversity = {
  id: "uw-madison",
  slug: "uw-madison",
  name: "University of Wisconsin–Madison",
  shortName: "UW–Madison",
  city: "Madison",
  state: "WI",
  timezone: "America/Chicago",
  websiteUrl: "https://www.housing.wisc.edu/dining/",
  menuSourceUrl: "https://wisc-housingdining.nutrislice.com/menu",
  nutritionInfoUrl: "https://www.housing.wisc.edu/dining/nutrition/",
  integrationStatus: "pending_authorization",
  integrationNotes:
    "UW Housing Dining publishes menus through Nutrislice. Automatic sync is off on this server, so menus come only from imported menu files.",
  provider: "nutrislice",
  providerConfig: { subdomain: "wisc-housingdining" },
  allergenNotice:
    "UW Housing Dining publishes allergen and ingredient details in Nutrislice, notes that ingredients and nutrition can vary, and says its markets are not allergen-free (shared equipment and fryers). For dietary concerns, contact the UW Housing registered dietitian at dietitian@housing.wisc.edu.",
  isDemo: false,
  locations: [
    {
      slug: "carsons-market",
      name: "Carson's Market",
      building: "Carson Gulley Center",
      address: "1515 Tripp Cir, Madison, WI",
      kind: "dining_market",
      hours: [
        {
          days: [0, 1, 2, 3, 4],
          periods: [
            { period: "lunch", open: "11:00", close: "16:00" },
            { period: "dinner", open: "16:00", close: "20:00" },
          ],
        },
      ],
      hoursSourceUrl: UW_HOURS_URL,
      hoursVerifiedOn: UW_CHECKED,
      externalRef: "carsons-market",
    },
    {
      slug: "four-lakes-market",
      name: "Four Lakes Market",
      building: "Dejope Residence Hall",
      address: "640 Elm Dr, Madison, WI",
      kind: "dining_market",
      hours: [
        {
          days: WEEKDAYS,
          periods: [
            { period: "breakfast", open: "07:00", close: "10:00" },
            { period: "lunch", open: "11:00", close: "14:00" },
            { period: "dinner", open: "16:00", close: "20:30" },
          ],
        },
        {
          days: [0, 6],
          periods: [
            { period: "breakfast", open: "09:00", close: "11:00" },
            { period: "lunch", open: "11:00", close: "14:00" },
            { period: "dinner", open: "16:00", close: "20:30" },
          ],
        },
      ],
      hoursSourceUrl: UW_HOURS_URL,
      hoursVerifiedOn: UW_CHECKED,
      externalRef: "four-lakes-market",
    },
    {
      slug: "gordon-avenue-market",
      name: "Gordon Avenue Market",
      building: "Gordon Dining & Event Center",
      address: "770 W. Dayton St, Madison, WI",
      kind: "dining_market",
      hours: [
        {
          days: WEEKDAYS,
          periods: [
            { period: "breakfast", open: "07:00", close: "10:00" },
            { period: "lunch", open: "11:00", close: "16:00" },
            { period: "dinner", open: "16:00", close: "20:30" },
          ],
        },
        {
          days: [0, 6],
          periods: [
            { period: "breakfast", open: "09:00", close: "11:00" },
            { period: "lunch", open: "11:00", close: "14:00" },
            { period: "dinner", open: "16:00", close: "20:30" },
          ],
        },
      ],
      hoursSourceUrl: UW_HOURS_URL,
      hoursVerifiedOn: UW_CHECKED,
      externalRef: "gordon-avenue-market",
    },
    {
      slug: "lizs-market",
      name: "Liz's Market",
      building: "Elizabeth Waters Residence Hall",
      address: "1200 Observatory Dr, Madison, WI",
      kind: "dining_market",
      hours: [
        {
          days: WEEKDAYS,
          periods: [
            { period: "breakfast", open: "07:00", close: "10:00" },
            { period: "lunch", open: "11:00", close: "14:00" },
            { period: "dinner", open: "16:00", close: "20:00" },
          ],
        },
        {
          days: [6],
          periods: [
            { period: "breakfast", open: "09:00", close: "11:00" },
            { period: "lunch", open: "11:00", close: "14:00" },
            { period: "dinner", open: "16:00", close: "19:00" },
          ],
        },
      ],
      hoursSourceUrl: UW_HOURS_URL,
      hoursVerifiedOn: UW_CHECKED,
      externalRef: "lizs-market",
    },
    {
      slug: "rhetas-market",
      name: "Rheta's Market",
      building: "Chadbourne Residence Hall",
      address: "420 N. Park St, Madison, WI",
      kind: "dining_market",
      hours: [
        {
          days: WEEKDAYS,
          periods: [
            { period: "breakfast", open: "07:00", close: "11:00" },
            { period: "lunch", open: "11:00", close: "16:00" },
            { period: "dinner", open: "16:00", close: "20:00" },
          ],
        },
        {
          days: [0],
          periods: [
            { period: "lunch", open: "11:00", close: "14:00" },
            { period: "dinner", open: "16:00", close: "20:00" },
          ],
        },
      ],
      hoursSourceUrl: UW_HOURS_URL,
      hoursVerifiedOn: UW_CHECKED,
      externalRef: "rhetas-market",
    },
  ],
};

export const DEMO: CatalogUniversity = {
  id: DEMO_UNIVERSITY.slug,
  slug: DEMO_UNIVERSITY.slug,
  name: DEMO_UNIVERSITY.name,
  shortName: DEMO_UNIVERSITY.shortName,
  city: null,
  state: null,
  timezone: DEMO_UNIVERSITY.timezone,
  websiteUrl: null,
  menuSourceUrl: null,
  nutritionInfoUrl: null,
  integrationStatus: "demo",
  integrationNotes:
    "Fictional campus for trying the app and testing. Its menus are generated from recipes built on USDA data; no real dining hall serves them.",
  provider: "demo",
  providerConfig: {},
  allergenNotice: "Demo data only. Allergen flags are illustrative and must not be relied on.",
  isDemo: true,
  locations: DEMO_HALLS.map((h) => ({
    slug: h.key,
    name: h.name,
    building: h.building,
    address: null,
    kind: "dining_market" as const,
    hours: [0, 1, 2, 3, 4, 5, 6]
      .map((day) => ({
        days: [day],
        periods: h.periods
          .filter((p) => !h.closed?.[p]?.includes(day))
          .map((p) => ({
            period: p,
            open: p === "breakfast" ? "07:00" : p === "lunch" ? "11:00" : "16:30",
            close: p === "breakfast" ? "10:30" : p === "lunch" ? "14:00" : "20:00",
          })),
      }))
      .filter((r) => r.periods.length > 0),
    hoursSourceUrl: null,
    hoursVerifiedOn: null,
    externalRef: h.key,
  })),
};

export function demoEnabled(): boolean {
  const v = process.env.ENABLE_DEMO_UNIVERSITY;
  if (v === "true") return true;
  if (v === "false") return false;
  return process.env.NODE_ENV !== "production";
}

export function catalog(): CatalogUniversity[] {
  return demoEnabled() ? [UW_MADISON, DEMO] : [UW_MADISON];
}
