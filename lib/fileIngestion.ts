import { generateAssistantReply } from "./aiClient";

const MAX_EXTRACTED_CHARS = 20000;
const MAX_SUMMARY_CHARS = 600;

export async function ingestFile(args: {
  name: string;
  mimeType?: string;
  sizeBytes?: number;
  fileData: string;
}): Promise<{ extractedText: string; summary: string }> {
  const extractedText = trimText(args.fileData, MAX_EXTRACTED_CHARS);
  if (!extractedText) {
    return {
      extractedText: "",
      summary: "Archivo vacío o sin texto legible.",
    };
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return {
      extractedText,
      summary: fallbackSummary(extractedText),
    };
  }

  const summaryPrompt = [
    "Resume el siguiente archivo en español.",
    "Sé breve (máximo 6 viñetas o ~600 caracteres).",
    "Si faltan datos, indícalo.",
    "",
    `Nombre: ${args.name}`,
    args.mimeType ? `Tipo: ${args.mimeType}` : "",
    args.sizeBytes ? `Tamaño: ${args.sizeBytes} bytes` : "",
    "",
    "Contenido:",
    extractedText,
  ]
    .filter(Boolean)
    .join("\n");

  try {
    const summary = await generateAssistantReply({
      messages: [{ role: "user", content: summaryPrompt }],
      todaySummary: "",
      weekSummary: "",
    });
    return {
      extractedText,
      summary: trimText(summary, MAX_SUMMARY_CHARS) || fallbackSummary(extractedText),
    };
  } catch {
    return {
      extractedText,
      summary: fallbackSummary(extractedText),
    };
  }
}

function fallbackSummary(text: string): string {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 6);
  if (lines.length === 0) return "Resumen no disponible.";
  const bullets = lines.map((line) => `- ${line}`);
  return trimText(bullets.join("\n"), MAX_SUMMARY_CHARS);
}

function trimText(text: string, maxChars: number): string {
  if (!text) return "";
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars).trimEnd();
}
