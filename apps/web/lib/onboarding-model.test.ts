import { describe, expect, test } from "bun:test";
import { deriveOnboardingProgress, type OnboardingFacts } from "./onboarding-model";

const emptyFacts: OnboardingFacts = {
  emailVerified: true,
  workspaceConfigured: false,
  whatsappConnected: false,
  contactsImported: false,
  consentConfirmed: false,
  templateReady: false,
  audienceReady: false,
  testSent: false,
  campaignLaunched: false,
};

describe("deriveOnboardingProgress", () => {
  test("brand new organizations start incomplete and resume at workspace details", () => {
    const progress = deriveOnboardingProgress(emptyFacts);

    expect(progress.complete).toBe(false);
    expect(progress.dismissed).toBe(false);
    expect(progress.completedCount).toBe(0);
    expect(progress.nextStep).toBe("workspace");
    expect(progress.steps.every((step) => step.status === "incomplete")).toBe(true);
  });

  test("existing product records automatically complete matching steps", () => {
    const progress = deriveOnboardingProgress({
      ...emptyFacts,
      workspaceConfigured: true,
      whatsappConnected: true,
      contactsImported: true,
      templateReady: true,
      audienceReady: true,
    });

    for (const id of ["workspace", "whatsapp", "contacts", "template", "audience"] as const) {
      expect(progress.steps.find((step) => step.id === id)?.status).toBe("completed");
    }
    expect(progress.nextStep).toBe("consent");
  });

  test("only optional steps can be represented as skipped", () => {
    const progress = deriveOnboardingProgress({
      ...emptyFacts,
      consentConfirmed: true,
      skippedSteps: ["workspace", "test", "whatsapp"],
    });

    expect(progress.steps.find((step) => step.id === "workspace")?.status).toBe("skipped");
    expect(progress.steps.find((step) => step.id === "test")?.status).toBe("skipped");
    expect(progress.steps.find((step) => step.id === "whatsapp")?.status).toBe("incomplete");
    expect(progress.canFinish).toBe(true);
  });

  test("test sends and production campaigns remain separate milestones", () => {
    const progress = deriveOnboardingProgress({
      ...emptyFacts,
      consentConfirmed: true,
      testSent: true,
      campaignLaunched: false,
    });

    expect(progress.steps.find((step) => step.id === "test")?.status).toBe("completed");
    expect(progress.steps.find((step) => step.id === "campaign")?.status).toBe("incomplete");
  });

  test("automatic completion requires verified email and every unresolved required step", () => {
    const ready: OnboardingFacts = {
      emailVerified: true,
      workspaceConfigured: true,
      whatsappConnected: true,
      contactsImported: true,
      consentConfirmed: true,
      templateReady: true,
      audienceReady: true,
      testSent: false,
      campaignLaunched: true,
      skippedSteps: ["test"],
    };

    expect(deriveOnboardingProgress(ready).complete).toBe(true);
    expect(deriveOnboardingProgress({ ...ready, emailVerified: false }).complete).toBe(false);
  });

  test("manual completion and dismissal are persisted independently", () => {
    const completed = deriveOnboardingProgress({ ...emptyFacts, consentConfirmed: true, manuallyCompleted: true });
    const dismissed = deriveOnboardingProgress({ ...emptyFacts, consentConfirmed: true, dismissed: true });

    expect(completed.complete).toBe(true);
    expect(completed.dismissed).toBe(false);
    expect(dismissed.complete).toBe(false);
    expect(dismissed.dismissed).toBe(true);
  });
});
