import { NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth-context";
import {
  countEligibleAudience,
  sampleEligibleAudience,
  validateSegmentDefinition,
} from "@/lib/audience-server";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const context = await getAuthContext();
  if (!context) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const validation = await validateSegmentDefinition(
      context.workspace.organizationId,
      await request.json().catch(() => null),
    );
    if (!validation.ok) {
      return NextResponse.json({ error: "Invalid segment filters", issues: validation.issues }, { status: 400 });
    }

    const definition = {
      type: "segment" as const,
      match: validation.definition.match,
      filters: validation.definition.filters,
    };
    const [count, sample] = await Promise.all([
      countEligibleAudience(context.workspace.organizationId, definition),
      sampleEligibleAudience(context.workspace.organizationId, definition),
    ]);

    return NextResponse.json({ count, sample });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not preview audience" }, { status: 400 });
  }
}
