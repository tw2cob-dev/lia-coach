export type CoachPlan = {
  physicalProfile?: {
    sex?: "male" | "female";
    ageYears?: number;
    heightCm?: number;
    weightKg?: number;
    bodyFatPct?: number;
    activityLevel?: "sedentary" | "light" | "moderate" | "very";
  };
  cognitiveProfile?: {
    nivel_tecnico: "basico" | "medio" | "tecnico" | "ultra";
    score_tecnico: number;
    estilo: "neutral" | "humor_sutil" | "serio" | "ultra_resumido";
    preferencia_detalle: "bajo" | "medio" | "alto";
  };
  goals: {
    weight?: string | { targetKg?: number; deadline?: string };
    training?: string | { sessionsPerWeek?: number; focus?: string };
    nutrition?: string | { dailyProteinG?: number; dailyCalories?: number };
    habits?: string[];
  };
  preferences: {
    language: "es";
    tone: "concise";
  };
  weeklyPlan?: {
    weekStartISO: string;
    content: string;
    generatedAtISO: string;
  };
  signals?: {
    today?: {
      dateISO: string;
      intakeKcal?: number;
      burnKcal?: number;
      weightKg?: number;
      activityMinutes?: number;
      foods?: string[];
      activities?: string[];
    };
  };
  metadata: {
    version: number;
  };
};

export const COACH_PLAN_STORAGE_KEY = "lia-coach-plan";
const DEFAULT_VERSION = 1;

const DEFAULT_PREFERENCES: CoachPlan["preferences"] = {
  language: "es",
  tone: "concise",
};
const DEFAULT_COGNITIVE_PROFILE: NonNullable<CoachPlan["cognitiveProfile"]> = {
  nivel_tecnico: "basico",
  score_tecnico: 0,
  estilo: "neutral",
  preferencia_detalle: "medio",
};

export function getCoachPlan(): CoachPlan | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(COACH_PLAN_STORAGE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return normalizeCoachPlan(parsed);
  } catch {
    return null;
  }
}

export function saveCoachPlan(plan: CoachPlan): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(COACH_PLAN_STORAGE_KEY, JSON.stringify(plan));
  } catch {
    return;
  }
}

export function upsertCoachPlan(partial: Partial<CoachPlan>): CoachPlan {
  const current = getCoachPlan() ?? createDefaultCoachPlan();
  const merged = mergeCoachPlan(current, partial);
  saveCoachPlan(merged);
  return merged;
}

function createDefaultCoachPlan(): CoachPlan {
  return {
    cognitiveProfile: { ...DEFAULT_COGNITIVE_PROFILE },
    goals: {},
    preferences: DEFAULT_PREFERENCES,
    metadata: { version: DEFAULT_VERSION },
  };
}

function normalizeCoachPlan(input: unknown): CoachPlan | null {
  if (!input || typeof input !== "object") return null;
  const raw = input as Record<string, unknown>;

  const cognitiveProfile = normalizeCognitiveProfile(raw.cognitiveProfile);
  const physicalProfile = normalizePhysicalProfile(raw.physicalProfile);
  const goals = normalizeGoals(raw.goals);
  const preferences = normalizePreferences(raw.preferences);
  const weeklyPlan = normalizeWeeklyPlan(raw.weeklyPlan);
  const signals = normalizeSignals(raw.signals);
  const metadata = normalizeMetadata(raw.metadata);

  return {
    physicalProfile,
    cognitiveProfile,
    goals,
    preferences,
    ...(weeklyPlan ? { weeklyPlan } : {}),
    ...(signals ? { signals } : {}),
    metadata,
  };
}

function normalizePhysicalProfile(
  input: unknown
): NonNullable<CoachPlan["physicalProfile"]> | undefined {
  if (!input || typeof input !== "object") return undefined;
  const raw = input as Record<string, unknown>;
  const sex = raw.sex === "male" || raw.sex === "female" ? raw.sex : undefined;
  const ageYears = clampRange(toNumber(raw.ageYears), 12, 100);
  const heightCm = clampRange(toNumber(raw.heightCm), 120, 230);
  const weightKg = clampRange(toNumber(raw.weightKg), 35, 250);
  const bodyFatPct = clampRange(toNumber(raw.bodyFatPct), 3, 70);
  const activityLevel =
    raw.activityLevel === "sedentary" ||
    raw.activityLevel === "light" ||
    raw.activityLevel === "moderate" ||
    raw.activityLevel === "very"
      ? raw.activityLevel
      : undefined;
  const out: NonNullable<CoachPlan["physicalProfile"]> = {};
  if (sex) out.sex = sex;
  if (ageYears !== undefined) out.ageYears = ageYears;
  if (heightCm !== undefined) out.heightCm = heightCm;
  if (weightKg !== undefined) out.weightKg = weightKg;
  if (bodyFatPct !== undefined) out.bodyFatPct = bodyFatPct;
  if (activityLevel) out.activityLevel = activityLevel;
  return Object.keys(out).length > 0 ? out : undefined;
}

function normalizeCognitiveProfile(
  input: unknown
): NonNullable<CoachPlan["cognitiveProfile"]> {
  if (!input || typeof input !== "object") return { ...DEFAULT_COGNITIVE_PROFILE };
  const raw = input as Record<string, unknown>;
  const nivel_tecnico =
    raw.nivel_tecnico === "medio" ||
    raw.nivel_tecnico === "tecnico" ||
    raw.nivel_tecnico === "ultra"
      ? raw.nivel_tecnico
      : "basico";
  const score_tecnico = clampScore(toNumber(raw.score_tecnico) ?? 0);
  const estilo =
    raw.estilo === "humor_sutil" || raw.estilo === "serio" || raw.estilo === "ultra_resumido"
      ? raw.estilo
      : "neutral";
  const preferencia_detalle =
    raw.preferencia_detalle === "bajo" ||
    raw.preferencia_detalle === "alto"
      ? raw.preferencia_detalle
      : "medio";
  return {
    nivel_tecnico,
    score_tecnico,
    estilo,
    preferencia_detalle,
  };
}

function normalizeGoals(input: unknown): CoachPlan["goals"] {
  if (!input || typeof input !== "object") return {};
  const raw = input as Record<string, unknown>;
  const goals: CoachPlan["goals"] = {};

  if (typeof raw.weight === "string") {
    goals.weight = raw.weight.trim();
  } else if (raw.weight && typeof raw.weight === "object") {
    const weightRaw = raw.weight as Record<string, unknown>;
    const targetKg = toNumber(weightRaw.targetKg);
    const deadline = typeof weightRaw.deadline === "string" ? weightRaw.deadline : undefined;
    if (targetKg !== undefined || deadline) {
      goals.weight = {};
      if (targetKg !== undefined) goals.weight.targetKg = targetKg;
      if (deadline) goals.weight.deadline = deadline;
    }
  }

  if (typeof raw.training === "string") {
    goals.training = raw.training.trim();
  } else if (raw.training && typeof raw.training === "object") {
    const trainingRaw = raw.training as Record<string, unknown>;
    const sessionsPerWeek = toNumber(trainingRaw.sessionsPerWeek);
    const focus = typeof trainingRaw.focus === "string" ? trainingRaw.focus : undefined;
    if (sessionsPerWeek !== undefined || focus) {
      goals.training = {};
      if (sessionsPerWeek !== undefined) goals.training.sessionsPerWeek = sessionsPerWeek;
      if (focus) goals.training.focus = focus;
    }
  }

  if (typeof raw.nutrition === "string") {
    goals.nutrition = raw.nutrition.trim();
  } else if (raw.nutrition && typeof raw.nutrition === "object") {
    const nutritionRaw = raw.nutrition as Record<string, unknown>;
    const dailyProteinG = toNumber(nutritionRaw.dailyProteinG);
    const dailyCalories = toNumber(nutritionRaw.dailyCalories);
    if (dailyProteinG !== undefined || dailyCalories !== undefined) {
      goals.nutrition = {};
      if (dailyProteinG !== undefined) goals.nutrition.dailyProteinG = dailyProteinG;
      if (dailyCalories !== undefined) goals.nutrition.dailyCalories = dailyCalories;
    }
  }

  if (Array.isArray(raw.habits)) {
    const habits = raw.habits
      .filter((item) => typeof item === "string")
      .map((item) => item.trim())
      .filter(Boolean);
    if (habits.length > 0) goals.habits = habits;
  }

  return goals;
}

function normalizePreferences(input: unknown): CoachPlan["preferences"] {
  if (!input || typeof input !== "object") return DEFAULT_PREFERENCES;
  const raw = input as Record<string, unknown>;
  const language = raw.language === "es" ? "es" : "es";
  const tone = raw.tone === "concise" ? "concise" : "concise";
  return { language, tone };
}

function normalizeWeeklyPlan(input: unknown): CoachPlan["weeklyPlan"] | undefined {
  if (!input || typeof input !== "object") return undefined;
  const raw = input as Record<string, unknown>;
  const weekStartISO = typeof raw.weekStartISO === "string" ? raw.weekStartISO : "";
  const content = typeof raw.content === "string" ? raw.content.trim() : "";
  const generatedAtISO = typeof raw.generatedAtISO === "string" ? raw.generatedAtISO : "";
  if (!weekStartISO || !content || !generatedAtISO) return undefined;
  return { weekStartISO, content, generatedAtISO };
}

function normalizeSignals(input: unknown): CoachPlan["signals"] | undefined {
  if (!input || typeof input !== "object") return undefined;
  const raw = input as Record<string, unknown>;
  const todayRaw =
    raw.today && typeof raw.today === "object" ? (raw.today as Record<string, unknown>) : null;
  if (!todayRaw) return undefined;

  const dateISO = typeof todayRaw.dateISO === "string" ? todayRaw.dateISO : "";
  if (!dateISO) return undefined;

  const intakeKcal = clampRange(toNumber(todayRaw.intakeKcal), 0, 12000);
  const burnKcal = clampRange(toNumber(todayRaw.burnKcal), 0, 8000);
  const weightKg = clampRange(toNumber(todayRaw.weightKg), 35, 250);
  const activityMinutes = clampRange(toNumber(todayRaw.activityMinutes), 0, 1440);

  const foods = Array.isArray(todayRaw.foods)
    ? todayRaw.foods
        .filter((item) => typeof item === "string")
        .map((item) => item.trim())
        .filter(Boolean)
    : [];
  const activities = Array.isArray(todayRaw.activities)
    ? todayRaw.activities
        .filter((item) => typeof item === "string")
        .map((item) => item.trim())
        .filter(Boolean)
    : [];

  return {
    today: {
      dateISO,
      ...(intakeKcal !== undefined ? { intakeKcal } : {}),
      ...(burnKcal !== undefined ? { burnKcal } : {}),
      ...(weightKg !== undefined ? { weightKg } : {}),
      ...(activityMinutes !== undefined ? { activityMinutes } : {}),
      ...(foods.length > 0 ? { foods } : {}),
      ...(activities.length > 0 ? { activities } : {}),
    },
  };
}

function normalizeMetadata(input: unknown): CoachPlan["metadata"] {
  if (!input || typeof input !== "object") return { version: DEFAULT_VERSION };
  const raw = input as Record<string, unknown>;
  const version = typeof raw.version === "number" ? raw.version : DEFAULT_VERSION;
  return { version };
}

function mergeCoachPlan(current: CoachPlan, partial: Partial<CoachPlan>): CoachPlan {
  const physicalProfile = {
    ...(current.physicalProfile ?? {}),
    ...(partial.physicalProfile ?? {}),
  };
  const cognitiveProfile = {
    ...(current.cognitiveProfile ?? DEFAULT_COGNITIVE_PROFILE),
    ...(partial.cognitiveProfile ?? {}),
  };
  const goals = {
    ...current.goals,
    ...(partial.goals ?? {}),
  };
  const preferences = {
    ...current.preferences,
    ...(partial.preferences ?? {}),
  };
  const weeklyPlan = partial.weeklyPlan ?? current.weeklyPlan;
  const currentToday = current.signals?.today;
  const patchToday = partial.signals?.today;
  const signals =
    currentToday || patchToday
      ? {
          today:
            currentToday || patchToday
              ? {
                  ...(currentToday ?? {}),
                  ...(patchToday ?? {}),
                  foods: mergeStringArrays(currentToday?.foods, patchToday?.foods),
                  activities: mergeStringArrays(currentToday?.activities, patchToday?.activities),
                }
              : undefined,
        }
      : undefined;
  const metadata = {
    ...current.metadata,
    ...(partial.metadata ?? {}),
  };
  return {
    ...(Object.keys(physicalProfile).length > 0 ? { physicalProfile } : {}),
    cognitiveProfile,
    goals,
    preferences,
    ...(weeklyPlan ? { weeklyPlan } : {}),
    ...(signals?.today ? { signals } : {}),
    metadata,
  };
}

function mergeStringArrays(a?: string[], b?: string[]): string[] | undefined {
  const merged = [...(a ?? []), ...(b ?? [])]
    .map((item) => item.trim())
    .filter(Boolean);
  if (merged.length === 0) return undefined;
  return Array.from(new Set(merged)).slice(-12);
}

function toNumber(input: unknown): number | undefined {
  if (typeof input === "number" && Number.isFinite(input)) return input;
  if (typeof input === "string" && input.trim()) {
    const parsed = Number(input);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function clampScore(input: number): number {
  if (!Number.isFinite(input)) return 0;
  return Math.max(0, Math.round(input));
}

function clampRange(input: number | undefined, min: number, max: number): number | undefined {
  if (input === undefined || !Number.isFinite(input)) return undefined;
  if (input < min || input > max) return undefined;
  return Math.round(input * 10) / 10;
}
