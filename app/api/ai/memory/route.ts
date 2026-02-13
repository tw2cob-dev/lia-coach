import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifySessionToken } from "../../../../lib/auth/sessionToken";

type PhysicalProfile = {
  sex?: "male" | "female";
  ageYears?: number;
  heightCm?: number;
  weightKg?: number;
  activityLevel?: "sedentary" | "light" | "moderate" | "very";
};

export async function POST(request: Request) {
  try {
    const rawToken = (await cookies()).get("lia-auth")?.value ?? "";
    if (!rawToken) {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }
    const user = await verifySessionToken(rawToken);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }

    const body = (await request.json()) as {
      message?: string;
      profile?: PhysicalProfile;
      todayISO?: string;
    };
    const message = typeof body.message === "string" ? body.message.trim() : "";
    if (!message) {
      return NextResponse.json({ error: "Invalid payload." }, { status: 400 });
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "Missing OPENAI_API_KEY." }, { status: 500 });
    }

    const todayISO = typeof body.todayISO === "string" && body.todayISO ? body.todayISO : "";
    const profile = body.profile ?? {};
    const system = [
      "You extract structured health tracking data from one user message.",
      "Return JSON only. No markdown, no prose.",
      "Only include fields that are explicitly present or strongly implied.",
      "Do not invent quantities.",
      "Units:",
      "- heightCm in cm",
      "- weightKg in kg",
      "- activityMinutes in minutes",
      "- intakeKcal and burnKcal as integers when inferable with reasonable confidence.",
      "Schema:",
      "{",
      '  "physicalProfile"?: { "sex"?: "male"|"female", "ageYears"?: number, "heightCm"?: number, "weightKg"?: number, "activityLevel"?: "sedentary"|"light"|"moderate"|"very" },',
      '  "signals"?: { "today"?: { "dateISO": "YYYY-MM-DD", "intakeKcal"?: number, "burnKcal"?: number, "weightKg"?: number, "activityMinutes"?: number, "foods"?: string[], "activities"?: string[] } }',
      "}",
      "If nothing useful is found, return {}.",
    ].join("\n");

    const userPrompt = [
      `todayISO=${todayISO || "unknown"}`,
      `existingProfile=${JSON.stringify(profile)}`,
      `message=${message}`,
    ].join("\n");

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0,
        max_tokens: 220,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system },
          { role: "user", content: userPrompt },
        ],
      }),
    });

    if (!response.ok) {
      return NextResponse.json({ error: "Upstream AI error." }, { status: 502 });
    }

    const data = (await response.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const raw = data.choices?.[0]?.message?.content?.trim() ?? "{}";
    let patch: Record<string, unknown> = {};
    try {
      patch = JSON.parse(raw);
    } catch {
      patch = {};
    }

    return NextResponse.json({ ok: true, patch });
  } catch {
    return NextResponse.json({ error: "Unexpected error." }, { status: 500 });
  }
}

