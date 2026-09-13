import { expect, test } from "@playwright/test";
import {
  closeSecurityDatabase,
  createSecurityTenant,
  destroySecurityTenant,
  type SecurityTenant,
} from "./security-helpers";

const MAX_CSV_BYTES = 250 * 1024 * 1024;

test.describe.serial("upload and signed URL security boundary", () => {
  let tenant: SecurityTenant;

  test.beforeAll(async () => {
    tenant = await createSecurityTenant("upload-boundary");
  });

  test.afterAll(async () => {
    if (tenant) await destroySecurityTenant(tenant);
    await closeSecurityDatabase();
  });

  test("rejects oversized CSV metadata before signing", async () => {
    const response = await tenant.api.post("/api/contact-imports/presign", {
      data: {
        fileName: "contacts.csv",
        sizeBytes: MAX_CSV_BYTES + 1,
        defaultCountry: "IQ",
        optInSource: "security test",
        confirmedOptIn: true,
      },
    });
    expect(response.status()).toBe(400);
  });

  test("rejects non-CSV files and missing opt-in confirmation", async () => {
    const wrongType = await tenant.api.post("/api/contact-imports/presign", {
      data: {
        fileName: "contacts.xlsx",
        sizeBytes: 1024,
        defaultCountry: "IQ",
        optInSource: "security test",
        confirmedOptIn: true,
      },
    });
    expect(wrongType.status()).toBe(400);

    const noConsent = await tenant.api.post("/api/contact-imports/presign", {
      data: {
        fileName: "contacts.csv",
        sizeBytes: 1024,
        defaultCountry: "IQ",
        optInSource: "security test",
        confirmedOptIn: false,
      },
    });
    expect(noConsent.status()).toBe(400);
  });

  test("sanitizes object keys and signs only tenant-scoped CSV uploads", async () => {
    const response = await tenant.api.post("/api/contact-imports/presign", {
      data: {
        fileName: "../../private/contacts.csv",
        sizeBytes: 1024,
        defaultCountry: "IQ",
        optInSource: "security test",
        confirmedOptIn: true,
      },
    });
    expect(response.status(), await response.text()).toBe(200);

    const body = await response.json() as {
      importId: string;
      uploadUrl: string;
      contentType: string;
      expiresInSeconds: number;
      maxBytes: number;
    };
    expect(body.contentType).toBe("text/csv");
    expect(body.expiresInSeconds).toBe(1800);
    expect(body.maxBytes).toBe(MAX_CSV_BYTES);

    const url = new URL(body.uploadUrl);
    const path = decodeURIComponent(url.pathname);
    expect(path).toContain(`/${tenant.organizationId}/contact-imports/${body.importId}/`);
    expect(path).not.toContain("..");
    expect(url.searchParams.get("X-Amz-Expires")).toBe("1800");
    expect(url.searchParams.get("X-Amz-SignedHeaders")?.split(";")).toContain("content-type");
  });
});
