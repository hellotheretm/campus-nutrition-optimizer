import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { exportUserData } from "@/lib/data/user";

/** Downloads everything stored about the signed-in user as JSON. */
export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Sign in to export your data." }, { status: 401 });
  const data = await exportUserData(user.id);
  const body = {
    exportedAt: new Date().toISOString(),
    format: "campus-nutrition-optimizer-export",
    version: 1,
    account: { id: user.id, name: user.name, email: user.email, emailVerified: user.emailVerified },
    ...data,
  };
  const date = new Date().toISOString().slice(0, 10);
  return new NextResponse(JSON.stringify(body, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="campus-nutrition-export-${date}.json"`,
      "Cache-Control": "no-store",
    },
  });
}
