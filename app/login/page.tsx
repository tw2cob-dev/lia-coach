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

  if (errorCode === "auth/email-already-in-use") return "Este email ya esta registrado.";
  if (errorCode === "auth/invalid-email") return "Email invalido.";
  if (errorCode === "auth/weak-password") return "La contrasena es demasiado debil.";
  if (errorCode === "auth/operation-not-allowed") {
    return "Email/Password no esta activado en Firebase Authentication.";
  }
  if (errorCode === "auth/unauthorized-domain") {
    return "Dominio no autorizado. Agrega localhost en Firebase Authentication.";
  }
  if (errorCode === "auth/invalid-api-key") {
    return "API key invalida. Revisa NEXT_PUBLIC_FIREBASE_API_KEY.";
  }
  if (errorCode === "auth/network-request-failed") {
    return "Fallo de red al conectar con Firebase.";
  }
  if (errorCode === "auth/configuration-not-found") {
    return "Configuracion de autenticacion incompleta en Firebase.";
  }
  if (errorCode === "auth/user-not-found") return "Usuario no encontrado.";
  if (errorCode === "auth/wrong-password" || errorCode === "auth/invalid-credential") {
    return "Credenciales invalidas.";
  }
  if (errorCode === "auth/too-many-requests") {
    return "Demasiados intentos. Espera un momento y vuelve a intentar.";
  }

  if (errorCode && process.env.NODE_ENV !== "production") {
    return `Error Firebase: ${errorCode}`;
  }
  if (genericMessage && process.env.NODE_ENV !== "production") {
    return `Error: ${genericMessage}`;
  }
  return "Error inesperado.";
}

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("register");
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
      throw new Error("No se pudo establecer la sesion segura.");
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
        "Cuenta creada. Revisa tu email (incluyendo Spam/No deseado), pulsa el enlace y vuelve aqui."
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
        setStatus("Necesitas email y contrasena para comprobar la verificacion.");
        return;
      }

      const auth = getFirebaseAuth();
      const credential = await signInWithEmailAndPassword(auth, email.trim(), password);
      await credential.user.reload();
      if (!credential.user.emailVerified) {
        await signOut(auth).catch(() => undefined);
        setStatus(
          `Tu email aun no esta verificado en Firebase (proyecto: ${firebaseProjectId || "N/D"}). Abre el ultimo correo y pulsa el enlace.`
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
        setStatus("Escribe email y contrasena para reenviar la verificacion.");
        return;
      }

      const auth = getFirebaseAuth();
      const credential = await signInWithEmailAndPassword(auth, email.trim(), password);
      await credential.user.reload();
      if (credential.user.emailVerified) {
        setStatus("Tu email ya esta verificado. Puedes iniciar sesion.");
        return;
      }

      await sendEmailVerification(credential.user);
      await signOut(auth);
      setStatus("Te enviamos un nuevo email. Revisa tambien Spam/No deseado.");
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
          <h1 className="font-display mt-3 text-3xl font-semibold text-slate-900">Bienvenida</h1>
          <p className="mt-3 text-sm text-slate-600">
            Tu acompanamiento diario sin culpa. Crea tu cuenta y verifica tu email.
          </p>

          <div className="glass-card mt-6 rounded-3xl p-5">
            <div className="flex gap-2 text-xs">
              {[
                { id: "register", label: "Registro" },
                { id: "verify", label: "Verificar email" },
                { id: "login", label: "Entrar" },
              ].map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setMode(item.id as Mode)}
                  className={`rounded-full px-3 py-1 ${
                    mode === item.id ? "bg-slate-900 text-white" : "bg-white/80 text-slate-500"
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>

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
                placeholder="Contrasena"
                type="password"
                className="w-full rounded-2xl border border-white/70 bg-white/80 px-4 py-3 text-sm outline-none"
              />
              {mode === "verify" && (
                <div className="space-y-2">
                  <p className="text-xs text-slate-600">
                    Abre el correo de verificacion, revisa tambien Spam/No deseado, pulsa el
                    enlace y luego vuelve aqui para continuar.
                  </p>
                  <button
                    type="button"
                    onClick={handleResendVerification}
                    className="text-xs font-medium text-slate-600 underline underline-offset-2"
                    disabled={isLoading}
                  >
                    Reenviar email de verificacion
                  </button>
                </div>
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
                ? "Ya verifique mi email"
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
