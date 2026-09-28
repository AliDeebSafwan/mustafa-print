import type { Locale } from "@mpe/shared";

/** Shown on both pages. Change it whenever the text below changes in substance. */
export const LEGAL_UPDATED = "2026-09-27";

export interface LegalFacts { name: string; address: string | null; email: string | null; phone: string | null; contactPath: string }
export interface LegalSection { title: string; paragraphs: string[] }

/**
 * Every statement here describes what this system actually does — checked against the code, not copied from a
 * template. If a feature changes (a new tracker, a new data processor), this text must change with it.
 * The shop's identity is never written here: it comes from settings, so the owner can change it at any time.
 */
const contact = (f: LegalFacts, lang: Locale): string => {
  const ways = [f.email, f.phone].filter(Boolean).join(lang === "ar" ? " أو " : " or ");
  return ways || (lang === "ar" ? "عبر صفحة التواصل" : "through the contact page");
};
const where = (f: LegalFacts, lang: Locale): string => (f.address ? (lang === "ar" ? `، ومقرّها: ${f.address}` : `, located at ${f.address}`) : "");

export function privacyPolicy(f: LegalFacts, lang: Locale): LegalSection[] {
  if (lang === "en") return [
    { title: "Who we are", paragraphs: [`This website and its ordering service are operated by ${f.name}${where(f, lang)}. For anything about your data, contact us ${contact(f, lang)}.`] },
    { title: "What we collect", paragraphs: [
      "When you create an account or order: your name, email, phone number, and for delivery your address and city.",
      "What you order: the products, quantities, notes, and the design files you upload.",
      "When you approve or reject a proof: your decision, any comment, the time, the proof version and a fingerprint of the exact file you saw, and your browser's identifier. We keep this as a record of what was agreed.",
      "Payments: the amount, the method (cash at pickup or on delivery) and when it was paid. We never receive or store card numbers.",
      "Your password is stored only as a one-way cryptographic hash; nobody at the shop can read it.",
    ] },
    { title: "What we do not do", paragraphs: [
      "No advertising, no analytics or tracking tools, and no third-party cookies. The only cookie is the one that keeps you signed in to your account.",
      "We never sell your data or share it for marketing.",
    ] },
    { title: "Why we use it", paragraphs: ["To prepare, deliver and invoice your orders; to contact you about them; to keep accounting records the law requires; and to protect the service from abuse."] },
    { title: "Messages", paragraphs: ["We send order updates by WhatsApp, SMS or email only on the channels you agreed to. You can withdraw that agreement at any time by contacting us; messages that are strictly necessary for an order you placed (such as confirming your email) may still be sent."] },
    { title: "Who else sees it", paragraphs: [
      "Only the service providers needed to run the service: the company hosting our servers, the provider that sends our emails, WhatsApp (Meta) when you receive WhatsApp messages, and the courier delivering your order, who sees your name, phone and address.",
      "Within the shop, each staff member sees only what their role requires.",
    ] },
    { title: "How long we keep it", paragraphs: ["We keep order and invoice records for as long as accounting and tax law requires. You can ask us to close and delete your account at any time; records we are legally required to keep (such as issued invoices) are retained but no longer used for anything else."] },
    { title: "Security", paragraphs: ["All connections are encrypted (HTTPS). Access inside the shop is limited by role, and sensitive actions are recorded in an audit log. No system is perfectly secure; if a breach affecting your data occurred, we would inform you."] },
    { title: "Your rights", paragraphs: [`You may ask to see the data we hold about you, correct it, delete your account, or withdraw your consent to messages. Contact us ${contact(f, lang)}; we answer within a reasonable time.`] },
    { title: "Law", paragraphs: ["We handle personal data in line with the Lebanese laws in force, including Law No. 81 of 2018 on electronic transactions and personal data."] },
    { title: "Changes", paragraphs: ["If we change this policy we update the date at the top of this page. Significant changes are announced on the website."] },
  ];
  return [
    { title: "من نحن", paragraphs: [`يدير هذا الموقع وخدمة الطلب عبره ${f.name}${where(f, lang)}. لأي أمر يتعلق ببياناتك، تواصل معنا ${contact(f, lang)}.`] },
    { title: "ما نجمعه", paragraphs: [
      "عند إنشاء حساب أو طلب: اسمك وبريدك الإلكتروني ورقم هاتفك، وللتوصيل عنوانك ومدينتك.",
      "ما تطلبه: المنتجات والكميات والملاحظات، وملفات التصميم التي ترفعها.",
      "عند موافقتك على بروفة أو طلبك تعديلاً: قرارك وتعليقك إن وُجد، والوقت، ورقم إصدار البروفة، وبصمة الملف نفسه الذي رأيته، ومعرّف متصفحك. نحتفظ بها سجلاً لما اتُّفق عليه.",
      "المدفوعات: المبلغ والطريقة (نقداً عند الاستلام أو عند التوصيل) ووقت الدفع. لا نستلم أرقام بطاقات ولا نخزنها أبداً.",
      "كلمة سرّك تُخزَّن مشفّرة بطريقة لا تُعكس، فلا يستطيع أحد في المطبعة قراءتها.",
    ] },
    { title: "ما لا نفعله", paragraphs: [
      "لا إعلانات، ولا أدوات تحليل أو تتبّع، ولا ملفات تعريف ارتباط (كوكيز) لجهات أخرى. الملف الوحيد هو الذي يُبقيك مسجّل الدخول في حسابك.",
      "لا نبيع بياناتك ولا نشاركها لأغراض تسويقية أبداً.",
    ] },
    { title: "لماذا نستعملها", paragraphs: ["لتنفيذ طلباتك وتوصيلها وإصدار فواتيرها، وللتواصل معك بشأنها، وللاحتفاظ بالسجلات المحاسبية التي يفرضها القانون، ولحماية الخدمة من إساءة الاستعمال."] },
    { title: "الرسائل", paragraphs: ["نرسل تحديثات طلبك عبر واتساب أو الرسائل النصية أو البريد الإلكتروني، فقط على الوسائل التي وافقتَ عليها. تستطيع سحب موافقتك في أي وقت بالتواصل معنا، مع العلم أن الرسائل الضرورية لطلب قدّمتَه (كتأكيد بريدك) قد تُرسل مع ذلك."] },
    { title: "من يطّلع عليها", paragraphs: [
      "مزوّدو الخدمة الضروريون لتشغيلها فقط: الشركة المستضيفة لخوادمنا، ومزوّد إرسال البريد الإلكتروني، وواتساب (Meta) حين تصلك رسائل واتساب، والمندوب الذي يوصل طلبك فيرى اسمك وهاتفك وعنوانك.",
      "داخل المطبعة، يرى كل موظف ما يحتاجه دوره فقط.",
    ] },
    { title: "مدة الاحتفاظ", paragraphs: ["نحتفظ بسجلات الطلبات والفواتير المدة التي يفرضها قانون المحاسبة والضرائب. تستطيع طلب إغلاق حسابك وحذفه في أي وقت؛ السجلات التي يُلزمنا القانون بحفظها (كالفواتير الصادرة) تبقى محفوظة ولا تُستعمل لأي غرض آخر."] },
    { title: "الأمان", paragraphs: ["كل الاتصالات مشفّرة (HTTPS). الوصول داخل المطبعة محصور بالدور، والإجراءات الحساسة مسجّلة في سجل تدقيق. لا نظام آمن تماماً؛ وإن وقع اختراق يمسّ بياناتك فسنُعلمك."] },
    { title: "حقوقك", paragraphs: [`لك أن تطلب الاطلاع على بياناتك لدينا، أو تصحيحها، أو حذف حسابك، أو سحب موافقتك على الرسائل. تواصل معنا ${contact(f, lang)}، ونجيب خلال مدة معقولة.`] },
    { title: "القانون", paragraphs: ["نتعامل مع البيانات الشخصية وفق القوانين اللبنانية النافذة، ومنها القانون رقم 81 لعام 2018 المتعلق بالمعاملات الإلكترونية والبيانات ذات الطابع الشخصي."] },
    { title: "التعديلات", paragraphs: ["إن عدّلنا هذه السياسة نحدّث التاريخ في أعلى الصفحة، ونعلن التعديلات الجوهرية على الموقع."] },
  ];
}

export function termsOfUse(f: LegalFacts, lang: Locale): LegalSection[] {
  if (lang === "en") return [
    { title: "About these terms", paragraphs: [`These terms govern ordering from ${f.name}${where(f, lang)} through this website. Placing an order means you accept them. Questions: ${contact(f, lang)}.`] },
    { title: "Your account", paragraphs: ["Give accurate details and confirm your email before ordering. Keep your password to yourself; you are responsible for orders placed from your account. We may suspend an account used abusively."] },
    { title: "Orders and prices", paragraphs: [
      "The price of an order is confirmed when we receive it. For delivery, the shop sets the delivery fee and tells you before the order is confirmed.",
      "A quote is valid until the date shown on it; accepting it creates an order at exactly the quoted prices.",
      "If a price shown on the website is clearly wrong, we contact you before going ahead, and you may cancel.",
    ] },
    { title: "Payment", paragraphs: ["Payment is in cash when you collect the order or on delivery. For some orders a deposit may be asked before printing starts; you will be told the amount."] },
    { title: "Your designs and proofs", paragraphs: [
      "You confirm that you own, or have permission to use, everything you send us to print. We may refuse content that is illegal or infringes someone else's rights.",
      "When we send a proof, check it carefully: text, spelling, colours and sizes. Once you approve it, we print it as approved, and errors in approved content are not the shop's responsibility. Your approval is recorded with its time and the exact file version.",
      "Colours can look slightly different on screen and on paper; this is normal in printing and is not a defect.",
    ] },
    { title: "Changes and cancellation", paragraphs: ["You may change or cancel an order free of charge until printing starts. After that, the cost of work already done may be charged. Printed items made to your specification cannot be returned unless the fault is ours."] },
    { title: "If something is wrong", paragraphs: ["If you receive an item with a printing fault caused by us, tell us as soon as you notice it and before using the item. We will reprint it or refund the affected part."] },
    { title: "Our responsibility", paragraphs: ["Our responsibility for an order is limited to its value. We are not responsible for delays caused by circumstances outside our control."] },
    { title: "Law", paragraphs: ["These terms are governed by Lebanese law, and the competent Lebanese courts have jurisdiction."] },
    { title: "Changes to these terms", paragraphs: ["We may update these terms; the date at the top shows the current version. Orders already placed follow the terms in force when they were placed."] },
  ];
  return [
    { title: "عن هذه الشروط", paragraphs: [`تنظّم هذه الشروط الطلب من ${f.name}${where(f, lang)} عبر هذا الموقع. تقديمك طلباً يعني قبولك بها. للاستفسار: ${contact(f, lang)}.`] },
    { title: "حسابك", paragraphs: ["أدخل بيانات صحيحة وأكّد بريدك قبل الطلب. احتفظ بكلمة سرّك لنفسك؛ فأنت مسؤول عن الطلبات المقدّمة من حسابك. يحق لنا تعطيل حساب يُساء استعماله."] },
    { title: "الطلبات والأسعار", paragraphs: [
      "يُثبَّت سعر الطلب عند استلامنا له. للتوصيل، تحدد المطبعة أجرة التوصيل وتُعلمك بها قبل تأكيد الطلب.",
      "عرض السعر صالح حتى التاريخ المذكور فيه، وقبوله ينشئ طلباً بالأسعار الواردة فيه نفسها.",
      "إن ظهر على الموقع سعر خاطئ بوضوح، نتواصل معك قبل المتابعة، ولك أن تلغي الطلب.",
    ] },
    { title: "الدفع", paragraphs: ["الدفع نقداً عند استلام الطلب من المطبعة أو عند التوصيل. قد يُطلب في بعض الطلبات عربون قبل بدء الطباعة، ونُعلمك بقيمته."] },
    { title: "تصاميمك والبروفات", paragraphs: [
      "تؤكد أنك تملك كل ما ترسله للطباعة أو لديك إذن باستعماله. يحق لنا رفض أي محتوى مخالف للقانون أو يمسّ حقوق غيرك.",
      "حين نرسل لك بروفة، راجعها جيداً: النصوص والإملاء والألوان والمقاسات. بعد موافقتك نطبعها كما وافقتَ عليها، ولا تتحمل المطبعة الأخطاء الواردة في المحتوى الموافَق عليه. تُسجَّل موافقتك مع وقتها وإصدار الملف نفسه.",
      "قد تختلف الألوان قليلاً بين الشاشة والورق؛ هذا طبيعي في الطباعة ولا يُعدّ عيباً.",
    ] },
    { title: "التعديل والإلغاء", paragraphs: ["تستطيع تعديل الطلب أو إلغاءه مجاناً حتى بدء الطباعة. بعدها، قد تُحتسب كلفة العمل المنجز. المطبوعات المصنوعة حسب طلبك لا تُرَدّ إلا إذا كان العيب منّا."] },
    { title: "إن وُجد عيب", paragraphs: ["إن استلمتَ مطبوعاً فيه عيب طباعة سببه نحن، أخبرنا فور ملاحظته وقبل استعماله، فنعيد طباعته أو نردّ قيمة الجزء المعيب."] },
    { title: "مسؤوليتنا", paragraphs: ["تقتصر مسؤوليتنا عن أي طلب على قيمته. ولا نتحمل التأخير الناتج عن ظروف خارجة عن إرادتنا."] },
    { title: "القانون", paragraphs: ["تخضع هذه الشروط للقانون اللبناني، وتختص بالنظر في أي نزاع المحاكم اللبنانية المختصة."] },
    { title: "تعديل الشروط", paragraphs: ["قد نحدّث هذه الشروط، والتاريخ في أعلى الصفحة يدل على النسخة النافذة. الطلبات المقدّمة سابقاً تخضع للشروط التي كانت نافذة عند تقديمها."] },
  ];
}
