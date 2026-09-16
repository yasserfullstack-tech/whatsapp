import Link from "next/link";
import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { schema } from "@wa/db";
import { getI18n } from "@/lib/i18n/server";
import {
  LEGAL_DOCUMENTS,
  LEGAL_EFFECTIVE_DATE,
  legalDocumentsApproved,
  missingRequiredLegalDocuments,
} from "@/lib/legal";
import { auth, db } from "@/lib/server";

export const dynamic = "force-dynamic";

async function getAcceptedDocuments(authUserId: string) {
  return db
    .select({
      documentType: schema.legalAcceptances.documentType,
      documentVersion: schema.legalAcceptances.documentVersion,
    })
    .from(schema.legalAcceptances)
    .where(eq(schema.legalAcceptances.authUserId, authUserId));
}

async function acceptCurrentLegalDocuments(formData: FormData) {
  "use server";

  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");
  if (String(formData.get("confirm")) !== "yes") redirect("/legal/accept?error=confirmation");
  if (process.env.NODE_ENV === "production" && !legalDocumentsApproved()) {
    redirect("/legal/accept?error=approval");
  }

  const requestHeaders = await headers();
  const userAgent = requestHeaders.get("user-agent")?.slice(0, 1000) ?? null;
  const accepted = await getAcceptedDocuments(session.user.id);
  const missing = missingRequiredLegalDocuments(accepted);

  if (missing.length) {
    await db
      .insert(schema.legalAcceptances)
      .values(missing.map((document) => ({
        authUserId: session.user.id,
        documentType: document.type,
        documentVersion: document.version,
        source: "web",
        userAgent,
      })))
      .onConflictDoNothing();
  }

  redirect("/dashboard");
}

export default async function LegalAcceptancePage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");

  const accepted = await getAcceptedDocuments(session.user.id);
  const missing = missingRequiredLegalDocuments(accepted);
  if (!missing.length) redirect("/dashboard");

  const { locale } = await getI18n();
  const params = await searchParams;
  const productionBlocked = process.env.NODE_ENV === "production" && !legalDocumentsApproved();
  const isArabic = locale === "ar";

  return (
    <main className="authPage">
      <section className="authCard" style={{ maxWidth: 700 }}>
        <div className="authBrand">
          <div className="brandMark">W</div>
          <div>
            <strong>WhatsApp Campaigns</strong>
            <span>{isArabic ? "المستندات القانونية" : "Legal documents"}</span>
          </div>
        </div>
        <div className="authHeading">
          <p className="eyebrow">{isArabic ? "مطلوب قبل متابعة العمل" : "Required before workspace access"}</p>
          <h1>{isArabic ? "راجع النسخ القانونية الحالية" : "Review the current legal versions"}</h1>
          <p>
            {isArabic
              ? "تسجل المنصة النسخة المحددة التي وافقت عليها وتاريخ الموافقة. المستندات القانونية التشغيلية الحالية محفوظة باللغة الإنجليزية إلى أن تتم مراجعة ترجمة قانونية معتمدة."
              : "The platform records the exact document versions you accept and when you accepted them. The legally operative documents are currently maintained in English until reviewed translations are approved."}
          </p>
        </div>

        <div className="authForm">
          <div>
            <strong>{isArabic ? "النسخ المطلوبة" : "Required versions"}</strong>
            <ul>
              {missing.map((document) => (
                <li key={document.type}>
                  <Link href={`/${document.slug}`} target="_blank">{document.title}</Link>
                  {` — ${document.version}`}
                </li>
              ))}
            </ul>
            <p>{isArabic ? "تاريخ السريان" : "Effective date"}: {LEGAL_EFFECTIVE_DATE}</p>
          </div>

          {productionBlocked ? (
            <p className="formError" role="alert">
              {isArabic
                ? "الوصول الإنتاجي محظور حتى يتم تسجيل المراجعة القانونية وتهيئة بيانات الكيان وجهات الاتصال والمنطقة والقانون الحاكم."
                : "Production access is blocked until legal approval is recorded and the entity, contact, region, governing-law, and dispute configuration is complete."}
            </p>
          ) : (
            <form action={acceptCurrentLegalDocuments} className="authForm">
              <label style={{ alignItems: "flex-start", display: "flex", gap: 10 }}>
                <input name="confirm" required type="checkbox" value="yes" style={{ marginTop: 4, width: "auto" }} />
                <span>
                  {isArabic
                    ? "قرأت المستندات المطلوبة أعلاه وأوافق على النسخ المحددة المعروضة."
                    : "I have read the required documents above and agree to the exact versions shown."}
                </span>
              </label>
              {params.error === "confirmation" ? (
                <p className="formError" role="alert">{isArabic ? "يجب تأكيد الموافقة." : "Confirmation is required."}</p>
              ) : null}
              {params.error === "approval" ? (
                <p className="formError" role="alert">{isArabic ? "لم تعتمد المستندات للإنتاج بعد." : "The documents are not yet approved for production."}</p>
              ) : null}
              <button className="primary authSubmit" type="submit">
                {isArabic ? "موافقة ومتابعة" : "Accept and continue"}
              </button>
            </form>
          )}

          <p className="authSwitch">
            {LEGAL_DOCUMENTS.map((document, index) => (
              <span key={document.type}>
                {index ? " · " : ""}<Link href={`/${document.slug}`}>{document.title}</Link>
              </span>
            ))}
          </p>
        </div>
      </section>
    </main>
  );
}
