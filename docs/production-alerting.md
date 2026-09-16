# Production alerting

This document is the source of truth for PR-011 production alerting. Prometheus evaluates the version-controlled rules in `infra/production/alerts/whatsapp.rules.yml`; Alertmanager routes firing and resolved alerts using `infra/production/alertmanager.yml`.

## Severity policy

| Severity | Meaning | Expected response |
| --- | --- | --- |
| `critical` | Customer traffic, durable processing, data protection, or a required dependency is unavailable or at immediate risk. | A human should be paged/notified immediately, acknowledge the alert, and start the linked runbook. |
| `warning` | Degradation, growing backlog, reduced observability, or an approaching capacity/certificate threshold. | A human should investigate during the active support window before it becomes customer-impacting. |

Alertmanager repeats critical alerts every 30 minutes and warnings every four hours unless resolved. The configured webhook **must terminate in a human-operated destination** such as an on-call system or an operations chat channel with an active responder. A logging-only webhook does not satisfy the production-readiness requirement.

## Initial SLIs and SLOs

These are initial launch objectives. Revisit thresholds after production baselines are available; do not silently relax an objective only to suppress alerts.

| SLI | Initial objective | Primary signal |
| --- | --- | --- |
| Public service availability | >= 99.9% successful HTTPS probes over 30 days | `probe_success{job="public-https"}` |
| API and worker readiness | >= 99.9% successful readiness probes over 30 days | `probe_success{job="whatsapp-readiness"}` |
| Webhook processing lag | p95 <= 30 seconds over rolling 10-minute windows | `whatsapp_webhook_processing_lag_seconds` |
| Campaign send execution | < 5% BullMQ send-job failures when at least 20 jobs run in 10 minutes | `whatsapp_failed_jobs_total`, `whatsapp_jobs_completed_total` |
| Meta API health | no sustained auth failures; <= 5 rate-limit or 5xx errors in alert windows | `whatsapp_meta_errors_total`, `whatsapp_meta_429_total` |
| Backup RPO | a restore-verified, off-server PostgreSQL backup completes at least every 24 hours | `whatsapp_backup_last_success_timestamp_seconds` |
| Email delivery | no dead letters; retry backlog stays below 25 | `whatsapp_email_delivery_backlog` |
| R2 availability | configured bucket probe remains successful | `whatsapp_r2_up` |

## Production activation

1. Create the node-exporter textfile directory used by the backup job:

   ```bash
   sudo install -d -m 0755 /var/lib/whatsapp/node-exporter
   ```

2. Render the public HTTPS probe target from the production environment file:

   ```bash
   sh infra/production/scripts/render-monitoring-config.sh .env.production
   ```

3. Create the Alertmanager webhook secret file. The file must contain exactly one HTTPS webhook URL for the human-operated operations destination or its on-call relay:

   ```bash
   install -d -m 0700 .runtime/monitoring
   printf '%s\n' 'https://REDACTED-HUMAN-OPS-WEBHOOK' > .runtime/monitoring/alertmanager-webhook-url
   chmod 0600 .runtime/monitoring/alertmanager-webhook-url
   ```

   To keep the secret elsewhere, set `ALERTMANAGER_WEBHOOK_URL_FILE` to the host path before running Compose. Never commit the populated file or paste the URL into an issue/PR.

4. Start the monitoring services with the production stack and verify their targets in Prometheus:

   ```bash
   docker compose --env-file .env.production -f docker-compose.production.yml up -d \
     alertmanager blackbox-exporter postgres-exporter valkey-exporter node-exporter prometheus grafana
   ```

5. Confirm `whatsapp-api`, every expected `whatsapp-worker` target, `postgres-exporter`, `valkey-exporter`, `node-exporter`, `whatsapp-readiness`, and `public-https` are healthy. Confirm Alertmanager shows the `ops-webhook` receiver.

The public target file contains only the public hostname, not credentials. The Alertmanager URL is mounted as a Docker secret and is not stored in Prometheus labels or application logs.

## Test alert delivery

After the human-operated webhook is configured, run:

```bash
sh infra/production/scripts/test-alert-delivery.sh
```

The script POSTs a synthetic `WhatsAppPr011DeliveryTest` critical alert to the locally bound Alertmanager API and prints a unique `test_id`. Verify that the destination receives the alert and then retain **redacted** evidence containing the same `test_id` (for example, a screenshot or destination event ID). Do not include webhook URLs, tokens, customer data, phone numbers, or message contents in evidence.

A successful HTTP POST to Alertmanager proves only ingestion. PR-011 is externally evidenced only after the same test alert is visibly delivered to the configured human destination.

## Signal ownership

- API/worker availability and application metrics come from `/metrics`.
- `/ready` is probed through blackbox-exporter and therefore exercises PostgreSQL and Valkey connectivity from the application path.
- Dedicated PostgreSQL and Valkey exporters provide dependency-level `pg_up` and `redis_up` signals.
- node-exporter supplies host filesystem metrics and reads backup timestamps written by `backup-postgres.sh`.
- blackbox-exporter supplies public HTTPS availability and certificate-expiry metrics.
- The worker's operational probe checks that the configured R2 bucket can be listed and counts actionable email `failed`/`dead_letter` delivery rows.
- Every structured logger `error` increments `whatsapp_application_errors_total`. When `SENTRY_DSN` is configured, those same events are handed to Sentry; `whatsapp_sentry_capture_attempts_total` records SDK handoff outcomes.

## WhatsAppApiDown

Check `docker compose ps api`, API logs, and the `whatsapp-api` Prometheus target. If the process is healthy but unsrcrapeable, verify the `backend` network and port 4000. If readiness is also failing, follow `WhatsAppReadinessFailed` before restarting repeatedly.

## WhatsAppWorkerFleetDown

Check the expected worker replica count, worker logs, port 9464, and DNS discovery for `worker`. Preserve failed-job state in Valkey; do not delete failed queues as a recovery shortcut.

## WhatsAppReadinessFailed

Query `/ready` from the affected container and inspect its `checks` object plus `readiness_check_failed` logs. If `database` fails, follow `WhatsAppPostgresDown`; if `redis` fails, follow `WhatsAppValkeyDown`. A restart is not a substitute for restoring the failed dependency.

## WhatsAppPublicEndpointDown

Test the public URL from outside the host, then inspect Caddy, DNS, certificate status, web/API health, and upstream firewall/load-balancer state. Compare the internal readiness probes to separate edge failure from application failure.

## WhatsAppPostgresDown

Check the `postgres` container health, exporter logs, disk capacity, connection saturation, and PostgreSQL logs. Confirm `pg_isready` succeeds before changing application replicas. For data-loss or restore scenarios, follow `docs/backups.md`; do not improvise destructive recovery on the production volume.

## WhatsAppValkeyDown

Check the `valkey` container, `valkey-cli ping`, memory use, `noeviction` pressure, persistence errors, and exporter logs. Treat Valkey as durable queue state during an incident: do not flush it to clear backlogs.

## WhatsAppDbQueryStatsUnavailable

Confirm `shared_preload_libraries=pg_stat_statements`, then verify the extension exists in the application database. This alert is visibility degradation; database readiness is covered separately.

## WhatsAppQueueBacklogHigh

Identify the affected queue, compare waiting/active counts and configured concurrency, then inspect worker errors and downstream limits. For `send`, inspect Meta rate limiting before scaling workers; scaling into a provider throttle can worsen the incident.

## WhatsAppFailedJobsGrowing

Inspect a sample of failed jobs and the corresponding structured logs. Classify provider errors, invalid data, dependency failures, and code defects before retrying. Avoid bulk retry until the cause is understood and duplicate-send protections are respected.

## WhatsAppDeadLetterBacklog

Treat a sustained failed-job backlog as critical because work is no longer completing. Preserve failed jobs for diagnosis, stop any retry loop that amplifies the failure, correct the root cause, then replay only jobs known to be safe to retry.

## WhatsAppMetaAuthFailure

Inspect the Meta operation and HTTP status without logging tokens. Validate token lifecycle/reauthorization state, WABA/phone permissions, app mode, and credential decryption. Do not paste access tokens into logs, tickets, or chat.

## WhatsAppMetaRateLimited

Confirm the affected operation and phone-number throughput tier. Reduce dispatch pressure or concurrency if required and let the existing per-number rate limiter recover. Do not bypass rate limiting.

## WhatsAppMetaServerErrors

Check Meta service status and operation-level error rate. Preserve idempotency and unknown-send-outcome safeguards; do not blindly replay send jobs after ambiguous provider failures.

## WhatsAppWebhookLagHigh

Compare webhook queue depth, active workers, worker CPU/memory, and downstream database/Valkey health. Scale only after confirming the bottleneck is worker capacity rather than a dependency outage.

## WhatsAppWebhookFailureSpike

Separate ingress rejection (`whatsapp_webhook_errors_total`) from worker failures. For signature errors, verify Meta app secret/configuration rather than weakening verification. For persistence/queue failures, restore PostgreSQL/Valkey first.

## WhatsAppCampaignSendFailureSpike

Inspect send-job error categories and Meta metrics. Pause or throttle affected campaigns when failures can create customer impact. Respect unknown-send-outcome duplicate protection; do not force replay ambiguous sends.

## WhatsAppBackupMetricsMissing

Confirm node-exporter mounts the same host directory that `BACKUP_METRICS_DIR` writes, then run or inspect the scheduled backup job. A fresh deployment should not be considered backup-ready until at least one restore-verified backup has produced the success timestamp.

## WhatsAppBackupTooOld

Check the scheduler and latest `backup-postgres.sh` output. A backup is successful only after encryption, isolated restore verification, and off-server copy. Do not manually advance the metric without completing those steps.

## WhatsAppBackupFailedRecently

Inspect the backup job's non-zero exit and the failure stage: dump, encryption, restore verification, or off-server copy. Fix the cause and rerun the complete backup. Retain evidence of the subsequent successful verification.

## WhatsAppDiskSpaceLow

Identify the filesystem consuming space. Inspect logs, Docker layers/volumes, PostgreSQL, Valkey, and backup retention. Remove only understood disposable data; never delete database/queue volumes to silence the alert.

## WhatsAppDiskSpaceCritical

Stop nonessential disk growth, protect PostgreSQL/Valkey from running out of space, and free verified disposable capacity immediately. If capacity cannot be restored safely, expand the filesystem. Confirm the alert resolves after node-exporter observes the new capacity.

## WhatsAppTlsCertificateExpiringSoon

Inspect Caddy certificate renewal logs, DNS/ACME reachability, and the public probe's `probe_ssl_earliest_cert_expiry`. Correct renewal well before the three-day critical threshold.

## WhatsAppTlsCertificateExpiringCritical

Treat this as imminent customer-facing downtime. Restore ACME renewal or install the approved replacement certificate, then verify the public hostname presents the expected chain and expiry from an external client.

## WhatsAppR2Unavailable

Check `operational-probes` worker logs and Cloudflare status. Validate endpoint, bucket name, access-key scope, and network/DNS without logging credentials. The probe performs a one-object bucket listing; a failure can indicate credentials, bucket configuration, or provider reachability.

## WhatsAppEmailFailureBacklog

Inspect notification worker logs and a sample of failed delivery records, then check Resend status/configuration and sender-domain health. Do not expose recipient addresses or email contents in incident evidence.

## WhatsAppEmailDeadLetters

Dead letters have exhausted retry attempts. Fix provider/configuration errors first, then explicitly reconcile/retry affected deliveries only after confirming idempotency and the intended recipient set.

## WhatsAppSentryErrorSpike

Use the `service` label to narrow the source, then correlate structured logs with Sentry events by timestamp and event name. The Prometheus counter is independent of Sentry transport, so it remains useful if Sentry itself is impaired.

## WhatsAppSentryCaptureFailure

Check Sentry SDK initialization/configuration and recent application logs. This metric records exceptions thrown while handing events to the Sentry SDK; it does not prove Sentry backend ingestion. Keep Prometheus alerts active while Sentry visibility is degraded.

## Evidence checklist for PR-011

Before closing tracking issue #56, attach or link all of the following without secrets/customer data:

- the merged alert-rule file and this runbook;
- Prometheus target/rule screenshots (or equivalent event IDs) from staging/production;
- the unique `test_id` printed by `test-alert-delivery.sh`;
- redacted proof that the matching test alert arrived at the configured human-operated destination;
- confirmation that the backup success metric is present after a restore-verified off-server backup;
- confirmation that the public TLS probe reports the production certificate expiry.
