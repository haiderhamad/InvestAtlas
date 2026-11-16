import type { QuoteCurrency } from '@/lib/config/supported-assets';
import type { CurrentPriceSnapshot } from '@/lib/financial-data/quotes/current-quote-service';
import { TROY_OUNCE_GRAMS } from '@/lib/metals/metal-purity';

export interface ChartCurrentQuote {
  price: number;
  source: string;
  observedAt: string;
  demo: boolean;
}

/** Current quotes retain their identity and provenance independently of chart coverage. */
export function chartCurrentQuote(value: unknown, symbol: string, currency: QuoteCurrency, metal: boolean): ChartCurrentQuote | null {
  if (!value || typeof value !== 'object') return null;
  const quote = value as Partial<CurrentPriceSnapshot>;
  const field = quote.fields?.price;
  const code = currency.toUpperCase();
  if (quote.dataStatus === 'unavailable' || quote.currency !== currency
    || quote.fields?.assetId !== symbol || quote.fields.outputCurrency !== code
    || typeof quote.price !== 'number' || !Number.isFinite(quote.price) || quote.price <= 0
    || !field || field.status !== 'available'
    || (field.quality !== 'demo' && field.freshness !== 'fresh')
    || !field.value || field.value.currency !== code || field.value.amount !== quote.price
    || !field.provenance?.providerId || !field.provenance.providerName) return null;
  const observedAt = field.observedAt ?? field.asOf;
  if (typeof observedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}(?:T.*Z)?$/.test(observedAt)
    || !Number.isFinite(Date.parse(observedAt))
    || new Date(observedAt).toISOString().slice(0, 10) !== observedAt.slice(0, 10)) return null;
  return {
    price: metal ? quote.price / TROY_OUNCE_GRAMS : quote.price,
    observedAt,
    source: typeof quote.source === 'string' && quote.source.trim() ? quote.source : field.provenance.providerName,
    demo: field.quality === 'demo',
  };
}
