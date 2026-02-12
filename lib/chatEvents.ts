export type ChatEvent =
  | {
      type: "text";
      role: "user" | "assistant";
      id: string;
      ts: number;
      text: string;
      turnId?: string;
    }
  | {
      type: "voice";
      role: "user" | "assistant";
      id: string;
      ts: number;
      content: string;
      voice?: { source: "microphone"; durationMs?: number };
      turnId?: string;
    }
  | {
      type: "image";
      role: "user" | "assistant";
      id: string;
      ts: number;
      content: string;
      image?: {
        src: string;
        name?: string;
        sizeBytes?: number;
        width?: number;
        height?: number;
      };
      turnId?: string;
    }
  | {
      type: "file";
      role: "user" | "assistant";
      id: string;
      ts: number;
      content: string;
      file?: {
        name: string;
        mimeType?: string;
        sizeBytes?: number;
        src?: string;
        ingest?: {
          status: "pending" | "done" | "error";
          extractedText?: string;
          summary?: string;
          error?: string;
        };
      };
      turnId?: string;
    };

export type FileChatEvent = Extract<ChatEvent, { type: "file" }>;
export type FileChatEventWithFile = FileChatEvent & {
  file: NonNullable<FileChatEvent["file"]>;
};

export function createTextEvent(text: string): ChatEvent {
  return {
    type: "text",
    role: "user",
    id: createId(),
    ts: Date.now(),
    text,
  };
}

export function createAssistantTextEvent(text: string): ChatEvent {
  return {
    type: "text",
    role: "assistant",
    id: createId(),
    ts: Date.now(),
    text,
  };
}

export function createUserVoiceEvent(args: { transcription: string; durationMs?: number }): ChatEvent {
  return {
    type: "voice",
    role: "user",
    id: createId(),
    ts: Date.now(),
    content: args.transcription,
    voice: {
      source: "microphone",
      durationMs: args.durationMs,
    },
  };
}

export function createUserImageEvent(args: {
  src: string;
  name?: string;
  sizeBytes?: number;
  width?: number;
  height?: number;
  caption?: string;
}): ChatEvent {
  return {
    type: "image",
    role: "user",
    id: createId(),
    ts: Date.now(),
    content: args.caption ?? "",
    image: {
      src: args.src,
      name: args.name,
      sizeBytes: args.sizeBytes,
      width: args.width,
      height: args.height,
    },
  };
}

export function createUserFileEvent(args: {
  name: string;
  mimeType?: string;
  sizeBytes?: number;
  src?: string;
  note?: string;
}): FileChatEventWithFile {
  return {
    type: "file",
    role: "user",
    id: createId(),
    ts: Date.now(),
    content: args.note ?? "",
    file: {
      name: args.name,
      mimeType: args.mimeType,
      sizeBytes: args.sizeBytes,
      src: args.src,
    },
  };
}

function createId(): string {
  // Simple unique-ish ID without external dependencies
  return `evt_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}
