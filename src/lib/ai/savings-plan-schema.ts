import { SUPPORTED_SYMBOLS } from '@/lib/config/supported-coins';
import { isBoundedString, isPlainObject } from '@/lib/api/json-body';

export type SavingsPlanAction =
  | 'generate_allocation'
  | 'allocate_selected'
  | 'rebalance'
  | 'feedback';

export interface SavingsPlanAllocation {
  coin: string;
  percent: number;
  reasoning?: string;
}

export interface SavingsPlanRequest {
  action: SavingsPlanAction;
  budget: number;
  initialCapital: number;
  riskProfile: 'conservative' | 'moderate' | 'aggressive';
  targetCoinCount?: number;
  selectedCoins?: string[];
  currentAllocations?: SavingsPlanAllocation[];
}

export interface SavingsPlanResult {
  allocations?: SavingsPlanAllocation[];
  suggestedAllocations?: SavingsPlanAllocation[];
  reasoning?: string;
  actionRequired?: boolean;
  score?: number;
  pros?: string[];
  cons?: string[];
  summary?: string;
}

const ACTIONS = new Set<SavingsPlanAction>([
  'generate_allocation',
  'allocate_selected',
  'rebalance',
  'feedback',
]);
const RISK_PROFILES = new Set([
  'conservative',
  'moderate',
  'aggressive',
]);
const SUPPORTED_SYMBOL_SET = new Set(SUPPORTED_SYMBOLS);

function isFiniteNumberInRange(
  value: unknown,
  minimum: number,
  maximum: number,
): value is number {
  return (
    typeof value === 'number'
    && Number.isFinite(value)
    && value >= minimum
    && value <= maximum
  );
}

function normalizeCoin(value: unknown): string | null {
  if (!isBoundedString(value, 16)) return null;
  const symbol = value.trim().toUpperCase();
  return SUPPORTED_SYMBOL_SET.has(symbol) ? symbol : null;
}

function parseCoinList(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > 15) {
    return null;
  }

  const coins = value.map(normalizeCoin);
  if (coins.some((coin) => coin === null)) return null;

  const normalized = coins as string[];
  return new Set(normalized).size === normalized.length ? normalized : null;
}

function parseAllocations(
  value: unknown,
  allowedCoins?: ReadonlySet<string>,
): SavingsPlanAllocation[] | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > 15) {
    return null;
  }

  const allocations: SavingsPlanAllocation[] = [];
  for (const item of value) {
    if (!isPlainObject(item)) return null;

    const coin = normalizeCoin(item.coin);
    if (
      coin === null
      || (allowedCoins && !allowedCoins.has(coin))
      || !isFiniteNumberInRange(item.percent, 0, 100)
      || (
        item.reasoning !== undefined
        && !isBoundedString(item.reasoning, 1000, { allowEmpty: true })
      )
    ) {
      return null;
    }

    allocations.push({
      coin,
      percent: item.percent,
      reasoning: typeof item.reasoning === 'string'
        ? item.reasoning
        : undefined,
    });
  }

  if (new Set(allocations.map((item) => item.coin)).size !== allocations.length) {
    return null;
  }

  const total = allocations.reduce((sum, item) => sum + item.percent, 0);
  return Math.abs(total - 100) <= 0.1 ? allocations : null;
}

export function parseSavingsPlanRequest(
  value: unknown,
): SavingsPlanRequest | null {
  if (!isPlainObject(value) || !ACTIONS.has(value.action as SavingsPlanAction)) {
    return null;
  }
  if (
    !isFiniteNumberInRange(value.budget, 0.01, 10_000_000)
    || (
      value.initialCapital !== undefined
      && !isFiniteNumberInRange(value.initialCapital, 0, 1_000_000_000)
    )
    || (
      value.riskProfile !== undefined
      && (
        typeof value.riskProfile !== 'string'
        || !RISK_PROFILES.has(value.riskProfile)
      )
    )
  ) {
    return null;
  }

  const action = value.action as SavingsPlanAction;
  const initialCapital = typeof value.initialCapital === 'number'
    ? value.initialCapital
    : 0;
  const riskProfile = (
    typeof value.riskProfile === 'string'
      ? value.riskProfile
      : 'moderate'
  ) as SavingsPlanRequest['riskProfile'];

  if (action === 'generate_allocation') {
    if (
      value.targetCoinCount !== undefined
      && (
        !Number.isInteger(value.targetCoinCount)
        || Number(value.targetCoinCount) < 1
        || Number(value.targetCoinCount) > 15
      )
    ) {
      return null;
    }
    return {
      action,
      budget: value.budget,
      initialCapital,
      riskProfile,
      targetCoinCount: typeof value.targetCoinCount === 'number'
        ? value.targetCoinCount
        : undefined,
    };
  }

  if (action === 'allocate_selected') {
    const selectedCoins = parseCoinList(value.selectedCoins);
    if (!selectedCoins) return null;
    return {
      action,
      budget: value.budget,
      initialCapital,
      riskProfile,
      selectedCoins,
    };
  }

  const currentAllocations = parseAllocations(value.currentAllocations);
  if (!currentAllocations) return null;

  return {
    action,
    budget: value.budget,
    initialCapital,
    riskProfile,
    currentAllocations,
  };
}

function parseTextList(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length > 20) return null;
  if (!value.every((item) => isBoundedString(item, 500))) return null;
  return value;
}

export function parseSavingsPlanResult(
  value: unknown,
  request: SavingsPlanRequest,
): SavingsPlanResult | null {
  if (!isPlainObject(value)) return null;

  const reasoning = value.reasoning === undefined
    ? undefined
    : isBoundedString(value.reasoning, 4000, { allowEmpty: true })
      ? value.reasoning
      : null;
  if (reasoning === null) return null;

  if (
    request.action === 'generate_allocation'
    || request.action === 'allocate_selected'
  ) {
    const allowedCoins = request.selectedCoins
      ? new Set(request.selectedCoins)
      : undefined;
    const allocations = parseAllocations(value.allocations, allowedCoins);
    if (
      !allocations
      || (
        request.targetCoinCount !== undefined
        && allocations.length !== request.targetCoinCount
      )
    ) {
      return null;
    }
    return { allocations, reasoning };
  }

  if (request.action === 'rebalance') {
    if (typeof value.actionRequired !== 'boolean') return null;
    const allowedCoins = new Set(
      request.currentAllocations?.map((item) => item.coin) ?? [],
    );
    const suggestedAllocations = value.suggestedAllocations === undefined
      ? undefined
      : parseAllocations(value.suggestedAllocations, allowedCoins);
    if (
      value.actionRequired
      && !suggestedAllocations
    ) {
      return null;
    }
    if (suggestedAllocations === null) return null;
    return {
      suggestedAllocations,
      reasoning,
      actionRequired: value.actionRequired,
    };
  }

  const pros = parseTextList(value.pros);
  const cons = parseTextList(value.cons);
  if (
    !isFiniteNumberInRange(value.score, 0, 100)
    || !pros
    || !cons
    || !isBoundedString(value.summary, 4000, { allowEmpty: true })
  ) {
    return null;
  }
  return {
    score: value.score,
    pros,
    cons,
    summary: value.summary,
  };
}
