"use client";

import { useEffect, useMemo, useState } from "react";

type ProbeState = {
  innerHeight: number;
  outerHeight: number;
  vvHeight: number;
  vvOffsetTop: number;
  standaloneMedia: boolean;
  standaloneNavigator: boolean;
};

type ProbeMode = "fixed-shell" | "flow-sticky" | "unlocked-lvh";

type TapSnapshot = {
  x: number;
  y: number;
  innerHeight: number;
  mode: ProbeMode;
};

function readProbeState(): ProbeState {
  const vv = window.visualViewport;
  return {
    innerHeight: window.innerHeight,
    outerHeight: window.outerHeight,
    vvHeight: Math.round(vv?.height ?? 0),
    vvOffsetTop: Math.round(vv?.offsetTop ?? 0),
    standaloneMedia: window.matchMedia("(display-mode: standalone)").matches,
    standaloneNavigator:
      "standalone" in navigator
        ? Boolean((navigator as Navigator & { standalone?: boolean }).standalone)
        : false,
  };
}

function ProbeInfo({
  mode,
  setMode,
  summary,
  lastTap,
  tapLog,
}: {
  mode: ProbeMode;
  setMode: (mode: ProbeMode) => void;
  summary: string;
  lastTap: TapSnapshot | null;
  tapLog: string[];
}) {
  return (
    <div className="rounded-2xl bg-white/85 p-3 text-slate-900 shadow-sm">
      <div className="flex flex-wrap items-center gap-2">
        {(["fixed-shell", "flow-sticky", "unlocked-lvh"] as ProbeMode[]).map((item) => (
          <button
            key={item}
            type="button"
            onClick={() => setMode(item)}
            className={`rounded-full px-3 py-1 text-xs font-semibold ${
              mode === item ? "bg-slate-900 text-white" : "bg-slate-200 text-slate-700"
            }`}
          >
            {item}
          </button>
        ))}
      </div>
      <pre className="mt-3 rounded-xl bg-slate-900 p-3 text-[11px] text-slate-100">{summary}</pre>
      <div className="mt-2 rounded-xl bg-blue-50 p-2 text-xs">
        {!lastTap ? (
          <p>sin taps aun</p>
        ) : (
          <p>
            {`mode=${lastTap.mode} tapY=${lastTap.y} innerHeight=${lastTap.innerHeight} tapDentroViewport=${
              lastTap.y <= lastTap.innerHeight - 1
            }`}
          </p>
        )}
      </div>
      <pre className="mt-2 max-h-24 overflow-auto rounded-xl bg-slate-100 p-2 text-[11px] text-slate-700">
        {tapLog.length ? tapLog.join("\n") : "sin logs"}
      </pre>
    </div>
  );
}

export default function ProbePage() {
  const [probe, setProbe] = useState<ProbeState | null>(null);
  const [mode, setMode] = useState<ProbeMode>("unlocked-lvh");
  const [tapLog, setTapLog] = useState<string[]>([]);
  const [lastTap, setLastTap] = useState<TapSnapshot | null>(null);

  useEffect(() => {
    const update = () => setProbe(readProbeState());
    update();
    window.addEventListener("resize", update);
    window.addEventListener("orientationchange", update);
    window.visualViewport?.addEventListener("resize", update);
    window.visualViewport?.addEventListener("scroll", update);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("orientationchange", update);
      window.visualViewport?.removeEventListener("resize", update);
      window.visualViewport?.removeEventListener("scroll", update);
    };
  }, []);

  useEffect(() => {
    const html = document.documentElement;
    const body = document.body;
    const prev = {
      htmlOverflow: html.style.overflow,
      htmlHeight: html.style.height,
      bodyOverflow: body.style.overflow,
      bodyHeight: body.style.height,
      bodyMinHeight: body.style.minHeight,
    };

    if (mode === "unlocked-lvh") {
      html.style.overflow = "auto";
      html.style.height = "auto";
      body.style.overflow = "auto";
      body.style.height = "auto";
      body.style.minHeight = "100lvh";
    }

    return () => {
      html.style.overflow = prev.htmlOverflow;
      html.style.height = prev.htmlHeight;
      body.style.overflow = prev.bodyOverflow;
      body.style.height = prev.bodyHeight;
      body.style.minHeight = prev.bodyMinHeight;
    };
  }, [mode]);

  const summary = useMemo(() => {
    if (!probe) return "cargando...";
    return [
      `mode=${mode}`,
      `displayMode=${probe.standaloneMedia ? "standalone" : "browser"}`,
      `navigatorStandalone=${probe.standaloneNavigator}`,
      `innerHeight=${probe.innerHeight}`,
      `vvHeight=${probe.vvHeight}`,
      `outerHeight=${probe.outerHeight}`,
      `vvOffsetTop=${probe.vvOffsetTop}`,
      `outer-inner=${probe.outerHeight - probe.innerHeight}`,
      `docEl.clientHeight=${document.documentElement.clientHeight}`,
      `body.clientHeight=${document.body.clientHeight}`,
    ].join("\n");
  }, [probe, mode]);

  const handleTap = (event: React.PointerEvent<HTMLButtonElement>, tapMode: ProbeMode) => {
    const y = Math.round(event.clientY);
    const x = Math.round(event.clientX);
    const innerHeight = window.innerHeight;
    const stamp = new Date().toLocaleTimeString("es-ES", { hour12: false });
    setLastTap({ x, y, innerHeight, mode: tapMode });
    setTapLog((prev) => [`${stamp} mode=${tapMode} x=${x} y=${y} inner=${innerHeight}`, ...prev].slice(0, 14));
  };

  if (mode === "fixed-shell") {
    return (
      <div className="mobile-app-shell app-bg overflow-hidden text-slate-900">
        <main className="mx-auto flex h-full w-full max-w-[520px] flex-col gap-3 px-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] pt-[calc(env(safe-area-inset-top)+1rem)]">
          <h1 className="text-lg font-semibold">Probe A/B viewport</h1>
          <ProbeInfo mode={mode} setMode={setMode} summary={summary} lastTap={lastTap} tapLog={tapLog} />
          <div className="min-h-0 flex-1 overflow-y-auto rounded-2xl bg-white/70 p-3 text-sm text-slate-700">
            {Array.from({ length: 14 }).map((_, i) => (
              <p key={`a-${i}`}>fixed-shell fila {i + 1}</p>
            ))}
          </div>
        </main>
        <button
          type="button"
          onPointerDown={(event) => handleTap(event, "fixed-shell")}
          className="fixed inset-x-3 z-50 h-12 rounded-full bg-blue-600 text-sm font-semibold text-white"
          style={{ bottom: "0px" }}
        >
          Boton fondo fixed-shell
        </button>
      </div>
    );
  }

  return (
    <div className="app-bg min-h-[100lvh] text-slate-900">
      <main className="mx-auto w-full max-w-[520px] px-4 pb-4 pt-[calc(env(safe-area-inset-top)+1rem)]">
        <h1 className="text-lg font-semibold">Probe A/B viewport</h1>
        <div className="mt-3">
          <ProbeInfo mode={mode} setMode={setMode} summary={summary} lastTap={lastTap} tapLog={tapLog} />
        </div>
        <div className="mt-3 space-y-3 rounded-2xl bg-white/70 p-3 text-sm text-slate-700">
          <p>{mode === "flow-sticky" ? "Modo B: flow-sticky" : "Modo C: unlocked-lvh"}</p>
          {Array.from({ length: 28 }).map((_, i) => (
            <p key={`b-${i}`}>bloque de contenido {i + 1}</p>
          ))}
        </div>
      </main>
      <div className="sticky bottom-0 px-3 pb-[env(safe-area-inset-bottom)] pt-2">
        <button
          type="button"
          onPointerDown={(event) => handleTap(event, mode)}
          className={`h-12 w-full rounded-full text-sm font-semibold text-white ${
            mode === "flow-sticky" ? "bg-emerald-600" : "bg-fuchsia-600"
          }`}
        >
          {mode === "flow-sticky" ? "Boton fondo flow-sticky" : "Boton fondo unlocked-lvh"}
        </button>
      </div>
    </div>
  );
}
