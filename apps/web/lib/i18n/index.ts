import { ar } from "./ar";
import { en, type Messages } from "./en";

export type Locale = "en" | "ar";
export type { Messages };

export function normalizeLocale(value: string | null | undefined): Locale {
  return value?.toLowerCase().startsWith("ar") ? "ar" : "en";
}

export function getMessages(locale: Locale): Messages {
  return locale === "ar" ? ar : en;
}

export function direction(locale: Locale): "rtl" | "ltr" {
  return locale === "ar" ? "rtl" : "ltr";
}

export function localeTag(locale: Locale): string {
  return locale === "ar" ? "ar-IQ" : "en-US";
}

export function formatMessage(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => key in values ? String(values[key]) : match);
}
