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

  return trimmed.split(/[,\n;\s]+/);
}

function normalizeEmailToken(raw: string): string {
  const cleaned = raw
    .trim()
    .replace(/^['"`]+|['"`]+$/g, "")
    .toLowerCase();
  if (!cleaned) return "";

  const angleMatch = cleaned.match(/<([^>]+)>/);
  const candidate = angleMatch?.[1]?.trim() || cleaned.replace(/[<>]/g, "").trim();
  if (!candidate.includes("@")) return candidate;

  const [localPartRaw, domainRaw] = candidate.split("@");
  const localRaw = localPartRaw ?? "";
  if (!localRaw || !domainRaw) return candidate;
  const domain = domainRaw === "googlemail.com" ? "gmail.com" : domainRaw;
  const plusIndex = localRaw.indexOf("+");
  const localNoAlias = plusIndex >= 0 ? localRaw.slice(0, plusIndex) : localRaw;
  if (domain !== "gmail.com") return `${localNoAlias}@${domain}`;

  const localCanonical = localNoAlias.replace(/\./g, "");
  return `${localCanonical}@${domain}`;
}
