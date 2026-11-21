"use client";

import { CheckCircle2, Loader2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import { requestUniversityAction } from "@/app/actions/universities";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { RequestOutcome } from "@/lib/data/requests";

const EMPTY = { universityName: "", city: "", state: "", country: "", websiteUrl: "", menuUrl: "", contactEmail: "", message: "" };
type Fields = typeof EMPTY;

export function RequestUniversityForm() {
  const [fields, setFields] = useState<Fields>(EMPTY);
  const [company, setCompany] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<RequestOutcome | null>(null);
  const [pending, startTransition] = useTransition();
  const startedAt = useRef(0);
  const resultRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    startedAt.current = Date.now();
  }, []);

  useEffect(() => {
    if (outcome) resultRef.current?.focus();
  }, [outcome]);

  const set = (k: keyof Fields) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setFields((f) => ({ ...f, [k]: e.target.value }));

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (fields.universityName.trim().length < 3) {
      setError("Enter the university's name.");
      return;
    }
    startTransition(async () => {
      const r = await requestUniversityAction({ ...fields, company, startedAt: startedAt.current });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setOutcome(r.data);
    });
  }

  if (outcome) {
    return (
      <div ref={resultRef} tabIndex={-1} role="status" className="flex flex-col items-start gap-3 outline-none">
        <CheckCircle2 className="size-8 text-conf-high" aria-hidden="true" />
        {outcome.kind === "exists" ? (
          <>
            <h2 className="text-lg font-semibold">{outcome.name} is already listed</h2>
            <p className="text-sm text-muted-foreground">
              The Universities page shows where its menu data stands and links to its official menus.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button asChild>
                <Link href="/universities">See its status</Link>
              </Button>
              <Button asChild variant="outline">
                <Link href={`/menus?u=${outcome.slug}`}>Open its menus</Link>
              </Button>
            </div>
          </>
        ) : (
          <>
            <h2 className="text-lg font-semibold">Thanks, your request is in</h2>
            <p className="text-sm text-muted-foreground">
              {outcome.kind === "supported"
                ? `${outcome.supporters} people have now asked for ${outcome.name}. Requests with more support are reviewed first.`
                : `We've recorded ${outcome.name}. We'll look into where its dining menus are published and how they can be used.`}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button asChild variant="outline">
                <Link href="/universities">See supported campuses</Link>
              </Button>
              <Button
                variant="ghost"
                onClick={() => {
                  setFields(EMPTY);
                  setOutcome(null);
                  startedAt.current = Date.now();
                }}
              >
                Request another
              </Button>
            </div>
          </>
        )}
      </div>
    );
  }

  return (
    <form onSubmit={submit} noValidate className="grid gap-5" aria-describedby={error ? "request-error" : undefined}>
      <div className="grid gap-2">
        <Label htmlFor="universityName">
          University name <span className="text-primary">(required)</span>
        </Label>
        <Input
          id="universityName"
          value={fields.universityName}
          onChange={set("universityName")}
          required
          aria-required="true"
          maxLength={160}
          autoComplete="organization"
          placeholder="e.g. University of Minnesota Twin Cities"
          aria-invalid={Boolean(error && fields.universityName.trim().length < 3)}
        />
      </div>

      <fieldset className="grid gap-3 sm:grid-cols-3">
        <legend className="mb-2 text-sm font-medium">Location (optional)</legend>
        <Field id="city" label="City" value={fields.city} onChange={set("city")} max={80} autoComplete="address-level2" />
        <Field id="state" label="State or region" value={fields.state} onChange={set("state")} max={80} autoComplete="address-level1" />
        <Field id="country" label="Country" value={fields.country} onChange={set("country")} max={80} autoComplete="country-name" />
      </fieldset>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field id="websiteUrl" label="Dining website (optional)" type="url" value={fields.websiteUrl} onChange={set("websiteUrl")} max={500} placeholder="https://" />
        <Field id="menuUrl" label="Online menu page (optional)" type="url" value={fields.menuUrl} onChange={set("menuUrl")} max={500} placeholder="https://" />
      </div>

      <div className="grid gap-2">
        <Label htmlFor="contactEmail">Your email (optional)</Label>
        <Input
          id="contactEmail"
          type="email"
          value={fields.contactEmail}
          onChange={set("contactEmail")}
          maxLength={200}
          autoComplete="email"
          aria-describedby="contactEmail-hint"
        />
        <p id="contactEmail-hint" className="text-xs text-muted-foreground">
          Only if you&apos;d like a note when your campus is added. It&apos;s visible to site administrators only and never shared or
          used for marketing.
        </p>
      </div>

      <div className="grid gap-2">
        <Label htmlFor="message">Anything else? (optional)</Label>
        <Textarea id="message" value={fields.message} onChange={set("message")} maxLength={1000} rows={3} />
      </div>

      {/* Honeypot: hidden from people and assistive technology; bots tend to fill it. */}
      <div aria-hidden="true" className="absolute -left-[10000px] h-px w-px overflow-hidden">
        <label htmlFor="company">Company</label>
        <input id="company" name="company" tabIndex={-1} autoComplete="off" value={company} onChange={(e) => setCompany(e.target.value)} />
      </div>

      {error && (
        <p id="request-error" role="alert" className="rounded-xl bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending && <Loader2 className="animate-spin" aria-hidden="true" />}
          {pending ? "Sending…" : "Send request"}
        </Button>
        <p className="text-xs text-muted-foreground">No account needed.</p>
      </div>
    </form>
  );
}

function Field({
  id,
  label,
  value,
  onChange,
  max,
  type = "text",
  placeholder,
  autoComplete,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  max: number;
  type?: string;
  placeholder?: string;
  autoComplete?: string;
}) {
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} type={type} value={value} onChange={onChange} maxLength={max} placeholder={placeholder} autoComplete={autoComplete} />
    </div>
  );
}
