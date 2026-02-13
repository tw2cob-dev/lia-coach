export type SessionUser = {
  id: string;
  email: string;
  name?: string;
};

type SessionPayload = SessionUser & {
  exp: number;
};

const encoder = new TextEncoder();
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;

function toBase64Url(input: Uint8Array): string {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(input).toString("base64url");
  }
  let binary = "";
  for (const byte of input) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64Url(input: string): Uint8Array {
  if (typeof Buffer !== "undefined") {
    return new Uint8Array(Buffer.from(input, "base64url"));
  }
  const padded = input.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(input.length / 4) * 4, "=");
  const binary = atob(padded);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}

async function sign(data: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(data));
  return toBase64Url(new Uint8Array(signature));
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i += 1) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

function readSecret(): string {
  const secret = process.env.AUTH_SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("Missing/weak AUTH_SESSION_SECRET. Use at least 32 characters.");
  }
  return secret;
}

export async function createSessionToken(user: SessionUser): Promise<string> {
  const secret = readSecret();
  const header = toBase64Url(encoder.encode(JSON.stringify({ alg: "HS256", typ: "JWT" })));
  const payload: SessionPayload = {
    ...user,
    exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS,
  };
  const payloadB64 = toBase64Url(encoder.encode(JSON.stringify(payload)));
  const signingInput = `${header}.${payloadB64}`;
  const signature = await sign(signingInput, secret);
  return `${signingInput}.${signature}`;
}

export async function verifySessionToken(token: string): Promise<SessionUser | null> {
  try {
    const secret = readSecret();
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const [headerB64, payloadB64, signature] = parts;
    if (!headerB64 || !payloadB64 || !signature) return null;

    const signingInput = `${headerB64}.${payloadB64}`;
    const expected = await sign(signingInput, secret);
    if (!safeEqual(signature, expected)) return null;

    const payloadRaw = new TextDecoder().decode(fromBase64Url(payloadB64));
    const payload = JSON.parse(payloadRaw) as Partial<SessionPayload>;
    if (!payload.id || !payload.email || typeof payload.exp !== "number") return null;
    if (payload.exp <= Math.floor(Date.now() / 1000)) return null;

    return {
      id: payload.id,
      email: payload.email,
      name: payload.name,
    };
  } catch {
    return null;
  }
}
