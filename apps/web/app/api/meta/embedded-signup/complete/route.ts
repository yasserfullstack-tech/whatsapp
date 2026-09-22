import { NextResponse } from "next/server";
import { and, count, eq } from "drizzle-orm";
import { z } from "zod";
import { encryptSecret } from "@wa/credentials";
import { schema } from "@wa/db";
import {
  exchangeEmbeddedSignupCode,
  getWhatsAppPhoneNumber,
  inferThroughputMps,
  listWhatsAppBusinessAccountPhoneNumberIds,
  MetaApiError,
  subscribeAppToWaba,
} from "@wa/meta";
import { getAuthContext } from "@/lib/auth-context";
import {
  assertEmbeddedSignupWabaPhoneMatch,
  EmbeddedSignupConflictError,
  EmbeddedSignupPhoneMismatchError,
  EmbeddedSignupWabaPhoneMismatchError,
  verifyEmbeddedSignupPhone,
} from "@/lib/embedded-signup-security";
import { entitlements, entitlementErrorPayload } from "@/lib/entitlements-server";
import { db, getCredentialKeyRing, getMetaServerConfig } from "@/lib/server";
import {
  saveVerifiedWhatsAppConnectionAtomic,
  WhatsAppConnectionConflictError,
} from "@/lib/whatsapp-connection";
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

  const meta = getMetaServerConfig();

  try {
    const { token, phone } = await verifyEmbeddedSignupPhone({
      organizationId: context.workspace.organizationId,
      requestedPhoneNumberId: parsed.data.phoneNumberId,
      exchangeCode: () => exchangeEmbeddedSignupCode({
        code: parsed.data.code,
        appId: meta.appId,
        appSecret: meta.appSecret,
        graphApiVersion: meta.graphApiVersion,
      }),
      getPhone: (accessToken) => getWhatsAppPhoneNumber({
        phoneNumberId: parsed.data.phoneNumberId,
        accessToken,
        graphApiVersion: meta.graphApiVersion,
      }),
      findOrganizationByPhoneNumberId: async (phoneNumberId) => (
        await db
          .select({ organizationId: schema.whatsappPhoneNumbers.organizationId })
          .from(schema.whatsappPhoneNumbers)
          .where(eq(schema.whatsappPhoneNumbers.phoneNumberId, phoneNumberId))
          .limit(1)
      )[0]?.organizationId ?? null,
    });

    const wabaPhoneNumberIds = await listWhatsAppBusinessAccountPhoneNumberIds({
      wabaId: parsed.data.wabaId,
      accessToken: token.accessToken,
      graphApiVersion: meta.graphApiVersion,
    });
    assertEmbeddedSignupWabaPhoneMatch({
      requestedPhoneNumberId: phone.id,
      wabaPhoneNumberIds,
    });

    const [existingPhone] = await db
      .select({ status: schema.whatsappPhoneNumbers.status })
      .from(schema.whatsappPhoneNumbers)
      .where(and(
        eq(schema.whatsappPhoneNumbers.organizationId, context.workspace.organizationId),
        eq(schema.whatsappPhoneNumbers.phoneNumberId, phone.id),
      ))
      .limit(1);

    if (!existingPhone || existingPhone.status !== "connected") {
      const [connectedCount] = await db
        .select({ total: count() })
        .from(schema.whatsappPhoneNumbers)
        .where(and(
          eq(schema.whatsappPhoneNumbers.organizationId, context.workspace.organizationId),
          eq(schema.whatsappPhoneNumbers.status, "connected"),
        ));
      await entitlements.assertUsage(context.workspace.organizationId, "max_phone_numbers", {
        currentUsage: connectedCount?.total ?? 0,
        requested: 1,
      });
    }

    await subscribeAppToWaba({
      wabaId: parsed.data.wabaId,
      accessToken: token.accessToken,
      graphApiVersion: meta.graphApiVersion,
    });

    const credentialKey = `org/${context.workspace.organizationId}/whatsapp/${phone.id}/access-token`;
    const encrypted = encryptSecret(token.accessToken, getCredentialKeyRing());
    const throughputMps = inferThroughputMps(phone.throughputLevel);
    const credentialExpiresAt = typeof token.expiresIn === "number" && token.expiresIn > 0
      ? new Date(Date.now() + token.expiresIn * 1_000)
      : undefined;

    await saveVerifiedWhatsAppConnectionAtomic(db, {
      organizationId: context.workspace.organizationId,
      phone: {
        id: phone.id,
        ...(phone.displayPhoneNumber !== undefined ? { displayPhoneNumber: phone.displayPhoneNumber } : {}),
        ...(phone.verifiedName !== undefined ? { verifiedName: phone.verifiedName } : {}),
        ...(phone.qualityRating !== undefined ? { qualityRating: phone.qualityRating } : {}),
        throughputMps,
      },
      wabaId: parsed.data.wabaId,
      ...(parsed.data.businessId !== undefined ? { businessId: parsed.data.businessId } : {}),
      credential: {
        key: credentialKey,
        ...encrypted,
        ...(credentialExpiresAt ? { expiresAt: credentialExpiresAt } : {}),
      },
    });

    return NextResponse.json({
      connected: true,
      phone: {
        id: phone.id,
        displayPhoneNumber: phone.displayPhoneNumber ?? null,
        verifiedName: phone.verifiedName ?? null,
        qualityRating: phone.qualityRating ?? null,
        throughputMps,
      },
    });
  } catch (error) {
    const entitlementError = entitlementErrorPayload(error);
    if (entitlementError) {
      return NextResponse.json(entitlementError, { status: 409 });
    }

    if (error instanceof EmbeddedSignupConflictError || error instanceof WhatsAppConnectionConflictError) {
      return NextResponse.json({ error: "Could not connect this WhatsApp number" }, { status: 409 });
    }

    if (error instanceof EmbeddedSignupPhoneMismatchError) {
      return NextResponse.json({ error: "Meta returned a different WhatsApp phone number" }, { status: 400 });
    }

    if (error instanceof EmbeddedSignupWabaPhoneMismatchError) {
      return NextResponse.json({ error: "Meta returned mismatched WhatsApp account assets" }, { status: 400 });
    }

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
