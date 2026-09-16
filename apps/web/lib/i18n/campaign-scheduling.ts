import type { Locale } from "./index";

const en = {
  sendTiming: "Send timing",
  delivery: "Delivery",
  sendNow: "Send now",
  scheduleLater: "Schedule for later",
  scheduleTime: "Schedule time",
  workspaceTimezoneHint: "Scheduled times use the workspace timezone {timeZone}. Audience eligibility is snapshotted when dispatch starts, not when the schedule is created.",
  chooseScheduleTime: "Choose a schedule time",
  futureScheduleRequired: "Schedule time must be in the future",
  campaignScheduled: "Campaign scheduled for {date} ({timeZone}). Audience eligibility is snapshotted at dispatch.",
  scheduleForContacts: "Schedule for {count} contacts",
  scheduledHistory: "Scheduled for {date} ({timeZone}) · audience snapshots at dispatch",
  scheduledDetail: "Scheduled for {date} ({timeZone}). Audience eligibility will be snapshotted when dispatch starts.",
  campaignRescheduled: "Campaign rescheduled in {timeZone}.",
  rescheduling: "Rescheduling…",
  reschedule: "Reschedule",
} as const;

const ar: typeof en = {
  sendTiming: "توقيت الإرسال",
  delivery: "موعد الإرسال",
  sendNow: "إرسال الآن",
  scheduleLater: "جدولة لوقت لاحق",
  scheduleTime: "وقت الجدولة",
  workspaceTimezoneHint: "تستخدم الأوقات المجدولة المنطقة الزمنية لمساحة العمل {timeZone}. تُلتقط أهلية الجمهور عند بدء الإرسال، وليس عند إنشاء الجدولة.",
  chooseScheduleTime: "اختر وقتًا للجدولة",
  futureScheduleRequired: "يجب أن يكون وقت الجدولة في المستقبل",
  campaignScheduled: "تمت جدولة الحملة في {date} ({timeZone}). تُلتقط أهلية الجمهور عند بدء الإرسال.",
  scheduleForContacts: "جدولة لـ {count} جهة اتصال",
  scheduledHistory: "مجدولة في {date} ({timeZone}) · يتم تثبيت الجمهور عند بدء الإرسال",
  scheduledDetail: "مجدولة في {date} ({timeZone}). سيتم تثبيت أهلية الجمهور عند بدء الإرسال.",
  campaignRescheduled: "تمت إعادة جدولة الحملة ضمن {timeZone}.",
  rescheduling: "جارٍ إعادة الجدولة…",
  reschedule: "إعادة الجدولة",
};

export const campaignSchedulingMessages: Record<Locale, typeof en> = { en, ar };
