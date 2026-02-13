"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  createUserWithEmailAndPassword,
  sendEmailVerification,
  signInWithEmailAndPassword,
  signOut,
  updateProfile,
  type User,
} from "firebase/auth";
import { getFirebaseAuth } from "../../lib/firebase/client";

type Mode = "register" | "verify" | "login";

function mapFirebaseError(raw: unknown): string {
  const genericMessage =
    raw instanceof Error && typeof raw.message === "string" ? raw.message : "";
  const errorCode =
    typeof raw === "object" &&
    raw !== null &&
    "code" in raw &&
    typeof (raw as { code?: unknown }).code === "string"
      ? (raw as { code: string }).code
      : "";

  if (errorCode === "auth/email-already-in-use") return "Este email ya está registrado.";
  if (errorCode === "auth/invalid-email") return "Email inválido.";
  if (errorCode === "auth/weak-password") return "La contraseña es demasiado débil.";
  if (errorCode === "auth/operation-not-allowed") {
    return "Email/Password no está activado en Firebase Authentication.";
  }
  if (errorCode === "auth/unauthorized-domain") {
    return "Dominio no autorizado. Agrega localhost en Firebase Authentication.";
  }
  if (errorCode === "auth/invalid-api-key") {
    return "API key inválida. Revisa NEXT_PUBLIC_FIREBASE_API_KEY.";
  }
  if (errorCode === "auth/network-request-failed") {
    return "Fallo de red al conectar con Firebase.";
  }
  if (errorCode === "auth/configuration-not-found") {
    return "Configuración de autenticación incompleta en Firebase.";
  }
  if (errorCode === "auth/user-not-found") return "Usuario no encontrado.";
  if (errorCode === "auth/wrong-password" || errorCode === "auth/invalid-credential") {
    return "Credenciales inválidas.";
  }
  if (errorCode === "auth/too-many-requests") {
    return "Demasiados intentos. Espera un momento y vuelve a intentar.";
  }

  if (errorCode && process.env.NODE_ENV !== "production") {
    return `Error Firebase: ${errorCode}`;
  }
  if (genericMessage) {
    return genericMessage;
  }
  return "Error inesperado.";
}

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const firebaseProjectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? "";

  const establishSession = async (user: User) => {
    const idToken = await user.getIdToken(true);
    const response = await fetch("/api/auth/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idToken }),
    });
    if (!response.ok) {
      throw new Error("No se pudo establecer la sesión segura.");
    }
  };

  const handleRegister = async () => {
    setStatus("");
    setIsLoading(true);
    try {
      if (!name.trim() || !email.trim() || !password.trim()) {
        setStatus("Faltan datos.");
        return;
      }

      const auth = getFirebaseAuth();
      const credential = await createUserWithEmailAndPassword(auth, email.trim(), password);
      if (name.trim()) {
        await updateProfile(credential.user, { displayName: name.trim() });
      }
      await sendEmailVerification(credential.user);
      await signOut(auth);
      setMode("verify");
      setStatus(
        "Cuenta creada. Revisa tu email (incluyendo Spam/No deseado), pulsa el enlace y vuelve aquí."
      );
    } catch (error) {
      setStatus(mapFirebaseError(error));
    } finally {
      setIsLoading(false);
    }
  };

  const handleVerify = async () => {
    setStatus("");
    setIsLoading(true);
    try {
      if (!email.trim() || !password.trim()) {
        setStatus("Necesitas email y contraseña para comprobar la verificación.");
        return;
      }

      const auth = getFirebaseAuth();
      const credential = await signInWithEmailAndPassword(auth, email.trim(), password);
      await credential.user.reload();
      if (!credential.user.emailVerified) {
        await signOut(auth).catch(() => undefined);
        setStatus(
          `Tu email aún no está verificado en Firebase (proyecto: ${firebaseProjectId || "N/D"}). Abre el último correo y pulsa el enlace.`
        );
        return;
      }

      await establishSession(credential.user);
      router.push("/chat");
    } catch (error) {
      setStatus(mapFirebaseError(error));
    } finally {
      setIsLoading(false);
    }
  };

  const handleResendVerification = async () => {
    setStatus("");
    setIsLoading(true);
    try {
      if (!email.trim() || !password.trim()) {
        setStatus("Escribe email y contraseña para reenviar la verificación.");
        return;
      }

      const auth = getFirebaseAuth();
      const credential = await signInWithEmailAndPassword(auth, email.trim(), password);
      await credential.user.reload();
      if (credential.user.emailVerified) {
        setStatus("Tu email ya está verificado. Puedes iniciar sesión.");
        return;
      }

      await sendEmailVerification(credential.user);
      await signOut(auth);
      setStatus("Te enviamos un nuevo email. Revisa también Spam/No deseado.");
    } catch (error) {
      setStatus(mapFirebaseError(error));
    } finally {
      setIsLoading(false);
    }
  };

  const handleLogin = async () => {
    setStatus("");
    setIsLoading(true);
    try {
      if (!email.trim() || !password.trim()) {
        setStatus("Faltan datos.");
        return;
      }

      const auth = getFirebaseAuth();
      const credential = await signInWithEmailAndPassword(auth, email.trim(), password);
      await credential.user.reload();
      if (!credential.user.emailVerified) {
        await signOut(auth).catch(() => undefined);
        setStatus("Necesitas verificar tu email antes de entrar.");
        return;
      }

      await establishSession(credential.user);
      router.push("/chat");
    } catch (error) {
      setStatus(mapFirebaseError(error));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="app-bg min-h-screen text-slate-900">
      <div className="mx-auto flex min-h-screen max-w-[420px] flex-col justify-between px-6 pb-10 pt-10">
        <div>
          <p className="text-xs uppercase tracking-[0.3em] text-slate-500">LIA Coach</p>
          <h1 className="font-display mt-3 text-3xl font-semibold text-slate-900">
            {mode === "login" ? "Bienvenida" : "Crea tu cuenta"}
          </h1>
          <p className="mt-3 text-sm text-slate-600">
            {mode === "login"
              ? "Accede con tu cuenta registrada para continuar."
              : "Completa tu registro y verifica tu email para poder entrar."}
          </p>

          <div className="glass-card mt-6 rounded-3xl p-5">
            {mode !== "login" && (
              <div className="flex gap-2 text-xs">
                {[
                  { id: "register", label: "Registro" },
                  { id: "verify", label: "Verificar email" },
                ].map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setMode(item.id as Exclude<Mode, "login">)}
                    className={`rounded-full px-3 py-1 ${
                      mode === item.id ? "bg-slate-900 text-white" : "bg-white/80 text-slate-500"
                    }`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            )}

            <div className="mt-4 space-y-3">
              {mode === "register" && (
                <input
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="Nombre"
                  className="w-full rounded-2xl border border-white/70 bg-white/80 px-4 py-3 text-sm outline-none"
                />
              )}
              <input
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="Email"
                type="email"
                className="w-full rounded-2xl border border-white/70 bg-white/80 px-4 py-3 text-sm outline-none"
              />
              <input
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="Contraseña"
                type="password"
                className="w-full rounded-2xl border border-white/70 bg-white/80 px-4 py-3 text-sm outline-none"
              />
              {mode === "verify" && (
                <div className="space-y-2">
                  <p className="text-xs text-slate-600">
                    Abre el correo de verificación, revisa también Spam/No deseado, pulsa el
                    enlace y luego vuelve aquí para continuar.
                  </p>
                  <button
                    type="button"
                    onClick={handleResendVerification}
                    className="text-xs font-medium text-slate-600 underline underline-offset-2"
                    disabled={isLoading}
                  >
                    Reenviar email de verificación
                  </button>
                </div>
              )}
              {mode === "login" ? (
                <p className="text-xs text-slate-600">
                  {"¿No tienes cuenta? "}
                  <button
                    type="button"
                    onClick={() => {
                      setStatus("");
                      setMode("register");
                    }}
                    className="font-medium text-slate-700 underline underline-offset-2"
                    disabled={isLoading}
                  >
                    Regístrate
                  </button>
                </p>
              ) : (
                <p className="text-xs text-slate-600">
                  {"¿Ya tienes cuenta? "}
                  <button
                    type="button"
                    onClick={() => {
                      setStatus("");
                      setMode("login");
                    }}
                    className="font-medium text-slate-700 underline underline-offset-2"
                    disabled={isLoading}
                  >
                    Inicia sesión
                  </button>
                </p>
              )}
            </div>

            {status && <p className="mt-3 text-xs text-slate-600">{status}</p>}

            <button
              type="button"
              onClick={mode === "register" ? handleRegister : mode === "verify" ? handleVerify : handleLogin}
              className="cta-gradient mt-4 w-full rounded-2xl py-3 text-sm font-semibold text-white"
              disabled={isLoading}
            >
              {isLoading
                ? "Procesando..."
                : mode === "register"
                ? "Crear cuenta"
                : mode === "verify"
                ? "Ya verifiqué mi email"
                : "Entrar"}
            </button>
          </div>
        </div>

        <div className="text-center text-xs text-slate-400">
          Al continuar, aceptas el uso responsable de LIA Coach.
        </div>
      </div>
    </div>
  );
}
