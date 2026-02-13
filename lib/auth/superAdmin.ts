export function isSuperAdminEmail(email?: string | null): boolean {
  if (!email) return false;
  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail) return false;

  const rawList = process.env.SUPER_ADMIN_EMAILS ?? "";
  if (!rawList.trim()) return false;

  const allowed = rawList
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);

  return allowed.includes(normalizedEmail);
}
