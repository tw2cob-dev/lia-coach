import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "../../../../lib/auth/supabase";
import { sendVerificationEmail } from "../../../../lib/auth/email";
import { normalizeEmail } from "../../../../lib/auth/validation";

type ResendUserRow = {
  id: string;
  name: string;
  email: string;
  email_verified_at: string | null;
};

function generateCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { email?: string };
    const email = normalizeEmail(body.email ?? "");

    if (!email) {
      return NextResponse.json({ error: "Falta el email." }, { status: 400 });
    }

    const { data: userData } = await getSupabaseAdmin()
      .from("users")
      .select("id, name, email, email_verified_at")
      .eq("email", email)
      .maybeSingle();
    const user = (userData ?? null) as ResendUserRow | null;

    if (!user) {
      return NextResponse.json({ error: "Usuario no encontrado." }, { status: 404 });
    }

    if (user.email_verified_at) {
      return NextResponse.json({ error: "Este email ya esta verificado." }, { status: 409 });
    }

    const code = generateCode();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

    const { error: codeError } = await getSupabaseAdmin().from("email_verification_codes").insert({
      user_id: user.id,
      code,
      expires_at: expiresAt,
    });

    if (codeError) {
      return NextResponse.json({ error: "No se pudo generar el codigo." }, { status: 500 });
    }

    await sendVerificationEmail({ to: user.email, code, name: user.name });
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error inesperado.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
