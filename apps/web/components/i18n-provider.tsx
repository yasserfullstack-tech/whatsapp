"use client";

import { createContext, type ReactNode, useContext, useMemo } from "react";
import { formatMessage, localeTag, type Locale, type Messages } from "@/lib/i18n";

type I18nValue = {
  locale: Locale;
  messages: Messages;
  number: (value: number) => string;
  dateTime: (value: string | Date) => string;
  format: (template: string, values: Record<string, string | number>) => string;
};

const I18nContext = createContext<I18nValue | null>(null);

export function I18nProvider({ locale, messages, children }: { locale: Locale; messages: Messages; children: ReactNode }) {
  const value = useMemo<I18nValue>(() => {
    const tag = localeTag(locale);
    const numberFormatter = new Intl.NumberFormat(tag);
    const dateFormatter = new Intl.DateTimeFormat(tag, { dateStyle: "medium", timeStyle: "short" });
    return {
      locale,
      messages,
      number: (input) => numberFormatter.format(input),
      dateTime: (input) => dateFormatter.format(typeof input === "string" ? new Date(input) : input),
      format: formatMessage,
    };
  }, [locale, messages]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const value = useContext(I18nContext);
  if (!value) throw new Error("useI18n must be used inside I18nProvider");
  return value;
}
