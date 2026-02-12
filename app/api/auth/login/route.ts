import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "../../../../lib/auth/supabase";
import { verifyPassword } from "../../../../lib/auth/password";
import { normalizeEmail } from "../../../../lib/auth/validation";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { email?: string; password?: string };
    const email = normalizeEmail(body.email ?? "");
    const password = body.password ?? "";

    if (!email || !password) {
      return NextResponse.json({ error: "Faltan datos." }, { status: 400 });
    }

    const { data: user } = await getSupabaseAdmin()
      .from("users")
      .select("id, name, email, password_hash, email_verified_at")
      .eq("email", email)
      .maybeSingle();

    if (!user) {
      return NextResponse.json({ error: "Credenciales invalidas." }, { status: 401 });
    }

    if (!user.email_verified_at) {
      return NextResponse.json({ error: "Necesitas verificar tu email." }, { status: 403 });
    }

    const ok = await verifyPassword(password, user.password_hash);
    if (!ok) {
      return NextResponse.json({ error: "Credenciales invalidas." }, { status: 401 });
    }

    return NextResponse.json({ ok: true, user: { id: user.id, name: user.name, email: user.email } });
  } catch (error) {
    return NextResponse.json({ error: "Error inesperado." }, { status: 500 });
  }
}

