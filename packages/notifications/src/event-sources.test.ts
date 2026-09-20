import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { NOTIFICATION_EVENT_SOURCES, NOTIFICATION_RECONCILE_MODULE } from "./event-sources";
import { NOTIFICATION_TYPES } from "./types";

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));

function readRepoFile(relativePath: string): string {
  return readFileSync(join(repoRoot, relativePath), "utf8");
}

function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Matches the anchor as a whole token, so renaming `emitFoo` to `emitFooV2` is
 * treated as a missing emitter instead of silently satisfying a substring check.
 */
function containsAnchor(source: string, anchor: string): boolean {
  const prefix = /^\w/.test(anchor) ? "(?<!\\w)" : "";
  const suffix = /\w$/.test(anchor) ? "(?!\\w)" : "";
  return new RegExp(`${prefix}${escapeRegExp(anchor)}${suffix}`).test(source);
}

function reconcileBody(): string {
  const module = readRepoFile(NOTIFICATION_RECONCILE_MODULE);
  const start = module.indexOf("export async function reconcileNotificationSources");
  if (start === -1) throw new Error(`${NOTIFICATION_RECONCILE_MODULE} no longer exports reconcileNotificationSources`);
  return module.slice(start);
}

describe("notification event-source catalog", () => {
  test("declares an event source for exactly the supported notification types", () => {
    const declared = Object.keys(NOTIFICATION_EVENT_SOURCES).sort();
    const supported = [...NOTIFICATION_TYPES].sort();
    expect(declared).toEqual(supported);
  });

  test("every declared emitter exists in the runtime", () => {
    for (const type of NOTIFICATION_TYPES) {
      const definition = NOTIFICATION_EVENT_SOURCES[type];
      expect(definition.emitters.length).toBeGreaterThan(0);
      for (const emitter of definition.emitters) {
        const source = readRepoFile(emitter.file);
        expect(containsAnchor(source, emitter.anchor), `${type} emitter ${emitter.file} must contain ${emitter.anchor}`).toBe(true);
      }
    }
  });

  test("every reconcilable source is invoked by the durable reconciliation pass", () => {
    const body = reconcileBody();
    for (const type of NOTIFICATION_TYPES) {
      const definition = NOTIFICATION_EVENT_SOURCES[type];
      if (!definition.reconciler) continue;
      const module = readRepoFile(definition.reconciler.file);
      expect(containsAnchor(module, definition.reconciler.anchor), `${type} reconciler ${definition.reconciler.anchor} is not defined`).toBe(true);
      expect(containsAnchor(body, definition.reconciler.anchor), `${type} reconciler ${definition.reconciler.anchor} is not called by reconcileNotificationSources`).toBe(true);
    }
  });

  test("only opt-in or explicitly non-reconciled events skip the durable pass", () => {
    const withoutReconciler = NOTIFICATION_TYPES.filter((type) => !NOTIFICATION_EVENT_SOURCES[type].reconciler);
    expect(withoutReconciler).toEqual(["inbound_message"]);
  });
});
