"use client";

import { useEffect, useMemo, useState } from "react";
import { classifyMessage, extractWeight } from "../../lib/parsing";

type ChatMessage = {
  id: string;
  text: string;
  ts: number;
};

const storageKey = "lia-chat-messages";

export default function LogPage() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);

  useEffect(() => {
    const stored = window.localStorage.getItem(storageKey);
    if (!stored) return;
    try {
      const parsed = JSON.parse(stored);
      if (!Array.isArray(parsed)) return;
      const normalized = parsed.filter(
        (item) =>
          item &&
          typeof item === "object" &&
          typeof item.id === "string" &&
          typeof item.text === "string" &&
          typeof item.ts === "number"
      ) as ChatMessage[];
      setMessages(normalized);
    } catch {
      return;
    }
  }, []);

  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const endOfDay = startOfDay + 24 * 60 * 60 * 1000;
  const todaysMessages = messages.filter((message) => message.ts >= startOfDay && message.ts < endOfDay);

  const { foodCount, trainingCount, lastWeight } = useMemo(() => {
    let food = 0;
    let training = 0;
    let weight: number | null = null;
    let weightTs = -1;

    for (const message of todaysMessages) {
      const category = classifyMessage(message.text);
      if (category === "food") food += 1;
      if (category === "training") training += 1;
      const candidate = extractWeight(message.text);
      if (candidate !== null && message.ts >= weightTs) {
        weight = candidate;
        weightTs = message.ts;
      }
    }

    return { foodCount: food, trainingCount: training, lastWeight: weight };
  }, [todaysMessages]);

  const summaryParts: string[] = [];
  if (foodCount > 0) summaryParts.push(`${foodCount} comidas`);
  if (trainingCount > 0) summaryParts.push(`${trainingCount} entrenos`);
  if (lastWeight !== null) summaryParts.push(`peso ${lastWeight} kg`);
  const summaryText = summaryParts.length > 0 ? `Hoy: ${summaryParts.join(" · ")}` : null;

  return (
    <div className="min-h-screen bg-zinc-50 px-4 py-6 text-zinc-900">
      <h1 className="text-lg font-semibold">Log de hoy</h1>
      {summaryText && (
        <p className="mt-3 text-sm text-zinc-600">{summaryText}</p>
      )}
      <ul className="mt-4 space-y-3">
        {todaysMessages.map((message) => (
          <li key={message.id} className="rounded-2xl border border-zinc-200 bg-white px-4 py-3 text-sm shadow-sm">
            <span className="mr-3 text-xs uppercase tracking-wide text-zinc-500">
              {new Date(message.ts).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}
            </span>
            <span>{message.text}</span>
          </li>
        ))}
      </ul>
      {todaysMessages.length === 0 && (
        <p className="mt-4 text-sm text-zinc-500">Hoy no hay registros todavía.</p>
      )}
    </div>
  );
}
