'use client';

import Link from 'next/link';
import { Eye, Plus, Star, Trash2 } from 'lucide-react';
import AppShell from '@/components/layout/app-shell';
import PageQuickStart from '@/components/layout/page-quick-start';
import {
  ASSET_CLASS_BADGE_CLASSES,
  ASSET_CLASS_LABELS,
  ASSET_CLASS_OPTIONS,
  type AssetClass,
} from '@/lib/config/supported-assets';
import { getPersonalAssetConfig as getAssetConfig, getPersonalAssetsByClass as getSupportedAssetsByClass, USER_ASSETS_CHANGE_EVENT } from '@/lib/config/personal-asset-registry';
import {
  WATCHLISTS_STORAGE_EVENT,
  DEFAULT_WATCHLISTS,
  isDemoWatchlistWorkspace,
  readWatchlists,
  writeWatchlists,
  type Watchlist,
} from '@/lib/watchlists/watchlist-store';
import { AssetIcon } from '@/components/ui/asset-icon';
import { useDisplayCurrencyPreference } from '@/lib/preferences/display-currency';
import { fetchCurrentQuoteBatches } from '@/lib/financial-data/quotes/client';
import { useAppTranslation } from '@/lib/i18n/use-app-translation';
import { useEffect, useMemo, useState } from 'react';
import {
  ANONYMOUS_WORKSPACE_MODE_EVENT,
} from '@/lib/demo/workspace-mode';
import { BROWSER_WORKSPACE_CHANGE_EVENT } from '@/lib/storage/workspace-storage';
import { INVESTATLAS_SHOWCASE_SNAPSHOT } from '@/lib/demo/showcase-snapshot';
import { TROY_OUNCE_GRAMS } from '@/lib/metals/metal-purity';

interface PriceSnapshot {
  price: number;
  change24h: number | null;
  changePeriod: '24h' | 'session' | 'unavailable';
}

type WatchlistAssetSummary = {
  name: string;
  assetClass: AssetClass;
};

function resolveWatchlistAsset(
  symbol: string,
  allowDemoSnapshot: boolean,
): WatchlistAssetSummary | undefined {
  const supported = getAssetConfig(symbol);
  if (supported) return supported;
  if (!allowDemoSnapshot) return undefined;

  const demoAsset = INVESTATLAS_SHOWCASE_SNAPSHOT.assets.find(
    (candidate) => candidate.symbol === symbol && candidate.assetClass !== 'cash',
  );
  return demoAsset && demoAsset.assetClass !== 'cash'
    ? { name: demoAsset.name, assetClass: demoAsset.assetClass }
    : undefined;
}

export default function WatchlistsPage() {
  const { t, language } = useAppTranslation();
  const { displayCurrency, formatQuoteMoney } = useDisplayCurrencyPreference();
  const [mounted, setMounted] = useState(false);
  const [watchlists, setWatchlists] = useState<Watchlist[]>(DEFAULT_WATCHLISTS);
  const [watchlistName, setWatchlistName] = useState('');
  const [selectedWatchlistId, setSelectedWatchlistId] = useState(DEFAULT_WATCHLISTS[0]?.id ?? '');
  const [watchlistFilterId, setWatchlistFilterId] = useState<'all' | string>('all');
  const [assetClass, setAssetClass] = useState<AssetClass>('crypto');
  const [assetSymbol, setAssetSymbol] = useState(() => getSupportedAssetsByClass('crypto')[0]?.symbol ?? 'BTC');
  const [prices, setPrices] = useState<Record<string, PriceSnapshot>>({});
  const [isReadOnlyDemo, setIsReadOnlyDemo] = useState(false);
  const [registryRevision, setRegistryRevision] = useState(0);

  useEffect(() => {
    setMounted(true);
    setWatchlists(readWatchlists());
    setIsReadOnlyDemo(isDemoWatchlistWorkspace());
  }, []);

  useEffect(() => {
    const syncWatchlists = () => {
      setWatchlists(readWatchlists());
      setIsReadOnlyDemo(isDemoWatchlistWorkspace());
      setRegistryRevision(value => value + 1);
    };

    window.addEventListener(WATCHLISTS_STORAGE_EVENT, syncWatchlists as EventListener);
    window.addEventListener('storage', syncWatchlists);
    window.addEventListener(ANONYMOUS_WORKSPACE_MODE_EVENT, syncWatchlists);
    window.addEventListener(BROWSER_WORKSPACE_CHANGE_EVENT, syncWatchlists);
    window.addEventListener(USER_ASSETS_CHANGE_EVENT, syncWatchlists);

    return () => {
      window.removeEventListener(WATCHLISTS_STORAGE_EVENT, syncWatchlists as EventListener);
      window.removeEventListener('storage', syncWatchlists);
      window.removeEventListener(ANONYMOUS_WORKSPACE_MODE_EVENT, syncWatchlists);
      window.removeEventListener(BROWSER_WORKSPACE_CHANGE_EVENT, syncWatchlists);
      window.removeEventListener(USER_ASSETS_CHANGE_EVENT, syncWatchlists);
    };
  }, []);

  const allSymbols = useMemo(
    () => [...new Set(watchlists.flatMap((watchlist) => watchlist.symbols))],
    [watchlists],
  );

  useEffect(() => {
    const controller = new AbortController();
    if (allSymbols.length === 0) {
      return;
    }

    const loadPrices = async () => {
      try {
        const data = await fetchCurrentQuoteBatches(allSymbols, displayCurrency, undefined, controller.signal);
        if (!controller.signal.aborted) setPrices(data.prices ?? {});
      } catch {
        if (!controller.signal.aborted) setPrices({});
      }
    };

    void loadPrices();
    return () => controller.abort();
  }, [allSymbols, displayCurrency, registryRevision]);

  const availableAssets = useMemo(() => getSupportedAssetsByClass(assetClass), [assetClass, registryRevision]);
  const selectedWatchlistValue =
    watchlists.some((watchlist) => watchlist.id === selectedWatchlistId) ? selectedWatchlistId : watchlists[0]?.id ?? '';
  const watchlistFilterValue =
    watchlistFilterId === 'all' || watchlists.some((watchlist) => watchlist.id === watchlistFilterId)
      ? watchlistFilterId
      : 'all';
  const filteredWatchlists = useMemo(
    () =>
      watchlistFilterValue === 'all'
        ? watchlists
        : watchlists.filter((watchlist) => watchlist.id === watchlistFilterValue),
    [watchlistFilterValue, watchlists],
  );
  const watchlistRows = useMemo(
    () =>
      filteredWatchlists.flatMap((watchlist) =>
        watchlist.symbols.map((symbol) => ({
          watchlistId: watchlist.id,
          watchlistName: watchlist.name,
          symbol,
          asset: resolveWatchlistAsset(symbol, isReadOnlyDemo),
          price: prices[symbol],
        })),
      ),
    [filteredWatchlists, isReadOnlyDemo, prices, registryRevision],
  );
  const activeFilterWatchlist =
    watchlistFilterValue === 'all'
      ? null
      : watchlists.find((watchlist) => watchlist.id === watchlistFilterValue) ?? null;
  const totalTrackedEntries = useMemo(
    () => watchlists.reduce((total, watchlist) => total + watchlist.symbols.length, 0),
    [watchlists],
  );

  const persistWatchlists = (nextWatchlists: typeof watchlists) => {
    setWatchlists(nextWatchlists);
    writeWatchlists(nextWatchlists);
  };

  const handleAddWatchlist = () => {
    if (!watchlistName.trim()) {
      return;
    }

    const nextWatchlist = {
      id: `watchlist-${Date.now()}`,
      name: watchlistName.trim(),
      symbols: [],
    };

    const nextWatchlists = [...watchlists, nextWatchlist];
    persistWatchlists(nextWatchlists);
    setWatchlistName('');
    setSelectedWatchlistId(nextWatchlist.id);
  };

  const handleAddSymbol = () => {
    if (!selectedWatchlistValue || !assetSymbol) {
      return;
    }

    const nextWatchlists = watchlists.map((watchlist) => {
      if (watchlist.id !== selectedWatchlistValue) {
        return watchlist;
      }

      return {
        ...watchlist,
        symbols: [...new Set([...watchlist.symbols, assetSymbol])],
      };
    });

    persistWatchlists(nextWatchlists);
  };

  const handleDeleteWatchlist = (watchlistId: string) => {
    persistWatchlists(watchlists.filter((watchlist) => watchlist.id !== watchlistId));
  };

  const handleRemoveSymbol = (watchlistId: string, symbol: string) => {
    persistWatchlists(
      watchlists.map((watchlist) =>
        watchlist.id === watchlistId
          ? {
              ...watchlist,
              symbols: watchlist.symbols.filter((entry) => entry !== symbol),
            }
          : watchlist,
      ),
    );
  };

  const demoDisplayText = (text: string) => isReadOnlyDemo ? t(text) : text;
  const formatWatchlistPrice = (price: number, assetClass: AssetClass | undefined) => {
    const isMetal = assetClass === 'metal';
    return `${formatQuoteMoney(isMetal ? price / TROY_OUNCE_GRAMS : price, displayCurrency.toUpperCase(), language)}${isMetal ? '/g' : ''}`;
  };

  return (
    <AppShell>
      <div className="page-header">
        <div className="page-header-main">
          <h1 className="page-title">
            <Eye size={24} style={{ display: 'inline', marginRight: 8 }} />
            {t('Watchlists')}
          </h1>
        </div>
      </div>

      <div className="page-content animate-in">

        {isReadOnlyDemo ? (
          <div className="card" role="status" style={{ marginBottom: 20 }}>
            <strong>{t('Demo watchlist')}</strong>{' '}
            <span style={{ color: 'var(--text-secondary)' }}>
              {t('This synthetic showcase watchlist is read-only. Start a Local Workspace to create your own lists.')}
            </span>
          </div>
        ) : null}


        <div className="grid-2" hidden={isReadOnlyDemo}>
          <div className="card">
            <div className="panel-header">
              <div>
                <div className="section-title">{t('Create Watchlist')}</div>
                <div className="panel-subtitle">{t('Unlimited lists for ideas, sectors, or asset categories.')}</div>
              </div>
               <span className="badge badge-blue">
                {mounted ? t(`${watchlists.length} lists`) : '—'}
              </span>
            </div>

            <div style={{ display: 'grid', gap: 12 }}>
              <div>
                <label className="label">{t('Watchlist Name')}</label>
                <input
                  className="input"
                  value={watchlistName}
                  onChange={(event) => setWatchlistName(event.target.value)}
                  placeholder={t('e.g. Dividend ideas')}
                  disabled={isReadOnlyDemo}
                />
              </div>
              <button className="btn btn-primary" onClick={handleAddWatchlist} disabled={isReadOnlyDemo}>
                <Plus size={15} />
                {t('Add Watchlist')}
              </button>
            </div>
          </div>

          <div className="card">
            <div className="panel-header">
              <div>
                <div className="section-title">{t('Add Asset')}</div>
                <div className="panel-subtitle">{t('Pick a list, then add any supported asset.')}</div>
              </div>
            </div>

            <div className="grid-3">
              <div>
                <label className="label">{t('Watchlist')}</label>
                <select
                  className="select"
                  value={selectedWatchlistValue}
                  onChange={(event) => setSelectedWatchlistId(event.target.value)}
                  disabled={watchlists.length === 0 || isReadOnlyDemo}
                >
                  {watchlists.length === 0 ? (
                    <option value="">{t('Create a watchlist first')}</option>
                  ) : (
                    watchlists.map((watchlist) => (
                      <option key={watchlist.id} value={watchlist.id}>
                        {demoDisplayText(watchlist.name)}
                      </option>
                    ))
                  )}
                </select>
              </div>
              <div>
                <label className="label">{t('Asset Class')}</label>
                <select
                  className="select"
                  value={assetClass}
                  disabled={isReadOnlyDemo}
                  onChange={(event) => {
                    const nextClass = event.target.value as AssetClass;
                    setAssetClass(nextClass);
                    setAssetSymbol(getSupportedAssetsByClass(nextClass)[0]?.symbol ?? '');
                  }}
                >
                  {ASSET_CLASS_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {t(option.label)}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label">{t('Asset')}</label>
                <select
                  className="select"
                  value={assetSymbol}
                  onChange={(event) => setAssetSymbol(event.target.value)}
                  disabled={isReadOnlyDemo}
                >
                  {availableAssets.map((asset) => (
                    <option key={asset.symbol} value={asset.symbol}>
                      {asset.symbol} · {asset.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <button
              className="btn btn-secondary"
              style={{ marginTop: 14 }}
              onClick={handleAddSymbol}
              disabled={watchlists.length === 0 || isReadOnlyDemo}
            >
              <Star size={15} />
              {t('Add To Watchlist')}
            </button>
          </div>
        </div>

        <div className="card" style={{ padding: 24 }}>
          <div className="table-toolbar" style={{ marginBottom: 24 }}>
            <div>
              <div className="section-title">{t('Watched Assets')}</div>
              <div className="panel-subtitle">
                {t(isReadOnlyDemo
                  ? 'Review synthetic snapshot prices grouped in the demo watchlist.'
                  : 'Track sourced market prices categorized by your custom watchlists.')}
              </div>
            </div>
            <div className="panel-actions" style={{ alignItems: 'flex-end' }}>
              <label style={{ minWidth: 220 }}>
                <span className="label" style={{ marginBottom: 4 }}>{t('Filter View')}</span>
                <select
                  className="select"
                  value={watchlistFilterValue}
                  onChange={(event) => setWatchlistFilterId(event.target.value)}
                >
                  <option value="all">{t('Show all watchlists')}</option>
                  {watchlists.map((watchlist) => (
                    <option key={watchlist.id} value={watchlist.id}>
                      {demoDisplayText(watchlist.name)}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </div>

          <div className="summary-strip" style={{ marginBottom: 32 }}>
            <div className="summary-item">
              <span>{t('Visible watchlists')}</span>
              <strong>{filteredWatchlists.length}</strong>
            </div>
            <div className="summary-item">
              <span>{t('Visible assets')}</span>
              <strong>{watchlistRows.length}</strong>
            </div>
            <div className="summary-item">
              <span>{t('Unique symbols')}</span>
              <strong>{allSymbols.length}</strong>
            </div>
          </div>

          {filteredWatchlists.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 40 }}>
              {filteredWatchlists.map((watchlist) => {
                const rows = watchlist.symbols.map((symbol) => ({
                  watchlistId: watchlist.id,
                  watchlistName: watchlist.name,
                  symbol,
                  asset: resolveWatchlistAsset(symbol, isReadOnlyDemo),
                  price: prices[symbol],
                }));

                return (
                  <div key={watchlist.id} className="watchlist-group-container">
                    <div className="panel-header" style={{ borderBottom: '1px solid var(--border)', paddingBottom: 16, marginBottom: 0 }}>
                      <div>
                        <div className="section-title" style={{ fontSize: 18 }}>{demoDisplayText(watchlist.name)}</div>
                        <div className="panel-subtitle" style={{ marginTop: 4 }}>
                          {rows.length} {rows.length === 1 ? t('asset tracked') : t('assets tracked')}
                        </div>
                      </div>
                      <button
                        className="btn btn-secondary btn-sm"
                        onClick={() => handleDeleteWatchlist(watchlist.id)}
                        disabled={isReadOnlyDemo}
                        style={{ color: 'var(--red)', borderColor: 'var(--surface-error-border)', background: 'var(--surface-error)' }}
                      >
                        <Trash2 size={14} />
                        {t('Delete List')}
                      </button>
                    </div>

                    {rows.length > 0 ? (
                      <>
                        <div className="table-container desktop-only" style={{ border: 'none', borderRadius: 0 }}>
                          <table>
                            <thead>
                              <tr>
                                <th>{t('Asset')}</th>
                                <th>{t('Class')}</th>
                                <th>{t('Price')}</th>
                                <th>{t('Change')}</th>
                                <th />
                              </tr>
                            </thead>
                            <tbody>
                              {rows.map((row) => (
                                <tr key={`${row.watchlistId}-${row.symbol}`}>
                                  <td>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                                      <AssetIcon
                                        symbol={row.symbol}
                                        name={demoDisplayText(row.asset?.name ?? row.symbol)}
                                        assetClass={row.asset?.assetClass ?? 'stock'}
                                        size={34}
                                      />
                                      <div>
                                        <div style={{ fontWeight: 700 }}>{row.symbol}</div>
                                        {row.asset ? (
                                          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{demoDisplayText(row.asset.name)}</div>
                                        ) : null}
                                      </div>
                                    </div>
                                  </td>
                                  <td>
                                    {row.asset ? (
                                      <span className={`badge ${ASSET_CLASS_BADGE_CLASSES[row.asset.assetClass]}`}>
                                        {t(ASSET_CLASS_LABELS[row.asset.assetClass])}
                                      </span>
                                    ) : (
                                      '—'
                                    )}
                                  </td>
                                  <td className="mono" style={{ fontWeight: 600 }}>
                                    <bdi dir="ltr">{row.price
                                      ? formatWatchlistPrice(row.price.price, row.asset?.assetClass)
                                      : '—'}</bdi>
                                  </td>
                                  <td>
                                    <span
                                      className={`badge ${
                                        row.price?.change24h === null || !row.price
                                          ? 'neutral'
                                          : row.price.change24h >= 0
                                            ? 'badge-green'
                                            : 'badge-red'
                                      }`}
                                    >
                                      {row.price?.change24h === null || !row.price
                                        ? t('Unavailable')
                                        : `${row.price.change24h >= 0 ? '+' : ''}${row.price.change24h.toLocaleString(language === 'de' ? 'de-DE' : language === 'ar' ? 'ar-SA' : 'en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}% · ${t(row.price.changePeriod === 'session' ? 'Session' : '24h')}`}
                                    </span>
                                  </td>
                                  <td style={{ textAlign: 'right' }}>
                                    <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                                      <Link className="btn btn-secondary btn-sm" href={`/charts?asset=${encodeURIComponent(row.symbol)}`}>
                                        {t('Chart')}
                                      </Link>
                                      <button
                                        className="btn btn-secondary btn-sm"
                                        onClick={() => handleRemoveSymbol(row.watchlistId, row.symbol)}
                                        disabled={isReadOnlyDemo}
                                      >
                                        <Trash2 size={14} style={{ color: 'var(--text-muted)' }} />
                                      </button>
                                    </div>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                        <div className="mobile-only" style={{ padding: '16px 0' }}>
                          <div className="mobile-card-list">
                            {rows.map((row) => (
                              <div key={`${row.watchlistId}-${row.symbol}-mobile`} className="mobile-data-card">
                                <div className="mobile-data-card-header">
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                    <AssetIcon
                                      symbol={row.symbol}
                                      name={demoDisplayText(row.asset?.name ?? row.symbol)}
                                      assetClass={row.asset?.assetClass ?? 'stock'}
                                      size={24}
                                    />
                                    <div>
                                      <div className="mobile-data-title">{row.symbol}</div>
                                    <div style={{ color: 'var(--text-muted)', fontSize: 12 }}>
                                      {row.asset ? demoDisplayText(row.asset.name) : ''}
                                    </div>
                                  </div>
                                  {row.asset ? (
                                    <span className={`badge ${ASSET_CLASS_BADGE_CLASSES[row.asset.assetClass]}`}>
                                      {t(ASSET_CLASS_LABELS[row.asset.assetClass])}
                                    </span>
                                  ) : null}
                                </div>
                                <div className="mobile-data-grid">
                                  <div className="mobile-data-row">
                                    <span className="mobile-data-label">{t('Price')}</span>
                                    <span className="mobile-data-value mono" style={{ fontWeight: 600 }}>
                                      <bdi dir="ltr">{row.price
                                        ? formatWatchlistPrice(row.price.price, row.asset?.assetClass)
                                        : '—'}</bdi>
                                    </span>
                                  </div>
                                  <div className="mobile-data-row">
                                    <span className="mobile-data-label">
                                      {t(row.price?.changePeriod === 'session' ? 'Session' : row.price?.changePeriod === '24h' ? '24h' : 'Change')}
                                    </span>
                                    <span
                                      className="mobile-data-value mono"
                                      style={{
                                        color: row.price?.change24h === null || !row.price
                                          ? 'var(--text-muted)'
                                          : row.price.change24h >= 0
                                            ? 'var(--green)'
                                            : 'var(--red)',
                                      }}
                                    >
                                      {row.price?.change24h === null || !row.price
                                        ? t('Unavailable')
                                        : `${row.price.change24h >= 0 ? '+' : ''}${row.price.change24h.toLocaleString(language === 'de' ? 'de-DE' : language === 'ar' ? 'ar-SA' : 'en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`}
                                    </span>
                                  </div>
                                </div>
                                <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
                                  <Link className="btn btn-secondary btn-sm" style={{ flex: 1, justifyContent: 'center' }} href={`/charts?asset=${encodeURIComponent(row.symbol)}`}>
                                    {t('Chart')}
                                  </Link>
                                  <button
                                    className="btn btn-secondary btn-sm"
                                    onClick={() => handleRemoveSymbol(row.watchlistId, row.symbol)}
                                    disabled={isReadOnlyDemo}
                                    style={{ color: 'var(--red)' }}
                                  >
                                    <Trash2 size={14} />
                                  </button>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                        </div>
                      </>
                    ) : (
                      <div className="empty-state" style={{ margin: '24px 0', background: 'var(--surface-soft)' }}>
                        {t('No assets in this watchlist yet. Use the panel above to add some.')}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="empty-state" style={{ margin: '0' }}>
              {t('No watchlists available. Create your first list above.')}
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}
