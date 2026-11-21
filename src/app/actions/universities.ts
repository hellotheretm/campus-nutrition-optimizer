"use server";

import { z } from "zod";
import { getSessionUser } from "@/lib/auth";
import { normalizeKey, submitUniversityRequest, universityRequestSchema, type RequestOutcome } from "@/lib/data/requests";
import { clientFingerprint, rateLimit } from "@/lib/rate-limit";
import { errorMessage, fail, ok, type ActionResult } from "./result";

const antiSpam = z.object({
  /** Honeypot: hidden from people, often filled by bots. */
  company: z.string().max(500).optional(),
  /** When the form was rendered (ms since epoch); instant submissions are bots. */
  startedAt: z.number().optional(),
});

const MIN_FILL_MS = 2500;

const FIELD_LABELS: Record<string, string> = {
  universityName: "the university name",
  city: "the city",
  state: "the state or region",
  country: "the country",
  websiteUrl: "the dining website",
  menuUrl: "the menu page link",
  contactEmail: "your email",
  message: "your message",
};

export async function requestUniversityAction(input: unknown): Promise<ActionResult<RequestOutcome>> {
  try {
    // Validate first so a typo doesn't use up the hourly allowance.
    const parsed = universityRequestSchema.safeParse(input);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const field = FIELD_LABELS[String(issue?.path[0])] ?? "the form";
      return fail(`Please check ${field}: ${issue?.message ?? "it isn't valid"}.`);
    }
    const data = parsed.data;
    const name = data.universityName;

    const fp = await clientFingerprint();
    const burst = await rateLimit(`ureq:${fp}`, 5, 3600);
    if (!burst.ok) return fail("You've sent several requests in the last hour. Please try again later.");

    const spam = antiSpam.safeParse(input);
    const elapsed = spam.success && spam.data.startedAt ? Date.now() - spam.data.startedAt : 0;
    if (!spam.success || spam.data.company || elapsed < MIN_FILL_MS) {
      // Look successful to the bot; store nothing.
      return ok({ kind: "created", name });
    }

    // One supporter per campus per person (by hashed address) per 30 days.
    const once = await rateLimit(`ureqk:${normalizeKey(name)}:${fp}`, 1, 30 * 86400);
    if (!once.ok) return fail("You've already requested this university recently. Thanks, it's counted.");

    const user = await getSessionUser();
    return ok(await submitUniversityRequest(data, user?.id ?? null));
  } catch (e) {
    return fail(errorMessage(e, "Couldn't send your request. Please try again."));
  }
}
