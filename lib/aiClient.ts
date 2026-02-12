type LLMMessage = {
  role: "user" | "assistant";
  content: string;
};

const MAX_CHAT_MESSAGES = 20;
const MAX_OUTPUT_TOKENS = 300;
const TEMPERATURE = 0.4;
const MODEL_NAME = "gpt-4o-mini";

export async function generateAssistantReply(args: {
  messages: LLMMessage[];
  todaySummary: string;
  weekSummary: string;
}): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return mockAIResponse(args);
  }

  const windowed = windowMessages(args.messages, MAX_CHAT_MESSAGES);
  if (windowed.length === 0) {
    return safeFallback();
  }

  const systemContent = buildSystemContent(args.todaySummary, args.weekSummary);
  const startMs = Date.now();

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL_NAME,
        temperature: TEMPERATURE,
        max_tokens: MAX_OUTPUT_TOKENS,
        messages: [{ role: "system", content: systemContent }, ...windowed],
      }),
    });

    const durationMs = Date.now() - startMs;
    if (!response.ok) {
      logMetrics({
        durationMs,
        messagesCountSent: windowed.length,
        finishReason: "http_error",
      });
      return safeFallback();
    }

    const data = (await response.json()) as {
      choices?: { message?: { content?: string }; finish_reason?: string }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
    };

    const content = data.choices?.[0]?.message?.content?.trim();
    logMetrics({
      durationMs,
      messagesCountSent: windowed.length,
      finishReason: data.choices?.[0]?.finish_reason,
      usage: data.usage,
    });

    if (!content) {
      return safeFallback();
    }

    return content;
  } catch {
    logMetrics({
      durationMs: Date.now() - startMs,
      messagesCountSent: windowed.length,
      finishReason: "exception",
    });
    return safeFallback();
  }
}

export async function streamAssistantReply(args: {
  messages: LLMMessage[];
  todaySummary: string;
  weekSummary: string;
  onToken: (chunk: string) => void;
}): Promise<string> {
  const windowed = windowMessages(args.messages, MAX_CHAT_MESSAGES);
  if (windowed.length === 0) {
    const fallback = safeFallback();
    args.onToken(fallback);
    return fallback;
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    const fallback = mockAIResponse(args);
    args.onToken(fallback);
    return fallback;
  }

  const systemContent = buildSystemContent(args.todaySummary, args.weekSummary);
  const startMs = Date.now();

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL_NAME,
        temperature: TEMPERATURE,
        max_tokens: MAX_OUTPUT_TOKENS,
        stream: true,
        messages: [{ role: "system", content: systemContent }, ...windowed],
      }),
    });

    if (!response.ok || !response.body) {
      logMetrics({
        durationMs: Date.now() - startMs,
        messagesCountSent: windowed.length,
        finishReason: "http_error",
      });
      const fallback = await generateAssistantReply(args);
      args.onToken(fallback);
      return fallback;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let fullText = "";
    let finishReason: string | undefined;

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split("\n\n");
      buffer = parts.pop() ?? "";
      for (const part of parts) {
        const lines = part.split("\n");
        for (const line of lines) {
          if (!line.startsWith("data:")) continue;
          const data = line.slice(5).trim();
          if (!data || data === "[DONE]") continue;
          try {
            const parsed = JSON.parse(data) as {
              choices?: { delta?: { content?: string }; finish_reason?: string }[];
              usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
            };
            const chunk = parsed.choices?.[0]?.delta?.content;
            if (chunk) {
              fullText += chunk;
              args.onToken(chunk);
            }
            if (parsed.choices?.[0]?.finish_reason) {
              finishReason = parsed.choices?.[0]?.finish_reason;
            }
            if (parsed.usage) {
              logMetrics({
                durationMs: Date.now() - startMs,
                messagesCountSent: windowed.length,
                finishReason: finishReason ?? "stream_usage",
                usage: parsed.usage,
              });
            }
          } catch {
            continue;
          }
        }
      }
    }

    logMetrics({
      durationMs: Date.now() - startMs,
      messagesCountSent: windowed.length,
      finishReason,
    });

    const finalText = fullText.trim();
    if (!finalText) {
      const fallback = await generateAssistantReply(args);
      args.onToken(fallback);
      return fallback;
    }

    return finalText;
  } catch {
    logMetrics({
      durationMs: Date.now() - startMs,
      messagesCountSent: windowed.length,
      finishReason: "exception",
    });
    const fallback = await generateAssistantReply(args);
    args.onToken(fallback);
    return fallback;
  }
}

function windowMessages(messages: LLMMessage[], maxMessages: number): LLMMessage[] {
  if (!Array.isArray(messages) || maxMessages <= 0) return [];
  if (messages.length <= maxMessages) return [...messages];
  return messages.slice(-maxMessages);
}

function buildSystemContent(todaySummary: string, weekSummary: string): string {
  return [
    "You are LIA Coach.",
    "Responde en español. Sé concisa y accionable.",
    "No inventes datos. Si falta información, pide como máximo un dato y sugiere un paso seguro.",
    "No des consejos médicos peligrosos; si hay salud o riesgo, recomienda un profesional.",
    todaySummary ? `Today summary: ${todaySummary}` : "",
    weekSummary ? `Week summary: ${weekSummary}` : "",
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

function mockAIResponse(args: { todaySummary: string; weekSummary: string }): string {
  return `Recibido. ${args.todaySummary} ${args.weekSummary}`.trim();
}

function safeFallback(): string {
  return "Gracias, lo tengo. ¿Quieres añadir algo más?";
}
