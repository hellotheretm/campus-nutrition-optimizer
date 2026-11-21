/**
 * Outgoing email (password reset, address verification).
 *
 * With SMTP_URL set, mail goes through nodemailer. Without it, messages are
 * written to the email_outbox table (and, in development, printed to the
 * server console) so the flows can be tested locally without an email
 * provider. Messages contain links only — never passwords.
 */
import nodemailer, { type Transporter } from "nodemailer";
import { getDb, newId } from "@/db/client";
import { emailOutbox } from "@/db/schema";

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

let transport: Transporter | null = null;

export async function sendMail(msg: MailMessage): Promise<void> {
  const smtp = process.env.SMTP_URL;
  if (smtp) {
    transport ??= nodemailer.createTransport(smtp);
    await transport.sendMail({
      from: process.env.MAIL_FROM || "Campus Nutrition Optimizer <no-reply@localhost>",
      to: msg.to,
      subject: msg.subject,
      text: msg.text,
      html: msg.html,
    });
    return;
  }
  const db = await getDb();
  await db.insert(emailOutbox).values({
    id: newId("mail"),
    to: msg.to,
    subject: msg.subject,
    text: msg.text,
    html: msg.html ?? null,
  });
  if (process.env.NODE_ENV !== "production") {
    console.info(`\n[dev mail outbox] To: ${msg.to}\nSubject: ${msg.subject}\n${msg.text}\n`);
  } else {
    console.warn("[mail] SMTP_URL is not configured; the message was stored in email_outbox only.");
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

function layout(title: string, body: string, url: string, button: string): string {
  return `<!doctype html><html><body style="font-family:system-ui,sans-serif;background:#f5f5f5;padding:24px;color:#1f1f1f">
<div style="max-width:520px;margin:auto;background:#fff;border-radius:16px;padding:28px">
<h1 style="font-size:20px;margin:0 0 12px">${escapeHtml(title)}</h1>
<p style="line-height:1.5">${escapeHtml(body)}</p>
<p><a href="${escapeHtml(url)}" style="display:inline-block;background:#c5050c;color:#fff;padding:12px 18px;border-radius:999px;text-decoration:none">${escapeHtml(button)}</a></p>
<p style="font-size:12px;color:#555">If you didn't ask for this, you can ignore this email.</p>
</div></body></html>`;
}

export function passwordResetEmail(to: string, url: string): MailMessage {
  const body = "Someone (hopefully you) asked to reset the password for your Campus Nutrition Optimizer account. The link works for one hour.";
  return {
    to,
    subject: "Reset your password",
    text: `${body}\n\nReset your password: ${url}\n\nIf you didn't ask for this, you can ignore this email.`,
    html: layout("Reset your password", body, url, "Choose a new password"),
  };
}

export function verificationEmail(to: string, url: string): MailMessage {
  const body = "Confirm this email address for your Campus Nutrition Optimizer account.";
  return {
    to,
    subject: "Confirm your email address",
    text: `${body}\n\nConfirm: ${url}`,
    html: layout("Confirm your email", body, url, "Confirm email"),
  };
}
