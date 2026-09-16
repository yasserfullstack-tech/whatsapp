import { describe, expect, test } from "bun:test";
import { isMarketingOptOutMessage, parseWhatsAppWebhook } from "./webhooks";

describe("parseWhatsAppWebhook", () => {
  test("extracts status updates and phone metadata", () => {
    const parsed = parseWhatsAppWebhook({
      object: "whatsapp_business_account",
      entry: [{
        id: "waba-1",
        changes: [{
          field: "messages",
          value: {
            messaging_product: "whatsapp",
            metadata: { phone_number_id: "phone-1" },
            statuses: [
              { id: "wamid.1", status: "delivered", timestamp: "1700000000", recipient_id: "9647000000000" },
              { id: "wamid.2", status: "failed", timestamp: "1700000001", errors: [{ code: 131014, title: "Media download failed", error_data: { details: "404" } }] },
            ],
          },
        }],
      }],
    });

    expect(parsed.phoneNumberIds).toEqual(["phone-1"]);
    expect(parsed.statuses).toHaveLength(2);
    expect(parsed.statuses[0]).toMatchObject({
      wamid: "wamid.1",
      status: "delivered",
      timestampSeconds: 1700000000,
      phoneNumberId: "phone-1",
      wabaId: "waba-1",
    });
    expect(parsed.statuses[1]?.errors[0]).toEqual({ code: "131014", title: "Media download failed", details: "404" });
  });

  test("ignores unsupported or malformed status entries", () => {
    const parsed = parseWhatsAppWebhook({
      object: "whatsapp_business_account",
      entry: [{ changes: [{ value: { statuses: [{ id: "wamid.1", status: "deleted" }, { status: "sent" }] } }] }],
    });

    expect(parsed.statuses).toEqual([]);
  });

  test("extracts inbound text and quick-reply messages for opt-out handling", () => {
    const parsed = parseWhatsAppWebhook({
      object: "whatsapp_business_account",
      entry: [{
        id: "waba-1",
        changes: [{
          field: "messages",
          value: {
            metadata: { phone_number_id: "phone-1" },
            messages: [
              { id: "in.1", from: "9647000000000", timestamp: "1700000002", type: "text", text: { body: "STOP" } },
              { id: "in.2", from: "9647000000001", timestamp: "1700000003", type: "button", button: { text: "Stop promotions", payload: "STOP_PROMOTIONS" } },
            ],
          },
        }],
      }],
    });

    expect(parsed.messages).toHaveLength(2);
    expect(parsed.messages[0]).toMatchObject({ messageId: "in.1", from: "9647000000000", text: "STOP", phoneNumberId: "phone-1" });
    expect(isMarketingOptOutMessage(parsed.messages[0]!)).toBe(true);
    expect(isMarketingOptOutMessage(parsed.messages[1]!)).toBe(true);
  });

  test("extracts Meta template, phone and account state events", () => {
    const parsed = parseWhatsAppWebhook({
      object: "whatsapp_business_account",
      entry: [{
        id: "waba-1",
        time: 1700000100,
        changes: [
          {
            field: "message_template_status_update",
            value: {
              event: "APPROVED",
              message_template_id: "template-1",
              message_template_name: "welcome",
              message_template_language: "en_US",
            },
          },
          {
            field: "phone_number_name_update",
            value: {
              display_phone_number: "+1 650 555 1111",
              decision: "APPROVED",
              requested_verified_name: "Acme",
            },
          },
          {
            field: "phone_number_quality_update",
            value: {
              display_phone_number: "+1 650 555 1111",
              event: "FLAGGED",
              current_limit: "TIER_10K",
            },
          },
          {
            field: "account_update",
            value: {
              event: "DISABLED_UPDATE",
              ban_info: { waba_ban_state: "FLAGGED", waba_ban_date: "January 31, 2021" },
            },
          },
          {
            field: "account_review_update",
            value: { decision: "APPROVED" },
          },
        ],
      }],
    });

    expect(parsed.assetEvents).toEqual([
      {
        kind: "template_status",
        wabaId: "waba-1",
        timestampSeconds: 1700000100,
        templateId: "template-1",
        templateName: "welcome",
        language: "en_US",
        event: "APPROVED",
      },
      {
        kind: "phone_name",
        wabaId: "waba-1",
        timestampSeconds: 1700000100,
        displayPhoneNumber: "+1 650 555 1111",
        decision: "APPROVED",
        requestedVerifiedName: "Acme",
      },
      {
        kind: "phone_quality",
        wabaId: "waba-1",
        timestampSeconds: 1700000100,
        displayPhoneNumber: "+1 650 555 1111",
        event: "FLAGGED",
        currentLimit: "TIER_10K",
      },
      {
        kind: "account_update",
        wabaId: "waba-1",
        timestampSeconds: 1700000100,
        event: "DISABLED_UPDATE",
        banState: "FLAGGED",
        banDate: "January 31, 2021",
      },
      {
        kind: "account_review",
        wabaId: "waba-1",
        timestampSeconds: 1700000100,
        decision: "APPROVED",
      },
    ]);
  });

  test("does not interpret ordinary customer text as an opt-out", () => {
    expect(isMarketingOptOutMessage({ messageId: "in.3", from: "1", type: "text", text: "Please stop by tomorrow" })).toBe(false);
  });
});
