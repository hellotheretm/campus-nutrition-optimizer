"use client";

import { LoaderCircle } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { authClient } from "@/lib/auth-client";
import { AuthCard, Field, FormError, GoogleIcon, PasswordInput, authErrorMessage, safeNext } from "./auth-ui";

export function SignupForm({ google, devOutbox }: { google: boolean; devOutbox: boolean }) {
  const router = useRouter();
  const params = useSearchParams();
  const next = safeNext(params.get("next"));
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const tooShort = password.length > 0 && password.length < 10;

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    if (password.length < 10) {
      setError("Use a password with at least 10 characters.");
      return;
    }
    start(async () => {
      const { error } = await authClient.signUp.email({
        email: email.trim(),
        password,
        name: name.trim(),
        callbackURL: next,
      });
      if (error) {
        setError(authErrorMessage(error, "Couldn't create your account. Please try again."));
        return;
      }
      toast.success("Account created", {
        description: devOutbox
          ? "We also queued an email-confirmation link (see the dev outbox)."
          : "We sent a link to confirm your email address.",
      });
      router.push(next === "/dashboard" ? "/settings?welcome=1" : next);
      router.refresh();
    });
  }

  function onGoogle() {
    start(async () => {
      const { error } = await authClient.signIn.social({ provider: "google", callbackURL: next });
      if (error) setError(authErrorMessage(error, "Google sign-in isn't available right now."));
    });
  }

  return (
    <AuthCard
      title="Create your account"
      description="An account keeps your diary, saved meals and preferences private to you."
      footer={
        <>
          Already have an account?{" "}
          <Link href="/login" className="font-medium text-primary underline-offset-4 hover:underline">
            Sign in
          </Link>
        </>
      }
    >
      <form onSubmit={onSubmit} className="grid gap-4">
        <FormError message={error} />
        <Field label="Name (optional)" htmlFor="name" hint="Only used to greet you. A nickname is fine.">
          <Input id="name" name="name" autoComplete="nickname" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} className="h-10" aria-describedby="name-hint" />
        </Field>
        <Field label="Email" htmlFor="email">
          <Input id="email" name="email" type="email" autoComplete="email" inputMode="email" required value={email} onChange={(e) => setEmail(e.target.value)} className="h-10" />
        </Field>
        <Field
          label="Password"
          htmlFor="password"
          hint="At least 10 characters. A short phrase is easier to remember."
          error={tooShort ? `${10 - password.length} more character${10 - password.length === 1 ? "" : "s"} needed.` : null}
        >
          <PasswordInput
            id="password"
            name="password"
            autoComplete="new-password"
            minLength={10}
            value={password}
            onChange={setPassword}
            describedBy={tooShort ? "password-error" : "password-hint"}
            invalid={tooShort}
          />
        </Field>
        <p className="text-xs text-muted-foreground">
          We only ask for what the app needs. Nutrition information here is general guidance, not medical advice.
        </p>
        <Button type="submit" size="lg" className="h-11 rounded-xl" disabled={pending}>
          {pending && <LoaderCircle className="animate-spin" aria-hidden="true" />}
          Create account
        </Button>
        {google && (
          <Button type="button" variant="outline" size="lg" className="h-11 rounded-xl" onClick={onGoogle} disabled={pending}>
            <GoogleIcon />
            Continue with Google
          </Button>
        )}
      </form>
    </AuthCard>
  );
}
