export type ActionResult = { ok: true } | { ok: false; error: string };

// Shape every settings form action must satisfy to be driven by useActionState.
export type ActionForm = (
  previous: ActionResult | null,
  formData: FormData,
) => Promise<ActionResult>;

export type LimitExceeded = { limit: number };

// Matched on the error name rather than instanceof: a bundled server can hold two
// copies of @wa/billing, and only the name and message survive that. Kept free of
// database imports so it stays unit-testable.
export function readLimitExceeded(error: unknown): LimitExceeded | null {
  if (!(error instanceof Error) || error.name !== "BillingLimitExceededError")
    return null;
  const limit = Number(/limit (\d+)/.exec(error.message)?.[1] ?? Number.NaN);
  return { limit: Number.isFinite(limit) ? limit : 0 };
}

export function limitExceededMessage(limit: number): string {
  return `This workspace has reached its plan limit of ${limit} team members. Remove a member or upgrade the plan, then try again.`;
}

// A bare <form action={serverAction}> gives the user nothing: the save is
// invisible on success and a refusal becomes an unexplained HTTP 500. Actions
// that opt in by returning an ActionResult get both outcomes rendered in place.
// Redirects must not be wrapped: next/navigation signals them by throwing.
export async function toActionResult(
  run: () => Promise<unknown>,
  fallbackMessage = "Something went wrong. Try again.",
): Promise<ActionResult> {
  try {
    await run();
    return { ok: true };
  } catch (error) {
    const exceeded = readLimitExceeded(error);
    if (exceeded)
      return { ok: false, error: limitExceededMessage(exceeded.limit) };
    return {
      ok: false,
      error:
        error instanceof Error && error.message
          ? error.message
          : fallbackMessage,
    };
  }
}
