"use client";

import { LoaderCircle } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { authClient } from "@/lib/auth-client";
import { AuthCard, Field, FormError, GoogleIcon, PasswordInput, authErrorMessage, safeNext } from "./auth-ui";

export function LoginForm({ google }: { google: boolean }) {
  const router = useRouter();
  const params = useSearchParams();
  const next = safeNext(params.get("next"));
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    start(async () => {
      const { error } = await authClient.signIn.email({ email: email.trim(), password });
      if (error) {
        setError(authErrorMessage(error, "Couldn't sign you in. Please try again."));
        return;
      }
      router.push(next);
      router.refresh();
    });
  }

  function onGoogle() {
    setError(null);
    start(async () => {
      const { error } = await authClient.signIn.social({ provider: "google", callbackURL: next });
      if (error) setError(authErrorMessage(error, "Google sign-in isn't available right now."));
    });
  }

  return (
    <AuthCard
      title="Welcome back"
      description="Sign in to keep your food diary, saved meals and preferences."
      footer={
        <>
          New here?{" "}
          <Link href={`/signup${next !== "/dashboard" ? `?next=${encodeURIComponent(next)}` : ""}`} className="font-medium text-primary underline-offset-4 hover:underline">
            Create an account
          </Link>
          <span className="mt-2 block text-xs">
            You can browse menus and try the optimizer without an account.
          </span>
        </>
      }
    >
      <form onSubmit={onSubmit} className="grid gap-4" noValidate={false}>
        <FormError message={error} />
        <Field label="Email" htmlFor="email">
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            inputMode="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="h-10"
          />
        </Field>
        <Field label="Password" htmlFor="password">
          <PasswordInput id="password" name="password" autoComplete="current-password" value={password} onChange={setPassword} />
        </Field>
        <div className="-mt-1 text-right">
          <Link href="/forgot-password" className="text-sm font-medium text-primary underline-offset-4 hover:underline">
            Forgot password?
          </Link>
        </div>
        <Button type="submit" size="lg" className="h-11 rounded-xl" disabled={pending}>
          {pending && <LoaderCircle className="animate-spin" aria-hidden="true" />}
          Sign in
        </Button>
        {google && (
          <>
            <div className="flex items-center gap-3 text-xs text-muted-foreground" aria-hidden="true">
              <span className="h-px flex-1 bg-border" />
              or
              <span className="h-px flex-1 bg-border" />
            </div>
            <Button type="button" variant="outline" size="lg" className="h-11 rounded-xl" onClick={onGoogle} disabled={pending}>
              <GoogleIcon />
              Continue with Google
            </Button>
          </>
        )}
      </form>
    </AuthCard>
  );
}
