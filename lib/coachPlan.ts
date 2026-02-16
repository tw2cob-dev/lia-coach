import { FoodEntry } from "./nutrition/foodLedger";

export type DaySnapshot = {
  dayId: string;
  dateISO: string;
  kcalIn: number;
  kcalOut: number;
  balance: number;
  proteinEst?: number;
  proteinG?: number;
  carbsG?: number;
  fatG?: number;
  fiberG?: number;
  magnesiumMg?: number;
  omega3G?: number;
  sodiumMg?: number;
  nutritionSource?: "label" | "database" | "manual" | "unknown";
  activityKcal: number;
  mealsCount: number;
  foodEntries?: FoodEntry[];
  closed: boolean;
  createdAtISO: string;
  updatedAtISO: string;
  autoReopened?: boolean;
};

export type CoachPlan = {
  time?: {
    current_day_id: string;
    last_rotation_iso: string;
    timezone: string;
  };
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
    maxQuestionsPerTurn: number;
  };
  routines?: {
    weekly?: Array<{
      weekday: 0 | 1 | 2 | 3 | 4 | 5 | 6;
      activity: string;
      targetMinutes?: number;
      targetBurnKcal?: number;
    }>;
  };
  weeklyPlan?: {
    weekStartISO: string;
    content: string;
    generatedAtISO: string;
  };
  signals?: {
    today?: {
      dayId?: string;
      dateISO: string;
      intakeKcal?: number;
      burnKcal?: number;
      weightKg?: number;
      activityMinutes?: number;
      proteinG?: number;
      carbsG?: number;
      fatG?: number;
      fiberG?: number;
      magnesiumMg?: number;
      omega3G?: number;
      sodiumMg?: number;
      nutritionSource?: "label" | "database" | "manual" | "unknown";
      foods?: string[];
      activities?: string[];
      dayClosed?: boolean;
    };
  };
  history?: {
    days?: Record<string, DaySnapshot>;
  };
  metadata: {
    version: number;
  };
};

export const COACH_PLAN_STORAGE_KEY = "lia-coach-plan";
export const LIA_TIMEZONE = "Europe/Madrid";
const DEFAULT_VERSION = 2;

const DEFAULT_PREFERENCES: CoachPlan["preferences"] = {
  language: "es",
  tone: "concise",
  maxQuestionsPerTurn: 1,
};
const DEFAULT_COGNITIVE_PROFILE: NonNullable<CoachPlan["cognitiveProfile"]> = {
  nivel_tecnico: "basico",
  score_tecnico: 0,
  estilo: "neutral",
  preferencia_detalle: "medio",
};

export function getDateISOInTimezone(now = new Date(), timezone = getDefaultTimezone()): string {
  try {
    const formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    return formatter.format(now);
  } catch {
    const formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone: LIA_TIMEZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    return formatter.format(now);
  }
}

export function buildDayId(now = new Date(), timezone = getDefaultTimezone()): string {
  return `${getDateISOInTimezone(now, timezone)}@${timezone}`;
}

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

export function ensureCurrentDay(now = new Date(), timezone = getDefaultTimezone()): {
  plan: CoachPlan;
  rotated: boolean;
  previousDayId?: string;
} {
  const current = getCoachPlan() ?? createDefaultCoachPlan(now, timezone);
  const resolvedTimezone = current.time?.timezone ?? timezone;
  const expectedDayId = buildDayId(now, resolvedTimezone);
  const currentDayId = current.time?.current_day_id;
  if (!currentDayId) {
    const expectedDateISO = expectedDayId.split("@")[0] ?? getDateISOInTimezone(now, resolvedTimezone);
    const seeded: CoachPlan = {
      ...current,
      time: {
        current_day_id: expectedDayId,
        last_rotation_iso: now.toISOString(),
        timezone: resolvedTimezone,
      },
      signals: {
        today: {
          ...(current.signals?.today ?? {}),
          dayId: expectedDayId,
          dateISO: current.signals?.today?.dateISO ?? expectedDateISO,
        },
      },
    };
    saveCoachPlan(seeded);
    return { plan: seeded, rotated: false };
  }
  if (currentDayId === expectedDayId) {
    return { plan: current, rotated: false };
  }

  const rotated = rotateDay(current, expectedDayId, now, resolvedTimezone);
  saveCoachPlan(rotated);
  return {
    plan: rotated,
    rotated: true,
    previousDayId: currentDayId,
  };
}

function createDefaultCoachPlan(now = new Date(), timezone = getDefaultTimezone()): CoachPlan {
  const dayId = buildDayId(now, timezone);
  return {
    time: {
      current_day_id: dayId,
      last_rotation_iso: now.toISOString(),
      timezone,
    },
    cognitiveProfile: { ...DEFAULT_COGNITIVE_PROFILE },
    goals: {},
    preferences: DEFAULT_PREFERENCES,
    metadata: { version: DEFAULT_VERSION },
  };
}

function normalizeCoachPlan(input: unknown): CoachPlan | null {
  if (!input || typeof input !== "object") return null;
  const raw = input as Record<string, unknown>;

  const time = normalizeTime(raw.time);
  const cognitiveProfile = normalizeCognitiveProfile(raw.cognitiveProfile);
  const physicalProfile = normalizePhysicalProfile(raw.physicalProfile);
  const goals = normalizeGoals(raw.goals);
  const preferences = normalizePreferences(raw.preferences);
  const routines = normalizeRoutines(raw.routines);
  const weeklyPlan = normalizeWeeklyPlan(raw.weeklyPlan);
  const signals = normalizeSignals(raw.signals);
  const history = normalizeHistory(raw.history);
  const metadata = normalizeMetadata(raw.metadata);

  return {
    ...(time ? { time } : {}),
    ...(physicalProfile ? { physicalProfile } : {}),
    cognitiveProfile,
    goals,
    preferences,
    ...(routines ? { routines } : {}),
    ...(weeklyPlan ? { weeklyPlan } : {}),
    ...(signals ? { signals } : {}),
    ...(history ? { history } : {}),
    metadata,
  };
}

function normalizeTime(input: unknown): CoachPlan["time"] | undefined {
  if (!input || typeof input !== "object") return undefined;
  const raw = input as Record<string, unknown>;
  const timezone = typeof raw.timezone === "string" && raw.timezone ? raw.timezone : getDefaultTimezone();
  const current_day_id =
    typeof raw.current_day_id === "string" && raw.current_day_id ? raw.current_day_id : buildDayId(new Date(), timezone);
  const last_rotation_iso =
    typeof raw.last_rotation_iso === "string" && raw.last_rotation_iso ? raw.last_rotation_iso : new Date().toISOString();
  return { current_day_id, last_rotation_iso, timezone };
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
  const maxQuestionsPerTurn = clampQuestionLimit(toNumber(raw.maxQuestionsPerTurn));
  return { language, tone, maxQuestionsPerTurn };
}

function normalizeRoutines(input: unknown): CoachPlan["routines"] | undefined {
  if (!input || typeof input !== "object") return undefined;
  const raw = input as Record<string, unknown>;
  if (!Array.isArray(raw.weekly)) return undefined;
  const weekly = raw.weekly
    .filter((item) => item && typeof item === "object")
    .map((item) => {
      const row = item as Record<string, unknown>;
      const weekday = toNumber(row.weekday);
      const activity = typeof row.activity === "string" ? row.activity.trim() : "";
      if (weekday === undefined || weekday < 0 || weekday > 6 || !activity) return null;
      const targetMinutes = toNumber(row.targetMinutes);
      const targetBurnKcal = toNumber(row.targetBurnKcal);
      return {
        weekday: weekday as 0 | 1 | 2 | 3 | 4 | 5 | 6,
        activity,
        ...(targetMinutes !== undefined ? { targetMinutes } : {}),
        ...(targetBurnKcal !== undefined ? { targetBurnKcal } : {}),
      };
    })
    .filter((item): item is NonNullable<typeof item> => item !== null);
  return weekly.length > 0 ? { weekly } : undefined;
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
  const proteinG = clampRange(toNumber(todayRaw.proteinG), 0, 500);
  const carbsG = clampRange(toNumber(todayRaw.carbsG), 0, 1200);
  const fatG = clampRange(toNumber(todayRaw.fatG), 0, 400);
  const fiberG = clampRange(toNumber(todayRaw.fiberG), 0, 120);
  const magnesiumMg = clampRange(toNumber(todayRaw.magnesiumMg), 0, 2000);
  const omega3G = clampRange(toNumber(todayRaw.omega3G), 0, 30);
  const sodiumMg = clampRange(toNumber(todayRaw.sodiumMg), 0, 12000);
  const nutritionSource =
    todayRaw.nutritionSource === "label" ||
    todayRaw.nutritionSource === "database" ||
    todayRaw.nutritionSource === "manual" ||
    todayRaw.nutritionSource === "unknown"
      ? todayRaw.nutritionSource
      : undefined;

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
      dayId: typeof todayRaw.dayId === "string" ? todayRaw.dayId : undefined,
      dateISO,
      ...(intakeKcal !== undefined ? { intakeKcal } : {}),
      ...(burnKcal !== undefined ? { burnKcal } : {}),
      ...(weightKg !== undefined ? { weightKg } : {}),
      ...(activityMinutes !== undefined ? { activityMinutes } : {}),
      ...(proteinG !== undefined ? { proteinG } : {}),
      ...(carbsG !== undefined ? { carbsG } : {}),
      ...(fatG !== undefined ? { fatG } : {}),
      ...(fiberG !== undefined ? { fiberG } : {}),
      ...(magnesiumMg !== undefined ? { magnesiumMg } : {}),
      ...(omega3G !== undefined ? { omega3G } : {}),
      ...(sodiumMg !== undefined ? { sodiumMg } : {}),
      ...(nutritionSource ? { nutritionSource } : {}),
      ...(foods.length > 0 ? { foods } : {}),
      ...(activities.length > 0 ? { activities } : {}),
      ...(todayRaw.dayClosed === true ? { dayClosed: true } : {}),
    },
  };
}

function normalizeHistory(input: unknown): CoachPlan["history"] | undefined {
  if (!input || typeof input !== "object") return undefined;
  const raw = input as Record<string, unknown>;
  if (!raw.days || typeof raw.days !== "object") return undefined;
  const incoming = raw.days as Record<string, unknown>;
  const days: Record<string, DaySnapshot> = {};
  for (const [dayId, value] of Object.entries(incoming)) {
    if (!value || typeof value !== "object") continue;
    const row = value as Record<string, unknown>;
    const dateISO = typeof row.dateISO === "string" ? row.dateISO : dayId.split("@")[0] || "";
    if (!dateISO) continue;
    const kcalIn = toNumber(row.kcalIn) ?? 0;
    const kcalOut = toNumber(row.kcalOut) ?? 0;
    const activityKcal = toNumber(row.activityKcal) ?? kcalOut;
    const mealsCount = toNumber(row.mealsCount) ?? 0;
    const proteinEst = toNumber(row.proteinEst);
    const proteinG = clampRange(toNumber(row.proteinG), 0, 500);
    const carbsG = clampRange(toNumber(row.carbsG), 0, 1200);
    const fatG = clampRange(toNumber(row.fatG), 0, 400);
    const fiberG = clampRange(toNumber(row.fiberG), 0, 120);
    const magnesiumMg = clampRange(toNumber(row.magnesiumMg), 0, 2000);
    const omega3G = clampRange(toNumber(row.omega3G), 0, 30);
    const sodiumMg = clampRange(toNumber(row.sodiumMg), 0, 12000);
    const nutritionSource =
      row.nutritionSource === "label" ||
      row.nutritionSource === "database" ||
      row.nutritionSource === "manual" ||
      row.nutritionSource === "unknown"
        ? row.nutritionSource
        : undefined;
    const createdAtISO = typeof row.createdAtISO === "string" ? row.createdAtISO : new Date().toISOString();
    const updatedAtISO = typeof row.updatedAtISO === "string" ? row.updatedAtISO : createdAtISO;
    const closed = row.closed === true;
    const foodEntries = Array.isArray(row.foodEntries)
      ? row.foodEntries
          .filter((entry) => entry && typeof entry === "object")
          .map((entry) => {
            const rawEntry = entry as Record<string, unknown>;
            const id = typeof rawEntry.id === "string" ? rawEntry.id : "";
            const name = typeof rawEntry.name === "string" ? rawEntry.name : "";
            const grams = toNumber(rawEntry.grams);
            const kcal = toNumber(rawEntry.kcal);
            const proteinG = toNumber(rawEntry.proteinG);
            const carbsG = toNumber(rawEntry.carbsG);
            const fatG = toNumber(rawEntry.fatG);
            const isEstimated = rawEntry.isEstimated === true;
            const source =
              rawEntry.source === "user" ||
              rawEntry.source === "label" ||
              rawEntry.source === "database" ||
              rawEntry.source === "llm"
                ? rawEntry.source
                : "database";
            const createdAt =
              typeof rawEntry.createdAt === "string" && rawEntry.createdAt
                ? rawEntry.createdAt
                : createdAtISO;
            if (!id || !name || grams === undefined || kcal === undefined || proteinG === undefined || carbsG === undefined || fatG === undefined) {
              return null;
            }
            return {
              id,
              name,
              grams,
              kcal,
              proteinG,
              carbsG,
              fatG,
              isEstimated,
              ...(typeof rawEntry.assumptionNote === "string" && rawEntry.assumptionNote
                ? { assumptionNote: rawEntry.assumptionNote }
                : {}),
              source,
              ...(typeof rawEntry.linkedEntryId === "string" && rawEntry.linkedEntryId
                ? { linkedEntryId: rawEntry.linkedEntryId }
                : {}),
              createdAt,
            } as FoodEntry;
          })
          .filter((entry): entry is FoodEntry => entry !== null)
      : [];
    days[dayId] = {
      dayId,
      dateISO,
      kcalIn,
      kcalOut,
      balance: kcalIn - kcalOut,
      ...(proteinEst !== undefined ? { proteinEst } : {}),
      ...(proteinG !== undefined ? { proteinG } : {}),
      ...(carbsG !== undefined ? { carbsG } : {}),
      ...(fatG !== undefined ? { fatG } : {}),
      ...(fiberG !== undefined ? { fiberG } : {}),
      ...(magnesiumMg !== undefined ? { magnesiumMg } : {}),
      ...(omega3G !== undefined ? { omega3G } : {}),
      ...(sodiumMg !== undefined ? { sodiumMg } : {}),
      ...(nutritionSource ? { nutritionSource } : {}),
      activityKcal,
      mealsCount,
      ...(foodEntries.length > 0 ? { foodEntries } : {}),
      closed,
      createdAtISO,
      updatedAtISO,
      ...(row.autoReopened === true ? { autoReopened: true } : {}),
    };
  }
  return Object.keys(days).length > 0 ? { days } : undefined;
}

function normalizeMetadata(input: unknown): CoachPlan["metadata"] {
  if (!input || typeof input !== "object") return { version: DEFAULT_VERSION };
  const raw = input as Record<string, unknown>;
  const version = typeof raw.version === "number" ? raw.version : DEFAULT_VERSION;
  return { version };
}

function rotateDay(plan: CoachPlan, nextDayId: string, now: Date, timezone: string): CoachPlan {
  const oldDayId = plan.time?.current_day_id;
  const nextDateISO = nextDayId.split("@")[0] ?? getDateISOInTimezone(now, timezone);
  const historyDays = { ...(plan.history?.days ?? {}) };

  if (oldDayId && plan.signals?.today) {
    historyDays[oldDayId] = buildSnapshotFromSignals(oldDayId, plan.signals.today, historyDays[oldDayId], now);
  }

  return {
    ...plan,
    time: {
      current_day_id: nextDayId,
      last_rotation_iso: now.toISOString(),
      timezone,
    },
    signals: {
      today: {
        dayId: nextDayId,
        dateISO: nextDateISO,
      },
    },
    ...(Object.keys(historyDays).length > 0 ? { history: { days: historyDays } } : {}),
    metadata: {
      ...(plan.metadata ?? { version: DEFAULT_VERSION }),
      version: Math.max(DEFAULT_VERSION, plan.metadata?.version ?? DEFAULT_VERSION),
    },
  };
}

function buildSnapshotFromSignals(
  dayId: string,
  today: NonNullable<NonNullable<CoachPlan["signals"]>["today"]>,
  existing: DaySnapshot | undefined,
  now: Date
): DaySnapshot {
  const kcalIn = toNumber(today.intakeKcal) ?? existing?.kcalIn ?? 0;
  const kcalOut = toNumber(today.burnKcal) ?? existing?.kcalOut ?? 0;
  const mealsCount = today.foods?.length ?? existing?.mealsCount ?? 0;
  const proteinG = toNumber(today.proteinG) ?? existing?.proteinG;
  const carbsG = toNumber(today.carbsG) ?? existing?.carbsG;
  const fatG = toNumber(today.fatG) ?? existing?.fatG;
  const fiberG = toNumber(today.fiberG) ?? existing?.fiberG;
  const magnesiumMg = toNumber(today.magnesiumMg) ?? existing?.magnesiumMg;
  const omega3G = toNumber(today.omega3G) ?? existing?.omega3G;
  const sodiumMg = toNumber(today.sodiumMg) ?? existing?.sodiumMg;
  const nutritionSource = today.nutritionSource ?? existing?.nutritionSource;
  const createdAtISO = existing?.createdAtISO ?? now.toISOString();
  return {
    dayId,
    dateISO: today.dateISO,
    kcalIn,
    kcalOut,
    balance: kcalIn - kcalOut,
    ...(existing?.proteinEst !== undefined ? { proteinEst: existing.proteinEst } : {}),
    ...(proteinG !== undefined ? { proteinG } : {}),
    ...(carbsG !== undefined ? { carbsG } : {}),
    ...(fatG !== undefined ? { fatG } : {}),
    ...(fiberG !== undefined ? { fiberG } : {}),
    ...(magnesiumMg !== undefined ? { magnesiumMg } : {}),
    ...(omega3G !== undefined ? { omega3G } : {}),
    ...(sodiumMg !== undefined ? { sodiumMg } : {}),
    ...(nutritionSource ? { nutritionSource } : {}),
    activityKcal: kcalOut,
    mealsCount,
    ...(Array.isArray(existing?.foodEntries) && existing.foodEntries.length > 0
      ? { foodEntries: existing.foodEntries }
      : {}),
    closed: true,
    createdAtISO,
    updatedAtISO: now.toISOString(),
    ...(existing?.autoReopened ? { autoReopened: true } : {}),
  };
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
  const routines = {
    ...(current.routines ?? {}),
    ...(partial.routines ?? {}),
  };
  const weeklyPlan = partial.weeklyPlan ?? current.weeklyPlan;

  const baseTime = current.time ?? normalizeTime({})!;
  const time = {
    ...baseTime,
    ...(partial.time ?? {}),
  };

  const currentToday = current.signals?.today;
  const patchToday = partial.signals?.today;
  const mergedTodayDateISO = patchToday?.dateISO ?? currentToday?.dateISO;
  const mergedToday = mergedTodayDateISO
    ? {
        ...(currentToday ?? {}),
        ...(patchToday ?? {}),
        dateISO: mergedTodayDateISO,
        dayId: patchToday?.dayId ?? currentToday?.dayId ?? time.current_day_id,
        foods: mergeStringArrays(currentToday?.foods, patchToday?.foods),
        activities: mergeStringArrays(currentToday?.activities, patchToday?.activities),
      }
    : undefined;
  const signals = mergedToday ? { today: mergedToday } : undefined;

  const currentDays = current.history?.days ?? {};
  const patchDays = partial.history?.days ?? {};
  const historyDays = {
    ...currentDays,
    ...patchDays,
  };

  const metadata = {
    ...current.metadata,
    ...(partial.metadata ?? {}),
  };
  return {
    ...(Object.keys(time).length > 0 ? { time } : {}),
    ...(Object.keys(physicalProfile).length > 0 ? { physicalProfile } : {}),
    cognitiveProfile,
    goals,
    preferences,
    ...(Object.keys(routines).length > 0 ? { routines } : {}),
    ...(weeklyPlan ? { weeklyPlan } : {}),
    ...(signals?.today ? { signals } : {}),
    ...(Object.keys(historyDays).length > 0 ? { history: { days: historyDays } } : {}),
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

function clampQuestionLimit(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return 1;
  return Math.min(3, Math.max(1, Math.round(value)));
}

export function getDefaultTimezone(): string {
  if (typeof Intl === "undefined" || typeof Intl.DateTimeFormat !== "function") return LIA_TIMEZONE;
  try {
    const detected = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return typeof detected === "string" && detected ? detected : LIA_TIMEZONE;
  } catch {
    return LIA_TIMEZONE;
  }
}
