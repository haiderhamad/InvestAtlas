import type { DerivedHolding } from '@/lib/transactions/holdings-engine';
import { TROY_OUNCE_GRAMS } from '@/lib/metals/metal-purity';
import type {
  DataField,
  Money,
  ResultStatus,
} from '@/lib/financial-data/contracts';
import type { QuoteCurrency } from '@/lib/config/supported-assets';

export interface CurrentValuationPrice {
  price: number;
  change24h: number | null;
  verified?: boolean;
  currency?: QuoteCurrency;
  dataStatus?: ResultStatus;
  fields?: {
    price?: DataField<Money>;
  };
  changePeriod?: '24h' | 'session' | 'unavailable';
}

export type CurrentValuationPrices = Record<string, CurrentValuationPrice>;

export interface CurrentFxRateToEur {
  rate: number;
  freshness: 'fresh' | 'stale';
  asOf: string;
  providerId: string;
}

export type CurrentFxRatesToEur = Partial<Record<'USD', CurrentFxRateToEur>>;

export type CurrentHoldingValuation = DerivedHolding & {
  currentPrice: number;
  value: number;
  pnl: number;
  pnlPct: number;
  allocation: number;
  change24h: number | null;
  changePeriod: '24h' | 'session' | 'unavailable';
  valuationAvailable: boolean;
  isVerified: boolean;
};

function hasPositivePrice(
  price: CurrentValuationPrice | undefined,
): price is CurrentValuationPrice {
  if (
    !price
    || !Number.isFinite(price.price)
    || price.price <= 0
    || (price.currency !== undefined && price.currency !== 'eur')
    || price.dataStatus === 'unavailable'
  ) {
    return false;
  }

  const sourcedPrice = price.fields?.price;
  if (!sourcedPrice) return true; // Transitional support for local legacy rows.
  return (
    sourcedPrice.status === 'available'
    && (
      sourcedPrice.quality === 'demo'
      || sourcedPrice.freshness === 'fresh'
    )
    && sourcedPrice.value.currency === 'EUR'
    && Number.isFinite(sourcedPrice.value.amount)
    && Math.abs(sourcedPrice.value.amount - price.price) <= 1e-8
  );
}

/**
 * Builds a current valuation without substituting acquisition cost for a
 * missing market quote. Numeric zeroes are internal placeholders only; callers
 * must use `valuationAvailable` before presenting values or aggregates.
 */
export function buildCurrentHoldingValuations(
  baseHoldings: DerivedHolding[],
  prices?: CurrentValuationPrices,
  fxRatesToEur: CurrentFxRatesToEur = {},
): CurrentHoldingValuation[] {
  const valuations = baseHoldings.map((holding) => {
    const liveQuote = prices?.[holding.symbol];
    const isCash = holding.assetClass === 'cash';
    const cashCurrency = holding.symbol.trim().toUpperCase();
    const sourcedCashRate = cashCurrency === 'USD'
      ? fxRatesToEur.USD
      : undefined;
    const cashRate = cashCurrency === 'EUR'
      ? 1
      : sourcedCashRate
        && sourcedCashRate.providerId === 'ecb_reference_rates'
        && sourcedCashRate.freshness === 'fresh'
        && Number.isFinite(sourcedCashRate.rate)
        && sourcedCashRate.rate > 0
          ? sourcedCashRate.rate
          : null;
    const hasMetalFineness =
      holding.assetClass !== 'metal'
      || (
        holding.metalFinenessAvailable === true
        && typeof holding.fineMetalAmount === 'number'
        && Number.isFinite(holding.fineMetalAmount)
        && holding.fineMetalAmount >= 0
      );
    const candidateValuationAvailable = isCash
      ? cashRate !== null
      : hasPositivePrice(liveQuote) && hasMetalFineness;
    const quotedPrice = isCash
      ? cashRate ?? 0
      : hasPositivePrice(liveQuote)
        ? liveQuote.price
        : 0;
    const currentPrice =
      holding.assetClass === 'metal'
        ? quotedPrice / TROY_OUNCE_GRAMS
        : quotedPrice;
    const valuedAmount =
      holding.assetClass === 'metal'
        ? holding.fineMetalAmount ?? 0
        : holding.amount;
    const calculatedValue = candidateValuationAvailable
      ? valuedAmount * currentPrice
      : 0;
    const valuationAvailable = candidateValuationAvailable
      && Number.isFinite(currentPrice)
      && Number.isFinite(valuedAmount)
      && Number.isFinite(calculatedValue);
    const value = valuationAvailable ? calculatedValue : 0;
    const investedValue = holding.amount * holding.avgCost;
    const calculatedPnl = value - investedValue;
    const pnlAvailable = valuationAvailable
      && holding.costBasisAvailable
      && Number.isFinite(investedValue)
      && Number.isFinite(calculatedPnl);
    const pnl = pnlAvailable ? calculatedPnl : 0;

    return {
      ...holding,
      currentPrice,
      value,
      pnl,
      pnlPct:
        pnlAvailable && investedValue > 0
          ? (pnl / investedValue) * 100
          : 0,
      change24h:
        isCash && valuationAvailable && cashCurrency === 'EUR'
          ? 0
          : isCash
            ? null
          : hasPositivePrice(liveQuote)
            ? liveQuote.change24h
            : null,
      changePeriod:
        isCash && valuationAvailable && cashCurrency === 'EUR'
          ? '24h'
          : isCash
            ? 'unavailable'
            : hasPositivePrice(liveQuote)
              ? liveQuote.changePeriod
                ?? (holding.assetClass === 'crypto' ? '24h' : 'session')
              : 'unavailable',
      allocation: 0,
      valuationAvailable,
      isVerified: hasPositivePrice(liveQuote)
        ? liveQuote.verified ?? false
        : false,
    };
  });

  const valuationComplete = isCurrentValuationComplete(valuations);
  const totalValue = valuationComplete
    ? valuations.reduce((sum, holding) => sum + holding.value, 0)
    : 0;

  return valuations.map((holding) => ({
    ...holding,
    allocation:
      valuationComplete && totalValue > 0
        ? (holding.value / totalValue) * 100
        : 0,
  }));
}

/**
 * Explicit, partial sum of positions with defensible EUR market valuations.
 * The result is never a substitute for an unavailable complete portfolio total.
 * Do not derive whole-portfolio allocations or whole-portfolio P&L from this subset.
 */
export function summarizeCurrentValuationCoverage(
  holdings: ReadonlyArray<Pick<CurrentHoldingValuation,
    'amount' | 'avgCost' | 'value' | 'pnl' | 'costBasisAvailable' | 'valuationAvailable'
  >>,
): {
  valuedValue: number;
  valuedUnrealizedPnl: number | null;
  valuedCount: number;
  missingCount: number;
  totalCount: number;
} {
  const valued = holdings.filter((holding) => holding.valuationAvailable
    && Number.isFinite(holding.value) && holding.value >= 0);
  const sum = valued.reduce((total, holding) => total + holding.value, 0);
  const sumValid = Number.isFinite(sum);
  // Missing price OR missing cost basis must never become an invented zero P&L.
  // The partial P&L covers only the SAME positions as the partial market value.
  const pricedBasisComplete = valued.length > 0
    && sumValid
    && valued.every((holding) => {
      const invested = holding.amount * holding.avgCost;
      const expectedPnl = holding.value - invested;
      return holding.costBasisAvailable
        && Number.isFinite(invested)
        && Number.isFinite(expectedPnl)
        && Number.isFinite(holding.pnl)
        && Math.abs(holding.pnl - expectedPnl)
          <= Math.max(1, Math.abs(expectedPnl)) * 1e-10;
    });
  const pnl = pricedBasisComplete
    ? valued.reduce((total, holding) => total + holding.pnl, 0)
    : null;
  return {
    valuedValue: sumValid ? sum : 0,
    valuedUnrealizedPnl: pnl !== null && Number.isFinite(pnl) ? pnl : null,
    valuedCount: sumValid ? valued.length : 0,
    missingCount: holdings.length - (sumValid ? valued.length : 0),
    totalCount: holdings.length,
  };
}

export function isCurrentValuationComplete(
  holdings: Array<Pick<CurrentHoldingValuation, 'valuationAvailable'>>,
): boolean {
  return holdings.every((holding) => holding.valuationAvailable);
}

/** Symbols lacking a defensible EUR value, shown only inside the owner's Portfolio UI. */
export function getUnavailableValuationSymbols(
  holdings: ReadonlyArray<Pick<CurrentHoldingValuation, 'symbol' | 'valuationAvailable'>>,
): string[] {
  return [...new Set(holdings
    .filter((holding) => !holding.valuationAvailable)
    .map((holding) => holding.symbol))].sort();
}
