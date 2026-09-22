import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { schema } from "../../packages/db/src/index";
import { createContactImportQueue } from "../../packages/queue/src/index";
import {
  SECURITY_BASE_URL,
  createSecurityTenant,
  destroySecurityTenant,
  securityDb,
  securitySql,
  type SecurityTenant,
} from "./security-helpers";

/**
 * PR-020 evidence: the platform-admin operational surface (billing, Meta
 * connection health, queue/dead-letter retry, membership support, webhook
 * operations, pagination/search, audit export) is reachable only with an active
 * platform-admin grant, every privileged mutation is audited, and retries are
 * guarded. No impersonation path is exercised or expected here.
 *
 * Read-only assertions use `securitySql` because `drizzle-orm` is not resolvable
 * from the repository root; inserts reuse the `securityDb` handle that
 * `security-helpers` already builds from `packages/db`.
 */

function decodeHtmlAttribute(value: string): string {
  return value
    .replaceAll("&quot;", '"')
    .replaceAll("&#x27;", "'")
    .replaceAll("&#39;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");
}

function attributeValue(attributes: string, name: string): string | null {
  const match = attributes.match(new RegExp(`(?:^|\\s)${name}="([^"]*)"`, "i"));
  return match?.[1] ? decodeHtmlAttribute(match[1]) : null;
}

function extractActionForm(html: string, fieldName: string, fieldValue: string, buttonText: string): Record<string, string> {
  for (const match of html.matchAll(/<form\b[^>]*>([\s\S]*?)<\/form>/gi)) {
    const body = match[1] ?? "";
    if (!body.includes(`name="${fieldName}"`) || !body.includes(`value="${fieldValue}"`) || !body.includes(buttonText)) continue;
    const multipart: Record<string, string> = {};
    for (const input of body.matchAll(/<input\b([^>]*)>/gi)) {
      const attributes = input[1] ?? "";
      const name = attributeValue(attributes, "name");
      if (!name) continue;
      multipart[name] = attributeValue(attributes, "value") ?? "";
    }
    return multipart;
  }
  throw new Error(`Could not find rendered platform-admin ${buttonText} form`);
}

async function replayAdminAction(actor: SecurityTenant, pagePath: string, multipart: Record<string, string>) {
  return actor.api.post(pagePath, {
    multipart,
    headers: {
      origin: SECURITY_BASE_URL,
      referer: `${SECURITY_BASE_URL}${pagePath}`,
      "sec-fetch-site": "same-origin",
    },
    maxRedirects: 0,
  });
}

function isRedirect(status: number): boolean {
  return [302, 303, 307, 308].includes(status);
}

/**
 * React SSR splits `Page {page} of {totalPages}` into separate text nodes and
 * inserts empty comment markers between them, so strip those before asserting
 * on rendered copy.
 */
function renderedText(html: string): string {
  return html.replaceAll("<!-- -->", "");
}

async function auditCount(action: string, targetId: string): Promise<number> {
  const rows = await securitySql`
    SELECT count(*)::int AS count
    FROM platform_audit_events
    WHERE action = ${action}
      AND target_id = ${targetId}
  ` as unknown as Array<{ count: number }>;
  return rows[0]?.count ?? 0;
}

test.describe.serial("expanded platform administrator operational tooling", () => {
  let admin: SecurityTenant;
  let attacker: SecurityTenant;
  let victim: SecurityTenant;
  const run = randomUUID().slice(0, 8);
  const phoneNumberId = `phone-ops-${run}`;
  let victimOrganizationSlug = "";
  let contactImportQueue: ReturnType<typeof createContactImportQueue>;
  // The billing fixture creates a platform-wide plan (no `organizationId`), so
  // it does not cascade with the tenant and has to be removed explicitly.
  let billingPlanId: string | null = null;

  const adminViews = [
    "/admin",
    "/admin/organizations",
    "/admin/users",
    "/admin/access",
    "/admin/billing",
    "/admin/campaigns",
    "/admin/connections",
    "/admin/imports",
    "/admin/webhooks",
    "/admin/system",
    "/admin/audit",
  ];

  test.beforeAll(async () => {
    admin = await createSecurityTenant("platform-ops-admin");
    attacker = await createSecurityTenant("platform-ops-attacker");
    victim = await createSecurityTenant("platform-ops-victim");
    await securityDb.insert(schema.platformAdminGrants).values({ authUserId: admin.authUserId, source: "security-test" });

    const organizationRows = await securitySql`
      SELECT slug FROM organizations WHERE id = ${victim.organizationId}::uuid LIMIT 1
    ` as unknown as Array<{ slug: string }>;
    victimOrganizationSlug = organizationRows[0]?.slug ?? "";

    contactImportQueue = createContactImportQueue(process.env.REDIS_URL ?? "redis://127.0.0.1:6379");
  });

  test.afterAll(async () => {
    if (contactImportQueue) await contactImportQueue.close();
    if (victim) await destroySecurityTenant(victim);
    // Subscriptions and subscription changes cascade with the organization, so
    // by now nothing references the plan versions and the plan can be dropped.
    if (billingPlanId) {
      await securitySql`DELETE FROM plans WHERE id = ${billingPlanId}::uuid`;
    }
    if (attacker) await destroySecurityTenant(attacker);
    if (admin) await destroySecurityTenant(admin);
  });

  test("every platform operations view requires an active platform-admin grant", async () => {
    for (const path of adminViews) {
      const authorized = await admin.api.get(path, { maxRedirects: 0 });
      expect(authorized.status(), `platform administrator should load ${path}`).toBe(200);

      const forbidden = await attacker.api.get(path, { maxRedirects: 0 });
      expect(isRedirect(forbidden.status()), `workspace user must not load ${path} (got ${forbidden.status()})`).toBe(true);
    }
  });

  test("Meta connection health is visible, searchable, and filterable", async () => {
    await securityDb.insert(schema.whatsappPhoneNumbers).values({
      organizationId: victim.organizationId,
      wabaId: `waba-ops-${run}`,
      phoneNumberId,
      displayPhoneNumber: "+15550199001",
      verifiedName: `Ops Number ${run}`,
      status: "restricted",
      healthStatus: "reauthorization_required",
      reauthorizationRequired: true,
      failureCode: "REAUTH_REQUIRED",
      failureReason: `credential revoked for ${run}`,
      credentialKey: `security/${victim.organizationId}/${phoneNumberId}`,
    });

    const found = await admin.api.get(`/admin/connections?q=${encodeURIComponent(phoneNumberId)}`);
    const foundHtml = await found.text();
    expect(found.status(), foundHtml).toBe(200);
    expect(foundHtml).toContain(phoneNumberId);
    expect(foundHtml).toContain("reconnect required");
    expect(foundHtml).toContain(`credential revoked for ${run}`);

    const filtered = await admin.api.get(`/admin/connections?q=${encodeURIComponent(phoneNumberId)}&health=reauthorization_required`);
    expect(filtered.status(), await filtered.text()).toBe(200);

    const mismatched = await admin.api.get(`/admin/connections?q=${encodeURIComponent(`no-such-number-${run}`)}`);
    const mismatchedHtml = await mismatched.text();
    expect(mismatched.status(), mismatchedHtml).toBe(200);
    expect(mismatchedHtml).not.toContain(phoneNumberId);
  });

  test("billing visibility and guarded subscription controls are authorized and audited", async () => {
    const [plan] = await securityDb.insert(schema.billingPlans).values({
      code: `sec-ops-${run}`,
      name: `Security Ops Plan ${run}`,
      isActive: true,
    }).returning();
    billingPlanId = plan.id;
    const [currentVersion] = await securityDb.insert(schema.billingPlanVersions).values({
      planId: plan.id,
      version: 1,
      currency: "USD",
      priceMinor: 1900,
    }).returning();
    const [targetVersion] = await securityDb.insert(schema.billingPlanVersions).values({
      planId: plan.id,
      version: 2,
      currency: "USD",
      priceMinor: 2900,
    }).returning();

    // Workspace bootstrap already creates the billing account plus a
    // provider-managed starter subscription; reuse both and mark the
    // subscription manually managed so the guarded platform controls apply.
    const accountRows = await securitySql`
      SELECT id FROM billing_accounts WHERE organization_id = ${victim.organizationId}::uuid LIMIT 1
    ` as unknown as Array<{ id: string }>;
    expect(accountRows[0]?.id, "workspace bootstrap should create a billing account").toBeTruthy();

    const subscriptionRows = await securitySql`
      UPDATE subscriptions
      SET plan_version_id = ${currentVersion.id}::uuid,
          status = 'active',
          is_manual = true,
          provider_key = NULL,
          provider_subscription_id = NULL,
          updated_at = now()
      WHERE organization_id = ${victim.organizationId}::uuid
      RETURNING id
    ` as unknown as Array<{ id: string }>;
    const subscriptionId = subscriptionRows[0]?.id;
    expect(subscriptionId, "workspace bootstrap should create a subscription").toBeTruthy();

    const pagePath = `/admin/billing?q=${encodeURIComponent(victimOrganizationSlug)}`;
    const rendered = await admin.api.get(pagePath);
    const html = await rendered.text();
    expect(rendered.status(), html).toBe(200);
    expect(html).toContain(victimOrganizationSlug);
    expect(html).toContain(`Security Ops Plan ${run}`);

    const changePlanForm = extractActionForm(html, "subscriptionId", subscriptionId!, "Change plan");
    changePlanForm.planVersionId = targetVersion.id;

    const forgedPlanChange = await replayAdminAction(attacker, pagePath, changePlanForm);
    expect([200, 201, 202, 204]).not.toContain(forgedPlanChange.status());
    let planRows = await securitySql`
      SELECT plan_version_id AS "planVersionId" FROM subscriptions WHERE id = ${subscriptionId}::uuid
    ` as unknown as Array<{ planVersionId: string }>;
    expect(planRows[0]?.planVersionId).toBe(currentVersion.id);
    expect(await auditCount("billing.plan_changed_by_platform_admin", subscriptionId!)).toBe(0);

    const authorizedPlanChange = await replayAdminAction(admin, pagePath, changePlanForm);
    const authorizedPlanChangeBody = await authorizedPlanChange.text();
    expect(authorizedPlanChange.status(), authorizedPlanChangeBody).toBe(200);
    planRows = await securitySql`
      SELECT plan_version_id AS "planVersionId" FROM subscriptions WHERE id = ${subscriptionId}::uuid
    ` as unknown as Array<{ planVersionId: string }>;
    expect(planRows[0]?.planVersionId).toBe(targetVersion.id);
    expect(await auditCount("billing.plan_changed_by_platform_admin", subscriptionId!)).toBe(1);

    const rerendered = await admin.api.get(pagePath);
    const suspendForm = extractActionForm(await rerendered.text(), "subscriptionId", subscriptionId!, "Suspend billing");
    suspendForm.reason = `security suspend ${run}`;

    const forgedSuspend = await replayAdminAction(attacker, pagePath, suspendForm);
    expect([200, 201, 202, 204]).not.toContain(forgedSuspend.status());
    let statusRows = await securitySql`
      SELECT status FROM subscriptions WHERE id = ${subscriptionId}::uuid
    ` as unknown as Array<{ status: string }>;
    expect(statusRows[0]?.status).toBe("active");
    expect(await auditCount("billing.subscription_suspended_by_platform_admin", subscriptionId!)).toBe(0);

    const authorizedSuspend = await replayAdminAction(admin, pagePath, suspendForm);
    const authorizedSuspendBody = await authorizedSuspend.text();
    expect(authorizedSuspend.status(), authorizedSuspendBody).toBe(200);
    statusRows = await securitySql`
      SELECT status FROM subscriptions WHERE id = ${subscriptionId}::uuid
    ` as unknown as Array<{ status: string }>;
    expect(statusRows[0]?.status).toBe("suspended");
    expect(await auditCount("billing.subscription_suspended_by_platform_admin", subscriptionId!)).toBe(1);
  });

  test("membership support actions are authorized and audited", async () => {
    const [membership] = await securityDb.insert(schema.organizationMembers).values({
      organizationId: victim.organizationId,
      userId: attacker.appUserId,
      role: "member",
    }).returning();

    const pagePath = `/admin/organizations/${victim.organizationId}`;
    const rendered = await admin.api.get(pagePath);
    const html = await rendered.text();
    expect(rendered.status(), html).toBe(200);

    const roleForm = extractActionForm(html, "membershipId", membership.id, "Save role");
    roleForm.role = "admin";

    const forgedRoleChange = await replayAdminAction(attacker, pagePath, roleForm);
    expect([200, 201, 202, 204]).not.toContain(forgedRoleChange.status());
    let roleRows = await securitySql`
      SELECT role FROM organization_members WHERE id = ${membership.id}::uuid
    ` as unknown as Array<{ role: string }>;
    expect(roleRows[0]?.role).toBe("member");
    expect(await auditCount("membership.role_changed", membership.id)).toBe(0);

    const authorizedRoleChange = await replayAdminAction(admin, pagePath, roleForm);
    const authorizedRoleChangeBody = await authorizedRoleChange.text();
    expect(authorizedRoleChange.status(), authorizedRoleChangeBody).toBe(200);
    roleRows = await securitySql`
      SELECT role FROM organization_members WHERE id = ${membership.id}::uuid
    ` as unknown as Array<{ role: string }>;
    expect(roleRows[0]?.role).toBe("admin");
    expect(await auditCount("membership.role_changed", membership.id)).toBe(1);

    const rerendered = await admin.api.get(pagePath);
    const removeForm = extractActionForm(await rerendered.text(), "membershipId", membership.id, "Remove membership");

    const forgedRemove = await replayAdminAction(attacker, pagePath, removeForm);
    expect([200, 201, 202, 204]).not.toContain(forgedRemove.status());
    let membershipRows = await securitySql`
      SELECT count(*)::int AS count FROM organization_members WHERE id = ${membership.id}::uuid
    ` as unknown as Array<{ count: number }>;
    expect(membershipRows[0]?.count).toBe(1);

    const authorizedRemove = await replayAdminAction(admin, pagePath, removeForm);
    const authorizedRemoveBody = await authorizedRemove.text();
    expect(authorizedRemove.status(), authorizedRemoveBody).toBe(200);
    membershipRows = await securitySql`
      SELECT count(*)::int AS count FROM organization_members WHERE id = ${membership.id}::uuid
    ` as unknown as Array<{ count: number }>;
    expect(membershipRows[0]?.count).toBe(0);
    expect(await auditCount("membership.removed", membership.id)).toBe(1);
  });

  test("failed queue jobs can only be retried by a platform administrator and are audited", async () => {
    const jobId = `sec-ops-retry-${run}`;
    // The import id is intentionally unknown, so the real worker exhausts the
    // single attempt and leaves a genuinely failed job in the durable failed set.
    const job = await contactImportQueue.add(
      "import-csv",
      { organizationId: victim.organizationId, importId: randomUUID() },
      { jobId, attempts: 1 },
    );
    await expect
      .poll(async () => job.getState(), { timeout: 20_000, message: "the worker should exhaust the single attempt" })
      .toBe("failed");

    const rendered = await admin.api.get("/admin/system");
    const html = await rendered.text();
    expect(rendered.status(), html).toBe(200);
    expect(html).toContain(jobId);

    const form = extractActionForm(html, "jobId", jobId, "Retry failed job");
    expect(form.queueName).toBe("contact-import");

    const forgedRetry = await replayAdminAction(attacker, "/admin/system", form);
    expect([200, 201, 202, 204]).not.toContain(forgedRetry.status());
    expect(await job.getState()).toBe("failed");
    expect(await auditCount("queue.retry_requested", `contact-import:${jobId}`)).toBe(0);

    const authorizedRetry = await replayAdminAction(admin, "/admin/system", form);
    const authorizedRetryBody = await authorizedRetry.text();
    expect(authorizedRetry.status(), authorizedRetryBody).toBe(200);
    expect(await auditCount("queue.retry_requested", `contact-import:${jobId}`)).toBe(1);
  });

  test("webhook inbox visibility, replay guards, and durable retry are authorized and audited", async () => {
    const eventKey = `security-webhook-${run}`;
    const [event] = await securityDb.insert(schema.webhookEvents).values({
      organizationId: victim.organizationId,
      eventKey,
      phoneNumberId,
      payload: { object: "whatsapp_business_account", entry: [] },
      processingStatus: "failed",
      processingAttempts: 2,
      lastProcessingError: `security forced webhook failure ${run}`,
    }).returning();

    const pagePath = `/admin/webhooks?eventId=${event.id}`;
    const rendered = await admin.api.get(pagePath);
    const html = await rendered.text();
    expect(rendered.status(), html).toBe(200);
    expect(html).toContain(eventKey);
    expect(html).toContain(`security forced webhook failure ${run}`);

    const form = extractActionForm(html, "eventId", event.id, "Retry event safely");

    const forgedRetry = await replayAdminAction(attacker, pagePath, form);
    expect([200, 201, 202, 204]).not.toContain(forgedRetry.status());
    const forgedRows = await securitySql`
      SELECT processing_status AS "processingStatus" FROM webhook_events WHERE id = ${event.id}::uuid
    ` as unknown as Array<{ processingStatus: string }>;
    expect(forgedRows[0]?.processingStatus).toBe("failed");
    expect(await auditCount("webhook.retry_requested", event.id)).toBe(0);

    const [processedEvent] = await securityDb.insert(schema.webhookEvents).values({
      organizationId: victim.organizationId,
      eventKey: `${eventKey}-processed`,
      phoneNumberId,
      payload: { object: "whatsapp_business_account", entry: [] },
      processingStatus: "processed",
      processingAttempts: 1,
      processedAt: new Date(),
    }).returning();

    const guardedReplay = await replayAdminAction(admin, pagePath, { ...form, eventId: processedEvent.id });
    expect([200, 201, 202, 204]).not.toContain(guardedReplay.status());
    expect(await auditCount("webhook.retry_requested", processedEvent.id)).toBe(0);

    const authorizedRetry = await replayAdminAction(admin, pagePath, form);
    const authorizedRetryBody = await authorizedRetry.text();
    expect(authorizedRetry.status(), authorizedRetryBody).toBe(200);
    // The guarded retry transaction flips the durable inbox row to "retry" and
    // re-enqueues it; the audit row is written in the same transaction. The
    // worker then claims and processes the durable row, which is the end-to-end
    // proof that an administrator-initiated safe retry actually recovers work.
    await expect
      .poll(async () => {
        const rows = await securitySql`
          SELECT processing_status AS "processingStatus" FROM webhook_events WHERE id = ${event.id}::uuid
        ` as unknown as Array<{ processingStatus: string }>;
        return rows[0]?.processingStatus ?? "missing";
      }, { timeout: 20_000, message: "the replayed webhook event should be processed by the worker" })
      .toBe("processed");
    expect(await auditCount("webhook.retry_requested", event.id)).toBe(1);
  });

  test("audit export is administrator-only, filtered, and itself audited", async () => {
    const denied = await attacker.api.get("/admin/audit/export", { maxRedirects: 0 });
    expect(isRedirect(denied.status())).toBe(true);
    expect(denied.headers()["content-type"] ?? "").not.toContain("text/csv");

    const exported = await admin.api.get("/admin/audit/export?action=queue.retry_requested");
    const csv = await exported.text();
    expect(exported.status(), csv).toBe(200);
    expect(exported.headers()["content-type"] ?? "").toContain("text/csv");
    expect(exported.headers()["content-disposition"] ?? "").toContain("attachment");

    const lines = csv.trim().split("\n");
    expect(lines[0]).toBe('"id","action","actor_email","organization","target_type","target_id","metadata","created_at"');
    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines.slice(1)) {
      expect(line).toContain('"queue.retry_requested"');
    }

    const exportAudit = await securitySql`
      SELECT metadata
      FROM platform_audit_events
      WHERE action = 'audit.exported'
      ORDER BY created_at DESC
      LIMIT 1
    ` as unknown as Array<{ metadata: { action?: string } }>;
    expect(exportAudit[0]?.metadata?.action).toBe("queue.retry_requested");
  });

  test("operational lists paginate, filter, and search across platform scope", async () => {
    const prefix = `sec-pagination-${run}`;
    const base = Date.now() - 60 * 60 * 1_000;
    await securityDb.insert(schema.webhookEvents).values(
      Array.from({ length: 51 }, (_, index) => ({
        organizationId: victim.organizationId,
        eventKey: `${prefix}-${index}`,
        phoneNumberId,
        payload: { object: "whatsapp_business_account", entry: [] },
        processingStatus: "pending",
        createdAt: new Date(base + index * 60_000),
      })),
    );

    const firstPage = await admin.api.get(`/admin/webhooks?q=${encodeURIComponent(prefix)}`);
    const firstHtml = await firstPage.text();
    expect(firstPage.status(), firstHtml).toBe(200);
    expect(renderedText(firstHtml)).toContain("Page 1 of 2");
    expect(firstHtml).toContain(`${prefix}-50`);
    expect(firstHtml).not.toContain(`${prefix}-0`);

    const secondPage = await admin.api.get(`/admin/webhooks?q=${encodeURIComponent(prefix)}&page=2`);
    const secondHtml = await secondPage.text();
    expect(secondPage.status(), secondHtml).toBe(200);
    expect(renderedText(secondHtml)).toContain("Page 2 of 2");
    expect(secondHtml).toContain(`${prefix}-0`);

    await securityDb.insert(schema.webhookEvents).values({
      organizationId: victim.organizationId,
      eventKey: `${prefix}-dead`,
      phoneNumberId,
      payload: { object: "whatsapp_business_account", entry: [] },
      processingStatus: "dead_letter",
      deadLetteredAt: new Date(),
      createdAt: new Date(base + 100 * 60_000),
    });

    const deadLetterFilter = await admin.api.get(`/admin/webhooks?q=${encodeURIComponent(prefix)}&status=dead_letter`);
    const deadLetterHtml = await deadLetterFilter.text();
    expect(deadLetterFilter.status(), deadLetterHtml).toBe(200);
    expect(deadLetterHtml).toContain(`${prefix}-dead`);
    expect(renderedText(deadLetterHtml)).toContain("Page 1 of 1");

    const processedFilter = await admin.api.get(`/admin/webhooks?q=${encodeURIComponent(prefix)}&status=processed`);
    const processedHtml = await processedFilter.text();
    expect(processedFilter.status(), processedHtml).toBe(200);
    expect(processedHtml).not.toContain(`${prefix}-dead`);

    const userSearch = await admin.api.get(`/admin/users?q=${encodeURIComponent(victim.email)}`);
    const userHtml = await userSearch.text();
    expect(userSearch.status(), userHtml).toBe(200);
    expect(userHtml).toContain(victim.email);
    expect(renderedText(userHtml)).toContain("Page 1 of");

    const organizationSearch = await admin.api.get(`/admin/organizations?q=${encodeURIComponent(victimOrganizationSlug)}`);
    const organizationHtml = await organizationSearch.text();
    expect(organizationSearch.status(), organizationHtml).toBe(200);
    expect(organizationHtml).toContain(victimOrganizationSlug);

    const userMiss = await admin.api.get(`/admin/users?q=${encodeURIComponent(`nobody-${run}@example.test`)}`);
    const userMissHtml = await userMiss.text();
    expect(userMiss.status(), userMissHtml).toBe(200);
    expect(userMissHtml).not.toContain(victim.email);
  });
});
