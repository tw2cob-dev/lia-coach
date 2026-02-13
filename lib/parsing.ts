type MessageType = "food" | "training" | "weight" | "unknown";

// Heuristic classifier; safe to replace with AI later without changing the API.
export function classifyMessage(text: string): MessageType {
  const trimmed = text.trim();
  if (!trimmed) return "unknown";
  const lower = normalize(trimmed);

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
    "caminar",
    "caminado",
    "camine",
    "paseo",
    "andar",
  ];
  const foodKeywords = [
    "comida",
    "comer",
    "comi",
    "comido",
    "he comido",
    "ceno",
    "cenado",
    "almorce",
    "almorzado",
    "desayune",
    "desayunado",
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
  const lower = normalize(trimmed);

  // Prefer explicit "peso" mentions first.
  const explicit = lower.match(
    /\bpeso(?:\s*(?:actual|hoy|de)?)?\s*[:=]?\s*(\d{2,3}(?:[.,]\d+)?)\s*(kg|kgs|kilo|kilos|kilogramo|kilogramos)\b/
  );
  if (explicit) {
    const value = Number(explicit[1].replace(",", "."));
    if (Number.isFinite(value) && value >= 35 && value <= 250) return value;
  }

  // Generic weight extraction requires a weight unit to avoid false positives (e.g. "120 gr").
  const match = lower.match(
    /\b(\d{2,3}(?:[.,]\d+)?)\s*(kg|kgs|kilo|kilos|kilogramo|kilogramos)\b/
  );
  if (!match) return null;
  const value = Number(match[1].replace(",", "."));
  if (!Number.isFinite(value)) return null;
  if (value < 35 || value > 250) return null;
  return value;
}

function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
