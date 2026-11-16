'use client';

import { AlertTriangle, FileUp, Loader2, Sparkles, Trash2, X } from 'lucide-react';
import { useCallback, useRef, useState } from 'react';

import type { AssetClass } from '@/lib/config/supported-assets';
import {
  addManualTransactions,
  deriveTaxType,
} from '@/lib/transactions/manual-store';
import { InsufficientCashError } from '@/lib/transactions/cash-balances';
import { getAllManualAccounts } from '@/lib/accounts/manual-accounts-store';
import { resolveInvestmentCashRoute } from '@/lib/accounts/investment-cash-routing';
import type {
  InvestmentTransaction,
  InvestmentTransactionType,
} from '@/lib/tax/investment-tax';
import Dialog from '@/components/ui/dialog';
import { useAppTranslation } from '@/lib/i18n/use-app-translation';
import { getFirebaseAuthHeaders } from '@/lib/auth/firebase-api-auth';
import { INVESTATLAS_DEPLOYMENT_MODE } from '@/lib/runtime/deployment-mode';
import { getLocalAIConfig } from '@/lib/ai/local-browser-provider';
import { readAnonymousWorkspaceMode } from '@/lib/demo/workspace-mode';

type LedgerAssetClass = AssetClass | 'cash';

interface DraftTransaction {
  id: string;
  date: string;
  venue: string;
  type: InvestmentTransactionType;
  asset: string;
  assetName?: string;
  assetClass: LedgerAssetClass;
  quote: string;
  amount: number;
  price: number;
  total: number;
  fee: number;
  notes?: string;
}

interface ImportApiResponse {
  transactions?: DraftTransaction[];
  warnings?: string[];
  provider?: string;
  model?: string;
  error?: string;
  details?: string[];
}

type Stage = 'upload' | 'analyzing' | 'review' | 'error';

const TYPE_OPTIONS: InvestmentTransactionType[] = [
  'buy',
  'sell',
  'dividend',
  'fee',
  'transfer',
  'deposit',
  'withdrawal',
  'adjustment',
];

const CLASS_OPTIONS: LedgerAssetClass[] = ['crypto', 'stock', 'etf', 'metal', 'cash'];

const QUOTE_OPTIONS = ['EUR', 'USD', 'USDT'];

function toDateInput(value: string): string {
  try {
    return new Date(value).toISOString().slice(0, 10);
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

function generateId(): string {
  return `manual-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

type Translate = (text: string) => string;

function getFriendlyError(
  rawError: string,
  details: string[],
  t: Translate,
): { message: string; details: string[] } {
  const lowerError = rawError.toLowerCase();
  const hasImageError = lowerError.includes('image') || lowerError.includes('png') || lowerError.includes('vision');
  const hasUnsupportedError = lowerError.includes('does not support') || lowerError.includes('not supported') || lowerError.includes('unsupported');

  if (hasImageError && hasUnsupportedError) {
    return {
      message: t('Your AI provider does not support image files. Use a vision-capable model or upload a PDF file.'),
      details: details.length > 0
        ? details.map(t)
        : [t('This response came from your configured AI provider.')],
    };
  }

  if (
    lowerError.includes('connection')
    || lowerError.includes('connect')
    || lowerError.includes('timeout')
    || lowerError.includes('failed to fetch')
    || lowerError.includes('network')
  ) {
    return {
      message: t('Could not connect to the AI provider. Check your provider settings and try again.'),
      details: details.map(t),
    };
  }

  if (lowerError.includes('401') || lowerError.includes('unauthorized') || lowerError.includes('api key')) {
    return {
      message: t('Invalid API key. Check your AI provider settings.'),
      details: details.map(t),
    };
  }

  return { message: t(rawError), details: details.map(t) };
}

export default function TransactionImportDialog({ onClose }: { onClose: () => void }) {
  const [stage, setStage] = useState<Stage>('upload');
  const [file, setFile] = useState<File | null>(null);
  const [drafts, setDrafts] = useState<DraftTransaction[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [providerLabel, setProviderLabel] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [errorDetails, setErrorDetails] = useState<string[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { t, language } = useAppTranslation();
  const importNeedsCashLabel = t('Import needs cash first');
  const numberLocale =
    language === 'ar' ? 'ar-SA' : language === 'de' ? 'de-DE' : 'en-US';

  const runAnalysis = useCallback(async (selected: File) => {
    setStage('analyzing');
    setErrorMessage(null);
    setErrorDetails([]);

    try {
      const body = new FormData();
      body.append('file', selected);
      const isLocal = INVESTATLAS_DEPLOYMENT_MODE === 'local_personal';
      if (isLocal) {
        if (readAnonymousWorkspaceMode() !== 'local_workspace') {
          throw new Error('The Local Workspace changed during document import.');
        }
        const provider = getLocalAIConfig();
        if (!provider) throw new Error('Configure a session-only AI key in Settings before importing.');
        body.append('provider', JSON.stringify(provider));
      }

      const res = await fetch(
        isLocal ? '/api/local/transactions/import' : '/api/transactions/import',
        {
          method: 'POST',
          ...(isLocal ? {
            cache: 'no-store' as const,
            redirect: 'error' as const,
            credentials: 'same-origin' as const,
            referrerPolicy: 'no-referrer' as const,
          } : { headers: await getFirebaseAuthHeaders() }),
          body,
        },
      );
      const json = (await res.json()) as ImportApiResponse;
      if (isLocal && readAnonymousWorkspaceMode() !== 'local_workspace') {
        throw new Error('The Local Workspace changed during document import.');
      }

      if (!res.ok) {
        setStage('error');
        const rawError = json.error ?? `Request failed (${res.status})`;
        const providerErrors = json.details ?? [];
        const friendlyError = getFriendlyError(rawError, providerErrors, t);
        setErrorMessage(friendlyError.message);
        setErrorDetails(friendlyError.details);
        return;
      }

      const parsed = (json.transactions ?? []).map((t) => ({
        ...t,
        id: t.id || generateId(),
      }));

      if (parsed.length === 0) {
        setStage('error');
        setErrorMessage(t('The AI could not find any transactions in this file.'));
        setErrorDetails(json.warnings ?? []);
        return;
      }

      setDrafts(parsed);
      setWarnings(json.warnings ?? []);
      setProviderLabel(json.provider ?? null);
      setStage('review');
    } catch (err) {
      setStage('error');
      const rawError = err instanceof Error ? err.message : 'Request failed';
      const friendly = getFriendlyError(rawError, [], t);
      setErrorMessage(friendly.message);
      setErrorDetails(friendly.details);
    }
  }, [t]);

  const handleFileSelect = (selected: File | null) => {
    if (!selected) return;
    setFile(selected);
    runAnalysis(selected);
  };

  const updateDraft = (id: string, patch: Partial<DraftTransaction>) => {
    setDrafts((prev) =>
      prev.map((draft) => {
        if (draft.id !== id) return draft;
        const next = { ...draft, ...patch };
        if (patch.amount !== undefined || patch.price !== undefined) {
          const amount = patch.amount ?? draft.amount;
          const price = patch.price ?? draft.price;
          if (Number.isFinite(amount) && Number.isFinite(price) && amount > 0 && price > 0) {
            next.total = Number((amount * price).toFixed(6));
          }
        }
        return next;
      }),
    );
  };

  const removeDraft = (id: string) => {
    setDrafts((prev) => prev.filter((draft) => draft.id !== id));
  };

  const addEmptyRow = () => {
    const today = new Date().toISOString().slice(0, 10) + 'T12:00:00Z';
    setDrafts((prev) => [
      ...prev,
      {
        id: generateId(),
        date: today,
        venue: 'manual-entry',
        type: 'buy',
        asset: '',
        assetClass: 'crypto',
        quote: 'EUR',
        amount: 0,
        price: 0,
        total: 0,
        fee: 0,
      },
    ]);
  };

  const confirmAll = async () => {
    const valid = drafts.filter((d) => d.asset.trim().length > 0 && d.amount > 0);
    if (valid.length === 0) return;

    const manualAccounts = getAllManualAccounts();
    const missingRoute = valid.find(
      (draft) =>
        (draft.type === 'buy' || draft.type === 'sell') &&
        draft.assetClass !== 'cash' &&
        !resolveInvestmentCashRoute(manualAccounts, draft.assetClass),
    );
    if (missingRoute) {
      setErrorMessage(
        t('Assign an Investment-Cash account for this asset type before saving this buy or sell.'),
      );
      setErrorDetails([
        `${missingRoute.assetClass}: ${missingRoute.asset}`,
      ]);
      return;
    }
    const toPersist: InvestmentTransaction[] = valid.map((d) => {
      const settlementRoute =
        (d.type === 'buy' || d.type === 'sell') && d.assetClass !== 'cash'
          ? resolveInvestmentCashRoute(manualAccounts, d.assetClass)
          : null;

      return {
        id: generateId(),
        date: d.date,
        venue: d.venue.trim() || 'manual-entry',
        settlementVenue: settlementRoute?.venue,
        type: d.type,
        asset: d.asset.trim().toUpperCase(),
        assetName: d.assetName,
        assetClass: d.assetClass,
        quote: d.quote.trim().toUpperCase(),
        amount: d.amount,
        price: d.price,
        total: d.total,
        fee: d.fee,
        taxType: deriveTaxType(d.type, d.assetClass),
        source: 'manual',
        notes: d.notes,
      };
    });

    setIsSaving(true);
    try {
      await addManualTransactions(toPersist);
      onClose();
    } catch (error) {
      if (error instanceof InsufficientCashError) {
        const { result } = error;
        setErrorMessage(
          `${t('Not enough cash in')} ${result.venue}. ${t('Required')}: ${result.required.toLocaleString(numberLocale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${result.symbol}. ${t('Available')}: ${result.available.toLocaleString(numberLocale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${result.symbol}. ${t('Missing')}: ${result.missing.toLocaleString(numberLocale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${result.symbol}.`,
        );
        setErrorDetails([
          t('Book a deposit or transfer into the affected account before saving new buys.'),
        ]);
        return;
      }
      setErrorMessage(t('Import could not be saved. Please reload the page and try again.'));
      setErrorDetails([]);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog
      open
      onClose={onClose}
      labelledBy="tx-import-title"
      contentStyle={{ width: 'min(980px, 100%)', maxHeight: '90vh', display: 'flex', flexDirection: 'column' }}
    >
        <div className="account-create-header" style={{ marginBottom: 14 }}>
          <div>
            <h2 id="tx-import-title" className="section-title" style={{ fontSize: 18, margin: 0 }}>
              <Sparkles size={16} style={{ display: 'inline', marginRight: 6, color: 'var(--accent-blue)' }} />
              {t('Import transactions from PDF or screenshot')}
            </h2>
            <div className="panel-subtitle" style={{ marginTop: 6 }}>
              {t('Drop a broker statement, trade confirmation, or app screenshot. Only your highest-priority enabled AI provider receives this upload and extracts the trades — you review and confirm before anything is saved.')}
            </div>
          </div>
          <button className="btn btn-secondary btn-sm" onClick={onClose} aria-label={t('Close')}>
            <X size={14} />
          </button>
        </div>

        <div style={{ flex: 1, overflow: 'auto' }}>
          {stage === 'upload' && (
            <div
              className="card"
              style={{
                background: 'var(--bg-primary)',
                textAlign: 'center',
                padding: '48px 24px',
                border: '2px dashed var(--surface-border-soft)',
              }}
            >
              <FileUp size={36} style={{ color: 'var(--accent-blue)', marginBottom: 12 }} />
              <div style={{ fontWeight: 700, marginBottom: 6 }}>{t('Select a file to analyze')}</div>
              <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 16 }}>
                {t('PDF, PNG, JPG, or WEBP · max 10 MB')}
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept="application/pdf,image/png,image/jpeg,image/webp"
                style={{ display: 'none' }}
                onChange={(event) => handleFileSelect(event.target.files?.[0] ?? null)}
              />
              <button className="btn btn-primary" onClick={() => fileInputRef.current?.click()}>
                <FileUp size={14} /> {t('Choose file')}
              </button>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 16, lineHeight: 1.5 }}>
                {t('Works best with broker PDFs (Trade Republic, Scalable, IBKR) and screenshots from exchange apps.')}
                <br />
                {t('Your file is sent to the AI provider you configured under Settings → AI Providers.')}
              </div>
            </div>
          )}

          {stage === 'analyzing' && (
            <div style={{ textAlign: 'center', padding: '60px 24px' }}>
              <Loader2
                size={32}
                style={{ color: 'var(--accent-blue)', marginBottom: 12, animation: 'spin 1s linear infinite' }}
              />
              <div style={{ fontWeight: 700, marginBottom: 6 }}>{t('Analyzing')} {file?.name}…</div>
              <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                {t('Extracting transactions. This usually takes 5–20 seconds.')}
              </div>
            </div>
          )}

          {stage === 'error' && (
            <div className="callout warn" style={{ marginBottom: 12 }}>
              <AlertTriangle size={18} style={{ color: 'var(--yellow)', flexShrink: 0, marginTop: 2 }} />
              <div>
                <strong>{t('Could not import.')}</strong>
                <div style={{ marginTop: 4, fontSize: 13 }}>{errorMessage}</div>
                {errorDetails.length > 0 && (
                  <ul style={{ marginTop: 8, paddingLeft: 18, fontSize: 12, color: 'var(--text-muted)' }}>
                    {errorDetails.map((d, i) => (
                      <li key={i}>{t(d)}</li>
                    ))}
                  </ul>
                )}
                <div style={{ marginTop: 10 }}>
                  <button
                    className="btn btn-secondary btn-sm"
                    onClick={() => {
                      setStage('upload');
                      setFile(null);
                    }}
                  >
                    {t('Try another file')}
                  </button>
                </div>
              </div>
            </div>
          )}

          {stage === 'review' && (
            <>
              <div
                className="callout info"
                style={{ marginBottom: 12, fontSize: 13 }}
              >
                <Sparkles size={16} style={{ color: 'var(--accent-blue)', flexShrink: 0, marginTop: 2 }} />
                <div>
                  <strong>{drafts.length}</strong> {drafts.length === 1 ? t('transaction extracted') : t('transactions extracted')}
                  {providerLabel ? ` ${t('via')} ${providerLabel}` : ''}. {t('. Edit any field below before confirming — or just hit')}
                  <em> {t('Confirm all')} </em> {t('if it looks right.')}
                </div>
              </div>

              {warnings.length > 0 && (
                <div className="callout warn" style={{ marginBottom: 12, fontSize: 12 }}>
                  <AlertTriangle size={16} style={{ color: 'var(--yellow)', flexShrink: 0, marginTop: 2 }} />
                  <div>
                    <strong>{t('AI notes:')}</strong>
                    <ul style={{ marginTop: 4, paddingLeft: 18 }}>
                      {warnings.map((w, i) => (
                        <li key={i}>{t(w)}</li>
                      ))}
                    </ul>
                  </div>
                </div>
              )}

              {errorMessage && (
                <div className="callout warn" style={{ marginBottom: 12, fontSize: 12 }}>
                  <AlertTriangle size={16} style={{ color: 'var(--yellow)', flexShrink: 0, marginTop: 2 }} />
                  <div>
                    <strong>{importNeedsCashLabel}</strong>
                    <div style={{ marginTop: 4 }}>{errorMessage}</div>
                    {errorDetails.length > 0 && (
                      <ul style={{ marginTop: 6, paddingLeft: 18 }}>
                        {errorDetails.map((detail, index) => (
                          <li key={index}>{t(detail)}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              )}

              <div className="table-container" style={{ maxHeight: 480 }}>
                <table>
                  <thead>
                    <tr>
                      <th style={{ minWidth: 120 }}>{t('Date')}</th>
                      <th style={{ minWidth: 100 }}>{t('Type')}</th>
                      <th style={{ minWidth: 90 }}>{t('Category')}</th>
                      <th style={{ minWidth: 100 }}>{t('Asset')}</th>
                      <th style={{ minWidth: 90 }}>{t('Quote')}</th>
                      <th style={{ minWidth: 110 }}>{t('Amount')}</th>
                      <th style={{ minWidth: 110 }}>{t('Price')}</th>
                      <th style={{ minWidth: 110 }}>{t('Total')}</th>
                      <th style={{ minWidth: 90 }}>{t('Fee')}</th>
                      <th style={{ minWidth: 120 }}>{t('Venue')}</th>
                      <th style={{ width: 36 }} />
                    </tr>
                  </thead>
                  <tbody>
                    {drafts.map((draft) => (
                      <tr key={draft.id}>
                        <td>
                          <input
                            className="input"
                            type="date"
                            value={toDateInput(draft.date)}
                            onChange={(event) =>
                              updateDraft(draft.id, {
                                date: event.target.value ? `${event.target.value}T12:00:00Z` : draft.date,
                              })
                            }
                            style={{ fontSize: 12, padding: '4px 6px' }}
                          />
                        </td>
                        <td>
                          <select
                            className="select"
                            value={draft.type}
                            onChange={(event) =>
                              updateDraft(draft.id, {
                                type: event.target.value as InvestmentTransactionType,
                              })
                            }
                            style={{ fontSize: 12, padding: '4px 6px' }}
                          >
                            {TYPE_OPTIONS.map((type) => (
                              <option key={type} value={type}>
                                {t(type)}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td>
                          <select
                            className="select"
                            value={draft.assetClass}
                            onChange={(event) =>
                              updateDraft(draft.id, {
                                assetClass: event.target.value as LedgerAssetClass,
                              })
                            }
                            style={{ fontSize: 12, padding: '4px 6px' }}
                          >
                            {CLASS_OPTIONS.map((assetClass) => (
                              <option key={assetClass} value={assetClass}>
                                {t(assetClass)}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td>
                          <input
                            className="input mono"
                            type="text"
                            value={draft.asset}
                            onChange={(event) => updateDraft(draft.id, { asset: event.target.value })}
                            placeholder="BTC"
                            style={{ fontSize: 12, padding: '4px 6px', textTransform: 'uppercase' }}
                          />
                        </td>
                        <td>
                          <select
                            className="select"
                            value={draft.quote}
                            onChange={(event) => updateDraft(draft.id, { quote: event.target.value })}
                            style={{ fontSize: 12, padding: '4px 6px' }}
                          >
                            {QUOTE_OPTIONS.map((q) => (
                              <option key={q} value={q}>
                                {q}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td>
                          <input
                            className="input mono"
                            type="number"
                            step="any"
                            value={draft.amount}
                            onChange={(event) =>
                              updateDraft(draft.id, { amount: Number.parseFloat(event.target.value) || 0 })
                            }
                            style={{ fontSize: 12, padding: '4px 6px', textAlign: 'right' }}
                          />
                        </td>
                        <td>
                          <input
                            className="input mono"
                            type="number"
                            step="any"
                            value={draft.price}
                            onChange={(event) =>
                              updateDraft(draft.id, { price: Number.parseFloat(event.target.value) || 0 })
                            }
                            style={{ fontSize: 12, padding: '4px 6px', textAlign: 'right' }}
                          />
                        </td>
                        <td>
                          <input
                            className="input mono"
                            type="number"
                            step="any"
                            value={draft.total}
                            onChange={(event) =>
                              updateDraft(draft.id, { total: Number.parseFloat(event.target.value) || 0 })
                            }
                            style={{ fontSize: 12, padding: '4px 6px', textAlign: 'right' }}
                          />
                        </td>
                        <td>
                          <input
                            className="input mono"
                            type="number"
                            step="any"
                            value={draft.fee}
                            onChange={(event) =>
                              updateDraft(draft.id, { fee: Number.parseFloat(event.target.value) || 0 })
                            }
                            style={{ fontSize: 12, padding: '4px 6px', textAlign: 'right' }}
                          />
                        </td>
                        <td>
                          <input
                            className="input"
                            type="text"
                            value={draft.venue}
                            onChange={(event) => updateDraft(draft.id, { venue: event.target.value })}
                            style={{ fontSize: 12, padding: '4px 6px' }}
                          />
                        </td>
                        <td style={{ textAlign: 'center' }}>
                          <button
                            type="button"
                            onClick={() => removeDraft(draft.id)}
                            title={t('Remove row')}
                            aria-label={t('Remove row')}
                            style={{
                              background: 'none',
                              border: 'none',
                              cursor: 'pointer',
                              color: 'var(--red)',
                              padding: 4,
                            }}
                          >
                            <Trash2 size={14} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div style={{ marginTop: 10 }}>
                <button type="button" className="btn btn-secondary btn-sm" onClick={addEmptyRow}>
                  {t('+ Add empty row')}
                </button>
              </div>
            </>
          )}
        </div>

        {stage === 'review' && (
          <div
            style={{
              display: 'flex',
              justifyContent: 'flex-end',
              gap: 10,
              marginTop: 16,
              paddingTop: 16,
              borderTop: '1px solid var(--surface-border-soft)',
            }}
          >
            <button className="btn btn-secondary" onClick={onClose}>
              {t('Cancel')}
            </button>
            <button className="btn btn-primary" onClick={confirmAll} disabled={drafts.length === 0 || isSaving}>
              {isSaving ? t('Saving...') : `${t('Confirm all')} (${drafts.length})`}
            </button>
          </div>
        )}
    </Dialog>
  );
}
