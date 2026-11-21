import { desc } from "drizzle-orm";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { getDb } from "@/db/client";
import { emailOutbox } from "@/db/schema";
import { timeAgo } from "@/lib/dates";

export const metadata: Metadata = { title: "Dev outbox", robots: { index: false } };

/**
 * Local development helper: shows emails that would have been sent when no
 * SMTP server is configured, so sign-up confirmation and password-reset
 * links can be tested. Disabled in production.
 */
export default function OutboxPage() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <h1 className="text-2xl font-semibold">Dev email outbox</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Only available in development when SMTP_URL is not set. Newest first.
      </p>
      <Suspense fallback={<p className="mt-6 text-sm text-muted-foreground">Loading…</p>}>
        <Messages />
      </Suspense>
    </main>
  );
}

function linkify(text: string) {
  const parts = text.split(/(https?:\/\/[^\s]+)/g);
  return parts.map((p, i) =>
    /^https?:\/\//.test(p) ? (
      <a key={i} href={p} className="break-all font-medium text-primary underline underline-offset-4">
        {p}
      </a>
    ) : (
      <span key={i}>{p}</span>
    ),
  );
}

async function Messages() {
  await connection();
  if (process.env.NODE_ENV === "production") notFound();
  const db = await getDb();
  const rows = await db.select().from(emailOutbox).orderBy(desc(emailOutbox.createdAt)).limit(20);
  if (!rows.length) return <p className="mt-6 text-sm text-muted-foreground">No messages yet.</p>;
  return (
    <ul className="mt-6 grid gap-3">
      {rows.map((m) => (
        <li key={m.id} className="rounded-2xl border bg-card p-4">
          <p className="text-xs text-muted-foreground">
            To {m.to} · {timeAgo(m.createdAt)}
          </p>
          <p className="mt-1 font-medium">{m.subject}</p>
          <p className="mt-2 text-sm whitespace-pre-wrap">{linkify(m.text)}</p>
        </li>
      ))}
    </ul>
  );
}
