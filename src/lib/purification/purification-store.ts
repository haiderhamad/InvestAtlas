'use client';

import type { EtfPurificationConfig } from '@/lib/config/supported-assets';
import {
  readWorkspaceStorageItem,
  writeWorkspaceStorageItem,
} from '@/lib/storage/workspace-storage';

export type StockPurificationMethod = 'dividends' | 'holdings';

export interface PurificationSettings {
  etfOverrides: Record<string, EtfPurificationConfig>;
  stockImpermissibleIncomeRatio: number;
  stockPurificationMethod: StockPurificationMethod;
  /** Marks that the user deliberately confirmed the ratio rather than using the demo default. */
  stockRatioConfirmedAt?: string;
}

export const PURIFICATION_STORAGE_KEY = 'investatlas.purification-settings';
export const PURIFICATION_SETTINGS_EVENT = 'investatlas:purification-settings-change';

export const DEFAULT_PURIFICATION_SETTINGS: PurificationSettings = {
  etfOverrides: {},
  stockImpermissibleIncomeRatio: 0.05,
  stockPurificationMethod: 'dividends',
};

function isFiniteRatio(value: unknown): value is number {
  return (
    typeof value === 'number'
    && Number.isFinite(value)
    && value >= 0
    && value <= 1
  );
}

function isValidConfirmationTimestamp(value: unknown): value is string {
  return (
    typeof value === 'string'
    && value.trim().length > 0
    && Number.isFinite(Date.parse(value))
  );
}

function sanitizePurificationSettings(
  parsed: Partial<PurificationSettings>,
): PurificationSettings {
  const parsedRatio = parsed.stockImpermissibleIncomeRatio;
  const ratioIsValid = isFiniteRatio(parsedRatio);
  const sanitizedRatio = isFiniteRatio(parsedRatio)
    ? parsedRatio
    : DEFAULT_PURIFICATION_SETTINGS.stockImpermissibleIncomeRatio;
  const etfOverrides =
    parsed.etfOverrides
    && typeof parsed.etfOverrides === 'object'
    && !Array.isArray(parsed.etfOverrides)
      ? parsed.etfOverrides
      : {};

  return {
    etfOverrides,
    stockImpermissibleIncomeRatio: sanitizedRatio,
    stockPurificationMethod:
      parsed.stockPurificationMethod === 'holdings' ? 'holdings' : 'dividends',
    stockRatioConfirmedAt:
      ratioIsValid && isValidConfirmationTimestamp(parsed.stockRatioConfirmedAt)
        ? parsed.stockRatioConfirmedAt
        : undefined,
  };
}

export function readPurificationSettings(): PurificationSettings {
  if (typeof window === 'undefined') {
    return DEFAULT_PURIFICATION_SETTINGS;
  }

  try {
    const raw = readWorkspaceStorageItem(PURIFICATION_STORAGE_KEY);
    if (!raw) {
      return DEFAULT_PURIFICATION_SETTINGS;
    }

    const parsed = JSON.parse(raw) as Partial<PurificationSettings>;
    return sanitizePurificationSettings(parsed);
  } catch {
    return DEFAULT_PURIFICATION_SETTINGS;
  }
}

export function writePurificationSettings(settings: PurificationSettings): void {
  if (typeof window === 'undefined') {
    return;
  }

  const sanitized = sanitizePurificationSettings(settings);
  if (writeWorkspaceStorageItem(PURIFICATION_STORAGE_KEY, JSON.stringify(sanitized))) {
    window.dispatchEvent(
      new CustomEvent(PURIFICATION_SETTINGS_EVENT, { detail: sanitized }),
    );
  }
}

export function setStockRatio(ratio: number): PurificationSettings {
  const settings = readPurificationSettings();
  const ratioIsFinite = Number.isFinite(ratio);
  const clamped = ratioIsFinite
    ? Math.max(0, Math.min(1, ratio))
    : DEFAULT_PURIFICATION_SETTINGS.stockImpermissibleIncomeRatio;
  const next: PurificationSettings = {
    ...settings,
    stockImpermissibleIncomeRatio: clamped,
    stockRatioConfirmedAt: ratioIsFinite ? new Date().toISOString() : undefined,
  };
  writePurificationSettings(next);
  return next;
}

export function setStockMethod(method: StockPurificationMethod): PurificationSettings {
  const settings = readPurificationSettings();
  const next: PurificationSettings = { ...settings, stockPurificationMethod: method };
  writePurificationSettings(next);
  return next;
}

export function setEtfOverride(
  symbol: string,
  override: EtfPurificationConfig | null,
): PurificationSettings {
  const settings = readPurificationSettings();
  const key = symbol.trim().toUpperCase();
  const nextOverrides = { ...settings.etfOverrides };

  if (override === null) {
    delete nextOverrides[key];
  } else {
    nextOverrides[key] = override;
  }

  const next: PurificationSettings = { ...settings, etfOverrides: nextOverrides };
  writePurificationSettings(next);
  return next;
}
