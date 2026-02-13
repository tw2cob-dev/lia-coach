import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "../../../../lib/auth/supabase";
import { normalizeEmail } from "../../../../lib/auth/validation";

type VerifyUserRow = {
  id: string;
  email_verified_at: string | null;
};

type VerificationCodeRow = {
  id: string;
  expires_at: string | null;
  used_at: string | null;
};

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { email?: string; code?: string };
    const email = normalizeEmail(body.email ?? "");
    const code = (body.code ?? "").trim();

    if (!email || !code) {
      return NextResponse.json({ error: "Faltan datos." }, { status: 400 });
    }

    const { data: userData } = await getSupabaseAdmin()
      .from("users")
      .select("id, email_verified_at")
      .eq("email", email)
      .maybeSingle();
    const user = (userData ?? null) as VerifyUserRow | null;

    if (!user) {
      return NextResponse.json({ error: "Usuario no encontrado." }, { status: 404 });
    }

    const nowIso = new Date().toISOString();
    const { data: codeRowData } = await getSupabaseAdmin()
      .from("email_verification_codes")
      .select("id, expires_at, used_at")
      .eq("user_id", user.id)
      .eq("code", code)
      .is("used_at", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const codeRow = (codeRowData ?? null) as VerificationCodeRow | null;

    if (!codeRow || (codeRow.expires_at && codeRow.expires_at <= nowIso)) {
      return NextResponse.json({ error: "Codigo invalido o expirado." }, { status: 400 });
    }

    await getSupabaseAdmin()
      .from("email_verification_codes")
      .update({ used_at: nowIso })
      .eq("id", codeRow.id);

    if (!user.email_verified_at) {
      await getSupabaseAdmin()
        .from("users")
        .update({ email_verified_at: nowIso })
        .eq("id", user.id);
    }

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Error inesperado." }, { status: 500 });
  }
}

