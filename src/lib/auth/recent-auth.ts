export const ACCOUNT_DELETE_MAX_AUTH_AGE_MS = 5 * 60 * 1000;

export function hasRecentAuthentication(
  authTime: string | undefined,
  now = Date.now(),
  maxAgeMs = ACCOUNT_DELETE_MAX_AUTH_AGE_MS,
): boolean {
  if (!authTime) return false;

  const authenticatedAt = Date.parse(authTime);
  if (!Number.isFinite(authenticatedAt)) return false;

  const age = now - authenticatedAt;
  return age >= 0 && age <= maxAgeMs;
}
