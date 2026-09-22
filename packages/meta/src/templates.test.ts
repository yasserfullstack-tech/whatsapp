import { describe, expect, test } from "bun:test";
import {
  analyzeTemplateComponents,
  renderTemplateComponents,
  validateTemplateBindings,
  type TemplateParameterBinding,
} from "./templates";

const recipient = { displayName: "Yasser", phoneE164: "+9647700000000" };

describe("rich WhatsApp template components", () => {
  test("analyzes text header, body variables, URL and quick-reply buttons", () => {
    const components = [
      { type: "HEADER", format: "TEXT", text: "Order {{1}}" },
      { type: "BODY", text: "Hi {{1}}, your order {{2}} is ready." },
      {
        type: "BUTTONS",
        buttons: [
          { type: "URL", text: "Track", url: "https://example.com/orders/{{1}}" },
          { type: "PHONE_NUMBER", text: "Call", phone_number: "+15550001111" },
          { type: "QUICK_REPLY", text: "Stop" },
        ],
      },
    ];

    const analysis = analyzeTemplateComponents(components);
    expect(analysis.supported).toBe(true);
    expect(analysis.slots.map((slot) => slot.key)).toEqual([
      "header:text:1",
      "body:text:1",
      "body:text:2",
      "button:0:url:1",
      "button:2:quick_reply:1",
    ]);
  });

  test.each(["IMAGE", "VIDEO", "DOCUMENT"] as const)("renders %s headers", (format) => {
    const parameterType = format.toLowerCase() as "image" | "video" | "document";
    const components = [
      { type: "HEADER", format },
      { type: "BODY", text: "Hi {{1}}" },
    ];
    const bindings: TemplateParameterBinding[] = [
      {
        key: `header:${parameterType}:1`,
        index: 1,
        component: "header",
        parameterType,
        source: "literal",
        value: `https://cdn.example.com/example.${parameterType === "image" ? "jpg" : parameterType === "video" ? "mp4" : "pdf"}`,
      },
      {
        key: "body:text:1",
        index: 1,
        component: "body",
        parameterType: "text",
        source: "display_name",
        fallback: "Customer",
      },
    ];

    const rendered = renderTemplateComponents(components, bindings, recipient);
    expect(rendered?.[0]?.type).toBe("header");
    expect(rendered?.[0]?.parameters?.[0]?.type).toBe(parameterType);
    expect(rendered?.[1]).toEqual({ type: "body", parameters: [{ type: "text", text: "Yasser" }] });
  });

  test("renders URL substitutions and quick-reply payloads as button components", () => {
    const components = [
      { type: "BODY", text: "Hi {{1}}" },
      {
        type: "BUTTONS",
        buttons: [
          { type: "URL", text: "Open", url: "https://example.com/{{1}}" },
          { type: "QUICK_REPLY", text: "Confirm" },
        ],
      },
    ];
    const bindings: TemplateParameterBinding[] = [
      { key: "body:text:1", index: 1, component: "body", parameterType: "text", source: "display_name", fallback: "Customer" },
      { key: "button:0:url:1", index: 1, component: "button", parameterType: "text", buttonIndex: 0, buttonSubType: "url", source: "literal", value: "abc123" },
      { key: "button:1:quick_reply:1", index: 1, component: "button", parameterType: "payload", buttonIndex: 1, buttonSubType: "quick_reply", source: "literal", value: "confirm-order" },
    ];

    expect(renderTemplateComponents(components, bindings, recipient)).toEqual([
      { type: "body", parameters: [{ type: "text", text: "Yasser" }] },
      { type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: "abc123" }] },
      { type: "button", sub_type: "quick_reply", index: "1", parameters: [{ type: "payload", payload: "confirm-order" }] },
    ]);
  });

  test("keeps legacy body-only bindings compatible", () => {
    const components = [{ type: "BODY", text: "Hi {{1}}" }];
    const validation = validateTemplateBindings(components, [{ index: 1, source: "display_name", fallback: "Customer" }]);
    expect(validation.valid).toBe(true);
    expect(validation.normalizedBindings[0]?.key).toBe("body:text:1");
  });

  test("rejects missing mappings, non-HTTPS media, and unsupported template components", () => {
    const media = [{ type: "HEADER", format: "IMAGE" }, { type: "BODY", text: "Hello" }];
    expect(validateTemplateBindings(media, []).valid).toBe(false);
    expect(() => renderTemplateComponents(media, [{
      key: "header:image:1",
      index: 1,
      component: "header",
      parameterType: "image",
      source: "literal",
      value: "http://example.com/header.jpg",
    }], recipient)).toThrow("valid HTTPS URL");

    expect(analyzeTemplateComponents([
      { type: "HEADER", format: "LOCATION" },
      { type: "BODY", text: "Hello" },
    ]).supported).toBe(false);
    expect(analyzeTemplateComponents([
      { type: "BODY", text: "Code {{1}}" },
      { type: "BUTTONS", buttons: [{ type: "OTP", text: "Copy code" }] },
    ]).supported).toBe(false);
  });
});
