export type ActionResult = { ok: true } | { ok: false; error: string };

// Shape every settings form action must satisfy to be driven by useActionState.
export type ActionForm = (
  previous: ActionResult | null,
  formData: FormData,
) => Promise<ActionResult>;

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
    return {
      ok: false,
      error:
        error instanceof Error && error.message
          ? error.message
          : fallbackMessage,
    };
  }
}
