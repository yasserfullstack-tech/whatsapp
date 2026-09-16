import { describe, expect, test } from "bun:test";
import {
  LEGAL_DOCUMENTS,
  missingRequiredLegalDocuments,
  shouldEnforceLegalAcceptance,
} from "./legal";

describe("legal document acceptance", () => {
  test("accepts every current required document version", () => {
    const accepted = LEGAL_DOCUMENTS.map((document) => ({
      documentType: document.type,
      documentVersion: document.version,
    }));

    expect(missingRequiredLegalDocuments(accepted)).toEqual([]);
  });

  test("requires renewed acceptance when a stored version is stale", () => {
    const accepted = LEGAL_DOCUMENTS.map((document) => ({
      documentType: document.type,
      documentVersion: document.type === "terms" ? "older-version" : document.version,
    }));

    expect(missingRequiredLegalDocuments(accepted).map((document) => document.type)).toEqual(["terms"]);
  });

  test("requires documents that have never been accepted", () => {
    const accepted = LEGAL_DOCUMENTS
      .filter((document) => document.type !== "privacy")
      .map((document) => ({ documentType: document.type, documentVersion: document.version }));

    expect(missingRequiredLegalDocuments(accepted).map((document) => document.type)).toEqual(["privacy"]);
  });
});

describe("legal acceptance enforcement", () => {
  test("bypasses only the isolated loopback E2E runtime", () => {
    expect(shouldEnforceLegalAcceptance({
      NODE_ENV: "test",
      E2E_BLOCK_EXTERNAL: "1",
      BETTER_AUTH_URL: "http://127.0.0.1:3000",
    } as NodeJS.ProcessEnv)).toBe(false);

    expect(shouldEnforceLegalAcceptance({
      NODE_ENV: "test",
      E2E_BLOCK_EXTERNAL: "1",
      BETTER_AUTH_URL: "https://app.example.com",
    } as NodeJS.ProcessEnv)).toBe(true);

    expect(shouldEnforceLegalAcceptance({
      NODE_ENV: "test",
      E2E_BLOCK_EXTERNAL: "0",
      BETTER_AUTH_URL: "http://localhost:3000",
    } as NodeJS.ProcessEnv)).toBe(true);
  });
});
