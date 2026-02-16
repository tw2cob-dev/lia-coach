import { buildAIContext, buildLLMMessages } from "../aiContext";
import { AIReplyDebug, generateAssistantReply, streamAssistantReply } from "../aiClient";
import { ChatEvent, FileChatEventWithFile, createAssistantTextEvent } from "../chatEvents";
import { CoachPlan, getCoachPlan, upsertCoachPlan } from "../coachPlan";
import { COACH_SYSTEM_PROMPT } from "../prompts/coachPrompt";
import { ingestFile } from "../fileIngestion";
import { detectCoachIntent, isCheckInRequest } from "./coachIntent";

type EventsUpdater = (updater: (prev: ChatEvent[]) => ChatEvent[]) => void;
type PersistEvents = (events: ChatEvent[]) => void;

const MAX_SELECTED_FILES = 3;
const MAX_SELECTED_EXCERPT_CHARS = 2000;
const MAX_USER_MEMORY_CHARS = 2400;
type CognitiveProfile = NonNullable<CoachPlan["cognitiveProfile"]>;

export async function createAssistantReply(
  events: ChatEvent[],
  turnId?: string,
  selectedFileIds: string[] = [],
  userName?: string,
  onDebug?: (debug: AIReplyDebug) => void
): Promise<ChatEvent> {
  const context = buildAIContext(events);
  const messages = buildLLMMessages(events);
  const selectedFilesContext = buildSelectedFilesContext(events, selectedFileIds);
  const lastUserText = getLatestUserText(events);
  const coachPlan = getPlanWithCognitiveUpdate(lastUserText);
  const coachIntent = detectCoachIntent(lastUserText);
  const coachContext = coachIntent ? buildCoachContext(coachPlan, context, lastUserText) : "";
  const userMemoryContext = buildUserMemoryContext(coachPlan, context);

  const todaySummary = `Hoy: comida ${context.todaySummary.food}, entrenamiento ${context.todaySummary.training}.`;
  const plainWeekSummary = `Ultimos 7 dias: comida ${context.weekSummary.food}, entrenamiento ${context.weekSummary.training}.`;
  const systemContext = coachContext
    ? [userMemoryContext, selectedFilesContext, coachContext].filter(Boolean).join("\n")
    : [plainWeekSummary, userMemoryContext, selectedFilesContext].filter(Boolean).join("\n");

  const responseText = await generateAssistantReply({
    messages,
    todaySummary,
    weekSummary: systemContext,
    userName,
    onDebug,
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
  selectedFileIds: string[] = [],
  userName?: string,
  onDebug?: (debug: AIReplyDebug) => void
): Promise<ChatEvent> {
  const context = buildAIContext(events);
  const messages = buildLLMMessages(events);
  const selectedFilesContext = buildSelectedFilesContext(events, selectedFileIds);
  const lastUserText = getLatestUserText(events);
  const coachPlan = getPlanWithCognitiveUpdate(lastUserText);
  const coachIntent = detectCoachIntent(lastUserText);
  const coachContext = coachIntent ? buildCoachContext(coachPlan, context, lastUserText) : "";
  const userMemoryContext = buildUserMemoryContext(coachPlan, context);

  const todaySummary = `Hoy: comida ${context.todaySummary.food}, entrenamiento ${context.todaySummary.training}.`;
  const plainWeekSummary = `Ultimos 7 dias: comida ${context.weekSummary.food}, entrenamiento ${context.weekSummary.training}.`;
  const systemContext = coachContext
    ? [userMemoryContext, selectedFilesContext, coachContext].filter(Boolean).join("\n")
    : [plainWeekSummary, userMemoryContext, selectedFilesContext].filter(Boolean).join("\n");

  const responseText = await streamAssistantReply({
    messages,
    todaySummary,
    weekSummary: systemContext,
    userName,
    onToken,
    onDebug,
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
  userName?: string;
  onDebug?: (debug: AIReplyDebug) => void;
}): Promise<ChatEvent> {
  const { fileEvent, fileData, turnId, updateEvents, persistEvents, onToken } = args;
  const selectedFileIds = args.selectedFileIds ?? [];
  const userName = args.userName;
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
  const coachPlan = getPlanWithCognitiveUpdate(lastUserText);
  const coachIntent = detectCoachIntent(lastUserText);
  const coachContext = coachIntent ? buildCoachContext(coachPlan, context, lastUserText) : "";
  const userMemoryContext = buildUserMemoryContext(coachPlan, context);

  const todaySummary = `Hoy: comida ${context.todaySummary.food}, entrenamiento ${context.todaySummary.training}.`;
  const plainWeekSummary = `Ultimos 7 dias: comida ${context.weekSummary.food}, entrenamiento ${context.weekSummary.training}.`;
  const systemContext = coachContext
    ? [userMemoryContext, selectedFilesContext, coachContext].filter(Boolean).join("\n")
    : [plainWeekSummary, userMemoryContext, selectedFilesContext].filter(Boolean).join("\n");

  const responseText = await streamAssistantReply({
    messages,
    todaySummary,
    weekSummary: systemContext,
    userName,
    onToken,
    onDebug: args.onDebug,
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
  plan: CoachPlan,
  context: ReturnType<typeof buildAIContext>,
  messageText: string
): string {
  const recentEvents = formatRecentEvents(context.recentEvents);
  const styleHint = buildStyleHint(
    messageText,
    plan.cognitiveProfile ?? createDefaultCognitiveProfile(),
    resolveMaxQuestionsPerTurn(plan)
  );
  const missingDataHint = buildMissingDataHint(plan.physicalProfile);
  const planHint = isWeeklyPlanRequest(messageText)
    ? "Si piden plan semanal, entrega un plan semanal en bullets para lunes-domingo."
    : "";
  const checkInHint = isCheckInRequest(messageText)
    ? "Si piden check-in, pregunta por comida, entrenamiento, peso y habitos."
    : "";
  return [
    COACH_SYSTEM_PROMPT,
    recentEvents,
    styleHint,
    missingDataHint,
    planHint,
    checkInHint,
  ]
    .filter(Boolean)
    .join("\n");
}

function buildUserMemoryContext(
  plan: CoachPlan,
  context: ReturnType<typeof buildAIContext>
): string {
  const memory = {
    cognitiveProfile: plan.cognitiveProfile ?? createDefaultCognitiveProfile(),
    goals: plan.goals ?? {},
    weeklyPlan: plan.weeklyPlan
      ? {
          weekStartISO: plan.weeklyPlan.weekStartISO,
          summary: truncateText(plan.weeklyPlan.content, 320),
        }
      : undefined,
    signals: {
      todayFood: context.todaySummary.food,
      todayTraining: context.todaySummary.training,
      weekFood: context.weekSummary.food,
      weekTraining: context.weekSummary.training,
      lastWeight: context.weekSummary.lastWeight,
    },
  };
  return `UserMemory: ${truncateText(JSON.stringify(memory), MAX_USER_MEMORY_CHARS)}`;
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

function buildCoachFallbackResponse(
  messageText: string,
  plan: CoachPlan,
  userName?: string
): string {
  const namePrefix = buildNamePrefix(messageText, userName);
  const profile = plan.cognitiveProfile ?? createDefaultCognitiveProfile();
  const stylePrefix = profile.estilo === "serio" ? "" : "Perfecto. ";
  const normalized = normalizeText(messageText);

  if (isWeeklyPlanRequest(messageText)) {
    return `${namePrefix}${stylePrefix}${buildDeterministicWeeklyPlanContent(plan)}`;
  }
  if (isWeightLossRequest(normalized)) {
    return [
      `${namePrefix}🔥 Objetivo: perder peso sin extremos`,
      "",
      `${stylePrefix}vamos con base simple y sostenible:`,
      "- Deficit suave (sin pasar hambre).",
      "- Proteina en 3-4 tomas al dia.",
      "- Pasos diarios + fuerza 2-4 dias por semana.",
      "",
      "✅ Siguiente paso: dime que has comido hoy y que ejercicio hiciste (o haras) para actualizar tu marcador.",
    ].join("\n");
  }
  if (isLowEnergyRequest(normalized)) {
    return [
      `${namePrefix}⚠️ Vamos a priorizar energia y seguridad`,
      "",
      "Primero: es cansancio normal o te encuentras mal?",
      "",
      "✅ Si es cansancio normal: hoy minimo viable -> paseo suave + cena simple con proteina y verdura.",
      "⚠️ Si hay malestar real: mejor bajar carga y consultar profesional si empeora.",
    ].join("\n");
  }
  if (isOvereatRequest(normalized)) {
    return [
      `${namePrefix}✅ No pasa nada, se puede reequilibrar hoy`,
      "",
      "Sin castigos ni compensaciones extremas.",
      "",
      "🧠 Siguiente paso: dime que has comido (aprox) y te digo el mejor ajuste para el resto del dia.",
    ].join("\n");
  }
  if (isCheckInRequest(messageText)) {
    return [
      `${namePrefix}🧠 Check-in diario`,
      "",
      "1) Comida: cumpliste tu objetivo hoy?",
      "2) Entreno: hiciste sesion? que tipo?",
      "3) Energia/descanso: como llegas hoy y que habito te costo mas?",
      "",
      "✅ Siguiente paso: si quieres, dime 1 ajuste simple para manana.",
    ].join("\n");
  }
  if (isGreetingMessage(normalized)) {
    return `${namePrefix}hola.\n\n✅ Dime en una frase que quieres mejorar hoy y te propongo un plan simple.`;
  }
  if (/\bhablame mas simple|mas simple|no entiendo\b/.test(normalized)) {
    return `${namePrefix}✅ Perfecto. Te lo digo simple y directo: vamos a lo basico que si funciona.`;
  }
  if (/\bmas tecnico|ultra tecnico|tecnico\b/.test(normalized)) {
    return `${namePrefix}🧠 Perfecto. Subo nivel tecnico y te doy respuestas mas precisas desde ahora.`;
  }
  if (/\bultra resumido\b/.test(normalized)) {
    return `${namePrefix}1) Agua.\n2) Proteina en la cena.\n3) 20 min de paseo.\n\n✅ Manana afinamos.`;
  }
  if (/\bbromas|humor\b/.test(normalized)) {
    return `${namePrefix}Hecho. Broma corta y seguimos: disciplina > drama.\n\n✅ Que has comido hoy?`;
  }
  if (isProteinTimingQuestion(normalized)) {
    return [
      `${namePrefix}🧠 Buena pregunta.`,
      "",
      "Tomar proteina en 3-4 tomas ayuda a repartir mejor el estimulo muscular y a llegar mas facil al total diario.",
      "",
      "🔥 En la practica:",
      "- Objetivo principal: llegar a tu proteina total del dia.",
      "- Repartirla reduce picos de hambre y suele mejorar adherencia.",
      "- Si un dia haces 2 tomas y cumples total, tambien sirve.",
      "",
      "✅ Regla simple: prioriza el total diario; reparte en 3-4 tomas cuando te sea comodo.",
    ].join("\n");
  }
  if (isWhyQuestion(normalized)) {
    return [
      `${namePrefix}🧠 Te explico rapido el por que:`,
      "",
      "- Buscamos una estrategia efectiva y sostenible.",
      "- Por eso priorizamos adherencia, hambre controlada y progreso semanal.",
      "",
      "✅ Si quieres, te lo bajo a tu caso con tus horarios y comidas reales.",
    ].join("\n");
  }
  return `${namePrefix}${stylePrefix}\n\n🔥 Foco principal ahora: registrar comida y ejercicio para actualizar tu progreso.\n\n✅ Dime que has comido hoy y que actividad hiciste.`;
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

function buildNamePrefix(messageText: string, userName?: string): string {
  if (!userName) return "";
  const text = messageText.trim().toLowerCase();
  if (!text) return `${userName}, `;
  const shouldUseName =
    text.length <= 35 ||
    /^(hola|buenas|hey|lia|oy[e]?|necesito|ayudame|ayudame con)/.test(text) ||
    /(agobiado|agobiada|estresado|estresada|cansado|cansada|desmotivad)/.test(text);
  return shouldUseName ? `${userName}, ` : "";
}

function getPlanWithCognitiveUpdate(messageText: string): CoachPlan {
  const currentPlan = getCoachPlan() ?? upsertCoachPlan({});
  const currentProfile = currentPlan.cognitiveProfile ?? createDefaultCognitiveProfile();
  const currentPhysical = currentPlan.physicalProfile ?? {};
  const nextProfile = evolveCognitiveProfile(currentProfile, messageText);
  const nextPhysical = evolvePhysicalProfile(currentPhysical, messageText);
  if (isSameProfile(currentProfile, nextProfile) && isSamePhysicalProfile(currentPhysical, nextPhysical)) {
    return currentPlan;
  }
  return upsertCoachPlan({ cognitiveProfile: nextProfile, physicalProfile: nextPhysical });
}

function evolveCognitiveProfile(profile: CognitiveProfile, messageText: string): CognitiveProfile {
  if (!messageText.trim()) return profile;
  const normalized = normalizeText(messageText);
  const override = parseStyleOverride(normalized);

  let score = profile.score_tecnico + getTechnicalScoreDelta(normalized);
  if (override.forceSimpler) score -= 4;
  if (override.forceTechnical) score += 4;
  score = clampScore(score);

  let nivel = levelFromScore(score, profile.nivel_tecnico);
  if (override.forceSimpler) {
    nivel = downgradeLevel(nivel);
  }
  if (override.forceTechnical) {
    nivel = upgradeLevel(nivel);
  }

  const estilo = override.estilo ?? profile.estilo;
  const preferencia_detalle =
    override.preferencia_detalle ?? detailFromLevel(nivel, profile.preferencia_detalle);

  return {
    nivel_tecnico: nivel,
    score_tecnico: score,
    estilo,
    preferencia_detalle,
  };
}

function parseStyleOverride(normalizedText: string): {
  forceTechnical: boolean;
  forceSimpler: boolean;
  estilo?: CognitiveProfile["estilo"];
  preferencia_detalle?: CognitiveProfile["preferencia_detalle"];
} {
  const forceTechnical = /\bmas tecnico|ultra tecnico|tecnico\b/.test(normalizedText);
  const forceSimpler =
    /\bmas simple|hablame simple|explicalo simple|no entiendo|en cristiano\b/.test(normalizedText);
  const estilo = /\bultra resumido\b/.test(normalizedText)
    ? "ultra_resumido"
    : /\btono serio|serio\b/.test(normalizedText)
    ? "serio"
    : /\bbromas|humor\b/.test(normalizedText)
    ? "humor_sutil"
    : undefined;
  const preferencia_detalle = /\bultra resumido\b/.test(normalizedText)
    ? "bajo"
    : forceTechnical
    ? "alto"
    : forceSimpler
    ? "bajo"
    : undefined;

  return { forceTechnical, forceSimpler, estilo, preferencia_detalle };
}

function getTechnicalScoreDelta(normalizedText: string): number {
  let delta = 0;
  if (/\b\d+([.,]\d+)?\s?(kcal|cal|kg|g|ml|%|rpe|vo2|max|g\/kg)\b/.test(normalizedText)) delta += 2;
  if (
    /\bmps|deficit calorico|fatiga central|neat|rpe|glucogeno|vo2max|periodizacion|volumen\b/.test(
      normalizedText
    )
  ) {
    delta += 2;
  }
  if (/\bpor que|como funciona|evidencia|mecanismo|estudio|paper\b/.test(normalizedText)) {
    delta += 2;
  }
  if (/\bmas tecnico|ultra tecnico|explicalo tecnico\b/.test(normalizedText)) {
    delta += 3;
  }
  if (/\bmas simple|no entiendo|en cristiano|sin tecnicismos\b/.test(normalizedText)) {
    delta -= 3;
  }
  return delta;
}

function levelFromScore(score: number, current: CognitiveProfile["nivel_tecnico"]) {
  if (score >= 20) return "ultra" as const;
  if (score >= 12) return "tecnico" as const;
  if (score >= 5) return "medio" as const;
  if (current === "ultra" && score < 10) return "tecnico" as const;
  if ((current === "ultra" || current === "tecnico") && score < 5 && score > 0) return "medio" as const;
  if (score <= 0) return "basico" as const;
  return current === "basico" ? "basico" : "medio";
}

function detailFromLevel(
  level: CognitiveProfile["nivel_tecnico"],
  fallback: CognitiveProfile["preferencia_detalle"]
): CognitiveProfile["preferencia_detalle"] {
  if (level === "basico") return "bajo";
  if (level === "medio") return "medio";
  if (level === "tecnico" || level === "ultra") return "alto";
  return fallback;
}

function upgradeLevel(level: CognitiveProfile["nivel_tecnico"]): CognitiveProfile["nivel_tecnico"] {
  if (level === "basico") return "medio";
  if (level === "medio") return "tecnico";
  return "ultra";
}

function downgradeLevel(level: CognitiveProfile["nivel_tecnico"]): CognitiveProfile["nivel_tecnico"] {
  if (level === "ultra") return "tecnico";
  if (level === "tecnico") return "medio";
  return "basico";
}

function clampScore(score: number): number {
  if (!Number.isFinite(score)) return 0;
  return Math.max(0, Math.round(score));
}

function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function isGreetingMessage(text: string): boolean {
  return /^(hola+|holaaaa+|buenas+|hey+|que tal|lia+)\b/.test(text);
}

function isWeightLossRequest(text: string): boolean {
  return /\b(perder peso|bajar peso|bajar grasa|deficit)\b/.test(text);
}

function isLowEnergyRequest(text: string): boolean {
  return /\b(reventado|sin energia|cansado|agotado)\b/.test(text);
}

function isOvereatRequest(text: string): boolean {
  return /\b(comi fatal|he comido fatal|me pase comiendo|comi demasiado)\b/.test(text);
}

function isProteinTimingQuestion(text: string): boolean {
  return (
    /\b(por que|porque)\b/.test(text) &&
    /\b(proteina|proteinas|toma|tomas|3|4)\b/.test(text)
  );
}

function isWhyQuestion(text: string): boolean {
  return /\b(por que|porque)\b/.test(text);
}

function createDefaultCognitiveProfile(): CognitiveProfile {
  return {
    nivel_tecnico: "basico",
    score_tecnico: 0,
    estilo: "neutral",
    preferencia_detalle: "medio",
  };
}

function evolvePhysicalProfile(
  profile: NonNullable<CoachPlan["physicalProfile"]>,
  messageText: string
): NonNullable<CoachPlan["physicalProfile"]> {
  const text = normalizeText(messageText);
  const next = { ...profile };

  if (!next.sex) {
    if (/\b(hombre|masculino|varon)\b/.test(text)) next.sex = "male";
    if (/\b(mujer|femenino)\b/.test(text)) next.sex = "female";
  }
  if (!next.ageYears) {
    const age = text.match(/\b(\d{2})\s*(anos|años)\b/);
    if (age) next.ageYears = clampRange(Number(age[1]), 12, 100);
  }
  if (!next.heightCm) {
    const h = text.match(/\b(1[4-9]\d|2[0-2]\d)\s*cm\b/);
    if (h) next.heightCm = clampRange(Number(h[1]), 120, 230);
  }
  {
    const w = text.match(/\b(\d{2,3}(?:[.,]\d+)?)\s*kg\b/);
    if (w) next.weightKg = clampRange(Number(w[1].replace(",", ".")), 35, 250);
  }
  if (!next.bodyFatPct) {
    const bf = text.match(/\b(\d{1,2})\s*%\s*(grasa|bf)?\b/);
    if (bf) next.bodyFatPct = clampRange(Number(bf[1]), 3, 70);
  }
  if (!next.activityLevel) {
    if (/\bsedentari/.test(text)) next.activityLevel = "sedentary";
    if (/\bligera|ligero\b/.test(text)) next.activityLevel = "light";
    if (/\bmoderad/.test(text)) next.activityLevel = "moderate";
    if (/\balta|intensa|muy activa/.test(text)) next.activityLevel = "very";
  }

  return next;
}

function isSamePhysicalProfile(
  a: NonNullable<CoachPlan["physicalProfile"]>,
  b: NonNullable<CoachPlan["physicalProfile"]>
): boolean {
  return (
    a.sex === b.sex &&
    a.ageYears === b.ageYears &&
    a.heightCm === b.heightCm &&
    a.weightKg === b.weightKg &&
    a.bodyFatPct === b.bodyFatPct &&
    a.activityLevel === b.activityLevel
  );
}

function buildMissingDataHint(profile?: CoachPlan["physicalProfile"]): string {
  const p = profile ?? {};
  const missing: string[] = [];
  if (!p.sex) missing.push("sexo");
  if (!p.ageYears) missing.push("edad");
  if (!p.heightCm) missing.push("altura");
  if (!p.weightKg) missing.push("peso");
  if (!p.activityLevel) missing.push("actividad base");
  if (missing.length === 0) {
    return "Datos energeticos completos. Ahora si, pide registro de comida y ejercicio del dia para actualizar progreso.";
  }
  return `Fase actual: completar estimacion energetica. Enumera y pide juntos estos faltantes: ${missing.join(", ")}. Puedes registrar comida/ejercicio del dia, pero no cierres objetivo calorico final aun.`;
}

function clampRange(value: number, min: number, max: number): number | undefined {
  if (!Number.isFinite(value)) return undefined;
  if (value < min || value > max) return undefined;
  return Math.round(value * 10) / 10;
}

function isSameProfile(a: CognitiveProfile, b: CognitiveProfile): boolean {
  return (
    a.nivel_tecnico === b.nivel_tecnico &&
    a.score_tecnico === b.score_tecnico &&
    a.estilo === b.estilo &&
    a.preferencia_detalle === b.preferencia_detalle
  );
}

function buildStyleHint(
  messageText: string,
  profile: CognitiveProfile,
  maxQuestionsPerTurn: number
): string {
  const normalized = normalizeText(messageText);
  const override = parseStyleOverride(normalized);
  const levelHint =
    profile.nivel_tecnico === "basico"
      ? "Nivel basico: lenguaje cotidiano, pocas cifras, una accion clara, sin formulas."
      : profile.nivel_tecnico === "medio"
      ? "Nivel medio: incluye alguna cifra y un por que breve."
      : profile.nivel_tecnico === "tecnico"
      ? "Nivel tecnico: usa terminos fisiologicos con precision y rangos breves."
      : "Nivel ultra: explica mecanismos de forma concisa y comparativa.";
  const styleHint =
    override.estilo === "ultra_resumido" || profile.estilo === "ultra_resumido"
      ? "Estilo ultra resumido: maximo 4 lineas y termina con una accion concreta."
      : override.estilo === "serio" || profile.estilo === "serio"
      ? "Tono serio: directo, claro y sin bromas."
      : override.estilo === "humor_sutil" || profile.estilo === "humor_sutil"
      ? "Humor sutil permitido: una broma corta maximo."
      : "Tono neutral cercano y maduro.";
  return `${levelHint} ${styleHint} Haz como maximo ${maxQuestionsPerTurn} pregunta(s) por turno. Trabaja por fases: primero datos energeticos faltantes; luego registro de comida/ejercicio del dia. Nutricion detallada solo bajo peticion explicita.`;
}

function resolveMaxQuestionsPerTurn(plan: CoachPlan): number {
  const configured = plan.preferences?.maxQuestionsPerTurn;
  if (typeof configured === "number" && Number.isFinite(configured)) {
    return Math.min(3, Math.max(1, Math.round(configured)));
  }
  const level = plan.cognitiveProfile?.nivel_tecnico;
  if (level === "tecnico" || level === "ultra") return 2;
  return 1;
}

export const __test__ = {
  buildCoachContext,
  buildCoachFallbackResponse,
  isWeeklyPlanRequest,
  isCheckInRequest,
};
