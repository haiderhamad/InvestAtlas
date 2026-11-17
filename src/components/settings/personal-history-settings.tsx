'use client';

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useAppTranslation } from '@/lib/i18n/use-app-translation';
import { connectEodhd, clearEodhd, hasEodhd, EODHD_CHANGE_EVENT } from '@/lib/financial-data/providers/eodhd-personal';
import { clearPersonalHistoryCache, getPersonalHistoryCacheStats, HISTORY_CACHE_CHANGE_EVENT } from '@/lib/financial-data/providers/personal-history-service';
import { activeMarketOwner } from '@/lib/financial-data/providers/twelve-personal';
import { SOURCE_CHANGE } from '@/lib/financial-data/providers/source-selection';
import { BROWSER_WORKSPACE_CHANGE_EVENT } from '@/lib/storage/workspace-storage';
import { ANONYMOUS_WORKSPACE_MODE_EVENT } from '@/lib/demo/workspace-mode';

const COPY = {
  en: {
    sectionTitle:'History and storage', info:'Optional EODHD daily history for exact supported US, Xetra, Amsterdam and USD London listings. The free account allows one year and 20 calls per day; each history download uses two calls. A five-year download requires your own entitled plan.',
    key:'My EODHD API key', depth:'History available in my plan', one:'One year (free account)', five:'Five years (my plan includes this)',
    consent:'My own plan allows this private display and storage. I have reviewed the EODHD terms.', connect:'Test and connect EODHD', busy:'Checking…', connected:'EODHD connected for this tab', disconnect:'Disconnect EODHD',
    security:'The key stays in this tab’s memory and is sent only to this installation’s fixed EODHD bridge, then to eodhd.com over HTTPS. It is never saved.',
    terms:'EODHD terms', failed:'Connection unavailable. Check your key, plan, quota and network.',
    storage:"Native EODHD candles, Standard Bullion daily closes and ECB reference rates are kept on this device, separately for each account and installation. Saved Standard Bullion history can be shown when refresh fails, with its data date. Yahoo history remains in this tab; other sources gain no permanent storage.",
    count:'Saved daily observations', temporary:'Yahoo observations in this tab', unavailable:'Persistent browser storage is unavailable; only this tab’s memory can be used.',
    clear:'Delete saved market history', clearing:'Deleting…', clearFailed:'The market cache could not be fully deleted. Please try again.',
    detail:'This deletes market history and reference rates on this device. Your transactions and portfolio records are kept.',
  },
  de: {
    sectionTitle:'Historie und Speicherung', info:'Optionale EODHD-Tageshistorie für passende US-, Xetra-, Amsterdamer und in USD gehandelte Londoner Titel. Kostenlos sind ein Jahr und 20 Aufrufe pro Tag möglich; ein Historienabruf benötigt zwei Aufrufe. Für fünf Jahre muss dein eigener Tarif freigeschaltet sein.',
    key:'Mein EODHD-API-Schlüssel', depth:'Historie in meinem Tarif', one:'Ein Jahr (kostenloses Konto)', five:'Fünf Jahre (in meinem Tarif enthalten)',
    consent:'Mein Tarif erlaubt diese private Anzeige und Speicherung. Ich habe die EODHD-Bedingungen geprüft.', connect:'EODHD testen und verbinden', busy:'Wird geprüft…', connected:'EODHD für diesen Tab verbunden', disconnect:'EODHD trennen',
    security:'Der Schlüssel bleibt im Arbeitsspeicher dieses Tabs und wird nur an die feste EODHD-Schnittstelle deiner Installation gesendet. Diese leitet ihn ausschließlich über HTTPS an eodhd.com weiter. Er wird nicht gespeichert.',
    terms:'EODHD-Bedingungen', failed:'Verbindung nicht verfügbar. Prüfe Schlüssel, Tarif, Kontingent und Netzwerk.',
    storage:"Native EODHD-Kurse, Standard-Bullion-Tageswerte und EZB-Referenzkurse bleiben auf diesem Gerät, getrennt nach Konto und Installation. Bei Abruffehlern kann gespeicherte Standard-Bullion-Historie mit ihrem Datenstand angezeigt werden. Yahoo-Historie bleibt im Tab; für andere Quellen wird keine dauerhafte Speicherung ergänzt.",
    count:'Gespeicherte Tageswerte', temporary:'Yahoo-Tageswerte in diesem Tab', unavailable:'Dauerhafter Browserspeicher ist nicht verfügbar; nur der Arbeitsspeicher dieses Tabs kann genutzt werden.',
    clear:'Gespeicherte Markthistorie löschen', clearing:'Wird gelöscht…', clearFailed:'Der Marktdaten-Cache konnte nicht vollständig gelöscht werden. Bitte erneut versuchen.',
    detail:'Löscht Markthistorie und Referenzkurse auf diesem Gerät. Transaktionen und Portfolioaufzeichnungen bleiben erhalten.',
  },
  ar: {
    sectionTitle:'السجل والتخزين', info:'سجل يومي اختياري من EODHD للإدراجات المطابقة المدعومة في الولايات المتحدة وXetra وأمستردام ولندن بالدولار. يتيح الحساب المجاني سنة واحدة و20 طلباً يومياً؛ تنزيل السجل يحتاج طلبين. تتطلب خمس سنوات خطة خاصة بك تشمل هذه المدة.',
    key:'مفتاح EODHD الخاص بي', depth:'مدة السجل المشمولة في خطتي', one:'سنة واحدة (حساب مجاني)', five:'خمس سنوات (مشمولة في خطتي)',
    consent:'تسمح خطتي بهذا العرض والتخزين الخاصين. راجعت شروط EODHD.', connect:'فحص EODHD وربطه', busy:'جارٍ الفحص…', connected:'تم ربط EODHD لهذا التبويب', disconnect:'فصل EODHD',
    security:'يبقى المفتاح في ذاكرة هذا التبويب ولا يُرسل إلا إلى واجهة EODHD الثابتة في نسختك، ومنها إلى eodhd.com عبر HTTPS. لا يُحفظ في التخزين الدائم.',
    terms:'شروط EODHD', failed:'الاتصال غير متاح. تحقّق من المفتاح والخطة والحصة والشبكة.',
    storage:"تُحفظ شموع EODHD الأصلية وإغلاقات Standard Bullion اليومية وأسعار الصرف المرجعية على هذا الجهاز، بشكل منفصل لكل حساب ونسخة. يمكن عرض سجل Standard Bullion المحفوظ عند فشل التحديث مع إظهار تاريخ البيانات. يبقى سجل Yahoo في التبويب فقط ولا يُضاف تخزين دائم للمصادر الأخرى.",
    count:'القيم اليومية المحفوظة', temporary:'قيم Yahoo اليومية في هذا التبويب', unavailable:'تخزين المتصفح الدائم غير متاح؛ يمكن استخدام ذاكرة هذا التبويب فقط.',
    clear:'حذف سجل السوق المحفوظ', clearing:'جارٍ الحذف…', clearFailed:'تعذّر حذف ذاكرة السوق بالكامل. حاول مرة أخرى.',
    detail:'يحذف سجل السوق وأسعار الصرف من هذا الجهاز. تبقى معاملاتك وسجلات محفظتك محفوظة.',
  },
} as const;

const WORKSPACE_EVENTS = [BROWSER_WORKSPACE_CHANGE_EVENT, ANONYMOUS_WORKSPACE_MODE_EVENT, 'storage'];
function subscribeWorkspace(listener: () => void): () => void {
  WORKSPACE_EVENTS.forEach(event => window.addEventListener(event, listener));
  return () => WORKSPACE_EVENTS.forEach(event => window.removeEventListener(event, listener));
}
const inactiveWorkspace = () => false;

export function PersonalHistorySettings({ owner }: { owner: string }) {
  const currentOwner = useCallback(() => {
    try { return activeMarketOwner(owner); } catch { return false; }
  }, [owner]);
  const active = useSyncExternalStore(subscribeWorkspace, currentOwner, inactiveWorkspace);
  return active ? <PersonalHistoryOwnerSettings key={owner} owner={owner} /> : null;
}

function PersonalHistoryOwnerSettings({ owner }: { owner: string }) {
  const { language } = useAppTranslation();
  const c = COPY[language === 'de' ? 'de' : language === 'ar' ? 'ar' : 'en'];
  const input = useRef<HTMLInputElement>(null);
  const request = useRef<AbortController | null>(null);
  const startingConnect = useRef(false);
  const mounted = useRef(false);
  const statsRevision = useRef(0);
  const [connected, setConnected] = useState(() => hasEodhd(owner));
  const [years, setYears] = useState<1 | 5>(1);
  const [consent, setConsent] = useState(false);
  const [hasInput, setHasInput] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [stats, setStats] = useState<Awaited<ReturnType<typeof getPersonalHistoryCacheStats>> | null>(null);
  const [clearing, setClearing] = useState(false);
  const [clearFailed, setClearFailed] = useState(false);
  const refreshStats = useCallback(() => {
    const revision = ++statsRevision.current;
    void getPersonalHistoryCacheStats(owner).then(value => {
      if (mounted.current && activeMarketOwner(owner) && revision === statsRevision.current) setStats(value);
    }).catch(() => {
      if (mounted.current && revision === statsRevision.current) setStats(null);
    });
  }, [owner]);
  useEffect(() => {
    mounted.current = true;
    const resetConnection = () => {
      request.current?.abort(); request.current = null;
      if (input.current) input.current.value = '';
      setHasInput(false); setConsent(false); setBusy(false); setFailed(false);
    };
    const sync = () => {
      setConnected(hasEodhd(owner));
      refreshStats();
    };
    const providerChanged = () => {
      // connectEodhd synchronously emits its initial clear and later emits
      // its successful credential. Neither event should cancel that action.
      if (!startingConnect.current && !hasEodhd(owner)) resetConnection();
      sync();
    };
    const sourceChanged = () => {
      if (!startingConnect.current && !(request.current && hasEodhd(owner))) resetConnection();
      sync();
    };
    sync();
    window.addEventListener(EODHD_CHANGE_EVENT, providerChanged);
    window.addEventListener(HISTORY_CACHE_CHANGE_EVENT, sync);
    window.addEventListener(SOURCE_CHANGE, sourceChanged);
    return () => {
      mounted.current = false; statsRevision.current += 1;
      request.current?.abort(); request.current = null;
      if (input.current) input.current.value = '';
      window.removeEventListener(EODHD_CHANGE_EVENT, providerChanged);
      window.removeEventListener(HISTORY_CACHE_CHANGE_EVENT, sync);
      window.removeEventListener(SOURCE_CHANGE, sourceChanged);
    };
  }, [owner, refreshStats]);
  async function connect() {
    if (!input.current || !hasInput || !consent || busy || !activeMarketOwner(owner)) return;
    const token = input.current.value; input.current.value = ''; setHasInput(false);
    const controller = new AbortController(); request.current = controller;
    setBusy(true); setFailed(false);
    try {
      startingConnect.current = true;
      const operation = connectEodhd(owner, token, years, controller.signal);
      startingConnect.current = false;
      await operation;
      if (mounted.current && request.current === controller && !controller.signal.aborted && activeMarketOwner(owner)) setConnected(hasEodhd(owner));
    } catch {
      if (mounted.current && request.current === controller && !controller.signal.aborted && activeMarketOwner(owner)) setFailed(true);
    } finally {
      startingConnect.current = false;
      if (mounted.current && request.current === controller) { request.current = null; setBusy(false); }
    }
  }
  async function clear() {
    if (clearing || !activeMarketOwner(owner)) return;
    setClearing(true); setClearFailed(false);
    try { await clearPersonalHistoryCache(owner); }
    catch { if (mounted.current && activeMarketOwner(owner)) setClearFailed(true); }
    finally { if (mounted.current && activeMarketOwner(owner)) setClearing(false); }
  }
  return <fieldset id="data-sources-history" className="financial-provider-form" dir={language === 'ar' ? 'rtl' : 'ltr'} style={{ display:'grid', gap:10, minWidth:0, textAlign:'start' }}>
    <legend><strong>{c.sectionTitle}</strong></legend>
    <p>{c.info}</p>
    <a href="https://eodhd.com/financial-apis/terms-conditions" target="_blank" rel="noreferrer">{c.terms}</a>
    {connected ? <>
      <p role="status">{c.connected}</p>
      <button type="button" className="btn btn-secondary" onClick={() => { clearEodhd(); setConsent(false); }}>{c.disconnect}</button>
    </> : <>
      <label>{c.key}<input ref={input} className="input" type="password" dir="ltr" maxLength={256} autoComplete="off" autoCapitalize="none" spellCheck={false} disabled={busy} onInput={e => setHasInput(!!e.currentTarget.value.trim())} /></label>
      <label>{c.depth}<select className="input" value={years} disabled={busy} onChange={e => setYears(e.target.value === '5' ? 5 : 1)}><option value="1">{c.one}</option><option value="5">{c.five}</option></select></label>
      <label className="financial-provider-consent"><input type="checkbox" checked={consent} disabled={busy} onChange={e => setConsent(e.target.checked)} /><span>{c.consent}</span></label>
      <p className="panel-subtitle">{c.security}</p>
      <button type="button" className="btn btn-primary" disabled={!hasInput || !consent || busy} onClick={() => void connect()}>{busy ? c.busy : c.connect}</button>
      {failed && <p role="alert">{c.failed}</p>}
    </>}
    <p>{c.storage}</p>
    {stats && <p role="status">{c.count}: <bdi>{stats.barCount.toLocaleString(language)}</bdi> · {c.temporary}: <bdi>{stats.ephemeralBarCount.toLocaleString(language)}</bdi></p>}
    {stats?.persistence.mode === 'memory' && <p>{c.unavailable}</p>}
    <p className="panel-subtitle">{c.detail}</p>
    <button type="button" className="btn btn-secondary" disabled={clearing} onClick={() => void clear()}>{clearing ? c.clearing : c.clear}</button>
    {clearFailed && <p role="alert">{c.clearFailed}</p>}
  </fieldset>;
}
