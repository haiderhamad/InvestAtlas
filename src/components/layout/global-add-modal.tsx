'use client';

import { useState, useMemo, useEffect, useCallback, useRef, useId, type RefObject } from 'react';
import Link from 'next/link';
import { X, Trash2, Loader2, Check, Lock, Unlock } from 'lucide-react';
import {
  addManualTransaction,
  addManualTransactions,
  updateManualTransaction,
  removeManualTransaction,
  getAllTransactions,
  MANUAL_TRANSACTIONS_EVENT,
  type AppTransaction,
} from '@/lib/transactions/manual-store';
import { deriveHoldingsFromTransactions } from '@/lib/transactions/holdings-engine';
import { getLedgerBalanceAt, InvalidLedgerError, replayLedger } from '@/lib/transactions/ledger-validation';
import {
  getPositiveCashSources,
  InsufficientCashError,
  validateBuyCashAvailability,
  type BuyCashValidationResult,
} from '@/lib/transactions/cash-balances';
import {
  MANUAL_ACCOUNTS_EVENT,
  getAllManualAccounts,
} from '@/lib/accounts/manual-accounts-store';
import { resolveInvestmentCashRoute } from '@/lib/accounts/investment-cash-routing';
import { getVenueMeta } from '@/lib/portfolio/account-overview';
import { fetchFinancialData } from '@/lib/financial-data/client';
import {
  getAssetShariahStatus,
  getTrackableAssetsByClass,
  SUPPORTED_CRYPTO_ASSETS,
  SUPPORTED_ETF_ASSETS,
  SUPPORTED_METAL_ASSETS,
  SUPPORTED_STOCK_ASSETS,
  type AssetClass,
} from '@/lib/config/supported-assets';
import { getPersonalAssetConfig as getAssetConfig, USER_ASSETS_CHANGE_EVENT } from '@/lib/config/personal-asset-registry';
import { getShariahDecisionLabel } from '@/lib/shariah/decision';
import type { FeeInputMode, InvestmentTaxType, InvestmentTransaction, InvestmentTransactionType } from '@/lib/tax/investment-tax';
import type { TransactionFxSource } from '@/lib/fx/quote-rates';
import {
  getPurityOptionsForMetal,
  parseLegacyMetalFineness,
  spotPricePerGram,
  stripLegacyMetalFinenessNote,
} from '@/lib/metals/metal-purity';
import Dialog from '@/components/ui/dialog';
import { readAppPreferences } from '@/lib/preferences/app-preferences';
import { readUserAssets } from '@/lib/config/user-assets-store';
import { isHistoryCurrent } from '@/lib/financial-data/history/trust';
import { findRecentHistoricalClose, readTradeReference, tradeReferenceHistoryRange } from '@/lib/financial-data/history/selection';
import { SOURCE_CHANGE } from '@/lib/financial-data/providers/source-selection';
import { TIINGO_BROWSER_CREDENTIAL_CHANGE_EVENT } from '@/lib/financial-data/providers/tiingo-browser';
import { BROWSER_WORKSPACE_CHANGE_EVENT } from '@/lib/storage/workspace-storage';
import { ANONYMOUS_WORKSPACE_MODE_EVENT } from '@/lib/demo/workspace-mode';

type LedgerAssetClass = AssetClass | 'cash';
type TranslateFn = (text: string) => string;

interface CashShortfall {
  accountLabel: string;
  cashVenue: string;
  required: number;
  available: number;
  missing: number;
  symbol: string;
}

const categoryLabel = (t: TranslateFn): Record<LedgerAssetClass, string> => ({
  crypto: t('Crypto'),
  stock: t('Stocks'),
  etf: t('ETFs'),
  metal: t('Metals'),
  cash: t('Cash'),
});

const transactionTypeLabel = (t: TranslateFn): Record<InvestmentTransactionType, string> => ({
  buy: t('Buy'),
  sell: t('Sell'),
  deposit: t('Deposit'),
  withdrawal: t('Withdrawal'),
  dividend: t('Dividend'),
  transfer: t('Transfer'),
  fee: t('Fee'),
  adjustment: t('Adjustment'),
});

function getTypeFilterFn(venueKind: string | null, assetClass: string) {
  return ([value]: [string, string]) => {
    if (venueKind === 'Vault') return value === 'buy' || value === 'sell' || value === 'transfer';
    if (venueKind === 'Brokerage') return value === 'buy' || value === 'sell' || value === 'dividend' || value === 'transfer';
    if (venueKind === 'Exchange') return value === 'buy' || value === 'sell' || value === 'deposit' || value === 'withdrawal' || value === 'transfer';
    if (venueKind === 'Bank Account' || venueKind === 'Savings Account') return value === 'deposit' || value === 'withdrawal' || value === 'transfer';
    return assetClass !== 'metal' || value === 'buy' || value === 'sell' || value === 'dividend' || value === 'transfer';
  };
}

const trackableAssetOptionsByClass = (assetClass: LedgerAssetClass): Array<{ symbol: string; name: string }> => {
  if (assetClass === 'cash') {
    return [
      { symbol: 'EUR', name: 'Euro Cash' },
      { symbol: 'USD', name: 'US Dollar Cash' },
    ];
  }
  const list = getTrackableAssetsByClass(assetClass as AssetClass).map((asset) => ({
    symbol: asset.symbol,
    name: asset.name,
  }));

  if (typeof window !== 'undefined') {
    readUserAssets().forEach((asset) => {
      if (asset.assetClass === assetClass && !list.some(a => a.symbol === asset.symbol)) {
        list.push({ symbol: asset.symbol, name: asset.name });
      }
    });
  }

  return list;
};

const BUILTIN_VENUE_OPTIONS = [
  { value: 'bitvavo', label: 'Bitvavo' },
  { value: 'gateio', label: 'Gate.io' },
  { value: 'ibkr', label: 'Interactive Brokers' },
  { value: 'trade-republic', label: 'Trade Republic' },
  { value: 'bullion-vault', label: 'BullionVault' },
] as const;

function localDateInput(iso?: string) {
  const date = iso ? new Date(iso) : new Date();
  if (!Number.isFinite(date.getTime())) return '';
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

function parseTradeDecimal(draft: string, language: string) {
  let normalized = draft.trim();
  if (language === 'ar') {
    normalized = normalized.replace(/[٠-٩۰-۹]/g, digit => String(digit.charCodeAt(0) & 0xf)).replace('٫', '.');
  }
  if (language === 'de') {
    if (normalized.includes('.')) return NaN;
    normalized = normalized.replace(',', '.');
  }
  return /^(?:\d+(?:\.\d+)?|\.\d+)$/.test(normalized) ? Number(normalized) : NaN;
}

const tradeNumberText = (value: number, language: string) => new Intl.NumberFormat(
  language === 'ar' ? 'ar-SA' : language === 'de' ? 'de-DE' : 'en-US',
  { useGrouping: false, maximumFractionDigits: 20 },
).format(value);

function initialFeeInput(transaction?: AppTransaction) {
  if (!transaction) return 1;
  const basis = transaction.amount * transaction.price;
  if (tradeLikeTypes.includes(transaction.type) && transaction.feeMode === 'percent' && basis > 0) {
    return (transaction.fee / basis) * 100;
  }
  return transaction.fee;
}

function hasAmbiguousTradeOrder(transactions: AppTransaction[], candidate: InvestmentTransaction) {
  const instant = Date.parse(candidate.date);
  const competing = transactions.flatMap((row, index) => (
    Date.parse(row.date) === instant ? [index] : []
  ));
  if (!competing.length) return false;

  const validAfterExisting = replayLedger([...transactions, candidate]).valid;
  return competing.some(index => replayLedger([
    ...transactions.slice(0, index), candidate, ...transactions.slice(index),
  ]).valid !== validAfterExisting);
}

const getDefaultAssetSymbol = (assetClass: LedgerAssetClass) =>
  trackableAssetOptionsByClass(assetClass)[0]?.symbol ?? '';

const getAllowedAssetClasses = (type: InvestmentTransactionType): LedgerAssetClass[] => {
  if (type === 'buy' || type === 'sell') {
    return ['crypto', 'stock', 'etf', 'metal'];
  }
  if (type === 'dividend') {
    return ['stock', 'etf'];
  }
  if (type === 'deposit' || type === 'withdrawal') {
    return ['crypto', 'cash'];
  }
  return ['crypto', 'stock', 'etf', 'metal', 'cash'];
};

const getVenueCompatibleAssetClasses = (
  assetClasses: LedgerAssetClass[],
  venueKind: string | null,
): LedgerAssetClass[] => {
  if (venueKind === 'Vault') return assetClasses.filter((assetClass) => assetClass === 'metal');
  if (venueKind === 'Exchange') return assetClasses.filter((assetClass) => assetClass === 'crypto');
  if (venueKind === 'Brokerage') return assetClasses.filter((assetClass) => assetClass === 'stock' || assetClass === 'etf');
  if (venueKind === 'Bank Account' || venueKind === 'Savings Account') return assetClasses.filter((assetClass) => assetClass === 'cash');
  return assetClasses;
};

const getDefaultQuoteForSelection = (assetClass: LedgerAssetClass, symbol: string) => {
  if (assetClass === 'cash') {
    return symbol || readAppPreferences().displayCurrency?.toUpperCase() || 'EUR';
  }
  
  const userPref = readAppPreferences().displayCurrency?.toUpperCase();
  if (userPref) return userPref;

  return getAssetConfig(symbol)?.nativeCurrency === 'usd' ? 'USD' : 'EUR';
};

const getValidAssetSymbol = (assetClass: LedgerAssetClass, currentSymbol?: string) => {
  const options = trackableAssetOptionsByClass(assetClass);
  if (currentSymbol && options.some((asset) => asset.symbol === currentSymbol)) {
    return currentSymbol;
  }
  return options[0]?.symbol ?? '';
};

const inferTaxType = (
  type: InvestmentTransactionType,
  assetClass: LedgerAssetClass,
): InvestmentTaxType => {
  if (type === 'buy') return 'acquisition';
  if (type === 'sell') return 'disposal';
  if (type === 'deposit') return assetClass === 'cash' ? 'cash_in' : 'transfer_in';
  if (type === 'withdrawal') return assetClass === 'cash' ? 'cash_out' : 'transfer_out';
  if (type === 'dividend') return 'dividend_income';
  if (type === 'transfer') return 'transfer_in';
  if (type === 'fee') return 'fee_expense';
  return 'adjustment';
};

const tradeLikeTypes: InvestmentTransactionType[] = ['buy', 'sell'];

const normalizeNum = (raw: string): number => {
  // Remove leading zeros (e.g. "002" → 2, "0.50" stays as is)
  const stripped = raw.replace(/^0+(\d)/, '$1');
  const n = parseFloat(stripped);
  return isNaN(n) ? 0 : n;
};

import { useAppTranslation } from '@/lib/i18n/use-app-translation';

interface GlobalAddModalProps {
  onClose: () => void;
  initialVenue?: string;
  initialAssetClass?: LedgerAssetClass;
  initialAsset?: string;
  initialType?: InvestmentTransactionType;
  returnFocusRef?: RefObject<HTMLElement | null>;
  cashFunding?: { currency: string; destinationVenue?: string };
  onSaved?: () => void;
  editTransaction?: AppTransaction;
}

export default function GlobalAddModal({ onClose, initialVenue, initialAssetClass, initialAsset, initialType, returnFocusRef, cashFunding, onSaved, editTransaction }: GlobalAddModalProps) {
  const { t, language } = useAppTranslation();
  const formId = useId();
  const fieldId = (name: string) => `${formId}-${name}`;
  const isEditMode = !!editTransaction;
  const [transactions, setTransactions] = useState<AppTransaction[]>(() => getAllTransactions());
  const [manualAccounts, setManualAccounts] = useState(() => getAllManualAccounts());

  const [entryType, setEntryType] = useState<InvestmentTransactionType>(editTransaction?.type ?? initialType ?? 'buy');
  const isTradeLike = tradeLikeTypes.includes(entryType);
  const tradePresentation = isTradeLike || Boolean(cashFunding);
  const startingClass = editTransaction?.assetClass ?? initialAssetClass ?? getAssetConfig(initialAsset ?? '')?.assetClass ?? 'crypto';
  const [entryAssetClass, setEntryAssetClass] = useState<LedgerAssetClass>(
    startingClass
  );
  const [entryAsset, setEntryAsset] = useState(
    editTransaction?.asset ?? initialAsset ?? getDefaultAssetSymbol(startingClass)
  );
  const [entryVenue, setEntryVenue] = useState(editTransaction?.venue ?? initialVenue ?? '');
  const [entryDestinationVenue, setEntryDestinationVenue] = useState(cashFunding?.destinationVenue ?? '');
  const [entryDate, setEntryDate] = useState(() => cashFunding ? '' : localDateInput(editTransaction?.date));
  const savedInstant = editTransaction && entryDate === localDateInput(editTransaction.date) ? editTransaction.date : null;
  const transactionDate = new Date(savedInstant ?? entryDate);
  const [entryQuote, setEntryQuote] = useState(
    cashFunding?.currency ?? editTransaction?.quote ?? readAppPreferences().displayCurrency?.toUpperCase() ?? getDefaultQuoteForSelection(
      initialAssetClass ?? 'crypto',
      initialAsset ?? getDefaultAssetSymbol(startingClass)
    )
  );
  const [entryFxRateToEur, setEntryFxRateToEur] = useState(
    editTransaction?.fxRateToEur?.toString() ?? '',
  );
  const [entryFxRateSource, setEntryFxRateSource] = useState<
    TransactionFxSource | ''
  >(editTransaction?.fxRateSource ?? '');
  const [entryFxRateDate, setEntryFxRateDate] = useState(
    editTransaction?.fxRateDate ?? '',
  );
  const [legacyAmount, setEntryAmount] = useState(editTransaction?.amount ?? (cashFunding ? 0 : 1));
  const [legacyPrice, setEntryPrice] = useState(editTransaction?.price ?? 0);
  const [tradeAmountDraft, setTradeAmountDraft] = useState(() => tradeNumberText(editTransaction?.amount ?? 1, language));
  const [tradePriceDraft, setTradePriceDraft] = useState(() => editTransaction?.price ? tradeNumberText(editTransaction.price, language) : '');
  const enteredExecutionTime = useRef(false);
  const tradeAmount = parseTradeDecimal(tradeAmountDraft, language);
  const tradePrice = parseTradeDecimal(tradePriceDraft, language);
  const entryAmount = isTradeLike ? tradeAmount || 0 : legacyAmount;
  const entryPrice = isTradeLike ? tradePrice || 0 : legacyPrice;
  const validTradeAmounts = Number.isFinite(tradeAmount) && Number.isFinite(tradePrice) && tradeAmount > 0 && tradePrice > 0;
  const [entryFeeMode, setEntryFeeMode] = useState<FeeInputMode>(editTransaction?.feeMode ?? 'flat');
  const [entryFeeInput, setEntryFeeInput] = useState(() => initialFeeInput(editTransaction));
  const [entryNotes, setEntryNotes] = useState(
    editTransaction?.assetClass === 'metal'
      ? stripLegacyMetalFinenessNote(editTransaction.notes, editTransaction.asset)
      : editTransaction?.notes ?? '',
  );
  const [entryTax, setEntryTax] = useState(editTransaction?.taxAmount ?? 0);
  const [entryGross, setEntryGross] = useState(editTransaction?.type === 'dividend' ? (editTransaction.total + (editTransaction.fee ?? 0) + (editTransaction.taxAmount ?? 0)) : 0);
  const [lockedField, setLockedField] = useState<'amount' | 'price' | 'total'>('price');
  const lockedValueRef = useRef<number>(0); // frozen value of the locked field at lock time
  const assetSelectCleanupRef = useRef<(() => void) | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [invalidField, setInvalidField] = useState<string | null>(null);
  const [cashShortfall, setCashShortfall] = useState<CashShortfall | null>(null);
  const [cashFixSourceVenue, setCashFixSourceVenue] = useState('');
  const [fundingVenue, setFundingVenue] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const savePendingRef = useRef(false);
  const [balanceHint, setBalanceHint] = useState<number | null>(null);
  const [observedEntryAsset, setObservedEntryAsset] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [selectedSearchedAsset, setSelectedSearchedAsset] = useState<{ symbol: string, name: string, class: string } | null>(null);

  const venueOptions = useMemo(() => {
    const byValue = new Map<string, { value: string; label: string; kind: string }>();
    for (const venue of BUILTIN_VENUE_OPTIONS) {
      byValue.set(venue.value, { value: venue.value, label: venue.label, kind: getVenueMeta(venue.value, manualAccounts).kind });
    }
    for (const account of manualAccounts) {
      byValue.set(account.venue, { value: account.venue, label: account.label, kind: account.kind });
    }
    for (const transaction of transactions) {
      if (!byValue.has(transaction.venue)) {
        const venueMeta = getVenueMeta(transaction.venue, manualAccounts);
        byValue.set(transaction.venue, { value: transaction.venue, label: venueMeta.label, kind: venueMeta.kind });
      }
    }
    return [...byValue.values()].filter(venue => !isTradeLike || venue.value === editTransaction?.venue
      || !manualAccounts.some(account => account.venue === venue.value && account.archivedAt));
  }, [editTransaction?.venue, isTradeLike, manualAccounts, transactions]);
  const accountOptions = isTradeLike && initialType && !editTransaction
    ? venueOptions.filter(venue => venue.kind !== 'Bank Account' && venue.kind !== 'Savings Account')
    : venueOptions;

  const selectedVenueKind = useMemo(() => {
    if (!entryVenue) return null;
    return venueOptions.find((v) => v.value === entryVenue)?.kind || null;
  }, [entryVenue, venueOptions]);
  const selectedVenueLabel = useMemo(
    () => venueOptions.find((venue) => venue.value === entryVenue)?.label ?? entryVenue,
    [entryVenue, venueOptions],
  );

  const allowedAssetClasses = useMemo(() => getAllowedAssetClasses(entryType), [entryType]);
  const selectableAssetClasses = useMemo(
    () => getVenueCompatibleAssetClasses(allowedAssetClasses, selectedVenueKind),
    [allowedAssetClasses, selectedVenueKind],
  );
  const effectiveEntryAssetClass = useMemo(() => {
    if (selectableAssetClasses.includes(entryAssetClass)) return entryAssetClass;
    return selectableAssetClasses[0] ?? allowedAssetClasses[0] ?? entryAssetClass;
  }, [allowedAssetClasses, entryAssetClass, selectableAssetClasses]);
  const settlementRoute = useMemo(
    () =>
      tradeLikeTypes.includes(entryType) && effectiveEntryAssetClass !== 'cash'
        ? resolveInvestmentCashRoute(manualAccounts, effectiveEntryAssetClass as AssetClass)
        : null,
    [effectiveEntryAssetClass, entryType, manualAccounts],
  );
  const settlementVenue = settlementRoute?.venue ?? entryVenue.trim();
  const settlementLabel = settlementRoute
    ? settlementRoute.label
    : selectedVenueLabel;

  useEffect(() => {
    if (effectiveEntryAssetClass === entryAssetClass) return;
    const nextAsset = getValidAssetSymbol(effectiveEntryAssetClass, entryAsset);
    setEntryAssetClass(effectiveEntryAssetClass);
    setEntryAsset(nextAsset);
    setEntryQuote(getDefaultQuoteForSelection(effectiveEntryAssetClass, nextAsset));
  }, [effectiveEntryAssetClass, entryAssetClass, entryAsset]);

  const ownedAssetsAtVenue = useMemo(() => {
    if (!entryVenue) return [];
    const targetVenue = entryVenue.trim().toLowerCase();
    const venueTx = transactions.filter((t) => t.venue.trim().toLowerCase() === targetVenue);
    const balances = new Map<string, number>();
    for (const tx of venueTx) {
      const symbol = tx.asset.toUpperCase();
      const current = balances.get(symbol) ?? 0;
      const type = tx.type;
      const taxType = tx.taxType;
      const amount = tx.amount || 0;

      if (type === 'buy' || type === 'deposit' || type === 'adjustment') {
        balances.set(symbol, current + amount);
      } else if (type === 'sell' || type === 'withdrawal') {
        balances.set(symbol, current - amount);
      } else if (type === 'transfer') {
        if (taxType === 'transfer_in') balances.set(symbol, current + amount);
        else if (taxType === 'transfer_out') balances.set(symbol, current - amount);
      }
    }
    return Array.from(balances.entries())
      .filter(([_, balance]) => balance > 0.00000001)
      .map(([symbol]) => symbol);
  }, [transactions, entryVenue]);

  const isReducingEntry = entryType === 'withdrawal' || entryType === 'transfer';
  const assetOptionsForClass = useMemo(() => {
    const options = [...trackableAssetOptionsByClass(effectiveEntryAssetClass)];
    if (selectedSearchedAsset && effectiveEntryAssetClass === selectedSearchedAsset.class) {
      if (!options.some(o => o.symbol === selectedSearchedAsset.symbol)) {
        options.push({ symbol: selectedSearchedAsset.symbol, name: selectedSearchedAsset.name });
      }
    }
    return options;
  }, [effectiveEntryAssetClass, selectedSearchedAsset]);
  const selectableAssetOptions = useMemo(() => {
    if (isReducingEntry && effectiveEntryAssetClass !== 'cash') {
      const ownedOptions = assetOptionsForClass.filter((asset) => ownedAssetsAtVenue.includes(asset.symbol.toUpperCase()));
      return ownedOptions.length > 0 ? ownedOptions : assetOptionsForClass;
    }
    return assetOptionsForClass;
  }, [assetOptionsForClass, isReducingEntry, effectiveEntryAssetClass, ownedAssetsAtVenue]);
  const effectiveEntryAsset = useMemo(() => {
    const normalized = entryAsset.trim().toUpperCase();
    const valid = selectableAssetOptions.find((asset) => asset.symbol.toUpperCase() === normalized);
    const validForClass = assetOptionsForClass.find((asset) => asset.symbol.toUpperCase() === normalized);
    return valid?.symbol ?? validForClass?.symbol ?? selectableAssetOptions[0]?.symbol ?? assetOptionsForClass[0]?.symbol ?? '';
  }, [assetOptionsForClass, entryAsset, selectableAssetOptions]);
  const resolvedEntryAsset = useMemo(() => {
    const normalized = entryAsset.trim().toUpperCase();
    const validForClass = assetOptionsForClass.find((asset) => asset.symbol.toUpperCase() === normalized);
    return validForClass?.symbol ?? effectiveEntryAsset;
  }, [assetOptionsForClass, effectiveEntryAsset, entryAsset]);
  const activeEntryAsset = useMemo(() => {
    if (cashFunding) return cashFunding.currency;
    if (isTradeLike) return resolvedEntryAsset;
    const normalized = observedEntryAsset.trim().toUpperCase();
    const validObservedAsset = assetOptionsForClass.find((asset) => asset.symbol.toUpperCase() === normalized);
    return validObservedAsset?.symbol ?? resolvedEntryAsset;
  }, [assetOptionsForClass, cashFunding, isTradeLike, observedEntryAsset, resolvedEntryAsset]);

  const currentAssetHolding = useMemo(() => {
    if (!entryVenue || !activeEntryAsset) return null;
    const targetVenue = entryVenue.trim().toLowerCase();
    const targetAsset = activeEntryAsset.trim().toUpperCase();

    const sourceTransactions =
      isEditMode && editTransaction
        ? transactions.filter((transaction) => transaction.id !== editTransaction.id)
        : transactions;

    return deriveHoldingsFromTransactions(sourceTransactions)
      .find(
        (holding) =>
          holding.venue.trim().toLowerCase() === targetVenue &&
          holding.symbol.trim().toUpperCase() === targetAsset,
      ) ?? null;
  }, [transactions, entryVenue, activeEntryAsset, isEditMode, editTransaction]);
  const currentAssetBalance = entryType === 'sell'
    ? getLedgerBalanceAt(transactions.filter(row => row.id !== editTransaction?.id), entryVenue, activeEntryAsset, savedInstant ?? entryDate)
    : currentAssetHolding?.amount ?? 0;

  useEffect(() => {
    if (!resolvedEntryAsset || resolvedEntryAsset === entryAsset) return;
    setEntryAsset(resolvedEntryAsset);
    setEntryQuote(getDefaultQuoteForSelection(effectiveEntryAssetClass, resolvedEntryAsset));
  }, [resolvedEntryAsset, entryAsset, effectiveEntryAssetClass]);

  useEffect(() => {
    const isReducing = entryType === 'sell' || entryType === 'withdrawal' || entryType === 'transfer';
    if (isReducing && effectiveEntryAssetClass !== 'cash') {
      setBalanceHint(currentAssetBalance);
    } else {
      setBalanceHint(null);
    }
  }, [entryType, currentAssetBalance, effectiveEntryAssetClass]);

  const otherVenuesWithAsset = useMemo(() => {
    if (!activeEntryAsset) return [];
    const targetAsset = activeEntryAsset.trim().toUpperCase();
    const targetVenue = entryVenue.trim().toLowerCase();

    const venueBalances = new Map<string, number>();
    for (const tx of transactions) {
      if (tx.asset.toUpperCase() !== targetAsset) continue;
      if (tx.venue.trim().toLowerCase() === targetVenue) continue;

      const v = tx.venue;
      const current = venueBalances.get(v) ?? 0;
      if (tx.type === 'buy' || tx.type === 'deposit') venueBalances.set(v, current + tx.amount);
      else if (tx.type === 'sell' || tx.type === 'withdrawal') venueBalances.set(v, current - tx.amount);
      else if (tx.type === 'transfer') {
        if (tx.taxType === 'transfer_in') venueBalances.set(v, current + tx.amount);
        else if (tx.taxType === 'transfer_out') venueBalances.set(v, current - tx.amount);
      }
    }

    return Array.from(venueBalances.entries())
      .filter(([_, balance]) => balance > 0.00000001)
      .map(([venue, balance]) => ({ venue, balance }));
  }, [transactions, activeEntryAsset, entryVenue]);

  const [metalFineness, setMetalFineness] = useState<number | ''>(() => {
    if (editTransaction?.assetClass === 'metal') {
      return editTransaction.metalFineness
        ?? parseLegacyMetalFineness(editTransaction.notes, editTransaction.asset)
        ?? '';
    }

    return startingClass === 'metal'
      ? getPurityOptionsForMetal(entryAsset)[0]?.fineness ?? ''
      : '';
  });
  const [priceLoading, setPriceLoading] = useState(false);
  const [tradeReference, setTradeReference] = useState<{
    key: string;
    status: 'loading' | 'ready' | 'unavailable';
    value?: NonNullable<ReturnType<typeof readTradeReference>>;
  } | null>(null);
  const referenceRequest = useRef<AbortController | null>(null);
  const cancelTradeReference = useCallback(() => {
    referenceRequest.current?.abort();
    referenceRequest.current = null;
    setTradeReference(null);
  }, []);
  const [priceSource, setPriceSource] = useState<'spot' | 'custom' | null>(null);
  const priceSourceRef = useRef<'spot' | 'custom' | null>(null);
  const spotRequestIdRef = useRef(0);
  const spotContextDirtyRef = useRef(!editTransaction);
  const updatePriceSource = useCallback((source: 'spot' | 'custom' | null) => {
    priceSourceRef.current = source;
    setPriceSource(source);
  }, []);
  const invalidateAutoSpotPrice = useCallback(() => {
    spotRequestIdRef.current += 1;
    setPriceLoading(false);
    if (priceSourceRef.current === 'spot') {
      setEntryPrice(0);
      lockedValueRef.current = 0;
      updatePriceSource(null);
    }
  }, [updatePriceSource]);
  const markSpotContextDirty = useCallback(() => {
    cancelTradeReference();
    spotContextDirtyRef.current = true;
    spotRequestIdRef.current += 1;
    setPriceLoading(false);
    setEntryPrice(0);
    setTradePriceDraft('');
    lockedValueRef.current = 0;
    updatePriceSource(null);
  }, [cancelTradeReference, updatePriceSource]);
  const isMetalEntry = effectiveEntryAssetClass === 'metal';
  const tradeReferenceKey = JSON.stringify([activeEntryAsset, entryDate, entryQuote, metalFineness, isTradeLike, fundingVenue]);
  const visibleTradeReference = tradeReference?.key === tradeReferenceKey ? tradeReference : null;
  const referenceValue = visibleTradeReference?.value;

  useEffect(() => () => referenceRequest.current?.abort(), [tradeReferenceKey]);
  useEffect(() => {
    const events = [SOURCE_CHANGE, TIINGO_BROWSER_CREDENTIAL_CHANGE_EVENT, USER_ASSETS_CHANGE_EVENT, BROWSER_WORKSPACE_CHANGE_EVENT, ANONYMOUS_WORKSPACE_MODE_EVENT];
    events.forEach(event => window.addEventListener(event, cancelTradeReference));
    return () => events.forEach(event => window.removeEventListener(event, cancelTradeReference));
  }, [cancelTradeReference]);

  const lookupTradeReference = async () => {
    cancelTradeReference();
    const tradeDay = entryDate.slice(0, 10);
    const range = tradeReferenceHistoryRange(tradeDay);
    const currency = entryQuote.toLowerCase();
    if (!range || !activeEntryAsset || (currency !== 'eur' && currency !== 'usd') || (isMetalEntry && metalFineness === '')) {
      setTradeReference({ key: tradeReferenceKey, status: 'unavailable' });
      return;
    }

    const controller = new AbortController();
    referenceRequest.current = controller;
    setTradeReference({ key: tradeReferenceKey, status: 'loading' });

    const params = new URLSearchParams({ symbol: activeEntryAsset, currency, interval: '1d', ...range });
    const executionCutoff = enteredExecutionTime.current
      ? transactionDate.getTime()
      : new Date(`${tradeDay}T00:00`).getTime();
    let value: ReturnType<typeof readTradeReference> = null;
    try {
      const response = await fetchFinancialData(`/api/prices/history?${params}`, { signal: controller.signal });
      if (response.ok) value = readTradeReference(await response.json(), {
        symbol: activeEntryAsset, currency, tradeDay, executionCutoff,
        ...(isMetalEntry && metalFineness !== '' ? { fineness: metalFineness } : {}),
      });
    } catch {
      // A failed or unavailable lookup leaves the execution-price draft alone.
    }
    if (controller.signal.aborted || referenceRequest.current !== controller) return;
    referenceRequest.current = null;
    setTradeReference(value
      ? { key: tradeReferenceKey, status: 'ready', value }
      : { key: tradeReferenceKey, status: 'unavailable' });
  };
  const metalPurityOptions = useMemo(() => {
    if (!isMetalEntry) return [];

    const standardOptions = getPurityOptionsForMetal(entryAsset);
    if (
      metalFineness === ''
      || standardOptions.some((option) => option.fineness === metalFineness)
    ) {
      return standardOptions;
    }

    return [
      {
        fineness: metalFineness,
        label: `${metalFineness} ‰`,
        badge: `${metalFineness}`,
      },
      ...standardOptions,
    ];
  }, [isMetalEntry, entryAsset, metalFineness]);

  const ownedAssetClassesAtVenue = useMemo(() => {
    if (!entryVenue) return [];
    const targetVenue = entryVenue.trim().toLowerCase();
    const classes = new Set<string>();

    for (const tx of transactions) {
      if (tx.venue.trim().toLowerCase() !== targetVenue) continue;

      const symbol = tx.asset.toUpperCase();
      // We need to calculate balance per asset to see if the class is truly "owned"
      // But for simplicity and performance, let's just check if any asset in this class has a balance > 0
    }

    // Reuse the logic from ownedAssetsAtVenue to get classes
    const venueTx = transactions.filter((t) => t.venue.trim().toLowerCase() === targetVenue);
    const balances = new Map<string, number>();
    const symbolToClass = new Map<string, string>();

    for (const tx of venueTx) {
      const symbol = tx.asset.toUpperCase();
      symbolToClass.set(symbol, tx.assetClass);
      const current = balances.get(symbol) ?? 0;
      const type = tx.type;
      const taxType = tx.taxType;
      const amount = tx.amount || 0;

      if (type === 'buy' || type === 'deposit' || type === 'adjustment') {
        balances.set(symbol, current + amount);
      } else if (type === 'sell' || type === 'withdrawal') {
        balances.set(symbol, current - amount);
      } else if (type === 'transfer') {
        if (taxType === 'transfer_in') balances.set(symbol, current + amount);
        else if (taxType === 'transfer_out') balances.set(symbol, current - amount);
      }
    }

    for (const [symbol, balance] of balances.entries()) {
      if (balance > 0.00000001) {
        classes.add(symbolToClass.get(symbol) || 'stock');
      }
    }

    return Array.from(classes);
  }, [transactions, entryVenue]);

  // Ensure entryAssetClass is valid when the type changes to Sell
  useEffect(() => {
    const isReducing = entryType === 'withdrawal' || entryType === 'transfer';
    if (!isReducing || cashFunding) return;

    if (ownedAssetClassesAtVenue.length > 0) {
      const isValid = ownedAssetClassesAtVenue.includes(effectiveEntryAssetClass);
      if (!isValid) {
        setEntryAssetClass(ownedAssetClassesAtVenue[0] as any);
      }
    }
  }, [cashFunding, entryType, entryVenue, ownedAssetClassesAtVenue, effectiveEntryAssetClass]);

  // Nuclear Fix: Robust effect to ensure entryAsset is always valid for the current class and mode
  useEffect(() => {
    if (isTradeLike || cashFunding) return;
    const isReducing = entryType === 'withdrawal' || entryType === 'transfer';
    const allOptions = trackableAssetOptionsByClass(effectiveEntryAssetClass);

    // Get valid symbols for current mode (filtered by ownership if reducing)
    const validSymbols = (isReducing && effectiveEntryAssetClass !== 'cash')
      ? allOptions.filter(a => ownedAssetsAtVenue.includes(a.symbol.toUpperCase())).map(a => a.symbol)
      : allOptions.map(a => a.symbol);

    if (validSymbols.length > 0) {
      const currentUpper = entryAsset.toUpperCase();
      const isValid = validSymbols.some(s => s.toUpperCase() === currentUpper);

      if (!isValid) {
        // Immediate reset to first valid option
        const fallback = validSymbols[0];
        setEntryAsset(fallback);
        setEntryQuote(getDefaultQuoteForSelection(effectiveEntryAssetClass, fallback));
      }
    }
  }, [cashFunding, isTradeLike, entryType, effectiveEntryAssetClass, entryVenue, ownedAssetsAtVenue, entryAsset]);

  useEffect(() => {
    const syncData = () => {
      setTransactions(getAllTransactions());
      setManualAccounts(getAllManualAccounts());
    };
    window.addEventListener(MANUAL_TRANSACTIONS_EVENT, syncData);
    window.addEventListener(MANUAL_ACCOUNTS_EVENT, syncData);
    window.addEventListener(USER_ASSETS_CHANGE_EVENT, syncData);
    return () => {
      window.removeEventListener(MANUAL_TRANSACTIONS_EVENT, syncData);
      window.removeEventListener(MANUAL_ACCOUNTS_EVENT, syncData);
      window.removeEventListener(USER_ASSETS_CHANGE_EVENT, syncData);
    };
  }, []);

  // Auto-fetch spot price when asset, fineness, date, or currency changes
  const fetchSpotPrice = useCallback(async (
    requestId: number,
    signal: AbortSignal,
  ) => {
    const isPriced = tradeLikeTypes.includes(entryType) || (effectiveEntryAssetClass !== 'cash' && (entryType === 'deposit' || entryType === 'withdrawal'));
    if (
      !isPriced
      || effectiveEntryAssetClass === 'cash'
      || (isMetalEntry && metalFineness === '')
    ) return;
    setPriceLoading(true);
    try {
      const dateValue = entryDate ? new Date(entryDate).toISOString().split('T')[0] : new Date().toISOString().split('T')[0];

      if (isMetalEntry) {
        const selectedMetalFineness = metalFineness;
        if (selectedMetalFineness === '') return;
        const params = new URLSearchParams({
          symbol: activeEntryAsset,
          currency: entryQuote.toLowerCase(),
          ...(dateValue ? { date: dateValue } : {}),
        });
        const response = await fetch(`/api/prices/metal-spot?${params}`, { signal });
        const data = await response.json();
        if (signal.aborted || spotRequestIdRef.current !== requestId) return;
        if (response.ok && data.spotPricePerOz) {
          const pricePerGram = spotPricePerGram(
            data.spotPricePerOz,
            selectedMetalFineness,
          );
          const fetchedPrice = Number(pricePerGram.toFixed(2));
          setEntryPrice(fetchedPrice);
          updatePriceSource('spot');
          lockedValueRef.current = fetchedPrice;
        }
      } else {
        const params = new URLSearchParams({
          symbol: activeEntryAsset,
          currency: entryQuote.toLowerCase(),
        });
        const response = await fetchFinancialData(`/api/prices/history?${params}`, { signal });
        const data = await response.json();
        if (signal.aborted || spotRequestIdRef.current !== requestId) return;
        if (
          response.ok
          && isHistoryCurrent(data)
          && data.prices
          && Array.isArray(data.prices)
        ) {
          const closestPrice = findRecentHistoricalClose(data.prices, dateValue);
          if (closestPrice) {
            const dec = closestPrice.close < 1 ? 4 : 2;
            const fetchedPrice = Number(closestPrice.close.toFixed(dec));
            setEntryPrice(fetchedPrice);
            updatePriceSource('spot');
            lockedValueRef.current = fetchedPrice;
          }
        }
      }
    } catch {
      // Silently fail — user can still enter price manually
    } finally {
      if (spotRequestIdRef.current === requestId) {
        setPriceLoading(false);
      }
    }
  }, [entryType, effectiveEntryAssetClass, isMetalEntry, activeEntryAsset, metalFineness, entryDate, entryQuote, updatePriceSource]);

  useEffect(() => {
    if (isTradeLike || !spotContextDirtyRef.current) return;
    invalidateAutoSpotPrice();
    const controller = new AbortController();
    const requestId = spotRequestIdRef.current + 1;
    spotRequestIdRef.current = requestId;
    void fetchSpotPrice(requestId, controller.signal);

    return () => {
      controller.abort();
      if (spotRequestIdRef.current === requestId) {
        spotRequestIdRef.current += 1;
      }
    };
  }, [fetchSpotPrice, invalidateAutoSpotPrice, isTradeLike]);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (searchQuery.trim().length >= 2) {
        setIsSearching(true);
        fetch(`/api/assets/search?query=${encodeURIComponent(searchQuery)}`)
          .then(res => res.json())
          .then(data => {
            setSearchResults(data.results || []);
            setIsSearching(false);
          })
          .catch(err => {
            console.error(err);
            setIsSearching(false);
          });
      } else {
        setSearchResults([]);
      }
    }, 500);

    return () => clearTimeout(timer);
  }, [searchQuery]);

  const showPricedFields = isTradeLike || (effectiveEntryAssetClass !== 'cash' && (entryType === 'deposit' || entryType === 'withdrawal'));
  const entryValue = showPricedFields ? entryAmount * entryPrice : entryAmount;
  const feeBasis = entryType === 'dividend' ? entryGross : entryValue;
  const calculatedFee =
    entryType === 'buy' || entryType === 'sell' || entryType === 'dividend'
      ? entryFeeMode === 'percent'
        ? feeBasis * (entryFeeInput / 100)
        : entryFeeMode === 'flat'
        ? entryFeeInput
        : 0
      : 0;
  const grossTotal =
    entryType === 'dividend'
      ? Math.max(0, entryGross - entryTax - calculatedFee)
      : entryValue;
  const requiredCashForBuy = entryType === 'buy' ? Number((grossTotal + calculatedFee).toFixed(2)) : 0;
  const availableCashForBuy = useMemo(() => {
    if (entryType !== 'buy' || !settlementVenue || !entryQuote) return 0;
    return getLedgerBalanceAt(transactions.filter(row => row.id !== editTransaction?.id), settlementVenue, entryQuote, savedInstant ?? entryDate);
  }, [editTransaction?.id, entryDate, entryQuote, entryType, savedInstant, settlementVenue, transactions]);
  const cashFixSources = useMemo(
    () => getPositiveCashSources(transactions, cashShortfall?.symbol ?? entryQuote, cashShortfall?.cashVenue ?? settlementVenue)
      .filter(source => ['Bank Account', 'Savings Account', 'Other'].includes(getVenueMeta(source.venue, manualAccounts).kind)),
    [cashShortfall, entryQuote, manualAccounts, settlementVenue, transactions],
  );

  const transferDestinationOptions = useMemo(() => {
    if (!entryVenue || entryType !== 'transfer') return venueOptions.filter(v => v.value !== entryVenue);
    const sourceKind = venueOptions.find(v => v.value === entryVenue)?.kind;
    if (!sourceKind) return venueOptions.filter(v => v.value !== entryVenue);
    if (effectiveEntryAssetClass === 'cash' && (sourceKind === 'Bank Account' || sourceKind === 'Savings Account')) {
      return venueOptions.filter(v => ['Bank Account', 'Savings Account', 'Other', 'Brokerage', 'Exchange'].includes(v.kind) && v.value !== entryVenue);
    }
    // "Other" accounts are universal — filter by asset class compatibility
    if (sourceKind === 'Other') {
      const compatibleKinds =
        effectiveEntryAssetClass === 'crypto' ? ['Exchange', 'Other'] :
        effectiveEntryAssetClass === 'stock' || effectiveEntryAssetClass === 'etf' ? ['Brokerage', 'Other'] :
        effectiveEntryAssetClass === 'metal' ? ['Vault', 'Other'] :
        effectiveEntryAssetClass === 'cash' ? ['Bank Account', 'Savings Account', 'Other'] :
        null;
      if (!compatibleKinds) return venueOptions.filter(v => v.value !== entryVenue);
      return venueOptions.filter(v => compatibleKinds.includes(v.kind) && v.value !== entryVenue);
    }
    return venueOptions.filter(v => v.kind === sourceKind && v.value !== entryVenue);
  }, [entryVenue, entryType, venueOptions, effectiveEntryAssetClass]);

  const updateEntryClass = (
    nextAssetClass: LedgerAssetClass,
    nextAssetSymbol?: string,
    pricingContextChanged = true,
  ) => {
    if (pricingContextChanged) markSpotContextDirty();
    const validAssetSymbol = getValidAssetSymbol(nextAssetClass, nextAssetSymbol);
    setEntryAssetClass(nextAssetClass);
    setEntryAsset(validAssetSymbol);
    setEntryQuote(getDefaultQuoteForSelection(nextAssetClass, validAssetSymbol));
    setMetalFineness(
      nextAssetClass === 'metal'
        ? getPurityOptionsForMetal(validAssetSymbol)[0]?.fineness ?? ''
        : '',
    );
  };

  const handleEntryTypeChange = (nextType: InvestmentTransactionType) => {
    markSpotContextDirty();
    setEntryType(nextType);
    if (selectedVenueKind) return; // Venue kind dictates allowed classes, don't auto-switch unless necessary
    const allowedClasses = getAllowedAssetClasses(nextType);
    if (!allowedClasses.includes(effectiveEntryAssetClass)) {
      updateEntryClass(allowedClasses[0], undefined, false);
    }
  };

  const handleEntryVenueChange = (
    nextVenue: string,
    pricingContextChanged = true,
  ) => {
    const kind = venueOptions.find((v) => v.value === nextVenue)?.kind;
    if (pricingContextChanged) {
      const compatible = getVenueCompatibleAssetClasses(allowedAssetClasses, kind ?? null).includes(effectiveEntryAssetClass);
      if (!isTradeLike || !compatible) markSpotContextDirty();
      clearTradeError();
    }
    setEntryVenue(nextVenue);
    // Reset destination if it's no longer the same kind as the new source
    if (entryDestinationVenue) {
      const destKind = venueOptions.find((v) => v.value === entryDestinationVenue)?.kind;
      if (destKind !== kind) setEntryDestinationVenue('');
    }
    if (kind === 'Vault') {
      if (effectiveEntryAssetClass !== 'metal') updateEntryClass('metal', undefined, false);
      if (entryType !== 'transfer' && entryType !== 'buy' && entryType !== 'sell') setEntryType('buy');
    } else if (kind === 'Exchange') {
      if (effectiveEntryAssetClass !== 'crypto') updateEntryClass('crypto', undefined, false);
      if (entryType !== 'transfer' && entryType !== 'buy' && entryType !== 'sell') setEntryType('buy');
    } else if (kind === 'Brokerage') {
      if (effectiveEntryAssetClass !== 'stock' && effectiveEntryAssetClass !== 'etf') updateEntryClass('stock', undefined, false);
      if (entryType !== 'transfer' && entryType !== 'buy' && entryType !== 'sell' && entryType !== 'dividend') setEntryType('buy');
    } else if (kind === 'Bank Account' || kind === 'Savings Account') {
      if (effectiveEntryAssetClass !== 'cash') updateEntryClass('cash', undefined, false);
      if (entryType !== 'transfer' && entryType !== 'deposit' && entryType !== 'withdrawal') setEntryType('deposit');
    }
  };

  useEffect(() => {
    // Initial sync if opened with a specific venue
    if (initialVenue && !editTransaction && !cashFunding) {
      handleEntryVenueChange(initialVenue, false);
    }
  }, []);

  const handleEntryAssetChange = (nextAssetSymbol: string) => {
    if (nextAssetSymbol === activeEntryAsset && isTradeLike) return;
    clearTradeError();
    markSpotContextDirty();
    setEntryAsset(nextAssetSymbol);
    setEntryQuote(getDefaultQuoteForSelection(effectiveEntryAssetClass, nextAssetSymbol));
    // Reset to highest purity when switching metal
    if (effectiveEntryAssetClass === 'metal') {
      const options = getPurityOptionsForMetal(nextAssetSymbol);
      setMetalFineness(options[0]?.fineness ?? '');
    }
  };

  const clearTradeError = () => {
    if (!tradePresentation) return;
    setInvalidField(null);
    setFormError(null);
    setCashShortfall(null);
  };

  const handleEntryDateChange = (nextDate: string) => {
    if (isTradeLike) {
      enteredExecutionTime.current = true;
      cancelTradeReference();
    } else markSpotContextDirty();
    clearTradeError();
    setEntryDate(nextDate);
  };

  const handleEntryQuoteChange = (nextQuote: string) => {
    clearTradeError();
    markSpotContextDirty();
    setEntryQuote(nextQuote);
  };

  const bindAssetSelect = useCallback((select: HTMLSelectElement | null) => {
    assetSelectCleanupRef.current?.();
    assetSelectCleanupRef.current = null;
    if (!select) return;

    const syncSelectedAsset = () => {
      const nextAsset = select.value;
      if (!nextAsset) return;
      setObservedEntryAsset(nextAsset);
      if (nextAsset !== entryAsset) {
        handleEntryAssetChange(nextAsset);
      }
    };

    syncSelectedAsset();
    select.addEventListener('input', syncSelectedAsset);
    select.addEventListener('change', syncSelectedAsset);
    const intervalId = window.setInterval(syncSelectedAsset, 150);
    assetSelectCleanupRef.current = () => {
      select.removeEventListener('input', syncSelectedAsset);
      select.removeEventListener('change', syncSelectedAsset);
      window.clearInterval(intervalId);
    };
  }, [entryAsset, handleEntryAssetChange]);

  useEffect(() => () => {
    assetSelectCleanupRef.current?.();
  }, []);

  const handlePriceManualChange = (value: number) => {
    invalidateAutoSpotPrice();
    setEntryPrice(value);
    updatePriceSource('custom');
  };

  // Lock-based recalculation using a frozen snapshot of the locked field value.
  // lockedValueRef holds the value that was current when the user clicked the lock icon.
  const handleAmountChange = (value: number) => {
    setEntryAmount(value);
    if (lockedField === 'total' && value > 0) {
      invalidateAutoSpotPrice();
      // Locked total → price = frozenTotal / newAmount
      setEntryPrice(Number((lockedValueRef.current / value).toFixed(4)));
      updatePriceSource('custom');
    }
    // lockedField === 'price': total changes automatically (amount × price), nothing extra needed
  };

  const handlePriceChange = (value: number) => {
    invalidateAutoSpotPrice();
    setEntryPrice(value);
    updatePriceSource('custom');
    if (lockedField === 'total' && value > 0) {
      // Locked total → amount = frozenTotal / newPrice
      setEntryAmount(Number((lockedValueRef.current / value).toFixed(8)));
    }
    // lockedField === 'amount': total changes automatically (amount × price), nothing extra needed
  };

  const handleTotalChange = (value: number) => {
    if (lockedField === 'price' && entryPrice > 0) {
      setEntryAmount(Number((value / entryPrice).toFixed(8)));
    } else if (lockedField === 'amount' && entryAmount > 0) {
      invalidateAutoSpotPrice();
      setEntryPrice(Number((value / entryAmount).toFixed(4)));
      updatePriceSource('custom');
    }
  };

  const resetCashWarning = () => {
    setCashShortfall(null);
    setCashFixSourceVenue('');
  };

  const showCashShortfall = (result: BuyCashValidationResult) => {
    const accountLabel =
      result.venue.trim().toLowerCase() === settlementVenue.trim().toLowerCase()
        ? settlementLabel || result.venue
        : result.venue;
    setCashShortfall({
      accountLabel,
      cashVenue: result.venue,
      required: result.required,
      available: result.available,
      missing: result.missing,
      symbol: result.symbol,
    });
    setFormError(
      `${t('Not enough cash in')} ${accountLabel}. ${t('Required')}: ${result.required.toLocaleString(language === 'ar' ? 'ar-SA' : language === 'de' ? 'de-DE' : 'en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${result.symbol}. ${t('Available')}: ${result.available.toLocaleString(language === 'ar' ? 'ar-SA' : language === 'de' ? 'de-DE' : 'en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${result.symbol}. ${t('Missing')}: ${result.missing.toLocaleString(language === 'ar' ? 'ar-SA' : language === 'de' ? 'de-DE' : 'en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${result.symbol}.`,
    );
  };

  const showFieldError = (name: string, message: string) => {
    setInvalidField(name);
    setFormError(message);
    document.getElementById(fieldId(name))?.focus();
  };

  const fieldError = (name: string) => ({
    'aria-invalid': invalidField === name || undefined,
    'aria-describedby': invalidField === name ? fieldId('error') : undefined,
  });

  const handleAddTransaction = async () => {
    if (savePendingRef.current) return;
    setInvalidField(null);
    setFormError(null);
    resetCashWarning();
    const assetClassForSubmit = effectiveEntryAssetClass;
    const assetForSubmit = cashFunding ? entryQuote : activeEntryAsset;
    if (!entryVenue.trim()) { showFieldError('account', t('Select the account, broker, bank, or exchange used for this transaction.')); return; }
    if (isTradeLike && !venueOptions.some(venue => venue.value === entryVenue)) {
      showFieldError('account', t('Select an active account for this trade.'));
      return;
    }
    if (!assetForSubmit) { showFieldError('asset', t('Select an asset or cash symbol first.')); return; }
    if (!Number.isFinite(entryAmount) || entryAmount <= 0) {
      showFieldError('amount', t('Amount must be greater than zero.'));
      return;
    }
    if (!Number.isFinite(transactionDate.getTime())) { showFieldError('date', t('Enter a valid transaction date.')); return; }
    const submittedDate = savedInstant ?? transactionDate.toISOString();
    if (assetClassForSubmit === 'metal' && metalFineness === '') {
      showFieldError('fineness', t('Select a fineness value first.'));
      return;
    }
    const submittedMetalFineness =
      assetClassForSubmit === 'metal' ? Number(metalFineness) : undefined;
    const hasAnyFxInput =
      entryFxRateToEur.trim().length > 0
      || entryFxRateSource !== ''
      || entryFxRateDate !== '';
    let submittedFx:
      | {
          fxRateToEur: number;
          fxRateSource: TransactionFxSource;
          fxRateDate: string;
        }
      | undefined;

    if (entryQuote !== 'EUR' && hasAnyFxInput) {
      const parsedRate = Number(entryFxRateToEur);
      if (
        !Number.isFinite(parsedRate)
        || parsedRate <= 0
        || entryFxRateSource === ''
        || !/^\d{4}-\d{2}-\d{2}$/.test(entryFxRateDate)
      ) {
        showFieldError(!Number.isFinite(parsedRate) || parsedRate <= 0 ? 'fx-rate' : entryFxRateSource === '' ? 'fx-source' : 'fx-date', t('Complete all FX fields with a positive rate, or leave all of them blank.'));
        return;
      }

      const transactionTimestamp = transactionDate.getTime();
      const fxTimestamp = Date.parse(`${entryFxRateDate}T00:00:00Z`);
      if (
        !Number.isFinite(transactionTimestamp)
        || !Number.isFinite(fxTimestamp)
        || Math.abs(transactionTimestamp - fxTimestamp) > 7 * 86_400_000
      ) {
        showFieldError('fx-date', t('The FX rate date must be within seven days of the transaction.'));
        return;
      }

      submittedFx = {
        fxRateToEur: parsedRate,
        fxRateSource: entryFxRateSource,
        fxRateDate: entryFxRateDate,
      };
    }

    // Inventory Validation: Sell what you have
    const isReducing = entryType === 'sell' || entryType === 'withdrawal' || entryType === 'transfer';
    // For non-cash assets, validate balance. For bank/savings cash withdrawals, also validate.
    const needsBalanceCheck = isReducing && (assetClassForSubmit !== 'cash' || selectedVenueKind === 'Bank Account' || selectedVenueKind === 'Savings Account');
    if (needsBalanceCheck) {
      if (entryAmount > currentAssetBalance) {
        showFieldError('amount', `${t('Not enough balance. Maximum available')}: ${currentAssetBalance.toLocaleString(language === 'ar' ? 'ar-SA' : language === 'de' ? 'de-DE' : 'en-US', { maximumFractionDigits: 8 })} ${entryType === 'sell' ? assetForSubmit : entryQuote}`);
        return;
      }
    }

    if (isTradeLike && (!Number.isFinite(entryPrice) || entryPrice <= 0 || !Number.isFinite(grossTotal))) {
      showFieldError('price', t('Enter a valid execution price greater than zero.'));
      return;
    }
    if (isTradeLike && (!Number.isFinite(calculatedFee) || calculatedFee < 0)) {
      showFieldError('fee', t('Enter a valid, non-negative fee.'));
      return;
    }

    const finalNotes = entryNotes.trim();

    const finalTotal = Number(grossTotal.toFixed(2));
    const finalFee = Number(calculatedFee.toFixed(2));
    const finalTax = entryType === 'dividend' ? Number(entryTax) : 0;
    const needsInvestmentCashRoute = tradeLikeTypes.includes(entryType) && assetClassForSubmit !== 'cash';

    if (needsInvestmentCashRoute && !settlementRoute) {
      setFormError(t('Assign an Investment-Cash account for this asset type before saving this buy or sell.'));
      return;
    }

    if (isTradeLike) {
      const tradeCandidate: InvestmentTransaction = {
        id: editTransaction?.id ?? 'pending-buy',
        date: submittedDate,
        venue: entryVenue.trim(),
        type: entryType,
        settlementVenue,
        asset: assetForSubmit,
        assetClass: assetClassForSubmit,
        quote: entryQuote,
        amount: Number(entryAmount),
        price: showPricedFields ? Number(entryPrice) : 1,
        total: finalTotal,
        fee: finalFee,
        taxAmount: finalTax,
        taxType: inferTaxType(entryType, assetClassForSubmit),
        source: 'manual',
        metalFineness: submittedMetalFineness,
        ...submittedFx,
      };
      const changesBalances = !editTransaction || (
        (['date', 'venue', 'type', 'asset', 'amount', 'total', 'fee', 'quote', 'settlementVenue'] as const)
          .some(key => tradeCandidate[key] !== editTransaction[key])
      );
      if (changesBalances && hasAmbiguousTradeOrder(transactions.filter(row => row.id !== editTransaction?.id), tradeCandidate)) {
        showFieldError('date', t('This execution time conflicts with another entry. Check the actual time.'));
        return;
      }
      if (entryType === 'buy') {
        const cashValidation = validateBuyCashAvailability(transactions, tradeCandidate, {
          excludeTransactionId: editTransaction?.id,
        });
        if (!cashValidation.ok) {
          showCashShortfall(cashValidation);
          return;
        }
      }
    }

    savePendingRef.current = true;
    setIsSaving(true);
    try {
      if (isEditMode && editTransaction) {
        const updatedTx: any = {
          ...editTransaction,
          date: submittedDate,
          venue: entryVenue.trim(),
          settlementVenue: needsInvestmentCashRoute ? settlementVenue : undefined,
          type: entryType,
          asset: assetForSubmit,
          assetName: t(trackableAssetOptionsByClass(assetClassForSubmit).find((a) => a.symbol === assetForSubmit)?.name || ''),
          assetClass: assetClassForSubmit,
          quote: entryQuote,
          amount: entryType === 'dividend' ? Number(entryGross) : Number(entryAmount),
          price: entryType === 'dividend' ? 1 : (showPricedFields ? Number(entryPrice) : 1),
          total: finalTotal,
          fee: finalFee,
          taxAmount: finalTax,
          taxType: inferTaxType(entryType, assetClassForSubmit),
          feeMode: (entryType === 'buy' || entryType === 'sell' || entryType === 'dividend') ? entryFeeMode : 'none',
          metalFineness: submittedMetalFineness,
          ...submittedFx,
        };
        if (assetClassForSubmit !== 'metal') {
          delete updatedTx.metalFineness;
        }
        if (!submittedFx) {
          delete updatedTx.fxRateToEur;
          delete updatedTx.fxRateSource;
          delete updatedTx.fxRateDate;
        }
        if (finalNotes) {
          updatedTx.notes = finalNotes;
        } else {
          delete updatedTx.notes;
        }
        await updateManualTransaction(updatedTx);
      } else if (entryType === 'transfer') {
        if (!entryDestinationVenue) {
          setFormError(t('Select a destination account first.'));
          return;
        }
        if (entryVenue === entryDestinationVenue) {
          setFormError(t('Source and destination must be different.'));
          return;
        }

        const transferTimestamp = Date.now();
        const transferGroupId = `transfer-${transferTimestamp}`;
        const transferredCostBasisEur =
          assetClassForSubmit !== 'cash'
          && currentAssetHolding?.costBasisAvailable
            ? Number(
                (currentAssetHolding.avgCost * Number(entryAmount)).toFixed(2),
              )
            : undefined;
        const txOut = {
          id: `manual-${transferTimestamp}-out`,
          date: submittedDate,
          venue: entryVenue.trim(),
          type: 'transfer' as const,
          asset: assetForSubmit,
          assetName: t(trackableAssetOptionsByClass(assetClassForSubmit).find((asset) => asset.symbol === assetForSubmit)?.name || ''),
          assetClass: assetClassForSubmit,
          quote: entryQuote,
          amount: Number(entryAmount),
          price: assetClassForSubmit === 'cash' ? 1 : 0,
          total: assetClassForSubmit === 'cash' ? Number(entryAmount) : 0,
          fee: finalFee,
          taxType: 'transfer_out' as const,
          source: 'manual' as const,
          transferGroupId,
          ...(assetClassForSubmit !== 'cash' ? {
            transferredCostBasisStatus: transferredCostBasisEur !== undefined ? 'known' as const : 'unknown' as const,
          } : {}),
          ...(assetClassForSubmit === 'metal'
            ? { metalFineness: submittedMetalFineness }
            : {}),
          ...submittedFx,
          ...(transferredCostBasisEur !== undefined
            ? { transferredCostBasisEur }
            : {}),
          ...(finalNotes ? { notes: finalNotes } : {}),
        };

        const txIn = {
          ...txOut,
          id: `manual-${transferTimestamp}-in`,
          venue: entryDestinationVenue.trim(),
          taxType: 'transfer_in' as const,
          fee: 0,
          notes: finalNotes ? `${finalNotes} (Incoming Transfer)` : t('Incoming Transfer'),
        };

        await addManualTransactions([txOut, txIn]);
      } else {
        await addManualTransaction({
          id: `manual-${Date.now()}`,
          date: submittedDate,
          venue: entryVenue.trim(),
          settlementVenue: needsInvestmentCashRoute ? settlementVenue : undefined,
          type: entryType,
          asset: assetForSubmit,
          assetName: t(trackableAssetOptionsByClass(assetClassForSubmit).find((asset) => asset.symbol === assetForSubmit)?.name || ''),
          assetClass: assetClassForSubmit,
          quote: entryQuote,
          amount: entryType === 'dividend' ? Number(entryGross) : Number(entryAmount),
          price: entryType === 'dividend' ? 1 : (isTradeLike ? Number(entryPrice) : 1),
          total: finalTotal,
          fee: finalFee,
          taxAmount: finalTax,
          taxType: inferTaxType(entryType, assetClassForSubmit),
          source: 'manual',
          feeMode: (entryType === 'buy' || entryType === 'sell' || entryType === 'dividend') ? entryFeeMode : 'none',
          metalFineness: submittedMetalFineness,
          ...submittedFx,
          ...(finalNotes ? { notes: finalNotes } : {}),
        });
      }
    } catch (error) {
      if (error instanceof InsufficientCashError) {
        showCashShortfall(error.result);
        return;
      }
      if (isTradeLike && error instanceof InvalidLedgerError && error.issue.code === 'insufficient_asset') {
        showFieldError('amount', t('This trade would leave insufficient holdings at its execution time or for a later entry.'));
        return;
      }
      setFormError(t('Failed to save'));
      return;
    } finally {
      savePendingRef.current = false;
      setIsSaving(false);
    }

    (onSaved ?? onClose)();
  };

  if (fundingVenue && cashShortfall) {
    const destinationVenue = fundingVenue === cashShortfall.cashVenue ? undefined : cashShortfall.cashVenue;
    return (
      <GlobalAddModal
        initialVenue={fundingVenue}
        initialType={destinationVenue ? 'transfer' : 'deposit'}
        initialAssetClass="cash"
        initialAsset={cashShortfall.symbol}
        cashFunding={{ currency: cashShortfall.symbol, destinationVenue }}
        onClose={() => setFundingVenue(null)}
        onSaved={() => {
          setTransactions(getAllTransactions());
          resetCashWarning();
          setFormError(null);
          setFundingVenue(null);
        }}
      />
    );
  }

  const closeDialog = () => {
    if (!savePendingRef.current) onClose();
  };

  const openFundingEntry = (venue: string) => {
    cancelTradeReference();
    setFundingVenue(venue);
  };

  return (
    <Dialog
      open
      onClose={closeDialog}
      labelledBy={fieldId('title')}
      returnFocusRef={returnFocusRef}
      className={tradePresentation ? 'account-create-overlay trade-entry-overlay' : undefined}
      contentClassName={tradePresentation ? 'card trade-entry-panel' : 'card'}
      contentStyle={{
        width: '100%',
        maxWidth: 720,
        maxHeight: '92vh',
        overflowY: 'auto',
        background: 'var(--bg-elevated)',
        border: '1px solid var(--border)',
        padding: '32px 32px 28px',
        borderRadius: 20,
      }}
    >
        {/* ── Modal Header ── */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 28 }}>
          <div style={{ flex: 1 }}>
            {!tradePresentation && <div style={{
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: '0.12em',
              textTransform: 'uppercase',
              color: 'var(--accent-blue)',
              marginBottom: 6,
            }}>
              {isEditMode ? t('Edit Transaction') : t('New Entry')}
            </div>}
            <h2
              id={fieldId('title')}
              style={{
                fontSize: 28,
                fontWeight: 800,
                color: 'var(--text-primary)',
                lineHeight: 1.15,
                margin: '0 0 8px',
                textAlign: entryType === 'dividend' ? 'center' : 'left',
                width: '100%',
              }}
            >
              {cashFunding ? t(entryType === 'transfer' ? 'Record transfer' : 'Record deposit')
                : entryType === 'dividend' ? t('Add Dividend Entry') : isEditMode ? `${t('Edit')} ${editTransaction?.asset ?? ''}`
                : isTradeLike ? t(entryType === 'buy' ? 'Record buy' : 'Record sell') : t('Add Manual Entry')}
            </h2>
            {entryType === 'dividend' && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '24px 0 12px', borderBottom: '1px solid var(--border)', marginBottom: 24 }}>
                <div style={{ width: 48, height: 48, borderRadius: 12, background: 'var(--bg-elevated)', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid var(--border)' }}>
                   <span style={{ fontSize: 24, fontWeight: 900, color: 'var(--text-primary)' }}>i</span>
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-primary)' }}>
                    {t(trackableAssetOptionsByClass(effectiveEntryAssetClass).find(a => a.symbol === activeEntryAsset)?.name || '') || activeEntryAsset}
                  </div>
                  <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 2 }}>
                    {t('Dividend')} · {categoryLabel(t)[effectiveEntryAssetClass]} · {effectiveEntryAssetClass.toUpperCase()}
                  </div>
                </div>
              </div>
            )}
            <div style={{ fontSize: 14, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
              {isEditMode
                ? t('Update this transaction. The edit timestamp is saved automatically.')
                : cashFunding ? t('Enter the amount and date of the actual cash movement.')
                : isTradeLike ? t('Enter the quantity and execution price from your trade record.')
                : t('Record a buy, sell, deposit, withdrawal, or transfer against an account.')}
            </div>
            {isEditMode && editTransaction?.updatedAt && (
              <div style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 5,
                marginTop: 8,
                fontSize: 11,
                color: 'var(--text-muted)',
                background: 'var(--surface)',
                border: '1px solid var(--border)',
                borderRadius: 6,
                padding: '2px 8px',
              }}>
                ✎ {t('Last edited')}: {new Date(editTransaction.updatedAt).toLocaleString(language === 'ar' ? 'ar-SA' : language === 'de' ? 'de-DE' : 'en-US')}
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={closeDialog}
            disabled={isSaving}
            aria-label={t('Close')}
            className={tradePresentation ? 'trade-entry-close' : undefined}
            style={{
              marginLeft: 16,
              width: 36,
              height: 36,
              borderRadius: '50%',
              border: '1px solid var(--border)',
              background: 'var(--surface)',
              color: 'var(--text-secondary)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <X size={16} />
          </button>
        </div>

        <div style={{ display: 'grid', gap: 16 }}>
          {(selectedVenueKind === 'Bank Account' || selectedVenueKind === 'Savings Account') && (entryType === 'deposit' || entryType === 'withdrawal') ? (
            <>
              {/* ── Simplified Bank Account Form ── */}
              <div className="grid-2" style={{ gap: 24 }}>
                <div>
                  <label className="label" htmlFor="bank-transaction-type">{t('Type')}</label>
                  <select id="bank-transaction-type" className="select" disabled={!!cashFunding} value={entryType} onChange={(event) => handleEntryTypeChange(event.target.value as InvestmentTransactionType)}>
                    {Object.entries(transactionTypeLabel(t))
                      .filter(getTypeFilterFn(selectedVenueKind, effectiveEntryAssetClass))
                      .map(([value, label]) => (
                        <option key={value} value={value}>{label}</option>
                      ))}
                  </select>
                </div>
                <div>
                  <label className="label" htmlFor="bank-transaction-currency">{t('Currency')}</label>
                  <select id="bank-transaction-currency" className="select" disabled={!!cashFunding} value={entryQuote} onChange={(event) => handleEntryQuoteChange(event.target.value)}>
                    <option value="EUR">EUR (€)</option>
                    <option value="USD">USD ($)</option>
                    <option value="GBP">GBP (£)</option>
                    <option value="CHF">CHF</option>
                  </select>
                </div>
              </div>

              <div className="grid-2" style={{ gap: 24 }}>
                <div>
                  <label className="label" htmlFor={fieldId('amount')}>
                    {entryType === 'deposit' ? t('Deposit Amount') : t('Withdrawal Amount')}
                  </label>
                  <div style={{ position: 'relative' }}>
                    <input
                      type="number"
                      className="input"
                      id={fieldId('amount')}
                      {...fieldError('amount')}
                      min={0.01}
                      step={0.01}
                      placeholder="0.00"
                      value={entryAmount || ''}
                      onChange={(e) => { clearTradeError(); setEntryAmount(normalizeNum(e.target.value)); }}
                      style={{ paddingRight: 40 }}
                    />
                    <span style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', pointerEvents: 'none' }}>
                      {entryQuote === 'USD' ? '$' : entryQuote === 'GBP' ? '£' : entryQuote === 'CHF' ? 'CHF' : '€'}
                    </span>
                  </div>
                  {entryType === 'withdrawal' && currentAssetBalance > 0 && (
                    <div style={{ fontSize: 12, marginTop: 5, color: entryAmount > currentAssetBalance ? 'var(--red)' : 'var(--text-muted)' }}>
                      {t('Available balance')}: {currentAssetBalance.toLocaleString(language === 'ar' ? 'ar-SA' : language === 'de' ? 'de-DE' : 'en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {entryQuote}
                    </div>
                  )}
                </div>
                <div>
                  <label className="label" htmlFor={fieldId('date')}>{t('Date & Time')}</label>
                  <input
                    id={fieldId('date')}
                    {...fieldError('date')}
                    type="datetime-local"
                    className="input"
                    value={entryDate}
                    onChange={(e) => handleEntryDateChange(e.target.value)}
                  />
                </div>
              </div>

              <div>
                <label className="label">{t('Notes')} <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>({t('optional')})</span></label>
                <input
                  type="text"
                  className="input"
                  placeholder={entryType === 'deposit' ? t('e.g. Salary') : t('e.g. Rent')}
                  value={entryNotes}
                  onChange={(e) => setEntryNotes(e.target.value)}
                />
              </div>
            </>
          ) : entryType === 'dividend' ? (
            <>
              <div className="grid-3" style={{ gap: 24 }}>
                <div>
                  <label className="label">{t('Type')}</label>
                  <select className="select" value={entryType} onChange={(event) => handleEntryTypeChange(event.target.value as InvestmentTransactionType)}>
                    {Object.entries(transactionTypeLabel(t))
                      .filter(getTypeFilterFn(selectedVenueKind, effectiveEntryAssetClass))
                      .map(([value, label]) => (
                      <option key={value} value={value}>{label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="label">{t('Category')}</label>
                  <select className="select" value={effectiveEntryAssetClass} onChange={(event) => updateEntryClass(event.target.value as LedgerAssetClass)}>
                    <option value="stock">{t('Stocks')}</option>
                    <option value="etf">{t('ETFs')}</option>
                  </select>
                </div>
                <div>
                  <label className="label">{t('Security')}</label>
                  <select
                    ref={bindAssetSelect}
                    className="select"
                    value={activeEntryAsset}
                    onInput={(event) => handleEntryAssetChange(event.currentTarget.value)}
                    onChange={(event) => handleEntryAssetChange(event.target.value)}
                  >
                    {trackableAssetOptionsByClass(effectiveEntryAssetClass)
                      .filter(asset => ownedAssetsAtVenue.includes(asset.symbol.toUpperCase()))
                      .map((asset) => (
                        <option key={asset.symbol} value={asset.symbol}>{asset.symbol} · {asset.name}</option>
                      ))}
                    {trackableAssetOptionsByClass(effectiveEntryAssetClass).filter(a => ownedAssetsAtVenue.includes(a.symbol.toUpperCase())).length === 0 && (
                      <option value="" disabled>{t('No holdings for dividends')}</option>
                    )}
                  </select>
                </div>
              </div>

              <div className="grid-2" style={{ gap: 24 }}>
                <div>
                  <label className="label" htmlFor="dividend-transaction-date">{t('Date')}</label>
                  <input
                    id="dividend-transaction-date"
                    type="date"
                    className="input"
                    value={entryDate.split('T')[0]}
                    onChange={(e) => handleEntryDateChange(`${e.target.value}T${entryDate.split('T')[1] || '12:00'}`)}
                  />
                </div>
                <div>
                  <label className="label" htmlFor="dividend-transaction-currency">{t('Currency')}</label>
                  <select id="dividend-transaction-currency" className="select" value={entryQuote} onChange={(event) => handleEntryQuoteChange(event.target.value)}>
                    <option value="EUR">EUR</option>
                    <option value="USD">USD</option>
                  </select>
                </div>
              </div>

              <div className="grid-4" style={{ gap: 16 }}>
                <div>
                  <label className="label">{t('Dividend Amount')}</label>
                  <div style={{ position: 'relative' }}>
                    <input
                      type="number"
                      className="input"
                      value={entryGross || ''}
                      onChange={(e) => setEntryGross(normalizeNum(e.target.value))}
                    />
                    <span style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }}>
                      {entryQuote === 'USD' ? '$' : '€'}
                    </span>
                  </div>
                </div>
                <div>
                  <label className="label">{t('Tax withheld')}</label>
                  <div style={{ position: 'relative' }}>
                    <input
                      type="number"
                      className="input"
                      value={entryTax || ''}
                      onChange={(e) => setEntryTax(normalizeNum(e.target.value))}
                    />
                    <span style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }}>
                      {entryQuote === 'USD' ? '$' : '€'}
                    </span>
                  </div>
                </div>
                <div>
                  <label className="label">{t('Fees')}</label>
                  <div style={{ position: 'relative' }}>
                    <input
                      type="number"
                      className="input"
                      value={entryFeeInput || ''}
                      onChange={(e) => setEntryFeeInput(normalizeNum(e.target.value))}
                    />
                    <span style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }}>
                      {entryQuote === 'USD' ? '$' : '€'}
                    </span>
                  </div>
                </div>
                <div>
                  <label className="label" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    {t('Total')} <Lock size={12} style={{ opacity: 0.5 }} />
                  </label>
                  <div style={{ position: 'relative' }}>
                    <input
                      type="number"
                      className="input"
                      value={Number(grossTotal.toFixed(2))}
                      disabled
                      style={{ background: 'var(--bg-elevated)', opacity: 0.8 }}
                    />
                    <span style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }}>
                      {entryQuote === 'USD' ? '$' : '€'}
                    </span>
                  </div>
                </div>
              </div>
            </>
          ) : entryType === 'transfer' ? (
            <>
              {!cashFunding && <div className="grid-3" style={{ gap: 24 }}>
                <div>
                  <label className="label">{t('Type')}</label>
                  <select className="select" value={entryType} onChange={(event) => handleEntryTypeChange(event.target.value as InvestmentTransactionType)}>
                    {Object.entries(transactionTypeLabel(t))
                      .filter(getTypeFilterFn(selectedVenueKind, effectiveEntryAssetClass))
                      .map(([value, label]) => (
                      <option key={value} value={value}>{label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="label">{t('Category')}</label>
                  <select
                    className="select"
                    value={effectiveEntryAssetClass}
                    onChange={(event) => updateEntryClass(event.target.value as LedgerAssetClass)}
                    disabled={!!selectedVenueKind && selectedVenueKind !== 'Other'}
                  >
                    {selectableAssetClasses.map((assetClass) => (
                      <option key={assetClass} value={assetClass}>{categoryLabel(t)[assetClass]}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <div style={{ marginBottom: 12 }}>
                    <label className="label">{t('Search Asset')}</label>
                    <div style={{ position: 'relative' }}>
                      <input
                        type="text"
                        className="input"
                        placeholder={t('Search by name, ticker, WKN, or ISIN')}
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        style={{ fontSize: '14px' }}
                      />
                      {isSearching && <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>{t('Searching...')}</div>}
                      {!isSearching && searchQuery.trim().length >= 2 && searchResults.length === 0 && (
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
                                setSelectedSearchedAsset({
                                  symbol: result.symbol,
                                  name: result.name,
                                  class: result.type === 'crypto' ? 'crypto' : (result.type === 'etf' ? 'etf' : 'stock')
                                });
                                handleEntryAssetChange(result.symbol);
                                setSearchQuery('');
                                setSearchResults([]);
                              }}
                              onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-page)'}
                              onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                            >
                              <div>
                                <div style={{ fontWeight: 500 }}>{result.name}</div>
                                <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                                  {result.symbol} • {result.exchange}
                                </div>
                              </div>
                              <div style={{ fontSize: 11, color: 'var(--text-muted)', background: 'var(--bg-page)', padding: '2px 6px', borderRadius: 4 }}>
                                {result.type}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                  <label className="label">{t('Security / Asset')}</label>
                  <select
                    ref={bindAssetSelect}
                    className="select"
                    value={activeEntryAsset}
                    onInput={(event) => handleEntryAssetChange(event.currentTarget.value)}
                    onChange={(event) => handleEntryAssetChange(event.target.value)}
                  >
                    {trackableAssetOptionsByClass(effectiveEntryAssetClass)
                      .filter(asset => ownedAssetsAtVenue.includes(asset.symbol.toUpperCase()))
                      .map((asset) => (
                        <option key={asset.symbol} value={asset.symbol}>{asset.symbol} · {asset.name}</option>
                      ))}
                    {trackableAssetOptionsByClass(effectiveEntryAssetClass).filter(a => ownedAssetsAtVenue.includes(a.symbol.toUpperCase())).length === 0 && (
                      <option value="" disabled>{t('No holdings to transfer')}</option>
                    )}
                  </select>
                </div>
              </div>}

              <div className="grid-2" style={{ gap: 24 }}>
                <div>
                  <label className="label">{t('From Account')}</label>
                  <select className="select" disabled={!!cashFunding} value={entryVenue} onChange={(event) => handleEntryVenueChange(event.target.value)}>
                    <option value="">{t('Select source')}</option>
                    {venueOptions.map((venue) => (
                      <option key={venue.value} value={venue.value}>{venue.label} · {venue.kind}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="label" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    {t('To Account')}
                    {selectedVenueKind && (
                      <span style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>
                        {selectedVenueKind === 'Exchange' ? t('Crypto accounts only') :
                         selectedVenueKind === 'Vault' ? t('Precious metal accounts only') :
                         selectedVenueKind === 'Brokerage' ? t('Brokerage accounts only') :
                         (selectedVenueKind === 'Bank Account' || selectedVenueKind === 'Savings Account') ? t('Cash accounts only') :
                         selectedVenueKind === 'Other' ? (
                           effectiveEntryAssetClass === 'crypto' ? t('Crypto & Other accounts') :
                           effectiveEntryAssetClass === 'stock' || effectiveEntryAssetClass === 'etf' ? t('Brokerage & Other accounts') :
                           effectiveEntryAssetClass === 'metal' ? t('Precious metal & Other accounts') :
                           effectiveEntryAssetClass === 'cash' ? t('Cash & Other accounts') : ''
                         ) : ''}
                      </span>
                    )}
                  </label>
                  <select className="select" disabled={!!cashFunding} value={entryDestinationVenue} onChange={(event) => setEntryDestinationVenue(event.target.value)}>
                    <option value="">{t('Select destination')}</option>
                    {transferDestinationOptions.map((venue) => (
                      <option key={venue.value} value={venue.value}>{venue.label} · {venue.kind}</option>
                    ))}
                  </select>
                  {entryVenue && transferDestinationOptions.length === 0 && (
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                      {t('No compatible destination account found.')}
                    </div>
                  )}
                </div>
              </div>

              <div className="grid-3" style={{ gap: 24 }}>
                <div>
                  <label className="label" htmlFor={fieldId('amount')}>{t('Amount')}</label>
                  <input
                    id={fieldId('amount')}
                    {...fieldError('amount')}
                    type="number"
                    className="input"
                    value={cashFunding ? entryAmount || '' : entryAmount}
                    onChange={(e) => { clearTradeError(); setEntryAmount(normalizeNum(e.target.value)); }}
                  />
                </div>
                <div>
                  <label className="label" htmlFor={fieldId('date')}>{t(cashFunding ? 'Date & Time' : 'Date')}</label>
                  <input id={fieldId('date')} {...fieldError('date')} className="input" type="datetime-local" value={entryDate} onChange={(event) => handleEntryDateChange(event.target.value)} />
                </div>
                {!cashFunding && <div>
                  <label className="label">{t('Fees')}</label>
                  <div style={{ position: 'relative' }}>
                    <input
                      type="number"
                      className="input"
                      value={entryFeeInput}
                      onChange={(e) => setEntryFeeInput(normalizeNum(e.target.value))}
                    />
                    <span style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }}>
                      {entryQuote === 'USD' ? '$' : '€'}
                    </span>
                  </div>
                </div>}
              </div>
            </>
          ) : (
            <>
            <div className={initialVenue && !isTradeLike ? 'grid-3' : 'grid-4'}>
               <div>
                <label className="label" htmlFor={fieldId('type')}>{t('Entry Type')}</label>
                <select id={fieldId('type')} className="select" value={entryType} onChange={(event) => handleEntryTypeChange(event.target.value as InvestmentTransactionType)}>
                  {Object.entries(transactionTypeLabel(t))
                    .filter(([value]) => {
                      if (selectedVenueKind === 'Vault') return value === 'buy' || value === 'sell' || value === 'transfer';
                      if (selectedVenueKind === 'Brokerage') return value === 'buy' || value === 'sell' || value === 'dividend' || value === 'transfer';
                      if (selectedVenueKind === 'Exchange') return value === 'buy' || value === 'sell' || value === 'deposit' || value === 'withdrawal' || value === 'transfer';
                      if (selectedVenueKind === 'Bank Account' || selectedVenueKind === 'Savings Account') return value === 'deposit' || value === 'withdrawal' || value === 'transfer';
                      return effectiveEntryAssetClass !== 'metal' || value === 'buy' || value === 'sell' || value === 'dividend' || value === 'transfer';
                    })
                    .map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
              </div>
               <div>
                <label className="label" htmlFor={fieldId('category')}>{t('Category')}</label>
                <select id={fieldId('category')} className="select" value={effectiveEntryAssetClass} onChange={(event) => updateEntryClass(event.target.value as LedgerAssetClass)}>
                  {selectableAssetClasses.map((assetClass) => (
                    <option key={assetClass} value={assetClass}>{categoryLabel(t)[assetClass]}</option>
                  ))}
                </select>
              </div>
               {initialVenue && isTradeLike && (
                 <div>
                  <div className="label">{t('Account')}</div>
                  <div className="input trade-entry-value">{selectedVenueLabel}</div>
                 </div>
               )}
               {!initialVenue && (
                 <div>
                  <label className="label" htmlFor={fieldId('account')}>{t('Account')}</label>
                  <select id={fieldId('account')} {...fieldError('account')} className="select" value={entryVenue} onChange={(event) => handleEntryVenueChange(event.target.value)}>
                    <option value="">{t('Select account or platform')}</option>
                    {accountOptions.map((venue) => (
                      <option key={venue.value} value={venue.value}>{venue.label} · {venue.kind}</option>
                    ))}
                  </select>
                  {isTradeLike && !entryVenue && (
                    <div className="trade-account-setup">
                      <Link href="/accounts">{t('Set up an account')}</Link>
                      <p>{t('Return here to record the trade after setup. Your draft will be cleared when you leave.')}</p>
                    </div>
                  )}
                 </div>
               )}
               <div>
                <label className="label" htmlFor="asset-transaction-currency">{t('Quote Currency')}</label>
                <select id="asset-transaction-currency" className="select" value={entryQuote} onChange={(event) => handleEntryQuoteChange(event.target.value)} disabled={effectiveEntryAssetClass === 'cash'}>
                  <option value="EUR">EUR</option>
                  <option value="USD">USD</option>
                </select>
              </div>
            </div>

            <div className="grid-2">
               <div>
                <div className="label" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
                   <label htmlFor={fieldId('asset')}>{t('Asset / Symbol')}</label>
                   {getAssetConfig(activeEntryAsset)?.compliance && (
                     <span className={`badge ${
                       getAssetShariahStatus(activeEntryAsset) === 'compliant' ? 'badge-green' :
                       getAssetShariahStatus(activeEntryAsset) === 'non_compliant' ? 'badge-red' :
                       'badge-yellow'
                     }`} style={{ fontSize: 10 }}>
                       {t(getShariahDecisionLabel(getAssetShariahStatus(activeEntryAsset)))}
                     </span>
                   )}


                 </div>
                <div style={{ position: 'relative' }}>
                  <select
                    id={fieldId('asset')}
                    {...fieldError('asset')}
                    ref={isTradeLike ? undefined : bindAssetSelect}
                    key={`${effectiveEntryAssetClass}-${entryType}`}
                    className="select"
                    value={activeEntryAsset}
                    onInput={isTradeLike ? undefined : event => handleEntryAssetChange(event.currentTarget.value)}
                    onChange={(event) => handleEntryAssetChange(event.target.value)}
                  >
                    {selectableAssetOptions.map((asset) => (
                      <option key={asset.symbol} value={asset.symbol}>{asset.symbol} · {t(asset.name)}</option>
                    ))}
                  </select>

                </div>
                {getAssetConfig(activeEntryAsset)?.compliance?.reason && (
                  <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 4, padding: '0 4px' }}>
                    {t(getAssetConfig(activeEntryAsset)?.compliance?.reason || '')}
                  </div>
                )}
              </div>
              <div>
                <label className="label" htmlFor={fieldId('date')}>{t('Date & Time')}</label>
                <input id={fieldId('date')} {...fieldError('date')} className="input" type="datetime-local" step={isTradeLike ? 1 : undefined} value={entryDate} onChange={(event) => handleEntryDateChange(event.target.value)} />
              </div>
            </div>

            {isMetalEntry && metalPurityOptions.length > 0 && (
              <div className="grid-3">
                <div>
                  <label className="label" htmlFor={fieldId('fineness')}>{t('Fineness / Purity')}</label>
                  <select
                    id={fieldId('fineness')}
                    {...fieldError('fineness')}
                    className="select"
                    value={metalFineness}
                    onChange={(event) => {
                      markSpotContextDirty();
                      setMetalFineness(
                        event.target.value === ''
                          ? ''
                          : Number(event.target.value),
                      );
                    }}
                  >
                    {metalFineness === '' && (
                      <option value="">{t('Select fineness')}</option>
                    )}
                    {metalPurityOptions.map((option) => (
                      <option key={option.fineness} value={option.fineness}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="label">{t('Purity Grade')}</label>
                  <div className="input mono" style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'var(--bg-page)' }}>
                    <span className="badge badge-yellow" style={{ fontSize: 11 }}>
                      {metalPurityOptions.find((o) => o.fineness === metalFineness)?.badge ?? '—'}
                    </span>
                    <span style={{ color: 'var(--text-secondary)', fontSize: 13 }}>
                      {metalFineness === ''
                        ? t('Unavailable')
                        : `${(metalFineness / 10).toFixed(metalFineness % 10 === 0 ? 1 : 2)}% ${t('pure')}`}
                    </span>
                  </div>
                </div>
                <div>
                  <label className="label">{t('Unit')}</label>
                  <div className="input mono" style={{ display: 'flex', alignItems: 'center', background: 'var(--bg-page)', color: 'var(--text-secondary)' }}>
                    {t('Grams (g)')}
                  </div>
                </div>
              </div>
            )}

            <div className="grid-3">
              <div>
                <div className="label" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <label htmlFor={fieldId('amount')}>{isMetalEntry ? t('Weight (grams)') : showPricedFields ? t('Amount / Quantity') : t('Cash Amount')}</label>
                  {showPricedFields && !isTradeLike && (
                    <button
                      type="button"
                      onClick={() => {
                        const next = lockedField === 'amount' ? 'total' : 'amount';
                        lockedValueRef.current = next === 'amount' ? entryAmount : grossTotal;
                        setLockedField(next);
                      }}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2, color: lockedField === 'amount' ? 'var(--accent-blue)' : 'var(--text-muted)', display: 'inline-flex' }}
                      title={lockedField === 'amount' ? t('Amount is locked — unlock') : t('Lock amount')}
                    >
                      {lockedField === 'amount' ? <Lock size={13} /> : <Unlock size={13} />}
                    </button>
                  )}
                </div>
                <input
                  className="input"
                  type="text"
                  inputMode="decimal"
                  id={fieldId('amount')}
                  {...fieldError('amount')}
                  value={isTradeLike ? tradeAmountDraft : entryAmount}
                  onChange={(event) => {
                    if (isTradeLike) {
                      clearTradeError();
                      setTradeAmountDraft(event.target.value);
                      return;
                    }
                    const v = normalizeNum(event.target.value);
                    showPricedFields ? handleAmountChange(v) : setEntryAmount(v);
                  }}
                  readOnly={showPricedFields && !isTradeLike && lockedField === 'amount'}
                  style={{
                    ...(showPricedFields && !isTradeLike && lockedField === 'amount' ? { opacity: 0.6 } : {}),
                    ...(balanceHint !== null && entryAmount > balanceHint ? { borderColor: 'var(--red)', boxShadow: '0 0 0 1px var(--red)' } : {})
                  }}
                />
                {entryType !== 'buy' && entryType !== 'deposit' && entryType !== 'adjustment' && effectiveEntryAssetClass !== 'cash' && (
                  <div style={{ fontSize: 10, marginTop: 4, display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: entryAmount > currentAssetBalance ? 'var(--red)' : 'var(--text-muted)' }}>
                        {t('Available balance')}: {Math.max(0, currentAssetBalance).toLocaleString(language === 'ar' ? 'ar-SA' : language === 'de' ? 'de-DE' : 'en-US', { maximumFractionDigits: 8 })} {activeEntryAsset}
                      </span>
                    </div>
                    {currentAssetBalance === 0 && otherVenuesWithAsset.length > 0 && (
                      <div style={{ color: 'var(--text-muted)', fontStyle: 'italic', opacity: 0.8 }}>
                        {t('Found at other venues')}: {otherVenuesWithAsset.map(ov => `${ov.venue} (${ov.balance.toLocaleString(language === 'ar' ? 'ar-SA' : language === 'de' ? 'de-DE' : 'en-US', { maximumFractionDigits: 4 })})`).join(', ')}
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div>
                <div className="label" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <label htmlFor={fieldId('price')}>{isMetalEntry ? t('Price per Gram') : showPricedFields ? t('Price per Unit') : t('Reference Price')}</label>
                  {showPricedFields && !isTradeLike && (
                    <button
                      type="button"
                      onClick={() => {
                        const next = lockedField === 'price' ? 'total' : 'price';
                        lockedValueRef.current = next === 'price' ? entryPrice : grossTotal;
                        setLockedField(next);
                      }}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2, color: lockedField === 'price' ? 'var(--accent-blue)' : 'var(--text-muted)', display: 'inline-flex' }}
                      title={lockedField === 'price' ? t('Price is locked — unlock') : t('Lock price')}
                    >
                      {lockedField === 'price' ? <Lock size={13} /> : <Unlock size={13} />}
                    </button>
                  )}
                </div>
                <input
                  className="input"
                  type="text"
                  inputMode="decimal"
                  id={fieldId('price')}
                  {...fieldError('price')}
                  value={isTradeLike ? tradePriceDraft : entryPrice}
                  onChange={(event) => {
                    if (isTradeLike) {
                      clearTradeError();
                      setTradePriceDraft(event.target.value);
                      return;
                    }
                    const v = normalizeNum(event.target.value);
                    showPricedFields ? handlePriceChange(v) : handlePriceManualChange(v);
                  }}
                  disabled={!showPricedFields}
                  readOnly={showPricedFields && !isTradeLike && lockedField === 'price'}
                  style={showPricedFields && !isTradeLike && lockedField === 'price' ? { opacity: 0.6 } : undefined}
                />
                {showPricedFields && !isTradeLike && effectiveEntryAssetClass !== 'cash' ? (
                  <div style={{ fontSize: 11, marginTop: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
                    {priceLoading ? (
                      <><Loader2 size={11} style={{ animation: 'spin 1s linear infinite', color: 'var(--accent-blue)' }} /> <span style={{ color: 'var(--text-muted)' }}>{t('Fetching price…')}</span></>
                    ) : priceSource === 'spot' ? (
                      <><Check size={11} style={{ color: 'var(--green)' }} /> <span style={{ color: 'var(--green)' }}>{t('Price fetched')}</span></>
                    ) : priceSource === 'custom' ? (
                      <span style={{ color: 'var(--text-muted)' }}>{t('Custom price')}</span>
                    ) : null}
                  </div>
                ) : null}
              </div>

              <div>
                <div className="label" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span>{t('Total')}</span>
                  {showPricedFields && !isTradeLike && (
                    <button
                      type="button"
                      onClick={() => {
                        const next = lockedField === 'total' ? 'amount' : 'total';
                        lockedValueRef.current = next === 'total' ? grossTotal : entryAmount;
                        setLockedField(next);
                      }}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2, color: lockedField === 'total' ? 'var(--accent-blue)' : 'var(--text-muted)', display: 'inline-flex' }}
                      title={lockedField === 'total' ? t('Total is locked — unlock') : t('Lock total')}
                    >
                      {lockedField === 'total' ? <Lock size={13} /> : <Unlock size={13} />}
                    </button>
                  )}
                </div>
                {showPricedFields && !isTradeLike && lockedField !== 'total' ? (
                  <input
                    className="input"
                    type="text"
                    inputMode="decimal"
                    value={Number(grossTotal.toFixed(2))}
                    onChange={(event) => handleTotalChange(normalizeNum(event.target.value))}
                  />
                ) : (
                  <div className="input mono" style={{ display: 'flex', alignItems: 'center', background: showPricedFields ? undefined : 'var(--bg-page)', opacity: showPricedFields && !isTradeLike && lockedField === 'total' ? 0.6 : 1 }}>
                    {isTradeLike && !validTradeAmounts ? '—' : `${grossTotal.toLocaleString(language === 'ar' ? 'ar-SA' : language === 'de' ? 'de-DE' : 'en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${entryQuote}`}
                  </div>
                )}
              </div>
            </div>
            {isTradeLike && (
              <div className="trade-reference-actions">
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => void lookupTradeReference()}
                  disabled={visibleTradeReference?.status === 'loading' || !entryDate}
                >
                  {t('Find reference price')}
                </button>
                {visibleTradeReference && (
                  <span role="status" className="trade-reference-status">
                    {referenceValue ? (
                      <><bdi>{tradeNumberText(referenceValue.price, language)} {entryQuote}{isMetalEntry && '/g'}</bdi> · <bdi>{referenceValue.date}</bdi> · <bdi>{referenceValue.source}</bdi></>
                    ) : visibleTradeReference.status === 'loading' ? t('Fetching price…') : t('No eligible historical reference was found.')}
                  </span>
                )}
                {referenceValue && (
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => {
                      clearTradeError();
                      setTradePriceDraft(tradeNumberText(referenceValue.price, language));
                    }}
                  >
                    {t('Use reference price')}
                  </button>
                )}
              </div>
            )}
            <div className="grid-3">
              <div>
                <label className="label" htmlFor={fieldId('fee-model')}>{t('Fee Model')}</label>
                <select
                  id={fieldId('fee-model')}
                  className="select"
                  value={(entryType === 'buy' || entryType === 'sell') ? entryFeeMode : 'none'}
                  onChange={(event) => setEntryFeeMode(event.target.value as FeeInputMode)}
                  disabled={!(entryType === 'buy' || entryType === 'sell')}
                >
                  <option value="none">{t('No fee')}</option>
                  <option value="flat">{t('Fixed fee')}</option>
                  <option value="percent">{t('Percent of total')}</option>
                </select>
              </div>
              <div>
                <label className="label" htmlFor={fieldId('fee')}>{t('Fee Input')}</label>
                <input
                  id={fieldId('fee')}
                  {...fieldError('fee')}
                  className="input"
                  type="number"
                  min={0}
                  step="0.01"
                  value={entryFeeInput}
                  onChange={(event) => { clearTradeError(); setEntryFeeInput(Number(event.target.value)); }}
                  disabled={!(entryType === 'buy' || entryType === 'sell') || entryFeeMode === 'none'}
                />
              </div>
              <div>
                <label className="label">{t('Applied Fee')}</label>
                <div className="input mono" style={{ display: 'flex', alignItems: 'center', background: 'var(--bg-page)' }}>
                  {calculatedFee.toLocaleString(language === 'ar' ? 'ar-SA' : language === 'de' ? 'de-DE' : 'en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {entryQuote}
                </div>
              </div>
            </div>

            <div>
              <label className="label" htmlFor={fieldId('notes')}>{t('Notes')}</label>
              <textarea id={fieldId('notes')} rows={2} className="input" value={entryNotes} onChange={(event) => setEntryNotes(event.target.value)} placeholder={t('Optional context such as broker statement, dividend note, or correction reason')} />
            </div>
            </>
          )}
        </div>

        {entryQuote !== 'EUR' ? (
          <div
            className="callout"
            style={{
              display: 'grid',
              gap: 12,
              marginTop: 16,
            }}
          >
            <div>
              <strong>{t('Historical FX to EUR')}</strong>
              <div style={{ color: 'var(--text-muted)', fontSize: 12, marginTop: 3 }}>
                {t('Optional. Without a documented rate, EUR calculations for this transaction remain unavailable.')}
              </div>
            </div>
            <div className="grid-3">
              <div>
                <label className="label" htmlFor={fieldId('fx-rate')}>{t('EUR per 1 unit')}</label>
                <input
                  id={fieldId('fx-rate')}
                  {...fieldError('fx-rate')}
                  className="input"
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="any"
                  value={entryFxRateToEur}
                  onChange={(event) => setEntryFxRateToEur(event.target.value)}
                  placeholder="0.91"
                />
              </div>
              <div>
                <label className="label" htmlFor={fieldId('fx-source')}>{t('Rate source')}</label>
                <select
                  id={fieldId('fx-source')}
                  {...fieldError('fx-source')}
                  className="select"
                  value={entryFxRateSource}
                  onChange={(event) =>
                    setEntryFxRateSource(
                      event.target.value as TransactionFxSource | '',
                    )
                  }
                >
                  <option value="">{t('Select source')}</option>
                  <option value="broker_statement">{t('Broker statement')}</option>
                  <option value="market_provider">{t('Market data provider')}</option>
                  <option value="user_entered">{t('Entered manually')}</option>
                </select>
              </div>
              <div>
                <label className="label" htmlFor={fieldId('fx-date')}>{t('Rate date')}</label>
                <input
                  id={fieldId('fx-date')}
                  {...fieldError('fx-date')}
                  className="input"
                  type="date"
                  value={entryFxRateDate}
                  onChange={(event) => setEntryFxRateDate(event.target.value)}
                />
              </div>
            </div>
          </div>
        ) : null}

            {/* ── Footer ── */}
            <div style={{ borderTop: '1px solid var(--border)', paddingTop: 20, marginTop: 8 }}>
              {formError && (
                <div id={fieldId('error')} className="callout error" role="alert" style={{ marginBottom: 12 }}>
                  <span style={{ color: 'var(--red)', fontSize: 13 }}>{formError}</span>
                </div>
              )}
              {tradeLikeTypes.includes(entryType) && effectiveEntryAssetClass !== 'cash' && !cashShortfall ? (
                <div className="callout" style={{ marginBottom: 12 }}>
                  <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                    <strong>{t('Investment-Cash')}</strong>{' '}
                    {settlementRoute ? <bdi>{settlementLabel}</bdi> : <Link href="/accounts">{t('Set up an Investment-Cash account')}</Link>} ·{' '}
                    {entryType === 'buy' ? (
                      <>
                        {t('Available')}: <bdi>{availableCashForBuy.toLocaleString(language === 'ar' ? 'ar-SA' : language === 'de' ? 'de-DE' : 'en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {entryQuote}</bdi>
                        {validTradeAmounts && <> · {t('Required')}: <bdi>{requiredCashForBuy.toLocaleString(language === 'ar' ? 'ar-SA' : language === 'de' ? 'de-DE' : 'en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {entryQuote}</bdi></>}
                      </>
                    ) : (
                      <>{t('Sale proceeds are booked there automatically.')}</>
                    )}
                  </div>
                  {!settlementRoute && <p className="trade-account-setup">{t('Return here to record the trade after setup. Your draft will be cleared when you leave.')}</p>}
                </div>
              ) : null}
              {cashShortfall ? (
                <div className="callout warn" style={{ marginBottom: 12, display: 'grid', gap: 12 }}>
                  <div style={{ fontSize: 13, lineHeight: 1.5 }}>
                    <strong>{t('Cash correction required')}</strong>
                    <div>
                      {cashShortfall.accountLabel}: {t('Required')} {cashShortfall.required.toLocaleString(language === 'ar' ? 'ar-SA' : language === 'de' ? 'de-DE' : 'en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {cashShortfall.symbol} ·{' '}
                      {t('Available')} {cashShortfall.available.toLocaleString(language === 'ar' ? 'ar-SA' : language === 'de' ? 'de-DE' : 'en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {cashShortfall.symbol} ·{' '}
                      {t('Missing')} {cashShortfall.missing.toLocaleString(language === 'ar' ? 'ar-SA' : language === 'de' ? 'de-DE' : 'en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {cashShortfall.symbol}
                    </div>
                  </div>
                  <div className="trade-funding-actions">
                    {cashFixSources.length > 0 ? (
                      <select
                        aria-label={t('Select cash source')}
                        className="select"
                        value={cashFixSourceVenue}
                        onChange={(event) => setCashFixSourceVenue(event.target.value)}
                      >
                        <option value="">{t('Select cash source')}</option>
                        {cashFixSources.map((source) => {
                          const meta = getVenueMeta(source.venue, manualAccounts);
                          return (
                            <option key={`${source.venue}-${source.symbol}`} value={source.venue}>
                              {meta.label} · {source.amount.toLocaleString(language === 'ar' ? 'ar-SA' : language === 'de' ? 'de-DE' : 'en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {source.symbol}
                            </option>
                          );
                        })}
                      </select>
                    ) : (
                      <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                        {t('No matching cash source found.')}
                      </div>
                    )}
                    {cashFixSources.length > 0 ? (
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        onClick={() => openFundingEntry(cashFixSourceVenue)}
                        disabled={!cashFixSourceVenue || isSaving}
                      >
                        {t('Record transfer')}
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() => openFundingEntry(cashShortfall.cashVenue)}
                      disabled={isSaving}
                    >
                      {t('Record deposit')}
                    </button>
                  </div>
                </div>
              ) : null}
              <button
                className={tradePresentation ? 'btn btn-primary trade-entry-submit' : 'btn btn-primary'}
                onClick={handleAddTransaction}
                disabled={isSaving}
                style={{ width: '100%', padding: '13px 0', fontSize: 15, fontWeight: 700, borderRadius: 12, marginBottom: 10 }}
              >
                {isSaving
                  ? t('Saving...')
                  : entryType === 'dividend'
                    ? t('Continue')
                    : isEditMode ? t('Save Changes')
                    : isTradeLike ? t(entryType === 'buy' ? 'Record buy' : 'Record sell') : t('Save Entry')}
              </button>

              <div style={{ display: 'flex', justifyContent: 'center', gap: 24, alignItems: 'center' }}>
                <button
                  type="button"
                  onClick={closeDialog}
                  disabled={isSaving}
                  className={tradePresentation ? 'btn btn-secondary btn-sm trade-entry-cancel' : undefined}
                  style={tradePresentation ? undefined : { background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 13 }}
                >
                  {t('Cancel')}
                </button>

                {isEditMode && editTransaction && (
                  <button
                    type="button"
                    onClick={async () => {
                      if (confirm(t('Are you sure you want to delete this entry?'))) {
                        setIsSaving(true);
                        try {
                          await removeManualTransaction(editTransaction.id);
                          onClose();
                        } catch {
                          setFormError(t('Failed to save'));
                        } finally {
                          setIsSaving(false);
                        }
                      }
                    }}
                    disabled={isSaving}
                    style={{ background: 'none', border: 'none', color: 'var(--red)', cursor: 'pointer', fontSize: 13, display: 'flex', alignItems: 'center', gap: 4 }}
                  >
                    <Trash2 size={13} />
                    {t('Delete Entry')}
                  </button>
                )}
              </div>
            </div>
    </Dialog>
  );
}
