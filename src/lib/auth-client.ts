"use client";

import { createAuthClient } from "better-auth/react";

/** Browser auth client. It talks only to this app's /api/auth routes. */
export const authClient = createAuthClient();
