'use client';

export const LEGAL_ACCEPTANCE_KEY = 'investatlas.legal-acceptance';
export const LEGAL_TERMS_VERSION = '2026-11-07';

export type LegalAcceptance = {
  version: string;
  acceptedAt: string;
};

export function normalizeLegalAcceptance(value: unknown): LegalAcceptance | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Partial<LegalAcceptance>;
  if (
    candidate.version !== LEGAL_TERMS_VERSION
    || typeof candidate.acceptedAt !== 'string'
  ) {
    return null;
  }

  const acceptedAt = new Date(candidate.acceptedAt);
  if (!Number.isFinite(acceptedAt.getTime()) || acceptedAt.getTime() > Date.now()) {
    return null;
  }

  return {
    version: LEGAL_TERMS_VERSION,
    acceptedAt: acceptedAt.toISOString(),
  };
}

export function readLegalAcceptance(): LegalAcceptance | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(LEGAL_ACCEPTANCE_KEY);
    return raw ? normalizeLegalAcceptance(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

export function recordLegalAcceptance(now = new Date()): LegalAcceptance {
  const acceptance: LegalAcceptance = {
    version: LEGAL_TERMS_VERSION,
    acceptedAt: now.toISOString(),
  };
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(LEGAL_ACCEPTANCE_KEY, JSON.stringify(acceptance));
    } catch {
      // The gate remains visible on the next navigation when browser storage
      // is unavailable; authentication itself must not fail with a storage error.
    }
  }
  return acceptance;
}
