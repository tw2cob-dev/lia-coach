import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifySessionToken } from "../../../../lib/auth/sessionToken";

export async function GET() {
  const rawToken = (await cookies()).get("lia-auth")?.value ?? "";
  if (!rawToken) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const user = await verifySessionToken(rawToken);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  return NextResponse.json({ ok: true, user });
}
