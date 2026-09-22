import { Worker } from "bullmq";
import { and, count, eq, inArray, sql } from "drizzle-orm";
import type { CountryCode } from "libphonenumber-js/max";
import { BillingLimitExceededError, EntitlementService } from "@wa/billing";
import type { WorkerEnv } from "@wa/config";
import { createDatabase, schema } from "@wa/db";
import {
  CONTACT_IMPORT_QUEUE_NAME,
  createBullConnection,
  type ContactImportJob,
} from "@wa/queue";
import { createR2Client, getStoredObject } from "@wa/storage";
import {
  createContactCsvParser,
  firstValue,
  INSERT_BATCH_SIZE,
  MAX_IMPORT_ROWS,
  NAME_COLUMNS,
  normalizeColumns,
  normalizePhone,
  PHONE_COLUMNS,
  PROGRESS_CHECKPOINT_ROWS,
  type ContactImportMapping,
  type CsvRow,
} from "./contact-import-csv";

type Database = ReturnType<typeof createDatabase>;
type ContactInsert = typeof schema.contacts.$inferInsert;
type R2Client = ReturnType<typeof createR2Client>;

export function createContactImportWorker(input: {
  database: Database;
  entitlements: EntitlementService;
  r2: R2Client;
  env: WorkerEnv;
}) {
  const { database, entitlements, r2, env } = input;
  const db = database.db;

async function processContactImport(job: ContactImportJob) {
  const [contactImport] = await db
    .select()
    .from(schema.contactImports)
    .where(
      and(
        eq(schema.contactImports.id, job.importId),
        eq(schema.contactImports.organizationId, job.organizationId),
      ),
    )
    .limit(1);

  if (!contactImport) throw new Error(`Contact import ${job.importId} was not found`);
  if (contactImport.status === "completed") return { alreadyCompleted: true };

  const mappingRows = await database.client`
    SELECT phone_column, display_name_column, custom_fields
    FROM contact_import_mappings
    WHERE import_id = ${contactImport.id}::uuid AND organization_id = ${contactImport.organizationId}::uuid
    LIMIT 1
  `;
  const importMapping = mappingRows[0] as ContactImportMapping | undefined;

  const importEntitlement = await entitlements.assertUsage(contactImport.organizationId, "max_import_size", { requested: 0 });
  await entitlements.assertUsage(contactImport.organizationId, "max_contacts", { requested: 0, currentUsage: 0 });
  const planImportRowLimit = importEntitlement.limit;

  await db
    .update(schema.contactImports)
    .set({
      status: "processing",
      startedAt: contactImport.startedAt ?? new Date(),
      errorMessage: null,
      updatedAt: new Date(),
    })
    .where(eq(schema.contactImports.id, contactImport.id));

  try {
    const object = await getStoredObject({
      client: r2,
      bucket: env.R2_BUCKET,
      key: contactImport.objectKey,
    });

    const body = object.Body as unknown as { pipe?: (destination: NodeJS.WritableStream) => NodeJS.WritableStream } | undefined;
    if (!body?.pipe) throw new Error("R2 object did not provide a readable stream");

    const parser = createContactCsvParser();

    body.pipe(parser);

    const defaultCountry = contactImport.defaultCountry.toUpperCase() as CountryCode;
    const resumeFrom = contactImport.processedRows;
    let seenRows = 0;
    let persistedRows = resumeFrom;
    let importedRows = contactImport.importedRows;
    let invalidRows = contactImport.invalidRows;
    let duplicateRows = contactImport.duplicateRows;
    let phoneHeaderFound = resumeFrom > 0;
    let pending: ContactInsert[] = [];
    let pendingCustomFields = new Map<string, Record<string, string>>();

    const flush = async (force = false) => {
      const progressDelta = seenRows - persistedRows;
      if (!force && pending.length < INSERT_BATCH_SIZE && progressDelta < PROGRESS_CHECKPOINT_ROWS) return;

      const batch = pending;
      const batchCustomFields = pendingCustomFields;
      pending = [];
      pendingCustomFields = new Map();

      await db.transaction(async (tx) => {
        let insertedCount = 0;
        if (batch.length) {
          const phoneNumbers = [...new Set(batch.map((row) => row.phoneE164))];

          // Serialize contact-capacity mutations for this organization. This
          // makes concurrent imports observe each other's committed inserts.
          await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`entitlement:max_contacts:${contactImport.organizationId}`})::bigint)`);

          const [[currentCount], existingContacts] = await Promise.all([
            tx
              .select({ total: count() })
              .from(schema.contacts)
              .where(eq(schema.contacts.organizationId, contactImport.organizationId)),
            tx
              .select({ phoneE164: schema.contacts.phoneE164 })
              .from(schema.contacts)
              .where(and(
                eq(schema.contacts.organizationId, contactImport.organizationId),
                inArray(schema.contacts.phoneE164, phoneNumbers),
              )),
          ]);

          const existingPhoneNumbers = new Set(existingContacts.map((contact) => contact.phoneE164));
          const newContactCount = phoneNumbers.filter((phoneNumber) => !existingPhoneNumbers.has(phoneNumber)).length;
          if (newContactCount > 0) {
            await entitlements.assertUsage(contactImport.organizationId, "max_contacts", {
              currentUsage: currentCount?.total ?? 0,
              requested: newContactCount,
            });
          }

          const inserted = await tx
            .insert(schema.contacts)
            .values(batch)
            .onConflictDoNothing()
            .returning({ id: schema.contacts.id, phoneE164: schema.contacts.phoneE164 });
          insertedCount = inserted.length;

          const customFieldRows = inserted.flatMap((contact) =>
            Object.entries(batchCustomFields.get(contact.phoneE164) ?? {}).map(([fieldKey, fieldValue]) => ({
              contact_id: contact.id,
              field_key: fieldKey,
              field_value: fieldValue,
            })),
          );
          if (customFieldRows.length) {
            await tx.execute(sql`
              INSERT INTO contact_custom_fields (organization_id, contact_id, field_key, field_value)
              SELECT ${contactImport.organizationId}::uuid, x.contact_id, x.field_key, x.field_value
              FROM jsonb_to_recordset(${JSON.stringify(customFieldRows)}::jsonb)
                AS x(contact_id uuid, field_key text, field_value text)
              ON CONFLICT (organization_id, contact_id, field_key)
              DO UPDATE SET field_value = excluded.field_value, updated_at = now()
            `);
          }
          if (inserted.length) {
            const activityRows = inserted.map((contact) => ({ contact_id: contact.id }));
            await tx.execute(sql`
              INSERT INTO contact_activity_events (organization_id, contact_id, event_type, metadata)
              SELECT ${contactImport.organizationId}::uuid, x.contact_id, 'contact.imported',
                jsonb_build_object('importId', ${contactImport.id}::text)
              FROM jsonb_to_recordset(${JSON.stringify(activityRows)}::jsonb) AS x(contact_id uuid)
            `);
          }

          if (contactImport.listId) {
            const contacts = await tx
              .select({ id: schema.contacts.id })
              .from(schema.contacts)
              .where(and(
                eq(schema.contacts.organizationId, contactImport.organizationId),
                inArray(schema.contacts.phoneE164, phoneNumbers),
              ));

            if (contacts.length) {
              await tx
                .insert(schema.contactListMembers)
                .values(contacts.map((contact) => ({
                  organizationId: contactImport.organizationId,
                  listId: contactImport.listId as string,
                  contactId: contact.id,
                })))
                .onConflictDoNothing();
            }
          }
        }

        importedRows += insertedCount;
        duplicateRows += batch.length - insertedCount;

        await tx
          .update(schema.contactImports)
          .set({
            totalRows: seenRows,
            processedRows: seenRows,
            importedRows,
            invalidRows,
            duplicateRows,
            updatedAt: new Date(),
          })
          .where(eq(schema.contactImports.id, contactImport.id));
      });

      persistedRows = seenRows;
    };

    for await (const raw of parser) {
      seenRows += 1;
      if (seenRows > MAX_IMPORT_ROWS) {
        throw new Error(`CSV exceeds the ${MAX_IMPORT_ROWS.toLocaleString()} row safety limit`);
      }
      if (planImportRowLimit !== null && seenRows > planImportRowLimit) {
        throw new BillingLimitExceededError("max_import_size", planImportRowLimit, seenRows);
      }

      if (seenRows <= resumeFrom) continue;

      const row = normalizeColumns(raw as CsvRow);
      const rawPhone = importMapping ? row[importMapping.phone_column] : firstValue(row, PHONE_COLUMNS);

      if (!phoneHeaderFound) {
        phoneHeaderFound = importMapping
          ? Object.hasOwn(row, importMapping.phone_column)
          : PHONE_COLUMNS.some((column) => Object.hasOwn(row, column));
        if (!phoneHeaderFound) {
          const expected = importMapping ? importMapping.phone_column : PHONE_COLUMNS.join(", ");
          throw new Error(`CSV needs the configured phone column. Expected: ${expected}`);
        }
      }

      if (!rawPhone) {
        invalidRows += 1;
        await flush();
        continue;
      }

      const phoneE164 = normalizePhone(rawPhone, defaultCountry);
      if (!phoneE164) {
        invalidRows += 1;
        await flush();
        continue;
      }

      const customFields = importMapping
        ? Object.fromEntries(Object.entries(importMapping.custom_fields ?? {})
          .map(([key, column]) => [key, row[column]?.trim().slice(0, 500) ?? ""] as const)
          .filter(([, value]) => value.length > 0))
        : {};
      pendingCustomFields.set(phoneE164, customFields);
      pending.push({
        organizationId: contactImport.organizationId,
        phoneE164,
        displayName: importMapping?.display_name_column
          ? row[importMapping.display_name_column]?.slice(0, 160) ?? null
          : firstValue(row, NAME_COLUMNS)?.slice(0, 160) ?? null,
        optedIn: true,
        optInSource: contactImport.optInSource,
        optInAt: contactImport.confirmedOptInAt,
      });

      await flush();
    }

    await flush(true);

    await db
      .update(schema.contactImports)
      .set({
        status: "completed",
        totalRows: seenRows,
        processedRows: seenRows,
        importedRows,
        invalidRows,
        duplicateRows,
        completedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(schema.contactImports.id, contactImport.id));

    return { totalRows: seenRows, importedRows, invalidRows, duplicateRows };
  } catch (error) {
    await db
      .update(schema.contactImports)
      .set({
        status: "failed",
        errorMessage: error instanceof Error ? error.message.slice(0, 2_000) : "Unknown import error",
        updatedAt: new Date(),
      })
      .where(eq(schema.contactImports.id, contactImport.id));
    throw error;
  }
}

  return new Worker<ContactImportJob>(
    CONTACT_IMPORT_QUEUE_NAME,
    async (job) => processContactImport(job.data),
    {
      connection: createBullConnection(env.REDIS_URL),
      concurrency: env.CONTACT_IMPORT_CONCURRENCY,
    },
  );
}
