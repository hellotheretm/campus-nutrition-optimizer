"use client";

import { Download, LoaderCircle, LogOut, MonitorSmartphone, ShieldCheck, TriangleAlert } from "lucide-react";
import { useCallback, useEffect, useState, useTransition, type FormEvent } from "react";
import { toast } from "sonner";
import { Panel } from "@/components/app/page-header";
import { PasswordInput } from "@/components/auth/auth-ui";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authClient } from "@/lib/auth-client";
import { timeAgo } from "@/lib/dates";

interface SessionRow {
  id: string;
  token: string;
  userAgent?: string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
}

function describeAgent(ua: string | null | undefined): string {
  if (!ua) return "Unknown device";
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /Firefox\//.test(ua)
      ? "Firefox"
      : /Chrome\//.test(ua)
        ? "Chrome"
        : /Safari\//.test(ua)
          ? "Safari"
          : "Browser";
  const os = /iPhone|iPad/.test(ua)
    ? "iOS"
    : /Android/.test(ua)
      ? "Android"
      : /Windows/.test(ua)
        ? "Windows"
        : /Mac OS X/.test(ua)
          ? "macOS"
          : /Linux/.test(ua)
            ? "Linux"
            : "unknown system";
  return `${browser} on ${os}`;
}

const CONFIRM_PHRASE = "delete my account";

interface AccountState {
  sessions: SessionRow[];
  currentId: string | null;
  hasPassword: boolean;
}

async function fetchAccountState(): Promise<AccountState> {
  const [list, current, accounts] = await Promise.all([authClient.listSessions(), authClient.getSession(), authClient.listAccounts()]);
  const accs = (accounts.data ?? []) as { providerId: string }[];
  return {
    sessions: ((list.data ?? []) as SessionRow[]).sort((a, b) => +new Date(b.updatedAt) - +new Date(a.updatedAt)),
    currentId: current.data?.session.id ?? null,
    hasPassword: accs.some((a) => a.providerId === "credential"),
  };
}

export function AccountPanel({ email, emailVerified, devOutbox }: { email: string; emailVerified: boolean; devOutbox: boolean }) {
  const [sessions, setSessions] = useState<SessionRow[] | null>(null);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [hasPassword, setHasPassword] = useState<boolean | null>(null);
  const [pending, start] = useTransition();

  const apply = useCallback((s: AccountState) => {
    setSessions(s.sessions);
    setCurrentId(s.currentId);
    setHasPassword(s.hasPassword);
  }, []);

  const load = useCallback(async () => apply(await fetchAccountState()), [apply]);

  useEffect(() => {
    let cancelled = false;
    fetchAccountState().then(
      (s) => {
        if (!cancelled) apply(s);
      },
      () => {
        if (!cancelled) setSessions([]);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [apply]);

  function resendVerification() {
    start(async () => {
      const { error } = await authClient.sendVerificationEmail({ email, callbackURL: "/settings" });
      if (error) return void toast.error(error.message ?? "Couldn't send the email. Try again later.");
      toast.success("Verification email sent", { description: devOutbox ? "In development it appears in the dev outbox (/dev/outbox)." : `Check ${email}.` });
    });
  }

  function revoke(token: string) {
    start(async () => {
      const { error } = await authClient.revokeSession({ token });
      if (error) return void toast.error(error.message ?? "Couldn't sign out that device.");
      toast.success("Signed out that device");
      await load();
    });
  }

  function revokeOthers() {
    start(async () => {
      const { error } = await authClient.revokeOtherSessions();
      if (error) return void toast.error(error.message ?? "Couldn't sign out other devices.");
      toast.success("Signed out everywhere else");
      await load();
    });
  }

  return (
    <div className="grid gap-6">
      <Panel aria-labelledby="account-heading" className="grid gap-4">
        <div>
          <h2 id="account-heading" className="font-semibold">
            Account
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">Your email is used only to sign in and for account messages.</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <span className="font-medium break-all">{email}</span>
          {emailVerified ? (
            <Badge variant="outline" className="gap-1 rounded-full">
              <ShieldCheck className="size-3.5" aria-hidden="true" />
              Verified
            </Badge>
          ) : (
            <>
              <Badge variant="outline" className="rounded-full">
                Not verified
              </Badge>
              <Button size="sm" variant="outline" className="rounded-full" onClick={resendVerification} disabled={pending}>
                Resend verification email
              </Button>
            </>
          )}
        </div>
      </Panel>

      {hasPassword !== false && <ChangePassword />}
      {hasPassword === false && (
        <Panel aria-labelledby="password-heading">
          <h2 id="password-heading" className="font-semibold">
            Password
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">You sign in with Google, so there is no password to change here.</p>
        </Panel>
      )}

      <Panel aria-labelledby="sessions-heading" className="grid gap-4">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 id="sessions-heading" className="font-semibold">
              Signed-in devices
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">Sessions last up to 30 days. Sign out anything you don’t recognize.</p>
          </div>
          <Button
            size="sm"
            variant="outline"
            className="rounded-full"
            onClick={revokeOthers}
            disabled={pending || !sessions || sessions.length < 2}
          >
            <LogOut aria-hidden="true" />
            Sign out everywhere else
          </Button>
        </div>
        {sessions === null ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
            Loading devices…
          </p>
        ) : (
          <ul className="divide-y divide-foreground/[0.07]">
            {sessions.map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-3 py-2.5">
                <div className="flex min-w-0 items-center gap-3">
                  <MonitorSmartphone className="size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">
                      {describeAgent(s.userAgent)}
                      {s.id === currentId && <span className="ml-2 text-xs font-normal text-primary">This device</span>}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Active {timeAgo(new Date(s.updatedAt))} · signed in {timeAgo(new Date(s.createdAt))}
                    </p>
                  </div>
                </div>
                {s.id !== currentId && (
                  <Button size="sm" variant="ghost" className="rounded-full" onClick={() => revoke(s.token)} disabled={pending}>
                    Sign out<span className="sr-only"> {describeAgent(s.userAgent)}</span>
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel aria-labelledby="data-heading" className="grid gap-4">
        <div>
          <h2 id="data-heading" className="font-semibold">
            Your data
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Download everything the app stores about you (profile, diary, favorites, saved meals and plans) as JSON, or delete your account.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline" className="rounded-full">
            <a href="/api/account/export" download>
              <Download aria-hidden="true" />
              Download my data
            </a>
          </Button>
          <DeleteAccount hasPassword={hasPassword !== false} />
        </div>
      </Panel>
    </div>
  );
}

function ChangePassword() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [revokeOthers, setRevokeOthers] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function submit(e: FormEvent) {
    e.preventDefault();
    if (next.length < 10) return setError("Use at least 10 characters for the new password.");
    if (next !== confirm) return setError("The new passwords don’t match.");
    setError(null);
    start(async () => {
      const { error: err } = await authClient.changePassword({ currentPassword: current, newPassword: next, revokeOtherSessions: revokeOthers });
      if (err) return setError(err.message ?? "Couldn't change your password.");
      setCurrent("");
      setNext("");
      setConfirm("");
      toast.success("Password changed");
    });
  }

  return (
    <Panel aria-labelledby="password-heading">
      <form onSubmit={submit} className="grid gap-4" noValidate>
        <div>
          <h2 id="password-heading" className="font-semibold">
            Change password
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">At least 10 characters. A passphrase of a few unrelated words works well.</p>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="grid gap-1.5">
            <Label htmlFor="current-password">Current password</Label>
            <PasswordInput id="current-password" name="current-password" value={current} onChange={setCurrent} autoComplete="current-password" />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="new-password">New password</Label>
            <PasswordInput id="new-password" name="new-password" value={next} onChange={setNext} autoComplete="new-password" minLength={10} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="confirm-password">Repeat new password</Label>
            <PasswordInput id="confirm-password" name="confirm-password" value={confirm} onChange={setConfirm} autoComplete="new-password" />
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Checkbox id="revoke-others" checked={revokeOthers} onCheckedChange={(v) => setRevokeOthers(v === true)} />
          <Label htmlFor="revoke-others" className="font-normal">
            Sign out my other devices
          </Label>
        </div>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <div>
          <Button type="submit" disabled={pending || !current || !next}>
            {pending && <LoaderCircle className="animate-spin" aria-hidden="true" />}
            Change password
          </Button>
        </div>
      </form>
    </Panel>
  );
}

function DeleteAccount({ hasPassword }: { hasPassword: boolean }) {
  const [open, setOpen] = useState(false);
  const [phrase, setPhrase] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const ready = phrase.trim().toLowerCase() === CONFIRM_PHRASE && (!hasPassword || password.length > 0);

  function remove() {
    start(async () => {
      const { error: err } = await authClient.deleteUser({ password: hasPassword ? password : undefined, callbackURL: "/" });
      if (err) {
        return setError(
          err.message ??
            (hasPassword ? "Couldn't delete the account. Check your password." : "For your security, sign out and sign in again, then retry."),
        );
      }
      // A full page load on purpose: it drops every cached page and client state from the deleted session.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.assign("/?deleted=1");
    });
  }

  return (
    <AlertDialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) {
          setPhrase("");
          setPassword("");
          setError(null);
        }
      }}
    >
      <AlertDialogTrigger asChild>
        <Button variant="outline" className="rounded-full text-destructive hover:text-destructive">
          <TriangleAlert aria-hidden="true" />
          Delete account
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete your account permanently?</AlertDialogTitle>
          <AlertDialogDescription>
            This removes your profile, diary, favorites, saved meals and meal plans. It can’t be undone. Download your data first if you
            want a copy.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="delete-phrase">
              Type <span className="font-semibold">{CONFIRM_PHRASE}</span> to confirm
            </Label>
            <Input id="delete-phrase" value={phrase} onChange={(e) => setPhrase(e.target.value)} autoComplete="off" />
          </div>
          {hasPassword && (
            <div className="grid gap-1.5">
              <Label htmlFor="delete-password">Password</Label>
              <PasswordInput id="delete-password" name="delete-password" value={password} onChange={setPassword} autoComplete="current-password" />
            </div>
          )}
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel>Keep my account</AlertDialogCancel>
          <Button variant="destructive" onClick={remove} disabled={!ready || pending}>
            {pending && <LoaderCircle className="animate-spin" aria-hidden="true" />}
            Delete permanently
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
