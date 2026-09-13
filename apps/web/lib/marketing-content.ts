import type { Locale } from "./i18n";

export const marketingSlugs = [
  "features",
  "pricing",
  "whatsapp",
  "security",
  "contact",
  "privacy",
  "terms",
  "acceptable-use",
  "anti-spam",
] as const;

export type MarketingSlug = (typeof marketingSlugs)[number];

type MarketingSection = {
  title: string;
  body: string;
  items?: string[];
};

type MarketingPage = {
  title: string;
  description: string;
  eyebrow: string;
  sections: MarketingSection[];
};

type MarketingCopy = {
  brand: string;
  nav: Record<"features" | "pricing" | "whatsapp" | "security" | "contact", string>;
  signIn: string;
  start: string;
  footer: {
    product: string;
    company: string;
    legal: string;
    note: string;
  };
  home: {
    eyebrow: string;
    title: string;
    description: string;
    primaryCta: string;
    secondaryCta: string;
    scaleNote: string;
    dashboardLabel: string;
    metrics: Array<{ label: string; value: string }>;
    featureTitle: string;
    featureIntro: string;
    features: Array<{ title: string; body: string }>;
    howTitle: string;
    how: Array<{ title: string; body: string }>;
    metaTitle: string;
    metaBody: string;
    trustTitle: string;
    trustBody: string;
    faqTitle: string;
    faqs: Array<{ question: string; answer: string }>;
    ctaTitle: string;
    ctaBody: string;
  };
  pages: Record<MarketingSlug, MarketingPage>;
};

const en: MarketingCopy = {
  brand: "WhatsApp Campaigns",
  nav: {
    features: "Features",
    pricing: "Pricing",
    whatsapp: "WhatsApp",
    security: "Security",
    contact: "Contact",
  },
  signIn: "Sign in",
  start: "Create account",
  footer: {
    product: "Product",
    company: "Company",
    legal: "Legal",
    note: "Built for permission-based WhatsApp messaging with direct Meta integration.",
  },
  home: {
    eyebrow: "WhatsApp campaign operations",
    title: "Run high-volume WhatsApp campaigns without turning your workflow into a spreadsheet project.",
    description:
      "Connect a business directly through Meta, organize opted-in contacts, build audiences, manage templates, launch campaigns, and monitor delivery from one workspace.",
    primaryCta: "Create your workspace",
    secondaryCta: "See how it works",
    scaleNote:
      "Designed for large campaign workloads, including use cases around 500,000 recipients. Actual throughput depends on Meta limits, sender quality, queue capacity, infrastructure sizing, and production load testing; we do not promise a fixed send time before those conditions are validated.",
    dashboardLabel: "Campaign operations overview",
    metrics: [
      { label: "Contacts", value: "500K-ready data model" },
      { label: "Connection", value: "Direct Meta signup" },
      { label: "Compliance", value: "Consent + suppression" },
      { label: "Delivery", value: "Queued + observable" },
    ],
    featureTitle: "One operational layer for the full campaign lifecycle",
    featureIntro:
      "The platform is structured around the work teams actually repeat: connect, import, segment, approve, send, observe, and suppress.",
    features: [
      { title: "Contacts", body: "Import opted-in contacts, keep consent context, search records, and maintain suppression state." },
      { title: "Audiences", body: "Build reusable segments and preview who qualifies before attaching an audience to a campaign." },
      { title: "Templates", body: "Synchronize approved WhatsApp templates and map campaign variables to contact data." },
      { title: "Campaigns", body: "Prepare large recipient sets for queued delivery with controls for campaign execution." },
      { title: "Analytics", body: "Track submitted, delivered, failed, and read outcomes as Meta status events arrive." },
      { title: "Consent controls", body: "Keep suppressed contacts out of sending workflows and retain a visible consent history." },
    ],
    howTitle: "How it works",
    how: [
      { title: "1. Connect WhatsApp", body: "Use Meta Embedded Signup to select the business, WABA, and phone number without copying API credentials into the UI." },
      { title: "2. Prepare the audience", body: "Import permissioned contacts, review consent state, and define reusable audience filters." },
      { title: "3. Launch and observe", body: "Choose an approved template, bind variables, enqueue recipients, then follow delivery outcomes." },
    ],
    metaTitle: "Direct Meta integration, not a shared sender pool",
    metaBody:
      "Each customer connects their own WhatsApp Business assets through Meta. Meta remains the identity and policy layer; the platform becomes the operational layer for contacts, audiences, templates, campaigns, queues, and reporting.",
    trustTitle: "Permission-first by design",
    trustBody:
      "Consent and suppression are first-class workflow data. The public security page only documents controls that exist in the product today and does not claim SOC 2, ISO 27001, penetration-test certification, or similar attestations unless they are actually obtained.",
    faqTitle: "Frequently asked questions",
    faqs: [
      { question: "Can it send to 500,000 recipients?", answer: "The architecture is being built for campaigns at that scale, but a recipient count is not a delivery-time guarantee. Meta throughput, quality limits, queue sizing, database load, worker count, and production tests determine real performance." },
      { question: "Do I paste Meta access tokens into the dashboard?", answer: "The intended onboarding path is Meta Embedded Signup, so normal customers select their business assets through Meta rather than copying credentials into the application." },
      { question: "How are opt-outs handled?", answer: "Suppression is part of the contact model and campaign eligibility workflow so suppressed contacts can be excluded from future sends." },
      { question: "Is this Meta or WhatsApp itself?", answer: "No. This is an independent campaign operations product that integrates with the WhatsApp Business Platform through Meta." },
    ],
    ctaTitle: "Build the campaign operation before you scale the send volume.",
    ctaBody: "Create a workspace, connect the business through Meta, and establish clean audience and consent workflows first.",
  },
  pages: {
    features: {
      eyebrow: "Product",
      title: "Features for repeatable WhatsApp campaign operations",
      description: "Contacts, audiences, templates, campaign execution, delivery analytics, and consent controls in one workspace.",
      sections: [
        { title: "Contacts and imports", body: "Bring in opted-in customer data through the import workflow, then search and manage contact eligibility.", items: ["Direct-to-object-storage upload flow", "Background import processing", "Consent and suppression state"] },
        { title: "Audiences", body: "Create reusable audience definitions instead of rebuilding recipient lists for every send.", items: ["Segment filters", "Audience preview", "Reusable recipient logic"] },
        { title: "Templates and campaigns", body: "Sync Meta-approved templates, bind variables, prepare recipients, and control campaign execution.", items: ["Template sync", "Variable bindings", "Queued campaign delivery", "Campaign controls"] },
        { title: "Analytics", body: "Operational reporting follows status updates from Meta so teams can understand submitted, delivered, failed, and read outcomes." },
      ],
    },
    pricing: {
      eyebrow: "Pricing",
      title: "Pricing that can grow with usage",
      description: "The commercial model is intentionally presented without invented launch prices. Final tiers should be tied to tested infrastructure costs, support needs, and Meta-related usage economics.",
      sections: [
        { title: "Launch", body: "For teams establishing their first connected WhatsApp operation.", items: ["Core contact and audience workflows", "Template management", "Campaign analytics"] },
        { title: "Growth", body: "For organizations running recurring campaigns and larger contact datasets.", items: ["Higher operational limits", "Expanded campaign capacity", "Priority support options"] },
        { title: "Scale", body: "For high-volume use cases that require validated capacity planning.", items: ["Infrastructure sizing review", "Queue and worker capacity planning", "Operational onboarding"] },
        { title: "Meta charges", body: "Any WhatsApp Business Platform charges, conversation/message pricing, or limits imposed by Meta are separate from this application's subscription and can change according to Meta's policies." },
      ],
    },
    whatsapp: {
      eyebrow: "WhatsApp Business Platform",
      title: "Connect the customer's own Meta business assets",
      description: "The product is designed around direct Meta onboarding rather than asking customers to operate through a shared WhatsApp sender.",
      sections: [
        { title: "Embedded Signup", body: "A customer signs in with Meta and chooses the relevant business, WhatsApp Business Account, and phone number." },
        { title: "Templates", body: "Approved WhatsApp templates are synchronized into the workspace for campaign use." },
        { title: "Webhooks", body: "Meta webhook events feed delivery state back into the platform. Incoming webhook signatures are validated by the current API implementation." },
        { title: "Platform boundaries", body: "Meta controls WhatsApp policy, sender quality, account status, and throughput eligibility. This application orchestrates the operational workflow around those constraints." },
      ],
    },
    security: {
      eyebrow: "Security & trust",
      title: "Security claims should match the controls that actually exist",
      description: "This page intentionally avoids certification language that the product has not earned.",
      sections: [
        { title: "Controls implemented in the current codebase", body: "The current application includes concrete security and isolation mechanisms.", items: ["Authentication and session handling through the application's auth layer", "Workspace membership and role context for organization-scoped access", "Meta webhook signature validation", "Consent and suppression workflows that prevent ineligible contacts from normal campaign selection"] },
        { title: "Credential handling", body: "The intended customer onboarding path is Meta Embedded Signup. Sensitive Meta credential storage is separated from normal contact and campaign records through the credentials package and server-side integration flow." },
        { title: "What we do not claim", body: "We do not claim SOC 2, ISO 27001, PCI certification, independent penetration-test certification, or any equivalent attestation unless and until that work is completed and documented." },
        { title: "Security roadmap", body: "Additional account hardening, browser security headers, throttling, MFA, and platform-admin controls are tracked separately and should only move onto this page after they are merged and verified in production." },
      ],
    },
    contact: {
      eyebrow: "Contact",
      title: "Talk to the team",
      description: "Sales and support contact details will be published here before public launch rather than inventing an address that is not yet configured.",
      sections: [
        { title: "Sales", body: "For pricing, volume planning, onboarding, and enterprise requirements, use the official sales channel once it is published." },
        { title: "Support", body: "Existing customers should use the support channel provided during onboarding." },
        { title: "Abuse and compliance", body: "A dedicated abuse/compliance contact should be published before launch so recipients and third parties can report misuse." },
      ],
    },
    privacy: {
      eyebrow: "Legal",
      title: "Privacy notice",
      description: "A launch-ready privacy notice must reflect the final legal entity, hosting regions, subprocessors, retention rules, and support contacts. This page currently documents the product-level principles without inventing missing company details.",
      sections: [
        { title: "Data handled by the service", body: "The product can process account information, organization membership, connected WhatsApp identifiers, contact records, consent/suppression information, templates, campaigns, delivery events, and operational logs." },
        { title: "Customer responsibilities", body: "Customers are responsible for having an appropriate legal basis and permission to upload contacts and send WhatsApp communications." },
        { title: "Service providers", body: "The production notice must list the actual infrastructure, storage, email, monitoring, and other subprocessors in use before launch." },
        { title: "Rights and requests", body: "The final policy must publish a real contact method for privacy requests and describe applicable access, correction, deletion, and objection rights by jurisdiction." },
      ],
    },
    terms: {
      eyebrow: "Legal",
      title: "Terms of service",
      description: "These product principles are a placeholder for counsel-reviewed launch terms and deliberately avoid fabricating a legal entity, governing law, or address.",
      sections: [
        { title: "Permitted use", body: "The service is intended for legitimate business messaging through properly authorized WhatsApp Business assets." },
        { title: "Customer obligations", body: "Customers must follow applicable law, Meta and WhatsApp policies, consent requirements, and the acceptable-use and anti-spam rules." },
        { title: "Service availability", body: "Availability and throughput depend partly on external providers including Meta and infrastructure vendors. Any contractual SLA must be separately documented and agreed." },
        { title: "Launch requirement", body: "Final terms should be reviewed by qualified counsel and completed with the actual contracting entity, payment terms, liability language, dispute terms, and jurisdiction before accepting public customers." },
      ],
    },
    "acceptable-use": {
      eyebrow: "Legal",
      title: "Acceptable use",
      description: "Use the platform for permission-based, lawful business messaging—not unsolicited bulk outreach or abuse.",
      sections: [
        { title: "Prohibited activity", body: "Do not use the service for unlawful content, fraud, harassment, phishing, credential theft, malware distribution, impersonation, or evasion of Meta/WhatsApp enforcement." },
        { title: "Messaging conduct", body: "Do not upload purchased or scraped lists, bypass opt-outs, conceal sender identity, or send messages to people who have not provided an appropriate basis for contact." },
        { title: "Enforcement", body: "Accounts may be limited or suspended when activity creates material abuse, compliance, security, or platform-policy risk." },
      ],
    },
    "anti-spam": {
      eyebrow: "Messaging policy",
      title: "Anti-spam policy",
      description: "Campaign scale does not change the consent requirement. Large sends must still be permission-based and respect recipient choices.",
      sections: [
        { title: "Permission first", body: "Only message recipients where the sender has the permission or other valid basis required by applicable rules and WhatsApp policy." },
        { title: "Honor opt-outs", body: "Suppressed or opted-out contacts must not be intentionally re-added to normal campaign eligibility without a documented, valid resubscription event." },
        { title: "No list buying or scraping", body: "Purchased, harvested, scraped, or otherwise unsolicited contact lists are not acceptable sources for campaign recipients." },
        { title: "Monitor quality", body: "Teams should monitor failures, blocks, complaints, and Meta quality signals and stop campaigns when signals indicate recipient harm or policy risk." },
      ],
    },
  },
};

const ar: MarketingCopy = {
  brand: "حملات واتساب",
  nav: { features: "الميزات", pricing: "الأسعار", whatsapp: "واتساب", security: "الأمان", contact: "تواصل معنا" },
  signIn: "تسجيل الدخول",
  start: "إنشاء حساب",
  footer: { product: "المنتج", company: "الشركة", legal: "قانوني", note: "منصة لإدارة رسائل واتساب المبنية على الموافقة مع تكامل مباشر مع Meta." },
  home: {
    eyebrow: "تشغيل حملات واتساب",
    title: "أدِر حملات واتساب كبيرة بدون تحويل العمل اليومي إلى مشروع جداول بيانات.",
    description: "اربط نشاط العميل مباشرة عبر Meta، ونظّم جهات الاتصال الموافق عليها، وابنِ الشرائح، وأدِر القوالب والحملات ونتائج التسليم من مساحة عمل واحدة.",
    primaryCta: "أنشئ مساحة عمل",
    secondaryCta: "كيف تعمل المنصة",
    scaleNote: "تم تصميم البنية لدعم أحجام حملات كبيرة، بما فيها حالات استخدام تقارب 500 ألف مستلم. لكن سرعة الإرسال الفعلية تعتمد على حدود Meta وجودة المرسل وسعة الطوابير وحجم البنية واختبارات الحمل الإنتاجية؛ لذلك لا نَعِد بزمن إرسال ثابت قبل التحقق من هذه العوامل.",
    dashboardLabel: "نظرة عامة على تشغيل الحملات",
    metrics: [
      { label: "جهات الاتصال", value: "نموذج بيانات واسع النطاق" },
      { label: "الربط", value: "تسجيل مباشر عبر Meta" },
      { label: "الامتثال", value: "موافقة + استبعاد" },
      { label: "التسليم", value: "طوابير + مراقبة" },
    ],
    featureTitle: "طبقة تشغيل واحدة لدورة الحملة كاملة",
    featureIntro: "المنصة مبنية حول خطوات العمل المتكررة فعلياً: الربط، الاستيراد، التقسيم، الاعتماد، الإرسال، المراقبة والاستبعاد.",
    features: [
      { title: "جهات الاتصال", body: "استورد جهات اتصال لديها موافقة، واحتفظ بسياق الموافقة وحالة الاستبعاد." },
      { title: "الشرائح", body: "أنشئ جماهير قابلة لإعادة الاستخدام وعاين المستلمين قبل ربطهم بالحملة." },
      { title: "القوالب", body: "زامن قوالب واتساب المعتمدة واربط متغيرات الحملة ببيانات جهات الاتصال." },
      { title: "الحملات", body: "حضّر مجموعات مستلمين كبيرة للإرسال عبر الطوابير مع أدوات للتحكم بالتنفيذ." },
      { title: "التحليلات", body: "تابع حالات الإرسال والتسليم والفشل والقراءة عند وصول تحديثات Meta." },
      { title: "الموافقة والاستبعاد", body: "أبقِ جهات الاتصال المستبعدة خارج الإرسال واحتفظ بسجل واضح لتغييرات الموافقة." },
    ],
    howTitle: "كيف تعمل",
    how: [
      { title: "1. اربط واتساب", body: "استخدم Meta Embedded Signup لاختيار النشاط وحساب واتساب للأعمال والرقم بدون نسخ مفاتيح API داخل الواجهة." },
      { title: "2. جهّز الجمهور", body: "استورد جهات اتصال مسموحاً بمراسلتها، وراجع حالة الموافقة، وابنِ فلاتر قابلة لإعادة الاستخدام." },
      { title: "3. أطلق وراقب", body: "اختر قالباً معتمداً واربط المتغيرات وأدخل المستلمين إلى الطابور ثم تابع نتائج التسليم." },
    ],
    metaTitle: "تكامل مباشر مع Meta، وليس مجموعة أرقام إرسال مشتركة",
    metaBody: "يربط كل عميل أصول واتساب للأعمال الخاصة به عبر Meta. تبقى Meta طبقة الهوية والسياسات، بينما تدير المنصة جهات الاتصال والجماهير والقوالب والحملات والطوابير والتقارير.",
    trustTitle: "الموافقة جزء أساسي من التصميم",
    trustBody: "الموافقة والاستبعاد بيانات تشغيل أساسية. صفحة الأمان العامة توثّق فقط الضوابط الموجودة فعلاً، ولا تدّعي SOC 2 أو ISO 27001 أو شهادة اختبار اختراق ما لم يتم الحصول عليها فعلياً.",
    faqTitle: "الأسئلة الشائعة",
    faqs: [
      { question: "هل يمكن الإرسال إلى 500 ألف مستلم؟", answer: "البنية تُطوّر لهذا المستوى من الحملات، لكن عدد المستلمين ليس وعداً بزمن تسليم. حدود Meta وجودة الرقم وسعة الطابور وقاعدة البيانات وعدد العمال واختبارات الإنتاج هي التي تحدد الأداء الفعلي." },
      { question: "هل أنسخ رموز وصول Meta داخل لوحة التحكم؟", answer: "مسار الربط المقصود هو Meta Embedded Signup، بحيث يختار العميل أصول نشاطه عبر Meta بدلاً من نسخ بيانات الاعتماد إلى التطبيق." },
      { question: "كيف يتم التعامل مع إلغاء الاشتراك؟", answer: "الاستبعاد جزء من نموذج جهة الاتصال ومن منطق أهلية الحملة حتى يمكن منع المستبعدين من الإرسال مستقبلاً." },
      { question: "هل هذه المنصة تابعة لـ Meta أو واتساب؟", answer: "لا. هذا منتج مستقل لإدارة عمليات الحملات ويتكامل مع WhatsApp Business Platform عبر Meta." },
    ],
    ctaTitle: "ابنِ عملية الحملة بشكل صحيح قبل رفع حجم الإرسال.",
    ctaBody: "أنشئ مساحة عمل، واربط النشاط عبر Meta، وثبّت قواعد الجمهور والموافقة أولاً.",
  },
  pages: {
    features: { eyebrow: "المنتج", title: "ميزات لإدارة حملات واتساب بشكل قابل للتكرار", description: "جهات اتصال وجماهير وقوالب وتنفيذ حملات وتحليلات تسليم وضوابط موافقة في مساحة عمل واحدة.", sections: [
      { title: "جهات الاتصال والاستيراد", body: "استورد بيانات العملاء المسموح بمراسلتهم ثم ابحث في السجلات وأدِر أهلية الإرسال.", items: ["رفع مباشر إلى تخزين الكائنات", "معالجة الاستيراد في الخلفية", "حالة الموافقة والاستبعاد"] },
      { title: "الجماهير", body: "أنشئ تعريفات قابلة لإعادة الاستخدام بدلاً من إعادة بناء قوائم المستلمين في كل حملة.", items: ["فلاتر الشرائح", "معاينة الجمهور", "منطق مستلمين قابل لإعادة الاستخدام"] },
      { title: "القوالب والحملات", body: "زامن قوالب Meta المعتمدة واربط المتغيرات وجهّز المستلمين وتحكم بتنفيذ الحملة.", items: ["مزامنة القوالب", "ربط المتغيرات", "إرسال عبر الطوابير", "أدوات تحكم بالحملة"] },
      { title: "التحليلات", body: "تعتمد التقارير التشغيلية على تحديثات الحالة القادمة من Meta لمتابعة المرسل والمسلّم والفاشل والمقروء." },
    ] },
    pricing: { eyebrow: "الأسعار", title: "تسعير ينمو مع الاستخدام", description: "لا نضع أسعار إطلاق افتراضية قبل ربطها بتكلفة البنية والدعم واقتصاديات الاستخدام الفعلية.", sections: [
      { title: "Launch", body: "للفرق التي تبدأ أول عملية واتساب متصلة.", items: ["جهات الاتصال والجماهير", "إدارة القوالب", "تحليلات الحملات"] },
      { title: "Growth", body: "للمؤسسات التي تشغّل حملات متكررة وبيانات أكبر.", items: ["حدود تشغيل أعلى", "سعة حملات موسعة", "خيارات دعم متقدمة"] },
      { title: "Scale", body: "لحالات الاستخدام عالية الحجم التي تحتاج تخطيط سعة موثّقاً.", items: ["مراجعة حجم البنية", "تخطيط الطوابير والعمال", "تهيئة تشغيلية"] },
      { title: "رسوم Meta", body: "أي رسوم أو سياسات تسعير أو حدود تفرضها WhatsApp Business Platform منفصلة عن اشتراك هذا التطبيق وقد تتغير وفق سياسات Meta." },
    ] },
    whatsapp: { eyebrow: "WhatsApp Business Platform", title: "اربط أصول Meta الخاصة بالعميل", description: "المنتج مبني على ربط مباشر مع Meta وليس على رقم واتساب مشترك بين العملاء.", sections: [
      { title: "Embedded Signup", body: "يسجل العميل الدخول لدى Meta ويختار النشاط وحساب واتساب للأعمال والرقم المناسب." },
      { title: "القوالب", body: "تتم مزامنة قوالب واتساب المعتمدة إلى مساحة العمل لاستخدامها في الحملات." },
      { title: "Webhooks", body: "تعيد أحداث Meta حالات التسليم إلى المنصة، والتنفيذ الحالي للـ API يتحقق من توقيع Webhook الوارد." },
      { title: "حدود المنصة", body: "تتحكم Meta في سياسات واتساب وجودة المرسل وحالة الحساب وأهلية معدل الإرسال، بينما تنظم هذه المنصة سير العمل حول تلك القيود." },
    ] },
    security: { eyebrow: "الأمان والثقة", title: "ادعاءات الأمان يجب أن تطابق الضوابط الموجودة فعلاً", description: "هذه الصفحة تتجنب عمداً أي ادعاء بشهادات لم يحصل عليها المنتج.", sections: [
      { title: "ضوابط موجودة في الكود الحالي", body: "يتضمن التطبيق الحالي ضوابط أمن وعزل ملموسة.", items: ["مصادقة وإدارة جلسات عبر طبقة المصادقة", "عضوية وأدوار لمساحات العمل لتقييد الوصول حسب المؤسسة", "التحقق من توقيع Meta Webhook", "تدفقات موافقة واستبعاد تمنع غير المؤهلين من الاختيار الطبيعي للحملات"] },
      { title: "التعامل مع بيانات الاعتماد", body: "مسار الربط المقصود هو Meta Embedded Signup، مع فصل بيانات اعتماد Meta الحساسة عن سجلات جهات الاتصال والحملات العادية عبر حزمة الاعتمادات وتدفق الخادم." },
      { title: "ما لا ندّعيه", body: "لا ندّعي SOC 2 أو ISO 27001 أو PCI أو شهادة اختبار اختراق مستقلة ما لم يتم إكمال ذلك وتوثيقه فعلياً." },
      { title: "خارطة الأمان", body: "تقوية الحسابات وترويسات أمان المتصفح وتحديد المعدل وMFA وضوابط إدارة المنصة تُنفّذ في مسارات منفصلة ولا تُضاف هنا إلا بعد دمجها والتحقق منها." },
    ] },
    contact: { eyebrow: "تواصل معنا", title: "تحدث مع الفريق", description: "سيتم نشر معلومات الاتصال الرسمية قبل الإطلاق العام بدلاً من اختراع عنوان غير مهيأ بعد.", sections: [
      { title: "المبيعات", body: "للتسعير وتخطيط الحجم والتهيئة والمتطلبات المؤسسية، استخدم قناة المبيعات الرسمية عند نشرها." },
      { title: "الدعم", body: "على العملاء الحاليين استخدام قناة الدعم التي تم تزويدهم بها أثناء التهيئة." },
      { title: "الإساءة والامتثال", body: "يجب نشر قناة مخصصة للإبلاغ عن الإساءة أو المخالفات قبل الإطلاق." },
    ] },
    privacy: { eyebrow: "قانوني", title: "إشعار الخصوصية", description: "يجب أن تعكس سياسة الإطلاق الكيان القانوني ومناطق الاستضافة والمعالجين الفرعيين وفترات الاحتفاظ وقنوات التواصل الفعلية. توثق هذه الصفحة حالياً مبادئ المنتج دون اختراع تفاصيل غير موجودة.", sections: [
      { title: "البيانات التي تعالجها الخدمة", body: "قد تعالج المنصة بيانات الحساب والعضوية وأصول واتساب المتصلة وجهات الاتصال والموافقة والاستبعاد والقوالب والحملات وأحداث التسليم والسجلات التشغيلية." },
      { title: "مسؤولية العميل", body: "العميل مسؤول عن وجود أساس قانوني مناسب وصلاحية رفع جهات الاتصال وإرسال رسائل واتساب إليها." },
      { title: "مقدمو الخدمة", body: "يجب أن تسرد سياسة الإنتاج مزودي البنية والتخزين والبريد والمراقبة وأي معالجين فرعيين فعليين قبل الإطلاق." },
      { title: "الحقوق والطلبات", body: "يجب أن تنشر السياسة النهائية قناة حقيقية لطلبات الخصوصية وتوضح الحقوق المطبقة حسب الولاية القضائية." },
    ] },
    terms: { eyebrow: "قانوني", title: "شروط الخدمة", description: "هذه مبادئ منتج تمهيدية وليست بديلاً عن شروط إطلاق يراجعها مستشار قانوني، ولا نخترع فيها كياناً قانونياً أو قانوناً حاكماً أو عنواناً.", sections: [
      { title: "الاستخدام المسموح", body: "الخدمة مخصصة لرسائل أعمال مشروعة عبر أصول WhatsApp Business مخوّلة بصورة صحيحة." },
      { title: "التزامات العميل", body: "يجب اتباع القوانين وسياسات Meta وWhatsApp ومتطلبات الموافقة وسياسات الاستخدام المقبول ومكافحة الرسائل المزعجة." },
      { title: "توفر الخدمة", body: "التوفر ومعدل الإرسال يعتمدان جزئياً على مزودين خارجيين مثل Meta ومزودي البنية. أي SLA تعاقدي يجب أن يوثق ويُتفق عليه بصورة مستقلة." },
      { title: "متطلب ما قبل الإطلاق", body: "يجب استكمال الشروط النهائية بالكيان المتعاقد وشروط الدفع والمسؤولية وتسوية النزاعات والاختصاص بعد مراجعة قانونية مؤهلة." },
    ] },
    "acceptable-use": { eyebrow: "قانوني", title: "سياسة الاستخدام المقبول", description: "استخدم المنصة لرسائل أعمال قانونية مبنية على الموافقة، وليس للرسائل الجماعية غير المرغوب فيها أو إساءة الاستخدام.", sections: [
      { title: "أنشطة محظورة", body: "يُمنع استخدام الخدمة للمحتوى غير القانوني أو الاحتيال أو المضايقة أو التصيد أو سرقة بيانات الدخول أو البرمجيات الضارة أو انتحال الهوية أو التحايل على إنفاذ سياسات Meta وWhatsApp." },
      { title: "سلوك الإرسال", body: "لا ترفع قوائم مشتراة أو مسروقة من الويب، ولا تتجاوز الانسحابات، ولا تخفِ هوية المرسل، ولا تراسل أشخاصاً دون أساس مناسب." },
      { title: "الإنفاذ", body: "قد يتم تقييد الحسابات أو تعليقها عندما يخلق النشاط مخاطر جوهرية تتعلق بالإساءة أو الامتثال أو الأمان أو سياسات المنصة." },
    ] },
    "anti-spam": { eyebrow: "سياسة الرسائل", title: "سياسة مكافحة الرسائل المزعجة", description: "حجم الحملة لا يلغي شرط الموافقة. حتى الإرسال الكبير يجب أن يكون بإذن ويحترم اختيار المستلم.", sections: [
      { title: "الموافقة أولاً", body: "لا تراسل إلا المستلمين الذين يتوفر للمرسل أساس مناسب لمراسلتهم وفق القواعد المطبقة وسياسة واتساب." },
      { title: "احترم الانسحاب", body: "يجب ألا تُعاد جهة اتصال مستبعدة عمداً إلى أهلية الحملات العادية دون حدث إعادة اشتراك صالح وموثق." },
      { title: "لا لشراء القوائم أو جمعها آلياً", body: "القوائم المشتراة أو المجمعة أو المسروقة من الويب ليست مصدراً مقبولاً لمستلمي الحملات." },
      { title: "راقب الجودة", body: "يجب مراقبة الفشل والحظر والشكاوى وإشارات الجودة لدى Meta وإيقاف الحملات عندما تشير المؤشرات إلى ضرر أو خطر سياسة." },
    ] },
  },
};

export function getMarketingCopy(locale: Locale): MarketingCopy {
  return locale === "ar" ? ar : en;
}

export function isMarketingSlug(value: string): value is MarketingSlug {
  return (marketingSlugs as readonly string[]).includes(value);
}
