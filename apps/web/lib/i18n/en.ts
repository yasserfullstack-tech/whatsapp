export const en = {
  meta: {
    title: "WhatsApp Campaigns",
    description: "Multi-tenant WhatsApp marketing platform",
  },
  common: {
    language: "Language",
    english: "English",
    arabic: "Arabic",
    whatsapp: "WhatsApp",
    campaigns: "Campaigns",
    whatsappBusiness: "WhatsApp Business",
    optional: "optional",
    connected: "Connected",
    notConnected: "Not connected",
    cancel: "Cancel",
    saving: "Saving…",
    loading: "Loading…",
    meta: "Meta",
  },
  nav: {
    aria: "Primary navigation",
    overview: "Overview",
    contacts: "Contacts",
    audiences: "Audiences",
    templates: "Templates",
    campaigns: "Campaigns",
    reports: "Reports",
    settings: "Settings",
  },
  auth: {
    brandSubtitle: "Business messaging platform",
    welcomeBack: "Welcome back",
    signIn: "Sign in",
    signInDescription: "Manage WhatsApp connections, contacts, templates, and campaigns from one workspace.",
    getStarted: "Get started",
    createWorkspace: "Create your workspace",
    createWorkspaceDescription: "Your first workspace is created automatically. You can connect the business's own WhatsApp number next.",
    name: "Name",
    namePlaceholder: "Your name",
    email: "Email",
    emailPlaceholder: "you@company.com",
    password: "Password",
    passwordPlaceholder: "At least 10 characters",
    authenticationFailed: "Authentication failed",
    pleaseWait: "Please wait…",
    createAccount: "Create account",
    alreadyHaveAccount: "Already have an account?",
    newToPlatform: "New to the platform?",
  },
  signOut: {
    idle: "Sign out",
    pending: "Signing out…",
  },
  connect: {
    finishing: "Finishing WhatsApp connection…",
    connected: "WhatsApp connected",
    failed: "Could not connect WhatsApp",
    cancelled: "WhatsApp connection was cancelled.",
    openingMeta: "Opening Meta…",
    metaLoading: "Meta login is still loading. Try again in a moment.",
    noCode: "Meta did not return an authorization code.",
    authorized: "Meta authorized. Finishing setup…",
    button: "Connect WhatsApp",
    loadingMeta: "Loading Meta…",
  },
} as const;

export type Messages = {
  [K in keyof typeof en]: {
    [P in keyof (typeof en)[K]]: string;
  };
};
