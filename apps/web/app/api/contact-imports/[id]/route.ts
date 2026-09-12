import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { schema } from "@wa/db";
import { createR2Client, headStoredObject } from "@wa/storage";
import { getAuthContext } from "@/lib/auth-context";
import { contactImportQueue, db, getR2ServerConfig } from "@/lib/server";

export const runtime = "nodejs";

const MAX_CSV_BYTES = 250 * 1024 * 1024;

type RouteContext = { params: Promise<{ id: string }> };

async function findImport(id: string, organizationId: string) {
  const [contactImport] = await db
    .select()
    .from(schema.contactImports)
    .where(
      and(
        eq(schema.contactImports.id, id),
        eq(schema.contactImports.organizationId, organizationId),
      ),
    )
    .limit(1);
  return contactImport;
}

function publicSnapshot(contactImport: NonNullable<Awaited<ReturnType<typeof findImport>>>) {
  return {
    id: contactImport.id,
    fileName: contactImport.originalFileName,
    status: contactImport.status,
    totalRows: contactImport.totalRows,
    processedRows: contactImport.processedRows,
    importedRows: contactImport.importedRows,
    invalidRows: contactImport.invalidRows,
    duplicateRows: contactImport.duplicateRows,
    errorMessage: contactImport.errorMessage,
  };
}

export async function GET(_request: Request, routeContext: RouteContext) {
  const context = await getAuthContext();
  if (!context) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await routeContext.params;
  const contactImport = await findImport(id, context.workspace.organizationId);
  if (!contactImport) return NextResponse.json({ error: "Import not found" }, { status: 404 });

  return NextResponse.json(publicSnapshot(contactImport));
}

export async function POST(_request: Request, routeContext: RouteContext) {
  const context = await getAuthContext();
  if (!context) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await routeContext.params;
  const contactImport = await findImport(id, context.workspace.organizationId);
  if (!contactImport) return NextResponse.json({ error: "Import not found" }, { status: 404 });

  if (["queued", "processing", "completed"].includes(contactImport.status)) {
    return NextResponse.json(publicSnapshot(contactImport));
  }
  if (contactImport.status === "failed") {
    return NextResponse.json({ error: "This import failed. Upload the file again to create a fresh import." }, { status: 409 });
  }

  const r2Config = getR2ServerConfig();
  const r2 = createR2Client(r2Config);

  try {
    const head = await headStoredObject({ client: r2, bucket: r2Config.bucket, key: contactImport.objectKey });
    const actualSize = head.ContentLength ?? 0;
    if (actualSize <= 0 || actualSize > MAX_CSV_BYTES) {
      return NextResponse.json({ error: "Uploaded CSV is empty or exceeds the 250 MB limit" }, { status: 400 });
    }
    if (actualSize !== contactImport.sizeBytes) {
      return NextResponse.json({ error: "Uploaded file size does not match the selected CSV" }, { status: 400 });
    }
    if (head.ContentType && head.ContentType !== "text/csv") {
      return NextResponse.json({ error: "Uploaded object is not marked as text/csv" }, { status: 400 });
    }

    await db
      .update(schema.contactImports)
      .set({ status: "queued", errorMessage: null, updatedAt: new Date() })
      .where(eq(schema.contactImports.id, contactImport.id));

    try {
      await contactImportQueue.add(
        "import-csv",
        { organizationId: contactImport.organizationId, importId: contactImport.id },
        { jobId: `contact-import-${contactImport.id}` },
      );
    } catch (queueError) {
      await db
        .update(schema.contactImports)
        .set({ status: "awaiting_upload", errorMessage: "Could not queue the import. Please try again.", updatedAt: new Date() })
        .where(eq(schema.contactImports.id, contactImport.id));
      throw queueError;
    }

    const queued = await findImport(contactImport.id, contactImport.organizationId);
    return NextResponse.json(queued ? publicSnapshot(queued) : publicSnapshot(contactImport));
  } catch (error) {
    if (error instanceof Error && error.name === "NotFound") {
      return NextResponse.json({ error: "The uploaded file was not found in storage" }, { status: 400 });
    }
    throw error;
  }
}
