import { expect, test } from "bun:test";

test("deliberate red probe for issue #91", () => {
  expect(1).toBe(2);
});
