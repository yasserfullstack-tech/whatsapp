import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { schema } from "@wa/db";
import { AdminBadge, AdminSection } from "@/components/admin-ui";
import { db } from "@/lib/server";

type PageProps = { searchParams: Promise<{ importId?: string }> };

export default async function AdminImportsPage({ searchParams }: PageProps) {
  const { importId } = await searchParams;
  const imports = await db.select({
    id: schema.contactImports.id, organizationName: schema.organizations.name, file: schema.contactImports.originalFileName,
    status: schema.contactImports.status, totalRows: schema.contactImports.totalRows, processedRows: schema.contactImports.processedRows,
    importedRows: schema.contactImports.importedRows, invalidRows: schema.contactImports.invalidRows, duplicateRows: schema.contactImports.duplicateRows,
    error: schema.contactImports.errorMessage, createdAt: schema.contactImports.createdAt, startedAt: schema.contactImports.startedAt, completedAt: schema.contactImports.completedAt,
  }).from(schema.contactImports).innerJoin(schema.organizations, eq(schema.organizations.id, schema.contactImports.organizationId)).orderBy(desc(schema.contactImports.createdAt)).limit(150);
  const selected = imports.find((item) => item.id === importId);

  return <>
    <header className="admin-header"><div><h1>Imports</h1><p>Inspect failed and in-flight contact import jobs.</p></div></header>
    {selected ? <AdminSection title={`Inspect: ${selected.file}`} action={<Link href="/admin/imports">Close inspection</Link>}><div className="admin-kv"><div><span>Organization</span><strong>{selected.organizationName}</strong></div><div><span>Status</span><strong>{selected.status}</strong></div><div><span>Rows</span><strong>{selected.processedRows.toLocaleString()} / {selected.totalRows.toLocaleString()}</strong></div><div><span>Imported</span><strong>{selected.importedRows.toLocaleString()}</strong></div><div><span>Invalid</span><strong>{selected.invalidRows.toLocaleString()}</strong></div><div><span>Duplicates</span><strong>{selected.duplicateRows.toLocaleString()}</strong></div></div>{selected.error ? <p className="admin-error"><strong>Error:</strong> {selected.error}</p> : null}</AdminSection> : null}
    <AdminSection title="Recent imports"><table className="admin-table"><thead><tr><th>File</th><th>Organization</th><th>Status</th><th>Progress</th><th>Imported</th><th>Error</th><th></th></tr></thead><tbody>{imports.map((item) => <tr key={item.id}><td>{item.file}</td><td>{item.organizationName}</td><td><AdminBadge tone={item.status === "failed" ? "bad" : item.status === "completed" ? "good" : "warn"}>{item.status}</AdminBadge></td><td>{item.processedRows.toLocaleString()} / {item.totalRows.toLocaleString()}</td><td>{item.importedRows.toLocaleString()}</td><td className="admin-error">{item.error ?? "—"}</td><td><Link href={`/admin/imports?importId=${item.id}`}>Inspect</Link></td></tr>)}</tbody></table></AdminSection>
  </>;
}
