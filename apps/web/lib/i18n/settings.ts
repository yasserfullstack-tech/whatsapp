import type { Locale } from "./index";

export const settingsNavMessages: Record<Locale, {
  aria: string;
  general: string;
  team: string;
  whatsapp: string;
  security: string;
  billing: string;
  data: string;
}> = {
  en: {
    aria: "Workspace settings",
    general: "General",
    team: "Team",
    whatsapp: "WhatsApp",
    security: "Security",
    billing: "Billing",
    data: "Data",
  },
  ar: {
    aria: "إعدادات مساحة العمل",
    general: "عام",
    team: "الفريق",
    whatsapp: "واتساب",
    security: "الأمان",
    billing: "الفوترة",
    data: "البيانات",
  },
};
