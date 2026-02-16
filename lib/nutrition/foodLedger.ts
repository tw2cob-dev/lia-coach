import { FoodCatalogItem } from "./foodCatalog";

export type FoodEntrySource = "user" | "label" | "database" | "llm";

export type FoodEntry = {
  id: string;
  name: string;
  grams: number;
  kcal: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  isEstimated: boolean;
  assumptionNote?: string;
  source: FoodEntrySource;
  linkedEntryId?: string;
  createdAt: string;
};

export type DayFoodTotals = {
  intakeKcal: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  mealsCount: number;
};

export function computeFromCatalog(args: {
  item: FoodCatalogItem;
  grams: number;
  source: FoodEntrySource;
  isEstimated: boolean;
  assumptionNote?: string;
  linkedEntryId?: string;
  createdAt: string;
}): FoodEntry {
  const factor = args.grams / 100;
  return {
    id: createFoodEntryId(),
    name: args.item.name,
    grams: round1(args.grams),
    kcal: Math.round(args.item.per100g.kcal * factor),
    proteinG: round1(args.item.per100g.proteinG * factor),
    carbsG: round1(args.item.per100g.carbsG * factor),
    fatG: round1(args.item.per100g.fatG * factor),
    isEstimated: args.isEstimated,
    ...(args.assumptionNote ? { assumptionNote: args.assumptionNote } : {}),
    source: args.source,
    ...(args.linkedEntryId ? { linkedEntryId: args.linkedEntryId } : {}),
    createdAt: args.createdAt,
  };
}

export function resolveEffectiveEntries(entries: FoodEntry[]): FoodEntry[] {
  const sorted = [...entries].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const latestByRoot = new Map<string, FoodEntry>();
  for (const entry of sorted) {
    const root = resolveRootId(entry, sorted);
    latestByRoot.set(root, entry);
  }
  return [...latestByRoot.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export function computeDayFoodTotals(entries: FoodEntry[]): DayFoodTotals {
  const effective = resolveEffectiveEntries(entries);
  return {
    intakeKcal: effective.reduce((sum, entry) => sum + (entry.kcal || 0), 0),
    proteinG: round1(effective.reduce((sum, entry) => sum + (entry.proteinG || 0), 0)),
    carbsG: round1(effective.reduce((sum, entry) => sum + (entry.carbsG || 0), 0)),
    fatG: round1(effective.reduce((sum, entry) => sum + (entry.fatG || 0), 0)),
    mealsCount: effective.length,
  };
}

export function findLastMatchingEntry(entries: FoodEntry[], nameLike?: string): FoodEntry | null {
  const effective = resolveEffectiveEntries(entries);
  const sorted = [...effective].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  if (!nameLike) return sorted[0] ?? null;
  const target = normalize(nameLike);
  return sorted.find((entry) => normalize(entry.name).includes(target)) ?? null;
}

function resolveRootId(entry: FoodEntry, entries: FoodEntry[]): string {
  let cursor: FoodEntry | undefined = entry;
  let guard = 0;
  while (cursor?.linkedEntryId && guard < 10) {
    const parent = entries.find((candidate) => candidate.id === cursor?.linkedEntryId);
    if (!parent) break;
    cursor = parent;
    guard += 1;
  }
  return cursor?.id ?? entry.id;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function createFoodEntryId(): string {
  return `food_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

