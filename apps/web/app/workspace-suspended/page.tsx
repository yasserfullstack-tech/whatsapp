import { SignOutButton } from "@/components/sign-out-button";
import { getI18n } from "@/lib/i18n/server";
import { productionUiMessages } from "@/lib/i18n/production-ui";

export default async function WorkspaceSuspendedPage() {
  const { locale } = await getI18n();
  const copy = productionUiMessages[locale].status;
  return <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", background: "#f5f7f8", padding: 24 }}><article style={{ maxWidth: 560, background: "white", border: "1px solid #dfe7e2", borderRadius: 16, padding: 28 }}><h1>{copy.suspendedTitle}</h1><p>{copy.suspendedBody}</p><SignOutButton /></article></main>;
}
