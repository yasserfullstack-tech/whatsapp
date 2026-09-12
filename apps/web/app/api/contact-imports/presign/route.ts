import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { schema } from "@wa/db";
import { createPresignedCsvUpload, createR2Client } from "@wa/storage";
import { getAuthContext } from "@/lib/auth-context";
import { db, getR2ServerConfig } from "@/lib/server";

export const runtime = "nodejs";

const MAX_CSV_BYTES = 250 * 1024 * 1024;

const requestSchema = z.object({
  fileName: z.string().trim().min(1).max(255).refine((value) => value.toLowerCase().endsWith(".csv"), "Only .csv files are supported"),
  sizeBytes: z.number().int().positive().max(MAX_CSV_BYTES),
  defaultCountry: z.string().trim().length(2).regex(/^[A-Za-z]{2}$/),
  optInSource: z.string().trim().min(2).max(120),
  listName: z.string().trim().min(2).max(120).optional(),
  confirmedOptIn: z.literal(true),
});

function safeFileName(fileName: string): string {
  const safe = fileName
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .slice(0, 120);
  return safe || "contacts.csv";
}

export async function POST(request: Request) {
  const context = await getAuthContext();
  if (!context) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid import request", issues: parsed.error.issues }, { status: 400 });
  }

  const organizationId = context.workspace.organizationId;
  let listId: string | null = null;
  if (parsed.data.listName) {
    const [list] = await db
      .insert(schema.contactLists)
      .values({ organizationId, name: parsed.data.listName })
      .onConflictDoUpdate({
        target: [schema.contactLists.organizationId, schema.contactLists.name],
        set: { updatedAt: new Date() },
      })
      .returning({ id: schema.contactLists.id });
    listId = list?.id ?? null;
  }

  const importId = randomUUID();
  const objectKey = `${organizationId}/contact-imports/${importId}/${safeFileName(parsed.data.fileName)}`;
  const r2Config = getR2ServerConfig();
  const r2 = createR2Client(r2Config);

  await db.insert(schema.contactImports).values({
    id: importId,
    organizationId,
    listId,
    originalFileName: parsed.data.fileName,
    objectKey,
    sizeBytes: parsed.data.sizeBytes,
    defaultCountry: parsed.data.defaultCountry.toUpperCase(),
    optInSource: parsed.data.optInSource,
    confirmedOptInAt: new Date(),
    status: "awaiting_upload",
  });

  try {
    const uploadUrl = await createPresignedCsvUpload({
      client: r2,
      bucket: r2Config.bucket,
      key: objectKey,
      expiresInSeconds: 1_800,
    });

    return NextResponse.json({
      importId,
      uploadUrl,
      contentType: "text/csv",
      expiresInSeconds: 1_800,
      maxBytes: MAX_CSV_BYTES,
    });
  } catch (error) {
    await db.delete(schema.contactImports).where(eq(schema.contactImports.id, importId));
    throw error;
  }
}
