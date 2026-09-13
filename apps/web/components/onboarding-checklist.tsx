import Link from "next/link";
import type { OnboardingProgress } from "@/lib/onboarding-model";
import type { OnboardingCopy } from "@/lib/onboarding-copy";
import {
  completeOnboardingAction,
  confirmOnboardingConsentAction,
  skipOnboardingAction,
  skipOnboardingStepAction,
} from "@/lib/onboarding-actions";

export function OnboardingChecklist({
  progress,
  copy,
  canManage,
}: {
  progress: OnboardingProgress;
  copy: OnboardingCopy;
  canManage: boolean;
}) {
  return (
    <section className="panel" aria-label={copy.setupProgress} data-testid="onboarding-checklist">
      <div className="panelHeader">
        <div>
          <p className="eyebrow">{copy.yourSetup}</p>
          <h2>{copy.setupProgress}</h2>
          <p className="subtitle">{progress.completedCount}/{progress.totalSteps}</p>
        </div>
      </div>

      <ol className="checklist onboardingChecklist">
        {progress.steps.map((step, index) => {
          const text = copy.steps[step.id];
          const statusLabel = step.status === "completed"
            ? copy.complete
            : step.status === "skipped"
              ? copy.skipped
              : copy.incomplete;
          const marker = step.status === "completed" ? "✓" : step.status === "skipped" ? "—" : String(index + 1);

          return (
            <li key={step.id} data-step={step.id}>
              <span>{marker}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="rowTitle" style={{ alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <strong>{text.title}</strong>
                  {step.optional ? <small className="subtitle">{copy.optional}</small> : null}
                  <small className={step.status === "completed" ? "status connected" : "status"}>{statusLabel}</small>
                </div>
                <p>{text.description}</p>

                {step.id === "consent" && step.status === "incomplete" && canManage ? (
                  <form action={confirmOnboardingConsentAction} id="consent" style={{ display: "grid", gap: 10, marginTop: 10 }}>
                    <label style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                      <input name="consent" type="checkbox" value="confirmed" required style={{ marginTop: 3 }} />
                      <span>{copy.consentLabel}</span>
                    </label>
                    <div><button className="primary" type="submit">{copy.confirmConsent}</button></div>
                  </form>
                ) : step.status === "incomplete" ? (
                  <div className="actionRow" style={{ marginTop: 10 }}>
                    <Link className="secondary" href={step.href}>{text.cta}</Link>
                    {step.optional && canManage ? (
                      <form action={skipOnboardingStepAction}>
                        <input name="step" type="hidden" value={step.id} />
                        <button className="secondary" type="submit">{copy.skipStep}</button>
                      </form>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>

      {canManage ? (
        <div style={{ display: "grid", gap: 10, marginTop: 18 }}>
          {!progress.canFinish ? <p className="subtitle">{copy.consentRequired}</p> : null}
          <div className="actionRow">
            <form action={completeOnboardingAction}>
              <button className="primary" type="submit" disabled={!progress.canFinish}>{copy.markComplete}</button>
            </form>
            <form action={skipOnboardingAction}>
              <button className="secondary" type="submit" disabled={!progress.canFinish}>{copy.skipOnboarding}</button>
            </form>
          </div>
        </div>
      ) : <p className="subtitle" style={{ marginTop: 18 }}>{copy.readOnly}</p>}
    </section>
  );
}

export function OnboardingDashboardCard({
  progress,
  copy,
}: {
  progress: OnboardingProgress;
  copy: OnboardingCopy;
}) {
  if (progress.complete || progress.dismissed) return null;

  const status = (id: OnboardingProgress["steps"][number]["id"]) =>
    progress.steps.find((step) => step.id === id)?.status === "completed";
  const rows = [
    { label: copy.dashboard.workspaceCreated, done: true },
    { label: copy.emailVerified, done: progress.emailVerified },
    { label: copy.dashboard.whatsappConnected, done: status("whatsapp") },
    { label: copy.dashboard.contactsImported, done: status("contacts") },
    { label: copy.dashboard.templateReady, done: status("template") },
    { label: copy.dashboard.audienceReady, done: status("audience") },
    { label: copy.dashboard.firstCampaign, done: status("campaign") },
  ];

  return (
    <section className="panel" style={{ marginTop: 18 }} aria-label={copy.yourSetup}>
      <div className="panelHeader">
        <div>
          <p className="eyebrow">{copy.yourSetup}</p>
          <h2>{copy.setupProgress}</h2>
        </div>
        <Link className="secondary" href="/onboarding">{copy.openGuide}</Link>
      </div>
      <div className="numberList" style={{ marginTop: 12 }}>
        {rows.map((row) => (
          <div className="numberRow" key={row.label}>
            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <span className={row.done ? "status connected" : "status"}>{row.done ? "✓" : "○"}</span>
              <strong>{row.label}</strong>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
