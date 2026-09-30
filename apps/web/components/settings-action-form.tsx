"use client";

import { useActionState, type ReactNode } from "react";
import type { ActionForm, ActionResult } from "@/lib/action-result";

// Renders both outcomes of a settings server action in place. Without it a save
// is silent and a refusal is an unexplained HTTP 500.
export function SettingsActionForm({
  action,
  submitLabel,
  pendingLabel,
  successMessage,
  children,
}: {
  action: ActionForm;
  submitLabel: string;
  pendingLabel: string;
  successMessage: string;
  children: ReactNode;
}) {
  const [state, formAction, pending] = useActionState<
    ActionResult | null,
    FormData
  >(action, null);

  return (
    <>
      <form className="settingsFields" action={formAction}>
        {children}
        <button className="primary" type="submit" disabled={pending}>
          {pending ? pendingLabel : submitLabel}
        </button>
      </form>
      {state ? (
        <p
          className={state.ok ? "settingsCallout" : "inlineError"}
          role="status"
        >
          {state.ok ? successMessage : state.error}
        </p>
      ) : null}
    </>
  );
}
