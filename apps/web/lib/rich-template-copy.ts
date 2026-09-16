import type { Locale } from "@/lib/i18n";

const copy = {
  en: {
    richTemplateTitle: "Submit a rich WhatsApp template for review",
    richTemplateDescription: "Build headers, media, buttons, and positional variables using Meta's component structure.",
    headerType: "Header type",
    none: "None",
    text: "Text",
    image: "Image",
    video: "Video",
    document: "Document",
    headerText: "Header text",
    mediaReviewHandle: "Meta media handle for review",
    headerExamples: "Header example values",
    requiredCount: "{count} required",
    buttons: "Buttons",
    addButton: "Add button",
    quickReply: "Quick reply",
    url: "URL",
    phone: "Phone",
    buttonLabel: "Button label",
    quickReplyPayloadHint: "The payload is mapped when the campaign is launched.",
    remove: "Remove",
    mediaMappedAtLaunch: "The media URL is mapped when the campaign is launched.",
    fixedParameter: "Fixed {type}",
    headerVariable: "Header {{index}}",
    bodyVariable: "Body {{index}}",
    mediaHeader: "{type} header URL",
    urlButtonVariable: "URL button {button} {{index}}",
    quickReplyPayload: "Quick reply {button} payload",
  },
  ar: {
    richTemplateTitle: "إرسال قالب واتساب غني للمراجعة",
    richTemplateDescription: "أنشئ الترويسات والوسائط والأزرار والمتغيرات الموضعية باستخدام بنية مكونات Meta.",
    headerType: "نوع الترويسة",
    none: "بدون",
    text: "نص",
    image: "صورة",
    video: "فيديو",
    document: "مستند",
    headerText: "نص الترويسة",
    mediaReviewHandle: "معرّف وسائط Meta للمراجعة",
    headerExamples: "قيم أمثلة الترويسة",
    requiredCount: "مطلوب {count}",
    buttons: "الأزرار",
    addButton: "إضافة زر",
    quickReply: "رد سريع",
    url: "رابط URL",
    phone: "هاتف",
    buttonLabel: "تسمية الزر",
    quickReplyPayloadHint: "تُحدَّد حمولة الرد عند إطلاق الحملة.",
    remove: "إزالة",
    mediaMappedAtLaunch: "يُحدَّد رابط الوسائط عند إطلاق الحملة.",
    fixedParameter: "{type} ثابت",
    headerVariable: "الترويسة {{index}}",
    bodyVariable: "المتن {{index}}",
    mediaHeader: "رابط ترويسة {type}",
    urlButtonVariable: "زر الرابط {button} {{index}}",
    quickReplyPayload: "حمولة الرد السريع {button}",
  },
} as const;

type RichTemplateCopyKey = keyof typeof copy.en;
export type RichTemplateCopy = { [Key in RichTemplateCopyKey]: string };

export function getRichTemplateCopy(locale: Locale): RichTemplateCopy {
  return copy[locale];
}

export function formatRichTemplateCopy(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => String(values[key] ?? match));
}
