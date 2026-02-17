export function isSuperAdminEmail(email?: string | null): boolean {
  if (!email) return false;
  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail) return false;

  const sources = [
    process.env.SUPER_ADMIN_EMAILS ?? "",
    process.env.SUPER_ADMIN_EMAIL ?? "",
  ].filter((value) => value.trim().length > 0);
  if (sources.length === 0) return false;

  const allowed = sources
    .flatMap((value) => value.split(/[,\n;]+/))
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);

  return allowed.includes(normalizedEmail);
}
