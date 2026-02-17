export function isSuperAdminEmail(email?: string | null): boolean {
  if (!email) return false;
  const normalizedEmail = normalizeEmailToken(email);
  if (!normalizedEmail) return false;

  const sources = [
    process.env.SUPER_ADMIN_EMAILS ?? "",
    process.env.SUPER_ADMIN_EMAIL ?? "",
  ].filter((value) => value.trim().length > 0);
  if (sources.length === 0) return false;

  const allowed = sources
    .flatMap((value) => splitAdminSource(value))
    .map((item) => normalizeEmailToken(item))
    .filter(Boolean);

  return allowed.includes(normalizedEmail);
}

function splitAdminSource(raw: string): string[] {
  const trimmed = raw.trim();
  if (!trimmed) return [];

  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return parsed.map((item) => String(item ?? ""));
      }
    } catch {
      // fallback to delimiter split below
    }
  }

  return trimmed.split(/[,\n;]+/);
}

function normalizeEmailToken(raw: string): string {
  return raw
    .trim()
    .replace(/^['"`]+|['"`]+$/g, "")
    .toLowerCase();
}
