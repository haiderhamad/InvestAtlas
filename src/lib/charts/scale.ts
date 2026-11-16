export type ChartDomain = readonly [number, number];
export type ChartAxisOptions = { currencySymbol?: string; suffix?: string; compact?: boolean };

export function getChartDomain(values: readonly unknown[], options: { includeZero?: boolean; paddingRatio?: number } = {}): [number, number] {
  let min = Infinity;
  let max = -Infinity;
  for (const value of values) {
    if (typeof value !== 'number' || !Number.isFinite(value)) continue;
    min = Math.min(min, value);
    max = Math.max(max, value);
  }
  if (min === Infinity) return [0, 1];
  if (options.includeZero) {
    min = Math.min(0, min);
    max = Math.max(0, max);
  }
  if (min === 0 && max === 0) return options.includeZero ? [0, 1] : [-1, 1];

  const requestedPadding = options.paddingRatio ?? 0.06;
  const paddingRatio = Number.isFinite(requestedPadding) ? Math.max(0, requestedPadding) : 0.06;
  const span = max - min;
  const padding = (span > 0 ? span : Math.abs(min)) * paddingRatio;
  // A constant line still needs a nonzero domain when padding is explicitly disabled.
  const safePadding = min === max && padding === 0 ? Math.abs(min) * 0.01 : padding;
  const lower = options.includeZero && min === 0 ? 0 : min - safePadding;
  const upper = options.includeZero && max === 0 ? 0 : max + safePadding;
  return [Number.isFinite(lower) ? lower : min, Number.isFinite(upper) ? upper : max];
}

export function formatChartAxis(value: number, domain: ChartDomain, locale: string, options: ChartAxisOptions = {}): string {
  if (!Number.isFinite(value)) return '—';
  const magnitude = Math.max(Math.abs(domain[0]), Math.abs(domain[1]));
  const span = domain[1] - domain[0];
  const step = Number.isFinite(span) && span > 0 ? span / 8 : Math.abs(value) / 8 || 1;
  // Compact notation is useful only when its unit can preserve the visible tick spacing.
  const compactFactor = magnitude >= 1000 ? 10 ** (Math.min(4, Math.floor(Math.log10(magnitude) / 3)) * 3) : 1;
  const compactDigits = Math.max(0, 1 - Math.floor(Math.log10(step / compactFactor)));
  const compact = options.compact !== false && compactFactor > 1 && compactDigits <= 2;
  const fractionDigits = Math.max(0, 1 - Math.floor(Math.log10(step)));
  const scientific = !compact && fractionDigits > 12;
  const text = new Intl.NumberFormat(locale, scientific ? {
    notation: 'scientific',
    maximumSignificantDigits: Math.min(16, Math.max(3, Math.floor(Math.log10(magnitude || 1)) - Math.floor(Math.log10(step)) + 2)),
  } : {
    notation: compact ? 'compact' : 'standard',
    maximumFractionDigits: compact ? compactDigits : Math.min(20, fractionDigits),
  }).format(Object.is(value, -0) ? 0 : value);
  return `${options.currencySymbol ?? ''}${text}${options.suffix ?? ''}`;
}

export function formatChartQuote(value: number, locale: string, currency: string): string {
  if (!Number.isFinite(value)) return '—';
  const order = value === 0 ? 0 : Math.floor(Math.log10(Math.abs(value)));
  const scientific = value !== 0 && order < -12;
  return new Intl.NumberFormat(locale, {
    style: 'currency', currency: currency.toUpperCase(),
    notation: scientific ? 'scientific' : 'standard',
    minimumFractionDigits: 2,
    maximumFractionDigits: scientific ? 4 : Math.min(20, Math.max(2, 4 - order)),
  }).format(value);
}

export function getChartAxisWidth(domain: ChartDomain, locale: string, options: ChartAxisOptions = {}): number {
  const lengths = [domain[0], domain[1], domain[0] / 2 + domain[1] / 2].map(value =>
    formatChartAxis(value, domain, locale, options).replace(/[\u061c\u200e\u200f]/g, '').length,
  );
  return Math.min(120, Math.max(52, Math.ceil(Math.max(...lengths) * 6.5 + 16)));
}
