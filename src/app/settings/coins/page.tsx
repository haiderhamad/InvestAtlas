'use client';

import AppShell from '@/components/layout/app-shell';
import { PersonalSecurityManager } from '@/components/settings/personal-security-manager';
import PageQuickStart from '@/components/layout/page-quick-start';
import { ShieldCheck, Plus, Trash2, Search, Loader, RefreshCw, CheckCircle, XCircle, Filter } from 'lucide-react';
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import type { CoinConfig } from '@/lib/config/supported-coins';
import type { HalalCheckResult } from '@/app/api/coins/check/route';
import { useAppTranslation } from '@/lib/i18n/use-app-translation';
import {
  SUPPORTED_ETF_ASSETS,
  SUPPORTED_METAL_ASSETS,
  SUPPORTED_STOCK_ASSETS,
  getAssetShariahStatus,
  type AssetClass,
  type AssetConfig,
} from '@/lib/config/supported-assets';
import {
  getShariahDecisionLabel,
  getShariahDecisionReason,
  isShariahCompliant,
  SHARIAH_DECISION_STATUSES,
  type ShariahDecisionStatus,
} from '@/lib/shariah/decision';
import { saveAssetIcon, saveAssetIcons } from '@/lib/config/asset-icon-store';
import { AssetIcon } from '@/components/ui/asset-icon';
import { useAuth } from '@/lib/auth/auth-context';
import { doc, setDoc, getDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { getFirebaseAuthHeaders } from '@/lib/auth/firebase-api-auth';
import {
  readHiddenAssets,
  readUserAssets,
  writeHiddenAssets,
  writeUserAssets,
  USER_ASSETS_CHANGE_EVENT,
  type LocalUserAsset,
} from '@/lib/config/user-assets-store';

// ─── Types ────────────────────────────────────────────────────────────────────

interface AuditRow extends HalalCheckResult {
  checked: boolean;
}

type UnifiedAssetType = 'crypto' | 'stock' | 'etf' | 'metal';
type AssetFilterType = 'all' | UnifiedAssetType;

interface UnifiedAsset {
  symbol: string;
  name: string;
  type: UnifiedAssetType;
  status: ShariahDecisionStatus;
  reason?: string;
  isRemovable: boolean;
  isin?: string;
  wkn?: string;
  tickers?: string[];
  identifierTokens: string[];
  identifierLabel: string;
}

interface AssetSearchResult {
  id: string;
  symbol: string;
  canonicalSymbol?: string;
  name: string;
  type: UnifiedAssetType;
  exchange?: string;
  source?: string;
  thumb?: string;
  alreadyExists?: boolean;
  isin?: string;
  wkn?: string;
  tickers?: string[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function ConfidenceBadge({ value }: { value: 'high' | 'medium' | 'low' }) {
  const { t } = useAppTranslation();
  const colors: Record<string, string> = {
    high:   'rgba(34,197,94,0.15)',
    medium: 'rgba(234,179,8,0.15)',
    low:    'rgba(239,68,68,0.15)',
  };
  const text: Record<string, string> = { 
    high: t('High'), 
    medium: t('Medium'), 
    low: t('Low') 
  };
  return (
    <span style={{
      padding: '2px 8px', borderRadius: 4, fontSize: 11,
      background: colors[value], color: 'var(--text-secondary)',
    }}>
      {text[value]}
    </span>
  );
}

function ShariahStatusBadge({ status }: { status: ShariahDecisionStatus }) {
  const { t } = useAppTranslation();
  const isPositive = status === 'compliant';
  const isNegative = status === 'non_compliant';
  const isReview = status === 'review_required';
  const Icon = isPositive ? CheckCircle : isNegative ? XCircle : Search;
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      padding: '3px 10px', borderRadius: 4, fontSize: 11, fontWeight: 600,
      background: isPositive
        ? 'rgba(34,197,94,0.15)'
        : isNegative
          ? 'rgba(239,68,68,0.15)'
          : isReview
            ? 'rgba(234,179,8,0.15)'
            : 'var(--bg-elevated)',
      color: isPositive ? '#22c55e' : isNegative ? '#ef4444' : isReview ? '#eab308' : 'var(--text-muted)',
    }}>
      <Icon size={12} />
      {t(getShariahDecisionLabel(status))}
    </span>
  );
}

function getCheckDecisionStatus(result: Partial<HalalCheckResult> | null | undefined): ShariahDecisionStatus {
  if (result?.status && SHARIAH_DECISION_STATUSES.includes(result.status)) {
    return result.status;
  }
  if (result?.halal === false && !result.requiresManualReview) {
    return 'non_compliant';
  }
  if (result?.requiresManualReview || result?.halal === true) {
    return 'review_required';
  }
  return 'insufficient_data';
}

function toUnifiedAssetType(value: string | undefined): UnifiedAssetType {
  if (value === 'crypto' || value === 'stock' || value === 'etf' || value === 'metal') return value;
  return 'stock';
}

function buildIdentifierLabel(asset: {
  symbol: string;
  yahooSymbol?: string;
  yahooFallbackSymbol?: string;
  isin?: string;
  wkn?: string;
  searchAliases?: string[];
  tickers?: string[];
}) {
  const tickers = Array.from(new Set([
    asset.yahooSymbol,
    asset.yahooFallbackSymbol,
    ...(asset.tickers ?? []),
    ...(asset.searchAliases ?? []),
  ].filter((value): value is string => Boolean(value?.trim()))));

  const parts = [`Symbol: ${asset.symbol}`];
  if (tickers.length > 0) parts.push(`Ticker: ${tickers.slice(0, 3).join(' / ')}`);
  if (asset.isin) parts.push(`ISIN: ${asset.isin}`);
  if (asset.wkn) parts.push(`WKN: ${asset.wkn}`);
  return parts.join(' · ');
}

function normalizeLocalAssetIdentifier(value: string | null | undefined): string {
  return (value ?? '').trim().toUpperCase().replace(/[\s-]+/g, '');
}

function getConfiguredAssetIdentifiers(asset: AssetConfig): string[] {
  return Array.from(new Set([
    asset.symbol,
    asset.yahooSymbol,
    asset.yahooFallbackSymbol,
    asset.isin,
    asset.wkn,
    ...(asset.searchAliases ?? []),
  ].filter((value): value is string => Boolean(value?.trim())).map((value) => value.trim().toUpperCase())));
}

function getConfiguredAssetTickers(asset: AssetConfig): string[] {
  return getConfiguredAssetIdentifiers(asset).filter((identifier) => (
    identifier !== asset.symbol &&
    identifier !== asset.isin &&
    identifier !== asset.wkn
  ));
}

function getConfiguredAssetSearchTokens(asset: AssetConfig): string[] {
  return [
    asset.symbol,
    asset.name,
    asset.yahooSymbol,
    asset.yahooFallbackSymbol,
    asset.isin,
    asset.wkn,
    ...(asset.searchAliases ?? []),
  ].filter((value): value is string => Boolean(value?.trim()));
}

function findConfiguredAssetByIdentifier(value: string | null | undefined, assetClass?: AssetClass): AssetConfig | undefined {
  const normalized = normalizeLocalAssetIdentifier(value);
  if (!normalized) return undefined;

  const assets = [
    ...SUPPORTED_STOCK_ASSETS,
    ...SUPPORTED_ETF_ASSETS,
    ...SUPPORTED_METAL_ASSETS,
  ].filter((asset) => !assetClass || asset.assetClass === assetClass);

  return assets.find((asset) =>
    getConfiguredAssetIdentifiers(asset).some((identifier) => normalizeLocalAssetIdentifier(identifier) === normalized),
  );
}

function buildConfiguredAssetRow(
  asset: AssetConfig,
  status: UnifiedAsset['status'],
  reason: string | undefined,
  isRemovable: boolean,
): UnifiedAsset {
  const tickers = getConfiguredAssetTickers(asset);
  return {
    symbol: asset.symbol,
    name: asset.name,
    type: asset.assetClass,
    status,
    reason,
    isRemovable,
    isin: asset.isin,
    wkn: asset.wkn,
    tickers,
    identifierTokens: getConfiguredAssetSearchTokens(asset),
    identifierLabel: buildIdentifierLabel({ ...asset, tickers }),
  };
}

function getLocalAssetIdentifiers(asset: LocalUserAsset): string[] {
  return Array.from(new Set([
    asset.symbol,
    asset.yahooSymbol,
    asset.isin,
    asset.wkn,
    ...(asset.searchAliases ?? []),
  ].filter((value): value is string => Boolean(value?.trim()))));
}

function hasIdentifierOverlap(left: string[], right: string[]): boolean {
  const normalizedRight = new Set(right.map(normalizeLocalAssetIdentifier));
  return left.some((identifier) => normalizedRight.has(normalizeLocalAssetIdentifier(identifier)));
}

function buildExistingAssetCheckResult(asset: AssetConfig): HalalCheckResult {
  const status = getAssetShariahStatus(asset);
  return {
    symbol: asset.symbol,
    name: asset.name,
    status,
    halal: isShariahCompliant(status),
    confidence: status === 'non_compliant' ? 'high' : 'low',
    reason: getShariahDecisionReason(status),
    checkedBy: 'ruleset',
    sourceType: 'internal_ruleset',
    sourceLabel: 'InvestAtlas asset universe',
    methodLabel: 'Identifier match — evidence status unchanged',
    lastCheckedAt: new Date().toISOString(),
    requiresManualReview: status === 'review_required' || status === 'insufficient_data',


    certificateStatus: asset.assetClass === 'crypto' ? 'not_applicable' : 'not_verified',
    certificateLabel: asset.assetClass === 'crypto' ? 'Not applicable' : 'No scholar certificate stored in InvestAtlas',
    criteria: [
      asset.isin ? `ISIN: ${asset.isin}` : `Symbol: ${asset.symbol}`,
      asset.wkn ? `WKN: ${asset.wkn}` : 'Canonical universe match',
      ...getConfiguredAssetTickers(asset).slice(0, 2).map((ticker) => `Ticker: ${ticker}`),
    ],
  };
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function CoinsSettingsPage() {
  const { t, language } = useAppTranslation();
  const { user } = useAuth();
  const [coins, setCoins] = useState<CoinConfig[]>([]);
  const [loadingCoins, setLoadingCoins] = useState(true);

  // Add-coin form
  const [inputSymbol, setInputSymbol] = useState('');
  const skipNextSearch = useRef(false);
  const searchContainerRef = useRef<HTMLDivElement>(null);
  const [inputType, setInputType] = useState<UnifiedAssetType>('crypto');
  const [checkResult, setCheckResult] = useState<HalalCheckResult | null>(null);
  const [checking, setChecking] = useState(false);
  const [adding, setAdding] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [hiddenAssets, setHiddenAssets] = useState<string[]>([]);
  const [searchResults, setSearchResults] = useState<AssetSearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [userAssets, setUserAssets] = useState<LocalUserAsset[]>([]);
  const [existingAssetMatch, setExistingAssetMatch] = useState<AssetConfig | null>(null);

  // Audit
  const [auditRows, setAuditRows] = useState<AuditRow[]>([]);
  const [auditing, setAuditing] = useState(false);
  const [auditProgress, setAuditProgress] = useState(0);

  // Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [filterType, setFilterType] = useState<AssetFilterType>('all');

  const inputTypeOptions: Array<{ value: UnifiedAssetType; label: string }> = [
    { value: 'crypto', label: t('Crypto') },
    { value: 'stock', label: t('Stock') },
    { value: 'etf', label: t('ETF') },
  ];

  const filterTypeOptions: Array<{ value: AssetFilterType; label: string }> = [
    { value: 'all', label: t('All Types') },
    { value: 'crypto', label: t('Crypto') },
    { value: 'stock', label: t('Stocks') },
    { value: 'etf', label: t('ETFs') },
    { value: 'metal', label: t('Metals') },
  ];

  // ── Search effect ───────────────────────────────────────────────────────────
  useEffect(() => {
    if (skipNextSearch.current) {
      skipNextSearch.current = false;
      return;
    }

    if (inputSymbol.trim().length < 2) {
      setSearchResults([]);
      return;
    }

    const timer = setTimeout(async () => {
      setIsSearching(true);
      try {
        const res = await fetch(`/api/assets/search?query=${encodeURIComponent(inputSymbol)}`);
        if (res.ok) {
          const data = await res.json();
          setSearchResults(data.results || []);
        }
      } catch (err) {
        console.error('Search failed:', err);
      } finally {
        setIsSearching(false);
      }
    }, 500);

    return () => clearTimeout(timer);
  }, [inputSymbol]);

  // ── Click outside search dropdown ───────────────────────────────────────────
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (searchContainerRef.current && !searchContainerRef.current.contains(event.target as Node)) {
        setSearchResults([]);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // ── Load coins ──────────────────────────────────────────────────────────────
  const loadCoins = useCallback(async (signal?: AbortSignal) => {
    setLoadingCoins(true);
    try {
      const res = await fetch('/api/coins', { signal });
      if (!res.ok) return;
      const data = await res.json() as { coins: CoinConfig[] };
      setCoins(data.coins ?? []);
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return;
      console.error('Coins load failed:', err);
    } finally {
      setLoadingCoins(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void loadCoins(controller.signal);
    return () => controller.abort();
  }, [loadCoins]);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      setUserAssets(readUserAssets());
      if (!user) {
        setHiddenAssets(readHiddenAssets());
        return;
      }

      // Signed-in users use the canonical Firebase document only. Anonymous
      // Local Workspace state is deliberately not merged into this account.
      setHiddenAssets([]);
      const fetchHidden = async () => {
        try {
          const docRef = doc(db, 'user_hidden_assets', user.id);
          const docSnap = await getDoc(docRef);
          const cloudHidden = docSnap.exists()
            ? docSnap.data().symbols
            : [];
          if (
            !Array.isArray(cloudHidden)
            || cloudHidden.some(
              (symbol) =>
                typeof symbol !== 'string'
                || !/^[A-Z0-9][A-Z0-9._-]{0,31}$/.test(symbol),
            )
          ) {
            throw new Error('Invalid hidden-assets document.');
          }
          setHiddenAssets([...new Set(cloudHidden)]);
        } catch {
          setFormError(t('Hidden asset preferences are temporarily unavailable.'));
        }
      };
      void fetchHidden();
    }
  }, [t, user]);

  // ── Check a single symbol ────────────────────────────────────────────────────
  async function handleCheck() {
    const sym = inputSymbol.trim().toUpperCase();
    if (!sym) return;
    setSearchResults([]); // Close search dropdown
    setChecking(true);
    setCheckResult(null);
    setExistingAssetMatch(null);
    setFormError(null);

    try {
      const existingAsset = findConfiguredAssetByIdentifier(sym);
      if (existingAsset) {
        setInputType(toUnifiedAssetType(existingAsset.assetClass));
        setExistingAssetMatch(existingAsset);
        setCheckResult(buildExistingAssetCheckResult(existingAsset));
        return;
      }

      const res = await fetch('/api/coins/check', {
        method: 'POST',
        headers: await getFirebaseAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ symbol: sym, type: inputType, language }),
      });
      const data = await res.json() as HalalCheckResult & { error?: string };
      if (!res.ok) {
        throw new Error(data.error ?? 'Check failed.');
      }
      const serverMatch = findConfiguredAssetByIdentifier(data.symbol);
      if (serverMatch) {
        setInputType(toUnifiedAssetType(serverMatch.assetClass));
        setExistingAssetMatch(serverMatch);
        setCheckResult(buildExistingAssetCheckResult(serverMatch));
      } else {
        setCheckResult(data);
      }
      if (data.iconUrl) {
        saveAssetIcon(data.symbol, data.iconUrl);
      }
    } catch {
      setFormError(t('Check failed. Please try again.'));
    } finally {
      setChecking(false);
    }
  }

  // ── Add checked coin ─────────────────────────────────────────────────────────
  async function handleAdd() {
    if (!checkResult || getCheckDecisionStatus(checkResult) !== 'compliant') return;
    setAdding(true);
    setFormError(null);

    try {
      const centralDuplicate = existingAssetMatch ?? findConfiguredAssetByIdentifier(checkResult.symbol) ?? findConfiguredAssetByIdentifier(inputSymbol);
      if (centralDuplicate) {
        throw new Error(t('This asset is already part of your tracked universe.'));
      }

      if (inputType === 'crypto') {
        const res = await fetch('/api/coins', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ symbol: checkResult.symbol, name: checkResult.name }),
        });
        const data = await res.json() as { coins?: CoinConfig[]; error?: string };
        if (!res.ok) throw new Error(data.error);
        setCoins(data.coins ?? []);
      } else {
        // Store in localStorage for now
        const localUserAssets = readUserAssets();
        const getBaseSymbol = (sym: string) => sym.split('.')[0].toUpperCase();
        const inputBase = getBaseSymbol(checkResult.symbol);
        const newIdentifiers = [
          checkResult.symbol,
          inputSymbol,
        ].filter((value): value is string => Boolean(value?.trim()));
        
        const isDuplicate = localUserAssets.some((a) => {
          const baseA = getBaseSymbol(a.symbol);
          const nameA = a.name.trim().toLowerCase();
          const nameB = checkResult.name.trim().toLowerCase();
          
          const minLen = Math.min(nameA.length, nameB.length);
          const nameMatch = nameA === nameB || (minLen > 25 && (nameA.startsWith(nameB) || nameB.startsWith(nameA)));
          
          return baseA === inputBase || nameMatch || hasIdentifierOverlap(newIdentifiers, getLocalAssetIdentifiers(a));
        });
        
        if (!isDuplicate) {
          const newAsset: LocalUserAsset = { 
            symbol: checkResult.symbol, 
            name: checkResult.name, 
            assetClass: inputType,
            yahooSymbol: checkResult.symbol.includes('.') ? checkResult.symbol : undefined,
          };
          localUserAssets.push(newAsset);
          writeUserAssets(localUserAssets);
          setUserAssets(localUserAssets);
        } else {
          throw new Error(t('This asset is already in your list.'));
        }
      }
      
      setInputSymbol('');
      setCheckResult(null);
      setExistingAssetMatch(null);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : t('Error adding.'));
    } finally {
      setAdding(false);
    }
  }

  // ── Remove coin ──────────────────────────────────────────────────────────────
  async function handleRemove(symbol: string) {
    try {
      // Check if it's in userAssets
      const localUserAssets = readUserAssets();
      const index = localUserAssets.findIndex((a) => a.symbol === symbol);
      if (index !== -1) {
        localUserAssets.splice(index, 1);
        writeUserAssets(localUserAssets);
        setUserAssets(localUserAssets);
        return;
      }

      // Check if it's a crypto coin in Firestore
      const isCrypto = coins.some(c => c.symbol === symbol);
      if (isCrypto) {
        const res = await fetch('/api/coins', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ symbol }),
        });
        const data = await res.json() as { coins?: CoinConfig[] };
        if (res.ok) {
          setCoins(data.coins ?? []);
          return;
        }
      }

      // Otherwise, add to hiddenAssets (for hardcoded assets)
      const nextHiddenAssets = hiddenAssets.includes(symbol)
        ? hiddenAssets
        : [...hiddenAssets, symbol];
      if (user) {
        const docRef = doc(db, 'user_hidden_assets', user.id);
        await setDoc(docRef, { symbols: nextHiddenAssets });
      } else {
        writeHiddenAssets(nextHiddenAssets);
      }
      setHiddenAssets(nextHiddenAssets);
    } catch {
      setFormError(t('Hidden asset preferences could not be saved.'));
    }
  }

  // ── Audit assets ────────────────────────────────────────────────────────────
  async function handleAudit(target: 'all' | string) {
    setAuditing(true);
    setAuditProgress(0);

    const assetsToAudit = target === 'all' 
      ? filteredAssets 
      : unifiedAssets.filter(a => a.symbol === target);

    // Check one by one
    const newRows = [...auditRows];
    const newIcons: Record<string, string> = {};
    for (let i = 0; i < assetsToAudit.length; i++) {
      const asset = assetsToAudit[i];
      try {
        const res = await fetch('/api/coins/check', {
          method: 'POST',
          headers: await getFirebaseAuthHeaders({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({ symbol: asset.symbol, type: asset.type, language }),
        });
        const data = await res.json() as HalalCheckResult & { error?: string };
        if (!res.ok) {
          throw new Error(data.error ?? 'Check failed.');
        }
        
        // Upsert result
        const idx = newRows.findIndex(r => r.symbol === asset.symbol);
        if (idx !== -1) newRows[idx] = { ...data, checked: true };
        else newRows.push({ ...data, checked: true });
        
        if (data.iconUrl) {
          newIcons[data.symbol] = data.iconUrl;
        }
      } catch {
        const unavailable: AuditRow = {
          symbol: asset.symbol,
          name: asset.name,
          status: 'insufficient_data',
          halal: false,
          confidence: 'low',
          reason: 'The evidence check failed. No Shariah decision was made.',
          checkedBy: 'ruleset',
          sourceType: 'internal_ruleset',
          sourceLabel: 'InvestAtlas evidence gate',
          methodLabel: 'Check unavailable',
          lastCheckedAt: new Date().toISOString(),
          requiresManualReview: true,
          criteria: [],
          checked: true,
        };
        const idx = newRows.findIndex(r => r.symbol === asset.symbol);
        if (idx !== -1) newRows[idx] = unavailable;
        else newRows.push(unavailable);
      }
      setAuditProgress(i + 1);
      setAuditRows([...newRows]);
    }
    
    if (Object.keys(newIcons).length > 0) {
      saveAssetIcons(newIcons);
    }
    setAuditing(false);
  }

  const equityUniverse = SUPPORTED_STOCK_ASSETS;
  const islamicEtfUniverse = SUPPORTED_ETF_ASSETS;
  const screeningSources = [
    {
      title: t('Internal ruleset'),
      status: t('Review gate'),
      badge: 'badge-yellow',
      detail: t('Legacy allow-list entries remain trackable but do not become compliant without current evidence.'),
    },
    {
      title: t('AI decisions'),
      status: t('Disabled'),
      badge: 'badge-gray',
      detail: t('AI cannot create Shariah facts, sources, certificates, or final decisions.'),
    },
    {
      title: t('External manual cross-check'),
      status: t('Required'),
      badge: 'badge-yellow',
      detail: t('Use external screeners such as Zoya, Practical Islamic Finance, and Sharlife to verify stocks, ETFs, and unclear crypto assets.'),
    },
  ];

  const unifiedAssets = useMemo(() => {
    const list: UnifiedAsset[] = [];
    const knownIdentifiers: string[] = [];
    const rememberIdentifiers = (identifiers: string[]) => {
      knownIdentifiers.push(...identifiers);
    };

    // Add User-Added Crypto
    coins.forEach((coin) => {
      const auditRow = auditRows.find((r) => r.symbol === coin.symbol);
      const identifiers = [coin.symbol, coin.name];
      rememberIdentifiers(identifiers);
      list.push({
        symbol: coin.symbol,
        name: coin.name,
        type: 'crypto',
        status: auditRow ? getCheckDecisionStatus(auditRow) : 'insufficient_data',
        reason: auditRow?.reason ?? getShariahDecisionReason(
          auditRow ? getCheckDecisionStatus(auditRow) : 'insufficient_data',
        ),
        isRemovable: true,
        identifierTokens: identifiers,
        identifierLabel: buildIdentifierLabel({ symbol: coin.symbol }),
      });
    });

    // Add Core Equities
    SUPPORTED_STOCK_ASSETS.forEach((stock) => {
      const auditRow = auditRows.find((r) => r.symbol === stock.symbol);
      const status = auditRow
        ? getCheckDecisionStatus(auditRow)
        : getAssetShariahStatus(stock);
      rememberIdentifiers(getConfiguredAssetIdentifiers(stock));
      list.push(buildConfiguredAssetRow(
        stock,
        status,
        auditRow?.reason ?? getShariahDecisionReason(status),
        true,
      ));
    });

    // Add trackable Islamic-market ETFs; evidence status is resolved separately.
    SUPPORTED_ETF_ASSETS.forEach((etf) => {
      const auditRow = auditRows.find((r) => r.symbol === etf.symbol);
      const status = auditRow
        ? getCheckDecisionStatus(auditRow)
        : getAssetShariahStatus(etf);
      rememberIdentifiers(getConfiguredAssetIdentifiers(etf));
      list.push(buildConfiguredAssetRow(
        etf,
        status,
        auditRow?.reason ?? getShariahDecisionReason(status),
        true,
      ));
    });

    // Add Precious Metals
    SUPPORTED_METAL_ASSETS.forEach((metal) => {
      const status = getAssetShariahStatus(metal);
      rememberIdentifiers(getConfiguredAssetIdentifiers(metal));
      list.push(buildConfiguredAssetRow(
        metal,
        status,
        getShariahDecisionReason(status),
        true,
      ));
    });



    // Add User-Added Stocks/ETFs from LocalStorage
    userAssets.forEach((asset) => {
      const identifiers = getLocalAssetIdentifiers(asset);
      const matchesCentralAsset = identifiers.some((identifier) => Boolean(findConfiguredAssetByIdentifier(identifier)));
      const matchesKnownAsset = hasIdentifierOverlap(identifiers, knownIdentifiers);

      if (!matchesCentralAsset && !matchesKnownAsset && !list.some(a => a.symbol === asset.symbol)) {
        rememberIdentifiers(identifiers);
        list.push({
          symbol: asset.symbol,
          name: asset.name,
          type: asset.assetClass,
          status: 'insufficient_data',
          reason: getShariahDecisionReason('insufficient_data'),
          isRemovable: true,
          isin: asset.isin,
          wkn: asset.wkn,
          tickers: [asset.yahooSymbol, ...(asset.searchAliases ?? [])].filter((value): value is string => Boolean(value?.trim())),
          identifierTokens: [asset.symbol, asset.name, ...identifiers],
          identifierLabel: buildIdentifierLabel(asset),
        });
      }
    });

    return list.filter(a => !hiddenAssets.includes(a.symbol));
  }, [coins, auditRows, userAssets, hiddenAssets]);

  useEffect(() => {
    const sync = () => setUserAssets(readUserAssets());
    window.addEventListener(USER_ASSETS_CHANGE_EVENT, sync);
    window.addEventListener('storage', sync);
    return () => { window.removeEventListener(USER_ASSETS_CHANGE_EVENT, sync); window.removeEventListener('storage', sync); };
  }, []);

  const filteredAssets = useMemo(() => {
    const normalizedQuery = normalizeLocalAssetIdentifier(searchQuery);
    const lowerQuery = searchQuery.toLowerCase();

    return unifiedAssets.filter((asset) => {
      const matchesSearch =
        asset.symbol.toLowerCase().includes(searchQuery.toLowerCase()) ||
        asset.name.toLowerCase().includes(lowerQuery) ||
        asset.identifierLabel.toLowerCase().includes(lowerQuery) ||
        asset.identifierTokens.some((token) => (
          token.toLowerCase().includes(lowerQuery) ||
          normalizeLocalAssetIdentifier(token).includes(normalizedQuery)
        ));
      const matchesType = filterType === 'all' || asset.type === filterType;
      return matchesSearch && matchesType;
    });
  }, [unifiedAssets, searchQuery, filterType]);

  return (
    <AppShell>
      <div className="page-header">
        <h1 className="page-title">
          <ShieldCheck size={24} style={{ display: 'inline', marginRight: 8, color: '#22c55e' }} />
          {t('Asset Checks')}
        </h1>

      </div>

      <div className="page-content animate-in" style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
        <PersonalSecurityManager />
        {true && (
          <>


        <div className="grid-4" style={{ marginBottom: 8, gap: 16 }}>
          {[
            { label: t('Tracked crypto'), value: coins.length, color: 'var(--accent-blue)' },
            { label: t('Core equities'), value: equityUniverse.length, color: 'var(--accent-teal)' },
            { label: t('Tracked ETFs'), value: islamicEtfUniverse.length, color: 'var(--accent-cyan)' },
            { label: t('Precious metals'), value: SUPPORTED_METAL_ASSETS.length, color: 'var(--yellow)' },
          ].map((item) => (
            <div key={item.label} style={{ background: 'var(--surface-soft)', padding: '20px 16px', borderRadius: 16, border: '1px solid var(--surface-border-soft)' }}>
              <div style={{ color: 'var(--text-muted)', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>{item.label}</div>
              <div style={{ fontSize: 24, fontWeight: 800, color: item.color, lineHeight: 1 }}>{item.value}</div>
            </div>
          ))}
        </div>

        <div className="card">
          <div className="panel-header">
            <div>
              <div className="section-title">{t('Compliance Transparency')}</div>

            </div>
          </div>

          <div className="grid-3" style={{ marginBottom: 16, gap: 16 }}>
            {screeningSources.map((source) => (
              <div
                key={source.title}
                style={{ 
                  background: 'var(--surface-accent-soft)', 
                  padding: 20, 
                  borderRadius: 16, 
                  border: '1px solid var(--surface-border-soft)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 12
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>{source.title}</div>
                  <span className={`badge ${source.badge}`} style={{ fontSize: 10, textTransform: 'uppercase' }}>{source.status}</span>
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
                  {source.detail}
                </div>
              </div>
            ))}
          </div>

          <div className="insight-list">
            <div className="insight-row">
              <div>
                <div style={{ fontWeight: 700 }}>{t('Rules currently applied')}</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                  {t('These criteria are surfaced inside every single compliance check result.')}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                <span className="badge badge-teal">{t('No riba mechanics')}</span>
                <span className="badge badge-teal">{t('No pure gharar')}</span>
                <span className="badge badge-teal">{t('No maysir focus')}</span>
                <span className="badge badge-teal">{t('No haram industries')}</span>
              </div>
            </div>
            <div className="insight-row">
              <div>
                <div style={{ fontWeight: 700 }}>{t('User trust posture')}</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                  {t('The local ruleset can flag core-activity exclusions. All positive decisions require current, dated evidence.')}
                </div>
              </div>
              <div className="mono" style={{ color: 'var(--text-secondary)', fontSize: '11px' }}>
                {t('Evidence required')}
              </div>
            </div>
          </div>
        </div>

        {/* ── Add new asset section ────────────────────────────────────────── */}
        <div className="card">
          <div className="panel-header">
            <div>
              <div className="section-title">{t('Screen New Asset')}</div>

            </div>
          </div>
          
          <div className="grid-2">
            <div>
              <div className="asset-check-controls" style={{ display: 'flex', gap: 8, marginBottom: 12, alignItems: 'flex-start' }}>
                <div className="asset-type-segmented" role="radiogroup" aria-label={t('Asset type')}>
                  {inputTypeOptions.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      className={`asset-type-option ${inputType === option.value ? 'active' : ''}`}
                      role="radio"
                      aria-checked={inputType === option.value}
                      onClick={() => setInputType(option.value)}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
                <div ref={searchContainerRef} style={{ position: 'relative', flex: 1 }}>
                  <input
                    className="input"
                    placeholder={t('Search by name, ticker, WKN, or ISIN')}
                    value={inputSymbol}
                    onChange={e => { setInputSymbol(e.target.value.toUpperCase()); setCheckResult(null); setExistingAssetMatch(null); setFormError(null); }}
                    onKeyDown={e => e.key === 'Enter' && handleCheck()}
                    style={{ width: '100%', textTransform: 'uppercase', letterSpacing: '0.5px', fontFamily: 'monospace', fontSize: '14px' }}
                    maxLength={12}
                  />
                  {isSearching && <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>{t('Searching...')}</div>}
                  {!isSearching && inputSymbol.trim().length >= 2 && searchResults.length === 0 && (
                    <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>{t('No results found')}</div>
                  )}
                  {searchResults.length > 0 && (
                    <div style={{
                      position: 'absolute',
                      top: '100%',
                      left: 0,
                      right: 0,
                      background: 'var(--bg-elevated)',
                      border: '1px solid var(--border)',
                      borderRadius: 8,
                      zIndex: 10,
                      maxHeight: 200,
                      overflowY: 'auto',
                      boxShadow: '0 4px 12px rgba(0,0,0,0.1)'
                    }}>
                      {searchResults.map((result) => (
                        <div
                          key={result.id}
                          style={{
                            padding: '8px 12px',
                            cursor: 'pointer',
                            borderBottom: '1px solid var(--border)',
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center'
                          }}
                          onClick={() => {
                            const canonicalSymbol = result.canonicalSymbol ?? result.symbol;
                            const matchedAsset = result.alreadyExists ? findConfiguredAssetByIdentifier(canonicalSymbol) ?? null : null;
                            skipNextSearch.current = true;
                            setInputSymbol(canonicalSymbol);
                            setInputType(toUnifiedAssetType(result.type));
                            setExistingAssetMatch(matchedAsset);
                            setCheckResult(matchedAsset ? buildExistingAssetCheckResult(matchedAsset) : null);
                            setSearchResults([]);
                          }}
                          onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-page)'}
                          onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                        >
                          <div>
                            <div style={{ fontWeight: 500 }}>{result.name}</div>
                            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                              {(result.canonicalSymbol ?? result.symbol)} • {result.exchange}
                              {result.isin ? ` • ${result.isin}` : ''}
                            </div>
                          </div>
                          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                            {result.alreadyExists && (
                              <span className="badge badge-blue" style={{ fontSize: 10 }}>
                                {t('Already in Universe')}
                              </span>
                            )}
                            <div style={{ fontSize: 11, color: 'var(--text-muted)', background: 'var(--bg-page)', padding: '2px 6px', borderRadius: 4 }}>
                              {result.type}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <button
                  className="btn btn-secondary"
                  onClick={handleCheck}
                  disabled={checking || !inputSymbol.trim()}
                  style={{ display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' }}
                >
                  {checking
                    ? <Loader size={14} className="loading-spin" />
                    : <Search size={14} />
                  }
                  {checking ? t('Checking…') : t('Check')}
                </button>
              </div>

              {checkResult && (
                <div className="animate-in" style={{
                  padding: 16,
                  borderRadius: 'var(--radius-md)',
                  border: `1px solid ${
                    getCheckDecisionStatus(checkResult) === 'compliant'
                      ? 'rgba(34,197,94,0.3)'
                      : getCheckDecisionStatus(checkResult) === 'non_compliant'
                        ? 'rgba(239,68,68,0.3)'
                        : 'rgba(234,179,8,0.3)'
                  }`,
                  background: getCheckDecisionStatus(checkResult) === 'compliant'
                    ? 'rgba(34,197,94,0.06)'
                    : getCheckDecisionStatus(checkResult) === 'non_compliant'
                      ? 'rgba(239,68,68,0.06)'
                      : 'rgba(234,179,8,0.06)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 12,
                }}>
                  {(() => {
                    const matchedExistingAsset = existingAssetMatch ?? findConfiguredAssetByIdentifier(checkResult.symbol) ?? findConfiguredAssetByIdentifier(inputSymbol);
                    const displaySymbol = matchedExistingAsset?.symbol ?? checkResult.symbol;
                    const displayName = matchedExistingAsset?.name ?? checkResult.name;
                    const displayType = matchedExistingAsset?.assetClass ?? inputType;
                    const decisionStatus = getCheckDecisionStatus(checkResult);
                    const identifierLabel = matchedExistingAsset ? buildIdentifierLabel({ ...matchedExistingAsset, tickers: getConfiguredAssetTickers(matchedExistingAsset) }) : null;
                    const isAlreadyAdded = Boolean(matchedExistingAsset) || unifiedAssets.some(
                      a => a.symbol.toUpperCase() === checkResult.symbol.toUpperCase() && a.type === inputType
                    );

                    return (
                      <>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                            <AssetIcon 
                              symbol={displaySymbol} 
                              name={displayName} 
                              assetClass={displayType as AssetClass} 
                              size={40}
                            />
                            <div>
                              <div style={{ fontWeight: 700, fontSize: 15 }}>
                                {displaySymbol}
                                <span style={{ fontWeight: 400, color: 'var(--text-muted)', marginLeft: 8, fontSize: 13 }}>
                                  {displayName}
                                </span>
                              </div>
                              {identifierLabel && (
                                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                                  {identifierLabel}
                                </div>
                              )}
                              <div style={{ marginTop: 4 }}>
                                {isAlreadyAdded
                                  ? <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{t('Already in your Universe')}</span>
                                  : <ShariahStatusBadge status={decisionStatus} />}
                              </div>
                            </div>
                          </div>
                          <ConfidenceBadge value={checkResult.confidence} />
                        </div>

                        <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                          {t(checkResult.reason)}
                        </div>

                        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                          {decisionStatus === 'compliant' && checkResult.criteria.map((criterion) => (
                            <span key={criterion} className="badge badge-teal" style={{ fontSize: 10 }}>
                              {t(criterion)}
                            </span>
                          ))}
                        </div>

                        {checkResult.shariahResult?.sourceBreakdown && checkResult.shariahResult.sourceBreakdown.length > 0 && (
                          <div style={{ marginTop: 8, padding: '10px', background: 'var(--bg-page)', borderRadius: '6px', border: '1px solid var(--border)' }}>
                            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 6 }}>
                              {t('Sources')}:
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                              {checkResult.shariahResult.sourceBreakdown.map((src, idx) => (
                                <div key={idx} style={{ fontSize: 11, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                  <span>
                                    {src.sourceUrl ? (
                                      <a href={src.sourceUrl} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent-blue)', textDecoration: 'none', fontWeight: 500 }}>
                                        {src.sourceName}
                                      </a>
                                    ) : (
                                      <span style={{ fontWeight: 500 }}>{src.sourceName}</span>
                                    )}
                                    <span style={{ 
                                      marginLeft: 6, 
                                      padding: '1px 4px', 
                                      borderRadius: '3px',
                                      fontSize: '10px',
                                      background: src.reportedStatus === 'Compliant' ? 'rgba(34,197,94,0.1)' : src.reportedStatus === 'Non-Compliant' ? 'rgba(239,68,68,0.1)' : 'var(--bg-elevated)',
                                      color: src.reportedStatus === 'Compliant' ? '#22c55e' : src.reportedStatus === 'Non-Compliant' ? '#ef4444' : 'var(--text-muted)'
                                    }}>
                                      {t(src.reportedStatus)}
                                    </span>
                                  </span>
                                  {src.confidence && (
                                    <span style={{ color: 'var(--text-muted)', fontSize: '10px' }}>
                                      {t('Confidence')}: {t(src.confidence)}
                                    </span>
                                  )}
                                </div>
                              ))}
                            </div>
                          </div>
                        )}


                        {decisionStatus === 'compliant' && !isAlreadyAdded && (
                          <button
                            className="btn btn-primary"
                            onClick={handleAdd}
                            disabled={adding}
                            style={{ justifyContent: 'center', gap: 6 }}
                          >
                            {adding
                              ? <><Loader size={14} className="loading-spin" /> {t('Adding…')}</>
                              : <><Plus size={14} /> {t('Add')} {displaySymbol} {t('to Universe')}</>
                            }
                          </button>
                        )}

                        {isAlreadyAdded && (
                          <div style={{ 
                            padding: '8px 12px', 
                            borderRadius: 8, 
                            background: 'var(--surface-accent-medium)', 
                            color: 'var(--accent-blue)',
                            fontSize: 12,
                            fontWeight: 600,
                            textAlign: 'center',
                            border: '1px solid var(--border-accent)'
                          }}>
                            {t('This asset is already part of your tracked universe.')}
                          </div>
                        )}
                      </>
                    );
                  })()}
                </div>
              )}

              {formError && (
                <div style={{
                  padding: '10px 14px',
                  marginTop: 12,
                  background: 'rgba(239,68,68,0.1)',
                  border: '1px solid rgba(239,68,68,0.4)',
                  borderRadius: 'var(--radius-md)',
                  color: '#f87171', fontSize: 13,
                }}>
                  {formError}
                </div>
              )}
            </div>

            <div style={{
              padding: '16px',
              background: 'var(--bg-primary)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-md)',
              fontSize: 13, color: 'var(--text-secondary)',
              lineHeight: 1.6,
            }}>
              <strong style={{ display: 'block', marginBottom: 8, color: 'var(--text-primary)' }}>
                {t('Shariah screening criteria for crypto:')}
              </strong>
              <div style={{ display: 'grid', gap: 6 }}>
                <div>✅ <strong>{t('Real utility')}</strong> — {t('No gambling or pure speculation (gharar)')}</div>
                <div>✅ <strong>{t('No Riba')}</strong> — {t('No interest-bearing or debt-trading mechanics')}</div>
                <div>✅ <strong>{t('No Maysir')}</strong> — {t('No exposure to games of chance')}</div>
                <div>✅ <strong>{t('Haram industries')}</strong> — {t('No involvement in restricted sectors')}</div>
              </div>
            </div>
          </div>
        </div>

        {/* ── Unified Asset Universe Table ────────────────────────────────────── */}
        <div className="card asset-universe-card" style={{ padding: 0 }}>
          <div className="panel-header" style={{ padding: '22px 22px 12px' }}>
            <div>
              <div className="section-title">{t('Asset Universe')}</div>

            </div>
            <div style={{ display: 'flex', gap: 12 }}>
              <button
                className="btn btn-secondary btn-sm"
                onClick={() => handleAudit('all')}
                disabled={auditing || loadingCoins}
              >
                {auditing
                  ? <><Loader size={13} className="loading-spin" /> {auditProgress}/{filteredAssets.length}</>
                  : <><RefreshCw size={13} /> {t('Audit universe')}</>
                }
              </button>
            </div>
          </div>

          <div className="asset-universe-toolbar" style={{ padding: '0 22px 20px', display: 'flex', gap: 12, alignItems: 'center', borderBottom: '1px solid var(--surface-border-soft)' }}>
            <div style={{ position: 'relative', flex: 1 }}>
              <Search size={14} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
              <input
                className="input"
                placeholder={t('Search assets by symbol, ticker, ISIN, WKN, or name...')}
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                style={{ paddingLeft: 36, height: 40 }}
              />
            </div>
            <div className="asset-filter-group" aria-label={t('Filter asset type')}>
              <Filter size={14} aria-hidden="true" />
              <div className="asset-type-segmented asset-type-segmented-scroll" role="radiogroup">
                {filterTypeOptions.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    className={`asset-type-option ${filterType === option.value ? 'active' : ''}`}
                    role="radio"
                    aria-checked={filterType === option.value}
                    onClick={() => setFilterType(option.value)}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="table-container" style={{ border: 'none', maxHeight: 600, overflowY: 'auto' }}>
            <table className="ledger-table">
              <colgroup>
                <col style={{ width: '140px' }} />
                <col />
                <col style={{ width: '130px' }} />
                <col style={{ width: '200px' }} />
                <col style={{ width: '60px' }} />
              </colgroup>
              <thead style={{ position: 'sticky', top: 0, zIndex: 10 }}>
                <tr>
                  <th>{t('Symbol')}</th>
                  <th>{t('Name')}</th>
                  <th>{t('Type')}</th>
                  <th>{t('Compliance Status')}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {loadingCoins ? (
                  <tr>
                    <td colSpan={5} style={{ textAlign: 'center', padding: 64 }}>
                      <Loader size={24} className="loading-spin" style={{ color: 'var(--accent-blue)' }} />
                      <div style={{ marginTop: 12, fontSize: 13, color: 'var(--text-muted)' }}>{t('Loading assets…')}</div>
                    </td>
                  </tr>
                ) : filteredAssets.length === 0 ? (
                  <tr>
                    <td colSpan={5} style={{ textAlign: 'center', padding: 64 }}>
                      <div style={{ color: 'var(--text-muted)', fontSize: 14 }}>
                        {t('No assets found matching')} &quot;{searchQuery}&quot;
                      </div>
                      <button 
                        className="btn btn-secondary btn-sm" 
                        onClick={() => { setSearchQuery(''); setFilterType('all'); }}
                        style={{ marginTop: 12 }}
                      >
                        {t('Reset filters')}
                      </button>
                    </td>
                  </tr>
                ) : (
                  filteredAssets.map(asset => (
                    <tr key={`${asset.type}-${asset.symbol}`}>
                      <td className="mono" style={{ fontWeight: 800, color: 'var(--text-primary)', fontSize: 14 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                          <AssetIcon 
                            symbol={asset.symbol} 
                            name={asset.name} 
                            assetClass={asset.type as AssetClass} 
                            size={32}
                          />
                          <span>{asset.symbol}</span>
                        </div>
                      </td>
                      <td>
                        <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{asset.name}</div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2, maxWidth: 520, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={asset.identifierLabel}>
                          {asset.identifierLabel}
                        </div>
                        {asset.reason && (
                          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2, maxWidth: 450, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={t(asset.reason)}>
                            {t(asset.reason)}
                          </div>
                        )}
                      </td>
                      <td>
                        <span className={`badge ${
                          asset.type === 'crypto' ? 'badge-crypto' :
                          asset.type === 'stock' ? 'badge-stock' :
                          asset.type === 'etf' ? 'badge-etf' : 'badge-metal'
                        }`} style={{ minWidth: 70, justifyContent: 'center' }}>
                          {t(asset.type.toUpperCase())}
                        </span>
                      </td>
                      <td>
                        <ShariahStatusBadge status={asset.status} />
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
                          <button
                            className="btn btn-secondary btn-sm"
                            onClick={() => handleAudit(asset.symbol)}
                            style={{ padding: 8, borderRadius: 8 }}
                            title={t('Quick audit')}
                          >
                            <ShieldCheck size={14} />
                          </button>
                          {asset.isRemovable && (
                            <button
                              className="btn btn-secondary btn-sm"
                              onClick={() => handleRemove(asset.symbol)}
                              style={{ color: 'var(--red)', padding: 8, borderRadius: 8 }}
                              title={t('Remove from universe')}
                            >
                              <Trash2 size={14} />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <div className="asset-universe-footer" style={{ padding: '16px 22px', borderTop: '1px solid var(--surface-border-soft)', fontSize: 12, color: 'var(--text-muted)', display: 'flex', justifyContent: 'space-between', background: 'var(--surface-soft)' }}>
            <div style={{ display: 'flex', gap: 16 }}>
              <span>{t(`Showing ${filteredAssets.length} of ${unifiedAssets.length} total assets`)}</span>
              <span style={{ color: 'var(--surface-border-strong)' }}>|</span>
              <span>{t(`Filter: ${filterType === 'all' ? t('All Types') : t(filterType.charAt(0).toUpperCase() + filterType.slice(1))}`)}</span>
            </div>
            <span>{t('Compliance status is for informational purposes only.')}</span>
          </div>
        </div>
        {/* ── Audit Results requiring attention ────────────────────────────── */}
        {auditRows.some((row) => getCheckDecisionStatus(row) !== 'compliant') && (
          <div className="card">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
              <div className="section-title">
                {t('Attention')}: {auditRows.filter((row) => getCheckDecisionStatus(row) !== 'compliant').length} {t('assets require Shariah attention')}
              </div>
              <span className="badge badge-yellow">⚠ {t('Review needed')}</span>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {auditRows.filter((row) => getCheckDecisionStatus(row) !== 'compliant').map(row => (
                <div
                  key={row.symbol}
                  className="animate-in"
                  style={{
                    display: 'flex', alignItems: 'center', gap: 12,
                    padding: '12px',
                    background: 'rgba(239,68,68,0.06)',
                    border: '1px solid rgba(239,68,68,0.25)',
                    borderRadius: 'var(--radius-md)',
                  }}
                >
                  <AssetIcon 
                    symbol={row.symbol} 
                    name={row.name} 
                    assetClass={(SUPPORTED_STOCK_ASSETS.some(s => s.symbol === row.symbol) ? 'stock' : 'crypto') as AssetClass} 
                    size={24}
                  />
                  <div style={{ minWidth: 80, fontWeight: 800, fontFamily: 'monospace' }}>{row.symbol}</div>
                  <div style={{ flex: 1 }}>
                    <ShariahStatusBadge status={getCheckDecisionStatus(row)} />
                    {getCheckDecisionStatus(row) === 'non_compliant' && (
                      <button
                        className="btn btn-sm"
                        onClick={() => handleRemove(row.symbol)}
                        style={{
                          background: 'rgba(239,68,68,0.15)', color: '#f87171',
                          border: '1px solid rgba(239,68,68,0.3)', padding: '4px 10px',
                          borderRadius: 4, cursor: 'pointer', fontSize: 11, fontWeight: 600,
                        }}
                      >
                        {t('Remove')}
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </>
    )}
      </div>
    </AppShell>
  );
}
