type MessageType = "food" | "training" | "weight" | "unknown";

// Heuristic classifier; safe to replace with AI later without changing the API.
export function classifyMessage(text: string): MessageType {
  const trimmed = text.trim();
  if (!trimmed) return "unknown";
  const lower = trimmed.toLowerCase();

  const weightKeywords = ["peso", "kg", "kilo", "kilos", "kilogramo", "kilogramos", "weigh", "weight"];
  const trainingKeywords = [
    "entreno",
    "entrenamiento",
    "gym",
    "gimnasio",
    "correr",
    "running",
    "cardio",
    "fuerza",
    "pesas",
    "tenis",
  ];
  const foodKeywords = [
    "comida",
    "comer",
    "desayuno",
    "almuerzo",
    "cena",
    "snack",
    "merienda",
    "proteina",
    "proteína",
    "caloria",
    "calorías",
    "kcal",
  ];

  if (weightKeywords.some((kw) => lower.includes(kw))) return "weight";
  if (trainingKeywords.some((kw) => lower.includes(kw))) return "training";
  if (foodKeywords.some((kw) => lower.includes(kw))) return "food";
  return "unknown";
}

// Heuristic extractor; safe to replace with AI later without changing the API.
export function extractWeight(text: string): number | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const lower = trimmed.toLowerCase();

  const match = lower.match(/\b(\d{2,3}(?:[.,]\d+)?)\s*(kg|kilo|kilos|kilogramo|kilogramos)?\b/);
  if (!match) return null;
  const raw = match[1].replace(",", ".");
  const value = Number(raw);
  if (!Number.isFinite(value)) return null;
  return value;
}
