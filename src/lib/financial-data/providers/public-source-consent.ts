'use client';

import { INVESTATLAS_DEPLOYMENT_MODE } from '@/lib/runtime/deployment-mode';

// A deliberate, owner-scoped choice for this browser tab. Never persist provider
// permission in Firestore, localStorage, cookies, or the public Demo.
export type PublicSourceId = 'yahoo' | 'spot' | 'coinpaprika' | 'coingecko' | 'binance' | 'kraken' | 'bullion';
const ALLOWED: readonly PublicSourceId[] = ['yahoo', 'spot', 'coinpaprika', 'coingecko', 'binance', 'kraken', 'bullion'];
// Discovery, custom listings and multiyear requests require a fresh deliberate choice.
const STORAGE_KEY = 'investatlas.public-sources.session.v3';
export const PUBLIC_SOURCE_CONSENT_EVENT = 'investatlas:public-source-consent';
const SOURCE_CHANGE = 'investatlas:market-source-selection';

type StoredConsent = { owner: string; sources: PublicSourceId[] };
let fallback: StoredConsent | null = null;
let revision = 0;

/** Invalidates pending requests even if the same owner immediately approves again. */
export function getPublicSourceConsentRevision(): number { return revision; }

function validSources(value: unknown): PublicSourceId[] {
  if (!Array.isArray(value)) return [];
  return ALLOWED.filter((source) => value.includes(source));
}

function emit(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event(PUBLIC_SOURCE_CONSENT_EVENT));
  window.dispatchEvent(new Event(SOURCE_CHANGE));
}

export function readPublicSourceConsent(owner: string): PublicSourceId[] {
  if (!owner || INVESTATLAS_DEPLOYMENT_MODE === 'public_demo') return [];
  if (INVESTATLAS_DEPLOYMENT_MODE !== 'private_cloud'
    && INVESTATLAS_DEPLOYMENT_MODE !== 'local_personal') return [];
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return fallback?.owner === owner ? [...fallback.sources] : [];
    const decoded: unknown = JSON.parse(raw);
    if (!decoded || typeof decoded !== 'object') return [];
    const value = decoded as Partial<StoredConsent>;
    return value.owner === owner ? validSources(value.sources) : [];
  } catch {
    return fallback?.owner === owner ? [...fallback.sources] : [];
  }
}

export function isPublicSourceApproved(owner: string, source: PublicSourceId): boolean {
  return readPublicSourceConsent(owner).includes(source);
}

export function setPublicSourceConsent(owner: string, selected: readonly PublicSourceId[]): void {
  if (!owner || (INVESTATLAS_DEPLOYMENT_MODE !== 'private_cloud'
    && INVESTATLAS_DEPLOYMENT_MODE !== 'local_personal')) return;
  const data: StoredConsent = { owner, sources: validSources(selected) };
  revision += 1;
  fallback = data;
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch { /* Memory-only fallback if browser storage is blocked. */ }
  emit();
}

export function clearPublicSourceConsent(): void {
  revision += 1;
  fallback = null;
  if (typeof window === 'undefined') return;
  try { window.sessionStorage.removeItem(STORAGE_KEY); } catch { /* Storage can be denied. */ }
  emit();
}

export function reconcilePublicSourceConsent(activeOwner: string | null): void {
  if (typeof window === 'undefined' || (INVESTATLAS_DEPLOYMENT_MODE !== 'private_cloud'
    && INVESTATLAS_DEPLOYMENT_MODE !== 'local_personal')) return;
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (raw) {
      const value: unknown = JSON.parse(raw);
      if (!value || typeof value !== 'object'
        || (value as Partial<StoredConsent>).owner !== activeOwner) {
        clearPublicSourceConsent();
        return;
      }
    }
  } catch {
    clearPublicSourceConsent();
    return;
  }
  if (fallback && fallback.owner !== activeOwner) clearPublicSourceConsent();
}
