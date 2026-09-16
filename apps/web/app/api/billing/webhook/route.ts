import {
  getStripeBillingProvider,
  getStripeWebhookProcessor,
} from "@/lib/billing-provider";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const rawBody = await request.text();
  const headers = Object.fromEntries(request.headers.entries());

  try {
    const event = await getStripeBillingProvider(true).verifyWebhook({ headers, rawBody });
    const result = await getStripeWebhookProcessor().process(event);
    return Response.json({ received: true, processed: result.processed, replay: result.replay });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Billing webhook processing failed";
    const signatureFailure = message.includes("signature") || message.includes("timestamp") || message.includes("webhook secret");
    return Response.json(
      { received: false, error: signatureFailure ? "invalid_webhook" : "processing_failed" },
      { status: signatureFailure ? 400 : 500 },
    );
  }
}
