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
  assert.equal(coachContext.includes("CoachPlan:"), true);
});
