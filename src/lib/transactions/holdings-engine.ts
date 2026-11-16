import { getAssetConfig, type AssetClass } from '@/lib/config/supported-assets';
import {
  normalizeToEur,
  normalizeTransactionToEur,
  QUOTE_TO_EUR_RATE,
} from '@/lib/fx/quote-rates';
import type { InvestmentTransaction } from '@/lib/tax/investment-tax';

export interface DerivedHolding {
  symbol: string;
  name: string;
  assetClass: AssetClass | 'cash';
  amount: number;
  /** Fine-metal-equivalent grams after weighting every ledger row by purity. */
  fineMetalAmount?: number;
  /** Effective weighted fineness in parts per thousand. */
  metalFineness?: number;
  /** False when any required metal ledger row has no trustworthy fineness. */
  metalFinenessAvailable?: boolean;
  avgCost: number;
  costBasisAvailable: boolean;
  venue: string;
}

interface InternalPosition {
  symbol: string;
  name: string;
  assetClass: AssetClass | 'cash';
  amount: number;
  totalCostEur: number;
  costBasisKnown: boolean;
  venue: string;
  fineMetalAmount?: number;
  metalFinenessKnown?: boolean;
}

const POSITION_EPSILON = 0.0000001;

function mapToInternalAssetClass(rawClass: string): AssetClass {
  const normalized = (rawClass || '').trim().toLowerCase();
  if (normalized === 'krypto' || normalized === 'crypto') return 'crypto';
  if (normalized === 'aktie' || normalized === 'stock' || normalized === 'stocks') return 'stock';
  if (normalized === 'etf' || normalized === 'etfs') return 'etf';
  if (normalized === 'metall' || normalized === 'metal' || normalized === 'metals' || normalized === 'edelmetall') return 'metal';
  return 'crypto'; // Fallback
}

function positionKey(venue: string, symbol: string) {
  return `${venue.trim()}::${symbol.trim().toUpperCase()}`;
}

function getCashVenue(transaction: InvestmentTransaction, fallbackVenue: string) {
  return transaction.settlementVenue?.trim() || fallbackVenue;
}

function hasValidMetalFineness(
  transaction: InvestmentTransaction,
): transaction is InvestmentTransaction & { metalFineness: number } {
  return typeof transaction.metalFineness === 'number'
    && Number.isFinite(transaction.metalFineness)
    && transaction.metalFineness >= 1
    && transaction.metalFineness <= 1_000;
}

function markMetalFinenessUnknown(position: InternalPosition) {
  if (position.assetClass !== 'metal') return;
  position.metalFinenessKnown = false;
  delete position.fineMetalAmount;
}

function addMetalAmount(
  position: InternalPosition,
  transaction: InvestmentTransaction,
) {
  if (position.assetClass !== 'metal') return;

  if (Math.abs(position.amount) <= POSITION_EPSILON) {
    position.metalFinenessKnown = true;
    position.fineMetalAmount = 0;
  }
  if (position.metalFinenessKnown === false) return;
  if (!hasValidMetalFineness(transaction)) {
    markMetalFinenessUnknown(position);
    return;
  }

  position.metalFinenessKnown = true;
  position.fineMetalAmount =
    (position.fineMetalAmount ?? 0)
    + transaction.amount * (transaction.metalFineness / 1_000);
}

function reduceMetalAmount(
  position: InternalPosition,
  transaction: InvestmentTransaction,
) {
  if (position.assetClass !== 'metal') return;
  if (position.metalFinenessKnown === false) return;
  if (!hasValidMetalFineness(transaction)) {
    markMetalFinenessUnknown(position);
    return;
  }

  const nextGrossAmount = position.amount - transaction.amount;
  const nextFineMetalAmount =
    (position.fineMetalAmount ?? 0)
    - transaction.amount * (transaction.metalFineness / 1_000);
  if (
    nextFineMetalAmount < -POSITION_EPSILON
    || nextFineMetalAmount > nextGrossAmount + POSITION_EPSILON
  ) {
    markMetalFinenessUnknown(position);
    return;
  }

  position.fineMetalAmount = Math.max(0, nextFineMetalAmount);
}

function resetClosedMetalPosition(position: InternalPosition) {
  if (
    position.assetClass === 'metal'
    && Math.abs(position.amount) <= POSITION_EPSILON
  ) {
    position.metalFinenessKnown = true;
    position.fineMetalAmount = 0;
  }
}

export function deriveHoldingsFromTransactions(
  transactions: InvestmentTransaction[],
): DerivedHolding[] {
  const ordered = [...transactions].sort(
    (left, right) => new Date(left.date).getTime() - new Date(right.date).getTime(),
  );

  const positions = new Map<string, InternalPosition>();

  for (const transaction of ordered) {
    const venue = transaction.venue.trim() || 'manual-entry';

    if (transaction.assetClass?.toLowerCase() === 'cash') {
      const symbol = transaction.asset.trim().toUpperCase();
      const key = positionKey(venue, symbol);
      const current = positions.get(key) ?? {
        symbol,
        name: `Cash (${symbol})`,
        assetClass: 'cash',
        amount: 0,
        totalCostEur: 0,
        costBasisKnown: typeof QUOTE_TO_EUR_RATE[symbol] === 'number',
        venue,
      };

      if (
        transaction.type === 'deposit' ||
        (transaction.type === 'transfer' && transaction.taxType === 'transfer_in') ||
        transaction.type === 'adjustment'
      ) {
        current.amount += transaction.amount;
      } else if (
        transaction.type === 'withdrawal' ||
        transaction.type === 'fee' ||
        (transaction.type === 'transfer' && transaction.taxType === 'transfer_out')
      ) {
        current.amount -= transaction.amount;
      }

      const cashValueEur = normalizeToEur(current.amount, symbol);
      current.totalCostEur = cashValueEur ?? 0;
      current.costBasisKnown = cashValueEur !== null;
      positions.set(key, current);
      continue;
    }

    const assetConfig = getAssetConfig(transaction.asset);
    const symbol = transaction.asset.trim().toUpperCase();
    const key = positionKey(venue, symbol);
    const current =
      positions.get(key) ??
      {
        symbol,
        name: transaction.assetName || assetConfig?.name || symbol,
        assetClass: mapToInternalAssetClass(transaction.assetClass),
        amount: 0,
        totalCostEur: 0,
        costBasisKnown: true,
        venue,
        fineMetalAmount:
          transaction.assetClass === 'metal' ? 0 : undefined,
        metalFinenessKnown:
          transaction.assetClass === 'metal' ? true : undefined,
      };

    if (transaction.type === 'dividend') {
      const cashSymbol = transaction.quote.trim().toUpperCase();
      const cashVenue = getCashVenue(transaction, venue);
      const cashKey = positionKey(cashVenue, cashSymbol);
      const cashPos = positions.get(cashKey) ?? {
        symbol: cashSymbol,
        name: `Cash (${cashSymbol})`,
        assetClass: 'cash' as const,
        amount: 0,
        totalCostEur: 0,
        costBasisKnown: typeof QUOTE_TO_EUR_RATE[cashSymbol] === 'number',
        venue: cashVenue,
      };
      cashPos.amount += Math.max(0, Number(transaction.total));
      const dividendCashValueEur = normalizeToEur(cashPos.amount, cashSymbol);
      cashPos.totalCostEur = dividendCashValueEur ?? 0;
      cashPos.costBasisKnown = dividendCashValueEur !== null;
      positions.set(cashKey, cashPos);
      continue;
    }

    if (transaction.type === 'buy') {
      const transactionCostEur = normalizeTransactionToEur(
        Number(transaction.total) + Number(transaction.fee || 0),
        transaction,
      );
      if (transactionCostEur === null) {
        current.costBasisKnown = false;
        current.totalCostEur = 0;
      } else if (current.costBasisKnown) {
        current.totalCostEur += transactionCostEur;
      }

      addMetalAmount(current, transaction);
      current.amount += transaction.amount;
      current.venue = venue;
      positions.set(key, current);

      // Auto-deduct from cash
      const cashSymbol = transaction.quote.trim().toUpperCase();
      const cashVenue = getCashVenue(transaction, venue);
      const cashKey = positionKey(cashVenue, cashSymbol);
      const cashPos = positions.get(cashKey) ?? {
        symbol: cashSymbol,
        name: `Cash (${cashSymbol})`,
        assetClass: 'cash',
        amount: 0,
        totalCostEur: 0,
        costBasisKnown: typeof QUOTE_TO_EUR_RATE[cashSymbol] === 'number',
        venue: cashVenue,
      };
      cashPos.amount -= (
        transaction.total
        + transaction.fee
        + (transaction.taxAmount ?? 0)
      );
      const cashValueEur = normalizeToEur(cashPos.amount, cashSymbol);
      cashPos.totalCostEur = cashValueEur ?? 0;
      cashPos.costBasisKnown = cashValueEur !== null;
      positions.set(cashKey, cashPos);
      continue;
    }

    if (transaction.type === 'sell' || (transaction.type === 'transfer' && transaction.taxType === 'transfer_out')) {
      if (
        current.amount <= 0
        || transaction.amount > current.amount + 0.0000001
      ) {
        // Invalid legacy ledgers must never create partial proceeds or cash.
        continue;
      }

      const soldAmount = transaction.amount;
      const avgCost = current.amount > 0 && current.costBasisKnown
        ? current.totalCostEur / current.amount
        : 0;
      reduceMetalAmount(current, transaction);
      current.amount -= soldAmount;
      resetClosedMetalPosition(current);
      if (current.costBasisKnown) {
        current.totalCostEur = Math.max(
          0,
          current.totalCostEur - avgCost * soldAmount,
        );
      }
      current.venue = venue;
      positions.set(key, current);

      // Auto-credit to cash
      if (transaction.type === 'sell') {
        const cashSymbol = transaction.quote.trim().toUpperCase();
        const cashVenue = getCashVenue(transaction, venue);
        const cashKey = positionKey(cashVenue, cashSymbol);
        const cashPos = positions.get(cashKey) ?? {
          symbol: cashSymbol,
          name: `Cash (${cashSymbol})`,
          assetClass: 'cash',
          amount: 0,
          totalCostEur: 0,
          costBasisKnown: typeof QUOTE_TO_EUR_RATE[cashSymbol] === 'number',
          venue: cashVenue,
        };
        const requestedAmount = Number(transaction.amount);
        const executedRatio = requestedAmount > 0
          ? Math.min(1, soldAmount / requestedAmount)
          : 0;
        const requestedNetProceeds = Math.max(
          0,
          Number(transaction.total)
          - Number(transaction.fee || 0)
          - Number(transaction.taxAmount || 0),
        );
        cashPos.amount += requestedNetProceeds * executedRatio;
        cashPos.totalCostEur = normalizeToEur(cashPos.amount, cashSymbol) ?? 0;
        positions.set(cashKey, cashPos);
      }
      continue;
    }

    if (
      (transaction.type === 'adjustment' && transaction.amount > 0)
      || transaction.type === 'deposit'
      || (
        transaction.type === 'transfer'
        && transaction.taxType === 'transfer_in'
      )
    ) {
      const transactionCostEur =
        transaction.type === 'transfer'
        && transaction.transferredCostBasisStatus === 'known'
        && typeof transaction.transferredCostBasisEur === 'number'
          ? transaction.transferredCostBasisEur
          : normalizeTransactionToEur(
              Number(transaction.total) + Number(transaction.fee || 0),
              transaction,
            );
      if (transactionCostEur === null) {
        current.costBasisKnown = false;
        current.totalCostEur = 0;
      } else if (current.costBasisKnown) {
        current.totalCostEur += transactionCostEur;
      }

      addMetalAmount(current, transaction);
      current.amount += transaction.amount;
      current.venue = venue;
      positions.set(key, current);
      continue;
    }

    if (transaction.type === 'withdrawal') {
      if (
        current.amount <= 0
        || transaction.amount > current.amount + 0.0000001
      ) {
        continue;
      }
      const averageCost =
        current.costBasisKnown && current.amount > 0
          ? current.totalCostEur / current.amount
          : 0;
      reduceMetalAmount(current, transaction);
      current.amount -= transaction.amount;
      resetClosedMetalPosition(current);
      if (current.costBasisKnown) {
        current.totalCostEur = Math.max(
          0,
          current.totalCostEur - averageCost * transaction.amount,
        );
      }
      positions.set(key, current);
    }
  }

  return [...positions.values()]
    .filter((position) => Math.abs(position.amount) > POSITION_EPSILON)
    .map((position) => {
      const metalFinenessAvailable =
        position.assetClass === 'metal'
        && position.metalFinenessKnown === true
        && typeof position.fineMetalAmount === 'number'
        && Number.isFinite(position.fineMetalAmount);
      const metalData =
        position.assetClass === 'metal'
          ? {
              fineMetalAmount: metalFinenessAvailable
                ? Number(position.fineMetalAmount!.toFixed(8))
                : undefined,
              metalFineness: metalFinenessAvailable
                ? Number(
                    (
                      (position.fineMetalAmount! / position.amount)
                      * 1_000
                    ).toFixed(4),
                  )
                : undefined,
              metalFinenessAvailable,
            }
          : {};

      return {
        symbol: position.symbol,
        name: position.name,
        assetClass: position.assetClass,
        amount: Number(position.amount.toFixed(8)),
        ...metalData,
        avgCost:
          position.assetClass === 'cash'
            ? Number((QUOTE_TO_EUR_RATE[position.symbol.trim().toUpperCase()] ?? 0).toFixed(2))
            : position.amount > 0 && position.costBasisKnown
              ? Number((position.totalCostEur / position.amount).toFixed(2))
              : 0,
        costBasisAvailable:
          position.assetClass === 'cash'
            ? typeof QUOTE_TO_EUR_RATE[position.symbol.trim().toUpperCase()] === 'number'
            : position.amount > 0 && position.costBasisKnown,
        venue: position.venue,
      };
    })
    .sort((left, right) => left.venue.localeCompare(right.venue) || left.symbol.localeCompare(right.symbol));
}
