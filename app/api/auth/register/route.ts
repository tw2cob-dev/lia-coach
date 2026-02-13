import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "../../../../lib/auth/supabase";
import { sendVerificationEmail } from "../../../../lib/auth/email";
import { hashPassword } from "../../../../lib/auth/password";
import { isValidEmail, isValidPassword, normalizeEmail } from "../../../../lib/auth/validation";

type RegisterExistingUserRow = {
  id: string;
  name: string;
  email: string;
  email_verified_at: string | null;
};

type RegisterInsertedUserRow = {
  id: string;
  name: string;
  email: string;
};

function generateCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

async function createAndSendCode(args: { userId: string; email: string; name: string }) {
  const code = generateCode();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

  const { error: codeError } = await getSupabaseAdmin().from("email_verification_codes").insert({
    user_id: args.userId,
    code,
    expires_at: expiresAt,
  });

  if (codeError) {
    throw new Error("No se pudo generar el codigo de verificacion.");
  }

  await sendVerificationEmail({
    to: args.email,
    code,
    name: args.name,
  });
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
      return NextResponse.json({ error: "La contrasena debe tener al menos 6 caracteres." }, { status: 400 });
    }

    const { data: existingData } = await getSupabaseAdmin()
      .from("users")
      .select("id, name, email, email_verified_at")
      .eq("email", email)
      .maybeSingle();
    const existing = (existingData ?? null) as RegisterExistingUserRow | null;

    if (existing?.id) {
      if (existing.email_verified_at) {
        return NextResponse.json({ error: "Este email ya esta registrado." }, { status: 409 });
      }

      await createAndSendCode({
        userId: existing.id,
        email: existing.email,
        name: existing.name,
      });

      return NextResponse.json({ ok: true, needsVerification: true });
    }

    const passwordHash = await hashPassword(password);

    const { data: userData, error: insertError } = await getSupabaseAdmin()
      .from("users")
      .insert({ name, email, password_hash: passwordHash })
      .select("id, name, email")
      .single();
    const user = (userData ?? null) as RegisterInsertedUserRow | null;

    if (insertError || !user) {
      return NextResponse.json({ error: "No se pudo crear el usuario." }, { status: 500 });
    }

    await createAndSendCode({
      userId: user.id,
      email: user.email,
      name: user.name,
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error inesperado.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
