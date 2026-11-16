export type TaxProfileMode = 'preset' | 'manual' | 'ai_assisted';
export type TaxProfileCountryPreset = 'germany';
export type PrivateSaleAllowanceMode = 'all_or_nothing' | 'allowance_exemption';

export interface TaxProfileDraft {
  countryLabel: string;
  personalIncomeTaxRatePct: number;
  capitalIncomeTaxRatePct: number;
  capitalIncomeAllowance: number;
  privateSaleAllowance: number;
  privateSaleHoldingPeriodDays: number;
  privateSaleAllowanceMode: PrivateSaleAllowanceMode;
  notes: string;
}

export interface AiAssistedTaxProfileDraft extends TaxProfileDraft {
  researchCountry: string;
  researchSummary: string;
  confirmedByUser: boolean;
}

export interface TaxProfileSettings {
  mode: TaxProfileMode;
  presetCountry: TaxProfileCountryPreset;
  presetPersonalIncomeTaxRatePct: number;
  manual: TaxProfileDraft;
  aiAssisted: AiAssistedTaxProfileDraft;
}

export interface EffectiveTaxProfile {
  label: string;
  countryLabel: string;
  sourceLabel: string;
  personalIncomeTaxRate: number;
  capitalIncomeTaxRate: number;
  capitalIncomeAllowance: number;
  privateSaleAllowance: number;
  privateSaleHoldingPeriodDays: number;
  privateSaleAllowanceMode: PrivateSaleAllowanceMode;
  isPreset: boolean;
  needsUserConfirmation: boolean;
  notes: string;
}

function clampPct(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }

  return Math.min(100, Math.max(0, value));
}

function clampNonNegative(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }

  return Math.max(0, value);
}

function normalizeAllowanceMode(
  value: unknown,
  fallback: PrivateSaleAllowanceMode,
): PrivateSaleAllowanceMode {
  return value === 'all_or_nothing' || value === 'allowance_exemption' ? value : fallback;
}

function normalizeDraft(
  raw: unknown,
  fallback: TaxProfileDraft,
): TaxProfileDraft {
  const parsed = typeof raw === 'object' && raw !== null ? raw as Partial<TaxProfileDraft> : {};

  return {
    countryLabel: typeof parsed.countryLabel === 'string' ? parsed.countryLabel : fallback.countryLabel,
    personalIncomeTaxRatePct: clampPct(parsed.personalIncomeTaxRatePct, fallback.personalIncomeTaxRatePct),
    capitalIncomeTaxRatePct: clampPct(parsed.capitalIncomeTaxRatePct, fallback.capitalIncomeTaxRatePct),
    capitalIncomeAllowance: clampNonNegative(parsed.capitalIncomeAllowance, fallback.capitalIncomeAllowance),
    privateSaleAllowance: clampNonNegative(parsed.privateSaleAllowance, fallback.privateSaleAllowance),
    privateSaleHoldingPeriodDays: clampNonNegative(parsed.privateSaleHoldingPeriodDays, fallback.privateSaleHoldingPeriodDays),
    privateSaleAllowanceMode: normalizeAllowanceMode(parsed.privateSaleAllowanceMode, fallback.privateSaleAllowanceMode),
    notes: typeof parsed.notes === 'string' ? parsed.notes : fallback.notes,
  };
}

const DEFAULT_MANUAL_PROFILE: TaxProfileDraft = {
  countryLabel: 'Custom country',
  personalIncomeTaxRatePct: 30,
  capitalIncomeTaxRatePct: 25,
  capitalIncomeAllowance: 0,
  privateSaleAllowance: 0,
  privateSaleHoldingPeriodDays: 0,
  privateSaleAllowanceMode: 'allowance_exemption',
  notes: '',
};

export const DEFAULT_TAX_PROFILE_SETTINGS: TaxProfileSettings = {
  mode: 'preset',
  presetCountry: 'germany',
  presetPersonalIncomeTaxRatePct: 32,
  manual: DEFAULT_MANUAL_PROFILE,
  aiAssisted: {
    ...DEFAULT_MANUAL_PROFILE,
    countryLabel: 'AI draft country',
    researchCountry: '',
    researchSummary: '',
    confirmedByUser: false,
  },
};

export function normalizeTaxProfileSettings(raw: unknown): TaxProfileSettings {
  const parsed = typeof raw === 'object' && raw !== null ? raw as Partial<TaxProfileSettings> : {};
  const normalizedAiAssistedBase = normalizeDraft(parsed.aiAssisted, DEFAULT_TAX_PROFILE_SETTINGS.aiAssisted);
  const aiAssistedRaw = typeof parsed.aiAssisted === 'object' && parsed.aiAssisted !== null
    ? parsed.aiAssisted as Partial<AiAssistedTaxProfileDraft>
    : {};

  return {
    mode:
      parsed.mode === 'preset' || parsed.mode === 'manual' || parsed.mode === 'ai_assisted'
        ? parsed.mode
        : DEFAULT_TAX_PROFILE_SETTINGS.mode,
    presetCountry:
      parsed.presetCountry === 'germany'
        ? parsed.presetCountry
        : DEFAULT_TAX_PROFILE_SETTINGS.presetCountry,
    presetPersonalIncomeTaxRatePct: clampPct(
      parsed.presetPersonalIncomeTaxRatePct,
      DEFAULT_TAX_PROFILE_SETTINGS.presetPersonalIncomeTaxRatePct,
    ),
    manual: normalizeDraft(parsed.manual, DEFAULT_TAX_PROFILE_SETTINGS.manual),
    aiAssisted: {
      ...normalizedAiAssistedBase,
      researchCountry:
        typeof aiAssistedRaw.researchCountry === 'string'
          ? aiAssistedRaw.researchCountry
          : DEFAULT_TAX_PROFILE_SETTINGS.aiAssisted.researchCountry,
      researchSummary:
        typeof aiAssistedRaw.researchSummary === 'string'
          ? aiAssistedRaw.researchSummary
          : DEFAULT_TAX_PROFILE_SETTINGS.aiAssisted.researchSummary,
      confirmedByUser:
        typeof aiAssistedRaw.confirmedByUser === 'boolean'
          ? aiAssistedRaw.confirmedByUser
          : DEFAULT_TAX_PROFILE_SETTINGS.aiAssisted.confirmedByUser,
    },
  };
}

export function buildGermanyTaxProfile(year: number, personalIncomeTaxRatePct = 32): EffectiveTaxProfile {
  return {
    label: 'Germany preset',
    countryLabel: 'Germany',
    sourceLabel: 'Built-in preset',
    personalIncomeTaxRate: personalIncomeTaxRatePct / 100,
    capitalIncomeTaxRate: 0.26375,
    capitalIncomeAllowance: 1000,
    privateSaleAllowance: year >= 2024 ? 1000 : 600,
    privateSaleHoldingPeriodDays: 365,
    privateSaleAllowanceMode: 'all_or_nothing',
    isPreset: true,
    needsUserConfirmation: false,
    notes: 'German preset with built-in assumptions for stocks, ETFs, crypto, and precious metals.',
  };
}

export function getEffectiveTaxProfile(
  settings: TaxProfileSettings,
  year: number,
): EffectiveTaxProfile {
  if (settings.mode === 'preset') {
    return buildGermanyTaxProfile(year, settings.presetPersonalIncomeTaxRatePct);
  }

  const source = settings.mode === 'manual' ? settings.manual : settings.aiAssisted;
  return {
    label: settings.mode === 'manual' ? 'Manual profile' : 'AI-assisted draft',
    countryLabel: source.countryLabel.trim() || (settings.mode === 'manual' ? 'Custom country' : 'AI draft country'),
    sourceLabel: settings.mode === 'manual' ? 'Manual entry' : 'AI draft + user confirmation',
    personalIncomeTaxRate: source.personalIncomeTaxRatePct / 100,
    capitalIncomeTaxRate: source.capitalIncomeTaxRatePct / 100,
    capitalIncomeAllowance: Math.max(0, source.capitalIncomeAllowance),
    privateSaleAllowance: Math.max(0, source.privateSaleAllowance),
    privateSaleHoldingPeriodDays: Math.max(0, source.privateSaleHoldingPeriodDays),
    privateSaleAllowanceMode: source.privateSaleAllowanceMode,
    isPreset: false,
    needsUserConfirmation: settings.mode === 'ai_assisted' ? !settings.aiAssisted.confirmedByUser : false,
    notes: source.notes,
  };
}

export function getTaxProfileSummaryLabel(settings: TaxProfileSettings): string {
  if (settings.mode === 'preset') {
    return 'Germany preset';
  }

  if (settings.mode === 'manual') {
    return settings.manual.countryLabel.trim() ? `Manual · ${settings.manual.countryLabel.trim()}` : 'Manual profile';
  }

  return settings.aiAssisted.countryLabel.trim()
    ? `AI draft · ${settings.aiAssisted.countryLabel.trim()}`
    : 'AI-assisted draft';
}

export function buildAiTaxResearchPrompt(country: string): string {
  const safeCountry = country.trim() || 'the selected country';

  return [
    `Research retail investor tax treatment in ${safeCountry} for stocks, ETFs, crypto, gold, and silver.`,
    'Return only a concise compliance draft with these fields:',
    '1. personal income tax rate used for short-term gains,',
    '2. capital income / flat investment tax rate,',
    '3. yearly allowance for stocks and ETFs,',
    '4. yearly allowance or threshold for crypto and precious metals,',
    '5. holding period in days after which crypto or metals become tax-free, if any,',
    '6. whether the short-term threshold exempts only the excess or the whole amount becomes taxable once exceeded,',
    '7. official source links and effective dates.',
    'Do not guess. Mark any uncertain field as unknown. The user must confirm values manually before they are applied.',
  ].join(' ');
}
