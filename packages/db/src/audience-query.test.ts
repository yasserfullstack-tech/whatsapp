import { describe, expect, test } from "bun:test";
import { normalizeAudienceDefinition } from "./audience-query";

describe("normalizeAudienceDefinition", () => {
  test("keeps valid list and segment definitions", () => {
    expect(normalizeAudienceDefinition({
      type: "list",
      listId: "123e4567-e89b-42d3-a456-426614174000",
    })).toEqual({
      type: "list",
      listId: "123e4567-e89b-42d3-a456-426614174000",
    });

    expect(normalizeAudienceDefinition({
      type: "segment",
      match: "all",
      filters: [
        { field: "display_name", operator: "contains", value: "VIP" },
        { field: "phone_e164", operator: "starts_with", value: "+964" },
      ],
    })).toEqual({
      type: "segment",
      match: "all",
      filters: [
        { field: "display_name", operator: "contains", value: "VIP" },
        { field: "phone_e164", operator: "starts_with", value: "+964" },
      ],
    });
  });

  test("fails closed instead of widening malformed definitions", () => {
    const invalid = normalizeAudienceDefinition({ type: "list", listId: "not-a-uuid" });
    expect(invalid.type).toBe("segment");
    expect(invalid).not.toEqual({ type: "all" });

    const malformedSegment = normalizeAudienceDefinition({
      type: "segment",
      match: "any",
      filters: [{ field: "display_name", operator: "contains", value: "" }],
    });
    expect(malformedSegment.type).toBe("segment");
    expect(malformedSegment).not.toEqual({ type: "all" });
  });
});
