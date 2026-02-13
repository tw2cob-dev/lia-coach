import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifySessionToken } from "../../../../lib/auth/sessionToken";
import { isSuperAdminEmail } from "../../../../lib/auth/superAdmin";

type LLMMessage = {
  role: "user" | "assistant";
  content: string;
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
      messages?: LLMMessage[];
      systemContent?: string;
      model?: string;
      temperature?: number;
      maxTokens?: number;
      debug?: boolean;
    };

    const messages = Array.isArray(body.messages) ? body.messages : [];
    const systemContent = typeof body.systemContent === "string" ? body.systemContent.trim() : "";
    if (!systemContent || messages.length === 0) {
      return NextResponse.json({ error: "Invalid payload." }, { status: 400 });
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "Missing OPENAI_API_KEY." }, { status: 500 });
    }

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: body.model || "gpt-4o-mini",
        temperature: typeof body.temperature === "number" ? body.temperature : 0.4,
        max_tokens: typeof body.maxTokens === "number" ? body.maxTokens : 200,
        messages: [{ role: "system", content: systemContent }, ...messages],
      }),
    });

    if (!response.ok) {
      return NextResponse.json({ error: "Upstream AI error." }, { status: 502 });
    }

    const data = (await response.json()) as {
      choices?: { message?: { content?: string }; finish_reason?: string }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
    };
    const text = data.choices?.[0]?.message?.content?.trim() ?? "";
    const finishReason = data.choices?.[0]?.finish_reason ?? "";
    if (!text) {
      return NextResponse.json({ error: "Empty AI response." }, { status: 502 });
    }

    const shouldReturnDebug = body.debug === true && isSuperAdminEmail(user.email);
    return NextResponse.json({
      ok: true,
      text,
      usage: data.usage ?? null,
      ...(shouldReturnDebug
        ? {
            debug: {
              model: body.model || "gpt-4o-mini",
              temperature: typeof body.temperature === "number" ? body.temperature : 0.4,
              maxTokens: typeof body.maxTokens === "number" ? body.maxTokens : 200,
              systemContent,
              messagesCount: messages.length,
              finishReason,
              lastUserMessage:
                [...messages].reverse().find((m) => m.role === "user")?.content?.slice(0, 800) ?? "",
            },
          }
        : {}),
    });
  } catch {
    return NextResponse.json({ error: "Unexpected error." }, { status: 500 });
  }
}
