import type { Metadata } from "next";
import { Suspense } from "react";
import { AuthCardSkeleton } from "@/components/auth/auth-skeleton";
import { SignupForm } from "@/components/auth/signup-form";
import { googleEnabled } from "@/lib/auth";

export const metadata: Metadata = { title: "Create an account" };

export default function SignupPage() {
  return (
    <Suspense fallback={<AuthCardSkeleton />}>
      <SignupForm google={googleEnabled()} devOutbox={!process.env.SMTP_URL && process.env.NODE_ENV !== "production"} />
    </Suspense>
  );
}
