import { NextResponse } from "next/server";
import { verifyFirebaseIdToken } from "../../../../lib/auth/firebaseToken";
import { createSessionToken } from "../../../../lib/auth/sessionToken";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { idToken?: string };
    const idToken = body.idToken ?? "";
    if (!idToken.trim()) {
      return NextResponse.json({ error: "Missing idToken." }, { status: 400 });
    }

    const firebaseUser = await verifyFirebaseIdToken(idToken);
    if (!firebaseUser) {
      return NextResponse.json({ error: "Invalid Firebase token." }, { status: 401 });
    }
    if (!firebaseUser.emailVerified) {
      return NextResponse.json({ error: "Email not verified." }, { status: 403 });
    }

    const session = await createSessionToken({
      id: firebaseUser.id,
      email: firebaseUser.email,
      name: firebaseUser.name,
    });

    const response = NextResponse.json({
      ok: true,
      user: { id: firebaseUser.id, email: firebaseUser.email, name: firebaseUser.name ?? "" },
    });
    response.cookies.set("lia-auth", session, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 24 * 30,
    });
    return response;
  } catch {
    return NextResponse.json({ error: "Unexpected error." }, { status: 500 });
  }
}
