import { randomUUID } from "node:crypto";
import { createDatabase } from "@wa/db";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");

const recipientCount = Number.parseInt(process.env.REPORT_RECIPIENTS ?? "100000", 10);
const campaignCount = Number.parseInt(process.env.REPORT_CAMPAIGNS ?? "5", 10);
const phoneCount = Number.parseInt(process.env.REPORT_PHONE_NUMBERS ?? "2", 10);
const keepData = process.env.REPORT_KEEP_DATA === "true";

if (![recipientCount, campaignCount, phoneCount].every((value) => Number.isSafeInteger(value) && value > 0)) {
  throw new Error("REPORT_RECIPIENTS, REPORT_CAMPAIGNS, and REPORT_PHONE_NUMBERS must be positive integers");
}
if (recipientCount > 500_000) throw new Error("Reporting load harness is capped at 500,000 recipients per run");

const { client } = createDatabase(databaseUrl);
const organizationId = randomUUID();
const campaignIds = Array.from({ length: campaignCount }, () => randomUUID());
const phoneIds = Array.from({ length: phoneCount }, () => randomUUID());
const templateId = randomUUID();
const started = performance.now();

function elapsed(start: number) {
  return Math.round((performance.now() - start) * 10) / 10;
}

try {
  await client.begin(async (tx) => {
    await tx`
      INSERT INTO organizations (id, name, slug)
      VALUES (${organizationId}::uuid, ${`Reporting load ${recipientCount}`}, ${`report-load-${organizationId}`})
    `;

    for (let index = 0; index < phoneIds.length; index += 1) {
      const phoneId = phoneIds[index]!;
      await tx`
        INSERT INTO whatsapp_phone_numbers (
          id, organization_id, waba_id, phone_number_id, display_phone_number,
          verified_name, status, quality_rating, throughput_mps, credential_key
        ) VALUES (
          ${phoneId}::uuid, ${organizationId}::uuid, ${`waba-${organizationId}`},
          ${`load-phone-${index}-${organizationId}`}, ${`+964700000${String(index).padStart(3, "0")}`},
          ${`Load Number ${index + 1}`}, 'connected', 'GREEN', ${index === 0 ? 80 : 1000}, ${`load/${organizationId}/${index}`}
        )
      `;
    }

    await tx`
      INSERT INTO templates (id, organization_id, waba_id, name, language, category, status, body_preview, components)
      VALUES (${templateId}::uuid, ${organizationId}::uuid, ${`waba-${organizationId}`}, 'report_load_template', 'en', 'marketing', 'approved', 'Load test', '[]'::jsonb)
    `;

    for (let index = 0; index < campaignIds.length; index += 1) {
      const campaignId = campaignIds[index]!;
      const phoneId = phoneIds[index % phoneIds.length]!;
      await tx`
        INSERT INTO campaigns (
          id, organization_id, whatsapp_phone_number_id, template_id, name, status,
          recipient_count, snapshot_created_at, started_at, created_at, updated_at
        ) VALUES (
          ${campaignId}::uuid, ${organizationId}::uuid, ${phoneId}::uuid,
          ${templateId}::uuid, ${`Reporting scale campaign ${index + 1}`}, 'completed', 0,
          now() - make_interval(days => ${index}), now() - make_interval(days => ${index}),
          now() - make_interval(days => ${index}), now()
        )
      `;
      await tx`
        INSERT INTO campaign_audiences (organization_id, campaign_id, type, source_name, definition)
        VALUES (${organizationId}::uuid, ${campaignId}::uuid, 'all', 'All eligible contacts', '{"type":"all"}'::jsonb)
      `;
    }

    const contactInsertStart = performance.now();
    await tx.unsafe(`
      INSERT INTO contacts (id, organization_id, phone_e164, display_name, opted_in, opt_in_source, opt_in_at, created_at, updated_at)
      SELECT
        gen_random_uuid(),
        '${organizationId}'::uuid,
        '+9647' || lpad(gs::text, 9, '0'),
        'Reporting Contact ' || gs,
        true,
        'reporting_load_test',
        now() - interval '30 days',
        now() - interval '30 days',
        now()
      FROM generate_series(1, ${recipientCount}) AS gs
    `);
    console.log(JSON.stringify({ phase: "contacts", recipients: recipientCount, ms: elapsed(contactInsertStart) }));

    const recipientInsertStart = performance.now();
    const campaignsSql = campaignIds.map((id) => `'${id}'::uuid`).join(",");
    await tx.unsafe(`
      WITH numbered AS (
        SELECT id, phone_e164, row_number() OVER (ORDER BY id) AS rn
        FROM contacts
        WHERE organization_id = '${organizationId}'::uuid
      ), assigned AS (
        SELECT
          id,
          phone_e164,
          rn,
          (ARRAY[${campaignsSql}])[1 + ((rn - 1) % ${campaignCount})::int] AS campaign_id
        FROM numbered
      )
      INSERT INTO campaign_recipients (
        id, organization_id, campaign_id, contact_id, phone_e164, display_name, status,
        submitted_at, sent_at, delivered_at, read_at, failed_at, created_at, updated_at
      )
      SELECT
        gen_random_uuid(),
        '${organizationId}'::uuid,
        campaign_id,
        id,
        phone_e164,
        'Load Recipient ' || rn,
        CASE
          WHEN rn % 50 = 0 THEN 'failed'::recipient_status
          WHEN rn % 4 = 0 THEN 'read'::recipient_status
          WHEN rn % 3 = 0 THEN 'delivered'::recipient_status
          WHEN rn % 2 = 0 THEN 'sent'::recipient_status
          ELSE 'submitted'::recipient_status
        END,
        now() - interval '2 days' + ((rn % 172800) || ' seconds')::interval,
        CASE WHEN rn % 50 <> 0 AND rn % 2 = 0 THEN now() - interval '1 day' ELSE NULL END,
        CASE WHEN rn % 50 <> 0 AND (rn % 3 = 0 OR rn % 4 = 0) THEN now() - interval '12 hours' ELSE NULL END,
        CASE WHEN rn % 50 <> 0 AND rn % 4 = 0 THEN now() - interval '6 hours' ELSE NULL END,
        CASE WHEN rn % 50 = 0 THEN now() - interval '12 hours' ELSE NULL END,
        now() - interval '2 days',
        now()
      FROM assigned
    `);
    await tx`
      UPDATE campaigns c
      SET recipient_count = counts.total
      FROM (
        SELECT campaign_id, count(*)::int AS total
        FROM campaign_recipients
        WHERE organization_id = ${organizationId}::uuid
        GROUP BY campaign_id
      ) counts
      WHERE c.id = counts.campaign_id
    `;
    console.log(JSON.stringify({ phase: "campaign_recipients", recipients: recipientCount, campaigns: campaignCount, ms: elapsed(recipientInsertStart) }));
  });

  const queryStart = performance.now();
  const summary = await client`
    SELECT
      count(DISTINCT c.id)::bigint AS campaigns,
      count(cr.id)::bigint AS recipients,
      count(cr.id) FILTER (WHERE cr.submitted_at IS NOT NULL)::bigint AS submitted,
      count(cr.id) FILTER (WHERE cr.status IN ('submitted', 'sent', 'delivered', 'read'))::bigint AS accepted,
      count(cr.id) FILTER (WHERE cr.status IN ('sent', 'delivered', 'read'))::bigint AS sent,
      count(cr.id) FILTER (WHERE cr.status IN ('delivered', 'read'))::bigint AS delivered,
      count(cr.id) FILTER (WHERE cr.status = 'read')::bigint AS read,
      count(cr.id) FILTER (WHERE cr.status = 'failed')::bigint AS failed
    FROM campaigns c
    LEFT JOIN campaign_recipients cr
      ON cr.campaign_id = c.id
      AND cr.organization_id = ${organizationId}::uuid
    WHERE c.organization_id = ${organizationId}::uuid
  ` as unknown as Array<Record<string, string>>;
  const queryMs = elapsed(queryStart);

  const explainStart = performance.now();
  const explain = await client`
    EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
    SELECT c.id, count(cr.id)
    FROM campaigns c
    LEFT JOIN campaign_recipients cr
      ON cr.campaign_id = c.id
      AND cr.organization_id = ${organizationId}::uuid
    WHERE c.organization_id = ${organizationId}::uuid
    GROUP BY c.id
  ` as unknown as Array<{ "QUERY PLAN": unknown }>;
  const explainMs = elapsed(explainStart);

  console.log(JSON.stringify({
    phase: "report_summary",
    recipients: recipientCount,
    campaigns: campaignCount,
    phoneNumbers: phoneCount,
    queryMs,
    explainMs,
    summary: summary[0] ?? null,
    plan: explain[0]?.["QUERY PLAN"] ?? null,
    totalHarnessMs: elapsed(started),
  }));
} finally {
  if (!keepData) {
    await client`DELETE FROM organizations WHERE id = ${organizationId}::uuid`;
  }
  await client.end({ timeout: 10 });
}

// release-gate probe B: throwaway comment, touches the reporting path group
