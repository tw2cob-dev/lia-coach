import { getDateISOInTimezone } from "../coachPlan";
import { FOOD_CATALOG, findCatalogItemByText, normalize } from "./foodCatalog";
import { FoodEntry, computeDayFoodTotals, computeFromCatalog, findLastMatchingEntry } from "./foodLedger";

type DayContext = {
  dayId: string;
  dateISO: string;
  isRetroactive: boolean;
  requiresConfirmation?: boolean;
  confirmationLabel?: string;
};

export type ParsedFoodMutation =
  | { kind: "none" }
  | { kind: "add"; day: DayContext; entry: FoodEntry }
  | { kind: "correct"; day: DayContext; entry: FoodEntry; linkedEntryId: string };

export function parseFoodMutation(args: {
  text: string;
  timezone: string;
  currentDayId: string;
  now?: Date;
  existingEntriesByDayId: Record<string, FoodEntry[]>;
}): ParsedFoodMutation {
  const now = args.now ?? new Date();
  const text = args.text.trim();
  if (!text) return { kind: "none" };
  const normalized = normalize(text);
  const day = resolveDayContext(normalized, args.currentDayId, args.timezone, now);
  const isCorrection = /\b(corrige|corregir|no era|eran|fueron|me equivoque|pon)\b/.test(normalized);
  const catalogItem = findCatalogItemByText(normalized);
  const gramsExplicit = extractGrams(normalized);
  const units = extractUnits(normalized);
  const targetDayEntries = args.existingEntriesByDayId[day.dayId] ?? [];

  if (!catalogItem && !isCorrection) return { kind: "none" };

  if (isCorrection) {
    const target = findLastMatchingEntry(targetDayEntries, catalogItem?.name);
    if (!target) return { kind: "none" };
    const grams =
      gramsExplicit ??
      (units !== null && catalogItem ? units * resolveUnitGrams(catalogItem, normalized) : null) ??
      target.grams;
    const baseItem = catalogItem ?? findCatalogByName(target.name);
    if (!baseItem) return { kind: "none" };
    const corrected = computeFromCatalog({
      item: baseItem,
      grams,
      source: gramsExplicit !== null || units !== null ? "user" : "database",
      isEstimated: gramsExplicit === null && units === null,
      assumptionNote:
        gramsExplicit === null && units === null
          ? `ajuste sobre ${baseItem.name} con porcion previa`
          : undefined,
      linkedEntryId: target.id,
      createdAt: now.toISOString(),
    });
    return { kind: "correct", day, entry: corrected, linkedEntryId: target.id };
  }

  if (!catalogItem) return { kind: "none" };
  const grams =
    gramsExplicit ??
    (units !== null ? units * resolveUnitGrams(catalogItem, normalized) : catalogItem.defaultServingGrams);
  const assumed = gramsExplicit === null && units === null;
  const entry = computeFromCatalog({
    item: catalogItem,
    grams,
    source: assumed ? "database" : "user",
    isEstimated: assumed,
    assumptionNote: assumed ? `${catalogItem.name} mediano ~${catalogItem.defaultServingGrams}g` : undefined,
    createdAt: now.toISOString(),
  });
  return { kind: "add", day, entry };
}

export function mergeFoodEntries(entries: FoodEntry[], mutation: ParsedFoodMutation): FoodEntry[] {
  if (mutation.kind === "none") return entries;
  return [...entries, mutation.entry];
}

export function recomputeFromEntries(entries: FoodEntry[]) {
  return computeDayFoodTotals(entries);
}

function resolveDayContext(
  normalizedText: string,
  currentDayId: string,
  timezone: string,
  now: Date
): DayContext {
  if (/\bayer\b/.test(normalizedText)) {
    const d = new Date(now);
    d.setDate(d.getDate() - 1);
    const dateISO = getDateISOInTimezone(d, timezone);
    return { dayId: `${dateISO}@${timezone}`, dateISO, isRetroactive: true };
  }
  const weekday = extractWeekday(normalizedText);
  if (weekday !== null) {
    const target = new Date(now);
    const today = target.getDay();
    let diff = (today - weekday + 7) % 7;
    if (diff === 0) diff = 7;
    target.setDate(target.getDate() - diff);
    const dateISO = getDateISOInTimezone(target, timezone);
    return {
      dayId: `${dateISO}@${timezone}`,
      dateISO,
      isRetroactive: true,
      requiresConfirmation: true,
      confirmationLabel: dateISO,
    };
  }
  const explicitDate = extractExplicitDate(normalizedText, now);
  if (explicitDate) {
    return { dayId: `${explicitDate}@${timezone}`, dateISO: explicitDate, isRetroactive: explicitDate !== currentDayId.split("@")[0] };
  }
  return {
    dayId: currentDayId,
    dateISO: currentDayId.split("@")[0],
    isRetroactive: false,
  };
}

function extractWeekday(text: string): number | null {
  if (/\blunes\b/.test(text)) return 1;
  if (/\bmartes\b/.test(text)) return 2;
  if (/\bmiercoles\b/.test(text)) return 3;
  if (/\bjueves\b/.test(text)) return 4;
  if (/\bviernes\b/.test(text)) return 5;
  if (/\bsabado\b/.test(text)) return 6;
  if (/\bdomingo\b/.test(text)) return 0;
  return null;
}

function extractGrams(text: string): number | null {
  const match = text.match(/\b(\d{1,4}(?:[.,]\d+)?)\s*g(?:r|ramos?)?\b/);
  if (!match) return null;
  const value = Number(match[1].replace(",", "."));
  if (!Number.isFinite(value) || value <= 0) return null;
  return value;
}

function extractUnits(text: string): number | null {
  const match = text.match(/\b(\d{1,2})\s*(unidad|unidades|huevo|huevos|platano|platanos|banana|bananas)\b/);
  if (!match) return null;
  const value = Number(match[1]);
  if (!Number.isFinite(value) || value <= 0) return null;
  return value;
}

function resolveUnitGrams(item: (typeof FOOD_CATALOG)[number], normalizedText: string): number {
  const units = item.units ?? {};
  for (const [unit, grams] of Object.entries(units)) {
    if (normalizedText.includes(unit)) return grams;
  }
  return item.defaultServingGrams;
}

function extractExplicitDate(text: string, now: Date): string | null {
  const md = text.match(/\b(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{2,4}))?\b/);
  if (!md) return null;
  const dd = Number(md[1]);
  const mm = Number(md[2]);
  const yy = md[3] ? Number(md[3]) : now.getFullYear();
  if (!Number.isFinite(dd) || !Number.isFinite(mm) || dd < 1 || dd > 31 || mm < 1 || mm > 12) return null;
  const yyyy = yy < 100 ? 2000 + yy : yy;
  return `${String(yyyy).padStart(4, "0")}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
}

function findCatalogByName(name: string) {
  const target = normalize(name);
  return FOOD_CATALOG.find((item) => normalize(item.name) === target) ?? null;
}
