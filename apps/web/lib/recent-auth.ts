export const RECENT_AUTH_WINDOW_MS = 10 * 60 * 1_000;

type SessionAge = { createdAt: Date | string };

export function hasRecentAuthentication(session: SessionAge, now = Date.now(), maxAgeMs = RECENT_AUTH_WINDOW_MS): boolean {
  const createdAt = session.createdAt instanceof Date ? session.createdAt.getTime() : new Date(session.createdAt).getTime();
  return Number.isFinite(createdAt) && now >= createdAt && now - createdAt <= maxAgeMs;
}
