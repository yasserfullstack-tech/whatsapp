import type { EmbeddedSignupToken, WhatsAppPhoneNumberDetails } from "@wa/meta";

export class EmbeddedSignupConflictError extends Error {
  constructor() {
    super("WhatsApp connection conflict");
    this.name = "EmbeddedSignupConflictError";
  }
}

export class EmbeddedSignupPhoneMismatchError extends Error {
  constructor() {
    super("Meta returned a different WhatsApp phone number");
    this.name = "EmbeddedSignupPhoneMismatchError";
  }
}

export class EmbeddedSignupWabaPhoneMismatchError extends Error {
  constructor() {
    super("Meta returned a WABA that does not contain the selected WhatsApp phone number");
    this.name = "EmbeddedSignupWabaPhoneMismatchError";
  }
}

export function assertEmbeddedSignupWabaPhoneMatch(input: {
  requestedPhoneNumberId: string;
  wabaPhoneNumberIds: readonly string[];
}): void {
  if (!input.wabaPhoneNumberIds.includes(input.requestedPhoneNumberId)) {
    throw new EmbeddedSignupWabaPhoneMismatchError();
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
    throw new EmbeddedSignupPhoneMismatchError();
  }

  const existingOrganizationId = await input.findOrganizationByPhoneNumberId(phone.id);
  if (existingOrganizationId && existingOrganizationId !== input.organizationId) {
    throw new EmbeddedSignupConflictError();
  }

  return { token, phone };
}
