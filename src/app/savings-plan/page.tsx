'use client';

import { formatChartAxis, getChartAxisWidth, getChartDomain } from '@/lib/charts/scale';
import AppShell from '@/components/layout/app-shell';
import PageQuickStart from '@/components/layout/page-quick-start';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Target, Save, Calculator, X, TrendingUp, Loader2 } from 'lucide-react';
import { XAxis, YAxis, Tooltip, Legend, AreaChart, Area, ResponsiveContainer, CartesianGrid } from 'recharts';
import { SUPPORTED_COINS } from '@/lib/config/supported-coins';
import { useAppTranslation } from '@/lib/i18n/use-app-translation';
import { fetchFinancialData } from '@/lib/financial-data/client';
import {
  readWorkspaceStorageItem,
  writeWorkspaceStorageItem,
} from '@/lib/storage/workspace-storage';

type CoinAllocation = { coin: string; percent: number };

type SavedStrategy = {
  id: string;
  name: string;
  budget: number;
  initialCapital?: number;
  allocations: CoinAllocation[];
  dynamicSettings: {
    enabled: boolean;
    aggressiveness: number; // 1 to 3
  };
  takeProfitSettings: {
    enabled: boolean;
    triggerPct: number;
  };
};

type PriceData = {
  price: number;
  ath: number | null;
  athDate: string | null;
  athValDropPct: number | null;
};

export default function SavingsPlanPage() {
  const { t, language } = useAppTranslation();
  // Strategy State
  const [budget, setBudget] = useState<number>(500);
  const [initialCapital, setInitialCapital] = useState<number>(0);
  const [allocations, setAllocations] = useState<CoinAllocation[]>([
    { coin: 'BTC', percent: 50 },
    { coin: 'ETH', percent: 30 },
    { coin: 'SOL', percent: 20 },
  ]);
  const [dynamicDcaEnabled, setDynamicDcaEnabled] = useState(true);
  const [aggressiveness, setAggressiveness] = useState(2); // 1: Mild, 2: Moderate, 3: Aggressive
  const [takeProfitEnabled, setTakeProfitEnabled] = useState(false);
  const [takeProfitTrigger, setTakeProfitTrigger] = useState(100);

  // App State
  const [prices, setPrices] = useState<Record<string, PriceData>>({});
  const [loadingPrices, setLoadingPrices] = useState(false);


  // Fetch Prices
  const fetchPrices = useCallback(async () => {
    setLoadingPrices(true);
    try {
      const symbols = allocations.map(a => a.coin).join(',');
      const res = await fetchFinancialData(`/api/prices/ath?symbols=${symbols}&currency=eur`);
      if (res.ok) {
        const data = await res.json();
        setPrices(data.prices || {});
      }
    } catch (e) {
      console.error('Failed to fetch prices', e);
    }
    setLoadingPrices(false);
  }, [allocations]);

  // Load from local storage
  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      try {
        const saved = readWorkspaceStorageItem('savings_plan_strategy');
        if (saved) {
          const parsed: SavedStrategy = JSON.parse(saved);
          setBudget(parsed.budget || 500);
          setInitialCapital(parsed.initialCapital || 0);
          setAllocations(parsed.allocations || []);
          setDynamicDcaEnabled(parsed.dynamicSettings?.enabled ?? true);
          setAggressiveness(parsed.dynamicSettings?.aggressiveness || 2);
          setTakeProfitEnabled(parsed.takeProfitSettings?.enabled ?? false);
          setTakeProfitTrigger(parsed.takeProfitSettings?.triggerPct || 100);
        }
      } catch (e) {
        console.error('Failed to parse saved strategy', e);
      }
    }, 0);

    return () => window.clearTimeout(timeoutId);
  }, []);



  const handleSaveStrategy = () => {
    const strategy: SavedStrategy = {
      id: 'default',
      name: 'My Savings Plan',
      budget,
      initialCapital,
      allocations,
      dynamicSettings: {
        enabled: dynamicDcaEnabled,
        aggressiveness
      },
      takeProfitSettings: {
        enabled: takeProfitEnabled,
        triggerPct: takeProfitTrigger
      }
    };
    writeWorkspaceStorageItem('savings_plan_strategy', JSON.stringify(strategy));
    alert(t('Strategy saved successfully!'));
  };

  useEffect(() => {
    if (allocations.length > 0) {
      const timeoutId = window.setTimeout(() => {
        void fetchPrices();
      }, 0);

      return () => window.clearTimeout(timeoutId);
    }
  }, [allocations.length, fetchPrices]);

  // Derived Values
  const totalAllocated = allocations.reduce((acc, a) => acc + a.percent, 0);

  // Calculate actual investments based on dynamic multiplier
  const currentMonthInvestmentRaw = useMemo(() => {
    return allocations.map(a => {
      const priceData = prices[a.coin];
      const baseAmount = budget * (a.percent / 100);
      let multiplier = 1.0;

      if (
        dynamicDcaEnabled
        && priceData
        && priceData.athValDropPct !== null
      ) {
        const drop = Math.abs(priceData.athValDropPct);
        // Mild: +0.5x at max drop, Mod: +1.0x at max drop, Aggressive: +2.0x at max drop
        const scaleBase = aggressiveness === 1 ? 0.5 : aggressiveness === 2 ? 1.0 : 2.0;
        multiplier = 1 + (drop / 100) * scaleBase;

        // Cap multiplier between 0.5 (near ATH) and 3.0 (devastating drop)
        if (drop < 5) multiplier = 0.5; // Very close to ATH, buy half
      }

      return {
        coin: a.coin,
        basePercent: a.percent,
        baseAmount,
        multiplier,
        actualAmount: baseAmount * multiplier,
        drop: priceData?.athValDropPct ?? null,
      };
    });
  }, [allocations, budget, prices, dynamicDcaEnabled, aggressiveness]);

  const currentMonthInvestment = useMemo(() => {
    const totalRaw = currentMonthInvestmentRaw.reduce((sum, item) => sum + item.actualAmount, 0);
    let scaleFactor = 1.0;

    // Hard cap the final investment to ensure it NEVER exceeds the user's explicit budget
    if (totalRaw > budget && budget > 0) {
      scaleFactor = budget / totalRaw;
    }

    return currentMonthInvestmentRaw.map(item => ({
      ...item,
      multiplier: item.multiplier * scaleFactor,
      actualAmount: item.actualAmount * scaleFactor
    }));
  }, [currentMonthInvestmentRaw, budget]);

  const totalCalculatedInvestment = currentMonthInvestment.reduce((acc, item) => acc + item.actualAmount, 0);
  const cashReserveRequired = Math.max(0, budget - totalCalculatedInvestment);
  const additionalFundsRequired = Math.max(0, totalCalculatedInvestment - budget);

  // Contributions only. A return forecast requires explicit sourced assumptions
  // and must not be fabricated from an arbitrary growth rate.
  const chartData = useMemo(() => {
    let currentInvested = initialCapital;
    const data = [];

    for (let month = 1; month <= 36; month++) {
      currentInvested += budget;

      data.push({
        month,
        invested: currentInvested,
      });
    }
    return data;
  }, [budget, initialCapital]);

  const numberLocale = language === 'de' ? 'de-DE' : language === 'ar' ? 'ar-SA' : 'en-US';
  const savingsDomain = useMemo(() => getChartDomain(chartData.map(point => point.invested)), [chartData]);

  // Handlers
  const removeCoin = (coin: string) => {
    setAllocations(allocations.filter(a => a.coin !== coin));
  };

  const updateAllocation = (coin: string, pct: number) => {
    setAllocations(allocations.map(a => a.coin === coin ? { ...a, percent: pct } : a));
  };

  const addCoin = (coin: string) => {
    if (!allocations.find(a => a.coin === coin)) {
      setAllocations([...allocations, { coin, percent: 0 }]);
    }
  };

  // Helper
  const formatCur = (v: number) => {
    const locale = language === 'de' ? 'de-DE' : language === 'ar' ? 'ar-SA' : 'en-US';
    return `€${v.toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  return (
    <AppShell>
      <div className="page-header">
        <div className="page-header-row">
          <div className="page-header-main">
            <h1 className="page-title">
              <Target size={24} style={{ display: 'inline', marginInlineEnd: 8 }} />
              {t('Crypto Savings Plan')}
            </h1>
            <div className="page-header-meta">
              <span className="status-pill neutral">{allocations.length} {t('tracked coins')}</span>
              <span className={`status-pill ${dynamicDcaEnabled ? 'success' : 'warn'}`}>
                {dynamicDcaEnabled ? t('Dynamic DCA enabled') : t('Dynamic DCA paused')}
              </span>
            </div>
          </div>
        </div>
      </div>

      <div className="page-content" style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
        <PageQuickStart
          description={t('Build a recurring crypto contribution plan with manual allocations.')}
          steps={[
            t('Define your monthly budget and starting capital.'),
            t('Set your target asset allocation manually.'),
            t('Review source availability; missing ATH data stays unavailable.'),
          ]}
        />

        <div className="dashboard-grid" style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 24 }}>
          {/* LEFT COL: Config */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 24, minWidth: 0 }}>
            <div className="card">
              <div className="panel-header" style={{ marginBottom: 20 }}>
                <div>
                  <h3 className="section-title">{t('Strategy Config')}</h3>
                  <div className="panel-subtitle">{t('Set your baseline numbers.')}</div>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 16, marginBottom: 24 }}>
                <div>
                  <label style={{ display: 'block', fontSize: 11, color: 'var(--text-muted)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 1 }}>
                    {t('Monthly Budget (€)')}
                  </label>
                  <input
                    type="number"
                    value={budget}
                    onChange={(e) => setBudget(Number(e.target.value))}
                    className="input"
                    style={{ width: '100%', padding: '10px 12px', background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text-primary)', fontSize: 14 }}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 11, color: 'var(--text-muted)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 1 }}>
                    {t('Starting Capital (€)')}
                  </label>
                  <input
                    type="number"
                    value={initialCapital}
                    onChange={(e) => setInitialCapital(Number(e.target.value))}
                    className="input"
                    style={{ width: '100%', padding: '10px 12px', background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text-primary)', fontSize: 14 }}
                  />
                </div>
              </div>


              <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 4 }}>
                <label style={{ fontSize: 12, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 1 }}>
                  {t('Coin Allocation')}
                </label>
                <span style={{ fontSize: 12, fontWeight: 600, color: totalAllocated !== 100 ? 'var(--red)' : 'var(--green)' }}>
                  {totalAllocated}%
                </span>
              </div>

              {allocations.map((alloc) => (
                <div key={alloc.coin} className="mobile-allocation-row" style={{ marginBottom: 14 }}>
                  <span style={{ width: 48, flexShrink: 0, fontWeight: 600, fontSize: 13 }}>{alloc.coin}</span>
                  <div className="mobile-allocation-main">
                    <input
                      type="range"
                      min="0" max="100"
                      value={alloc.percent}
                      onChange={(e) => updateAllocation(alloc.coin, Number(e.target.value))}
                      style={{ flex: 1, minWidth: 0, accentColor: 'var(--accent-teal)' }}
                    />
                    <span style={{ width: 36, flexShrink: 0, textAlign: 'right', fontSize: 13, color: 'var(--text-secondary)' }}>
                      {alloc.percent}%
                    </span>
                    <button onClick={() => removeCoin(alloc.coin)} style={{ background: 'none', border: 'none', color: 'var(--red)', cursor: 'pointer', padding: 2, flexShrink: 0 }}>
                      <X size={14} />
                    </button>
                  </div>
                </div>
              ))}

              <select
                className="btn"
                style={{ width: '100%', background: 'var(--bg-elevated)', border: '1px dashed var(--border)', marginTop: 8, appearance: 'none', textAlign: 'center', cursor: 'pointer' }}
                onChange={(e) => {
                  if (e.target.value) {
                    addCoin(e.target.value);
                    e.target.value = '';
                  }
                }}
                defaultValue=""
              >
                <option value="" disabled>+ {t('Add Coin...')}</option>
                {SUPPORTED_COINS.filter(c => !allocations.find(a => a.coin === c.symbol)).map(coin => (
                  <option key={coin.symbol} value={coin.symbol} style={{ color: 'var(--text-primary)', background: 'var(--bg-card)' }}>
                    {coin.name} ({coin.symbol})
                  </option>
                ))}
              </select>

              <div className="callout info" style={{ marginTop: 24 }}>
                <div>
                  <strong>{t('Manual allocation workspace')}.</strong>{' '}
                  {t('AI-generated portfolio allocations are disabled while InvestAtlas defines a stricter evidence and preview workflow.')}
                </div>
              </div>
            </div>

          </div>

          <div className="card" style={{ minWidth: 0 }}>
            <div className="panel-header" style={{ marginBottom: 20 }}>
              <div>
                <h3 className="section-title">{t('Dynamic Rules')}</h3>
                <div className="panel-subtitle">{t('Adjust risk dynamically based on market conditions.')}</div>
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
              <div>
                <span style={{ fontWeight: 500, display: 'block' }}>{t('Dynamic ATH Setup')}</span>
                <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{t('Invest less near ATH, invest more in dips.')}</span>
              </div>
              <label className="toggle-switch">
                <input type="checkbox" checked={dynamicDcaEnabled} onChange={(e) => setDynamicDcaEnabled(e.target.checked)} />
                <span className="slider"></span>
              </label>
            </div>

            {dynamicDcaEnabled && (
              <div style={{ background: 'var(--bg-elevated)', padding: 16, borderRadius: 8, marginBottom: 24, fontSize: 13 }}>
                <label style={{ display: 'block', marginBottom: 8, color: 'var(--text-secondary)' }}>{t('Aggressiveness')}</label>
                <div className="mobile-action-row">
                  <button onClick={() => setAggressiveness(1)} className={`btn ${aggressiveness === 1 ? 'btn-primary' : 'btn-outline'}`} style={{ flex: 1, padding: '8px 4px', fontSize: 12, minWidth: 0 }}>{t('Mild')}</button>
                  <button onClick={() => setAggressiveness(2)} className={`btn ${aggressiveness === 2 ? 'btn-primary' : 'btn-outline'}`} style={{ flex: 1, padding: '8px 4px', fontSize: 12, minWidth: 0 }}>{t('Moderate')}</button>
                  <button onClick={() => setAggressiveness(3)} className={`btn ${aggressiveness === 3 ? 'btn-primary' : 'btn-outline'}`} style={{ flex: 1, padding: '8px 4px', fontSize: 12, minWidth: 0 }}>{t('Aggressive')}</button>
                </div>
              </div>
            )}

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
              <div>
                <span style={{ fontWeight: 500, display: 'block' }}>{t('Take Profits')}</span>
                <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{t('Skim profits as coins rise.')}</span>
              </div>
              <label className="toggle-switch">
                <input type="checkbox" checked={takeProfitEnabled} onChange={(e) => setTakeProfitEnabled(e.target.checked)} />
                <span className="slider"></span>
              </label>
            </div>
          </div>
        </div>


        {/* RIGHT COL: Output & Calculations */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24, minWidth: 0 }}>

          {/* Output Card */}
          <div className="card savings-execution-card">
            <div className="panel-header" style={{ marginBottom: 20 }}>
              <h3 style={{ fontSize: 16, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8 }}>
                <Calculator size={18} style={{ color: 'var(--accent-teal)' }} />
                {t('Dynamic Monthly Execution')}
              </h3>
              <button onClick={handleSaveStrategy} className="btn btn-primary btn-sm">
                <Save size={14} style={{ marginRight: 4 }} /> {t('Save Plan')}
              </button>
            </div>

            {loadingPrices ? (
              <div style={{ padding: '24px 0', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
                <div style={{ position: 'relative', width: 48, height: 48 }}>
                  <Loader2 size={48} className="loading-spin" style={{ color: 'var(--accent-teal)', opacity: 0.6 }} />
                  <Calculator size={20} style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', color: 'var(--accent-teal)' }} />
                </div>
                <div style={{ textAlign: 'center' }}>
                  <span style={{ fontSize: 14, fontWeight: 500, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>{t('Checking available market data…')}</span>
                  <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{t('Unavailable sources stay unavailable; no synthetic prices are used.')}</span>
                </div>
                {/* Skeleton rows */}
                <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 12, marginTop: 4 }}>
                  {[1, 2, 3].map(i => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <div className="skeleton-pulse" style={{ width: 40, height: 14, borderRadius: 4 }} />
                      <div className="skeleton-pulse" style={{ flex: 1, height: 14, borderRadius: 4 }} />
                      <div className="skeleton-pulse" style={{ width: 60, height: 14, borderRadius: 4 }} />
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <>
                <div className="desktop-only" style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', minWidth: 400, fontSize: 13, marginBottom: 20, textAlign: 'left', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr style={{ color: 'var(--text-muted)', borderBottom: '1px solid var(--border)' }}>
                        <th style={{ paddingBottom: 8, fontWeight: 500 }}>{t('Coin')}</th>
                        <th style={{ paddingBottom: 8, fontWeight: 500, textAlign: 'right' }}>{t('ATH Dist')}</th>
                        <th style={{ paddingBottom: 8, fontWeight: 500, textAlign: 'right' }}>{t('Base')}</th>
                        <th style={{ paddingBottom: 8, fontWeight: 500, textAlign: 'right' }}>{t('Multiplier')}</th>
                        <th style={{ paddingBottom: 8, fontWeight: 500, textAlign: 'right' }}>{t('Actual Inv.')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {currentMonthInvestment.map((item) => (
                        <tr key={item.coin} style={{ borderBottom: '1px solid var(--surface-border-soft)' }}>
                          <td style={{ padding: '12px 0', fontWeight: 600 }}>{item.coin}</td>
                          <td style={{ padding: '12px 0', textAlign: 'right', color: item.drop !== null && item.drop < 0 ? 'var(--red)' : 'var(--text-primary)' }}>
                            {item.drop === null
                              ? t('Unavailable')
                              : `${item.drop.toLocaleString(language === 'de' ? 'de-DE' : language === 'ar' ? 'ar-SA' : 'en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`}
                          </td>
                          <td style={{ padding: '12px 0', textAlign: 'right', color: 'var(--text-secondary)' }}>
                            {formatCur(item.baseAmount)}
                          </td>
                          <td style={{ padding: '12px 0', textAlign: 'right', fontWeight: 600, color: item.multiplier > 1.2 ? 'var(--green)' : item.multiplier < 0.8 ? 'var(--red)' : 'var(--text-primary)' }}>
                            {item.multiplier.toFixed(2)}x
                          </td>
                          <td style={{ padding: '12px 0', textAlign: 'right', fontWeight: 700, color: 'var(--accent-teal)' }}>
                            {formatCur(item.actualAmount)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="mobile-card-list mobile-only" style={{ marginBottom: 20 }}>
                  {currentMonthInvestment.map((item) => (
                    <div key={item.coin} className="mobile-data-card">
                      <div className="mobile-data-card-header">
                        <div>
                          <div className="mobile-data-title">{item.coin}</div>
                          <div className="panel-subtitle">
                            {item.drop === null
                              ? t('ATH data unavailable')
                              : `${item.drop.toLocaleString(language === 'de' ? 'de-DE' : language === 'ar' ? 'ar-SA' : 'en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}% ${t('away from all-time high')}`}
                          </div>
                        </div>
                        <span className="badge badge-teal">{item.multiplier.toFixed(2)}x</span>
                      </div>

                      <div className="mobile-data-grid">
                        <div className="mobile-data-row">
                          <span className="mobile-data-label">{t('Base')}</span>
                          <span className="mobile-data-value mono">{formatCur(item.baseAmount)}</span>
                        </div>
                        <div className="mobile-data-row">
                          <span className="mobile-data-label">{t('Actual Invested')}</span>
                          <span className="mobile-data-value mono">{formatCur(item.actualAmount)}</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="stack-mobile" style={{ justifyContent: 'space-between', padding: 16, background: 'var(--bg-elevated)', borderRadius: 8 }}>
                  <div>
                    <span style={{ fontSize: 12, color: 'var(--text-muted)', display: 'block' }}>{t('Calculated Total')}</span>
                    <span style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-primary)' }}>{formatCur(totalCalculatedInvestment)}</span>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <span style={{ fontSize: 12, color: 'var(--text-muted)', display: 'block' }}>{t('Delta vs Budget')}</span>
                    <span style={{ fontSize: 14, fontWeight: 600, color: additionalFundsRequired > 0 ? 'var(--red)' : 'var(--text-primary)' }}>
                      {additionalFundsRequired > 0
                        ? `${t('Requires')} +${formatCur(additionalFundsRequired)}`
                        : `${t('Reserve')}: ${formatCur(cashReserveRequired)}`}
                    </span>
                  </div>
                </div>
              </>
            )}

          </div>

          {/* Contribution schedule */}
          <div className="card">
            <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 20, display: 'flex', alignItems: 'center', gap: 8 }}>
              <TrendingUp size={18} className="text-green-500" />
              {t('Contribution Schedule (3 Years)')}
            </h3>
            <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 16 }}>
              {t('This chart shows contributions only. It does not forecast investment returns.')}
            </p>

            <div style={{ width: '100%', height: 260, marginTop: 16 }}>
              <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                <AreaChart data={chartData} margin={{ top: 0, right: 0, left: -4, bottom: 0 }}>
                  <defs>
                    <linearGradient id="colorIv" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="var(--accent-teal)" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="var(--accent-teal)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="var(--chart-grid)" vertical={false} strokeOpacity={0.4} strokeDasharray="3 3" />
                  <XAxis
                    dataKey="month"
                    stroke="var(--text-muted)"
                    fontSize={11}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(value) => `${t('Month')} ${value}`}
                  />
                  <YAxis
                    tickLine={false}
                    axisLine={false}
                    tick={(props: any) => {
                      const { x, y, payload } = props;
                      const formattedValue = formatChartAxis(Number(payload.value), savingsDomain, numberLocale, { currencySymbol: '€' });
                      return (
                        <g transform={`translate(${x},${y})`}>
                          <text x={language === 'ar' ? 10 : -10} y={4} textAnchor={language === 'ar' ? 'start' : 'end'} fill="var(--text-muted)" fontSize={11}>
                            {formattedValue}
                          </text>
                        </g>
                      );
                    }}
                    orientation={language === 'ar' ? 'right' : 'left'}
                    domain={savingsDomain}
                    width={getChartAxisWidth(savingsDomain, numberLocale, { currencySymbol: '€' })}
                  />
                  <Tooltip
                    wrapperStyle={{ outline: 'none' }}
                    contentStyle={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 8 }}
                    labelFormatter={(value) => `${t('Month')} ${value}`}
                    formatter={(value) => formatCur(Number(value))}
                  />
                  <Legend iconType="circle" wrapperStyle={{ fontSize: 12, paddingTop: 10 }} />
                  <Area type="monotone" name={t('Total Invested')} dataKey="invested" stroke="var(--accent-teal)" strokeWidth={2} fillOpacity={1} fill="url(#colorIv)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>

      </div>


    </AppShell>
  );
}
