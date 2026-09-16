import { describe, expect, test } from "bun:test";
import { parseInboxWebhook } from "./inbox";

describe("parseInboxWebhook", () => {
  test("normalizes text, profile, and media references", () => {
    const parsed = parseInboxWebhook({
      object: "whatsapp_business_account",
      entry: [{
        id: "waba-1",
        changes: [{
          field: "messages",
          value: {
            metadata: { phone_number_id: "phone-1", display_phone_number: "+1 555 0100" },
            contacts: [{ wa_id: "15550123", profile: { name: "Ada" } }],
            messages: [
              { id: "wamid.text", from: "15550123", timestamp: "1789590000", type: "text", text: { body: "Hello" } },
              {
                id: "wamid.image",
                from: "15550123",
                timestamp: "1789590001",
                type: "image",
                image: { id: "media-1", mime_type: "image/jpeg", sha256: "abc", caption: "Receipt" },
              },
            ],
          },
        }],
      }],
    });

    expect(parsed.messages).toHaveLength(2);
    expect(parsed.messages[0]).toMatchObject({
      messageId: "wamid.text",
      from: "15550123",
      type: "text",
      text: "Hello",
      profileName: "Ada",
      phoneNumberId: "phone-1",
      businessDisplayPhoneNumber: "+1 555 0100",
      wabaId: "waba-1",
    });
    expect(parsed.messages[1]).toMatchObject({
      type: "image",
      text: "Receipt",
      media: { id: "media-1", mimeType: "image/jpeg", sha256: "abc", caption: "Receipt" },
    });
  });

  test("captures interactive reply metadata without trusting arbitrary objects", () => {
    const parsed = parseInboxWebhook({
      object: "whatsapp_business_account",
      entry: [{
        id: "waba-1",
        changes: [{
          value: {
            metadata: { phone_number_id: "phone-1" },
            messages: [{
              id: "wamid.list",
              from: "15550123",
              type: "interactive",
              interactive: { list_reply: { id: "order-1", title: "Order status", description: "Track my order" } },
            }],
          },
        }],
      }],
    });

    expect(parsed.messages[0]).toMatchObject({
      type: "interactive",
      text: "Order status",
      interactivePayload: {
        kind: "list_reply",
        id: "order-1",
        title: "Order status",
        description: "Track my order",
      },
    });
  });
});
