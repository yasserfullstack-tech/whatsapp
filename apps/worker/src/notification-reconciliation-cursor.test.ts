import { describe, expect, test } from "bun:test";
import {
  NOTIFICATION_SOURCE_CURSOR_KEY,
  SOURCE_CURSOR_BOOTSTRAP_LOOKBACK_MS,
  SOURCE_REPLAY_OVERLAP_MS,
  reconcileWithPersistentSourceCursor,
  type NotificationSourceCursorStore,
} from "./notification-reconciliation-cursor";

class MemoryCursorStore implements NotificationSourceCursorStore {
  readonly values = new Map<string, string>();

  async get(key: string): Promise<string | null> {
    return this.values.get(key) ?? null;
  }

  async set(key: string, value: string): Promise<unknown> {
    this.values.set(key, value);
    return "OK";
  }
}

describe("notification source reconciliation cursor", () => {
  test("persists the successful scan cursor across worker restarts", async () => {
    const store = new MemoryCursorStore();
    const firstNow = new Date("2026-09-21T06:00:00.000Z");
    let firstSinceIso: string | undefined;

    const first = await reconcileWithPersistentSourceCursor({
      store,
      now: () => firstNow,
      reconcile: async (since) => {
        firstSinceIso = since.toISOString();
        return "first";
      },
    });

    expect(first.bootstrapped).toBe(true);
    expect(firstSinceIso).toBe(
      new Date(firstNow.getTime() - SOURCE_CURSOR_BOOTSTRAP_LOOKBACK_MS - SOURCE_REPLAY_OVERLAP_MS).toISOString(),
    );
    expect(store.values.get(NOTIFICATION_SOURCE_CURSOR_KEY)).toBe(firstNow.toISOString());

    const secondNow = new Date("2026-09-21T08:30:00.000Z");
    let secondSinceIso: string | undefined;
    const second = await reconcileWithPersistentSourceCursor({
      store,
      now: () => secondNow,
      reconcile: async (since) => {
        secondSinceIso = since.toISOString();
        return "second";
      },
    });

    expect(second.bootstrapped).toBe(false);
    expect(secondSinceIso).toBe(
      new Date(firstNow.getTime() - SOURCE_REPLAY_OVERLAP_MS).toISOString(),
    );
    expect(store.values.get(NOTIFICATION_SOURCE_CURSOR_KEY)).toBe(secondNow.toISOString());
  });

  test("does not advance the cursor when reconciliation fails", async () => {
    const store = new MemoryCursorStore();
    const previous = new Date("2026-09-21T05:00:00.000Z");
    store.values.set(NOTIFICATION_SOURCE_CURSOR_KEY, previous.toISOString());

    await expect(reconcileWithPersistentSourceCursor({
      store,
      now: () => new Date("2026-09-21T06:00:00.000Z"),
      reconcile: async () => {
        throw new Error("source scan failed");
      },
    })).rejects.toThrow("source scan failed");

    expect(store.values.get(NOTIFICATION_SOURCE_CURSOR_KEY)).toBe(previous.toISOString());
  });

  test("falls back to the bounded bootstrap lookback for a malformed cursor", async () => {
    const store = new MemoryCursorStore();
    store.values.set(NOTIFICATION_SOURCE_CURSOR_KEY, "not-a-date");
    const now = new Date("2026-09-21T06:00:00.000Z");
    let observedSinceIso: string | undefined;

    const result = await reconcileWithPersistentSourceCursor({
      store,
      now: () => now,
      reconcile: async (since) => {
        observedSinceIso = since.toISOString();
        return null;
      },
    });

    expect(result.bootstrapped).toBe(true);
    expect(observedSinceIso).toBe(
      new Date(now.getTime() - SOURCE_CURSOR_BOOTSTRAP_LOOKBACK_MS - SOURCE_REPLAY_OVERLAP_MS).toISOString(),
    );
  });
});
