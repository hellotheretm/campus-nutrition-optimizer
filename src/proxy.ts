/**
 * Optimistic route protection: pages with private data redirect to sign-in
 * when no session cookie is present. Every page and action still verifies
 * the session on the server; this only avoids rendering a page shell first.
 */
import { getSessionCookie } from "better-auth/cookies";
import { NextResponse, type NextRequest } from "next/server";

const PROTECTED = ["/dashboard", "/diary", "/history", "/settings", "/admin"];

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  if (!PROTECTED.some((p) => pathname === p || pathname.startsWith(`${p}/`))) return NextResponse.next();
  if (getSessionCookie(request)) return NextResponse.next();
  const url = request.nextUrl.clone();
  url.pathname = "/login";
  url.search = `?next=${encodeURIComponent(pathname + search)}`;
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/dashboard/:path*", "/diary/:path*", "/history/:path*", "/settings/:path*", "/admin/:path*"],
};
