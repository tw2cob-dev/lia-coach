"use client";

import { ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { onAuthStateChanged, signOut as firebaseSignOut } from "firebase/auth";
import {
  ChatEvent,
  createAssistantTextEvent,
  createTextEvent,
  createUserFileEvent,
  createUserImageEvent,
  createUserVoiceEvent,
} from "../../lib/chatEvents";
import { streamAssistantReplyForFile, streamAssistantReplyText } from "../../lib/chat/chatLogic";
import { AIReplyDebug } from "../../lib/aiClient";
import { extractMemoryPatch } from "../../lib/aiMemoryClient";
import { buildDashboardMetrics } from "../../lib/chat/dashboardMetrics";
import { LIA_WELCOME_MESSAGE } from "../../lib/chat/welcomeMessage";
import { CoachPlan, getCoachPlan, upsertCoachPlan } from "../../lib/coachPlan";
import { getFirebaseAuth } from "../../lib/firebase/client";
import { bindAppViewportHeightVar } from "../../lib/ui/mobileViewport";

const CHAT_STORAGE_PREFIX = "lia-chat-events";
const BUDGET_STORAGE_PREFIX = "lia-chat-budget";
const COACH_PLAN_STORAGE_KEY = "lia-coach-plan";
const LEGACY_CHAT_MESSAGES_KEY = "lia-chat-messages";
const SCROLL_THRESHOLD_PX = 80;
const MAX_TEXTAREA_HEIGHT_PX = 168;
const MAX_FILE_TEXT_CHARS = 20000;
const SUMMARY_PREVIEW_CHARS = 200;
const MAX_SELECTED_FILES = 3;
const THEME_STORAGE_KEY = "lia-theme-preference";

const DAILY_TOKEN_BUDGET = 20000;
const DAILY_MESSAGE_BUDGET = 50;
const DAILY_COST_BUDGET = 1.5;
const DAILY_COST_WARNING = 0.5;
const COST_INPUT_PER_1K = Number(process.env.NEXT_PUBLIC_LIA_COST_INPUT_PER_1K ?? "0.00015");
const COST_OUTPUT_PER_1K = Number(process.env.NEXT_PUBLIC_LIA_COST_OUTPUT_PER_1K ?? "0.0006");
const OUTPUT_TOKEN_RESERVE = 300;

const FILE_QUICK_ACTIONS = [
  "Resumen ejecutivo",
  "Fechas clave",
  "Riesgos / alertas",
  "Que acciones recomienda?",
];

type PendingAttachment =
  | {
      type: "image";
      src: string;
      name?: string;
      sizeBytes?: number;
      width?: number;
      height?: number;
    }
  | {
      type: "file";
      name: string;
      sizeBytes?: number;
      mimeType?: string;
      src?: string;
      fileData: string;
    };

type FileChatEvent = Extract<ChatEvent, { type: "file" }>;
type FileChatEventWithFile = FileChatEvent & { file: NonNullable<FileChatEvent["file"]> };

type AuthUser = {
  id: string;
  name: string;
  email: string;
  isSuperAdmin?: boolean;
};

type ThemePreference = "light" | "dark" | "system";
type SummaryCardKey = "food" | "activity" | "weight";
type SummaryCardMode = "value" | "chart";

function isSelectedFileEvent(
  event: ChatEvent,
  selectedIds: string[]
): event is FileChatEventWithFile {
  return event.type === "file" && selectedIds.includes(event.id) && typeof event.file?.name === "string";
}

export default function ChatPage() {
  const router = useRouter();
  const [events, setEvents] = useState<ChatEvent[]>([]);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingText, setStreamingText] = useState("");
  const [isRecording, setIsRecording] = useState(false);
  const [autoScrollEnabled, setAutoScrollEnabled] = useState(true);
  const [pendingAttachment, setPendingAttachment] = useState<PendingAttachment | null>(null);
  const [pendingNote, setPendingNote] = useState("");
  const [expandedSummaries, setExpandedSummaries] = useState<Record<string, boolean>>({});
  const [selectedFileIds, setSelectedFileIds] = useState<string[]>([]);
  const [summaryMode, setSummaryMode] = useState<"daily" | "weekly">("daily");
  const [summaryCardModes, setSummaryCardModes] = useState<Record<SummaryCardKey, SummaryCardMode>>({
    food: "value",
    activity: "value",
    weight: "value",
  });
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const [isDebugOpen, setIsDebugOpen] = useState(false);
  const [lastAIDebug, setLastAIDebug] = useState<AIReplyDebug | null>(null);
  const [themePreference, setThemePreference] = useState<ThemePreference>("system");
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [hasHydrated, setHasHydrated] = useState(false);
  const activeUserId = authUser?.id ?? "anon";
  const activeChatStorageKey = getChatStorageKey(activeUserId);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);
  const attachInputRef = useRef<HTMLInputElement | null>(null);
  const profilePanelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const auth = getFirebaseAuth();
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (!user) {
        setAuthUser(null);
        void fetch("/api/auth/logout", { method: "POST" }).finally(() => {
          router.replace("/login");
        });
        return;
      }

      try {
        await user.reload();
      } catch {
        setAuthUser(null);
        void fetch("/api/auth/logout", { method: "POST" }).finally(() => {
          router.replace("/login");
        });
        return;
      }

      if (!user.emailVerified) {
        setAuthUser(null);
        await firebaseSignOut(auth).catch(() => undefined);
        void fetch("/api/auth/logout", { method: "POST" }).finally(() => {
          router.replace("/login");
        });
        return;
      }

      try {
        const idToken = await user.getIdToken(true);
        const sessionResponse = await fetch("/api/auth/session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ idToken }),
        });
        if (!sessionResponse.ok) throw new Error("Secure session failed.");

        const meResponse = await fetch("/api/auth/me", { cache: "no-store" });
        if (!meResponse.ok) throw new Error("Cannot read server session.");
        const data = (await meResponse.json()) as { user?: AuthUser };
        if (!data.user?.id || !data.user.email) throw new Error("Invalid session user payload.");
        setAuthUser(data.user);
      } catch {
        setAuthUser(null);
        await firebaseSignOut(auth).catch(() => undefined);
        void fetch("/api/auth/logout", { method: "POST" }).finally(() => {
          router.replace("/login");
        });
      }
    });

    return () => unsubscribe();
  }, [router]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => bindAppViewportHeightVar(), []);

  useEffect(() => {
    setHasHydrated(true);
  }, []);

  useEffect(() => {
    if (!isStreaming) {
      inputRef.current?.focus();
    }
  }, [isStreaming]);

  useEffect(() => {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (stored === "light" || stored === "dark" || stored === "system") {
      setThemePreference(stored);
    }
  }, []);

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const applyTheme = (pref: ThemePreference) => {
      const resolved = pref === "system" ? (media.matches ? "dark" : "light") : pref;
      document.documentElement.setAttribute("data-theme", resolved);
      window.localStorage.setItem(THEME_STORAGE_KEY, pref);
    };

    applyTheme(themePreference);
    const listener = () => {
      if (themePreference !== "system") return;
      applyTheme("system");
    };
    media.addEventListener("change", listener);
    return () => media.removeEventListener("change", listener);
  }, [themePreference]);

  useEffect(() => {
    const onPointerDown = (event: MouseEvent) => {
      if (!profilePanelRef.current) return;
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (profilePanelRef.current.contains(target)) return;
      setIsProfileOpen(false);
    };
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsProfileOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onEscape);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onEscape);
    };
  }, []);

  useEffect(() => {
    if (!authUser?.id) {
      setEvents([]);
      return;
    }

    const stored = window.localStorage.getItem(activeChatStorageKey);
    if (!stored) {
      setEvents([]);
      return;
    }
    try {
      const parsed = JSON.parse(stored);
      if (!Array.isArray(parsed)) return;
      const normalized = parsed.filter((item) => {
        if (!item || typeof item !== "object") return false;
        if (item.type === "text") {
          return (
            (item.role === "user" || item.role === "assistant") &&
            typeof item.id === "string" &&
            typeof item.ts === "number" &&
            typeof item.text === "string"
          );
        }
        if (item.type === "voice") {
          return (
            (item.role === "user" || item.role === "assistant") &&
            typeof item.id === "string" &&
            typeof item.ts === "number" &&
            typeof item.content === "string"
          );
        }
        if (item.type === "image") {
          return (
            (item.role === "user" || item.role === "assistant") &&
            typeof item.id === "string" &&
            typeof item.ts === "number" &&
            typeof item.content === "string" &&
            item.image &&
            typeof item.image === "object" &&
            typeof item.image.src === "string"
          );
        }
        if (item.type === "file") {
          return (
            (item.role === "user" || item.role === "assistant") &&
            typeof item.id === "string" &&
            typeof item.ts === "number" &&
            typeof item.content === "string" &&
            item.file &&
            typeof item.file === "object" &&
            typeof item.file.name === "string"
          );
        }
        return false;
      }) as ChatEvent[];
      setEvents(normalized);
    } catch {
      return;
    }
  }, [activeChatStorageKey, authUser?.id]);

  useEffect(() => {
    if (!autoScrollEnabled) return;
    endRef.current?.scrollIntoView({ block: "end" });
  }, [events, streamingText, autoScrollEnabled]);

  useEffect(() => {
    adjustTextareaHeight();
  }, [input, isStreaming]);

  useEffect(() => {
    setSelectedFileIds((prev) =>
      prev.filter((id) =>
        events.some(
          (event) =>
            event.type === "file" && event.id === id && event.file?.ingest?.status === "done"
        )
      )
    );
  }, [events]);

  const handleScroll = () => {
    const container = scrollRef.current;
    if (!container) return;
    const distanceFromBottom =
      container.scrollHeight - container.scrollTop - container.clientHeight;
    const nearBottom = distanceFromBottom <= SCROLL_THRESHOLD_PX;
    setAutoScrollEnabled(nearBottom);
  };

  const adjustTextareaHeight = () => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    const nextHeight = Math.min(el.scrollHeight, MAX_TEXTAREA_HEIGHT_PX);
    el.style.height = `${nextHeight}px`;
    el.style.overflowY = el.scrollHeight > MAX_TEXTAREA_HEIGHT_PX ? "auto" : "hidden";
  };

  const resetTextareaHeight = () => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.overflowY = "hidden";
  };

  const persistEvents = (next: ChatEvent[]) => {
    window.localStorage.setItem(activeChatStorageKey, JSON.stringify(next));
  };

  const clearPendingAttachment = () => {
    setPendingAttachment(null);
    setPendingNote("");
  };

  const getEventText = (event: ChatEvent) => {
    if (event.type === "text") return event.text;
    if (event.type === "voice") return event.content;
    if (event.type === "image") return event.content || "Imagen adjunta";
    if (event.type === "file") return event.content || `Archivo: ${event.file?.name ?? "adjunto"}`;
    return "";
  };

  const notifyBudgetLimit = (message: string) => {
    const assistantEvent = createAssistantTextEvent(message);
    const next = [...events, assistantEvent];
    setEvents(next);
    persistEvents(next);
  };

  const reserveBudget = (inputText: string) => {
    const state = loadBudgetState(activeUserId);
    const inputTokens = estimateTokens(inputText);
    const reservedOut = OUTPUT_TOKEN_RESERVE;
    const projectedTokensIn = state.tokensIn + inputTokens;
    const projectedTokensOut = state.tokensOut + reservedOut;
    const projectedMessages = state.messages + 1;
    const projectedCost = state.cost + estimateCost(inputTokens, reservedOut);
    const projectedTotalTokens = projectedTokensIn + projectedTokensOut;

    if (DAILY_TOKEN_BUDGET > 0 && projectedTotalTokens > DAILY_TOKEN_BUDGET) {
      notifyBudgetLimit(buildBudgetNotice(state, "tokens"));
      return null;
    }
    if (DAILY_MESSAGE_BUDGET > 0 && projectedMessages > DAILY_MESSAGE_BUDGET) {
      notifyBudgetLimit(buildBudgetNotice(state, "messages"));
      return null;
    }
    if (DAILY_COST_BUDGET > 0 && projectedCost > DAILY_COST_BUDGET) {
      notifyBudgetLimit(buildBudgetNotice(state, "cost"));
      return null;
    }

    if (!state.warned && DAILY_COST_WARNING > 0 && projectedCost >= DAILY_COST_WARNING) {
      const nextWarn = { ...state, warned: true };
      saveBudgetState(activeUserId, nextWarn);
      notifyBudgetLimit(buildBudgetWarning(nextWarn));
    }

    const nextState = {
      ...state,
      tokensIn: projectedTokensIn,
      tokensOut: projectedTokensOut,
      messages: projectedMessages,
      cost: projectedCost,
      warned: state.warned || (DAILY_COST_WARNING > 0 && projectedCost >= DAILY_COST_WARNING),
    };
    saveBudgetState(activeUserId, nextState);

    return { reservedOut };
  };

  const reconcileBudget = (reservedOut: number, responseText: string) => {
    const actualOut = estimateTokens(responseText);
    const deltaOut = actualOut - reservedOut;
    if (deltaOut === 0) return;
    const state = loadBudgetState(activeUserId);
    const nextState = {
      ...state,
      tokensOut: Math.max(0, state.tokensOut + deltaOut),
      cost: Math.max(0, state.cost + estimateCost(0, deltaOut)),
    };
    saveBudgetState(activeUserId, nextState);
  };

  const sendEvent = async (eventToSend: ChatEvent) => {
    if (isStreaming) return false;

    const reservation = reserveBudget(getEventText(eventToSend));
    if (!reservation) return false;

    const turnId = crypto.randomUUID();
    const userEvent = { ...eventToSend, turnId };
    const withUser = [...events, userEvent];
    setEvents(withUser);
    persistEvents(withUser);
    await captureMemoryPatch(userEvent);

    setIsStreaming(true);
    setStreamingText("");

    try {
      const assistantEvent = await streamAssistantReplyText(
        withUser,
        (chunk) => {
          setStreamingText((prev) => prev + chunk);
        },
        turnId,
        selectedFileIds,
        authUser?.name,
        (debug) => setLastAIDebug(debug)
      );

      reconcileBudget(reservation.reservedOut, getEventText(assistantEvent));

      setEvents((prev) => {
        const alreadyExists = prev.some(
          (item) => item.role === "assistant" && item.turnId === turnId
        );
        if (alreadyExists) return prev;
        const next = [...prev, assistantEvent];
        persistEvents(next);
        return next;
      });
      syncSignalsFromAssistantReply(getEventText(assistantEvent));

      return true;
    } finally {
      setIsStreaming(false);
      setStreamingText("");
    }
  };

  const captureMemoryPatch = async (event: ChatEvent) => {
    if (event.role !== "user") return;
    const text =
      event.type === "text"
        ? event.text
        : event.type === "voice"
        ? event.content
        : event.content;
    if (!text.trim()) return;

    const patch = await extractMemoryPatch({
      message: text,
      profile: getCoachPlan()?.physicalProfile,
      todayISO: getLocalDateKey(),
    });
    if (!patch) return;
    upsertCoachPlan(patch);
  };
  const syncSignalsFromAssistantReply = (text: string) => {
    const intakeKcal = extractAssistantIntakeKcal(text);
    if (intakeKcal === null) return;
    const patch: Partial<CoachPlan> = {
      signals: {
        today: {
          dateISO: getLocalDateKey(),
          intakeKcal,
        },
      },
    };
    upsertCoachPlan(patch);
  };
    const sendPendingAttachment = async () => {
    if (!pendingAttachment) return false;
    const turnId = crypto.randomUUID();

    if (pendingAttachment.type === "image") {
      const imageEvent = createUserImageEvent({
        src: pendingAttachment.src,
        name: pendingAttachment.name,
        sizeBytes: pendingAttachment.sizeBytes,
        width: pendingAttachment.width,
        height: pendingAttachment.height,
        caption: pendingNote || undefined,
      });
      const sent = await sendEvent(imageEvent);
      if (sent) {
        clearPendingAttachment();
      }
      return sent;
    }

    const reservation = reserveBudget(pendingNote || `Archivo: ${pendingAttachment.name}`);
    if (!reservation) return false;

    const fileEvent = createUserFileEvent({
      name: pendingAttachment.name,
      sizeBytes: pendingAttachment.sizeBytes,
      mimeType: pendingAttachment.mimeType,
      src: pendingAttachment.src,
      note: pendingNote || undefined,
    });

    clearPendingAttachment();
    setIsStreaming(true);
    setStreamingText("");

    try {
      const assistantEvent = await streamAssistantReplyForFile({
        events,
        fileEvent,
        fileData: pendingAttachment.fileData,
        turnId,
        updateEvents: (updater) => setEvents(updater),
        persistEvents,
        onToken: (chunk) => setStreamingText((prev) => prev + chunk),
        selectedFileIds,
        userName: authUser?.name,
        onDebug: (debug) => setLastAIDebug(debug),
      });

      reconcileBudget(reservation.reservedOut, getEventText(assistantEvent));

      setEvents((prev) => {
        const alreadyExists = prev.some(
          (item) => item.role === "assistant" && item.turnId === turnId
        );
        if (alreadyExists) return prev;
        const next = [...prev, assistantEvent];
        persistEvents(next);
        return next;
      });
      syncSignalsFromAssistantReply(getEventText(assistantEvent));

      return true;
    } finally {
      setIsStreaming(false);
      setStreamingText("");
    }
  };
    const handleSubmit = async () => {
    if (isStreaming) return;
    const trimmed = input.trim();

    if (pendingAttachment) {
      const attachmentSent = await sendPendingAttachment();
      if (!attachmentSent) return;
    }

    if (!trimmed) return;
    const userEvent = createTextEvent(trimmed);
    const sent = await sendEvent(userEvent);
    if (!sent) return;
    setInput("");
    resetTextareaHeight();
  };
  const handleVoiceToggle = async () => {
    if (isStreaming) return;
    if (!isRecording) {
      setIsRecording(true);
      return;
    }

    setIsRecording(false);
    const transcription = window.prompt("Transcripcion de voz (simulada):");
    if (!transcription) return;
    const voiceEvent = createUserVoiceEvent({ transcription });
    await sendEvent(voiceEvent);
  };

  const handleAttachSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    if (isStreaming) return;
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    if (file.type.startsWith("image/")) {
      const src = await readFileAsDataUrl(file);
      const dimensions = await readImageDimensions(src);
      setPendingAttachment({
        type: "image",
        src,
        name: file.name,
        sizeBytes: file.size,
        width: dimensions.width,
        height: dimensions.height,
      });
      setPendingNote("");
      return;
    }

    if (!isAllowedFile(file)) return;
    const fileData = await readFileAsText(file);
    setPendingAttachment({
      type: "file",
      name: file.name,
      sizeBytes: file.size,
      mimeType: file.type || undefined,
      fileData,
    });
    setPendingNote("");
  };

  const handleKeyDown = async (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter" || event.shiftKey) return;
    event.preventDefault();
    await handleSubmit();
  };

  const formatSize = (sizeBytes?: number) => {
    if (!sizeBytes || sizeBytes <= 0) return "";
    const sizeKb = Math.max(1, Math.round(sizeBytes / 1024));
    return `${sizeKb}KB`;
  };

  const shouldShowMimeType = (mimeType?: string) => {
    if (!mimeType) return false;
    return !mimeType.startsWith("image/");
  };

  const fileStatusLabel = (status?: string) => {
    if (status === "pending") return "Procesando...";
    if (status === "done") return "Procesado";
    if (status === "error") return "Fallo";
    return "";
  };

  const toggleSummary = (id: string) => {
    setExpandedSummaries((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const getSummaryPreview = (summary: string) => {
    if (summary.length <= SUMMARY_PREVIEW_CHARS) return summary;
    return `${summary.slice(0, SUMMARY_PREVIEW_CHARS).trimEnd()}...`;
  };

  const handleQuickAction = async (fileName: string, question: string) => {
    if (isStreaming || pendingAttachment) return;
    const prompt = `Sobre el archivo ${fileName}: ${question}`;
    const userEvent = createTextEvent(prompt);
    await sendEvent(userEvent);
  };

  const handleAskAboutFile = (fileName: string) => {
    if (pendingAttachment || isStreaming) return;
    const prompt = `Sobre el archivo ${fileName}: `;
    setInput(prompt);
    requestAnimationFrame(() => {
      if (!inputRef.current) return;
      inputRef.current.focus();
      inputRef.current.setSelectionRange(prompt.length, prompt.length);
      adjustTextareaHeight();
    });
  };

  const handleToggleSelect = (fileId: string) => {
    if (pendingAttachment || isStreaming) return;
    setSelectedFileIds((prev) => {
      if (prev.includes(fileId)) return prev.filter((id) => id !== fileId);
      if (prev.length >= MAX_SELECTED_FILES) return prev;
      return [...prev, fileId];
    });
  };

  const clearSelectedFiles = () => {
    setSelectedFileIds([]);
  };

  const sendMultiFileAction = async (action: "compare" | "summary") => {
    if (isStreaming || pendingAttachment) return;
    const selectedFiles = events.filter((event) => isSelectedFileEvent(event, selectedFileIds));
    if (selectedFiles.length === 0) return;
    const names = selectedFiles.map((fileEvent) => fileEvent.file.name).join(", ");
    const prompt =
      action === "compare"
        ? `Compara los archivos seleccionados: ${names}`
        : `Haz un resumen conjunto de los archivos seleccionados: ${names}`;
    const userEvent = createTextEvent(prompt);
    await sendEvent(userEvent);
  };

  const handleLogout = () => {
    const auth = getFirebaseAuth();
    void firebaseSignOut(auth)
      .catch(() => undefined)
      .finally(() => {
        void fetch("/api/auth/logout", { method: "POST" }).finally(() => {
          router.push("/login");
        });
      });
  };

  const handleResetChat = () => {
    if (!authUser?.isSuperAdmin || isStreaming) return;
    const confirmed = window.confirm(
      "Esto borrara el historial local del chat y presupuesto en este navegador. Quieres continuar?"
    );
    if (!confirmed) return;

    const keysToDelete = Object.keys(window.localStorage).filter(
      (key) =>
        key.startsWith(`${CHAT_STORAGE_PREFIX}-`) ||
        key.startsWith(`${BUDGET_STORAGE_PREFIX}-`) ||
        key === COACH_PLAN_STORAGE_KEY ||
        key === LEGACY_CHAT_MESSAGES_KEY
    );

    for (const key of keysToDelete) {
      window.localStorage.removeItem(key);
    }

    setEvents([]);
    setInput("");
    setStreamingText("");
    setPendingAttachment(null);
    setPendingNote("");
    setExpandedSummaries({});
    setSelectedFileIds([]);
    resetTextareaHeight();
  };

  const qaDisabled = Boolean(pendingAttachment) || isStreaming;
  const selectedFiles = events.filter((event) => isSelectedFileEvent(event, selectedFileIds));
  const dateLabel = buildDateLabel();
  const welcomeMessage = LIA_WELCOME_MESSAGE;
  const coachPlan = hasHydrated ? getCoachPlan() : null;
  const dashboardMetrics = useMemo(() => buildDashboardMetrics(events, coachPlan), [events, coachPlan]);
  const summaryCopy =
    summaryMode === "daily"
      ? "Sin juicio. Sin castigo. Balance de hoy."
      : "Sin juicio. Sin castigo. Balance de esta semana.";
  const summaryItems = useMemo(
    () =>
    summaryMode === "daily"
      ? [
          {
            key: "food" as const,
            label: "Comidas",
            value:
              dashboardMetrics.daily.targetKcal !== null
                ? `${dashboardMetrics.daily.intakeKcal} / ${dashboardMetrics.daily.targetKcal} kcal`
                : "Sin datos",
            chart: dashboardMetrics.weekly.intakeKcal,
            hint:
              dashboardMetrics.daily.targetKcal !== null
                ? `TMB ${dashboardMetrics.daily.basalKcal} · GET ${dashboardMetrics.daily.tdeeKcal} · conf. ${dashboardMetrics.daily.confidence}`
                : "Comparte peso, altura, edad, sexo o actividad para calcular objetivo.",
          },
          {
            key: "activity" as const,
            label: "Actividad",
            value: `${dashboardMetrics.daily.burnKcal} kcal`,
            chart: dashboardMetrics.weekly.burnKcal,
            hint: "Incluye sesiones registradas y recurrentes.",
          },
          {
            key: "weight" as const,
            label: "Peso",
            value:
              dashboardMetrics.daily.lastWeightKg !== null
                ? `${dashboardMetrics.daily.lastWeightKg} kg`
                : "Sin registro",
            chart: dashboardMetrics.weekly.weightKg.map((value) => value ?? 0),
            hint:
              dashboardMetrics.daily.weightDeltaKg30d !== null
                ? `Progreso 30d: ${dashboardMetrics.daily.weightDeltaKg30d > 0 ? "+" : ""}${dashboardMetrics.daily.weightDeltaKg30d} kg`
                : "Aún sin progreso calculable",
          },
        ]
      : [
          {
            key: "food" as const,
            label: "Comidas",
            value:
              dashboardMetrics.daily.targetKcal !== null
                ? `${sumSeries(dashboardMetrics.weekly.intakeKcal)} / ${dashboardMetrics.daily.targetKcal * 7} kcal sem`
                : "Sin datos",
            chart: dashboardMetrics.weekly.intakeKcal,
            hint: "Consumo semanal acumulado.",
          },
          {
            key: "activity" as const,
            label: "Actividad",
            value: `${sumSeries(dashboardMetrics.weekly.burnKcal)} kcal sem`,
            chart: dashboardMetrics.weekly.burnKcal,
            hint: "Gasto por ejercicio semanal.",
          },
          {
            key: "weight" as const,
            label: "Peso",
            value:
              dashboardMetrics.daily.lastWeightKg !== null
                ? `${dashboardMetrics.daily.lastWeightKg} kg actual`
                : "Sin registro",
            chart: dashboardMetrics.weekly.weightKg.map((value) => value ?? 0),
            hint:
              dashboardMetrics.daily.weightDeltaKg30d !== null
                ? `Delta 30d: ${dashboardMetrics.daily.weightDeltaKg30d > 0 ? "+" : ""}${dashboardMetrics.daily.weightDeltaKg30d} kg`
                : "Sin delta",
          },
        ],
    [dashboardMetrics, summaryMode]
  );

  const toggleSummaryCardMode = (key: SummaryCardKey) => {
    setSummaryCardModes((prev) => ({
      ...prev,
      [key]: prev[key] === "value" ? "chart" : "value",
    }));
  };

  return (
    <div className="mobile-app-shell app-bg h-[var(--app-vh)] overflow-hidden text-slate-900">
      <div className="mx-auto flex h-full max-w-[440px] flex-col overflow-hidden px-5 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] pt-[calc(env(safe-area-inset-top)+1rem)]">
        <header className="shrink-0 flex items-center justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-slate-500">LIA Coach</p>
            <h1 className="font-display text-2xl font-medium text-slate-900">Hoy {dateLabel}</h1>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="soft-pill pro-pill rounded-full px-3 py-1 text-xs font-semibold text-slate-700"
            >
              Plan Pro
            </button>
            <div className="relative" ref={profilePanelRef}>
              <button
                type="button"
                onClick={() => setIsProfileOpen((prev) => !prev)}
                className="avatar-btn flex h-10 w-10 items-center justify-center rounded-full bg-white/70 shadow-sm"
                aria-label="Perfil"
                aria-expanded={isProfileOpen}
                aria-haspopup="dialog"
              >
                <span className="text-sm font-semibold text-slate-700">
                  {authUser?.name?.charAt(0)?.toUpperCase() || "L"}
                </span>
              </button>
              {isProfileOpen && (
                <div
                  role="dialog"
                  aria-label="Perfil de usuario"
                  className="profile-panel absolute right-0 top-12 z-30 w-72 rounded-2xl border border-white/70 bg-white/95 p-4 shadow-xl backdrop-blur"
                >
                  <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Perfil</p>
                  <div className="mt-3 space-y-2 text-sm text-slate-700">
                    <p>
                      <span className="text-slate-500">Nombre: </span>
                      {authUser?.name || "Sin nombre"}
                    </p>
                    <p>
                      <span className="text-slate-500">Email: </span>
                      {authUser?.email || "Sin email"}
                    </p>
                    <p>
                      <span className="text-slate-500">ID: </span>
                      <span className="break-all">{authUser?.id || "-"}</span>
                    </p>
                  </div>

                  <div className="mt-4">
                    <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Tema</p>
                    <div className="mt-2 inline-flex rounded-full bg-slate-100 p-1 text-[11px] font-semibold">
                      {([
                        { id: "light", label: "Claro" },
                        { id: "dark", label: "Oscuro" },
                        { id: "system", label: "Sistema" },
                      ] as const).map((item) => (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => setThemePreference(item.id)}
                          className={`rounded-full px-3 py-1 transition ${
                            themePreference === item.id
                              ? "bg-slate-900 text-white"
                              : "text-slate-600"
                          }`}
                        >
                          {item.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={handleLogout}
                    className="mt-4 w-full rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700"
                  >
                    Cerrar sesión
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>

        <section className="glass-card summary-card mt-5 shrink-0 rounded-3xl p-4">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Resumen rapido</p>
              <p className="mt-2 text-sm text-slate-700">{summaryCopy}</p>
            </div>
            <div className="summary-switch inline-flex rounded-full bg-white/75 p-1 text-[10px] font-semibold shadow-sm">
              <button
                type="button"
                onClick={() => setSummaryMode("daily")}
                className={`summary-switch-btn rounded-full px-3 py-1 transition ${
                  summaryMode === "daily" ? "is-active bg-slate-900 text-white" : "text-slate-600"
                }`}
              >
                Diario
              </button>
              <button
                type="button"
                onClick={() => setSummaryMode("weekly")}
                className={`summary-switch-btn rounded-full px-3 py-1 transition ${
                  summaryMode === "weekly" ? "is-active bg-slate-900 text-white" : "text-slate-600"
                }`}
              >
                Semanal
              </button>
            </div>
          </div>
          <div className="mt-4 grid grid-cols-3 gap-3">
            {summaryItems.map((item) => (
              <button
                key={item.label}
                type="button"
                onClick={() => toggleSummaryCardMode(item.key)}
                className="summary-metric rounded-2xl bg-white/70 p-3 text-left text-xs"
              >
                <p className="text-slate-400">{item.label}</p>
                {summaryCardModes[item.key] === "value" ? (
                  <p className="mt-2 text-sm font-semibold text-slate-800">{item.value}</p>
                ) : (
                  <div className="mt-2">
                    <MiniBarChart values={item.chart} />
                  </div>
                )}
                <p className="mt-1 text-[10px] text-slate-500">{item.hint}</p>
              </button>
            ))}
          </div>
        </section>

        <section className="glass-card chat-card mt-0 flex min-h-0 flex-1 flex-col rounded-3xl p-2">
          {authUser?.isSuperAdmin && (
            <div className="flex justify-end gap-3">
              <button
                type="button"
                className="text-xs font-semibold text-slate-600"
                onClick={() => setIsDebugOpen((prev) => !prev)}
              >
                {isDebugOpen ? "Ocultar debug" : "Ver debug IA"}
              </button>
              <button
                type="button"
                className="text-xs font-semibold text-rose-600"
                onClick={handleResetChat}
                disabled={isStreaming}
              >
                Reset chat
              </button>
            </div>
          )}
          {authUser?.isSuperAdmin && isDebugOpen && (
            <div className="mt-2 rounded-2xl border border-slate-200 bg-white/80 p-3 text-xs text-slate-700">
              <p className="font-semibold text-slate-900">Debug IA</p>
              {!lastAIDebug ? (
                <p className="mt-2 text-slate-500">Sin datos aún. Envía un mensaje.</p>
              ) : (
                <div className="mt-2 space-y-2">
                  <p>
                    <span className="font-semibold">Fuente:</span> {lastAIDebug.source}
                    {lastAIDebug.reason ? ` (${lastAIDebug.reason})` : ""}
                  </p>
                  <p>
                    <span className="font-semibold">Modelo:</span> {lastAIDebug.model ?? "-"} |{" "}
                    <span className="font-semibold">Temp:</span> {lastAIDebug.temperature ?? "-"} |{" "}
                    <span className="font-semibold">Max tokens:</span> {lastAIDebug.maxTokens ?? "-"} |{" "}
                    <span className="font-semibold">Finish:</span> {lastAIDebug.finishReason ?? "-"}
                  </p>
                  <p>
                    <span className="font-semibold">Mensajes:</span> {lastAIDebug.messagesCount ?? "-"} |{" "}
                    <span className="font-semibold">Uso total:</span>{" "}
                    {lastAIDebug.usage?.total_tokens ?? "-"}
                  </p>
                  {lastAIDebug.lastUserMessage ? (
                    <p className="whitespace-pre-wrap">
                      <span className="font-semibold">Ultimo user:</span> {lastAIDebug.lastUserMessage}
                    </p>
                  ) : null}
                  {lastAIDebug.systemContent ? (
                    <details>
                      <summary className="cursor-pointer font-semibold">Ver prompt/contexto</summary>
                      <pre className="mt-2 max-h-52 overflow-auto whitespace-pre-wrap rounded-xl bg-slate-900/90 p-2 text-[10px] text-slate-100">
                        {lastAIDebug.systemContent}
                      </pre>
                    </details>
                  ) : null}
                </div>
              )}
            </div>
          )}

          <main
            ref={scrollRef}
            onScroll={handleScroll}
            className="chat-scroll mt-2 min-h-0 flex-1 overflow-y-auto overscroll-contain [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
          >
            <ul className="message-list px-2 pb-4">
              <li className="message-row">
                <div className="message-item welcome-bubble w-full max-w-none px-2 py-2 text-sm">
                <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-500">
                  Bienvenida
                </p>
                <p className="mt-1 whitespace-pre-line">{welcomeMessage}</p>
                </div>
              </li>
              {events.map((message, messageIndex) => {
                const previousMessage = messageIndex > 0 ? events[messageIndex - 1] : null;
                const followsUser = previousMessage?.role === "user";
                const isVoice = message.type === "voice";
                const isImage = message.type === "image";
                const isFile = message.type === "file";
                const fileData = isFile ? message.file : undefined;
                const isSelected = isFile && selectedFileIds.includes(message.id);
                const content = isVoice
                  ? `Voz: ${message.content}`
                  : message.type === "text"
                  ? message.text
                  : message.content;

                const fileSummary = fileData?.ingest?.summary;
                const isSummaryExpanded = Boolean(expandedSummaries[message.id]);
                const canSelect =
                  fileData?.ingest?.status === "done" &&
                  (isSelected || selectedFileIds.length < MAX_SELECTED_FILES);

                return (
                  <li
                    key={message.id}
                    className={`message-row ${message.role === "user" ? "user-row" : ""} ${
                      followsUser ? "follows-user-row" : ""
                    }`}
                  >
                    <div
                      className={`message-item px-2 py-2 text-sm transition ${
                        message.role === "user"
                          ? "user-bubble ml-auto max-w-[85%]"
                          : "assistant-bubble w-full max-w-none"
                      } ${isSelected ? "ring-1 ring-slate-200" : ""}`}
                    >
                    {isImage && message.image?.src && (
                      <Image
                        src={message.image.src}
                        alt={message.content || message.image.name || "Imagen subida"}
                        width={message.image.width ?? 1024}
                        height={message.image.height ?? 1024}
                        className="mb-2 h-auto max-w-full rounded-xl"
                        unoptimized
                      />
                    )}
                    {isFile && fileData?.name && (
                      <div className="mb-2 text-xs text-slate-500">
                        <div className="text-slate-700">
                          {fileData.name}
                          {fileData.sizeBytes ? ` - ${formatSize(fileData.sizeBytes)}` : ""}
                        </div>
                        {fileData.ingest?.status && (
                          <div className="text-[10px] text-slate-400">
                            {fileStatusLabel(fileData.ingest.status)}
                          </div>
                        )}
                        {fileData.ingest?.status === "done" && fileSummary && (
                          <div className="mt-2 text-xs text-slate-600">
                            <div className="whitespace-pre-wrap">
                              {isSummaryExpanded ? fileSummary : getSummaryPreview(fileSummary)}
                            </div>
                            {fileSummary.length > SUMMARY_PREVIEW_CHARS && (
                              <button
                                type="button"
                                onClick={() => toggleSummary(message.id)}
                                className="mt-1 text-[10px] text-slate-400 underline"
                              >
                                {isSummaryExpanded ? "Ver menos" : "Ver mas"}
                              </button>
                            )}
                          </div>
                        )}
                        {fileData.ingest?.status === "done" && fileData.name && (
                          <div className="mt-2 flex flex-wrap gap-2">
                            {FILE_QUICK_ACTIONS.slice(0, 4).map((action) => (
                              <button
                                key={`${message.id}-${action}`}
                                type="button"
                                onClick={() => handleQuickAction(fileData.name, action)}
                                className={`rounded-full border border-white/70 bg-white/80 px-3 py-1 text-[10px] text-slate-600 ${
                                  qaDisabled ? "pointer-events-none opacity-50" : ""
                                }`}
                                disabled={qaDisabled}
                              >
                                {action}
                              </button>
                            ))}
                            <button
                              type="button"
                              onClick={() => handleAskAboutFile(fileData.name)}
                              className={`rounded-full border border-white/70 bg-white/80 px-3 py-1 text-[10px] text-slate-600 ${
                                qaDisabled ? "pointer-events-none opacity-50" : ""
                              }`}
                              disabled={qaDisabled}
                            >
                              Preguntar sobre el archivo
                            </button>
                            <button
                              type="button"
                              onClick={() => handleToggleSelect(message.id)}
                              className={`rounded-full border border-white/70 bg-white/80 px-3 py-1 text-[10px] text-slate-600 ${
                                qaDisabled || !canSelect ? "pointer-events-none opacity-50" : ""
                              }`}
                              disabled={qaDisabled || !canSelect}
                            >
                              {isSelected ? "Seleccionado" : "Seleccionar"}
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                    {content ? (
                      <p className="whitespace-pre-wrap leading-relaxed">
                        {renderFormattedText(content)}
                      </p>
                    ) : null}
                    </div>
                  </li>
                );
              })}
              {isStreaming && (
                <li
                  className={`message-row ${
                    events.length > 0 && events[events.length - 1]?.role === "user"
                      ? "follows-user-row"
                      : ""
                  }`}
                >
                  <div className="message-item assistant-bubble w-full max-w-none px-2 py-2 text-sm">
                  {streamingText ? (
                    <p className="whitespace-pre-wrap leading-relaxed">
                      {renderFormattedText(streamingText)}
                    </p>
                  ) : (
                    "Escribiendo..."
                  )}
                  </div>
                </li>
              )}
            </ul>
            <div ref={endRef} />
          </main>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void handleSubmit();
            }}
            className="composer-wrap mt-2 border-t border-white/70 pt-2"
          >
            {selectedFileIds.length > 0 && (
              <div className="composer-chip mb-3 flex flex-wrap items-center gap-2 rounded-2xl bg-white/75 px-3 py-2 text-xs text-slate-700 shadow-sm">
              <span className="font-medium">Archivos seleccionados: {selectedFileIds.length}</span>
              {selectedFiles.slice(0, MAX_SELECTED_FILES).map((file) => (
                <span key={file.id} className="rounded-full bg-white px-3 py-1 shadow-sm">
                  {truncateText(file.file.name, 22)}
                </span>
              ))}
              <button
                type="button"
                onClick={() => sendMultiFileAction("compare")}
                className={`rounded-full border border-white/70 bg-white/90 px-3 py-1 text-[10px] text-slate-600 ${
                  qaDisabled ? "pointer-events-none opacity-50" : ""
                }`}
                disabled={qaDisabled}
              >
                Comparar
              </button>
              <button
                type="button"
                onClick={() => sendMultiFileAction("summary")}
                className={`rounded-full border border-white/70 bg-white/90 px-3 py-1 text-[10px] text-slate-600 ${
                  qaDisabled ? "pointer-events-none opacity-50" : ""
                }`}
                disabled={qaDisabled}
              >
                Resumen conjunto
              </button>
              <button
                type="button"
                onClick={clearSelectedFiles}
                className="rounded-full border border-white/70 bg-white/90 px-3 py-1 text-[10px] text-slate-600"
                disabled={qaDisabled}
              >
                Limpiar
              </button>
              </div>
            )}
            {pendingAttachment && (
              <div className="composer-chip mb-3 flex items-center gap-3 rounded-2xl bg-white/75 p-3 shadow-sm">
              {pendingAttachment.type === "image" ? (
                <Image
                  src={pendingAttachment.src}
                  alt={pendingAttachment.name || "Imagen seleccionada"}
                  width={56}
                  height={56}
                  className="h-14 w-14 rounded-xl object-cover"
                  unoptimized
                />
              ) : (
                <div className="h-14 w-14 rounded-xl bg-white px-2 py-1 text-[10px] text-slate-500 shadow-sm">
                  <div className="font-semibold text-slate-700">{pendingAttachment.name}</div>
                  <div>{pendingAttachment.sizeBytes ? formatSize(pendingAttachment.sizeBytes) : ""}</div>
                  {shouldShowMimeType(pendingAttachment.mimeType) && (
                    <div className="text-[9px] text-slate-400">{pendingAttachment.mimeType}</div>
                  )}
                </div>
              )}
              <input
                type="text"
                value={pendingNote}
                onChange={(event) => setPendingNote(event.target.value)}
                placeholder={
                  pendingAttachment.type === "image" ? "Anade un pie (opcional)" : "Anade una nota"
                }
                className="flex-1 rounded-xl border border-white/70 bg-white px-3 py-2 text-sm outline-none"
                disabled={isStreaming}
              />
              <button
                type="button"
                onClick={clearPendingAttachment}
                className="rounded-full border border-white/70 bg-white px-3 py-2 text-xs text-slate-600"
                disabled={isStreaming}
              >
                Quitar
              </button>
              </div>
            )}

            <div className="composer-shell flex items-end gap-2 rounded-2xl border border-white/70 bg-white/70 p-2 shadow-sm">
              <button
                type="button"
                onClick={() => attachInputRef.current?.click()}
                className="composer-icon-btn flex h-10 w-10 items-center justify-center rounded-xl bg-white text-slate-600 shadow-sm"
                disabled={isStreaming}
                aria-label="Adjuntar"
              >
                +
              </button>
              <textarea
                ref={inputRef}
                value={input}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Escribe aquí..."
                className="max-h-[168px] flex-1 resize-none bg-transparent px-1 py-2 text-sm text-slate-800 outline-none"
                rows={1}
                disabled={isStreaming}
              />
              <button
                type="button"
                onClick={handleVoiceToggle}
                className={`composer-icon-btn flex h-10 w-10 items-center justify-center rounded-xl border border-white/70 bg-white/85 text-slate-600 shadow-sm ${
                  isRecording ? "ring-2 ring-red-300 text-red-500" : ""
                }`}
                disabled={isStreaming}
                aria-label={isRecording ? "Detener grabacion" : "Grabar voz"}
                title={isRecording ? "Detener grabacion" : "Grabar voz"}
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  className="h-5 w-5"
                  aria-hidden="true"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M12 3.5a3.5 3.5 0 0 0-3.5 3.5v5a3.5 3.5 0 1 0 7 0V7A3.5 3.5 0 0 0 12 3.5Z"
                  />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6.5 11.5a5.5 5.5 0 0 0 11 0" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 17v3.5" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9.5 20.5h5" />
                </svg>
              </button>
              <button
                type="submit"
                className="composer-send-btn cta-gradient flex h-10 items-center justify-center rounded-xl px-4 text-sm font-semibold text-white shadow-sm"
                disabled={isStreaming}
              >
                Enviar
              </button>
            </div>
          </form>
        </section>
        <input
          ref={attachInputRef}
          type="file"
          accept="image/*,.pdf,.csv,.txt"
          onChange={handleAttachSelect}
          className="hidden"
          disabled={isStreaming}
        />
      </div>
    </div>
  );
}

function buildDateLabel() {
  const now = new Date();
  const formatter = new Intl.DateTimeFormat("es-ES", {
    weekday: "long",
    day: "numeric",
    month: "short",
  });
  const raw = formatter.format(now);
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

function isAllowedFile(file: File): boolean {
  const allowedTypes = ["application/pdf", "text/csv", "text/plain"];
  return allowedTypes.includes(file.type) || /\.(pdf|csv|txt)$/i.test(file.name);
}

async function readFileAsText(file: File): Promise<string> {
  if (file.type === "application/pdf" || /\.pdf$/i.test(file.name)) {
    return "unsupported for now";
  }
  const raw = await file.text();
  return raw.slice(0, MAX_FILE_TEXT_CHARS);
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Failed to read image file."));
    reader.readAsDataURL(file);
  });
}

function readImageDimensions(src: string): Promise<{ width?: number; height?: number }> {
  return new Promise((resolve) => {
    if (!src) return resolve({});
    const image = new window.Image();
    image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
    image.onerror = () => resolve({});
    image.src = src;
  });
}

function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1)}...`;
}

function renderFormattedText(text: string): ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, index) => {
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
      return (
        <strong key={`bold-${index}`} className="font-semibold">
          {part.slice(2, -2)}
        </strong>
      );
    }
    return <span key={`txt-${index}`}>{part}</span>;
  });
}

function sumSeries(values: number[]): number {
  return values.reduce((sum, value) => sum + (Number.isFinite(value) ? value : 0), 0);
}

function MiniBarChart({ values }: { values: number[] }) {
  const max = Math.max(1, ...values.map((value) => Math.max(0, value)));
  return (
    <div className="flex h-10 items-end gap-1">
      {values.map((value, index) => {
        const safe = Math.max(0, value);
        const ratio = safe / max;
        const height = Math.max(4, Math.round(ratio * 34));
        return (
          <span
            key={`bar-${index}`}
            className="w-2 rounded bg-slate-400/70"
            style={{ height: `${height}px` }}
            aria-hidden="true"
          />
        );
      })}
    </div>
  );
}










type BudgetState = {
  date: string;
  tokensIn: number;
  tokensOut: number;
  messages: number;
  cost: number;
  warned: boolean;
};

function getChatStorageKey(userId: string) {
  return `${CHAT_STORAGE_PREFIX}-${userId}`;
}

function getBudgetStorageKey(userId: string, dateKey: string) {
  return `${BUDGET_STORAGE_PREFIX}-${userId}-${dateKey}`;
}

function getLocalDateKey() {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function loadBudgetState(userId: string): BudgetState {
  const dateKey = getLocalDateKey();
  const storageKey = getBudgetStorageKey(userId, dateKey);
  const raw = window.localStorage.getItem(storageKey);
  if (!raw) {
    return { date: dateKey, tokensIn: 0, tokensOut: 0, messages: 0, cost: 0, warned: false };
  }
  try {
    const parsed = JSON.parse(raw) as Partial<BudgetState>;
    if (parsed.date !== dateKey) {
      return { date: dateKey, tokensIn: 0, tokensOut: 0, messages: 0, cost: 0, warned: false };
    }
    return {
      date: dateKey,
      tokensIn: Number(parsed.tokensIn) || 0,
      tokensOut: Number(parsed.tokensOut) || 0,
      messages: Number(parsed.messages) || 0,
      cost: Number(parsed.cost) || 0,
      warned: Boolean(parsed.warned),
    };
  } catch {
    return { date: dateKey, tokensIn: 0, tokensOut: 0, messages: 0, cost: 0, warned: false };
  }
}

function saveBudgetState(userId: string, state: BudgetState) {
  const storageKey = getBudgetStorageKey(userId, state.date);
  window.localStorage.setItem(storageKey, JSON.stringify(state));
}

function estimateTokens(text: string) {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return Math.max(1, Math.ceil(trimmed.length / 4));
}

function estimateCost(tokensIn: number, tokensOut: number) {
  return (tokensIn / 1000) * COST_INPUT_PER_1K + (tokensOut / 1000) * COST_OUTPUT_PER_1K;
}

function buildBudgetNotice(state: BudgetState, reason: "tokens" | "messages" | "cost") {
  const usedTokens = state.tokensIn + state.tokensOut;
  const tokensLine = `Tokens: ${usedTokens}/${DAILY_TOKEN_BUDGET}`;
  const messagesLine = `Mensajes: ${state.messages}/${DAILY_MESSAGE_BUDGET}`;
  const costLine = `Coste estimado: $${state.cost.toFixed(2)}/$${DAILY_COST_BUDGET.toFixed(2)}`;
  const reasonLine =
    reason === "tokens"
      ? "Has alcanzado el límite diario de tokens."
      : reason === "messages"
      ? "Has alcanzado el límite diario de mensajes."
      : "Has alcanzado el límite diario de coste.";
  return `${reasonLine} ${tokensLine}. ${messagesLine}. ${costLine}.`;
}










function buildBudgetWarning(state: BudgetState) {
  const costLine = `Coste estimado: $${state.cost.toFixed(2)}/$${DAILY_COST_BUDGET.toFixed(2)}`;
  return `Aviso: has superado $${DAILY_COST_WARNING.toFixed(2)} de coste estimado hoy. ${costLine}.`;
}

function extractAssistantIntakeKcal(text: string): number | null {
  const normalized = text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  if (!/kcal|calorias?|caloria/.test(normalized)) return null;

  // Skip ranges like "1800-2000" or "1800 a 2000".
  if (/\b\d{2,4}\s*(?:-|a)\s*\d{2,4}\s*(kcal|calorias?|caloria)\b/.test(normalized)) return null;

  const labelNoUnit = normalized.match(
    /\b(?:calorias?\s+consumidas?|consumo|ingesta(?:\s+total)?)\s*[:=]?\s*(\d{2,4})\b/
  );
  if (labelNoUnit) {
    const value = Number(labelNoUnit[1]);
    if (Number.isFinite(value) && value >= 200 && value <= 8000) return value;
  }

  const targeted = normalized.match(
    /\b(?:total|ingesta|consumo|consumidas?|han sido|fueron|van|llevas)\D{0,24}(\d{2,4})\s*(kcal|calorias?|caloria)\b/
  );
  if (targeted) {
    const value = Number(targeted[1]);
    if (Number.isFinite(value) && value >= 200 && value <= 8000) return value;
  }

  const generic = normalized.match(/\b(\d{2,4})\s*(kcal|calorias?|caloria)\b/);
  if (!generic) return null;
  const value = Number(generic[1]);
  if (!Number.isFinite(value) || value < 200 || value > 8000) return null;
  return value;
}







