import { eq } from "drizzle-orm";
import { schema } from "@wa/db";
import { getAuthContext } from "@/lib/auth-context";
import { db } from "@/lib/server";
import { can } from "@/lib/workspace-access";

export async function GET() {
  const context = await getAuthContext();
  if (!context) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { workspace } = context;
  if (!can(workspace.role, "data.export")) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const organizationId = workspace.organizationId;
  const [
    organization,
    preferences,
    members,
    invitations,
    phoneNumbers,
    contacts,
    lists,
    listMembers,
    segments,
    templates,
    campaigns,
    campaignAudiences,
    suppressions,
    consentEvents,
    auditEvents,
  ] = await Promise.all([
    db.select().from(schema.organizations).where(eq(schema.organizations.id, organizationId)).limit(1).then((rows) => rows[0] ?? null),
    db.select().from(schema.workspacePreferences).where(eq(schema.workspacePreferences.organizationId, organizationId)).limit(1).then((rows) => rows[0] ?? null),
    db
      .select({
        id: schema.organizationMembers.id,
        userId: schema.users.id,
        email: schema.users.email,
        displayName: schema.users.displayName,
        role: schema.organizationMembers.role,
        joinedAt: schema.organizationMembers.createdAt,
      })
      .from(schema.organizationMembers)
      .innerJoin(schema.users, eq(schema.users.id, schema.organizationMembers.userId))
      .where(eq(schema.organizationMembers.organizationId, organizationId)),
    db
      .select({
        id: schema.organizationInvitations.id,
        email: schema.organizationInvitations.email,
        role: schema.organizationInvitations.role,
        expiresAt: schema.organizationInvitations.expiresAt,
        acceptedAt: schema.organizationInvitations.acceptedAt,
        createdAt: schema.organizationInvitations.createdAt,
      })
      .from(schema.organizationInvitations)
      .where(eq(schema.organizationInvitations.organizationId, organizationId)),
    db
      .select({
        id: schema.whatsappPhoneNumbers.id,
        wabaId: schema.whatsappPhoneNumbers.wabaId,
        phoneNumberId: schema.whatsappPhoneNumbers.phoneNumberId,
        displayPhoneNumber: schema.whatsappPhoneNumbers.displayPhoneNumber,
        verifiedName: schema.whatsappPhoneNumbers.verifiedName,
        status: schema.whatsappPhoneNumbers.status,
        qualityRating: schema.whatsappPhoneNumbers.qualityRating,
        throughputMps: schema.whatsappPhoneNumbers.throughputMps,
        createdAt: schema.whatsappPhoneNumbers.createdAt,
        updatedAt: schema.whatsappPhoneNumbers.updatedAt,
      })
      .from(schema.whatsappPhoneNumbers)
      .where(eq(schema.whatsappPhoneNumbers.organizationId, organizationId)),
    db.select().from(schema.contacts).where(eq(schema.contacts.organizationId, organizationId)),
    db.select().from(schema.contactLists).where(eq(schema.contactLists.organizationId, organizationId)),
    db.select().from(schema.contactListMembers).where(eq(schema.contactListMembers.organizationId, organizationId)),
    db.select().from(schema.audienceSegments).where(eq(schema.audienceSegments.organizationId, organizationId)),
    db.select().from(schema.templates).where(eq(schema.templates.organizationId, organizationId)),
    db.select().from(schema.campaigns).where(eq(schema.campaigns.organizationId, organizationId)),
    db.select().from(schema.campaignAudiences).where(eq(schema.campaignAudiences.organizationId, organizationId)),
    db.select().from(schema.suppressionList).where(eq(schema.suppressionList.organizationId, organizationId)),
    db.select().from(schema.contactConsentEvents).where(eq(schema.contactConsentEvents.organizationId, organizationId)),
    db.select().from(schema.workspaceAuditLogs).where(eq(schema.workspaceAuditLogs.organizationId, organizationId)),
  ]);

  const exportedAt = new Date().toISOString();
  const body = JSON.stringify({
    formatVersion: 1,
    exportedAt,
    organization,
    preferences,
    members,
    invitations,
    whatsappPhoneNumbers: phoneNumbers,
    contacts,
    contactLists: lists,
    contactListMembers: listMembers,
    audienceSegments: segments,
    templates,
    campaigns,
    campaignAudiences,
    suppressions,
    consentEvents,
    workspaceAuditEvents: auditEvents,
    exclusions: [
      "credential_secrets and encryption material",
      "raw webhook payloads",
      "high-volume campaign recipient delivery telemetry",
      "stored import objects and presigned credentials",
    ],
  }, null, 2);

  const safeSlug = workspace.organizationSlug.replace(/[^a-z0-9-]+/gi, "-").replace(/^-+|-+$/g, "") || "workspace";
  const date = exportedAt.slice(0, 10);

  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="${safeSlug}-${date}.json"`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
