import type { EmbeddedSignupToken, WhatsAppPhoneNumberDetails } from "@wa/meta";

export class EmbeddedSignupConflictError extends Error {
  constructor() {
    super("WhatsApp connection conflict");
    this.name = "EmbeddedSignupConflictError";
  }
}

export async function verifyEmbeddedSignupPhone(input: {
  organizationId: string;
  requestedPhoneNumberId: string;
  exchangeCode: () => Promise<EmbeddedSignupToken>;
  getPhone: (accessToken: string) => Promise<WhatsAppPhoneNumberDetails>;
  findOrganizationByPhoneNumberId: (phoneNumberId: string) => Promise<string | null>;
}): Promise<{ token: EmbeddedSignupToken; phone: WhatsAppPhoneNumberDetails }> {
  // Do not query local ownership from an attacker-supplied phone id. First require
  // Meta to prove that the signup code can read that exact phone-number resource.
  const token = await input.exchangeCode();
  const phone = await input.getPhone(token.accessToken);
  if (phone.id !== input.requestedPhoneNumberId) {
    throw new Error("Meta returned a different WhatsApp phone number");
  }

  const existingOrganizationId = await input.findOrganizationByPhoneNumberId(phone.id);
  if (existingOrganizationId && existingOrganizationId !== input.organizationId) {
    throw new EmbeddedSignupConflictError();
  }

  return { token, phone };
}
