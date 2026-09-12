import { cookies } from "next/headers";
import { direction, getMessages, localeTag, normalizeLocale } from "./index";

export async function getI18n() {
  const store = await cookies();
  const locale = normalizeLocale(store.get("locale")?.value);
  return {
    locale,
    dir: direction(locale),
    localeTag: localeTag(locale),
    messages: getMessages(locale),
  };
}
