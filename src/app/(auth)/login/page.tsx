import type { Metadata } from "next";
import { Suspense } from "react";
import { AuthCardSkeleton } from "@/components/auth/auth-skeleton";
import { LoginForm } from "@/components/auth/login-form";
import { googleEnabled } from "@/lib/auth";

export const metadata: Metadata = { title: "Sign in" };

export default function LoginPage() {
  return (
    <Suspense fallback={<AuthCardSkeleton />}>
      <LoginForm google={googleEnabled()} />
    </Suspense>
  );
}
