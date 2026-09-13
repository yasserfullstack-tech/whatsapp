import { desc, eq } from "drizzle-orm";
import { schema } from "@wa/db";
import { AdminBadge, AdminSection } from "@/components/admin-ui";
import { db } from "@/lib/server";

export default async function AdminConnectionsPage() {
  const connections = await db.select({
    id: schema.whatsappPhoneNumbers.id, organizationName: schema.organizations.name, wabaId: schema.whatsappPhoneNumbers.wabaId,
    phoneNumberId: schema.whatsappPhoneNumbers.phoneNumberId, number: schema.whatsappPhoneNumbers.displayPhoneNumber,
    name: schema.whatsappPhoneNumbers.verifiedName, status: schema.whatsappPhoneNumbers.status, quality: schema.whatsappPhoneNumbers.qualityRating,
    throughput: schema.whatsappPhoneNumbers.throughputMps, updatedAt: schema.whatsappPhoneNumbers.updatedAt,
  }).from(schema.whatsappPhoneNumbers).innerJoin(schema.organizations, eq(schema.organizations.id, schema.whatsappPhoneNumbers.organizationId)).orderBy(desc(schema.whatsappPhoneNumbers.updatedAt));

  return <>
    <header className="admin-header"><div><h1>Connections</h1><p>Connected WABAs and WhatsApp phone-number assets across organizations.</p></div></header>
    <AdminSection title={`${new Set(connections.map((item) => item.wabaId)).size} WABAs · ${connections.length} numbers`}>
      <table className="admin-table"><thead><tr><th>Organization</th><th>Number</th><th>WABA</th><th>Phone number ID</th><th>Status</th><th>Quality</th><th>Configured MPS</th></tr></thead><tbody>{connections.map((connection) => <tr key={connection.id}><td>{connection.organizationName}</td><td>{connection.name ?? "—"}<br /><small>{connection.number ?? "—"}</small></td><td>{connection.wabaId}</td><td>{connection.phoneNumberId}</td><td><AdminBadge tone={connection.status === "connected" ? "good" : connection.status === "restricted" ? "bad" : "warn"}>{connection.status}</AdminBadge></td><td>{connection.quality ?? "—"}</td><td>{connection.throughput}</td></tr>)}</tbody></table>
    </AdminSection>
  </>;
}
