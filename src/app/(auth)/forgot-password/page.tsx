import type { Metadata } from "next";
import { ForgotPasswordForm } from "@/components/auth/password-forms";

export const metadata: Metadata = { title: "Reset your password" };

export default function ForgotPasswordPage() {
  return <ForgotPasswordForm devOutbox={!process.env.SMTP_URL && process.env.NODE_ENV !== "production"} />;
}
