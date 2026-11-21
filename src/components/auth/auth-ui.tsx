"use client";

import { Eye, EyeOff } from "lucide-react";
import { useId, useState, type ReactNode } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

export function AuthCard({ title, description, children, footer }: { title: string; description?: ReactNode; children: ReactNode; footer?: ReactNode }) {
  return (
    <div className="glass-strong w-full max-w-md rounded-3xl p-6 md:p-8">
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      {description && <p className="mt-1.5 text-sm text-muted-foreground">{description}</p>}
      <div className="mt-6">{children}</div>
      {footer && <div className="mt-6 border-t pt-4 text-center text-sm text-muted-foreground">{footer}</div>}
    </div>
  );
}

export function Field({
  label,
  hint,
  error,
  children,
  htmlFor,
}: {
  label: string;
  hint?: ReactNode;
  error?: string | null;
  children: ReactNode;
  htmlFor: string;
}) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {hint && !error && <p className="text-xs text-muted-foreground" id={`${htmlFor}-hint`}>{hint}</p>}
      {error && (
        <p className="text-xs font-medium text-destructive" id={`${htmlFor}-error`}>
          {error}
        </p>
      )}
    </div>
  );
}

export function PasswordInput({
  id,
  name,
  autoComplete,
  value,
  onChange,
  minLength,
  describedBy,
  invalid,
}: {
  id: string;
  name: string;
  autoComplete: "current-password" | "new-password";
  value: string;
  onChange: (v: string) => void;
  minLength?: number;
  describedBy?: string;
  invalid?: boolean;
}) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <Input
        id={id}
        name={name}
        type={show ? "text" : "password"}
        autoComplete={autoComplete}
        required
        minLength={minLength}
        maxLength={128}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-describedby={describedBy}
        aria-invalid={invalid || undefined}
        className="h-10 pr-10"
      />
      <button
        type="button"
        onClick={() => setShow((s) => !s)}
        className="absolute inset-y-0 right-0 grid w-10 place-items-center rounded-r-lg text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
        aria-label={show ? "Hide password" : "Show password"}
        aria-pressed={show}
      >
        {show ? <EyeOff className="size-4" aria-hidden="true" /> : <Eye className="size-4" aria-hidden="true" />}
      </button>
    </div>
  );
}

export function FormError({ message }: { message: string | null }) {
  const id = useId();
  if (!message) return null;
  return (
    <p id={id} role="alert" className={cn("rounded-xl bg-destructive/10 px-3 py-2 text-sm font-medium text-destructive")}>
      {message}
    </p>
  );
}

export function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-4" aria-hidden="true">
      <path fill="#EA4335" d="M12 10.2v3.9h5.4c-.24 1.4-1.66 4.1-5.4 4.1-3.25 0-5.9-2.7-5.9-6s2.65-6 5.9-6c1.85 0 3.1.8 3.8 1.47l2.6-2.5C16.7 3.6 14.6 2.7 12 2.7 6.95 2.7 2.9 6.8 2.9 12s4.05 9.3 9.1 9.3c5.25 0 8.73-3.7 8.73-8.9 0-.6-.07-1.05-.15-1.5H12Z" />
    </svg>
  );
}

/** Only same-site relative paths are accepted as post-login destinations. */
export function safeNext(raw: string | null | undefined, fallback = "/dashboard"): string {
  if (!raw) return fallback;
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.startsWith("/\\")) return fallback;
  if (raw.startsWith("/login") || raw.startsWith("/signup") || raw.startsWith("/api/")) return fallback;
  return raw;
}

export function authErrorMessage(error: { status?: number; code?: string; message?: string } | null | undefined, fallback: string): string {
  if (!error) return fallback;
  if (error.status === 429) return "Too many attempts. Please wait a minute and try again.";
  switch (error.code) {
    case "INVALID_EMAIL_OR_PASSWORD":
      return "That email and password don't match an account.";
    case "USER_ALREADY_EXISTS":
    case "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL":
      return "An account with this email already exists. Try signing in instead.";
    case "PASSWORD_TOO_SHORT":
      return "Use at least 10 characters.";
    case "PASSWORD_TOO_LONG":
      return "Use at most 128 characters.";
    case "INVALID_TOKEN":
      return "This link has expired or was already used. Request a new one.";
    case "INVALID_EMAIL":
      return "Enter a valid email address.";
    default:
      return error.message || fallback;
  }
}
