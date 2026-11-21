"use server";

import { refresh } from "next/cache";
import { getSessionUser } from "@/lib/auth";
import { saveProfile, type ProfileData } from "@/lib/data/user";
import { errorMessage, fail, ok, type ActionResult } from "./result";

export async function saveProfileAction(input: unknown): Promise<ActionResult<ProfileData>> {
  const user = await getSessionUser();
  if (!user) return fail("Sign in to save your settings.");
  try {
    const profile = await saveProfile(user.id, input);
    refresh();
    return ok(profile, "Settings saved");
  } catch (e) {
    return fail(errorMessage(e, "Couldn't save your settings."));
  }
}
