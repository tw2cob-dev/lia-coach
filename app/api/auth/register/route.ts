import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "../../../../lib/auth/supabase";
import { sendVerificationEmail } from "../../../../lib/auth/email";
import { hashPassword } from "../../../../lib/auth/password";
import { isValidEmail, isValidPassword, normalizeEmail } from "../../../../lib/auth/validation";

function generateCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      name?: string;
      email?: string;
      password?: string;
    };

    const name = (body.name ?? "").trim();
    const email = normalizeEmail(body.email ?? "");
    const password = body.password ?? "";

    if (!name || !email || !password) {
      return NextResponse.json({ error: "Faltan datos." }, { status: 400 });
    }
    if (!isValidEmail(email)) {
      return NextResponse.json({ error: "Email invalido." }, { status: 400 });
    }
    if (!isValidPassword(password)) {
      return NextResponse.json({ error: "La contraseña debe tener al menos 6 caracteres." }, { status: 400 });
    }

    const { data: existing } = await getSupabaseAdmin()
      .from("users")
      .select("id")
      .eq("email", email)
      .maybeSingle();

    if (existing?.id) {
      return NextResponse.json({ error: "Este email ya esta registrado." }, { status: 409 });
    }

    const passwordHash = await hashPassword(password);

    const { data: user, error: insertError } = await getSupabaseAdmin()
      .from("users")
      .insert({ name, email, password_hash: passwordHash })
      .select("id, name, email")
      .single();

    if (insertError || !user) {
      return NextResponse.json({ error: "No se pudo crear el usuario." }, { status: 500 });
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

    await sendVerificationEmail({ to: email, code, name });

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: "Error inesperado." }, { status: 500 });
  }
}

