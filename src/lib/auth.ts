/**
 * Authentication (Better Auth): email + password with verification and
 * reset emails, optional Google sign-in, database sessions, account deletion.
 *
 * Secrets stay on the server: BETTER_AUTH_SECRET, GOOGLE_CLIENT_SECRET and
 * database credentials are only read here and in src/db/client.ts.
 */
import "server-only";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { cache } from "react";
import { connection } from "next/server";
import { redirect } from "next/navigation";
import { getDb, type Db } from "@/db/client";
import { authSchema, universityRequests } from "@/db/schema";
import { passwordResetEmail, sendMail, verificationEmail } from "@/lib/mail";

function devSecret(): string | undefined {
  if (process.env.BETTER_AUTH_SECRET) return process.env.BETTER_AUTH_SECRET;
  if (process.env.NODE_ENV === "production") return undefined; // Better Auth refuses to start without one.
  return "development-only-secret-do-not-use-in-production-0001";
}

export function googleEnabled(): boolean {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

function createAuth(db: Db) {
  return betterAuth({
    appName: "Campus Nutrition Optimizer",
    baseURL: process.env.BETTER_AUTH_URL,
    secret: devSecret(),
    database: drizzleAdapter(db, { provider: "pg", schema: authSchema }),
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 10,
      maxPasswordLength: 128,
      autoSignIn: true,
      revokeSessionsOnPasswordReset: true,
      resetPasswordTokenExpiresIn: 60 * 60,
      sendResetPassword: async ({ user, url }) => {
        await sendMail(passwordResetEmail(user.email, url));
      },
    },
    emailVerification: {
      sendOnSignUp: true,
      autoSignInAfterVerification: true,
      sendVerificationEmail: async ({ user, url }) => {
        await sendMail(verificationEmail(user.email, url));
      },
    },
    socialProviders: googleEnabled()
      ? {
          google: {
            clientId: process.env.GOOGLE_CLIENT_ID as string,
            clientSecret: process.env.GOOGLE_CLIENT_SECRET as string,
          },
        }
      : undefined,
    user: {
      deleteUser: {
        enabled: true,
        afterDelete: async (user) => {
          // Private data is removed by ON DELETE CASCADE; also detach any university requests.
          await db
            .update(universityRequests)
            .set({ requesterUserId: null })
            .where(eq(universityRequests.requesterUserId, user.id));
        },
      },
    },
    session: {
      expiresIn: 60 * 60 * 24 * 30,
      updateAge: 60 * 60 * 24,
    },
    rateLimit: {
      enabled: true,
      window: 60,
      max: 60,
      customRules: {
        "/sign-in/email": { window: 60, max: 8 },
        "/sign-up/email": { window: 300, max: 5 },
        "/request-password-reset": { window: 600, max: 4 },
        "/forget-password": { window: 600, max: 4 },
        "/send-verification-email": { window: 600, max: 4 },
      },
    },
    plugins: [nextCookies()],
  });
}

export type Auth = ReturnType<typeof createAuth>;

const g = globalThis as unknown as { __cnoAuth?: Promise<Auth> };

export function getAuth(): Promise<Auth> {
  if (!g.__cnoAuth) {
    g.__cnoAuth = getDb()
      .then(createAuth)
      .catch((err) => {
        g.__cnoAuth = undefined;
        throw err;
      });
  }
  return g.__cnoAuth;
}

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  image?: string | null;
}

/**
 * The signed-in user for this request, or null. Request-time only; memoized
 * per request so several components can ask without repeating the lookup.
 */
export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  await connection();
  const auth = await getAuth();
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return null;
  const u = session.user;
  return { id: u.id, name: u.name, email: u.email, emailVerified: u.emailVerified, image: u.image };
});

/** Redirects to sign-in when there is no session. */
export async function requireUser(next = "/dashboard"): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(next)}`);
  return user;
}

/**
 * Administrators are listed in ADMIN_EMAILS (comma-separated) and must have
 * verified that email address, so nobody can claim an admin address by
 * signing up with it first.
 */
export function isAdmin(user: SessionUser | null): boolean {
  if (!user || !user.emailVerified) return false;
  const admins = (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return admins.includes(user.email.toLowerCase());
}
