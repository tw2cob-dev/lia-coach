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
  const cleaned = raw
    .trim()
    .replace(/^['"`]+|['"`]+$/g, "")
    .toLowerCase();
  if (!cleaned || !cleaned.includes("@")) return cleaned;

  const [localRaw, domainRaw] = cleaned.split("@");
  const domain = domainRaw === "googlemail.com" ? "gmail.com" : domainRaw;
  if (domain !== "gmail.com") return `${localRaw}@${domain}`;

  const plusIndex = localRaw.indexOf("+");
  const localNoAlias = plusIndex >= 0 ? localRaw.slice(0, plusIndex) : localRaw;
  const localCanonical = localNoAlias.replace(/\./g, "");
  return `${localCanonical}@${domain}`;
}
