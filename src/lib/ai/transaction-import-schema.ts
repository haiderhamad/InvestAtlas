export interface RawImportedTransaction {
  date?: unknown;
  venue?: unknown;
  type?: unknown;
  asset?: unknown;
  assetName?: unknown;
  assetClass?: unknown;
  quote?: unknown;
  amount?: unknown;
  price?: unknown;
  total?: unknown;
  fee?: unknown;
  notes?: unknown;
}

const VALID_TYPES = new Set([
  'buy',
  'sell',
  'dividend',
  'fee',
  'transfer',
  'deposit',
  'withdrawal',
  'adjustment',
]);
const VALID_CLASSES = new Set(['crypto', 'stock', 'etf', 'metal', 'cash']);

function toNumber(value: unknown, fallback = 0): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const cleaned = value.replace(/[^0-9.\-]/g, '');
    const parsed = Number.parseFloat(cleaned);
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  return fallback;
}

export function sanitizeImportedTransaction(
  raw: RawImportedTransaction,
  index: number,
) {
  if (
    typeof raw.date !== 'string'
    || !Number.isFinite(Date.parse(raw.date))
    || typeof raw.type !== 'string'
    || !VALID_TYPES.has(raw.type)
    || typeof raw.assetClass !== 'string'
    || !VALID_CLASSES.has(raw.assetClass)
    || typeof raw.asset !== 'string'
    || !/^[A-Z0-9.^=_-]{1,32}$/i.test(raw.asset.trim())
    || typeof raw.quote !== 'string'
    || !/^[A-Z0-9]{2,10}$/i.test(raw.quote.trim())
  ) {
    return null;
  }

  const amount = toNumber(raw.amount);
  const price = toNumber(raw.price);
  const totalRaw = toNumber(raw.total);
  const total = totalRaw > 0 ? totalRaw : Math.abs(amount * price);

  if (
    amount < 0
    || price < 0
    || total < 0
    || (amount === 0 && total === 0)
  ) {
    return null;
  }

  return {
    id: `ai-${Date.now()}-${index}`,
    date: new Date(raw.date).toISOString(),
    venue:
      typeof raw.venue === 'string' && raw.venue.trim()
        ? raw.venue.trim().slice(0, 100)
        : 'manual-entry',
    type: raw.type,
    asset: raw.asset.trim().toUpperCase(),
    assetName:
      typeof raw.assetName === 'string' ? raw.assetName.slice(0, 120) : undefined,
    assetClass: raw.assetClass,
    quote: raw.quote.trim().toUpperCase(),
    amount: Math.abs(amount),
    price,
    total,
    fee: Math.max(0, toNumber(raw.fee)),
    notes: typeof raw.notes === 'string' ? raw.notes.slice(0, 500) : undefined,
  };
}
