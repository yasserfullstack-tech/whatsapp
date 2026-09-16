export const WHATSAPP_CUSTOMER_SERVICE_WINDOW_MS = 24 * 60 * 60 * 1_000;

export function canSendAgentReply(lastInboundAt: Date | null, now = new Date()): boolean {
  if (!lastInboundAt) return false;
  const age = now.getTime() - lastInboundAt.getTime();
  return age >= 0 && age <= WHATSAPP_CUSTOMER_SERVICE_WINDOW_MS;
}

export function inboxMessagePreview(input: {
  text: string | null;
  mediaCaption: string | null;
  messageType: string;
}): string {
  return input.text?.trim()
    || input.mediaCaption?.trim()
    || `[${input.messageType}]`;
}
