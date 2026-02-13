import { ChatEvent } from "../chatEvents";
import { CoachPlan } from "../coachPlan";
import { classifyMessage, extractWeight } from "../parsing";

type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

type DailyMetrics = {
  intakeKcal: number;
  targetKcal: number | null;
  basalKcal: number | null;
  tdeeKcal: number | null;
  burnKcal: number;
  lastWeightKg: number | null;
  weightDeltaKg30d: number | null;
  confidence: "high" | "medium" | "low" | "none";
};

type WeeklySeries = {
  intakeKcal: number[];
  burnKcal: number[];
  weightKg: Array<number | null>;
};

export type DashboardMetrics = {
  daily: DailyMetrics;
  weekly: WeeklySeries;
};

type RecurringTraining = {
  weekday: Weekday;
  activity: string;
  burnPerSession: number;
};

const DAY_NAME_TO_WEEKDAY: Record<string, Weekday> = {
  domingo: 0,
  lunes: 1,
  martes: 2,
  miercoles: 3,
  jueves: 4,
  viernes: 5,
  sabado: 6,
};

const DEFAULT_ACTIVITY_BURN_PER_HOUR: Array<{ pattern: RegExp; kcalPerHour: number }> = [
  { pattern: /\btenis\b/, kcalPerHour: 500 },
  { pattern: /\bhiit\b/, kcalPerHour: 650 },
  { pattern: /\brunning|correr\b/, kcalPerHour: 600 },
  { pattern: /\bfuerza|pesas|gym|gimnasio\b/, kcalPerHour: 350 },
  { pattern: /\bcardio\b/, kcalPerHour: 450 },
  { pattern: /\bcaminar|paseo\b/, kcalPerHour: 220 },
];

const DEFAULT_BASAL_KCAL = 1800;
const ACTIVITY_FACTORS: Record<NonNullable<NonNullable<CoachPlan["physicalProfile"]>["activityLevel"]>, number> =
  {
    sedentary: 1.2,
    light: 1.375,
    moderate: 1.55,
    very: 1.725,
  };

export function buildDashboardMetrics(
  events: ChatEvent[],
  plan?: CoachPlan | null,
  now = new Date()
): DashboardMetrics {
  const userEntries = events
    .filter((event) => event.role === "user")
    .map((event) => ({
      ts: event.ts,
      text:
        event.type === "text"
          ? event.text
          : event.type === "voice"
          ? event.content
          : event.type === "image" || event.type === "file"
          ? event.content
          : "",
    }))
    .filter((entry) => entry.text.trim().length > 0)
    .sort((a, b) => a.ts - b.ts);

  const recurringTraining = extractRecurringTraining(userEntries.map((e) => e.text));
  const weekly = buildWeeklySeries(userEntries, recurringTraining, now);
  applyTodaySignals(weekly, plan, now);
  const signalTodayWeight =
    plan?.signals?.today?.dateISO === toDateISO(now) ? plan?.signals?.today?.weightKg : undefined;
  const latestWeight =
    getLatestWeight(userEntries) ?? signalTodayWeight ?? plan?.physicalProfile?.weightKg ?? null;
  const oldWeight = getOldWeightReference(userEntries, 30, now);
  const profile = mergeInferredProfile(plan?.physicalProfile, userEntries, latestWeight);
  const hasUserData = hasMeaningfulData(userEntries, profile);
  const energy = estimateEnergyModel(profile);
  const todayIndex = 6;
  const todayIntake = weekly.intakeKcal[todayIndex] || 0;
  const todayBurn = weekly.burnKcal[todayIndex] || 0;
  const tdeeBase = energy.tdeeKcal;
  const expectedTotal = hasUserData ? Math.max(1200, tdeeBase + todayBurn) : null;
  const todayTarget =
    expectedTotal !== null ? Math.max(expectedTotal, todayIntake) : null;
  const delta =
    latestWeight !== null && oldWeight !== null ? Number((latestWeight - oldWeight).toFixed(1)) : null;

  return {
    daily: {
      intakeKcal: todayIntake,
      targetKcal: todayTarget,
      basalKcal: hasUserData ? energy.basalKcal : null,
      tdeeKcal: hasUserData ? tdeeBase : null,
      burnKcal: todayBurn,
      lastWeightKg: latestWeight,
      weightDeltaKg30d: delta,
      confidence: hasUserData ? energy.confidence : "none",
    },
    weekly,
  };
}

function applyTodaySignals(weekly: WeeklySeries, plan: CoachPlan | null | undefined, now: Date): void {
  const todaySignal = plan?.signals?.today;
  if (!todaySignal) return;
  const todayISO = toDateISO(now);
  if (todaySignal.dateISO !== todayISO) return;

  const todayIndex = 6;
  if (typeof todaySignal.intakeKcal === "number" && todaySignal.intakeKcal > 0) {
    weekly.intakeKcal[todayIndex] = Math.max(weekly.intakeKcal[todayIndex] || 0, todaySignal.intakeKcal);
  }
  if (typeof todaySignal.burnKcal === "number" && todaySignal.burnKcal > 0) {
    weekly.burnKcal[todayIndex] = Math.max(weekly.burnKcal[todayIndex] || 0, todaySignal.burnKcal);
  }
  if (
    (typeof todaySignal.burnKcal !== "number" || todaySignal.burnKcal <= 0) &&
    typeof todaySignal.activityMinutes === "number" &&
    todaySignal.activityMinutes > 0
  ) {
    const activity = todaySignal.activities?.[0] ?? "default";
    const met = estimateMET(activity);
    const weight = todaySignal.weightKg ?? plan?.physicalProfile?.weightKg ?? 75;
    const inferredBurn = Math.round(met * weight * (todaySignal.activityMinutes / 60));
    weekly.burnKcal[todayIndex] = Math.max(weekly.burnKcal[todayIndex] || 0, inferredBurn);
  }
  if (typeof todaySignal.weightKg === "number" && todaySignal.weightKg > 0) {
    weekly.weightKg[todayIndex] = todaySignal.weightKg;
  }
}

function buildWeeklySeries(
  entries: Array<{ ts: number; text: string }>,
  recurringTraining: RecurringTraining[],
  now: Date
): WeeklySeries {
  const starts: Date[] = [];
  const startOfToday = dateStart(now);
  for (let i = 6; i >= 0; i -= 1) {
    const day = new Date(startOfToday);
    day.setDate(startOfToday.getDate() - i);
    starts.push(day);
  }

  const intakeKcal = Array.from({ length: 7 }, () => 0);
  const burnKcal = Array.from({ length: 7 }, () => 0);
  const weightKg: Array<number | null> = Array.from({ length: 7 }, () => null);

  for (let dayIndex = 0; dayIndex < 7; dayIndex += 1) {
    const dayStart = starts[dayIndex].getTime();
    const dayEnd = dayStart + 24 * 60 * 60 * 1000;
    const dayEntries = entries.filter((entry) => entry.ts >= dayStart && entry.ts < dayEnd);
    const dayText = dayEntries.map((e) => e.text).join("\n");

    for (const entry of dayEntries) {
      const text = entry.text;
      const lower = normalize(text);
      const type = classifyMessage(text);
      if (type === "food") {
        intakeKcal[dayIndex] += extractIntakeKcal(text, lower);
      }
      if (type === "training") {
        burnKcal[dayIndex] += extractTrainingBurnKcal(text, lower);
      }
      const weight = extractWeight(text);
      if (weight !== null) {
        weightKg[dayIndex] = weight;
      }
    }

    const weekday = starts[dayIndex].getDay() as Weekday;
    for (const recurring of recurringTraining) {
      if (recurring.weekday !== weekday) continue;
      if (isRecurringCancelled(dayText, recurring.activity)) continue;
      burnKcal[dayIndex] += recurring.burnPerSession;
    }
  }

  return { intakeKcal, burnKcal, weightKg };
}

function extractRecurringTraining(texts: string[]): RecurringTraining[] {
  const recurring: RecurringTraining[] = [];
  for (const raw of texts) {
    const text = normalize(raw);
    const dayMatch = text.match(/\btodos?\s+los?\s+(lunes|martes|miercoles|jueves|viernes|sabado|domingo)\b/);
    if (!dayMatch) continue;
    const dayName = dayMatch[1];
    const weekday = DAY_NAME_TO_WEEKDAY[dayName];
    if (weekday === undefined) continue;
    const activity = detectActivity(text);
    if (!activity) continue;
    const burn = extractTrainingBurnKcal(raw, text);
    recurring.push({
      weekday,
      activity,
      burnPerSession: Math.max(120, burn),
    });
  }
  return recurring;
}

function extractIntakeKcal(raw: string, normalized: string): number {
  const explicit = extractExplicitKcal(raw);
  if (explicit > 0) return explicit;
  if (/\bdesayuno\b/.test(normalized)) return 400;
  if (/\balmuerzo|comida\b/.test(normalized)) return 650;
  if (/\bcena\b/.test(normalized)) return 600;
  if (/\bsnack|merienda\b/.test(normalized)) return 250;
  return 450;
}

function extractTrainingBurnKcal(raw: string, normalized: string): number {
  const explicit = extractExplicitKcal(raw);
  if (explicit > 0) return explicit;

  const hours = extractDurationHours(normalized) ?? 1;
  const activity = detectActivity(normalized) ?? "default";
  const met = estimateMET(activity);
  const weight = extractWeight(raw) ?? 75;
  return Math.round(met * weight * hours);
}

function extractExplicitKcal(raw: string): number {
  const matches = [...raw.matchAll(/(\d{2,5})\s*(kcal|calorias?|cal)/gi)];
  if (matches.length === 0) return 0;
  return matches.reduce((sum, match) => sum + Number(match[1] || 0), 0);
}

function extractDurationHours(normalized: string): number | null {
  const hourMatch = normalized.match(/(\d+(?:[.,]\d+)?)\s*h(?:ora|oras)?\b/);
  if (hourMatch) return Number(hourMatch[1].replace(",", "."));
  const minMatch = normalized.match(/(\d{1,3})\s*min(?:uto|utos)?\b/);
  if (minMatch) return Number(minMatch[1]) / 60;
  return null;
}

function detectActivity(normalized: string): string | null {
  const found = DEFAULT_ACTIVITY_BURN_PER_HOUR.find((item) => item.pattern.test(normalized));
  if (!found) return null;
  return found.pattern.source;
}

function isRecurringCancelled(dayText: string, activity: string): boolean {
  const text = normalize(dayText);
  return (
    /\b(hoy no|no pude|no he podido|al final no)\b/.test(text) &&
    new RegExp(activity, "i").test(text)
  );
}

function getLatestWeight(entries: Array<{ ts: number; text: string }>): number | null {
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    const weight = extractWeight(entries[i].text);
    if (weight !== null) return weight;
  }
  return null;
}

function getOldWeightReference(
  entries: Array<{ ts: number; text: string }>,
  days: number,
  now: Date
): number | null {
  const windowStart = dateStart(now).getTime() - days * 24 * 60 * 60 * 1000;
  for (const entry of entries) {
    if (entry.ts < windowStart) continue;
    const weight = extractWeight(entry.text);
    if (weight !== null) return weight;
  }
  return null;
}

function estimateBasalKcal(weightKg: number | null): number {
  if (!weightKg || weightKg <= 0) return DEFAULT_BASAL_KCAL;
  return Math.round(weightKg * 22);
}

function mergeInferredProfile(
  physicalProfile: CoachPlan["physicalProfile"] | undefined,
  entries: Array<{ ts: number; text: string }>,
  latestWeight: number | null
): NonNullable<CoachPlan["physicalProfile"]> {
  const profile: NonNullable<CoachPlan["physicalProfile"]> = {
    ...(physicalProfile ?? {}),
  };
  if (!profile.weightKg && latestWeight) profile.weightKg = latestWeight;

  for (let i = entries.length - 1; i >= 0; i -= 1) {
    const text = normalize(entries[i].text);
    const checklistProfile = extractProfileFromChecklist(text);
    if (!profile.sex && checklistProfile.sex) profile.sex = checklistProfile.sex;
    if (!profile.ageYears && checklistProfile.ageYears) profile.ageYears = checklistProfile.ageYears;
    if (!profile.heightCm && checklistProfile.heightCm) profile.heightCm = checklistProfile.heightCm;
    if (!profile.weightKg && checklistProfile.weightKg) profile.weightKg = checklistProfile.weightKg;
    if (!profile.activityLevel && checklistProfile.activityLevel) {
      profile.activityLevel = checklistProfile.activityLevel;
    }

    if (!profile.heightCm) {
      const h = text.match(/\b(1[4-9]\d|2[0-2]\d)\s*cm\b/);
      if (h) profile.heightCm = Number(h[1]);
      const hm = text.match(/\b(1(?:[.,]\d{1,2})?)\s*m\b/);
      if (!profile.heightCm && hm) profile.heightCm = Math.round(Number(hm[1].replace(",", ".")) * 100);
    }
    if (!profile.ageYears) {
      const age = text.match(/\b(\d{2})\s*(anos|a\u00f1os)\b/);
      if (age) profile.ageYears = Number(age[1]);
      const ageLabel = text.match(/\bedad\s*[:=]?\s*(\d{2})\b/);
      if (!profile.ageYears && ageLabel) profile.ageYears = Number(ageLabel[1]);
    }
    if (!profile.sex) {
      if (/\b(hombre|masculino|varon)\b/.test(text)) profile.sex = "male";
      if (/\b(mujer|femenino)\b/.test(text)) profile.sex = "female";
    }
    if (!profile.activityLevel) {
      if (/\bsedentari/.test(text)) profile.activityLevel = "sedentary";
      if (/\bligera|ligero\b/.test(text)) profile.activityLevel = "light";
      if (/\bmoderad/.test(text)) profile.activityLevel = "moderate";
      if (/\balta|intensa|muy activa/.test(text)) profile.activityLevel = "very";
    }
    if (!profile.bodyFatPct) {
      const bf = text.match(/\b(\d{1,2})\s*%\s*(grasa|bf)?\b/);
      if (bf) profile.bodyFatPct = Number(bf[1]);
    }
  }

  return profile;
}

function extractProfileFromChecklist(
  text: string
): Partial<NonNullable<CoachPlan["physicalProfile"]>> {
  const out: Partial<NonNullable<CoachPlan["physicalProfile"]>> = {};

  const sex = text.match(/\b1\s*[:.)-]?\s*(hombre|masculino|varon|mujer|femenino)\b/);
  if (sex) out.sex = /mujer|femenino/.test(sex[1]) ? "female" : "male";

  const age = text.match(/\b2\s*[:.)-]?\s*(\d{2})\b/);
  if (age) out.ageYears = Number(age[1]);

  const hCm = text.match(/\b3\s*[:.)-]?\s*(1[4-9]\d|2[0-2]\d)\s*cm\b/);
  if (hCm) out.heightCm = Number(hCm[1]);
  const hM = text.match(/\b3\s*[:.)-]?\s*(1(?:[.,]\d{1,2})?)\s*m\b/);
  if (!out.heightCm && hM) out.heightCm = Math.round(Number(hM[1].replace(",", ".")) * 100);

  const w = text.match(
    /\b4\s*[:.)-]?\s*(\d{2,3}(?:[.,]\d+)?)\s*(kg|kgs|kilo|kilos|kilogramo|kilogramos)\b/
  );
  if (w) out.weightKg = Number(w[1].replace(",", "."));

  if (/\b5\s*[:.)-]?[^,\n]*\bsedentari/.test(text)) out.activityLevel = "sedentary";
  if (/\b5\s*[:.)-]?[^,\n]*\bliger/.test(text)) out.activityLevel = "light";
  if (/\b5\s*[:.)-]?[^,\n]*\bmoderad/.test(text)) out.activityLevel = "moderate";
  if (/\b5\s*[:.)-]?[^,\n]*\b(alta|intensa|muy activa)/.test(text)) out.activityLevel = "very";

  return out;
}

function estimateEnergyModel(profile: NonNullable<CoachPlan["physicalProfile"]>): {
  basalKcal: number;
  tdeeKcal: number;
  confidence: "high" | "medium" | "low";
} {
  const activityFactor = profile.activityLevel ? ACTIVITY_FACTORS[profile.activityLevel] : 1.35;

  // Cunningham RMR = 500 + 22 * FFM(kg), when body fat is known.
  if (
    profile.weightKg &&
    profile.weightKg > 0 &&
    profile.bodyFatPct !== undefined &&
    profile.bodyFatPct > 0 &&
    profile.bodyFatPct < 70
  ) {
    const ffm = profile.weightKg * (1 - profile.bodyFatPct / 100);
    const basal = Math.round(500 + 22 * ffm);
    return { basalKcal: basal, tdeeKcal: Math.round(basal * activityFactor), confidence: "high" };
  }

  // Mifflin-St Jeor when sex/age/height/weight are available.
  if (profile.sex && profile.ageYears && profile.heightCm && profile.weightKg) {
    const sexTerm = profile.sex === "male" ? 5 : -161;
    const basal = Math.round(
      10 * profile.weightKg + 6.25 * profile.heightCm - 5 * profile.ageYears + sexTerm
    );
    return { basalKcal: basal, tdeeKcal: Math.round(basal * activityFactor), confidence: "high" };
  }

  if (profile.weightKg) {
    const basal = estimateBasalKcal(profile.weightKg);
    return { basalKcal: basal, tdeeKcal: Math.round(basal * activityFactor), confidence: "medium" };
  }

  return {
    basalKcal: DEFAULT_BASAL_KCAL,
    tdeeKcal: Math.round(DEFAULT_BASAL_KCAL * activityFactor),
    confidence: "low",
  };
}

function estimateMET(activity: string): number {
  if (/tenis/i.test(activity)) return 7.3;
  if (/hiit/i.test(activity)) return 8.5;
  if (/running|correr/i.test(activity)) return 8.3;
  if (/fuerza|pesas|gym|gimnasio/i.test(activity)) return 5.0;
  if (/cardio/i.test(activity)) return 6.0;
  if (/caminar|paseo/i.test(activity)) return 3.5;
  return 4.0;
}

function dateStart(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function toDateISO(date: Date): string {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function hasMeaningfulData(
  entries: Array<{ ts: number; text: string }>,
  profile: NonNullable<CoachPlan["physicalProfile"]>
): boolean {
  const hasMifflinInputs = Boolean(
    profile.sex && profile.ageYears && profile.heightCm && profile.weightKg
  );
  const hasCunninghamInputs = Boolean(
    typeof profile.weightKg === "number" &&
      profile.weightKg > 0 &&
      typeof profile.bodyFatPct === "number" &&
      profile.bodyFatPct > 0
  );

  if (hasMifflinInputs || hasCunninghamInputs) return true;

  // If no physical data yet, do NOT fabricate energy targets from generic intent phrases.
  return false;
}

