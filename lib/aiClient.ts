import { LIA_WELCOME_CONTEXT_HINT } from "./chat/welcomeMessage";

type LLMMessage = {
  role: "user" | "assistant";
  content: string;
};

export type AIReplyDebug = {
  source: "ai" | "fallback";
  model?: string;
  temperature?: number;
  maxTokens?: number;
  finishReason?: string;
  systemContent?: string;
  messagesCount?: number;
  lastUserMessage?: string;
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } | null;
  reason?: string;
};

const MAX_CHAT_MESSAGES = 12;
const MAX_OUTPUT_TOKENS = 220;
const TEMPERATURE = 0.4;
const MODEL_NAME = "gpt-4o-mini";

export async function generateAssistantReply(args: {
  messages: LLMMessage[];
  todaySummary: string;
  weekSummary: string;
  userName?: string;
  onDebug?: (debug: AIReplyDebug) => void;
}): Promise<string> {
  const windowed = windowMessages(args.messages, MAX_CHAT_MESSAGES);
  if (windowed.length === 0) {
    return safeFallback();
  }

  const systemContent = buildSystemContent(args.todaySummary, args.weekSummary, args.userName);
  const startMs = Date.now();

  try {
    const response = await fetch("/api/ai/reply", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: windowed,
        systemContent,
        model: MODEL_NAME,
        temperature: TEMPERATURE,
        maxTokens: MAX_OUTPUT_TOKENS,
        debug: true,
      }),
    });

    const durationMs = Date.now() - startMs;
    if (!response.ok) {
      logMetrics({
        durationMs,
        messagesCountSent: windowed.length,
        finishReason: "http_error",
      });
      args.onDebug?.({ source: "fallback", reason: `http_${response.status}` });
      return safeFallback();
    }

    const data = (await response.json()) as {
      text?: string;
      usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
      debug?: Omit<AIReplyDebug, "source" | "usage">;
    };

    const content = sanitizeAssistantOutput(data.text?.trim() ?? "", data.debug?.finishReason);
    logMetrics({
      durationMs,
      messagesCountSent: windowed.length,
      finishReason: "server_reply",
      usage: data.usage,
    });
    args.onDebug?.({
      source: "ai",
      model: data.debug?.model,
      temperature: data.debug?.temperature,
      maxTokens: data.debug?.maxTokens,
      finishReason: data.debug?.finishReason,
      systemContent: data.debug?.systemContent,
      messagesCount: data.debug?.messagesCount,
      lastUserMessage: data.debug?.lastUserMessage,
      usage: data.usage ?? null,
    });

    if (!content) {
      args.onDebug?.({ source: "fallback", reason: "empty_ai_text" });
      return safeFallback();
    }

    return content;
  } catch {
    logMetrics({
      durationMs: Date.now() - startMs,
      messagesCountSent: windowed.length,
      finishReason: "exception",
    });
    args.onDebug?.({ source: "fallback", reason: "exception" });
    return safeFallback();
  }
}

export async function streamAssistantReply(args: {
  messages: LLMMessage[];
  todaySummary: string;
  weekSummary: string;
  userName?: string;
  onToken: (chunk: string) => void;
  onDebug?: (debug: AIReplyDebug) => void;
}): Promise<string> {
  const text = await generateAssistantReply(args);
  args.onToken(text);
  return text;
}

function windowMessages(messages: LLMMessage[], maxMessages: number): LLMMessage[] {
  if (!Array.isArray(messages) || maxMessages <= 0) return [];
  if (messages.length <= maxMessages) return [...messages];
  return messages.slice(-maxMessages);
}

function buildSystemContent(todaySummary: string, weekSummary: string, userName?: string): string {
  const userNameRule = userName
    ? `El nombre del usuario es "${userName}". Puedes usarlo cuando aporte cercania, pero no en cada respuesta.`
    : "";
  const hasAdvancedContext =
    weekSummary.includes("CoachPlan:") ||
    weekSummary.includes("perfil_cognitivo:") ||
    weekSummary.includes("SelectedFiles:") ||
    weekSummary.includes("UserMemory:");

  return [
    "You are LIA Coach.",
    "Responde en espanol con tono natural, cercano y maduro.",
    "Puedes responder consultas generales de otros temas de forma breve y util.",
    "Mantienes como foco principal nutricion, comida, entrenamiento, peso y habitos.",
    "Si la consulta es fuera de foco, responde primero y luego reconduce con naturalidad al foco cuando aporte valor.",
    "Adapta nivel tecnico y estilo a lo que pida el usuario sin comprometer seguridad ni veracidad.",
    "Evita frases teatrales o exageradas.",
    "Se breve, clara y accionable.",
    "Longitud por defecto: muy breve (3-5 lineas). Solo amplia si el usuario pide detalle tecnico.",
    "Limite duro por defecto: maximo 7 lineas.",
    "Nunca dejes frases, listas o secciones a medias.",
    "Prioridad principal: recoger de forma conversacional lo que el usuario ha comido y el ejercicio que ha hecho para actualizar su progreso diario/semanal.",
    "No des planes de comidas ni recomendaciones largas por defecto; solo si el usuario lo pide explicitamente.",
    "No expliques formulas ni desarrollo matematico salvo que el usuario lo pida explicitamente.",
    "No menciones nombres de formulas, papers o fuentes salvo que el usuario lo pida explicitamente.",
    "Haz calculos internamente y comunica solo resultado practico y siguiente paso.",
    "Prioriza accion concreta sobre teoria.",
    "Mantente en modo conversacion (no clase).",
    "Estructura recomendada por defecto: 1) validacion breve, 2) captura de datos (comida/ejercicio), 3) siguiente paso.",
    "Formato visual obligatorio:",
    "- Usa separacion por parrafos (evita bloques largos).",
    "- Para pasos/listas usa bullets o numeracion 1., 2., 3.",
    "- No uses markdown de formato: evita #, ##, ###, **, __, * y backticks.",
    "- Si necesitas encabezado, escribe texto plano corto con icono (ej.: [RESUMEN] o 📌 Resumen:).",
    "- No uses asteriscos para delimitar secciones.",
    "- Si hay consejo o nota importante, usa iconos: 🧠 🔥 ⚠️ ✅.",
    "- Si hay secciones, usa como maximo 2 secciones cortas.",
    "No inventes datos. Si falta informacion, enumera los datos basicos necesarios en una lista corta y pide que el usuario los comparta en un solo mensaje.",
    "Si el usuario busca calculos energeticos, prioriza formulas validadas (Mifflin-St Jeor o Cunningham + METs) y deja claro cuando una cifra es estimada.",
    "Si estimas calorias de alimentos con posible ambiguedad (p. ej. pasta, arroz, legumbres, carne con hueso), indica siempre el supuesto usado (cocido/en crudo, parte comestible).",
    "Cuando des una cifra de kcal de alimento, escribe la linea completa con el supuesto, por ejemplo: 100 g de pasta cocida = 150 kcal (estimado).",
    "Si faltan datos para calculo energetico, sigue el hilo y enumera faltantes juntos (p. ej. sexo, edad, altura, actividad).",
    "No des objetivo calorico final si aun faltan datos criticos.",
    "Secuencia: primero completa datos de estimacion energetica (sexo, edad, altura, peso, actividad).",
    "No pidas comidas del dia hasta completar esa fase.",
    "Si el usuario es basico/no tecnico, evita jerga fisiologica innecesaria.",
    "No des consejos medicos peligrosos; si hay salud o riesgo, recomienda un profesional.",
    LIA_WELCOME_CONTEXT_HINT,
    userNameRule,
    todaySummary ? `Today summary: ${todaySummary}` : "",
    hasAdvancedContext
      ? `Contexto adicional:\n${weekSummary}`
      : weekSummary
      ? `Week summary: ${weekSummary}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function logMetrics(args: {
  durationMs: number;
  messagesCountSent: number;
  finishReason?: string;
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
}) {
  if (process.env.NODE_ENV === "production") return;
  const payload: Record<string, number | string | undefined> = {
    durationMs: args.durationMs,
    messagesCountSent: args.messagesCountSent,
    maxMessagesLimit: MAX_CHAT_MESSAGES,
    model: MODEL_NAME,
    finishReason: args.finishReason,
  };
  if (args.usage) {
    payload.promptTokens = args.usage.prompt_tokens;
    payload.completionTokens = args.usage.completion_tokens;
    payload.totalTokens = args.usage.total_tokens;
  }
  console.info("[LIA AI]", payload);
}

function safeFallback(): string {
  return "Si me das un poco mas de contexto, te ayudo a aterrizarlo en algo simple y util.";
}

function sanitizeAssistantOutput(text: string, finishReason?: string): string {
  if (!text) return text;
  // Convert markdown headings to plain labels with icon.
  let out = text.replace(/^\s{0,3}#{1,6}\s*(.+)$/gm, (_m, title: string) => `📌 ${title.trim()}:`);
  // Remove unsolicited formula/source name drops in normal conversation.
  out = out.replace(/\b(Mifflin-St Jeor|Cunningham|METs?|Compendium of Physical Activities|paper|papers)\b/gi, "metodo estimado");
  // Remove markdown emphasis markers so no raw asterisks leak to the UI.
  out = out.replace(/\*\*([^*]+)\*\*/g, "$1");
  out = out.replace(/__([^_]+)__/g, "$1");
  out = out.replace(/(^|[\s(])\*([^*\n]+)\*(?=$|[\s).,;:!?])/g, "$1$2");
  // Trim dangling unfinished fragments and partial bullets.
  out = out
    .replace(/\n?\s*\d+\.\s*(\*\*?|__)?\s*$/g, "")
    .replace(/\n?\s*[-+]\s*$/g, "")
    .replace(/(\*\*?|__)\s*$/g, "");

  const lines = out
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line, index, arr) => !(line === "" && arr[index - 1] === ""));
  const merged = lines.join("\n").trim();
  return closeIfTruncated(merged, finishReason);
}

function closeIfTruncated(text: string, finishReason?: string): string {
  const out = text.trim();
  if (!out) return out;

  const wasLengthCut = (finishReason ?? "").toLowerCase() === "length";
  const endsCleanly = /[.!?…)]$/.test(out);
  if (!wasLengthCut && endsCleanly) return out;

  const compact = out.replace(/\s+$/g, "");
  if (/\n-\s*$/.test(compact) || /\n\d+\.\s*$/.test(compact)) {
    return `${compact}\n✅ Si quieres, seguimos y te lo cierro en 2 pasos.`;
  }
  if (!endsCleanly) {
    return `${compact}.\n✅ Si quieres, sigo con el siguiente paso.`;
  }
  return compact;
}
