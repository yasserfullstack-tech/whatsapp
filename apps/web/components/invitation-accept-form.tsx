"use client";

import { useActionState } from "react";
import {
  acceptWorkspaceInvitationAction,
  type InvitationAcceptResult,
} from "@/lib/workspace-actions";

// A plain <form action={serverAction}> turns every refusal into an unexplained
// HTTP 500 page. useActionState keeps the action's refusal on the page.
export function InvitationAcceptForm({
  token,
  label,
}: {
  token: string;
  label: string;
}) {
  const [state, action, pending] = useActionState<
    InvitationAcceptResult | null,
    FormData
  >(acceptWorkspaceInvitationAction, null);

  return (
    <form action={action}>
      <input type="hidden" name="token" value={token} />
      <button className="primary" type="submit" disabled={pending}>
        {pending ? "Accepting…" : label}
      </button>
      {state && !state.ok ? (
        <p className="inlineError" role="alert">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}
