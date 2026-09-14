import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import {
  createSecurityTenant,
  destroySecurityTenant,
  securitySql,
  seedTenantResources,
  setSecurityTenantRole,
  type SecurityTenant,
  type TenantResources,
} from "./security-helpers";

test.describe.serial("workspace product authorization matrix", () => {
  let tenant: SecurityTenant;
  let resources: TenantResources;

  test.beforeAll(async () => {
    tenant = await createSecurityTenant("role-matrix");
    resources = await seedTenantResources(tenant.organizationId);
  });

  test.afterAll(async () => {
    if (tenant) {
      await setSecurityTenantRole(tenant, "owner").catch(() => undefined);
      await destroySecurityTenant(tenant);
    }
  });

  test("viewer cannot create or mutate product resources", async () => {
    await setSecurityTenantRole(tenant, "viewer");

    const segment = await tenant.api.post("/api/audiences/segments", { data: {} });
    expect(segment.status(), "viewer must be denied before segment schema validation").toBe(403);

    const campaign = await tenant.api.post("/api/campaigns", { data: {} });
    expect(campaign.status(), "viewer must be denied before campaign schema validation").toBe(403);

    const presign = await tenant.api.post("/api/contact-imports/presign", { data: {} });
    expect(presign.status(), "viewer must be denied before creating import/storage state").toBe(403);

    const queueImport = await tenant.api.post(`/api/contact-imports/${randomUUID()}`);
    expect(queueImport.status(), "viewer must be denied before import lookup or queue work").toBe(403);

    const template = await tenant.api.post("/api/templates", { data: {} });
    expect(template.status(), "viewer must be denied before template validation or Meta access").toBe(403);

    const templateSync = await tenant.api.post("/api/templates/sync", { data: { wabaId: "not-connected" } });
    expect(templateSync.status(), "viewer must be denied before template sync or Meta access").toBe(403);

    const control = await tenant.api.post(`/api/campaigns/${resources.campaignId}/control`, {
      data: { action: "pause" },
    });
    // Keep the fixture stable even on the vulnerable pre-fix implementation.
    await securitySql`
      UPDATE campaigns SET status = 'sending', updated_at = now()
      WHERE id = ${resources.campaignId} AND organization_id = ${tenant.organizationId}
    `;
    expect(control.status(), "viewer must not pause a campaign").toBe(403);

    const suppress = await tenant.api.post(`/api/contacts/${resources.contactId}/suppress`, {
      data: { reason: "viewer authorization regression" },
    });
    expect(suppress.status()).toBe(403);

    const restore = await tenant.api.post(`/api/contacts/${resources.contactId}/resubscribe`, {
      data: {
        consentSource: "viewer regression",
        consentedAt: new Date().toISOString(),
        evidenceNote: "Viewer must not restore marketing consent.",
        confirmation: true,
      },
    });
    expect(restore.status()).toBe(403);
  });

  test("member can operate normal product workflows but cannot administer consent or workspace", async () => {
    await setSecurityTenantRole(tenant, "member");

    expect((await tenant.api.post("/api/audiences/segments", { data: {} })).status()).toBe(400);
    expect((await tenant.api.post("/api/campaigns", { data: {} })).status()).toBe(400);
    expect((await tenant.api.post("/api/contact-imports/presign", { data: {} })).status()).toBe(400);
    expect((await tenant.api.post("/api/templates", { data: {} })).status()).toBe(400);

    const suppress = await tenant.api.post(`/api/contacts/${resources.contactId}/suppress`, {
      data: { reason: "member suppression regression" },
    });
    expect(suppress.status()).toBe(200);

    const restore = await tenant.api.post(`/api/contacts/${resources.contactId}/resubscribe`, {
      data: {
        consentSource: "member regression",
        consentedAt: new Date(Date.now() + 1_000).toISOString(),
        evidenceNote: "Members must not restore marketing consent.",
        confirmation: true,
      },
    });
    expect(restore.status()).toBe(403);

    expect((await tenant.api.get("/api/settings/data/export")).status()).toBe(403);
    expect((await tenant.api.post("/api/settings/data/workspace-deletion", {
      data: { confirmation: "anything", acknowledge: true },
    })).status()).toBe(403);
  });

  test("admin can export data but cannot perform owner-only workspace deletion", async () => {
    await setSecurityTenantRole(tenant, "admin");
    expect((await tenant.api.get("/api/settings/data/export")).status()).toBe(200);
    expect((await tenant.api.post("/api/settings/data/workspace-deletion", {
      data: { confirmation: "anything", acknowledge: true },
    })).status()).toBe(403);
  });

  test("owner reaches owner-only deletion validation", async () => {
    await setSecurityTenantRole(tenant, "owner");
    const response = await tenant.api.post("/api/settings/data/workspace-deletion", {
      data: { confirmation: "not-the-workspace-slug", acknowledge: true },
    });
    expect(response.status()).toBe(400);
  });
});
