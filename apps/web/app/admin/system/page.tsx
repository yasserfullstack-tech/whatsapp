import { AdminBadge, AdminMetric, AdminSection } from "@/components/admin-ui";
import { campaignDispatchQueue, contactImportQueue, sendQueue, webhookQueue } from "@/lib/server";

export default async function AdminSystemPage() {
  const queues = [
    ["Message send", sendQueue],
    ["Campaign dispatch", campaignDispatchQueue],
    ["Contact import", contactImportQueue],
    ["Webhook", webhookQueue],
  ] as const;
  const states = await Promise.all(queues.map(async ([name, queue]) => ({
    name,
    waiting: await queue.getWaitingCount(),
    active: await queue.getActiveCount(),
    delayed: await queue.getDelayedCount(),
    failed: await queue.getFailedCount(),
    failedJobs: await queue.getFailed(0, 9),
  })));
  const queueDepth = states.reduce((sum, state) => sum + state.waiting + state.delayed, 0);
  const active = states.reduce((sum, state) => sum + state.active, 0);
  const failed = states.reduce((sum, state) => sum + state.failed, 0);
  const webhookState = states.find((state) => state.name === "Webhook");
  const webhookBacklog = (webhookState?.waiting ?? 0) + (webhookState?.delayed ?? 0);

  return <>
    <header className="admin-header"><div><h1>System</h1><p>Operational queue health and failed job inspection.</p></div></header>
    <div className="admin-grid"><AdminMetric label="Queue depth" value={queueDepth.toLocaleString()} /><AdminMetric label="Active jobs" value={active.toLocaleString()} /><AdminMetric label="Failed jobs" value={failed.toLocaleString()} /><AdminMetric label="Webhook backlog" value={webhookBacklog.toLocaleString()} /></div>
    <AdminSection title="Queue health"><table className="admin-table"><thead><tr><th>Queue</th><th>Waiting</th><th>Active</th><th>Delayed</th><th>Failed</th><th>Health</th></tr></thead><tbody>{states.map((state) => <tr key={state.name}><td>{state.name}</td><td>{state.waiting}</td><td>{state.active}</td><td>{state.delayed}</td><td>{state.failed}</td><td><AdminBadge tone={state.failed ? "bad" : state.waiting > 10000 ? "warn" : "good"}>{state.failed ? "attention" : "healthy"}</AdminBadge></td></tr>)}</tbody></table></AdminSection>
    {states.map((state) => state.failedJobs.length ? <AdminSection key={state.name} title={`${state.name}: recent failed jobs`}><table className="admin-table"><thead><tr><th>Job</th><th>Failure</th><th>Attempts</th><th>Timestamp</th></tr></thead><tbody>{state.failedJobs.map((job) => <tr key={job.id}><td>{job.name}<br /><small>{job.id}</small></td><td className="admin-error">{job.failedReason ?? "Unknown failure"}</td><td>{job.attemptsMade}</td><td>{job.timestamp ? new Date(job.timestamp).toLocaleString() : "—"}</td></tr>)}</tbody></table></AdminSection> : null)}
  </>;
}
