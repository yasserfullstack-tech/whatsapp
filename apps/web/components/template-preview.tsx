function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function TemplatePreview({ components }: { components: unknown }) {
  const list = Array.isArray(components) ? components.filter(isRecord) : [];
  const header = list.find((component) => String(component.type ?? "").toUpperCase() === "HEADER");
  const body = list.find((component) => String(component.type ?? "").toUpperCase() === "BODY");
  const footer = list.find((component) => String(component.type ?? "").toUpperCase() === "FOOTER");
  const buttons = list.find((component) => String(component.type ?? "").toUpperCase() === "BUTTONS");
  const headerFormat = header && typeof header.format === "string" ? header.format.toUpperCase() : null;
  const buttonRows = buttons && Array.isArray(buttons.buttons) ? buttons.buttons.filter(isRecord) : [];

  return <div className="panelInset" style={{ display: "grid", gap: 10 }}>
    {header ? headerFormat === "TEXT"
      ? <strong style={{ whiteSpace: "pre-wrap" }}>{typeof header.text === "string" ? header.text : "Header"}</strong>
      : <div style={{ border: "1px dashed var(--line)", borderRadius: 10, padding: 16, textAlign: "center" }}>
          <strong>{headerFormat ?? "Media"} header</strong>
          <p className="subtitle" style={{ margin: "4px 0 0" }}>Media URL is mapped when the campaign is launched.</p>
        </div>
      : null}
    <p style={{ whiteSpace: "pre-wrap", margin: 0 }}>{body && typeof body.text === "string" ? body.text : "No body preview"}</p>
    {footer && typeof footer.text === "string" ? <small className="subtitle">{footer.text}</small> : null}
    {buttonRows.length ? <div style={{ display: "grid", gap: 6, borderTop: "1px solid var(--line)", paddingTop: 8 }}>
      {buttonRows.map((button, index) => <div key={index} style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
        <span>{typeof button.text === "string" ? button.text : `Button ${index + 1}`}</span>
        <code>{String(button.type ?? "BUTTON")}</code>
      </div>)}
    </div> : null}
  </div>;
}
