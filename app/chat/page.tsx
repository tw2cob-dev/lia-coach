"use client";

import { useEffect, useRef, useState } from "react";
import {
  ChatEvent,
  createAssistantTextEvent,
  createTextEvent,
  createUserFileEvent,
  createUserImageEvent,
  createUserVoiceEvent,
} from "../../lib/chatEvents";
import { streamAssistantReplyForFile, streamAssistantReplyText } from "../../lib/chat/chatLogic";

const storageKey = "lia-chat-events";
const SCROLL_THRESHOLD_PX = 80;
const MAX_TEXTAREA_HEIGHT_PX = 168;
const MAX_FILE_TEXT_CHARS = 20000;
const SUMMARY_PREVIEW_CHARS = 200;
const MAX_SELECTED_FILES = 3;

const DAILY_TOKEN_BUDGET = 20000;
const DAILY_MESSAGE_BUDGET = 50;
const DAILY_COST_BUDGET = 1.5;
const DAILY_COST_WARNING = 0.5;
const COST_INPUT_PER_1K = Number(process.env.NEXT_PUBLIC_LIA_COST_INPUT_PER_1K ?? "0.00015");
const COST_OUTPUT_PER_1K = Number(process.env.NEXT_PUBLIC_LIA_COST_OUTPUT_PER_1K ?? "0.0006");
const OUTPUT_TOKEN_RESERVE = 300;
const QUICK_PROMPTS = [
  { label: "Registrar comida", prompt: "Comida: tipo, cantidad aproximada y hora." },
  { label: "Entrenamiento", prompt: "Entrenamiento: tipo, duracion e intensidad." },
  { label: "Peso y medidas", prompt: "Peso hoy: (opcional) y como te sientes." },
  { label: "Nota rapida", prompt: "Nota: energia, sueno o contexto del dia." },
];

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

function isSelectedFileEvent(
  event: ChatEvent,
  selectedIds: string[]
): event is FileChatEventWithFile {
  return event.type === "file" && selectedIds.includes(event.id) && typeof event.file?.name === "string";
}

export default function ChatPage() {
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

  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);
  const attachInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!isStreaming) {
      inputRef.current?.focus();
    }
  }, [isStreaming]);

  useEffect(() => {
    const stored = window.localStorage.getItem(storageKey);
    if (!stored) return;
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
  }, []);

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
    window.localStorage.setItem(storageKey, JSON.stringify(next));
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
    const state = loadBudgetState();
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
      saveBudgetState(nextWarn);
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
    saveBudgetState(nextState);

    return { reservedOut };
  };

  const reconcileBudget = (reservedOut: number, responseText: string) => {
    const actualOut = estimateTokens(responseText);
    const deltaOut = actualOut - reservedOut;
    if (deltaOut === 0) return;
    const state = loadBudgetState();
    const nextState = {
      ...state,
      tokensOut: Math.max(0, state.tokensOut + deltaOut),
      cost: Math.max(0, state.cost + estimateCost(0, deltaOut)),
    };
    saveBudgetState(nextState);
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

    setIsStreaming(true);
    setStreamingText("");

    try {
      const assistantEvent = await streamAssistantReplyText(
        withUser,
        (chunk) => {
          setStreamingText((prev) => prev + chunk);
        },
        turnId,
        selectedFileIds
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

      return true;
    } finally {
      setIsStreaming(false);
      setStreamingText("");
    }
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

  const handleQuickPrompt = (prompt: string) => {
    if (pendingAttachment || isStreaming) return;
    setInput(prompt);
    requestAnimationFrame(() => {
      if (!inputRef.current) return;
      inputRef.current.focus();
      inputRef.current.setSelectionRange(prompt.length, prompt.length);
      adjustTextareaHeight();
    });
  };

  const qaDisabled = Boolean(pendingAttachment) || isStreaming;
  const selectedFiles = events.filter((event) => isSelectedFileEvent(event, selectedFileIds));
  const dateLabel = buildDateLabel();
  const hasMessages = events.length > 0 || isStreaming;

  return (
    <div className="app-bg min-h-screen text-slate-900">
      <div className="mx-auto flex min-h-screen max-w-[440px] flex-col px-5 pb-8 pt-6">
        <header className="flex items-center justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-slate-500">LIA Coach</p>
            <h1 className="font-display text-2xl font-medium text-slate-900">Hoy {dateLabel}</h1>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="soft-pill rounded-full px-3 py-1 text-xs font-semibold text-slate-700"
            >
              Plan Pro
            </button>
            <button
              type="button"
              className="flex h-10 w-10 items-center justify-center rounded-full bg-white/70 shadow-sm"
              aria-label="Perfil"
            >
              <span className="text-base">L</span>
            </button>
          </div>
        </header>

        <section className="glass-card mt-5 rounded-3xl p-4">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Resumen rapido</p>
              <p className="mt-2 text-sm text-slate-700">
                Sin juicio. Sin castigo. Solo contexto para hoy.
              </p>
            </div>
            <span className="rounded-full bg-white/70 px-3 py-1 text-[10px] font-semibold text-slate-600">
              Diario
            </span>
          </div>
          <div className="mt-4 grid grid-cols-3 gap-3">
            {[
              { label: "Comidas", value: "Sin datos" },
              { label: "Actividad", value: "Pendiente" },
              { label: "Peso", value: "Opcional" },
            ].map((item) => (
              <div key={item.label} className="rounded-2xl bg-white/70 p-3 text-xs">
                <p className="text-slate-400">{item.label}</p>
                <p className="mt-2 text-sm font-semibold text-slate-800">{item.value}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="mt-4">
          <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Entradas rapidas</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {QUICK_PROMPTS.map((item) => (
              <button
                key={item.label}
                type="button"
                onClick={() => handleQuickPrompt(item.prompt)}
                className="rounded-full bg-white/80 px-4 py-2 text-xs font-medium text-slate-700 shadow-sm"
              >
                {item.label}
              </button>
            ))}
          </div>
        </section>

        <section className="glass-card mt-5 flex min-h-[320px] flex-1 flex-col rounded-3xl p-4">
          <div className="flex items-center justify-between">
            <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Conversacion</p>
            <button
              type="button"
              className="text-xs font-medium text-slate-500"
              onClick={() => handleQuickPrompt("Cierre de dia: ")}
            >
              Cierre de dia
            </button>
          </div>

          <main
            ref={scrollRef}
            onScroll={handleScroll}
            className="mt-3 flex-1 overflow-y-auto pr-1"
          >
            {!hasMessages && (
              <div className="mt-10 text-center text-sm text-slate-500">
                Tu espacio para registrar lo de hoy. Una frase es suficiente.
              </div>
            )}
            <ul className="space-y-3 pb-4">
              {events.map((message) => {
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
                    className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm shadow-sm transition ${
                      message.role === "user"
                        ? "ml-auto bg-slate-900 text-white"
                        : "bg-white/80 text-slate-900"
                    } ${isSelected ? "ring-1 ring-slate-200" : ""}`}
                  >
                    {isImage && message.image?.src && (
                      <img
                        src={message.image.src}
                        alt={message.content || message.image.name || "Imagen subida"}
                        className="mb-2 max-w-full rounded-xl"
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
                    {content}
                  </li>
                );
              })}
              {isStreaming && (
                <li className="max-w-[85%] rounded-2xl bg-white/80 px-4 py-3 text-sm text-slate-900 shadow-sm">
                  {streamingText ? streamingText : "Escribiendo..."}
                </li>
              )}
            </ul>
            <div ref={endRef} />
          </main>
        </section>

        <form
          onSubmit={(event) => {
            event.preventDefault();
            void handleSubmit();
          }}
          className="mt-5"
        >
          {selectedFileIds.length > 0 && (
            <div className="mb-3 flex flex-wrap items-center gap-2 rounded-2xl bg-white/80 px-3 py-2 text-xs text-slate-700 shadow-sm">
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
            <div className="mb-3 flex items-center gap-3 rounded-2xl bg-white/80 p-3 shadow-sm">
              {pendingAttachment.type === "image" ? (
                <img
                  src={pendingAttachment.src}
                  alt={pendingAttachment.name || "Imagen seleccionada"}
                  className="h-14 w-14 rounded-xl object-cover"
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

          <div className="flex items-end gap-3 rounded-3xl bg-white/85 p-3 shadow-lg">
            <button
              type="button"
              onClick={() => attachInputRef.current?.click()}
              className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white text-slate-600 shadow-sm"
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
              placeholder="Escribe aqui..."
              className="max-h-[168px] flex-1 resize-none bg-transparent text-sm text-slate-800 outline-none"
              rows={1}
              disabled={isStreaming}
            />
            <button
              type="button"
              onClick={handleVoiceToggle}
              className={`flex h-11 w-11 items-center justify-center rounded-2xl border border-white/60 bg-white/80 text-xs font-semibold text-slate-600 shadow-sm ${
                isRecording ? "ring-2 ring-slate-300" : ""
              }`}
              disabled={isStreaming}
            >
              {isRecording ? "Stop" : "Voz"}
            </button>
            <button
              type="submit"
              className="cta-gradient flex h-11 items-center justify-center rounded-2xl px-4 text-sm font-semibold text-white shadow-sm"
              disabled={isStreaming}
            >
              Enviar
            </button>
          </div>
        </form>
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
    const image = new Image();
    image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
    image.onerror = () => resolve({});
    image.src = src;
  });
}

function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1)}...`;
}










type BudgetState = {
  date: string;
  tokensIn: number;
  tokensOut: number;
  messages: number;
  cost: number;
  warned: boolean;
};

const BUDGET_STORAGE_PREFIX = "lia-chat-budget";

function getLocalDateKey() {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function loadBudgetState(): BudgetState {
  const dateKey = getLocalDateKey();
  const storageKey = `${BUDGET_STORAGE_PREFIX}-${dateKey}`;
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

function saveBudgetState(state: BudgetState) {
  const storageKey = `${BUDGET_STORAGE_PREFIX}-${state.date}`;
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
      ? "Has alcanzado el limite diario de tokens."
      : reason === "messages"
      ? "Has alcanzado el limite diario de mensajes."
      : "Has alcanzado el limite diario de coste.";
  return `${reasonLine} ${tokensLine}. ${messagesLine}. ${costLine}.`;
}









