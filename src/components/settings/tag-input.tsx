"use client";

import { X } from "lucide-react";
import { useState } from "react";
import { Label } from "@/components/ui/label";

/** Free-text list input: Enter or comma adds a term, Backspace on empty removes the last one. */
export function TagInput({
  id,
  label,
  hint,
  values,
  onChange,
  placeholder,
  max = 30,
}: {
  id: string;
  label: string;
  hint?: string;
  values: string[];
  onChange: (values: string[]) => void;
  placeholder?: string;
  max?: number;
}) {
  const [draft, setDraft] = useState("");

  function add(raw: string) {
    const parts = raw
      .split(",")
      .map((t) => t.trim().replace(/\s+/g, " "))
      .filter(Boolean);
    if (!parts.length) return;
    const next = [...values];
    for (const t of parts) {
      if (t.length > 60 || next.length >= max) continue;
      if (!next.some((v) => v.toLowerCase() === t.toLowerCase())) next.push(t);
    }
    onChange(next);
    setDraft("");
  }

  return (
    <div className="grid min-w-0 gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {hint && (
        <p id={`${id}-hint`} className="text-xs text-muted-foreground">
          {hint}
        </p>
      )}
      <div className="flex min-h-10 flex-wrap items-center gap-1.5 rounded-xl border border-input bg-background/60 p-1.5 focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50">
        {values.map((v) => (
          <span key={v} className="inline-flex items-center gap-1 rounded-full bg-muted py-1 pr-1 pl-2.5 text-xs">
            {v}
            <button
              type="button"
              onClick={() => onChange(values.filter((x) => x !== v))}
              aria-label={`Remove ${v}`}
              className="rounded-full p-0.5 hover:bg-foreground/10 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
              <X className="size-3" aria-hidden="true" />
            </button>
          </span>
        ))}
        <input
          id={id}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === ",") {
              e.preventDefault();
              add(draft);
            } else if (e.key === "Backspace" && !draft && values.length) {
              onChange(values.slice(0, -1));
            }
          }}
          onBlur={() => add(draft)}
          placeholder={values.length >= max ? "List is full" : placeholder}
          disabled={values.length >= max}
          aria-describedby={hint ? `${id}-hint` : undefined}
          className="w-0 min-w-28 flex-1 bg-transparent px-2 py-1 text-sm outline-none placeholder:text-muted-foreground"
        />
      </div>
    </div>
  );
}
