"use client";

import { AlertTriangle, FileUp, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import type { ImportPreviewView } from "@/lib/menus/admin-import";

const MAX_BYTES = 5 * 1024 * 1024;

export interface ImportUniversity {
  id: string;
  name: string;
  locations: { slug: string; name: string }[];
}

interface Loaded {
  name: string;
  text: string;
  csv: boolean;
}

const EMPTY_SOURCE = { name: "", obtainedFrom: "", permission: "", retrievedAt: "" };

async function post(body: unknown): Promise<{ ok: true; [k: string]: unknown } | { ok: false; error: string }> {
  try {
    const res = await fetch("/api/admin/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) return { ok: false, error: String(data.error ?? `Request failed (${res.status}).`) };
    return { ok: true, ...data };
  } catch {
    return { ok: false, error: "Couldn't reach the server. Check your connection and try again." };
  }
}

export function ImportPanel({ universities }: { universities: ImportUniversity[] }) {
  const router = useRouter();
  const ids = useId();
  const [universityId, setUniversityId] = useState(universities.find((u) => u.locations.length)?.id ?? universities[0]?.id ?? "");
  const [file, setFile] = useState<Loaded | null>(null);
  const [source, setSource] = useState(EMPTY_SOURCE);
  const [preview, setPreview] = useState<ImportPreviewView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"preview" | "commit" | null>(null);
  const uni = universities.find((u) => u.id === universityId);

  function reset() {
    setPreview(null);
    setError(null);
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    reset();
    const f = e.target.files?.[0];
    if (!f) return setFile(null);
    if (f.size > MAX_BYTES) {
      setFile(null);
      setError("That file is larger than 5 MB. Split it by date range.");
      return;
    }
    const text = await f.text();
    setFile({ name: f.name, text, csv: /\.csv$/i.test(f.name) || !text.trimStart().startsWith("{") });
  }

  function body(mode: "preview" | "commit") {
    return {
      mode,
      universityId,
      fileName: file!.name,
      text: file!.text,
      source: file!.csv ? { ...source, retrievedAt: source.retrievedAt || undefined } : undefined,
    };
  }

  async function runPreview() {
    if (!file) return;
    if (file.csv && (!source.name.trim() || !source.obtainedFrom.trim() || !source.permission.trim())) {
      setError("For CSV files, fill in the data source, where it came from, and who approved its use.");
      return;
    }
    setBusy("preview");
    setError(null);
    const r = await post(body("preview"));
    setBusy(null);
    if (!r.ok) return setError(r.error);
    setPreview(r.preview as ImportPreviewView);
  }

  async function runCommit() {
    if (!file || !preview?.ok) return;
    setBusy("commit");
    const r = await post(body("commit"));
    setBusy(null);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    toast.success(String(r.message));
    setPreview(null);
    setFile(null);
    setSource(EMPTY_SOURCE);
    router.refresh();
  }

  return (
    <div className="grid gap-5">
      <div className="grid gap-4 md:grid-cols-2">
        <div className="grid gap-2">
          <Label htmlFor={`${ids}-uni`}>University</Label>
          <Select
            value={universityId}
            onValueChange={(v) => {
              setUniversityId(v);
              reset();
            }}
          >
            <SelectTrigger id={`${ids}-uni`} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {universities.map((u) => (
                <SelectItem key={u.id} value={u.id}>
                  {u.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-2">
          <Label htmlFor={`${ids}-file`}>Menu file (JSON or CSV, up to 5 MB)</Label>
          <Input id={`${ids}-file`} type="file" accept=".json,.csv,application/json,text/csv" onChange={onFile} />
        </div>
      </div>

      {uni && (
        <p className="text-xs text-muted-foreground">
          Location identifiers for {uni.name}:{" "}
          {uni.locations.length
            ? uni.locations.map((l, i) => (
                <span key={l.slug}>
                  {i > 0 && ", "}
                  <code className="rounded bg-muted px-1 py-0.5" title={l.name}>
                    {l.slug}
                  </code>
                </span>
              ))
            : "none yet"}
          . Days for any other location are skipped with a warning.
        </p>
      )}

      {file?.csv && (
        <fieldset className="grid gap-3 rounded-2xl border border-border/70 p-4">
          <legend className="px-1 text-sm font-medium">Where this CSV came from (required)</legend>
          <div className="grid gap-3 md:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor={`${ids}-sname`}>Data source</Label>
              <Input id={`${ids}-sname`} value={source.name} maxLength={200} placeholder="e.g. Dining services menu export" onChange={(e) => setSource({ ...source, name: e.target.value })} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor={`${ids}-sdate`}>Retrieved on (optional)</Label>
              <Input id={`${ids}-sdate`} type="date" value={source.retrievedAt} onChange={(e) => setSource({ ...source, retrievedAt: e.target.value })} />
            </div>
          </div>
          <div className="grid gap-2">
            <Label htmlFor={`${ids}-sfrom`}>Obtained from</Label>
            <Input id={`${ids}-sfrom`} value={source.obtainedFrom} maxLength={500} placeholder="Who sent it, or where it was downloaded" onChange={(e) => setSource({ ...source, obtainedFrom: e.target.value })} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor={`${ids}-sperm`}>Permission</Label>
            <Textarea id={`${ids}-sperm`} value={source.permission} maxLength={1000} rows={2} placeholder="Who approved this use of the data, and when" onChange={(e) => setSource({ ...source, permission: e.target.value })} />
          </div>
        </fieldset>
      )}

      {error && (
        <p role="alert" className="flex items-start gap-2 rounded-xl bg-destructive/10 px-3 py-2 text-sm text-destructive">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          {error}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <Button variant="outline" disabled={!file || busy !== null} onClick={runPreview}>
          {busy === "preview" ? <Loader2 className="animate-spin" aria-hidden="true" /> : <FileUp aria-hidden="true" />}
          Check file
        </Button>
        <Button disabled={!preview?.ok || busy !== null} onClick={runCommit}>
          {busy === "commit" && <Loader2 className="animate-spin" aria-hidden="true" />}
          {preview?.ok ? `Import ${preview.summary.days} menus` : "Import"}
        </Button>
      </div>

      {preview && <PreviewView preview={preview} />}
    </div>
  );
}

function PreviewView({ preview }: { preview: ImportPreviewView }) {
  const s = preview.summary;
  const coverage = Object.entries(s.nutrientCoverage).sort((a, b) => b[1] - a[1]);
  return (
    <section aria-label="Import check results" className="grid gap-4 rounded-2xl bg-background/50 p-4 ring-1 ring-border/60" aria-live="polite">
      <p className="text-sm font-medium">
        {preview.ok ? "The file is valid. Nothing has been saved yet." : "The file has problems. Fix them and check again; nothing was saved."}
      </p>
      {preview.source && (
        <p className="text-xs text-muted-foreground">
          Source: {preview.source.name} · from {preview.source.obtainedFrom} · permission: {preview.source.permission}
        </p>
      )}
      <dl className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
        <Stat term="Menus" value={`${s.days} (${s.closedDays} closed)`} />
        <Stat term="Items" value={String(s.items)} />
        <Stat term="Dates" value={s.dateFrom ? `${s.dateFrom} to ${s.dateTo}` : "–"} />
        <Stat term="Locations" value={s.locations.join(", ") || "–"} />
      </dl>
      {coverage.length > 0 && (
        <p className="text-xs text-muted-foreground">
          Published nutrients (items with a value): {coverage.slice(0, 12).map(([k, n]) => `${k} ${n}`).join(" · ")}
        </p>
      )}
      {preview.errors.length > 0 && <Issues title="Errors" items={preview.errors} tone="error" />}
      {preview.warnings.length > 0 && <Issues title="Warnings" items={preview.warnings} tone="warn" />}
      {preview.sample.length > 0 && (
        <Table>
          <caption className="sr-only">First menus in the file</caption>
          <TableHeader>
            <TableRow>
              <TableHead>Location</TableHead>
              <TableHead>Date</TableHead>
              <TableHead>Meal</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Items</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {preview.sample.map((d) => (
              <TableRow key={`${d.location}|${d.date}|${d.period}`}>
                <TableCell>{d.location}</TableCell>
                <TableCell>{d.date}</TableCell>
                <TableCell>{d.period.replace("_", " ")}</TableCell>
                <TableCell>{d.status}</TableCell>
                <TableCell className="text-right tabular-nums">{d.items}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </section>
  );
}

function Stat({ term, value }: { term: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{term}</dt>
      <dd className="font-medium break-words">{value}</dd>
    </div>
  );
}

function Issues({ title, items, tone }: { title: string; items: string[]; tone: "error" | "warn" }) {
  return (
    <div>
      <h3 className={tone === "error" ? "text-sm font-semibold text-destructive" : "text-sm font-semibold"}>
        {title} ({items.length}
        {items.length >= 50 ? "+" : ""})
      </h3>
      <ul className="mt-1 max-h-48 list-disc space-y-0.5 overflow-auto pl-5 text-xs text-muted-foreground">
        {items.map((m, i) => (
          <li key={i}>{m}</li>
        ))}
      </ul>
    </div>
  );
}
