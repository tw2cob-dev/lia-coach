"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const AUTH_STORAGE_KEY = "lia-auth";

type Mode = "register" | "verify" | "login";

type AuthUser = {
  id: string;
  name: string;
  email: string;
};

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("register");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [status, setStatus] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const handleRegister = async () => {
    setStatus("");
    setIsLoading(true);
    try {
      const response = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, password }),
      });
      const data = await response.json();
      if (!response.ok) {
        setStatus(data.error || "No se pudo registrar.");
        return;
      }
      setMode("verify");
      setStatus("Te enviamos un codigo al email.");
    } catch (error) {
      setStatus("Error al conectar.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleVerify = async () => {
    setStatus("");
    setIsLoading(true);
    try {
      const response = await fetch("/api/auth/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, code }),
      });
      const data = await response.json();
      if (!response.ok) {
        setStatus(data.error || "Codigo invalido.");
        return;
      }
      setMode("login");
      setStatus("Email verificado. Ya puedes entrar.");
    } catch (error) {
      setStatus("Error al conectar.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleLogin = async () => {
    setStatus("");
    setIsLoading(true);
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await response.json();
      if (!response.ok) {
        setStatus(data.error || "No se pudo iniciar sesion.");
        return;
      }
      const user = data.user as AuthUser;
      window.localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(user));
      router.push("/chat");
    } catch (error) {
      setStatus("Error al conectar.");
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
                { id: "verify", label: "Verificacion" },
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
              {(mode === "register") && (
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
              {(mode === "register" || mode === "login") && (
                <input
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="Contrasena"
                  type="password"
                  className="w-full rounded-2xl border border-white/70 bg-white/80 px-4 py-3 text-sm outline-none"
                />
              )}
              {mode === "verify" && (
                <input
                  value={code}
                  onChange={(event) => setCode(event.target.value)}
                  placeholder="Codigo de 6 digitos"
                  className="w-full rounded-2xl border border-white/70 bg-white/80 px-4 py-3 text-sm outline-none"
                />
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
                ? "Verificar"
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

