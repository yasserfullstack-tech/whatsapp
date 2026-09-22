import { describe, expect, test } from "bun:test";
import { buildTextMessagePayload } from "./messages";

describe("buildTextMessagePayload", () => {
  test("builds an individual WhatsApp text reply", () => {
    expect(buildTextMessagePayload({ to: "+15550123", text: "Thanks for contacting us" })).toEqual({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: "+15550123",
      type: "text",
      text: { preview_url: false, body: "Thanks for contacting us" },
    });
  });

  test("can attach a reply context without changing the message type", () => {
    expect(buildTextMessagePayload({ to: "+15550123", text: "Got it", replyToMessageId: "wamid.inbound" })).toMatchObject({
      type: "text",
      context: { message_id: "wamid.inbound" },
    });
  });
});
