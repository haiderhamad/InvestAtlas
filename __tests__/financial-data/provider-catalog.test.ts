import {
  getFinancialDataProviders,
  hasActivePublicFinancialDataProvider,
} from '@/lib/financial-data/providers/catalog';

describe('financial-data provider catalog', () => {
  it('reports that hosted deployments have no active public quote provider', () => {
    expect(hasActivePublicFinancialDataProvider('quote', 'production')).toBe(false);
    expect(hasActivePublicFinancialDataProvider('quote', 'preview')).toBe(false);
    expect(hasActivePublicFinancialDataProvider('quote', 'development')).toBe(true);
    expect(hasActivePublicFinancialDataProvider('fx', 'production')).toBe(true);
  });

  it('records capabilities and usage rights instead of treating public endpoints as licensed', () => {
    const providers = getFinancialDataProviders();
    const alphaVantage = providers.find((provider) => provider.id === 'alpha_vantage_browser_byok');
    const tiingoBrowser = providers.find((provider) => provider.id === 'tiingo_browser_byok');
    const ecb = providers.find((provider) => provider.id === 'ecb_reference_rates');
    const yahoo = providers.find((provider) => provider.id === 'yahoo_finance');
    const coinbase = providers.find((provider) => provider.id === 'coinbase_public');

    expect(alphaVantage).toEqual(expect.objectContaining({
      availability: 'disabled',
      capabilities: expect.arrayContaining(['quote', 'history']),
      publicDisplayStatus: 'review_required',
      redistributionAllowed: null,
      byokOnly: true,
      costModel: 'byok',
      reviewedAt: '2026-08-29',
    }));
    expect(tiingoBrowser).toEqual(expect.objectContaining({
      availability: 'active',
      capabilities: ['quote', 'history'],
      publicDisplayStatus: 'allowed',
      byokOnly: true,
      redistributionAllowed: false,
      attributionRequired: true,
    }));
    expect(ecb).toEqual(expect.objectContaining({
      availability: 'active',
      capabilities: expect.arrayContaining(['fx']),
      publicDisplayStatus: 'allowed',
      attributionRequired: true,
      byokOnly: false,
    }));
    expect(yahoo).toEqual(expect.objectContaining({
      availability: 'local_only',
      publicDisplayStatus: 'permission_required',
      redistributionAllowed: false,
    }));
    expect(coinbase).toEqual(expect.objectContaining({
      availability: 'disabled',
      publicDisplayStatus: 'permission_required',
    }));
  });

  it('returns defensive copies of mutable provider metadata', () => {
    const first = getFinancialDataProviders();
    first[0].capabilities.push('news');

    const second = getFinancialDataProviders();
    expect(second[0].capabilities).not.toContain('news');
  });

  it('does not expose a paid provider as an active default', () => {
    const activeDefaults = getFinancialDataProviders().filter(
      (provider) => provider.isActive && !provider.byokOnly,
    );

    expect(activeDefaults.every((provider) => provider.costModel === 'free_public')).toBe(true);
  });

  it('never activates a permission-required or unresolved shared provider on public hosting', () => {
    const activeProviders = getFinancialDataProviders('production').filter(
      (provider) => provider.isActive,
    );

    expect(
      activeProviders.every(
        (provider) => provider.byokOnly
          || provider.publicDisplayStatus === 'allowed',
      ),
    ).toBe(true);
  });

  it('keeps unresolved market providers off Preview and Production while retaining local diagnostics', () => {
    for (const environment of ['preview', 'production'] as const) {
      const providers = getFinancialDataProviders(environment);
      for (const id of ['yahoo_finance', 'binance_public', 'bitfinex_public', 'coingecko_public', 'tiingo_byok']) {
        expect(providers.find((provider) => provider.id === id)?.isActive).toBe(false);
      }
    }

    const localProviders = getFinancialDataProviders('development');
    for (const id of ['yahoo_finance', 'binance_public', 'bitfinex_public', 'coingecko_public', 'tiingo_byok']) {
      expect(localProviders.find((provider) => provider.id === id)?.isActive).toBe(true);
    }
  });

  it('distinguishes hosted, local-engineering, and disabled catalog entries', () => {
    const providers = getFinancialDataProviders('production');

    expect(providers.find((provider) => provider.id === 'ecb_reference_rates')?.availability).toBe('active');
    expect(providers.find((provider) => provider.id === 'tiingo_byok')?.availability).toBe('local_only');
    expect(providers.find((provider) => provider.id === 'coinbase_public')?.availability).toBe('disabled');
  });

  it('keeps CoinGecko hosted-off while preserving its explicit local terms boundary', () => {
    const coinGecko = getFinancialDataProviders('production').find(
      (provider) => provider.id === 'coingecko_public',
    );

    expect(coinGecko).toEqual(expect.objectContaining({
      isActive: false,
      publicDisplayStatus: 'review_required',
      redistributionAllowed: false,
      attributionRequired: true,
      termsUrl: 'https://www.coingecko.com/en/api_terms',
    }));
  });

  it('exposes direct-browser Tiingo BYOK and ECB while keeping Alpha Vantage and legacy Tiingo hosted-off', () => {
    expect(
      getFinancialDataProviders('production')
        .filter((provider) => provider.isActive)
        .map((provider) => provider.id),
    ).toEqual(['tiingo_browser_byok', 'ecb_reference_rates']);
    expect(getFinancialDataProviders('production').find((p) => p.id === 'alpha_vantage_browser_byok')?.isActive).toBe(false);
    expect(
      getFinancialDataProviders('production').find(
        (provider) => provider.id === 'tiingo_byok',
      ),
    ).toEqual(expect.objectContaining({
      isActive: false,
      publicDisplayStatus: 'permission_required',
      termsUrl: 'https://app.tiingo.com/tos/',
    }));
  });
});
