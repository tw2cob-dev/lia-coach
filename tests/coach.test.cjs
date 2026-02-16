/* eslint-disable @typescript-eslint/no-require-imports */
require("ts-node").register({
  transpileOnly: true,
  compilerOptions: {
    module: "CommonJS",
    moduleResolution: "node",
  },
});

const test = require("node:test");
const assert = require("node:assert/strict");
const { getCoachPlan } = require("../lib/coachPlan.ts");
const { buildAIContext } = require("../lib/aiContext.ts");
const { detectCoachIntent } = require("../lib/chat/coachIntent.ts");
const { classifyMessage, extractWeight } = require("../lib/parsing.ts");
const { buildDashboardMetrics } = require("../lib/chat/dashboardMetrics.ts");
const { parseFoodMutation, mergeFoodEntries, recomputeFromEntries } = require("../lib/nutrition/foodEntryParser.ts");
const { __test__ } = require("../lib/chat/chatLogic.ts");
const { COACH_SYSTEM_PROMPT } = require("../lib/prompts/coachPrompt.ts");

test("detectCoachIntent returns true for explicit phrases", () => {
  const positives = [
    "plan semanal",
    "plan de comidas",
    "meal plan",
    "entrenamiento semanal",
    "training plan",
    "check-in",
    "revisi\u00f3n del d\u00eda",
    "peso",
    "calor\u00edas",
    "nutrici\u00f3n",
    "h\u00e1bitos",
    "objetivos de salud",
    "quiero mejorar mi alimentaci\u00f3n",
    "quiero perder peso",
    "quiero ganar m\u00fasculo",
  ];

  for (const phrase of positives) {
    assert.equal(detectCoachIntent(phrase), true, `Expected TRUE for: ${phrase}`);
  }
});

test("detectCoachIntent returns false for non-coach chat", () => {
  const negatives = [
    "hola",
    "ayer comi pizza",
    "puedes revisar este codigo?",
    "jaja que buen meme",
    "cuanto es 2+2",
  ];
  for (const phrase of negatives) {
    assert.equal(detectCoachIntent(phrase), false, `Expected FALSE for: ${phrase}`);
  }
});

test("localStorage access is safe during SSR (no window)", () => {
  const originalWindow = global.window;
  if (originalWindow !== undefined) {
    delete global.window;
  }
  assert.equal(getCoachPlan(), null);
  if (originalWindow !== undefined) {
    global.window = originalWindow;
  }
});

test("coach prompt is injected only when intent is true", () => {
  const context = buildAIContext([]);
  const plan = {
    cognitiveProfile: {
      nivel_tecnico: "basico",
      score_tecnico: 0,
      estilo: "neutral",
      preferencia_detalle: "medio",
    },
    goals: {},
    preferences: { language: "es", tone: "concise" },
    metadata: { version: 1 },
  };

  const noIntent = detectCoachIntent("hola");
  const noCoachContext = noIntent ? __test__.buildCoachContext(plan, context, "hola") : "";
  assert.equal(noCoachContext.includes(COACH_SYSTEM_PROMPT), false);

  const hasIntent = detectCoachIntent("plan semanal");
  const coachContext = hasIntent
    ? __test__.buildCoachContext(plan, context, "plan semanal")
    : "";
  assert.equal(coachContext.includes(COACH_SYSTEM_PROMPT), true);
  assert.equal(coachContext.includes("CoachPlan:"), false);
});

test("fallback prioritizes weight-loss intent over greeting", () => {
  const plan = {
    cognitiveProfile: {
      nivel_tecnico: "basico",
      score_tecnico: 0,
      estilo: "neutral",
      preferencia_detalle: "medio",
    },
    goals: {},
    preferences: { language: "es", tone: "concise" },
    metadata: { version: 1 },
  };
  const response = __test__.buildCoachFallbackResponse(
    "hola lia, quiero perder peso",
    plan,
    "Bryan"
  );
  assert.equal(response.includes("Objetivo: perder peso"), true);
});

test("fallback answers protein timing why-question", () => {
  const plan = {
    cognitiveProfile: {
      nivel_tecnico: "basico",
      score_tecnico: 0,
      estilo: "neutral",
      preferencia_detalle: "medio",
    },
    goals: {},
    preferences: { language: "es", tone: "concise" },
    metadata: { version: 1 },
  };
  const response = __test__.buildCoachFallbackResponse(
    "porque deberia tomar 3 o 4 tomas de proteina?",
    plan,
    "Bryan"
  );
  assert.equal(response.toLowerCase().includes("proteina"), true);
  assert.equal(response.toLowerCase().includes("3-4"), true);
});

test("parsing classifies common diary messages and avoids false weight extraction", () => {
  assert.equal(classifyMessage("he comido pasta y carne"), "food");
  assert.equal(classifyMessage("he caminado 30 min"), "training");
  assert.equal(extractWeight("120 gr de pasta"), null);
  assert.equal(extractWeight("peso 91 kg"), 91);
});

test("dashboard metrics infer profile from enumerated input and update daily summary", () => {
  const now = new Date("2026-02-13T12:00:00.000Z");
  const start = now.getTime();
  const events = [
    {
      type: "text",
      role: "user",
      id: "u1",
      ts: start - 60_000,
      text: "hoy he comido pasta, 120 gr sin cocer, y 200 gramos de secreto iberico",
    },
    {
      type: "text",
      role: "user",
      id: "u2",
      ts: start - 30_000,
      text: "he caminado unos 30 min aparte de eso no he hecho nada",
    },
    {
      type: "text",
      role: "user",
      id: "u3",
      ts: start,
      text: "1 hombre, 2 31, 3 1,65 m, 4 91kgs, 5 trabajo sedentario pero hago tenis 2 veces por semana",
    },
  ];

  const metrics = buildDashboardMetrics(events, null, now);
  assert.equal(metrics.daily.targetKcal !== null, true);
  assert.equal(metrics.daily.burnKcal > 0, true);
  assert.equal(metrics.daily.intakeKcal > 0, true);
  assert.equal(metrics.daily.lastWeightKg, 91);
});

test("dashboard metrics prioritize AI memory signals for today", () => {
  const now = new Date("2026-02-13T12:00:00.000Z");
  const events = [
    {
      type: "text",
      role: "user",
      id: "u1",
      ts: now.getTime() - 60_000,
      text: "hoy comi normal",
    },
  ];
  const plan = {
    goals: {},
    preferences: { language: "es", tone: "concise" },
    metadata: { version: 1 },
    signals: {
      today: {
        dateISO: "2026-02-13",
        intakeKcal: 2100,
        burnKcal: 320,
        weightKg: 90.5,
      },
    },
  };
  const metrics = buildDashboardMetrics(events, plan, now);
  assert.equal(metrics.daily.intakeKcal, 2100);
  assert.equal(metrics.daily.burnKcal, 320);
  assert.equal(metrics.daily.lastWeightKg, 90.5);
});

test("food parser estimates banana medium when grams are missing", () => {
  const mutation = parseFoodMutation({
    text: "me comi un platano",
    timezone: "Europe/Madrid",
    currentDayId: "2026-02-16@Europe/Madrid",
    existingEntriesByDayId: {},
  });
  assert.equal(mutation.kind, "add");
  if (mutation.kind !== "add") return;
  assert.equal(mutation.entry.name, "platano");
  assert.equal(mutation.entry.isEstimated, true);
  assert.equal(mutation.entry.grams > 0, true);
  assert.equal(mutation.entry.kcal > 0, true);
});

test("food parser correction updates effective totals", () => {
  const first = parseFoodMutation({
    text: "me comi un platano",
    timezone: "Europe/Madrid",
    currentDayId: "2026-02-16@Europe/Madrid",
    existingEntriesByDayId: {},
  });
  assert.equal(first.kind, "add");
  if (first.kind !== "add") return;
  const entries = mergeFoodEntries([], first);
  const correction = parseFoodMutation({
    text: "no, era grande, pon 200g",
    timezone: "Europe/Madrid",
    currentDayId: "2026-02-16@Europe/Madrid",
    existingEntriesByDayId: { "2026-02-16@Europe/Madrid": entries },
  });
  assert.equal(correction.kind, "correct");
  if (correction.kind !== "correct") return;
  const next = mergeFoodEntries(entries, correction);
  const totals = recomputeFromEntries(next);
  assert.equal(totals.intakeKcal > first.entry.kcal, true);
});

test("food parser maps yesterday to retroactive day id", () => {
  const now = new Date("2026-02-16T12:00:00.000Z");
  const mutation = parseFoodMutation({
    text: "ayer comi un huevo",
    timezone: "Europe/Madrid",
    currentDayId: "2026-02-16@Europe/Madrid",
    now,
    existingEntriesByDayId: {},
  });
  assert.equal(mutation.kind, "add");
  if (mutation.kind !== "add") return;
  assert.equal(mutation.day.dayId.startsWith("2026-02-15@"), true);
  assert.equal(mutation.day.isRetroactive, true);
});
