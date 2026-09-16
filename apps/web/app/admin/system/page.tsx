import Link from "next/link";
import { AdminBadge, AdminMetric, AdminSection } from "@/components/admin-ui";
import { retryQueueJobAction } from "@/lib/system-admin-actions";
import { campaignDispatchQueue, contactImportQueue, sendQueue, webhookQueue } from "@/lib/server";

export default async function AdminSystemPage() {
  const queues = [
    ["send", "Message send", sendQueue, true],
    ["campaign-dispatch", "Campaign dispatch", campaignDispatchQueue, true],
    ["contact-import", "Contact import", contactImportQueue, true],
    ["webhook", "Webhook", webhookQueue, false],
  ] as const;
  const states = await Promise.all(queues.map(async ([key, name, queue, retryable]) => ({
    key,
    name,
    retryable,
    waiting: await queue.getWaitingCount(),
    active: await queue.getActiveCount(),
    delayed: await queue.getDelayedCount(),
    failed: await queue.getFailedCount(),
    failedJobs: await queue.getFailed(0, 19),
  })));
  const queueDepth = states.reduce((sum, state) => sum + state.waiting + state.delayed, 0);
  const active = states.reduce((sum, state) => sum + state.active, 0);
  const failed = states.reduce((sum, state) => sum + state.failed, 0);
  const webhookState = states.find((state) => state.key === "webhook");
  const webhookBacklog = (webhookState?.waiting ?? 0) + (webhookState?.delayed ?? 0);

  return <>
    <header className="admin-header"><div><h1>System</h1><p>Operational queue health, failed-job inspection, and guarded retries.</p></div></header>
    <div className="admin-grid"><AdminMetric label="Queue depth" value={queueDepth.toLocaleString()} /><AdminMetric label="Active jobs" value={active.toLocaleString()} /><AdminMetric label="Failed jobs" value={failed.toLocaleString()} /><AdminMetric label="Webhook backlog" value={webhookBacklog.toLocaleString()} /></div>
    <AdminSection title="Queue health"><table className="admin-table"><thead><tr><th>Queue</th><th>Waiting</th><th>Active</th><th>Delayed</th><th>Failed</th><th>Health</th></tr></thead><tbody>{states.map((state) => <tr key={state.name}><td>{state.name}</td><td>{state.waiting}</td><td>{state.active}</td><td>{state.delayed}</td><td>{state.failed}</td><td><AdminBadge tone={state.failed ? "bad" : state.waiting > 10000 ? "warn" : "good"}>{state.failed ? "attention" : "healthy"}</AdminBadge></td></tr>)}</tbody></table></AdminSection>
    {states.map((state) => state.failedJobs.length ? <AdminSection key={state.name} title={`${state.name}: recent failed jobs`}><table className="admin-table"><thead><tr><th>Job</th><th>Failure</th><th>Attempts</th><th>Timestamp</th><th>Action</th></tr></thead><tbody>{state.failedJobs.map((job) => <tr key={job.id}><td>{job.name}<br /><small>{job.id}</small></td><td className="admin-error">{job.failedReason ?? "Unknown failure"}</td><td>{job.attemptsMade}</td><td>{job.timestamp ? new Date(job.timestamp).toLocaleString() : "—"}</td><td>{state.retryable && job.id ? <form action={retryQueueJobAction}><input type="hidden" name="queueName" value={state.key} /><input type="hidden" name="jobId" value={job.id} /><button className="admin-button admin-button-secondary" type="submit">Retry failed job</button></form> : <Link href="/admin/webhooks">Use durable webhook retry</Link>}</td></tr>)}</tbody></table></AdminSection> : null)}
  </>;
}
