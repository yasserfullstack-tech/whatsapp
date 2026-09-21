export const NOTIFICATION_SOURCE_CURSOR_KEY = "notification:sources:cursor:v1";
export const SOURCE_REPLAY_OVERLAP_MS = 2 * 60_000;
export const SOURCE_CURSOR_BOOTSTRAP_LOOKBACK_MS = 24 * 60 * 60_000;

export type NotificationSourceCursorStore = {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<unknown>;
};

function parseCursor(value: string | null): Date | null {
  if (!value) return null;
  const cursor = new Date(value);
  return Number.isNaN(cursor.getTime()) ? null : cursor;
}

export async function reconcileWithPersistentSourceCursor<T>(input: {
  store: NotificationSourceCursorStore;
  reconcile: (since: Date) => Promise<T>;
  now?: () => Date;
}): Promise<{
  result: T;
  since: Date;
  cursor: Date;
  bootstrapped: boolean;
}> {
  const cursor = input.now?.() ?? new Date();
  const persisted = parseCursor(await input.store.get(NOTIFICATION_SOURCE_CURSOR_KEY));
  const anchor = persisted ?? new Date(cursor.getTime() - SOURCE_CURSOR_BOOTSTRAP_LOOKBACK_MS);
  const since = new Date(anchor.getTime() - SOURCE_REPLAY_OVERLAP_MS);

  const result = await input.reconcile(since);

  // Advance only after the full reconciliation pass succeeds. If the process
  // crashes or any source throws, the previous cursor remains and the next pass
  // replays the same stable-dedupe window.
  await input.store.set(NOTIFICATION_SOURCE_CURSOR_KEY, cursor.toISOString());

  return { result, since, cursor, bootstrapped: persisted === null };
}
