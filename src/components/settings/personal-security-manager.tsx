'use client';

import { useCallback, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useAuth } from '@/lib/auth/auth-context';
import { useAppTranslation } from '@/lib/i18n/use-app-translation';
import type { LanguagePreference } from '@/lib/preferences/app-preferences';
import { ANONYMOUS_WORKSPACE_MODE_EVENT } from '@/lib/demo/workspace-mode';
import { INVESTATLAS_DEPLOYMENT_MODE } from '@/lib/runtime/deployment-mode';
import { LOCAL_PERSONAL_PROVIDER_OWNER_ID } from '@/lib/runtime/local-personal-provider';
import { BROWSER_WORKSPACE_CHANGE_EVENT } from '@/lib/storage/workspace-storage';
import { getAssetConfig } from '@/lib/config/supported-assets';
import { normalizePersonalListingIdentity } from '@/lib/config/personal-instrument';
import { saveResolvedPersonalListing } from '@/lib/config/personal-asset-registry';
import { readUserAssets, USER_ASSETS_CHANGE_EVENT, type LocalUserAsset } from '@/lib/config/user-assets-store';
import {
  resolveYahooPersonalListing, searchYahooPersonalListings,
  type YahooPersonalListingCandidate, type YahooPersonalListingResolution,
} from '@/lib/financial-data/providers/yahoo-personal-discovery';
import { seedYahooPersonalSeries } from '@/lib/financial-data/providers/yahoo-personal';
import { activeMarketOwner } from '@/lib/financial-data/providers/twelve-personal';
import {
  getPublicSourceConsentRevision, isPublicSourceApproved, PUBLIC_SOURCE_CONSENT_EVENT,
} from '@/lib/financial-data/providers/public-source-consent';
import { readSourceSelection, SOURCE_CHANGE } from '@/lib/financial-data/providers/source-selection';

const ENGLISH = {
  sectionTitle: 'My securities',
  intro: 'Find a stock or ETF listing and review its details before tracking it.',
  searchLabel: 'Search securities', queryHint: 'Name or exact ticker', search: 'Search',
  searching: 'Searching…', verifying: 'Verifying listing…',
  sourceNeeded: 'Enable Yahoo and approve personal use under My market data before searching.',
  sourceLink: 'My market data', coverage: 'Only verified EUR/USD stocks and ETFs are supported.',
  noMatches: 'No matching securities. Try an exact ticker or another name.',
  searchFailed: 'Search is unavailable. Check Yahoo permission, quota and your connection, then try again.',
  resolveFailed: 'Could not verify this listing. It may be unsupported or temporarily unavailable.',
  reviewCandidate: 'Review', reviewTitle: 'Review this listing',
  name: 'Name', symbol: 'Ticker', exchange: 'Exchange', currency: 'Trading currency', assetClass: 'Asset class',
  stock: 'Stock', etf: 'ETF', insufficient: 'Insufficient Shariah evidence',
  disclaimer: 'Listing details do not establish Shariah compliance. A separate review is required.',
  track: 'Track for review', cancel: 'Cancel',
  saved: 'Tracked for review. Shariah evidence is still insufficient.',
  saveFailed: 'Could not save this listing. Check browser storage and existing asset details.',
  unresolved: 'Unresolved holdings', chooseExisting: 'Choose an existing holding',
  transactions: 'Tracking does not change existing transactions.',
};
type SecurityCopy = Record<keyof typeof ENGLISH, string>;
const COPY: Record<LanguagePreference, SecurityCopy> = {
  en: ENGLISH,
  de: {
    sectionTitle: 'Meine Wertpapiere',
    intro: 'Suche eine Aktie oder einen ETF und prüfe die Angaben vor dem Vormerken.',
    searchLabel: 'Wertpapiere suchen', queryHint: 'Name oder genaues Börsenkürzel', search: 'Suchen',
    searching: 'Suche läuft…', verifying: 'Börsennotierung wird geprüft…',
    sourceNeeded: 'Aktiviere Yahoo unter Meine Marktdaten und bestätige die persönliche Nutzung, bevor du suchst.',
    sourceLink: 'Meine Marktdaten', coverage: 'Unterstützt werden nur verifizierte Aktien und ETFs mit Handelswährung EUR oder USD.',
    noMatches: 'Keine passenden Wertpapiere. Versuche ein genaues Börsenkürzel oder einen anderen Namen.',
    searchFailed: 'Die Suche ist nicht verfügbar. Prüfe die Yahoo-Freigabe, das Abruflimit und deine Verbindung und versuche es erneut.',
    resolveFailed: 'Diese Börsennotierung konnte nicht bestätigt werden. Sie wird möglicherweise nicht unterstützt oder ist vorübergehend nicht verfügbar.',
    reviewCandidate: 'Prüfen', reviewTitle: 'Börsennotierung prüfen',
    name: 'Name', symbol: 'Börsenkürzel', exchange: 'Börse', currency: 'Handelswährung', assetClass: 'Anlageklasse',
    stock: 'Aktie', etf: 'ETF', insufficient: 'Unzureichende Scharia-Nachweise',
    disclaimer: 'Die Börsendaten belegen keine Scharia-Konformität. Eine gesonderte Prüfung ist erforderlich.',
    track: 'Zur Prüfung vormerken', cancel: 'Abbrechen',
    saved: 'Zur Prüfung vorgemerkt. Die Scharia-Nachweise sind weiterhin unzureichend.',
    saveFailed: 'Die Börsennotierung konnte nicht gespeichert werden. Prüfe den Browserspeicher und die bisherigen Angaben zum Wertpapier.',
    unresolved: 'Bestände ohne bestätigte Börsennotierung', chooseExisting: 'Bestehenden Bestand auswählen',
    transactions: 'Das Vormerken ändert keine bestehenden Transaktionen.',
  },
  ar: {
    sectionTitle: 'أوراقي المالية',
    intro: 'ابحث عن سهم أو صندوق متداول وراجع بيانات إدراجه قبل إضافته للمتابعة.',
    searchLabel: 'البحث عن الأوراق المالية', queryHint: 'الاسم أو رمز التداول الدقيق', search: 'بحث',
    searching: 'جارٍ البحث…', verifying: 'جارٍ التحقق من بيانات الإدراج…',
    sourceNeeded: 'فعّل Yahoo ووافق على الاستخدام الشخصي ضمن بيانات السوق الخاصة بي قبل البحث.',
    sourceLink: 'بيانات السوق الخاصة بي', coverage: 'تُدعم فقط الأسهم والصناديق المتداولة المؤكدة بعملة اليورو أو الدولار الأمريكي.',
    noMatches: 'لا توجد أوراق مالية مطابقة. جرّب رمز التداول الدقيق أو اسمًا آخر.',
    searchFailed: 'البحث غير متاح. تحقّق من تفعيل Yahoo وحدّ الطلبات واتصالك، ثم حاول مجددًا.',
    resolveFailed: 'تعذّر تأكيد بيانات هذا الإدراج. قد يكون غير مدعوم أو غير متاح مؤقتًا.',
    reviewCandidate: 'مراجعة', reviewTitle: 'مراجعة بيانات الإدراج',
    name: 'الاسم', symbol: 'رمز التداول', exchange: 'البورصة', currency: 'عملة التداول', assetClass: 'فئة الأصل',
    stock: 'سهم', etf: 'صندوق متداول', insufficient: 'أدلة شرعية غير كافية',
    disclaimer: 'بيانات الإدراج لا تثبت التوافق الشرعي. يجب إجراء مراجعة منفصلة.',
    track: 'متابعة للمراجعة', cancel: 'إلغاء',
    saved: 'تمت الإضافة للمتابعة والمراجعة. الأدلة الشرعية ما زالت غير كافية.',
    saveFailed: 'تعذّر حفظ بيانات الإدراج. تحقّق من تخزين المتصفح والبيانات الحالية للورقة المالية.',
    unresolved: 'أصول لم تُؤكّد بيانات إدراجها', chooseExisting: 'اختر أصلًا موجودًا',
    transactions: 'المتابعة لا تغيّر معاملاتك الحالية.',
  },
};

const SESSION_EVENTS = [BROWSER_WORKSPACE_CHANGE_EVENT, ANONYMOUS_WORKSPACE_MODE_EVENT, PUBLIC_SOURCE_CONSENT_EVENT, SOURCE_CHANGE, 'storage'];
function subscribeSession(listener: () => void): () => void {
  SESSION_EVENTS.forEach(event => window.addEventListener(event, listener));
  return () => SESSION_EVENTS.forEach(event => window.removeEventListener(event, listener));
}

function sessionSnapshot(owner: string | null): string {
  try {
    if (!owner || !activeMarketOwner(owner)) return 'inactive';
    return JSON.stringify([owner, getPublicSourceConsentRevision(), isPublicSourceApproved(owner, 'yahoo'), readSourceSelection(owner).yahoo]);
  } catch { return 'inactive'; }
}

function subscribeAssets(listener: () => void): () => void {
  window.addEventListener(USER_ASSETS_CHANGE_EVENT, listener);
  window.addEventListener('storage', listener);
  return () => {
    window.removeEventListener(USER_ASSETS_CHANGE_EVENT, listener);
    window.removeEventListener('storage', listener);
  };
}

function unresolvedSnapshot(): string {
  return JSON.stringify(readUserAssets().filter(asset =>
    (asset.assetClass === 'stock' || asset.assetClass === 'etf') && !asset.listing && !getAssetConfig(asset.symbol)));
}

const inactiveSnapshot = () => 'inactive';
const emptyAssets = () => '[]';

export function PersonalSecurityManager() {
  const { user, loading } = useAuth();
  const { language } = useAppTranslation();
  const owner = loading ? null
    : INVESTATLAS_DEPLOYMENT_MODE === 'private_cloud' ? user?.id ?? null
      : INVESTATLAS_DEPLOYMENT_MODE === 'local_personal' && !user ? LOCAL_PERSONAL_PROVIDER_OWNER_ID : null;
  const getSnapshot = useCallback(() => sessionSnapshot(owner), [owner]);
  const session = useSyncExternalStore(subscribeSession, getSnapshot, inactiveSnapshot);
  if (!owner || session === 'inactive') return null;
  // Remounting also discards unconfirmed private results before an owner or
  // permission change can make them visible in another session.
  return <PersonalSecurityWorkspace key={session} owner={owner} session={session} language={language} />;
}

function PersonalSecurityWorkspace({ owner, session, language }: { owner: string; session: string; language: LanguagePreference }) {
  const copy = COPY[language] ?? ENGLISH;
  const id = useId();
  const [query, setQuery] = useState('');
  const [candidates, setCandidates] = useState<YahooPersonalListingCandidate[]>([]);
  const [review, setReview] = useState<YahooPersonalListingResolution | null>(null);
  const [busy, setBusy] = useState<'search' | 'resolve' | null>(null);
  const [notice, setNotice] = useState<'noMatches' | 'searchFailed' | 'resolveFailed' | 'unsupported' | 'saveFailed' | 'saved' | null>(null);
  const request = useRef<AbortController | null>(null);
  const assetsSnapshot = useSyncExternalStore(subscribeAssets, unresolvedSnapshot, emptyAssets);
  const unresolved = useMemo(() => JSON.parse(assetsSnapshot) as LocalUserAsset[], [assetsSnapshot]);
  const enabled = isPublicSourceApproved(owner, 'yahoo') && readSourceSelection(owner).yahoo;
  useEffect(() => () => request.current?.abort(), []);

  function reset(nextQuery = query) {
    request.current?.abort();
    request.current = null;
    setQuery(nextQuery); setCandidates([]); setReview(null); setBusy(null); setNotice(null);
  }

  function begin(action: 'search' | 'resolve'): AbortController {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setBusy(action); setNotice(null); setReview(null); setCandidates([]);
    return controller;
  }

  function current(controller: AbortController): boolean {
    return request.current === controller && !controller.signal.aborted && sessionSnapshot(owner) === session;
  }

  async function search() {
    if (!enabled || busy || query.trim().length < 2 || sessionSnapshot(owner) !== session) return;
    const controller = begin('search');
    try {
      const result = await searchYahooPersonalListings(owner, query.trim(), controller.signal);
      if (!current(controller)) return;
      setCandidates(result.slice(0, 8));
      if (!result.length) setNotice('noMatches');
    } catch {
      if (current(controller)) setNotice('searchFailed');
    } finally {
      if (current(controller)) { request.current = null; setBusy(null); }
    }
  }

  async function resolve(symbol: string) {
    if (!enabled || busy || sessionSnapshot(owner) !== session) return;
    const controller = begin('resolve');
    try {
      const result = await resolveYahooPersonalListing(owner, symbol, controller.signal);
      if (!current(controller)) return;
      const instrument = normalizePersonalListingIdentity(result.instrument);
      if (!instrument || instrument.symbol !== symbol || instrument.providerSymbol !== symbol) {
        setNotice('unsupported');
      } else {
        setReview({ ...result, instrument });
      }
    } catch {
      if (current(controller)) setNotice('resolveFailed');
    } finally {
      if (current(controller)) { request.current = null; setBusy(null); }
    }
  }

  function track() {
    if (!review || !enabled || busy || sessionSnapshot(owner) !== session) return;
    if (!saveResolvedPersonalListing(review.instrument)) { setNotice('saveFailed'); return; }
    if (review.series && sessionSnapshot(owner) === session) {
      try { seedYahooPersonalSeries(owner, review.series); } catch { /* The saved identity remains valid if optional cache seeding is unavailable. */ }
    }
    setReview(null); setCandidates([]); setNotice('saved');
  }

  const error = notice === 'searchFailed' || notice === 'resolveFailed' || notice === 'unsupported' || notice === 'saveFailed';
  return (
    <section id="data-sources-securities" className="card" dir={language === 'ar' ? 'rtl' : 'ltr'} aria-labelledby={`${id}-title`}
      style={{ display: 'grid', gap: 12, minWidth: 0, textAlign: 'start' }}>
      <h3 className="section-title" id={`${id}-title`}>{copy.sectionTitle}</h3>
      <p className="panel-subtitle">{copy.intro}</p>
      <p className="panel-subtitle" id={`${id}-coverage`}>{copy.coverage}</p>
      <p className="panel-subtitle">{copy.disclaimer}</p>
      {!enabled && <p role="status" className="panel-subtitle">{copy.sourceNeeded}{' '}
        <a href="/settings#data-sources">{copy.sourceLink}</a></p>}
      {unresolved.length > 0 && <label className="label" style={{ minWidth: 0, letterSpacing: 'normal', textTransform: 'none' }}>
        {copy.unresolved}
        <select className="input" value="" disabled={!enabled} style={{ minHeight: 44, fontSize: 16 }} onChange={event => {
          const asset = unresolved.find(entry => entry.symbol === event.target.value);
          if (asset) reset(asset.yahooSymbol ?? asset.symbol);
        }}>
          <option value="">{copy.chooseExisting}</option>
          {unresolved.map(asset => <option key={asset.symbol} value={asset.symbol} dir="auto">{asset.symbol} — {asset.name}</option>)}
        </select>
      </label>}
      <form onSubmit={event => { event.preventDefault(); void search(); }}
        style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'end', gap: 8, minWidth: 0 }}>
        <label className="label" htmlFor={`${id}-query`} style={{ flex: '1 1 220px', minWidth: 0, letterSpacing: 'normal', textTransform: 'none' }}>
          {copy.searchLabel}
          <input className="input" id={`${id}-query`} type="text" dir="auto" value={query} maxLength={80} style={{ minHeight: 44, fontSize: 16 }}
            autoComplete="off" autoCapitalize="none" spellCheck={false} enterKeyHint="search"
            placeholder={copy.queryHint} disabled={!enabled} aria-describedby={`${id}-coverage`}
            onChange={event => reset(event.target.value)} />
        </label>
        <button className="btn btn-secondary" type="submit" style={{ minHeight: 44 }}
          disabled={!enabled || busy !== null || query.trim().length < 2}>{copy.search}</button>
      </form>
      {busy && <p role="status" className="panel-subtitle">{copy[busy === 'search' ? 'searching' : 'verifying']}</p>}
      {candidates.length > 0 && <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 8 }}>
        {candidates.map(candidate => <li key={candidate.symbol} style={{ minWidth: 0 }}>
          <button type="button" className="btn btn-secondary" aria-label={`${copy.reviewCandidate} ${candidate.symbol}`}
            onClick={() => void resolve(candidate.symbol)} disabled={busy !== null || !enabled}
            style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', textAlign: 'start', width: '100%', minWidth: 0, minHeight: 44, gap: 8, whiteSpace: 'normal' }}>
            <bdi style={{ overflowWrap: 'anywhere', minWidth: 0 }}>{candidate.name}</bdi>
            <span style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              <bdi dir="ltr">{candidate.symbol}</bdi><bdi dir="ltr">{candidate.exchange}</bdi>
              <span>{copy[candidate.assetClass === 'stock' ? 'stock' : 'etf']}</span>
            </span>
          </button>
        </li>)}
      </ul>}
      {review && <section aria-label={copy.reviewTitle} style={{ borderBlockStart: '1px solid var(--border)', paddingBlockStart: 12, display: 'grid', gap: 12, minWidth: 0 }}>
        <h4 className="section-title">{copy.reviewTitle}</h4>
        <dl style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12, margin: 0 }}>
          {([
            ['name', review.instrument.name], ['symbol', review.instrument.symbol],
            ['exchange', review.instrument.exchange], ['currency', review.instrument.nativeCurrency.toUpperCase()],
            ['assetClass', copy[review.instrument.assetClass === 'stock' ? 'stock' : 'etf']],
          ] as const).map(([label, value]) => <div key={label} style={{ minWidth: 0 }}>
            <dt className="panel-subtitle">{copy[label]}</dt>
            <dd style={{ margin: 0, overflowWrap: 'anywhere' }}>
              <bdi dir={label === 'name' || label === 'assetClass' ? 'auto' : 'ltr'}>{value}</bdi>
            </dd>
          </div>)}
        </dl>
        <p><strong>{copy.insufficient}</strong></p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          <button className="btn btn-primary" type="button" onClick={track} style={{ minHeight: 44, whiteSpace: 'normal' }}>{copy.track}</button>
          <button className="btn btn-secondary" type="button" onClick={() => reset()} style={{ minHeight: 44 }}>{copy.cancel}</button>
        </div>
      </section>}
      {notice && <p role={error ? 'alert' : 'status'} className="panel-subtitle">
        {notice === 'unsupported' ? copy.coverage : copy[notice]}
        {notice === 'resolveFailed' ? ` ${copy.coverage}` : ''}
      </p>}
      <p className="panel-subtitle">{copy.transactions}</p>
    </section>
  );
}
