import { ChatEvent } from "./chatEvents";
import { classifyMessage, extractWeight } from "./parsing";

export type AIContext = {
  todaySummary: { food: number; training: number; lastWeight: number | null };
  weekSummary: { food: number; training: number; lastWeight: number | null };
  recentEvents: ChatEvent[];
};

type TextEvent = Extract<ChatEvent, { type: "text" }>;
type VoiceEvent = Extract<ChatEvent, { type: "voice" }>;
type ImageEvent = Extract<ChatEvent, { type: "image" }>;
type FileEvent = Extract<ChatEvent, { type: "file" }>;

const isTextEvent = (event: ChatEvent): event is TextEvent => event.type === "text";
const isVoiceEvent = (event: ChatEvent): event is VoiceEvent => event.type === "voice";
const isImageEvent = (event: ChatEvent): event is ImageEvent => event.type === "image";
const isFileEvent = (event: ChatEvent): event is FileEvent => event.type === "file";

export function buildAIContext(events: ChatEvent[]): AIContext {
  const textEvents = events.filter(isTextEvent);
  const sorted = [...textEvents].sort((a, b) => a.ts - b.ts);

  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfTomorrow = new Date(startOfToday);
  startOfTomorrow.setDate(startOfTomorrow.getDate() + 1);

  const startOfWeekWindow = new Date(startOfToday);
  startOfWeekWindow.setDate(startOfWeekWindow.getDate() - 6);

  const todaySummary = {
    food: 0,
    training: 0,
    lastWeight: null as number | null,
  };

  const weekSummary = {
    food: 0,
    training: 0,
    lastWeight: null as number | null,
  };

  for (const event of sorted) {
    const ts = event.ts;
    const inToday = ts >= startOfToday.getTime() && ts < startOfTomorrow.getTime();
    const inWeek = ts >= startOfWeekWindow.getTime() && ts < startOfTomorrow.getTime();
    if (!inToday && !inWeek) continue;

    const classification = classifyMessage(event.text);
    if (classification === "food") {
      if (inToday) todaySummary.food += 1;
      if (inWeek) weekSummary.food += 1;
    }
    if (classification === "training") {
      if (inToday) todaySummary.training += 1;
      if (inWeek) weekSummary.training += 1;
    }
    if (classification === "weight") {
      const weight = extractWeight(event.text);
      if (weight !== null) {
        if (inToday) todaySummary.lastWeight = weight;
        if (inWeek) weekSummary.lastWeight = weight;
      }
    }
  }

  const recentEvents = sorted.slice(-20);

  return {
    todaySummary,
    weekSummary,
    recentEvents,
  };
}

export function buildLLMMessages(
  events: ChatEvent[]
): {
  role: "user" | "assistant";
  content: string;
}[] {
  const allowed = events.filter(
    (event) => isTextEvent(event) || isVoiceEvent(event) || isImageEvent(event) || isFileEvent(event)
  );
  const sorted = [...allowed].sort((a, b) => a.ts - b.ts);
  return sorted.flatMap((event) => {
    if (event.type === "text") {
      return [{ role: event.role, content: event.text }];
    }
    if (event.type === "voice") {
      const content = event.content?.trim();
      if (!content) return [];
      return [{ role: event.role, content }];
    }
    if (event.type === "image") {
      const imageMeta = event.image ?? { src: "" };
      const parts: string[] = [];
      parts.push("Image uploaded");
      if (imageMeta.name) parts.push(imageMeta.name);
      if (typeof imageMeta.width === "number" && typeof imageMeta.height === "number") {
        parts.push(`${imageMeta.width}x${imageMeta.height}`);
      }
      if (typeof imageMeta.sizeBytes === "number") {
        const sizeKb = Math.max(1, Math.round(imageMeta.sizeBytes / 1024));
        parts.push(`${sizeKb}KB`);
      }
      const caption = event.content?.trim();
      if (caption) parts.push(`caption: ${caption}`);
      return [{ role: event.role, content: `[${parts.join(", ")}]` }];
    }
    const fileMeta = event.file ?? { name: "unknown" };
    const parts: string[] = [];
    parts.push("File");
    if (fileMeta.name) parts.push(fileMeta.name);
    if (fileMeta.mimeType) parts.push(fileMeta.mimeType);
    if (typeof fileMeta.sizeBytes === "number") {
      const sizeKb = Math.max(1, Math.round(fileMeta.sizeBytes / 1024));
      parts.push(`${sizeKb}KB`);
    }
    const ingest = fileMeta.ingest;
    if (ingest?.status === "pending") {
      parts.push("Ingestion pending");
    } else if (ingest?.status === "error") {
      parts.push(`Ingestion failed: ${ingest.error || "unknown error"}`);
    } else if (ingest?.summary) {
      parts.push(`Summary: ${ingest.summary}`);
    }
    return [{ role: event.role, content: `[${parts.join(". ")}]` }];
  });
}
