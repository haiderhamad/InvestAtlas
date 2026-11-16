'use client';

import { Droplet, RotateCcw, ExternalLink, HelpCircle } from 'lucide-react';
import { useEffect, useState } from 'react';

import { SUPPORTED_ETF_ASSETS, type EtfPurificationConfig } from '@/lib/config/supported-assets';
import {
  DEFAULT_PURIFICATION_SETTINGS,
  PURIFICATION_SETTINGS_EVENT,
  readPurificationSettings,
  setEtfOverride,
  setStockMethod,
  setStockRatio,
  type PurificationSettings,
  type StockPurificationMethod,
} from '@/lib/purification/purification-store';
import { calculatePurification, type PurificationOverview } from '@/lib/tax/purification';
import { getAllTransactions, MANUAL_TRANSACTIONS_EVENT, type AppTransaction } from '@/lib/transactions/manual-store';
import { useDisplayCurrencyPreference } from '@/lib/preferences/display-currency';

import { useAppTranslation } from '@/lib/i18n/use-app-translation';

function resolveEtfConfig(
  symbol: string,
  settings: PurificationSettings,
): EtfPurificationConfig | undefined {
  const override = settings.etfOverrides[symbol];
  if (override) return override;
  return SUPPORTED_ETF_ASSETS.find((asset) => asset.symbol === symbol)?.purification;
}

function buildInitialRateInputs(settings: PurificationSettings): Record<string, string> {
  const inputs: Record<string, string> = {};
  for (const asset of SUPPORTED_ETF_ASSETS) {
    const resolved = resolveEtfConfig(asset.symbol, settings);
    inputs[asset.symbol] =
      typeof resolved?.perSharePurificationNative === 'number'
        ? resolved.perSharePurificationNative.toFixed(5)
        : '';
  }
  return inputs;
}

export default function PurificationPanel() {
  const { t } = useAppTranslation();
  const [settings, setSettings] = useState<PurificationSettings>(DEFAULT_PURIFICATION_SETTINGS);
  const [ratioInput, setRatioInput] = useState<string>(
    () => (DEFAULT_PURIFICATION_SETTINGS.stockImpermissibleIncomeRatio * 100).toFixed(2),
  );
  const { formatMoney } = useDisplayCurrencyPreference();
  const [rateInputs, setRateInputs] = useState<Record<string, string>>(
    () => buildInitialRateInputs(DEFAULT_PURIFICATION_SETTINGS),
  );
  const [mounted, setMounted] = useState(false);
  const [transactions, setTransactions] = useState<AppTransaction[]>([]);

  // Manual Calculator State
  const [calcAmount, setCalcAmount] = useState<number>(1000);
  const [calcType, setCalcType] = useState<'stock' | 'etf'>('stock');
  const [calcEtfSymbol, setCalcEtfSymbol] = useState<string>('ISWD');
  const [calcRatio, setCalcRatio] = useState<number>(5);

  useEffect(() => {
    setMounted(true);

    const loadSettings = () => {
      const updated = readPurificationSettings();
      setSettings(updated);
      setRatioInput((updated.stockImpermissibleIncomeRatio * 100).toFixed(2));
      setRateInputs(buildInitialRateInputs(updated));
    };

    loadSettings();
    setTransactions(getAllTransactions());

    const handler = () => {
      const updated = readPurificationSettings();
      setSettings(updated);
      setRatioInput((updated.stockImpermissibleIncomeRatio * 100).toFixed(2));
      setRateInputs(buildInitialRateInputs(updated));
    };

    const syncTransactions = () => setTransactions(getAllTransactions());

    window.addEventListener(PURIFICATION_SETTINGS_EVENT, handler as EventListener);
    window.addEventListener(MANUAL_TRANSACTIONS_EVENT, syncTransactions as EventListener);
    window.addEventListener('storage', syncTransactions);

    return () => {
      window.removeEventListener(PURIFICATION_SETTINGS_EVENT, handler as EventListener);
      window.removeEventListener(MANUAL_TRANSACTIONS_EVENT, syncTransactions as EventListener);
      window.removeEventListener('storage', syncTransactions);
    };
  }, []);

  const commitRatio = () => {
    const parsed = Number.parseFloat(ratioInput.replace(',', '.'));
    if (Number.isFinite(parsed)) {
      setSettings(setStockRatio(parsed / 100));
    }
  };

  const handleMethodChange = (method: StockPurificationMethod) => {
    setSettings(setStockMethod(method));
  };

  const handleSelfPurifiedToggle = (symbol: string, current: EtfPurificationConfig | undefined) => {
    const nextSelf = !(current?.selfPurified ?? false);
    const next: EtfPurificationConfig = {
      selfPurified: nextSelf,
      perSharePurificationNative: nextSelf ? undefined : current?.perSharePurificationNative,
      ratePeriod: nextSelf ? String(new Date().getFullYear()) : current?.ratePeriod,
      source: nextSelf
        ? 'User confirmed issuer purification'
        : current?.source,
    };
    setSettings(setEtfOverride(symbol, next));
  };

  const handleRateCommit = (symbol: string, current: EtfPurificationConfig | undefined) => {
    const raw = rateInputs[symbol] ?? '';
    if (raw.trim() === '') {
      const next: EtfPurificationConfig = {
        selfPurified: current?.selfPurified ?? false,
        perSharePurificationNative: undefined,
        ratePeriod: current?.ratePeriod,
        source: current?.source,
      };
      setSettings(setEtfOverride(symbol, next));
      return;
    }
    const parsed = Number.parseFloat(raw.replace(',', '.'));
    if (!Number.isFinite(parsed) || parsed < 0) return;
    const next: EtfPurificationConfig = {
      selfPurified: current?.selfPurified ?? false,
      perSharePurificationNative: parsed,
      ratePeriod: current?.ratePeriod,
      source: current?.source,
    };
    setSettings(setEtfOverride(symbol, next));
  };

  const handleReset = (symbol: string) => {
    const updated = setEtfOverride(symbol, null);
    setSettings(updated);
    const seed = SUPPORTED_ETF_ASSETS.find((asset) => asset.symbol === symbol)?.purification;
    setRateInputs((prev) => ({
      ...prev,
      [symbol]:
        typeof seed?.perSharePurificationNative === 'number'
          ? seed.perSharePurificationNative.toFixed(5)
          : '',
    }));
  };

  const formatPurificationValue = (value: number | null) =>
    value === null ? t('Unavailable — insufficient data') : formatMoney(value);

  const calculateManualDonation = (): number | null => {
    if (calcType === 'stock') {
      return calcAmount * (calcRatio / 100);
    }

    const etf = resolveEtfConfig(calcEtfSymbol, settings);
    if (
      etf?.selfPurified &&
      etf.ratePeriod?.startsWith(String(new Date().getFullYear())) &&
      etf.source?.trim()
    ) {
      return 0;
    }
    if (etf?.selfPurified) return null;
    if (typeof etf?.perSharePurificationNative !== 'number') return null;
    const baseAsset = SUPPORTED_ETF_ASSETS.find((asset) => asset.symbol === calcEtfSymbol);
    if (etf.perSharePurificationNative === 0) return 0;
    if (baseAsset?.nativeCurrency !== 'eur') return null;
    return calcAmount * etf.perSharePurificationNative;
  };

  return (
    <div className="card">
      <div className="panel-header">
        <div>
          <div className="section-title" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Droplet size={16} style={{ color: 'var(--accent-blue)' }} />
            {t('Purification settings')}
          </div>
          <div className="panel-subtitle">
            {t('Configure how the Tax page calculates interest purification for ETFs and individual stocks. This determines the donation amount for Shariah compliance.')}
          </div>
        </div>
      </div>

      {mounted && (
        <>
          {(() => {
            const currentYear = new Date().getFullYear();
            const overview = calculatePurification(transactions, settings, currentYear);
            
            return (
              <div className="card" style={{ marginBottom: 24, border: '1px solid var(--border-accent)', background: 'linear-gradient(145deg, var(--bg-card), rgba(79, 140, 255, 0.05))' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                  <div style={{ fontWeight: 700, fontSize: 16 }}>{t('Portfolio Summary')} ({currentYear})</div>
                  <span className="badge badge-teal" style={{ fontSize: 16, padding: '4px 10px' }}>
                    {formatPurificationValue(overview.grandTotalEur)}
                  </span>
                </div>
                {overview.grandTotalEur === null && (
                  <div className="callout warn" style={{ marginBottom: 16 }}>
                    {t('A precise purification total is unavailable because a required rate, source period, confirmation, or FX conversion is missing.')}
                  </div>
                )}
                
                <div className="grid-2" style={{ gap: 16 }}>
                  <div style={{ background: 'var(--bg-elevated)', padding: 16, borderRadius: 8 }}>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>{t('Stocks Purification')}</div>
                    <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 12 }}>
                      {formatPurificationValue(overview.stocks.purificationEur)}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                      {overview.stocks.method === 'dividends' ? t('Based on dividends') : t('Based on holdings')} ({overview.stocks.ratio * 100}%)
                    </div>
                  </div>
                  
                  <div style={{ background: 'var(--bg-elevated)', padding: 16, borderRadius: 8 }}>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>{t('ETFs Purification')}</div>
                    <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 12 }}>
                      {formatPurificationValue(overview.etfTotalEur)}
                    </div>
                    {overview.etfRows.length > 0 ? (
                      <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                        {overview.etfRows.map(row => (
                          <div key={row.symbol} style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
                            <span>{row.symbol}</span>
                            <span>{formatPurificationValue(row.purificationEur)}</span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{t('No relevant ETFs found in portfolio.')}</div>
                    )}
                  </div>
                </div>
              </div>
            );
          })()}

          <div className="card" style={{ background: 'var(--bg-primary)', marginBottom: 16 }}>
            <div style={{ fontWeight: 700, marginBottom: 10 }}>{t('Stock purification')}</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16, alignItems: 'end' }}>
              <div>
                <label className="label">{t('Method')}</label>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    className={`btn btn-sm ${settings.stockPurificationMethod === 'dividends' ? 'btn-primary' : 'btn-secondary'}`}
                    onClick={() => handleMethodChange('dividends')}
                  >
                    {t('Dividends received')}
                  </button>
                  <button
                    className={`btn btn-sm ${settings.stockPurificationMethod === 'holdings' ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => handleMethodChange('holdings')}
              >
                {t('Holdings value')}
              </button>
            </div>
          </div>
          <div>
            <label className="label">{t('Impermissible income ratio (%)')}</label>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6 }}>
              {t('This is the percentage of income considered non-compliant. Common default: 5%. Check your screening provider for the exact ratio.')}
            </div>
            <input
              className="input"
              type="number"
              min={0}
              max={100}
              step={0.01}
              value={ratioInput}
              onChange={(event) => setRatioInput(event.target.value)}
              onBlur={commitRatio}
              onKeyDown={(event) => event.key === 'Enter' && commitRatio()}
              style={{ maxWidth: 140 }}
            />
          </div>
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 10 }}>
          {t('Dividends: ratio is applied to the sum of stock dividends received in the selected tax year.')}
          <br />
          {t('Holdings: ratio is applied to the total EUR cost basis of stock positions open at year-end.')}
        </div>
      </div>

      <div className="card" style={{ background: 'var(--bg-primary)' }}>
        <div style={{ fontWeight: 700, marginBottom: 10 }}>{t('ETF purification overrides')}</div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 12 }}>
          {t('If the issuer handles purification internally (e.g. Wahed, SP Funds), toggle')} <em>{t('Self-purified')}</em>.
          {t('For others (e.g. iShares Islamic), enter the per-share rate from the fund\'s distribution report.')}
          {t('The app multiplies this rate by your shares held to calculate your donation.')}
        </div>
        <div className="table-container">
          <table>
            <thead>
              <tr>
                <th>{t('Symbol')}</th>
                <th>{t('Name')}</th>
                <th style={{ textAlign: 'center' }}>{t('Self-purified')}</th>
                <th style={{ textAlign: 'right' }}>{t('Rate / share')}</th>
                <th>{t('Native')}</th>
                <th style={{ textAlign: 'right', paddingRight: 12 }}>{t('Source')}</th>
                <th style={{ width: 32 }} />
              </tr>
            </thead>
            <tbody>
              {SUPPORTED_ETF_ASSETS.map((asset) => {
                const override = settings.etfOverrides[asset.symbol];
                const resolved = override ?? asset.purification;
                const isOverridden = Boolean(override);
                return (
                  <tr key={asset.symbol}>
                    <td className="mono" style={{ fontWeight: 700 }}>
                      {asset.symbol}
                    </td>
                    <td style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{asset.name}</td>
                    <td style={{ textAlign: 'center' }}>
                      <input
                        type="checkbox"
                        checked={resolved?.selfPurified ?? false}
                        onChange={() => handleSelfPurifiedToggle(asset.symbol, resolved)}
                      />
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <input
                        className="input mono"
                        type="number"
                        min={0}
                        step={0.00001}
                        disabled={resolved?.selfPurified ?? false}
                        value={rateInputs[asset.symbol] ?? ''}
                        onChange={(event) =>
                          setRateInputs((prev) => ({ ...prev, [asset.symbol]: event.target.value }))
                        }
                        onBlur={() => handleRateCommit(asset.symbol, resolved)}
                        onKeyDown={(event) =>
                          event.key === 'Enter' && handleRateCommit(asset.symbol, resolved)
                        }
                        placeholder="—"
                        style={{ maxWidth: 110, textAlign: 'right', fontSize: 12 }}
                      />
                    </td>
                    <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                      {asset.nativeCurrency.toUpperCase()}
                    </td>
                    <td
                      style={{
                        textAlign: 'right',
                        fontSize: 11,
                        color: 'var(--text-muted)',
                        paddingRight: 12,
                      }}
                    >
                      {resolved?.source ?? '—'}
                      {resolved?.ratePeriod ? ` · ${resolved.ratePeriod}` : ''}
                    </td>
                    <td style={{ textAlign: 'center' }}>
                      {isOverridden ? (
                        <button
                          onClick={() => handleReset(asset.symbol)}
                          title={t('Reset to default')}
                          style={{
                            background: 'none',
                            border: 'none',
                            cursor: 'pointer',
                            color: 'var(--text-muted)',
                            padding: 4,
                            borderRadius: 4,
                          }}
                        >
                          <RotateCcw size={14} />
                        </button>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card" style={{ background: 'var(--bg-primary)', marginBottom: 24 }}>
        <div style={{ fontWeight: 700, marginBottom: 10 }}>{t('Manual Calculator')}</div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 16 }}>
          {t('Calculate purification for assets not in your portfolio. Select type, enter amount/units and get the required donation amount.')}
        </div>
        
        <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <div>
            <label className="label">{t('Asset Type')}</label>
            <select className="select" value={calcType} onChange={e => setCalcType(e.target.value as 'stock' | 'etf')} style={{ minWidth: 120 }}>
              <option value="stock">{t('Stock')}</option>
              <option value="etf">{t('ETF')}</option>
            </select>
          </div>
          
          {calcType === 'stock' ? (
            <>
              <div>
                <label className="label">{t('Value / Dividend (€)')}</label>
                <input type="number" className="input" value={calcAmount} onChange={e => setCalcAmount(Number(e.target.value))} style={{ maxWidth: 140 }} />
              </div>
              <div>
                <label className="label">{t('Imp. Ratio (%)')}</label>
                <input type="number" className="input" value={calcRatio} onChange={e => setCalcRatio(Number(e.target.value))} style={{ maxWidth: 100 }} />
              </div>
            </>
          ) : (
            <>
              <div>
                <label className="label">{t('ETF')}</label>
                <select className="select" value={calcEtfSymbol} onChange={e => setCalcEtfSymbol(e.target.value)}>
                  {SUPPORTED_ETF_ASSETS.map(etf => (
                    <option key={etf.symbol} value={etf.symbol}>{etf.symbol} - {etf.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label">{t('Shares Owned')}</label>
                <input type="number" className="input" value={calcAmount} onChange={e => setCalcAmount(Number(e.target.value))} style={{ maxWidth: 140 }} />
              </div>
            </>
          )}
          
          <div style={{ padding: '12px 16px', background: 'var(--bg-elevated)', borderRadius: 8, minWidth: 160, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
            <span style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase' }}>{t('Donation Amount')}</span>
            <span style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-primary)' }}>
              {formatPurificationValue(calculateManualDonation())}
            </span>
          </div>
        </div>
      </div>
      <div style={{ marginTop: 24, paddingTop: 16, borderTop: '1px solid var(--border-soft)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, fontWeight: 700, fontSize: 13, color: 'var(--text-secondary)' }}>
          <HelpCircle size={14} />
          {t('Where do I find these numbers?')}
        </div>
        <div className="grid-2" style={{ gap: 16 }}>
          <div className="card" style={{ padding: 12, background: 'var(--surface-accent-soft)', border: 'none' }}>
            <div style={{ fontWeight: 600, fontSize: 12, marginBottom: 4 }}>{t('For individual stocks')}</div>
            <p style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 8, lineHeight: 1.4 }}>
              {t('Use screening apps like Zoya or Musaffa to check the "Impermissible Income" or "Interest income" ratio for your holdings.')}
            </p>
            <div style={{ display: 'flex', gap: 12 }}>
              <a href="https://zoya.finance" target="_blank" rel="noopener noreferrer" className="link-standard" style={{ fontSize: 11, display: 'flex', alignItems: 'center', gap: 8 }}>
                Zoya <ExternalLink size={10} />
              </a>
              <a href="https://musaffa.com" target="_blank" rel="noopener noreferrer" className="link-standard" style={{ fontSize: 11, display: 'flex', alignItems: 'center', gap: 8 }}>
                Musaffa <ExternalLink size={10} />
              </a>
            </div>
          </div>
          <div className="card" style={{ padding: 12, background: 'var(--surface-accent-soft)', border: 'none' }}>
            <div style={{ fontWeight: 600, fontSize: 12, marginBottom: 4 }}>{t('For Islamic ETFs')}</div>
            <p style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 8, lineHeight: 1.4 }}>
              {t('Search for "Purification" in the latest fund distribution report from iShares or SP Funds to get the exact rate per share.')}
            </p>
            <div style={{ display: 'flex', gap: 12 }}>
              <a href="https://www.blackrock.com/uk/individual/products/251394/ishares-msci-world-islamic-ucits-etf" target="_blank" rel="noopener noreferrer" className="link-standard" style={{ fontSize: 11, display: 'flex', alignItems: 'center', gap: 8 }}>
                iShares Reports <ExternalLink size={10} />
              </a>
            </div>
          </div>
        </div>
      </div>
        </>
      )}
    </div>
  );
}
