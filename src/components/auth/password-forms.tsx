"use client";

import { LoaderCircle, MailCheck } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { authClient } from "@/lib/auth-client";
import { AuthCard, Field, FormError, PasswordInput, authErrorMessage } from "./auth-ui";

export function ForgotPasswordForm({ devOutbox }: { devOutbox: boolean }) {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    start(async () => {
      const { error } = await authClient.requestPasswordReset({ email: email.trim(), redirectTo: "/reset-password" });
      // The response is the same whether or not the account exists.
      if (error && error.status === 429) {
        setError(authErrorMessage(error, ""));
        return;
      }
      setSent(true);
    });
  }

  if (sent) {
    return (
      <AuthCard
        title="Check your email"
        description="If an account exists for that address, a reset link is on its way. The link works for one hour."
        footer={<Link href="/login" className="font-medium text-primary underline-offset-4 hover:underline">Back to sign in</Link>}
      >
        <div className="flex items-start gap-3 rounded-2xl bg-primary/5 p-4 text-sm">
          <MailCheck className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden="true" />
          <p>
            Didn&apos;t get it? Check your spam folder, or try again in a few minutes.
            {devOutbox && (
              <>
                {" "}
                Running locally without email? Open the{" "}
                <Link href="/dev/outbox" className="font-medium text-primary underline-offset-4 hover:underline">
                  dev outbox
                </Link>
                .
              </>
            )}
          </p>
        </div>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title="Reset your password"
      description="Enter the email you signed up with and we'll send you a reset link."
      footer={<Link href="/login" className="font-medium text-primary underline-offset-4 hover:underline">Back to sign in</Link>}
    >
      <form onSubmit={onSubmit} className="grid gap-4">
        <FormError message={error} />
        <Field label="Email" htmlFor="email">
          <Input id="email" name="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} className="h-10" />
        </Field>
        <Button type="submit" size="lg" className="h-11 rounded-xl" disabled={pending}>
          {pending && <LoaderCircle className="animate-spin" aria-hidden="true" />}
          Send reset link
        </Button>
      </form>
    </AuthCard>
  );
}

export function ResetPasswordForm() {
  const router = useRouter();
  const params = useSearchParams();
  const token = params.get("token");
  const linkError = params.get("error");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  if (!token || linkError) {
    return (
      <AuthCard
        title="This link doesn't work"
        description="Reset links expire after an hour and can only be used once."
        footer={<Link href="/login" className="font-medium text-primary underline-offset-4 hover:underline">Back to sign in</Link>}
      >
        <Button asChild size="lg" className="h-11 w-full rounded-xl">
          <Link href="/forgot-password">Request a new link</Link>
        </Button>
      </AuthCard>
    );
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    if (password.length < 10) return setError("Use at least 10 characters.");
    if (password !== confirm) return setError("The two passwords don't match.");
    start(async () => {
      const { error } = await authClient.resetPassword({ newPassword: password, token: token! });
      if (error) {
        setError(authErrorMessage(error, "Couldn't reset your password. Request a new link and try again."));
        return;
      }
      toast.success("Password updated", { description: "Sign in with your new password. Other devices were signed out." });
      router.push("/login");
    });
  }

  return (
    <AuthCard title="Choose a new password" description="For your security, this signs you out on other devices.">
      <form onSubmit={onSubmit} className="grid gap-4">
        <FormError message={error} />
        <Field label="New password" htmlFor="password" hint="At least 10 characters.">
          <PasswordInput id="password" name="password" autoComplete="new-password" minLength={10} value={password} onChange={setPassword} describedBy="password-hint" />
        </Field>
        <Field label="Confirm new password" htmlFor="confirm">
          <PasswordInput id="confirm" name="confirm" autoComplete="new-password" minLength={10} value={confirm} onChange={setConfirm} />
        </Field>
        <Button type="submit" size="lg" className="h-11 rounded-xl" disabled={pending}>
          {pending && <LoaderCircle className="animate-spin" aria-hidden="true" />}
          Update password
        </Button>
      </form>
    </AuthCard>
  );
}
