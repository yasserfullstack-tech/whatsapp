const stats = [
  { label: "Contacts", value: "0", detail: "Import your first audience" },
  { label: "Campaigns", value: "0", detail: "No campaigns sent yet" },
  { label: "Delivered", value: "—", detail: "Delivery analytics will appear here" },
  { label: "Read rate", value: "—", detail: "Calculated from Meta webhooks" },
];

const nav = ["Overview", "Contacts", "Templates", "Campaigns", "Reports", "Settings"];

export default function Home() {
  return (
    <main className="shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brandMark">W</div>
          <div>
            <strong>WhatsApp</strong>
            <span>Campaigns</span>
          </div>
        </div>

        <nav className="nav" aria-label="Primary navigation">
          {nav.map((item, index) => (
            <button className={index === 0 ? "navItem active" : "navItem"} key={item} type="button">
              <span className="navDot" aria-hidden="true" />
              {item}
            </button>
          ))}
        </nav>

        <div className="workspace">
          <div className="workspaceAvatar">AC</div>
          <div>
            <strong>Acme Commerce</strong>
            <span>Workspace</span>
          </div>
        </div>
      </aside>

      <section className="content">
        <header className="topbar">
          <div>
            <p className="eyebrow">Overview</p>
            <h1>Good morning</h1>
            <p className="subtitle">Connect WhatsApp, import customers, and launch your first campaign.</p>
          </div>
          <button className="primary" type="button">Create campaign</button>
        </header>

        <section className="connectionCard">
          <div className="connectionIcon">W</div>
          <div className="connectionCopy">
            <div className="rowTitle">
              <h2>Connect WhatsApp Business</h2>
              <span className="status">Not connected</span>
            </div>
            <p>
              Connect your business number through Meta. Your account stays under your ownership; the platform only receives permission to manage messaging.
            </p>
          </div>
          <button className="secondary" type="button">Connect WhatsApp</button>
        </section>

        <section className="statsGrid" aria-label="Campaign statistics">
          {stats.map((stat) => (
            <article className="statCard" key={stat.label}>
              <span>{stat.label}</span>
              <strong>{stat.value}</strong>
              <p>{stat.detail}</p>
            </article>
          ))}
        </section>

        <section className="mainGrid">
          <article className="panel campaignsPanel">
            <div className="panelHeader">
              <div>
                <p className="eyebrow">Campaigns</p>
                <h2>Recent activity</h2>
              </div>
              <button className="textButton" type="button">View all</button>
            </div>
            <div className="emptyState">
              <div className="emptyIcon">↗</div>
              <h3>No campaigns yet</h3>
              <p>Once you send a campaign, delivery and read performance will show up here.</p>
              <button className="secondary" type="button">Create your first campaign</button>
            </div>
          </article>

          <aside className="panel readinessPanel">
            <p className="eyebrow">Launch checklist</p>
            <h2>Get ready to send</h2>
            <ol className="checklist">
              <li><span>1</span><div><strong>Connect WhatsApp</strong><p>Use Meta Embedded Signup.</p></div></li>
              <li><span>2</span><div><strong>Import contacts</strong><p>Only opted-in WhatsApp recipients.</p></div></li>
              <li><span>3</span><div><strong>Sync a template</strong><p>Use an approved marketing template.</p></div></li>
              <li><span>4</span><div><strong>Launch safely</strong><p>Queue workers respect each number&apos;s throughput.</p></div></li>
            </ol>
          </aside>
        </section>
      </section>
    </main>
  );
}
