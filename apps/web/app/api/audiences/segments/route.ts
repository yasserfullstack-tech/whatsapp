import { NextResponse } from "next/server";
import { z } from "zod";
import { schema } from "@wa/db";
import { getAuthContext } from "@/lib/auth-context";
import { validateSegmentDefinition } from "@/lib/audience-server";
import { db } from "@/lib/server";
import { can } from "@/lib/workspace-access";

export const runtime = "nodejs";

const requestSchema = z.object({
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(500).optional(),
  definition: z.unknown(),
});

export async function POST(request: Request) {
  const context = await getAuthContext();
  if (!context) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!can(context.workspace.role, "audiences.manage")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid segment request", issues: parsed.error.issues }, { status: 400 });
  }

  try {
    const validation = await validateSegmentDefinition(context.workspace.organizationId, parsed.data.definition);
    if (!validation.ok) {
      return NextResponse.json({ error: "Invalid segment filters", issues: validation.issues }, { status: 400 });
    }

    const [segment] = await db
      .insert(schema.audienceSegments)
      .values({
        organizationId: context.workspace.organizationId,
        name: parsed.data.name,
        description: parsed.data.description || null,
        match: validation.definition.match,
        filters: validation.definition.filters,
      })
      .onConflictDoUpdate({
        target: [schema.audienceSegments.organizationId, schema.audienceSegments.name],
        set: {
          description: parsed.data.description || null,
          match: validation.definition.match,
          filters: validation.definition.filters,
          updatedAt: new Date(),
        },
      })
      .returning({ id: schema.audienceSegments.id, name: schema.audienceSegments.name });

    return NextResponse.json(segment, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not save segment" }, { status: 400 });
  }
}
