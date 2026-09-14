export const onboardingStepIds = [
  "workspace",
  "whatsapp",
  "contacts",
  "consent",
  "template",
  "audience",
  "test",
  "campaign",
] as const;

export type OnboardingStepId = (typeof onboardingStepIds)[number];
export type OnboardingStepStatus = "completed" | "skipped" | "incomplete";

export type OnboardingFacts = {
  emailVerified: boolean;
  workspaceConfigured: boolean;
  whatsappConnected: boolean;
  contactsImported: boolean;
  consentConfirmed: boolean;
  templateReady: boolean;
  audienceReady: boolean;
  testSent: boolean;
  campaignLaunched: boolean;
  skippedSteps?: string[];
  dismissed?: boolean;
  manuallyCompleted?: boolean;
};

export type OnboardingStepProgress = {
  id: OnboardingStepId;
  status: OnboardingStepStatus;
  optional: boolean;
  href: string;
};

export type OnboardingProgress = {
  emailVerified: boolean;
  consentConfirmed: boolean;
  dismissed: boolean;
  complete: boolean;
  canFinish: boolean;
  completedCount: number;
  totalSteps: number;
  nextStep: OnboardingStepId | null;
  steps: OnboardingStepProgress[];
};

const stepConfig: Array<{
  id: OnboardingStepId;
  optional: boolean;
  href: string;
  isComplete: (facts: OnboardingFacts) => boolean;
}> = [
  { id: "workspace", optional: true, href: "/settings/general", isComplete: (facts) => facts.workspaceConfigured },
  { id: "whatsapp", optional: false, href: "/settings/whatsapp", isComplete: (facts) => facts.whatsappConnected },
  { id: "contacts", optional: false, href: "/dashboard#contacts", isComplete: (facts) => facts.contactsImported },
  { id: "consent", optional: false, href: "/onboarding#consent", isComplete: (facts) => facts.consentConfirmed },
  { id: "template", optional: false, href: "/templates", isComplete: (facts) => facts.templateReady },
  { id: "audience", optional: false, href: "/audiences", isComplete: (facts) => facts.audienceReady },
  { id: "test", optional: true, href: "/campaigns?onboarding=test", isComplete: (facts) => facts.testSent },
  { id: "campaign", optional: false, href: "/campaigns", isComplete: (facts) => facts.campaignLaunched },
];

export function deriveOnboardingProgress(facts: OnboardingFacts): OnboardingProgress {
  const skipped = new Set(facts.skippedSteps ?? []);
  const steps = stepConfig.map<OnboardingStepProgress>((step) => {
    if (step.isComplete(facts)) return { id: step.id, status: "completed", optional: step.optional, href: step.href };
    if (step.optional && skipped.has(step.id)) return { id: step.id, status: "skipped", optional: true, href: step.href };
    return { id: step.id, status: "incomplete", optional: step.optional, href: step.href };
  });

  const allStepsResolved = steps.every((step) => step.status !== "incomplete");
  const complete = Boolean(facts.manuallyCompleted) || (facts.emailVerified && allStepsResolved);
  const completedCount = steps.filter((step) => step.status !== "incomplete").length;

  return {
    emailVerified: facts.emailVerified,
    consentConfirmed: facts.consentConfirmed,
    dismissed: Boolean(facts.dismissed),
    complete,
    canFinish: facts.consentConfirmed,
    completedCount,
    totalSteps: steps.length,
    nextStep: steps.find((step) => step.status === "incomplete")?.id ?? null,
    steps,
  };
}
