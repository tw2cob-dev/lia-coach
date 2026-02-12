import { buildAIContext, buildLLMMessages } from "../aiContext";
import { generateAssistantReply, streamAssistantReply } from "../aiClient";
import { ChatEvent, FileChatEventWithFile, createAssistantTextEvent } from "../chatEvents";
import { CoachPlan, getCoachPlan, upsertCoachPlan } from "../coachPlan";
import { COACH_SYSTEM_PROMPT } from "../prompts/coachPrompt";
import { ingestFile } from "../fileIngestion";
import { detectCoachIntent, isCheckInRequest } from "./coachIntent";

type EventsUpdater = (updater: (prev: ChatEvent[]) => ChatEvent[]) => void;
type PersistEvents = (events: ChatEvent[]) => void;

const MAX_SELECTED_FILES = 3;
const MAX_SELECTED_EXCERPT_CHARS = 2000;

export async function createAssistantReply(
  events: ChatEvent[],
  turnId?: string,
  selectedFileIds: string[] = []
): Promise<ChatEvent> {
  const context = buildAIContext(events);
  const messages = buildLLMMessages(events);
  const selectedFilesContext = buildSelectedFilesContext(events, selectedFileIds);
  const lastUserText = getLatestUserText(events);
  const coachIntent = detectCoachIntent(lastUserText);
  const coachPlan = coachIntent ? getCoachPlan() : null;
  const coachContext = coachIntent
    ? buildCoachContext(coachPlan, context, lastUserText)
    : "";

  const todaySummary = `Hoy: comida ${context.todaySummary.food}, entrenamiento ${context.todaySummary.training}.`;
  const weekSummary = `Ultimos 7 dias: comida ${context.weekSummary.food}, entrenamiento ${context.weekSummary.training}.`;
  const systemContext = [weekSummary, selectedFilesContext, coachContext].filter(Boolean).join("\n");

  if (coachIntent && !process.env.OPENAI_API_KEY) {
    const fallbackText = buildCoachFallbackResponse(lastUserText, coachPlan);
    if (isWeeklyPlanRequest(lastUserText)) {
      saveWeeklyPlanFromContent(fallbackText);
    }
    return { ...(createAssistantTextEvent(fallbackText) as ChatEvent), turnId };
  }

  const responseText = await generateAssistantReply({
    messages,
    todaySummary,
    weekSummary: systemContext,
  });

  if (coachIntent && isWeeklyPlanRequest(lastUserText)) {
    saveWeeklyPlanFromContent(responseText);
  }

  return { ...(createAssistantTextEvent(responseText) as ChatEvent), turnId };
}

export async function streamAssistantReplyText(
  events: ChatEvent[],
  onToken: (chunk: string) => void,
  turnId?: string,
  selectedFileIds: string[] = []
): Promise<ChatEvent> {
  const context = buildAIContext(events);
  const messages = buildLLMMessages(events);
  const selectedFilesContext = buildSelectedFilesContext(events, selectedFileIds);
  const lastUserText = getLatestUserText(events);
  const coachIntent = detectCoachIntent(lastUserText);
  const coachPlan = coachIntent ? getCoachPlan() : null;
  const coachContext = coachIntent
    ? buildCoachContext(coachPlan, context, lastUserText)
    : "";

  const todaySummary = `Hoy: comida ${context.todaySummary.food}, entrenamiento ${context.todaySummary.training}.`;
  const weekSummary = `Ultimos 7 dias: comida ${context.weekSummary.food}, entrenamiento ${context.weekSummary.training}.`;
  const systemContext = [weekSummary, selectedFilesContext, coachContext].filter(Boolean).join("\n");

  if (coachIntent && !process.env.OPENAI_API_KEY) {
    const fallbackText = buildCoachFallbackResponse(lastUserText, coachPlan);
    onToken(fallbackText);
    if (isWeeklyPlanRequest(lastUserText)) {
      saveWeeklyPlanFromContent(fallbackText);
    }
    return { ...(createAssistantTextEvent(fallbackText) as ChatEvent), turnId };
  }

  const responseText = await streamAssistantReply({
    messages,
    todaySummary,
    weekSummary: systemContext,
    onToken,
  });

  if (coachIntent && isWeeklyPlanRequest(lastUserText)) {
    saveWeeklyPlanFromContent(responseText);
  }

  return { ...(createAssistantTextEvent(responseText) as ChatEvent), turnId };
}

export async function streamAssistantReplyForFile(args: {
  events: ChatEvent[];
  fileEvent: FileChatEventWithFile;
  fileData: string;
  turnId: string;
  updateEvents: EventsUpdater;
  persistEvents: PersistEvents;
  onToken: (chunk: string) => void;
  selectedFileIds?: string[];
}): Promise<ChatEvent> {
  const { fileEvent, fileData, turnId, updateEvents, persistEvents, onToken } = args;
  const selectedFileIds = args.selectedFileIds ?? [];
  let latestEvents = args.events;

  const pendingEvent: FileChatEventWithFile = {
    ...fileEvent,
    turnId,
    file: {
      ...fileEvent.file,
      ingest: { status: "pending" as const },
    },
  };

  updateEvents((prev) => {
    const next = [...prev, pendingEvent];
    latestEvents = next;
    persistEvents(next);
    return next;
  });

  if (fileData.trim().toLowerCase() === "unsupported for now") {
    updateEvents((prev) => {
      const next = prev.map((item) =>
        item.id === pendingEvent.id && item.type === "file"
          ? {
              ...item,
              file: {
                ...(item.file ?? pendingEvent.file),
                name: (item.file ?? pendingEvent.file).name,
                ingest: { status: "error" as const, error: "PDF unsupported for now" },
              },
            }
          : item
      );
      latestEvents = next;
      persistEvents(next);
      return next;
    });
  } else {
    try {
      const ingestResult = await ingestFile({
        name: fileEvent.file.name,
        mimeType: fileEvent.file.mimeType,
        sizeBytes: fileEvent.file.sizeBytes,
        fileData,
      });

      updateEvents((prev) => {
        const next = prev.map((item) =>
          item.id === pendingEvent.id && item.type === "file"
            ? {
                ...item,
                file: {
                  ...(item.file ?? pendingEvent.file),
                  name: (item.file ?? pendingEvent.file).name,
                  ingest: {
                    status: "done" as const,
                    extractedText: ingestResult.extractedText,
                    summary: ingestResult.summary,
                  },
                },
              }
            : item
        );
        latestEvents = next;
        persistEvents(next);
        return next;
      });
    } catch (error) {
      updateEvents((prev) => {
        const next = prev.map((item) =>
          item.id === pendingEvent.id && item.type === "file"
            ? {
                ...item,
                file: {
                  ...(item.file ?? pendingEvent.file),
                  name: (item.file ?? pendingEvent.file).name,
                  ingest: {
                    status: "error" as const,
                    error: error instanceof Error ? error.message : "Ingestion failed",
                  },
                },
              }
            : item
        );
        latestEvents = next;
        persistEvents(next);
        return next;
      });
    }
  }

  const context = buildAIContext(latestEvents);
  const messages = buildLLMMessages(latestEvents);
  const selectedFilesContext = buildSelectedFilesContext(latestEvents, selectedFileIds);
  const lastUserText = getLatestUserText(latestEvents);
  const coachIntent = detectCoachIntent(lastUserText);
  const coachPlan = coachIntent ? getCoachPlan() : null;
  const coachContext = coachIntent
    ? buildCoachContext(coachPlan, context, lastUserText)
    : "";

  const todaySummary = `Hoy: comida ${context.todaySummary.food}, entrenamiento ${context.todaySummary.training}.`;
  const weekSummary = `Ultimos 7 dias: comida ${context.weekSummary.food}, entrenamiento ${context.weekSummary.training}.`;
  const systemContext = [weekSummary, selectedFilesContext, coachContext].filter(Boolean).join("\n");

  if (coachIntent && !process.env.OPENAI_API_KEY) {
    const fallbackText = buildCoachFallbackResponse(lastUserText, coachPlan);
    onToken(fallbackText);
    if (isWeeklyPlanRequest(lastUserText)) {
      saveWeeklyPlanFromContent(fallbackText);
    }
    return { ...(createAssistantTextEvent(fallbackText) as ChatEvent), turnId };
  }

  const responseText = await streamAssistantReply({
    messages,
    todaySummary,
    weekSummary: systemContext,
    onToken,
  });

  if (coachIntent && isWeeklyPlanRequest(lastUserText)) {
    saveWeeklyPlanFromContent(responseText);
  }

  return { ...(createAssistantTextEvent(responseText) as ChatEvent), turnId };
}

function buildSelectedFilesContext(events: ChatEvent[], selectedFileIds: string[]): string {
  if (!Array.isArray(selectedFileIds) || selectedFileIds.length === 0) return "";
  const selected: Array<{
    name: string | undefined;
    mimeType: string | undefined;
    summary: string | undefined;
    excerpt: string | undefined;
  }> = [];

  for (const event of events) {
    if (selected.length >= MAX_SELECTED_FILES) break;
    if (event.type !== "file") continue;
    if (!selectedFileIds.includes(event.id)) continue;

    const ingest = event.file?.ingest;
    if (ingest?.status !== "done" || !ingest.summary) continue;

    const excerpt =
      ingest.extractedText && ingest.extractedText.length > 0
        ? ingest.extractedText.slice(0, MAX_SELECTED_EXCERPT_CHARS)
        : undefined;

    selected.push({
      name: event.file?.name,
      mimeType: event.file?.mimeType,
      summary: ingest.summary,
      excerpt,
    });
  }

  if (selected.length === 0) return "";
  return `SelectedFiles: ${JSON.stringify(selected)}`;
}

function isWeeklyPlanRequest(messageText: string): boolean {
  const text = messageText.toLowerCase();
  return (
    text.includes("plan semanal") ||
    text.includes("plan de la semana") ||
    text.includes("meal plan") ||
    text.includes("training plan") ||
    text.includes("entrenamiento semanal") ||
    text.includes("plan de entrenamiento") ||
    text.includes("plan de comidas")
  );
}

function getLatestUserText(events: ChatEvent[]): string {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const event = events[i];
    if (event.role !== "user") continue;
    if (event.type === "text") return event.text.trim();
    if (event.type === "voice") return event.content.trim();
  }
  return "";
}

function buildCoachContext(
  plan: CoachPlan | null,
  context: ReturnType<typeof buildAIContext>,
  messageText: string
): string {
  const coachPlanBlock = plan ? `CoachPlan: ${JSON.stringify(plan)}` : "";
  const todaySummary = `TodaySummary: comida ${context.todaySummary.food}, entrenamiento ${context.todaySummary.training}.`;
  const weekSummary = `WeekSummary: comida ${context.weekSummary.food}, entrenamiento ${context.weekSummary.training}.`;
  const recentEvents = formatRecentEvents(context.recentEvents);
  const planHint = isWeeklyPlanRequest(messageText)
    ? "Si piden plan semanal, entrega un plan semanal en bullets para lunes-domingo."
    : "";
  const checkInHint = isCheckInRequest(messageText)
    ? "Si piden check-in, pregunta por comida, entrenamiento, peso y habitos."
    : "";
  return [
    COACH_SYSTEM_PROMPT,
    coachPlanBlock,
    todaySummary,
    weekSummary,
    recentEvents,
    planHint,
    checkInHint,
  ]
    .filter(Boolean)
    .join("\n");
}

function formatRecentEvents(events: ChatEvent[]): string {
  const recent = events.slice(-6).map((event) => {
    if (event.type === "text") return `${event.role}: ${truncateText(event.text, 120)}`;
    if (event.type === "voice") return `${event.role}: ${truncateText(event.content, 120)}`;
    if (event.type === "image") return `${event.role}: [imagen]`;
    if (event.type === "file") return `${event.role}: [archivo]`;
    return "";
  });
  if (recent.length === 0) return "";
  return `RecentEvents: ${recent.join(" | ")}`;
}

function buildCoachFallbackResponse(messageText: string, plan: CoachPlan | null): string {
  if (isWeeklyPlanRequest(messageText)) {
    return buildDeterministicWeeklyPlanContent(plan);
  }
  if (isCheckInRequest(messageText)) {
    return [
      "Check-in diario:",
      "1) Comida: cumpliste tu objetivo hoy?",
      "2) Entreno: hiciste sesion? que tipo?",
      "3) Peso: te pesaste o notas cambios?",
      "4) Habitos: que salio bien y que fue dificil?",
      "Si quieres, dime 1 ajuste simple para manana.",
    ].join("\n");
  }
  return "Estoy aqui para ayudarte con objetivos de comida, entrenamiento y habitos. Que necesitas?";
}

function buildDeterministicWeeklyPlanContent(plan: CoachPlan | null): string {
  const goals = plan?.goals ?? {};
  const lines: string[] = [];
  lines.push("Plan semanal (basico):");
  lines.push("- Lunes: fuerza + 20-30 min caminata.");
  lines.push("- Martes: comida enfocada en proteina y verduras.");
  lines.push("- Miercoles: entrenamiento segun objetivo.");
  lines.push("- Jueves: descanso activo + movilidad.");
  lines.push("- Viernes: sesion principal de la semana.");
  lines.push("- Sabado: actividad ligera y balance calorico.");
  lines.push("- Domingo: revisar progreso y planificar.");
  if (goals.nutrition) {
    lines.push(`Objetivo nutricion: ${formatGoalValue(goals.nutrition)}.`);
  }
  if (goals.training) {
    lines.push(`Objetivo entrenamiento: ${formatGoalValue(goals.training)}.`);
  }
  if (goals.weight) {
    lines.push(`Objetivo peso: ${formatGoalValue(goals.weight)}.`);
  }
  if (Array.isArray(goals.habits) && goals.habits.length > 0) {
    lines.push(`Habitos clave: ${goals.habits.join(", ")}.`);
  }
  return lines.join("\n");
}

function formatGoalValue(value: CoachPlan["goals"][keyof CoachPlan["goals"]]): string {
  if (!value) return "";
  if (typeof value === "string") return value;
  const entries = Object.entries(value)
    .filter(([, v]) => v !== undefined && v !== null)
    .map(([key, val]) => `${key}:${val}`);
  return entries.length > 0 ? entries.join(", ") : "";
}

function saveWeeklyPlanFromContent(content: string): void {
  const now = new Date();
  const weekStartISO = getWeekStartISO(now);
  const generatedAtISO = now.toISOString();
  upsertCoachPlan({
    weeklyPlan: {
      weekStartISO,
      content: content.trim(),
      generatedAtISO,
    },
  });
}

function getWeekStartISO(date: Date): string {
  const day = date.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  const monday = new Date(date);
  monday.setDate(date.getDate() + diff);
  monday.setHours(0, 0, 0, 0);
  return monday.toISOString().slice(0, 10);
}

function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1)}...`;
}

export const __test__ = {
  buildCoachContext,
  isWeeklyPlanRequest,
  isCheckInRequest,
};
