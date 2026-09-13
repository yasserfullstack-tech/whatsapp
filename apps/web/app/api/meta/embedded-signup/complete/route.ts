import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { encryptSecret } from "@wa/credentials";
import { schema } from "@wa/db";
import {
  exchangeEmbeddedSignupCode,
  getWhatsAppPhoneNumber,
  inferThroughputMps,
  MetaApiError,
  subscribeAppToWaba,
} from "@wa/meta";
import { getAuthContext } from "@/lib/auth-context";
import { db, getCredentialEncryptionKey, getMetaServerConfig } from "@/lib/server";
import { requireWorkspaceAction } from "@/lib/workspace-access";

const payloadSchema = z.object({
  code: z.string().min(1).max(4_096),
  wabaId: z.string().min(1).max(128),
  phoneNumberId: z.string().min(1).max(128),
  businessId: z.string().min(1).max(128).optional(),
});

export async function POST(request: Request) {
  const context = await getAuthContext();
  if (!context) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    requireWorkspaceAction(context.workspace.role, "whatsapp.manage");
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const parsed = payloadSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid Embedded Signup payload" }, { status: 400 });
  }

  const existing = (
    await db
      .select({ organizationId: schema.whatsappPhoneNumbers.organizationId })
      .from(schema.whatsappPhoneNumbers)
      .where(eq(schema.whatsappPhoneNumbers.phoneNumberId, parsed.data.phoneNumberId))
      .limit(1)
  )[0];

  if (existing && existing.organizationId !== context.workspace.organizationId) {
    return NextResponse.json({ error: "This WhatsApp number is already connected to another workspace" }, { status: 409 });
  }

  const meta = getMetaServerConfig();

  try {
    const token = await exchangeEmbeddedSignupCode({
      code: parsed.data.code,
      appId: meta.appId,
      appSecret: meta.appSecret,
      graphApiVersion: meta.graphApiVersion,
    });

    const phone = await getWhatsAppPhoneNumber({
      phoneNumberId: parsed.data.phoneNumberId,
      accessToken: token.accessToken,
      graphApiVersion: meta.graphApiVersion,
    });

    if (phone.id !== parsed.data.phoneNumberId) {
      return NextResponse.json({ error: "Meta returned a different WhatsApp phone number" }, { status: 400 });
    }

    await subscribeAppToWaba({
      wabaId: parsed.data.wabaId,
      accessToken: token.accessToken,
      graphApiVersion: meta.graphApiVersion,
    });

    const credentialKey = `org/${context.workspace.organizationId}/whatsapp/${phone.id}/access-token`;
    const encrypted = encryptSecret(token.accessToken, getCredentialEncryptionKey());
    const now = new Date();

    await db.transaction(async (tx) => {
      await tx
        .insert(schema.credentialSecrets)
        .values({
          organizationId: context.workspace.organizationId,
          key: credentialKey,
          ...encrypted,
        })
        .onConflictDoUpdate({
          target: schema.credentialSecrets.key,
          set: { ...encrypted, updatedAt: now },
        });

      await tx
        .insert(schema.whatsappPhoneNumbers)
        .values({
          organizationId: context.workspace.organizationId,
          metaBusinessId: parsed.data.businessId ?? null,
          wabaId: parsed.data.wabaId,
          phoneNumberId: phone.id,
          displayPhoneNumber: phone.displayPhoneNumber ?? null,
          verifiedName: phone.verifiedName ?? null,
          status: "connected",
          qualityRating: phone.qualityRating ?? null,
          throughputMps: inferThroughputMps(phone.throughputLevel),
          credentialKey,
        })
        .onConflictDoUpdate({
          target: schema.whatsappPhoneNumbers.phoneNumberId,
          set: {
            metaBusinessId: parsed.data.businessId ?? null,
            wabaId: parsed.data.wabaId,
            displayPhoneNumber: phone.displayPhoneNumber ?? null,
            verifiedName: phone.verifiedName ?? null,
            status: "connected",
            qualityRating: phone.qualityRating ?? null,
            throughputMps: inferThroughputMps(phone.throughputLevel),
            credentialKey,
            updatedAt: now,
          },
        });
    });

    return NextResponse.json({
      connected: true,
      phone: {
        id: phone.id,
        displayPhoneNumber: phone.displayPhoneNumber ?? null,
        verifiedName: phone.verifiedName ?? null,
        qualityRating: phone.qualityRating ?? null,
        throughputMps: inferThroughputMps(phone.throughputLevel),
      },
    });
  } catch (error) {
    if (error instanceof MetaApiError) {
      console.error("Meta Embedded Signup failed", {
        status: error.status,
        responseBody: error.responseBody,
      });
      return NextResponse.json({ error: "Meta could not complete the WhatsApp connection" }, { status: 502 });
    }

    console.error("Embedded Signup completion failed", error);
    return NextResponse.json({ error: "Could not complete the WhatsApp connection" }, { status: 500 });
  }
}
