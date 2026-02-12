"use client";

import { useEffect, useMemo, useState } from "react";
import { classifyMessage, extractWeight } from "../../lib/parsing";

type ChatMessage = {
  id: string;
  text: string;
  ts: number;
};

const storageKey = "lia-chat-messages";

type DayGroup = {
  dayKey: string;
  label: string;
  messages: ChatMessage[];
};

export default function HistoryPage() {
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

  const grouped = useMemo<DayGroup[]>(() => {
    if (messages.length === 0) return [];
    const map = new Map<string, ChatMessage[]>();
    for (const message of messages) {
      const date = new Date(message.ts);
      const dayKey = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
      const bucket = map.get(dayKey) ?? [];
      bucket.push(message);
      map.set(dayKey, bucket);
    }

    const groups: DayGroup[] = [];
    for (const [dayKey, items] of map.entries()) {
      const [year, month, day] = dayKey.split("-").map(Number);
      const date = new Date(year, month, day);
      const label = date.toLocaleDateString(undefined, {
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
      });
      const sorted = items.slice().sort((a, b) => a.ts - b.ts);
      groups.push({ dayKey, label, messages: sorted });
    }

    groups.sort((a, b) => (a.dayKey < b.dayKey ? 1 : -1));
    return groups;
  }, [messages]);

  const { foodCount, trainingCount, lastWeight } = useMemo(() => {
    const now = new Date();
    const startOfWindow =
      new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() -
      6 * 24 * 60 * 60 * 1000;
    const endOfWindow =
      new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() +
      24 * 60 * 60 * 1000;

    let food = 0;
    let training = 0;
    let weight: number | null = null;
    let weightTs = -1;

    for (const message of messages) {
      if (message.ts < startOfWindow || message.ts >= endOfWindow) continue;
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
  }, [messages]);

  const summaryParts: string[] = [];
  if (foodCount > 0) summaryParts.push(`${foodCount} comidas`);
  if (trainingCount > 0) summaryParts.push(`${trainingCount} entrenos`);
  if (lastWeight !== null) summaryParts.push(`peso ${lastWeight} kg`);
  const summaryText =
    summaryParts.length > 0
      ? `Últimos 7 días: ${summaryParts.join(" · ")}`
      : null;

  return (
    <div className="min-h-screen bg-zinc-50 px-4 py-6 text-zinc-900">
      <h1 className="text-lg font-semibold">Historial</h1>
      {summaryText && (
        <p className="mt-3 text-sm text-zinc-600">{summaryText}</p>
      )}
      {grouped.length === 0 && (
        <p className="mt-4 text-sm text-zinc-500">No hay historial todavía.</p>
      )}
      <div className="mt-4 space-y-6">
        {grouped.map((group) => (
          <section key={group.dayKey}>
            <h2 className="text-sm font-semibold text-zinc-600">
              {group.label}
            </h2>
            <ul className="mt-3 space-y-3">
              {group.messages.map((message) => (
                <li
                  key={message.id}
                  className="rounded-2xl border border-zinc-200 bg-white px-4 py-3 text-sm shadow-sm"
                >
                  <span className="mr-3 text-xs uppercase tracking-wide text-zinc-500">
                    {new Date(message.ts).toLocaleTimeString(undefined, {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                  <span>{message.text}</span>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
