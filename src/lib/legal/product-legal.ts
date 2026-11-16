import type { LanguagePreference } from '@/lib/preferences/app-preferences';
import { INVESTATLAS_PUBLIC_REPOSITORY_URL } from '@/lib/product-links';
import { personalMarketDisclosure } from './personal-market-disclosure';

export type LegalDocumentKind = 'terms' | 'privacy' | 'financial-data';

type LegalLink = {
  linkText: string;
  url: string;
};

type LegalSection = {
  sectionName: string;
  blocks: string[];
  bulletItems?: string[];
  links?: LegalLink[];
};

export type LegalDocument = {
  documentTitle: string;
  summaryText: string;
  lastUpdatedText: string;
  backText: string;
  relatedText: string;
  demoLabel: string;
  sections: LegalSection[];
};

const UPDATED = '7 November 2026';
const UPDATED_AR = '7 نوفمبر 2026';
const UPDATED_DE = '7. November 2026';

const EN_DOCUMENTS: Record<LegalDocumentKind, LegalDocument> = {
  terms: {
    documentTitle: 'Terms of Service',
    summaryText: 'These terms govern use of the public InvestAtlas Demo and its Local and Cloud Workspaces.',
    lastUpdatedText: `Last updated: ${UPDATED}`,
    backText: 'Back to InvestAtlas',
    relatedText: 'Related information',
    demoLabel: 'Public Demo',
    sections: [
      {
        sectionName: '1. Operator and agreement',
        blocks: [
          'InvestAtlas is a non-commercial public Demo operated by Haider Hamad. By creating an account, continuing with Google, or using the Demo after being shown these terms, you agree to them. If you do not agree, do not use InvestAtlas.',
          'Questions can be directed through the linked public InvestAtlas repository or the operator’s LinkedIn profile. These public channels must not be used to post passwords, API keys, portfolio details, or other sensitive information.',
        ],
        links: [
          { linkText: 'InvestAtlas on GitHub', url: INVESTATLAS_PUBLIC_REPOSITORY_URL },
          { linkText: 'Contact the operator on LinkedIn', url: 'https://www.linkedin.com/in/haider-hamad/' },
        ],
      },
      {
        sectionName: '2. Demo scope — no advice',
        blocks: [
          'InvestAtlas demonstrates portfolio, financial-data, analytics, AI, tax-estimate, purification, and Shariah-aware screening concepts. It is not a broker, exchange, financial adviser, tax adviser, legal adviser, or religious authority.',
          'Nothing in InvestAtlas is a recommendation to buy, sell, hold, or avoid an asset. Automated Shariah results describe only the implemented methodology and are not a fatwa. Verify important decisions with qualified professionals and primary sources.',
        ],
      },
      {
        sectionName: '3. Accounts and workspaces',
        blocks: [
          'You are responsible for protecting your sign-in method and for activity performed through your account. The signed-out Local Workspace and authenticated Firebase Cloud Workspace are separate. InvestAtlas does not automatically migrate Local Workspace data into an account.',
          'Do not upload unlawful content or data you are not entitled to use. Keep your own exports of information that matters to you; Demo availability and features may change.',
        ],
      },
      {
        sectionName: '4. Financial and crypto data',
        blocks: [
          'Market observations may be delayed, incomplete, stale, unavailable, or incorrect. Crypto markets are especially volatile. Source, freshness, currency, calculation, and availability labels form part of the displayed information and must not be ignored.',
          'InvestAtlas may calculate indicators or currency conversions from sourced observations. Calculated values are not independently sourced facts. Missing values remain unavailable and must not be inferred as zero or replaced with fabricated data.',
        ],
      },
      {
        sectionName: '5. CoinGecko data and ownership',
        blocks: [
          'CoinGecko is disabled in the operator public_demo. Personal local_personal and owner-protected private_cloud workspaces may explicitly request cryptocurrency observations through the CoinGecko API, which is owned by Gecko Labs Pte. Ltd. CoinGecko does not operate or endorse InvestAtlas and bears no responsibility or liability for InvestAtlas, its users, financial decisions, or outcomes.',
          'Where the local integration is enabled, observations are for personal informational and engineering use. You may not extract, resell, sublicense, redistribute, syndicate, or provide access to the CoinGecko API or its raw data through InvestAtlas.',
        ],
        links: [
          { linkText: 'CoinGecko API Terms', url: 'https://www.coingecko.com/en/api_terms' },
          { linkText: 'CoinGecko Privacy Policy', url: 'https://www.coingecko.com/en/privacy' },
        ],
      },
      {
        sectionName: '6. Optional personal data providers (BYOK)',
        blocks: [
          'A signed-in user can connect their own Tiingo API token. The token remains in this tab’s JavaScript memory. To fetch requested data, the browser sends it by authenticated same-origin POST to the Next.js server running on Vercel or localhost; the server transiently forwards it via an Authorization header to the fixed Tiingo host. Vercel handles the credential during this request, but it is not logged or persisted in Firestore, Firebase, browser storage or server storage. The optional one-shot test remains local-only. No user shares a market feed or key with another user.',
          'Every user must supply their own Tiingo token under the Tiingo Developer Program and the current provider terms. Data sourced by Tiingo is shown only to that user, not through a shared InvestAtlas data feed. No Tiingo raw response or normalized market series is persisted; only raw equity/ETF end-of-day observations and completed aggregate BTC/ETH daily bars are displayed. Respect provider limits, attribution, privacy and display rights. Do not share or redistribute the data. A previous encrypted legacy Tiingo server-vault credential can only be deleted.',
        ],
        links: [
          { linkText: 'Tiingo Terms of Service', url: 'https://app.tiingo.com/tos/' },
          { linkText: 'Tiingo Privacy Policy', url: 'https://www.tiingo.com/privacy' },
          { linkText: 'Tiingo EOD API documentation', url: 'https://www.tiingo.com/documentation/end-of-day' },
        ],
      },
      {
        sectionName: '7. AI-assisted document import',
        blocks: [
          'Personal AI providers are currently used only when a signed-in user explicitly starts the reviewed document and transaction import. The uploaded statement and extraction instructions are sent only to the highest-priority enabled provider and are never forwarded automatically to a fallback provider. Returned rows are an untrusted import proposal that the user must review before saving. Technical analysis remains deterministic, Savings Plan AI generation is disabled, and AI may not invent missing fundamentals.',
        ],
      },
      {
        sectionName: '8. Acceptable use',
        blocks: ['You must not abuse the Demo, bypass limits, interfere with security, probe other users’ data, introduce malicious code, automate excessive requests, or use InvestAtlas or provider data in violation of law or third-party terms. Access may be restricted to protect the Demo, users, or providers.'],
      },
      {
        sectionName: '9. Availability and liability',
        blocks: [
          'The Demo is provided on an “as available” basis without a promise of uninterrupted operation, complete data, or fitness for a particular purpose. To the extent permitted by applicable law, the operator and data providers are not liable for losses arising from reliance on Demo output, provider outages, market-data errors, or user decisions.',
          'Nothing in these terms excludes liability that cannot legally be excluded. Your statutory rights remain unaffected.',
        ],
      },
      {
        sectionName: '10. Changes and termination',
        blocks: ['InvestAtlas may change or discontinue Demo features and may update these terms. The current date is shown above. Material changes will be presented conspicuously where practical. You may stop using the Demo and delete Local or Cloud data through the available controls.'],
      },
    ],
  },
  privacy: {
    documentTitle: 'Privacy Policy',
    summaryText: 'This policy explains what the InvestAtlas Demo stores, why it is used, and which external services may receive data.',
    lastUpdatedText: `Last updated: ${UPDATED}`,
    backText: 'Back to InvestAtlas',
    relatedText: 'Related information',
    demoLabel: 'Public Demo',
    sections: [
      {
        sectionName: '1. Controller and contact',
        blocks: [
          'The controller for the InvestAtlas Demo is Haider Hamad. Privacy requests can be initiated through the operator’s LinkedIn contact or the public InvestAtlas repository. Do not place sensitive or account data in a public issue; request a private contact channel first.',
        ],
        links: [
          { linkText: 'InvestAtlas on GitHub', url: INVESTATLAS_PUBLIC_REPOSITORY_URL },
          { linkText: 'Contact the operator on LinkedIn', url: 'https://www.linkedin.com/in/haider-hamad/' },
        ],
      },
      {
        sectionName: '2. Data used by InvestAtlas',
        blocks: ['Depending on how you use the Demo, InvestAtlas may process the following categories:'],
        bulletItems: [
          'Account identity: email address, display name, Firebase user identifier, and Google identity metadata when Google sign-in is used.',
          'Portfolio workspace: accounts, transactions, watchlists, preferences, tax-profile inputs, purification inputs, and other records you enter.',
          'Technical data: IP address, browser/device information, request metadata, security events, and operational logs generated by hosting or authentication services.',
          'Optional AI-import data: provider configuration, encrypted user-owned API keys, a statement file deliberately uploaded for transaction extraction, extraction instructions, and the provider’s proposed rows.',
          'Optional financial-provider data: a session-only user-owned Tiingo token held in tab memory, local request-budget estimate, and deliberately requested symbols, dates, intervals and currencies. On Vercel and localhost, connected Portfolio/Charts requests send the tab-only token to the authenticated same-origin Next.js endpoint, which forwards it to Tiingo for the owning user’s requested symbols only. The optional separate one-shot test is restricted to the loopback development server. Tiingo receives connection and network metadata. No Tiingo key, raw response or normalized market series is persistently cached by InvestAtlas.',
        ],
      },
      {
        sectionName: '3. Local Workspace and browser storage',
        blocks: ['The signed-out Local Workspace stores portfolio data and preferences in browser storage. Theme, language, workspace selection, the current legal-acceptance version and timestamp, and PWA resources may also use localStorage, IndexedDB, or service-worker caches. This storage is functional, not advertising tracking. Clearing site data can permanently remove Local Workspace records and causes the acceptance prompt to be shown again.'],
      },
      {
        sectionName: '4. Cloud Workspace and authentication',
        blocks: ['When you sign in, Firebase Authentication processes your identity and Firestore stores account-scoped Cloud Workspace records. Google receives and processes data when Google sign-in is selected. Access rules restrict supported user collections to their owner; InvestAtlas does not automatically merge anonymous Local Workspace data into the cloud.'],
        links: [
          { linkText: 'Google Privacy Policy', url: 'https://policies.google.com/privacy' },
          { linkText: 'Firebase Privacy and Security', url: 'https://firebase.google.com/support/privacy' },
        ],
      },
      {
        sectionName: '5. Hosting and external data providers',
        blocks: [
          'Vercel hosts the web application and server routes and may process request and operational metadata. With personal Tiingo BYOK enabled, authenticated requests reach a Next.js server endpoint on Vercel or localhost; the hosting server processes each user’s token transiently to request only that user’s market data from Tiingo. No personal token or price series is written to Firebase, Firestore or persistent caches. The separate one-shot connection test remains loopback-only. Server-side European Central Bank reference-FX requests contain only currency pairs and required dates, not complete portfolios or identities.',
          'Public ECB reference FX and a separate free, keyless gold-api.com indicative XAU/USD spot quotation are available; gold-api.com is contacted directly by the browser and receives standard connection metadata (including IP address), never the user’s Tiingo or Firebase token. The gold observation is briefly cached in tab memory, not persistently. Tiingo remains an optional user-owned API-key connection; InvestAtlas does not operate a shared Tiingo feed. Alpha Vantage and the legacy server-side Tiingo connector are disabled for hosted quote and history requests. These live providers are disabled in public_demo. Personal-mode sources are described below and require applicable rights; Bitfinex and Coinbase remain disabled.',
        ],
        links: [
          { linkText: 'Vercel Privacy Policy', url: 'https://vercel.com/legal/privacy-policy' },
          { linkText: 'ECB Legal and Privacy Information', url: 'https://www.ecb.europa.eu/services/data-protection/html/index.en.html' },
          { linkText: 'Gold API Terms of Service', url: 'https://gold-api.com/terms' },
        ],
      },
      {
        sectionName: '6. Optional AI providers',
        blocks: ['Personal AI providers are currently used only for the explicitly reviewed document and transaction import. When an authenticated user starts that import, only the highest-priority enabled provider receives the uploaded statement and extraction instructions; InvestAtlas does not forward the document automatically to a fallback provider. The provider’s own terms and privacy policy apply. API keys are handled through authenticated server routes and encrypted at rest; masked metadata, not the full key, is returned to the browser. Do not upload documents containing unnecessary personal information.'],
      },
      {
        sectionName: '7. Optional financial-data providers',
        blocks: ['With personal Tiingo BYOK, the browser tab sends your token in a same-origin authenticated POST body to your own Next.js hosting server (Vercel or localhost), which forwards it in an Authorization header to api.tiingo.com. It is processed transiently by the hosting server, never logged or stored in a URL, Firebase, Firestore or persistent browser/server storage; it remains visible in your own browser/developer tools and to Tiingo. Tiingo receives connection and request metadata under its privacy policy. No Tiingo raw or normalized market prices are stored persistently. You may delete prior inactive Alpha Vantage normalized cache from Settings. A previously encrypted legacy Tiingo server credential can only be removed.'],
        links: [
          { linkText: 'Tiingo Terms of Service', url: 'https://app.tiingo.com/tos/' },
          { linkText: 'Tiingo Privacy Policy', url: 'https://www.tiingo.com/privacy' },
        ],
      },
      {
        sectionName: '8. Purposes and legal bases',
        blocks: ['Data is processed to provide the workspace you request, authenticate users, retrieve market observations, run user-requested document and transaction extraction, protect the service, diagnose failures, and comply with legal obligations. Depending on the context, the basis is performance of the requested service, legitimate interests in secure Demo operation, consent where specifically requested, or compliance with law.'],
      },
      {
        sectionName: '9. Analytics and cookies',
        blocks: ['InvestAtlas currently keeps Google Analytics/Firebase Analytics disabled and does not use advertising or marketing trackers. Authentication providers and hosting infrastructure may use strictly necessary storage or cookies. A marketing-cookie banner is therefore not displayed. This policy must be updated before optional analytics or tracking is enabled.'],
      },
      {
        sectionName: '10. Retention, deletion, and security',
        blocks: ['Local data remains until you delete it or clear browser storage. The personal Tiingo token stays in tab memory until reload, sign-out, account deletion or tab close, and no Tiingo market series is persistently cached. Old, separately disabled Alpha Vantage normalized cache entries may remain until removed through Settings or site-data deletion. Cloud records remain until you remove them using account/data controls or as required by security or law. Owner-scoped Firestore rules, bounded server routes, encrypted AI keys and data minimization support security, but no internet service guarantees absolute security.'],
      },
      {
        sectionName: '11. Your rights and changes',
        blocks: ['Subject to applicable law, you may request access, correction, deletion, restriction, objection, portability, or withdrawal of consent, and may complain to a competent data-protection authority. A request may require identity verification. This policy will be updated when processing materially changes.'],
      },
    ],
  },
  'financial-data': {
    documentTitle: 'Financial Data Disclaimer',
    summaryText: 'How InvestAtlas distinguishes sourced observations, calculations, AI-assisted import output, and unavailable information.',
    lastUpdatedText: `Last updated: ${UPDATED}`,
    backText: 'Back to InvestAtlas',
    relatedText: 'Related information',
    demoLabel: 'Public Demo',
    sections: [
      {
        sectionName: 'Information, not advice',
        blocks: ['InvestAtlas is a technical Demo and does not provide investment, financial, tax, legal, or religious advice. Prices, indicators, portfolio values, tax estimates, purification figures, Shariah states, and AI-extracted transaction proposals must be independently verified before any decision.'],
      },
      {
        sectionName: 'Data categories',
        blocks: ['InvestAtlas labels data according to its origin and confidence. “Sourced” identifies a provider observation. “Calculated” identifies a value derived by InvestAtlas. “AI-assisted import” identifies proposed transaction rows extracted from a user-uploaded document and is not a financial-data source. “Unavailable” means the required evidence is absent and is not replaced by an estimate.'],
      },
      {
        sectionName: 'Freshness and market risk',
        blocks: ['Market data can be delayed, stale, partial, revised, or unavailable. Reference FX is not an executable exchange rate. Cryptocurrency prices can vary materially between venues and can move rapidly. Never assume an InvestAtlas display is a tradeable quote.'],
      },
      {
        sectionName: 'Active public sources',
        blocks: ['The signed-out showcase uses a clearly labelled, provider-independent synthetic Demo Snapshot; synthetic values are not market observations. ECB reference rates serve supported EUR/USD conversions. The keyless Gold API (gold-api.com) supplies a separate indicative XAU/USD spot quote in an approved personal browser session, not ETF or executable dealer prices, and the current metal valuation still requires verified fineness. Tiingo is available only as a personal browser BYOK connector with a user-owned token, not as an InvestAtlas-shared quote feed. The Alpha Vantage and legacy Tiingo server connections are disabled. These live providers are inactive in public_demo. Personal-mode sources are described below and require applicable rights; Bitfinex and Coinbase remain disabled.'],
        links: [
          { linkText: 'CoinGecko API Terms', url: 'https://www.coingecko.com/en/api_terms' },
          { linkText: 'ECB statistics usage policy', url: 'https://www.ecb.europa.eu/stats/ecb_statistics/governance_and_quality_framework/html/usage_policy.en.html' },
        ],
      },
      {
        sectionName: 'Personal provider data',
        blocks: ['The active Tiingo connector obtains raw equity/ETF end-of-day closes and completed aggregated BTC/ETH daily bars through an authenticated Next.js request, and exposes at most the latest 100 observations. These are not realtime or intraday quotes. The token exists only in the current tab, and neither raw nor normalized prices are stored persistently. The conservative local request estimate cannot see other devices or replace the provider limits. Unsupported data remains unavailable; unadjusted values may be misleading around splits and other corporate actions.'],
        links: [
          { linkText: 'Tiingo EOD API documentation', url: 'https://www.tiingo.com/documentation/end-of-day' },
          { linkText: 'Tiingo Plans and limits', url: 'https://www.tiingo.com/about/pricing' },
        ],
      },
      {
        sectionName: 'Shariah and purification',
        blocks: ['Automated screening reports only the implemented methodology. Missing evidence produces insufficient-data or review-required states, never automatic compliance. Purification is withheld when required inputs are missing. These outputs are not a fatwa or substitute for a qualified Shariah adviser.'],
      },
      {
        sectionName: 'AI-assisted import boundaries',
        blocks: ['AI is currently used only to propose transaction rows from a document explicitly uploaded by the user. Technical analysis remains deterministic and Savings Plan AI generation is disabled. Proposed rows may be incomplete or wrong, require user review before import, and must not fill in missing revenue, earnings, market capitalization, ratios, margins, cash flow, or other fundamentals.'],
      },
      {
        sectionName: 'User responsibility',
        blocks: ['Check the displayed source, timestamp, currency, period, and availability state. Compare important information with primary sources and consult qualified professionals. External data providers bear no responsibility for decisions or outcomes based on InvestAtlas.'],
      },
    ],
  },
};

const AR_DOCUMENTS: Record<LegalDocumentKind, LegalDocument> = {
  terms: {
    documentTitle: 'شروط الخدمة',
    summaryText: 'تنظم هذه الشروط استخدام النسخة التجريبية العامة من InvestAtlas ومساحتي العمل المحلية والسحابية.',
    lastUpdatedText: `آخر تحديث: ${UPDATED_AR}`,
    backText: 'العودة إلى InvestAtlas',
    relatedText: 'معلومات ذات صلة',
    demoLabel: 'نسخة تجريبية عامة',
    sections: [
      { sectionName: '1. المشغّل والموافقة', blocks: ['InvestAtlas مشروع تجريبي عام غير تجاري يشغّله Haider Hamad. بإنشاء حساب أو المتابعة عبر Google أو استخدام النسخة التجريبية بعد عرض هذه الشروط، فإنك توافق عليها. إذا لم توافق فلا تستخدم InvestAtlas.', 'يمكن توجيه الأسئلة عبر مستودع InvestAtlas العام على GitHub أو حساب المشغّل على LinkedIn. لا تنشر كلمات المرور أو مفاتيح API أو تفاصيل المحفظة أو أي بيانات حساسة في القنوات العامة.'], links: [{ linkText: 'InvestAtlas على GitHub', url: INVESTATLAS_PUBLIC_REPOSITORY_URL }, { linkText: 'التواصل مع المشغّل عبر LinkedIn', url: 'https://www.linkedin.com/in/haider-hamad/' }] },
      { sectionName: '2. نطاق النسخة التجريبية — لا تُعد نصيحة', blocks: ['يعرض InvestAtlas مفاهيم تتبع المحافظ والبيانات المالية والتحليلات والذكاء الاصطناعي وتقديرات الضرائب والتطهير والفحص المتوافق مع الشريعة. وهو ليس وسيطاً أو بورصة أو مستشاراً مالياً أو ضريبياً أو قانونياً أو جهة دينية.', 'لا يشكل أي محتوى توصية بشراء أصل أو بيعه أو الاحتفاظ به أو تجنبه. نتائج الشريعة الآلية تصف المنهجية المطبقة فقط وليست فتوى. تحقّق من القرارات المهمة لدى مختصين مؤهلين ومن المصادر الأصلية.'] },
      { sectionName: '3. الحسابات ومساحات العمل', blocks: ['أنت مسؤول عن حماية طريقة تسجيل الدخول وعن النشاط الذي يتم عبر حسابك. مساحة العمل المحلية عند تسجيل الخروج ومساحة Firebase السحابية بعد تسجيل الدخول منفصلتان، ولا ينقل InvestAtlas البيانات المحلية إلى الحساب تلقائياً.', 'لا ترفع محتوى غير قانوني أو بيانات لا تملك حق استخدامها. احتفظ بنسخ تصدير خاصة بك للبيانات المهمة، فقد تتغير ميزات النسخة التجريبية أو إتاحتها.'] },
      { sectionName: '4. البيانات المالية وبيانات العملات الرقمية', blocks: ['قد تكون بيانات السوق متأخرة أو ناقصة أو قديمة أو غير متاحة أو غير صحيحة، وأسواق العملات الرقمية شديدة التقلب. تعد معلومات المصدر والحداثة والعملة وطريقة الحساب والتوافر جزءاً من العرض ولا ينبغي تجاهلها.', 'قد يحسب InvestAtlas مؤشرات أو تحويلات عملات انطلاقاً من بيانات مصدرية. القيم المحسوبة ليست حقائق مصدرية مستقلة. تبقى البيانات المفقودة غير متاحة ولا تُعامل كصفر ولا تُستبدل ببيانات مختلقة.'] },
      { sectionName: '5. بيانات CoinGecko وملكيتها', blocks: ['تكون CoinGecko معطّلة في public_demo. يمكن لمساحات local_personal وprivate_cloud المحمية لمالكها طلب بيانات العملات الرقمية بعد التفعيل الصريح عبر واجهة CoinGecko API المملوكة لشركة Gecko Labs Pte. Ltd. لا تدير CoinGecko تطبيق InvestAtlas ولا تؤيده، ولا تتحمل مسؤولية عن التطبيق أو مستخدميه أو القرارات والنتائج المالية.', 'عندما يكون التكامل المحلي مفعلاً، تكون البيانات للاستخدام المعلوماتي والهندسي الشخصي. لا يجوز استخراج واجهة CoinGecko أو بياناتها الخام أو إعادة بيعها أو ترخيصها أو توزيعها أو إتاحة الوصول إليها عبر InvestAtlas.'], links: [{ linkText: 'شروط CoinGecko API', url: 'https://www.coingecko.com/en/api_terms' }, { linkText: 'سياسة خصوصية CoinGecko', url: 'https://www.coingecko.com/en/privacy' }] },
      { sectionName: '6. مزوّدو البيانات الشخصية الاختياريون', blocks: ['يمكن للمستخدم المسجّل ربط حساب Tiingo شخصي برمزه الخاص طوعًا. يبقى رمز Tiingo في ذاكرة علامة المتصفح. على Vercel وlocalhost، يُرسل عبر POST مصادَق عليه إلى خادم Next.js على الموقع نفسه، الذي يعالجه مؤقتاً ثم يمرره إلى Tiingo لجلب الأسعار المطلوبة لكل مستخدم بشكل مستقل. يعالج خادم الاستضافة الرمز مؤقتاً دون تخزينه أو تسجيله بشكل دائم؛ ولا يُرسل إلى Firebase أو Firestore أو تخزين المتصفح الدائم. يظل الاختبار المنفصل لمرة واحدة محصوراً في localhost. لا يعالج عامل الخدمة طلبات Tiingo الخارجية ولا يخزنها.', 'يحتاج كل مستخدم إلى حساب Tiingo ورمز منفصل وفق برنامج المطورين والشروط. تُعرض بيانات Tiingo للمستخدم صاحب الرمز فقط ولا يوزعها InvestAtlas من مصدر مشترك. لا تُحفظ الردود الخام أو سلاسل الأسعار المطبّعة في تخزين دائم. تُعرض إغلاقات الأسهم وصناديق ETF اليومية الخام وشموع BTC/ETH اليومية المكتملة والمجمّعة فقط. يجب الالتزام بالحدود ونسب المصدر والخصوصية وعدم إعادة التوزيع. يمكن حذف مفتاح Tiingo القديم المشفّر على الخادم فقط.'], links: [{ linkText: 'شروط Tiingo', url: 'https://app.tiingo.com/tos/' }, { linkText: 'سياسة خصوصية Tiingo', url: 'https://www.tiingo.com/privacy' }, { linkText: 'توثيق Tiingo API', url: 'https://www.tiingo.com/documentation/end-of-day' }] },
      { sectionName: '7. استيراد المستندات بمساعدة الذكاء الاصطناعي', blocks: ['يقتصر استخدام مزوّدي الذكاء الاصطناعي الشخصيين حاليًا على الحالة التي يبدأ فيها مستخدم مسجّل الدخول صراحةً مسار استيراد المستندات والمعاملات الذي خضع للمراجعة. يُرسل كشف الحساب المرفوع وتعليمات الاستخراج إلى المزوّد المفعّل ذي الأولوية الأعلى فقط، ولا يحوّل InvestAtlas المستند تلقائيًا إلى مزوّد بديل. تُعد الصفوف المعادة مجرد اقتراح استيراد غير موثوق يجب على المستخدم مراجعته قبل الحفظ. يبقى التحليل الفني حتميًا، وتوليد خطة الادخار بالذكاء الاصطناعي معطّل، ولا يجوز للذكاء الاصطناعي اختلاق البيانات الأساسية المفقودة.'] },
      { sectionName: '8. الاستخدام المقبول', blocks: ['يُحظر إساءة استخدام النسخة التجريبية أو تجاوز الحدود أو تعطيل الأمان أو محاولة الوصول إلى بيانات الآخرين أو إدخال برمجيات ضارة أو تنفيذ طلبات آلية مفرطة أو مخالفة القانون وشروط الأطراف الخارجية. قد يتم تقييد الوصول لحماية المشروع أو المستخدمين أو المزوّدين.'] },
      { sectionName: '9. الإتاحة والمسؤولية', blocks: ['تُقدَّم النسخة التجريبية حسب الإتاحة من دون ضمان التشغيل المستمر أو اكتمال البيانات أو ملاءمتها لغرض معين. وبالقدر الذي يسمح به القانون، لا يتحمل المشغّل أو مزوّدو البيانات خسائر ناتجة عن الاعتماد على مخرجات النسخة التجريبية أو انقطاع المزوّد أو أخطاء البيانات أو قرارات المستخدم.', 'لا تستبعد هذه الشروط أي مسؤولية لا يجوز استبعادها قانوناً، ولا تمس حقوقك القانونية.'] },
      { sectionName: '10. التغييرات والإنهاء', blocks: ['قد يغيّر InvestAtlas ميزات النسخة التجريبية أو يوقفها ويحدّث هذه الشروط. يظهر تاريخ النسخة الحالية أعلاه، وستُعرض التغييرات الجوهرية بوضوح عندما يكون ذلك عملياً. يمكنك التوقف عن الاستخدام وحذف البيانات المحلية أو السحابية عبر الأدوات المتاحة.'] },
    ],
  },
  privacy: {
    documentTitle: 'سياسة الخصوصية',
    summaryText: 'توضح هذه السياسة ما تخزنه نسخة InvestAtlas التجريبية وسبب استخدامه والخدمات الخارجية التي قد تستلم بيانات.',
    lastUpdatedText: `آخر تحديث: ${UPDATED_AR}`,
    backText: 'العودة إلى InvestAtlas',
    relatedText: 'معلومات ذات صلة',
    demoLabel: 'نسخة تجريبية عامة',
    sections: [
      { sectionName: '1. مسؤول المعالجة والتواصل', blocks: ['مسؤول معالجة بيانات نسخة InvestAtlas التجريبية هو Haider Hamad. يمكن بدء طلبات الخصوصية عبر حساب المشغّل على LinkedIn أو مستودع InvestAtlas العام على GitHub. لا تضع بيانات حساسة أو معلومات حساب في بلاغ عام؛ اطلب أولاً قناة تواصل خاصة.'], links: [{ linkText: 'InvestAtlas على GitHub', url: INVESTATLAS_PUBLIC_REPOSITORY_URL }, { linkText: 'التواصل مع المشغّل عبر LinkedIn', url: 'https://www.linkedin.com/in/haider-hamad/' }] },
      { sectionName: '2. البيانات التي يستخدمها InvestAtlas', blocks: ['بحسب طريقة استخدامك للنسخة التجريبية، قد يعالج InvestAtlas الفئات التالية:'], bulletItems: ['هوية الحساب: البريد الإلكتروني والاسم الظاهر ومعرّف مستخدم Firebase وبيانات هوية Google عند استخدام تسجيل الدخول عبر Google.', 'مساحة المحفظة: الحسابات والمعاملات وقوائم المتابعة والتفضيلات ومدخلات ملف الضرائب والتطهير والسجلات الأخرى التي تدخلها.', 'البيانات التقنية: عنوان IP ومعلومات المتصفح والجهاز وبيانات الطلب وأحداث الأمان والسجلات التشغيلية التي تنشئها خدمات الاستضافة أو المصادقة.', 'بيانات الاستيراد الاختيارية بالذكاء الاصطناعي: إعداد المزوّد ومفاتيح API المملوكة للمستخدم والمشفرة وكشف الحساب الذي يرفعه المستخدم عمدًا لاستخراج المعاملات وتعليمات الاستخراج والصفوف التي يقترحها المزوّد.', 'بيانات مزوّد مالي اختيارية: رمز Tiingo مملوك للمستخدم ويبقى في ذاكرة التبويب فقط، وتقدير محلي لعدد الطلبات والرموز والتواريخ والفترات والعملات التي يطلبها المستخدم. على Vercel وlocalhost، تُرسل طلبات المحفظة والرسوم الرمز في POST مصادَق عليه إلى خادم Next.js في الموقع نفسه، الذي يرسله مؤقتاً إلى Tiingo؛ أما اختبار الاتصال المنفصل لمرة واحدة فيبقى متاحاً على localhost فقط. يتلقى Tiingo بيانات الاتصال والشبكة. لا يحفظ InvestAtlas الرمز أو الاستجابات الخام أو سلاسل أسعار Tiingo المطبّعة بصورة دائمة.'] },
      { sectionName: '3. مساحة العمل المحلية وتخزين المتصفح', blocks: ['تخزن مساحة العمل المحلية عند تسجيل الخروج بيانات المحفظة والتفضيلات في المتصفح. وقد يستخدم المظهر واللغة واختيار مساحة العمل وإصدار الموافقة القانونية الحالي ووقتها وموارد PWA التخزين المحلي أو IndexedDB أو ذاكرة عامل الخدمة. هذا تخزين وظيفي وليس تتبعاً إعلانياً. قد يؤدي مسح بيانات الموقع إلى حذف السجلات المحلية نهائياً وإظهار طلب الموافقة من جديد.'] },
      { sectionName: '4. مساحة العمل السحابية والمصادقة', blocks: ['عند تسجيل الدخول، تعالج Firebase Authentication هويتك وتخزن Firestore سجلات مساحة العمل السحابية المرتبطة بحسابك. تستلم Google البيانات وتعالجها عند اختيار تسجيل الدخول عبر Google. تقصر قواعد الوصول المجموعات المدعومة على مالكها، ولا يدمج InvestAtlas البيانات المحلية المجهولة تلقائياً في السحابة.'], links: [{ linkText: 'سياسة خصوصية Google', url: 'https://policies.google.com/privacy' }, { linkText: 'خصوصية وأمان Firebase', url: 'https://firebase.google.com/support/privacy' }] },
      { sectionName: '5. الاستضافة ومزوّدو البيانات الخارجيون', blocks: ['تستضيف Vercel التطبيق ومسارات الخادم وقد تعالج بيانات الطلب والتشغيل. تستخدم طلبات Tiingo الشخصية مسار Next.js مصادَقاً عليه على Vercel أو localhost، ويستقبل خادم الاستضافة الرمز مؤقتاً ويمرره إلى Tiingo دون تخزينه بشكل دائم. لا تُحفظ الرموز في Firebase أو Firestore، ويقتصر الاختبار المنفصل لمرة واحدة على localhost. تتضمن طلبات البنك المركزي الأوروبي من الخادم زوج العملات والتواريخ المطلوبة فقط، لا المحفظة الكاملة أو الهوية.', 'تشمل البيانات المالية العامة أسعار الصرف المرجعية للبنك المركزي الأوروبي وسعر الذهب الفوري الإرشادي XAU/USD من gold-api.com. يتصل المتصفح بخدمة الذهب العامة مباشرة؛ وقد تتلقى بيانات الاتصال مثل عنوان IP دون أي رمز Tiingo أو Firebase، ولا تُخزّن الأسعار سوى مؤقتاً في ذاكرة التبويب. Tiingo اتصال شخصي اختياري برمز يملكه المستخدم وليس مصدر أسعار مشتركًا من InvestAtlas. اتصال Alpha Vantage وخدمة Tiingo القديمة عبر الخادم معطّلان في النشر العام. وتظل هذه الخدمات معطّلة في public_demo. المصادر الشخصية موضحة أدناه وتبقى خاضعة لحقوق البيانات؛ Bitfinex وCoinbase معطّلان.'], links: [{ linkText: 'سياسة خصوصية Vercel', url: 'https://vercel.com/legal/privacy-policy' }, { linkText: 'معلومات الخصوصية لدى البنك المركزي الأوروبي', url: 'https://www.ecb.europa.eu/services/data-protection/html/index.en.html' }, { linkText: 'شروط Gold API', url: 'https://gold-api.com/terms' }] },
      { sectionName: '6. مزوّدو الذكاء الاصطناعي الاختياريون', blocks: ['يقتصر استخدام مزوّدي الذكاء الاصطناعي الشخصيين حاليًا على مسار استيراد المستندات والمعاملات الذي خضع لمراجعة صريحة. عندما يبدأ مستخدم موثّق هذا الاستيراد، يستلم المزوّد المفعّل ذو الأولوية الأعلى فقط كشف الحساب المرفوع وتعليمات الاستخراج، ولا يحوّل InvestAtlas المستند تلقائيًا إلى مزوّد بديل. تطبق شروط المزوّد وسياسة خصوصيته. تُدار مفاتيح API عبر مسارات خادم مصادق عليها وتُشفّر عند التخزين، ولا يُعاد إلى المتصفح سوى بيانات مخفية. لا ترفع مستندات تتضمن معلومات شخصية غير ضرورية.'] },
      { sectionName: '7. مزوّدو البيانات المالية الاختياريون', blocks: ['في وضع Tiingo الشخصي، تُرسل علامة المتصفح الرمز عبر POST مصادَق عليه إلى خادم Next.js على Vercel أو localhost الذي يمرره مؤقتاً في ترويسة Authorization إلى Tiingo لكل طلب. يبقى الاختبار المنفصل لمرة واحدة متاحاً على localhost فقط. لا يحفظ خادم الاستضافة الرمز ولا يسجّله بصورة دائمة، لكن Vercel قد يعالجه مؤقتاً أثناء الطلب. لا يظهر الرمز في عنوان URL ولا يُرسل إلى Firebase أو Firestore ولا يُخزّن بصورة دائمة. قد يراه مزوّد الخدمة وأدوات الشبكة في متصفحك وفق سياسة Tiingo للخصوصية. لا يحتفظ InvestAtlas بسلاسل أسعار Tiingo الخام أو المطبّعة بصورة دائمة. يمكن حذف ذاكرة Alpha Vantage القديمة غير النشطة من الإعدادات. يبقى مفتاح Tiingo القديم المشفر على الخادم قابلاً للحذف فقط.'], links: [{ linkText: 'شروط Tiingo', url: 'https://app.tiingo.com/tos/' }, { linkText: 'سياسة خصوصية Tiingo', url: 'https://www.tiingo.com/privacy' }] },
      { sectionName: '8. الأغراض والأسس القانونية', blocks: ['تُعالج البيانات لتقديم مساحة العمل المطلوبة ومصادقة المستخدمين وجلب بيانات السوق وإجراء استخراج المستندات والمعاملات بناءً على طلب المستخدم وحماية الخدمة وتشخيص الأعطال والامتثال للالتزامات القانونية. وبحسب السياق، يكون الأساس تنفيذ الخدمة المطلوبة أو المصلحة المشروعة في تشغيل نسخة آمنة أو الموافقة عند طلبها تحديداً أو الامتثال للقانون.'] },
      { sectionName: '9. التحليلات وملفات تعريف الارتباط', blocks: ['تبقي InvestAtlas حالياً Google Analytics وFirebase Analytics معطّلين ولا تستخدم أدوات تتبع إعلانية أو تسويقية. قد تستخدم خدمات المصادقة والاستضافة تخزيناً أو ملفات ضرورية فقط. لذلك لا يظهر شريط موافقة تسويقي. يجب تحديث هذه السياسة قبل تشغيل تحليلات أو تتبع اختياري.'] },
      { sectionName: '10. الاحتفاظ والحذف والأمان', blocks: ['تبقى بيانات المستخدم المحلية إلى أن يحذفها أو يمسح تخزين المتصفح. يبقى رمز Tiingo الشخصي في ذاكرة التبويب حتى إعادة التحميل أو تسجيل الخروج أو حذف الحساب أو إغلاق التبويب؛ ولا تُخزّن أسعار Tiingo بصورة دائمة. قد تبقى بيانات Alpha Vantage القديمة غير النشطة حتى حذفها من الإعدادات أو بيانات الموقع. تبقى البيانات السحابية حتى حذفها عبر أدوات الحساب أو وفق الالتزامات الأمنية والقانونية. تُستخدم قواعد Firestore المرتبطة بالمالك ومسارات خادم محدودة وتشفير مفاتيح الذكاء الاصطناعي وتقليل البيانات لدعم الأمان دون ضمان مطلق.'] },
      { sectionName: '11. حقوقك والتغييرات', blocks: ['وفق القانون المطبق، يمكنك طلب الوصول أو التصحيح أو الحذف أو التقييد أو الاعتراض أو نقل البيانات أو سحب الموافقة، ويمكنك الشكوى لدى سلطة حماية بيانات مختصة. قد يلزم التحقق من الهوية. ستُحدّث هذه السياسة عند حدوث تغيير جوهري في المعالجة.'] },
    ],
  },
  'financial-data': {
    documentTitle: 'إخلاء مسؤولية البيانات المالية',
    summaryText: 'كيف يميّز InvestAtlas بين البيانات المصدرية والحسابات ومخرجات الاستيراد بمساعدة الذكاء الاصطناعي والمعلومات غير المتاحة.',
    lastUpdatedText: `آخر تحديث: ${UPDATED_AR}`,
    backText: 'العودة إلى InvestAtlas',
    relatedText: 'معلومات ذات صلة',
    demoLabel: 'نسخة تجريبية عامة',
    sections: [
      { sectionName: 'معلومات وليست نصيحة', blocks: ['InvestAtlas نسخة تقنية تجريبية ولا تقدم نصيحة استثمارية أو مالية أو ضريبية أو قانونية أو دينية. يجب التحقق المستقل من الأسعار والمؤشرات وقيم المحافظ وتقديرات الضرائب والتطهير وحالات الشريعة واقتراحات المعاملات المستخرجة بالذكاء الاصطناعي قبل أي قرار.'] },
      { sectionName: 'فئات البيانات', blocks: ['يصنّف InvestAtlas البيانات حسب مصدرها ودرجة الثقة. تعني «مصدرية» أنها ملاحظة من مزوّد، وتعني «محسوبة» أنها مشتقة بواسطة InvestAtlas. وتعني «الاستيراد بمساعدة الذكاء الاصطناعي» صفوف معاملات مقترحة مستخرجة من مستند رفعه المستخدم، وليست مصدرًا للبيانات المالية. وتعني «غير متاحة» أن الدليل المطلوب مفقود ولا يُستبدل بتقدير.'] },
      { sectionName: 'الحداثة ومخاطر السوق', blocks: ['قد تكون بيانات السوق متأخرة أو قديمة أو جزئية أو معدلة أو غير متاحة. سعر الصرف المرجعي ليس سعراً قابلاً للتنفيذ. قد تختلف أسعار العملات الرقمية كثيراً بين المنصات وتتحرك بسرعة. لا تفترض أن عرض InvestAtlas سعر تداول قابل للتنفيذ.'] },
      { sectionName: 'المصادر العامة النشطة', blocks: ['تستخدم واجهة العرض عند تسجيل الخروج لقطة تجريبية اصطناعية واضحة ومستقلة عن المزوّد. تُستخدم أسعار البنك المركزي الأوروبي المرجعية للتحويل المدعوم بين الدولار واليورو. تُجلب أيضاً أسعار الذهب الفورية الإرشادية XAU/USD من gold-api.com العامة المجانية مباشرة من المتصفح، ما يتيح للمزوّد رؤية بيانات الاتصال مثل عنوان IP، دون إرسال رموز Tiingo أو Firebase؛ ولا تُخزّن الملاحظات إلا مؤقتاً في ذاكرة التبويب. Tiingo اتصال BYOK شخصي اختياري برمز يملكه المستخدم، وليس مصدرًا مشتركًا من InvestAtlas. تعطل اتصالات Alpha Vantage وخدمة Tiingo القديمة عبر الخادم. تبقى هذه الخدمات معطّلة في public_demo. المصادر الشخصية موضحة أدناه وتبقى خاضعة لحقوق البيانات؛ Bitfinex وCoinbase معطّلان.'], links: [{ linkText: 'شروط CoinGecko API', url: 'https://www.coingecko.com/en/api_terms' }, { linkText: 'سياسة استخدام إحصاءات البنك المركزي الأوروبي', url: 'https://www.ecb.europa.eu/stats/ecb_statistics/governance_and_quality_framework/html/usage_policy.en.html' }] },
      { sectionName: 'بيانات المزوّد الشخصي', blocks: ['يجلب موصل Tiingo النشط إغلاقات يومية خاماً للأسهم وصناديق ETF وشموع BTC/ETH اليومية المكتملة والمجمّعة عبر مسار Next.js مصادَق عليه، بحد أقصى 100 نقطة، وليس أسعارًا فورية. يبقى الرمز في ذاكرة التبويب فقط ولا تُحفظ الأسعار الخام أو المطبّعة بصورة دائمة. تقدير الطلبات المحلي لا يمثل نشاط الأجهزة الأخرى أو الحصة الرسمية للمزوّد. تبقى المعلومات غير المدعومة غير متاحة، وقد تكون الأسعار غير المعدّلة مضللة حول تقسيم الأسهم وإجراءات الشركات.'], links: [{ linkText: 'توثيق Tiingo API', url: 'https://www.tiingo.com/documentation/end-of-day' }, { linkText: 'حدود Tiingo وأسعاره', url: 'https://www.tiingo.com/about/pricing' }] },
      { sectionName: 'الشريعة والتطهير', blocks: ['يعرض الفحص الآلي المنهجية المطبقة فقط. يؤدي نقص الأدلة إلى حالة «بيانات غير كافية» أو «تحتاج مراجعة»، ولا يؤدي أبداً إلى امتثال تلقائي. لا تُعرض قيمة تطهير دقيقة عند غياب المدخلات المطلوبة. هذه النتائج ليست فتوى ولا بديلاً عن مستشار شرعي مؤهل.'] },
      { sectionName: 'حدود الاستيراد بمساعدة الذكاء الاصطناعي', blocks: ['يُستخدم الذكاء الاصطناعي حاليًا فقط لاقتراح صفوف معاملات من مستند يرفعه المستخدم صراحةً. يبقى التحليل الفني حتميًا، وتوليد خطة الادخار بالذكاء الاصطناعي معطّل. قد تكون الصفوف المقترحة ناقصة أو خاطئة، وتتطلب مراجعة المستخدم قبل الاستيراد، ولا يجوز أن تملأ الإيرادات أو الأرباح أو القيمة السوقية أو النسب أو الهوامش أو التدفق النقدي أو أي بيانات أساسية مفقودة.'] },
      { sectionName: 'مسؤولية المستخدم', blocks: ['تحقّق من المصدر والوقت والعملة والفترة وحالة التوافر المعروضة. قارن المعلومات المهمة بالمصادر الأصلية واستشر مختصين مؤهلين. لا يتحمل مزوّدو البيانات الخارجيون مسؤولية القرارات أو النتائج المبنية على InvestAtlas.'] },
    ],
  },
};

const DE_DOCUMENTS: Record<LegalDocumentKind, LegalDocument> = {
  terms: {
    documentTitle: 'Nutzungsbedingungen',
    summaryText: 'Diese Bedingungen regeln die Nutzung der öffentlichen InvestAtlas-Demo sowie ihrer lokalen und cloudbasierten Arbeitsbereiche.',
    lastUpdatedText: `Stand: ${UPDATED_DE}`,
    backText: 'Zurück zu InvestAtlas',
    relatedText: 'Weitere Informationen',
    demoLabel: 'Öffentliche Demo',
    sections: [
      {
        sectionName: '1. Betreiber und Zustimmung',
        blocks: [
          'InvestAtlas ist eine nicht kommerzielle öffentliche Demo, die von Haider Hamad betrieben wird. Indem du ein Konto erstellst, mit Google fortfährst oder die Demo nach Anzeige dieser Bedingungen nutzt, stimmst du ihnen zu. Wenn du nicht zustimmst, darfst du InvestAtlas nicht nutzen.',
          'Fragen können über das verlinkte öffentliche InvestAtlas-Repository oder das LinkedIn-Profil des Betreibers gestellt werden. Veröffentliche über diese öffentlichen Kanäle keine Passwörter, API-Schlüssel, Portfoliodaten oder andere sensible Informationen.',
        ],
        links: [
          { linkText: 'InvestAtlas auf GitHub', url: INVESTATLAS_PUBLIC_REPOSITORY_URL },
          { linkText: 'Betreiber auf LinkedIn kontaktieren', url: 'https://www.linkedin.com/in/haider-hamad/' },
        ],
      },
      {
        sectionName: '2. Umfang der Demo — keine Beratung',
        blocks: [
          'InvestAtlas veranschaulicht Konzepte für Portfolios, Finanzdaten, Analysen, KI, Steuerschätzungen, Purification und Shariah-orientiertes Screening. InvestAtlas ist weder Broker noch Börse und bietet keine Finanz-, Steuer- oder Rechtsberatung; es ist auch keine religiöse Autorität.',
          'Nichts in InvestAtlas ist eine Empfehlung, einen Vermögenswert zu kaufen, zu verkaufen, zu halten oder zu meiden. Automatisierte Shariah-Ergebnisse beschreiben ausschließlich die implementierte Methodik und sind keine Fatwa. Prüfe wichtige Entscheidungen mit qualifizierten Fachpersonen und anhand von Primärquellen.',
        ],
      },
      {
        sectionName: '3. Konten und Arbeitsbereiche',
        blocks: [
          'Du bist dafür verantwortlich, deine Anmeldemethode zu schützen und die über dein Konto ausgeführten Aktivitäten zu kontrollieren. Der abgemeldete lokale Arbeitsbereich und der authentifizierte Firebase-Cloud-Arbeitsbereich sind voneinander getrennt. InvestAtlas überträgt Daten aus dem lokalen Arbeitsbereich nicht automatisch in ein Konto.',
          'Lade keine rechtswidrigen Inhalte oder Daten hoch, zu deren Nutzung du nicht berechtigt bist. Bewahre eigene Exporte wichtiger Informationen auf; Verfügbarkeit und Funktionsumfang der Demo können sich ändern.',
        ],
      },
      {
        sectionName: '4. Finanz- und Kryptodaten',
        blocks: [
          'Marktbeobachtungen können verzögert, unvollständig, veraltet, nicht verfügbar oder fehlerhaft sein. Kryptomärkte sind besonders volatil. Angaben zu Quelle, Aktualität, Währung, Berechnung und Verfügbarkeit sind Bestandteil der angezeigten Informationen und dürfen nicht außer Acht gelassen werden.',
          'InvestAtlas kann aus bezogenen Beobachtungen Indikatoren oder Währungsumrechnungen berechnen. Berechnete Werte sind keine unabhängig bezogenen Fakten. Fehlende Werte bleiben nicht verfügbar; sie dürfen weder als null interpretiert noch durch erfundene Daten ersetzt werden.',
        ],
      },
      {
        sectionName: '5. CoinGecko-Daten und Eigentum',
        blocks: [
          'CoinGecko ist in public_demo deaktiviert. Persönliche local_personal- und eigentümergeschützte private_cloud-Arbeitsbereiche können nach ausdrücklicher Freigabe Kryptobeobachtungen über die CoinGecko API verwenden, die Gecko Labs Pte. Ltd. gehört. CoinGecko betreibt oder unterstützt InvestAtlas nicht und übernimmt keine Verantwortung oder Haftung für InvestAtlas, seine Nutzer, finanzielle Entscheidungen oder Ergebnisse.',
          'Wenn die lokale Integration aktiviert ist, dienen die Beobachtungen ausschließlich dem persönlichen Informations- und Entwicklungszweck. Die CoinGecko API oder ihre Rohdaten dürfen über InvestAtlas weder extrahiert noch weiterverkauft, unterlizenziert, weitergegeben, syndiziert oder zugänglich gemacht werden.',
        ],
        links: [
          { linkText: 'CoinGecko API-Nutzungsbedingungen', url: 'https://www.coingecko.com/en/api_terms' },
          { linkText: 'CoinGecko-Datenschutzerklärung', url: 'https://www.coingecko.com/en/privacy' },
        ],
      },
      {
        sectionName: '6. Optionale persönliche Datenanbieter (BYOK)',
        blocks: [
          'Ein angemeldeter Nutzer kann freiwillig seinen eigenen Tiingo-Token verbinden. Der Token bleibt im Arbeitsspeicher des aktuellen Tabs. Auf Vercel und localhost empfängt ein authentifizierter Next.js-Endpunkt den Token vorübergehend im POST-Body und leitet ihn im Authorization-Header an Tiingo weiter. Der Hosting-Server verarbeitet ihn für die Anfrage, speichert oder protokolliert ihn aber nicht dauerhaft. Firebase, Firestore und dauerhafte Browserspeicher erhalten keinen Token. Der separate einmalige Verbindungstest bleibt auf localhost beschränkt. Der Service Worker verarbeitet oder speichert externe Tiingo-Anfragen nicht.',
          'Jeder Nutzer benötigt ein eigenes Tiingo-Konto und einen eigenen Token gemäß Tiingo Developer Program und Nutzungsbedingungen. Datenquelle ist Tiingo; die Anzeige erfolgt nur für den eigenen Nutzer, nicht über einen gemeinsamen InvestAtlas-Datenfeed. Es werden keine Tiingo-Rohdaten oder normalisierten Kursreihen dauerhaft gespeichert. Angezeigt werden nur rohe Aktien-/ETF-Tagesschlusskurse und abgeschlossene aggregierte BTC-/ETH-Tageskerzen. Beachte Anbieterlimits, Attribution, Datenschutz und Datenrechte. Gib diese Daten nicht weiter. Ein früherer verschlüsselter Tiingo-Server-Schlüssel kann nur gelöscht werden.',
        ],
        links: [
          { linkText: 'Tiingo-Nutzungsbedingungen', url: 'https://app.tiingo.com/tos/' },
          { linkText: 'Tiingo-Datenschutzerklärung', url: 'https://www.tiingo.com/privacy' },
          { linkText: 'Tiingo-API-Dokumentation', url: 'https://www.tiingo.com/documentation/end-of-day' },
        ],
      },
      {
        sectionName: '7. KI-gestützter Dokumentimport',
        blocks: [
          'Persönliche KI-Anbieter werden derzeit ausschließlich verwendet, wenn ein angemeldeter Nutzer den geprüften Dokument- und Transaktionsimport ausdrücklich startet. Der hochgeladene Kontoauszug und die Extraktionsanweisungen werden nur an den aktivierten Anbieter mit der höchsten Priorität gesendet und niemals automatisch an einen Ersatzanbieter weitergegeben. Zurückgegebene Zeilen sind ein nicht vertrauenswürdiger Importvorschlag, den der Nutzer vor dem Speichern prüfen muss. Die technische Analyse bleibt deterministisch, die KI-Erzeugung von Sparplänen ist deaktiviert und die KI darf keine fehlenden Fundamentaldaten erfinden.',
        ],
      },
      {
        sectionName: '8. Zulässige Nutzung',
        blocks: ['Du darfst die Demo nicht missbrauchen, Limits umgehen, Sicherheitsmaßnahmen beeinträchtigen, Daten anderer Nutzer ausforschen, schädlichen Code einbringen, übermäßige Anfragen automatisieren oder InvestAtlas beziehungsweise Anbieterdaten entgegen geltendem Recht oder Bedingungen Dritter nutzen. Zum Schutz der Demo, der Nutzer oder der Anbieter kann der Zugriff eingeschränkt werden.'],
      },
      {
        sectionName: '9. Verfügbarkeit und Haftung',
        blocks: [
          'Die Demo wird nach Verfügbarkeit bereitgestellt, ohne Zusage eines unterbrechungsfreien Betriebs, vollständiger Daten oder der Eignung für einen bestimmten Zweck. Soweit gesetzlich zulässig, haften der Betreiber und die Datenanbieter nicht für Verluste, die aus dem Vertrauen auf Demo-Ausgaben, Anbieterausfällen, Marktdatenfehlern oder Nutzerentscheidungen entstehen.',
          'Diese Bedingungen schließen keine Haftung aus, die gesetzlich nicht ausgeschlossen werden darf. Deine gesetzlichen Rechte bleiben unberührt.',
        ],
      },
      {
        sectionName: '10. Änderungen und Beendigung',
        blocks: ['InvestAtlas kann Funktionen der Demo ändern oder einstellen und diese Bedingungen aktualisieren. Das aktuelle Datum ist oben angegeben. Wesentliche Änderungen werden, soweit praktikabel, deutlich kenntlich gemacht. Du kannst die Nutzung beenden und lokale oder cloudbasierte Daten über die verfügbaren Funktionen löschen.'],
      },
    ],
  },
  privacy: {
    documentTitle: 'Datenschutzerklärung',
    summaryText: 'Diese Erklärung erläutert, welche Daten die InvestAtlas-Demo speichert, warum sie verwendet werden und welche externen Dienste Daten erhalten können.',
    lastUpdatedText: `Stand: ${UPDATED_DE}`,
    backText: 'Zurück zu InvestAtlas',
    relatedText: 'Weitere Informationen',
    demoLabel: 'Öffentliche Demo',
    sections: [
      {
        sectionName: '1. Verantwortlicher und Kontakt',
        blocks: [
          'Verantwortlicher für die InvestAtlas-Demo ist Haider Hamad. Datenschutzanfragen können über den LinkedIn-Kontakt des Betreibers oder das öffentliche InvestAtlas-Repository eingeleitet werden. Veröffentliche in einem öffentlichen Issue keine sensiblen Daten oder Kontoinformationen; bitte zunächst um einen privaten Kontaktweg.',
        ],
        links: [
          { linkText: 'InvestAtlas auf GitHub', url: INVESTATLAS_PUBLIC_REPOSITORY_URL },
          { linkText: 'Betreiber auf LinkedIn kontaktieren', url: 'https://www.linkedin.com/in/haider-hamad/' },
        ],
      },
      {
        sectionName: '2. Von InvestAtlas verwendete Daten',
        blocks: ['Abhängig davon, wie du die Demo nutzt, kann InvestAtlas folgende Datenkategorien verarbeiten:'],
        bulletItems: [
          'Kontoidentität: E-Mail-Adresse, Anzeigename, Firebase-Nutzerkennung und Google-Identitätsmetadaten bei Verwendung der Google-Anmeldung.',
          'Portfolio-Arbeitsbereich: Konten, Transaktionen, Watchlists, Einstellungen, Angaben zum Steuerprofil, Purification-Angaben und weitere von dir eingegebene Datensätze.',
          'Technische Daten: IP-Adresse, Browser- und Geräteinformationen, Anfragemetadaten, Sicherheitsereignisse und Betriebsprotokolle, die von Hosting- oder Authentifizierungsdiensten erzeugt werden.',
          'Optionale KI-Importdaten: Anbieterkonfiguration, verschlüsselte nutzereigene API-Schlüssel, ein bewusst zur Transaktionsextraktion hochgeladener Kontoauszug, Extraktionsanweisungen und die vom Anbieter vorgeschlagenen Zeilen.',
          'Optionale Daten von Finanzanbietern: ein nutzereigener Tiingo-Token ausschließlich im Tab-Arbeitsspeicher, eine lokale Anfragebudget-Schätzung sowie angeforderte Symbole, Datumswerte, Intervalle und Währungen. Auf Vercel und localhost überträgt der Browser den Token für authentifizierte Portfolio- und Chart-Anfragen an den eigenen Next.js-Server, der ihn vorübergehend im Authorization-Header an Tiingo weiterleitet. Der separate Einmaltest bleibt nur lokal verfügbar. Tiingo erhält Verbindungs- und Netzwerkmetadaten. InvestAtlas speichert weder Tiingo-Token noch Rohantworten oder normalisierte Tiingo-Kursreihen dauerhaft.',
        ],
      },
      {
        sectionName: '3. Lokaler Arbeitsbereich und Browserspeicher',
        blocks: ['Der abgemeldete lokale Arbeitsbereich speichert Portfoliodaten und Einstellungen im Browser. Auch Theme, Sprache, Arbeitsbereichsauswahl, aktuelle Version und Zeitpunkt der rechtlichen Zustimmung sowie PWA-Ressourcen können localStorage, IndexedDB oder Service-Worker-Caches verwenden. Diese Speicherung dient der Funktion der Anwendung und nicht dem Werbetracking. Das Löschen der Websitedaten kann Datensätze des lokalen Arbeitsbereichs dauerhaft entfernen und dazu führen, dass die Zustimmung erneut abgefragt wird.'],
      },
      {
        sectionName: '4. Cloud-Arbeitsbereich und Authentifizierung',
        blocks: ['Wenn du dich anmeldest, verarbeitet Firebase Authentication deine Identität und Firestore speichert kontobezogene Datensätze des Cloud-Arbeitsbereichs. Google erhält und verarbeitet Daten, wenn du die Google-Anmeldung auswählst. Zugriffsregeln beschränken unterstützte Nutzersammlungen auf deren Eigentümer; InvestAtlas führt anonyme lokale Daten nicht automatisch mit der Cloud zusammen.'],
        links: [
          { linkText: 'Google-Datenschutzerklärung', url: 'https://policies.google.com/privacy' },
          { linkText: 'Datenschutz und Sicherheit bei Firebase', url: 'https://firebase.google.com/support/privacy' },
        ],
      },
      {
        sectionName: '5. Hosting und externe Datenanbieter',
        blocks: [
          'Vercel hostet die Webanwendung und Serverrouten und kann Anfrage- und Betriebsmetadaten verarbeiten. Bei persönlichem Tiingo-BYOK empfängt ein authentifizierter Next.js-Endpunkt auf Vercel oder localhost den Token für jede angeforderte Kursabfrage vorübergehend und leitet ihn an Tiingo weiter. Der Hosting-Server verarbeitet den Token daher kurzzeitig, Firebase und Firestore sowie dauerhafte Caches speichern ihn nicht. Nur der separate Einmaltest ist auf localhost beschränkt. Serverseitige EZB-Referenzkurs-Anfragen enthalten nur Währungspaar und benötigte Daten, nicht die vollständige Identität oder das Portfolio.',
          'Öffentlich verfügbar sind EZB-Referenzkurse und ein separater kostenloser, schlüsselloser Gold-Spotpreis (XAU/USD) von gold-api.com. Der Browser kontaktiert gold-api.com direkt; dabei erhält dieser Anbieter übliche Verbindungsdaten (einschließlich IP-Adresse), aber weder den Tiingo- noch den Firebase-Token. Gold-Beobachtungen bleiben nur kurz im Tab-Arbeitsspeicher. Tiingo bleibt eine optionale Verbindung mit eigenem API-Key; InvestAtlas verteilt keinen gemeinsamen Tiingo-Kursfeed. Alpha Vantage und der alte serverseitige Tiingo-Connector sind gehostet für Kurs- und Verlaufsdaten deaktiviert. Diese Live-Anbieter sind in public_demo deaktiviert. Persönliche Quellen werden unten beschrieben und erfordern entsprechende Datenrechte; Bitfinex und Coinbase bleiben deaktiviert.',
        ],
        links: [
          { linkText: 'Vercel-Datenschutzerklärung', url: 'https://vercel.com/legal/privacy-policy' },
          { linkText: 'Rechts- und Datenschutzinformationen der EZB', url: 'https://www.ecb.europa.eu/services/data-protection/html/index.en.html' },
          { linkText: 'Nutzungsbedingungen der Gold API', url: 'https://gold-api.com/terms' },
        ],
      },
      {
        sectionName: '6. Optionale KI-Anbieter',
        blocks: ['Persönliche KI-Anbieter werden derzeit ausschließlich für den ausdrücklich geprüften Dokument- und Transaktionsimport verwendet. Wenn ein authentifizierter Nutzer diesen Import startet, erhält nur der aktivierte Anbieter mit der höchsten Priorität den hochgeladenen Kontoauszug und die Extraktionsanweisungen; InvestAtlas gibt das Dokument nicht automatisch an einen Ersatzanbieter weiter. Es gelten die Bedingungen und die Datenschutzerklärung des Anbieters. API-Schlüssel werden über authentifizierte Serverrouten verarbeitet und verschlüsselt gespeichert; an den Browser werden maskierte Metadaten, nicht aber der vollständige Schlüssel zurückgegeben. Lade keine Dokumente mit unnötigen personenbezogenen Informationen hoch.'],
      },
      {
        sectionName: '7. Optionale Finanzdatenanbieter',
        blocks: ['Bei persönlichem Tiingo-BYOK sendet dein aktueller Browser-Tab den Token in einem authentifizierten POST-Body an den eigenen Next.js-Server auf Vercel oder localhost; dort wird er für die jeweilige Abfrage vorübergehend verarbeitet und im Authorization-Header an Tiingo weitergeleitet, aber nicht protokolliert oder dauerhaft gespeichert. Der separate Einmaltest bleibt auf localhost beschränkt. Der Token steht weder in einer URL noch in Firebase, Firestore, dauerhaftem Browserspeicher oder einer gehosteten InvestAtlas-Anfrage; deine eigenen Browser-/Entwicklertools und Tiingo können ihn sehen. Tiingo erhält Verbindungs- und Anfragemetadaten gemäß seiner Datenschutzerklärung. InvestAtlas speichert keine rohen oder normalisierten Tiingo-Kurse dauerhaft. Frühere Alpha-Vantage-Cache-Einträge können in den Einstellungen gelöscht werden. Ein alter serverseitig verschlüsselter Tiingo-Schlüssel kann nur entfernt werden.'],
        links: [
          { linkText: 'Tiingo-Nutzungsbedingungen', url: 'https://app.tiingo.com/tos/' },
          { linkText: 'Tiingo-Datenschutzerklärung', url: 'https://www.tiingo.com/privacy' },
        ],
      },
      {
        sectionName: '8. Zwecke und Rechtsgrundlagen',
        blocks: ['Daten werden verarbeitet, um den angeforderten Arbeitsbereich bereitzustellen, Nutzer zu authentifizieren, Marktbeobachtungen abzurufen, die vom Nutzer angeforderte Dokument- und Transaktionsextraktion auszuführen, den Dienst zu schützen, Fehler zu diagnostizieren und rechtliche Verpflichtungen zu erfüllen. Je nach Kontext beruht die Verarbeitung auf der Erfüllung des angeforderten Dienstes, berechtigten Interessen an einem sicheren Betrieb der Demo, einer ausdrücklich eingeholten Einwilligung oder der Erfüllung gesetzlicher Pflichten.'],
      },
      {
        sectionName: '9. Analysen und Cookies',
        blocks: ['Google Analytics und Firebase Analytics sind in InvestAtlas derzeit deaktiviert; Werbe- oder Marketing-Tracker werden nicht eingesetzt. Authentifizierungsanbieter und Hosting-Infrastruktur können technisch notwendige Speichermechanismen oder Cookies verwenden. Daher wird kein Banner für Marketing-Cookies angezeigt. Vor der Aktivierung optionaler Analysen oder Tracking-Funktionen muss diese Erklärung aktualisiert werden.'],
      },
      {
        sectionName: '10. Aufbewahrung, Löschung und Sicherheit',
        blocks: ['Lokale Daten bleiben, bis du sie löschst oder den Browserspeicher leerst. Der persönliche Tiingo-Token bleibt nur bis zum Neuladen, Abmelden, Löschen des Kontos oder Schließen des Tabs im Arbeitsspeicher. Tiingo-Marktdaten werden nicht dauerhaft gespeichert. Frühere, deaktivierte Alpha-Vantage-Cache-Einträge können bis zur manuellen Löschung in den Einstellungen oder über die Website-Daten bestehen bleiben. Cloud-Daten werden durch Konto- und Datenwerkzeuge oder entsprechend Sicherheits- und Rechtspflichten gelöscht. Eigentümergebundene Firestore-Regeln, begrenzte Serverrouten, verschlüsselte KI-Schlüssel und Datenminimierung dienen dem Schutz; absolute Sicherheit ist nicht möglich.'],
      },
      {
        sectionName: '11. Deine Rechte und Änderungen',
        blocks: ['Nach Maßgabe des anwendbaren Rechts kannst du Auskunft, Berichtigung, Löschung, Einschränkung, Widerspruch, Datenübertragbarkeit oder den Widerruf einer Einwilligung verlangen und dich bei einer zuständigen Datenschutzaufsichtsbehörde beschweren. Für eine Anfrage kann eine Identitätsprüfung erforderlich sein. Diese Erklärung wird aktualisiert, wenn sich die Verarbeitung wesentlich ändert.'],
      },
    ],
  },
  'financial-data': {
    documentTitle: 'Hinweise zu Finanzdaten',
    summaryText: 'So unterscheidet InvestAtlas zwischen bezogenen Beobachtungen, Berechnungen, KI-gestützten Importausgaben und nicht verfügbaren Informationen.',
    lastUpdatedText: `Stand: ${UPDATED_DE}`,
    backText: 'Zurück zu InvestAtlas',
    relatedText: 'Weitere Informationen',
    demoLabel: 'Öffentliche Demo',
    sections: [
      {
        sectionName: 'Informationen, keine Beratung',
        blocks: ['InvestAtlas ist eine technische Demo und bietet keine Anlage-, Finanz-, Steuer-, Rechts- oder Religionsberatung. Preise, Indikatoren, Portfoliowerte, Steuerschätzungen, Purification-Beträge, Shariah-Status und KI-extrahierte Transaktionsvorschläge müssen vor jeder Entscheidung unabhängig geprüft werden.'],
      },
      {
        sectionName: 'Datenkategorien',
        blocks: ['InvestAtlas kennzeichnet Daten nach Herkunft und Vertrauensgrad. „Bezogene Daten“ bezeichnen eine Beobachtung eines Anbieters. „Berechnet“ bezeichnet einen von InvestAtlas abgeleiteten Wert. „KI-gestützter Import“ bezeichnet vorgeschlagene Transaktionszeilen, die aus einem vom Nutzer hochgeladenen Dokument extrahiert wurden, und ist keine Quelle für Finanzdaten. „Nicht verfügbar“ bedeutet, dass die erforderlichen Belege fehlen und nicht durch eine Schätzung ersetzt werden.'],
      },
      {
        sectionName: 'Aktualität und Marktrisiko',
        blocks: ['Marktdaten können verzögert, veraltet, unvollständig, nachträglich geändert oder nicht verfügbar sein. Ein Referenzwechselkurs ist kein ausführbarer Wechselkurs. Kryptopreise können erheblich zwischen Handelsplätzen abweichen und sich schnell verändern. Gehe nie davon aus, dass eine InvestAtlas-Anzeige ein handelbarer Kurs ist.'],
      },
      {
        sectionName: 'Aktive öffentliche Quellen',
        blocks: ['Das abgemeldete Showcase nutzt einen klar gekennzeichneten synthetischen Demo-Snapshot ohne Anbieterbezug. EZB-Referenzkurse dienen unterstützten EUR/USD-Umrechnungen. Die kostenlose Gold API (gold-api.com) liefert zusätzlich einen unverbindlichen XAU/USD-Spotpreis in einer freigegebenen persönlichen Browser-Sitzung; sie liefert keine ETF- oder verbindlichen Händlerkurse. Für die Metallbewertung bleibt ein bekannter Feingehalt erforderlich. Tiingo ist nur als persönliche Browser-BYOK-Verbindung mit eigenem Token verfügbar, nicht als gemeinsamer InvestAtlas-Datenfeed. Alpha Vantage und der alte Tiingo-Server-Connector sind deaktiviert. Diese Live-Anbieter sind in public_demo inaktiv. Persönliche Quellen werden unten beschrieben und erfordern entsprechende Datenrechte; Bitfinex und Coinbase bleiben deaktiviert.'],
        links: [
          { linkText: 'CoinGecko API-Nutzungsbedingungen', url: 'https://www.coingecko.com/en/api_terms' },
          { linkText: 'Nutzungsrichtlinie für EZB-Statistiken', url: 'https://www.ecb.europa.eu/stats/ecb_statistics/governance_and_quality_framework/html/usage_policy.en.html' },
        ],
      },
      {
        sectionName: 'Daten persönlicher Anbieter',
        blocks: ['Der aktive Tiingo-Connector bezieht rohe Aktien-/ETF-Tagesschlusskurse sowie abgeschlossene aggregierte BTC-/ETH-Tageskerzen über einen authentifizierten Next.js-Endpunkt und zeigt höchstens die neuesten 100 Beobachtungen. Das sind weder Echtzeit- noch Intraday-Kurse. Der Token bleibt nur im aktuellen Tab; rohe und normalisierte Kurse werden nicht dauerhaft gespeichert. Die lokale Anfrage-Schätzung kennt andere Geräte nicht und ersetzt nicht das offizielle Anbieterlimit. Fehlende Daten bleiben nicht verfügbar; nicht bereinigte Kurse können rund um Splits oder andere Kapitalmaßnahmen irreführend sein.'],
        links: [
          { linkText: 'Tiingo-API-Dokumentation', url: 'https://www.tiingo.com/documentation/end-of-day' },
          { linkText: 'Tiingo-Tarife und Limits', url: 'https://www.tiingo.com/about/pricing' },
        ],
      },
      {
        sectionName: 'Shariah und Purification',
        blocks: ['Das automatisierte Screening gibt ausschließlich die implementierte Methodik wieder. Fehlende Belege führen zu den Status „unzureichende Daten“ oder „Prüfung erforderlich“, niemals automatisch zu Konformität. Wenn erforderliche Eingaben fehlen, wird kein Purification-Betrag angezeigt. Diese Ausgaben sind keine Fatwa und ersetzen keine qualifizierte Shariah-Beratung.'],
      },
      {
        sectionName: 'Grenzen des KI-gestützten Imports',
        blocks: ['KI wird derzeit ausschließlich verwendet, um Transaktionszeilen aus einem vom Nutzer ausdrücklich hochgeladenen Dokument vorzuschlagen. Die technische Analyse bleibt deterministisch und die KI-Erzeugung von Sparplänen ist deaktiviert. Vorgeschlagene Zeilen können unvollständig oder falsch sein, müssen vor dem Import durch den Nutzer geprüft werden und dürfen fehlende Angaben zu Umsatz, Ertrag, Marktkapitalisierung, Kennzahlen, Margen, Cashflow oder anderen Fundamentaldaten nicht ergänzen.'],
      },
      {
        sectionName: 'Verantwortung des Nutzers',
        blocks: ['Prüfe die angezeigte Quelle, den Zeitstempel, die Währung, den Zeitraum und den Verfügbarkeitsstatus. Vergleiche wichtige Informationen mit Primärquellen und wende dich an qualifizierte Fachpersonen. Externe Datenanbieter tragen keine Verantwortung für Entscheidungen oder Ergebnisse, die auf InvestAtlas beruhen.'],
      },
    ],
  },
};

export function getLegalDocument(
  kind: LegalDocumentKind,
  language: LanguagePreference,
): LegalDocument {
  const document = language === 'ar' ? AR_DOCUMENTS[kind] : language === 'de' ? DE_DOCUMENTS[kind] : EN_DOCUMENTS[kind];
  return { ...document, sections: [...document.sections, personalMarketDisclosure(language)] };
}
