import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { schema } from "@wa/db";
import { SignOutButton } from "@/components/sign-out-button";
import { TemplateManager } from "@/components/template-manager";
import { requireAuthContext } from "@/lib/auth-context";
import { listConnectedWabas } from "@/lib/meta-credentials";
import { db } from "@/lib/server";

export const dynamic = "force-dynamic";

const nav = [
  { label: "Overview", href: "/dashboard" },
  { label: "Contacts", href: "/dashboard#contacts" },
  { label: "Templates", href: "/templates" },
  { label: "Campaigns", href: "/dashboard" },
  { label: "Reports", href: "/dashboard" },
  { label: "Settings", href: "/dashboard" },
];

export default async function TemplatesPage() {
  const { session, workspace } = await requireAuthContext();
  const [templates, wabas] = await Promise.all([
    db.select().from(schema.templates)
      .where(eq(schema.templates.organizationId, workspace.organizationId))
      .orderBy(desc(schema.templates.updatedAt)),
    listConnectedWabas(workspace.organizationId),
  ]);

  const initials = workspace.organizationName.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
  const approved = templates.filter((template) => template.status === "approved").length;
  const pending = templates.filter((template) => template.status === "pending").length;
  const rejected = templates.filter((template) => template.status === "rejected").length;

  return (
    <main className="shell">
      <aside className="sidebar">
        <div className="brand"><div className="brandMark">W</div><div><strong>WhatsApp</strong><span>Campaigns</span></div></div>
        <nav className="nav" aria-label="Primary navigation">
          {nav.map((item) => (
            <Link className={item.label === "Templates" ? "navItem active" : "navItem"} href={item.href} key={item.label}>
              <span className="navDot" aria-hidden="true" />{item.label}
            </Link>
          ))}
        </nav>
        <div className="workspace">
          <div className="workspaceAvatar">{initials || "W"}</div>
          <div className="workspaceMeta"><strong>{workspace.organizationName}</strong><span>{session.user.email}</span></div>
          <SignOutButton />
        </div>
      </aside>

      <section className="content">
        <header className="topbar">
          <div><p className="eyebrow">Templates</p><h1>Message templates</h1><p className="subtitle">Sync WABA templates from Meta or submit a new template for approval.</p></div>
        </header>

        <section className="statsGrid" aria-label="Template statistics">
          <article className="statCard"><span>Total</span><strong>{templates.length.toLocaleString()}</strong><p>Across connected WABAs</p></article>
          <article className="statCard"><span>Approved</span><strong>{approved.toLocaleString()}</strong><p>Ready for campaigns</p></article>
          <article className="statCard"><span>Pending</span><strong>{pending.toLocaleString()}</strong><p>Waiting for Meta review</p></article>
          <article className="statCard"><span>Rejected</span><strong>{rejected.toLocaleString()}</strong><p>Needs revision before use</p></article>
        </section>

        <section className="panel" style={{ marginTop: 18 }}>
          <TemplateManager wabas={wabas.map(({ wabaId, label }) => ({ wabaId, label }))} />
        </section>

        <section className="panel" style={{ marginTop: 18 }}>
          <div className="panelHeader"><div><p className="eyebrow">Library</p><h2>Synced templates</h2></div></div>
          {templates.length ? (
            <div className="numberList" style={{ marginTop: 14 }}>
              {templates.map((template) => (
                <div className="numberRow" key={template.id} style={{ alignItems: "start" }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                      <strong>{template.name}</strong>
                      <span style={{ color: "var(--muted)", fontSize: 12 }}>{template.language}</span>
                      <span style={{ color: "var(--muted)", fontSize: 12 }}>{template.category}</span>
                    </div>
                    <p style={{ margin: "7px 0 0", whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{template.bodyPreview ?? "No text body preview"}</p>
                    {template.rejectionReason ? <p style={{ margin: "7px 0 0", color: "#a23a2a", fontSize: 12 }}>Meta: {template.rejectionReason}</p> : null}
                  </div>
                  <div className="numberMeta">
                    <span className={template.status === "approved" ? "status connected" : "status"}>{template.status}</span>
                    <span>WABA {template.wabaId}</span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="emptyState" style={{ marginTop: 14 }}><div className="emptyIcon">T</div><h3>No templates synced</h3><p>Connect a WABA and use “Sync from Meta,” or submit the first template above.</p></div>
          )}
        </section>
      </section>
    </main>
  );
}
