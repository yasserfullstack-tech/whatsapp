import Link from "next/link";
import { AppSidebar } from "@/components/app-sidebar";
import { OnboardingChecklist } from "@/components/onboarding-checklist";
import { requireAuthContext } from "@/lib/auth-context";
import { getI18n } from "@/lib/i18n/server";
import { resumeOnboardingAction } from "@/lib/onboarding-actions";
import { getOnboardingCopy } from "@/lib/onboarding-copy";
import { getOnboardingProgress } from "@/lib/onboarding";
import { can } from "@/lib/workspace-access";

type PageProps = { searchParams: Promise<{ error?: string }> };

export const dynamic = "force-dynamic";

export default async function OnboardingPage({ searchParams }: PageProps) {
  const { session, workspace } = await requireAuthContext();
  const { messages, locale } = await getI18n();
  const params = await searchParams;
  const copy = getOnboardingCopy(locale);
  const progress = await getOnboardingProgress(workspace.organizationId, session.user.id);
  const canManage = can(workspace.role, "workspace.update");
  const initials = workspace.organizationName.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase();

  return (
    <main className="shell">
      <AppSidebar active="onboarding" workspaceName={workspace.organizationName} email={session.user.email} initials={initials} />
      <section className="content">
        <header className="topbar">
          <div>
            <p className="eyebrow">{copy.yourSetup}</p>
            <h1>{copy.pageTitle}</h1>
            <p className="subtitle">{copy.pageSubtitle}</p>
          </div>
          <Link className="secondary" href="/dashboard">{messages.nav.overview}</Link>
        </header>

        {!progress.emailVerified ? (
          <section className="panel" style={{ marginBottom: 18 }}>
            <strong>{copy.emailPending}</strong>
          </section>
        ) : null}

        {params.error === "consent" ? (
          <section className="panel" style={{ marginBottom: 18 }} role="alert">
            <strong>{copy.consentRequired}</strong>
          </section>
        ) : null}

        {progress.complete ? (
          <section className="panel" style={{ marginBottom: 18 }}>
            <span className="status connected">{copy.complete}</span>
            <p className="subtitle" style={{ marginBottom: 0 }}>{copy.completedBanner}</p>
          </section>
        ) : null}

        {progress.dismissed ? (
          <section className="panel" style={{ marginBottom: 18 }}>
            <p className="subtitle">{copy.skippedBanner}</p>
            {canManage ? (
              <form action={resumeOnboardingAction}>
                <button className="primary" type="submit">{copy.resumeOnboarding}</button>
              </form>
            ) : null}
          </section>
        ) : null}

        <OnboardingChecklist progress={progress} copy={copy} canManage={canManage} />
      </section>
    </main>
  );
}
