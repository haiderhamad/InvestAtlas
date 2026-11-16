import { getAssetIconUrl } from '@/lib/config/asset-icon-sources';
import { readFileSync } from 'node:fs';

describe('Licensed display icon source boundaries', () => {
  it('does not load CoinCap or CompaniesMarketCap icons', () => {
    const components = [
      readFileSync('src/components/ui/asset-icon.tsx', 'utf8'),
      readFileSync('src/app/charts/page.tsx', 'utf8'),
      readFileSync('src/lib/config/asset-icon-sources.ts', 'utf8'),
    ];
    for (const source of components) {
      expect(source).not.toContain('assets.coincap.io/assets/icons/');
      expect(source).not.toContain('companiesmarketcap.com/img/company-logos/');
      expect(source).not.toContain('cryptocurrency-icons@master');
      expect(source).not.toContain('/assets/icons/gold.png');
      expect(source).not.toContain('/assets/icons/silver.png');
      // External issuer/crypto image requests must not reveal the current route.
      if (source.includes('<img')) expect(source).toContain('referrerPolicy="no-referrer"');
    }
  });

  it('never requests third-party company or ETF logos, even for known tickers', () => {
    for (const ticker of ['MSFT', 'AAPL', 'META', 'NVDA', 'ISWD', 'HLAL', 'SPUS', 'SPYY']) {
      expect(getAssetIconUrl(ticker, 'stock')).toBeNull();
      expect(getAssetIconUrl(ticker, 'etf')).toBeNull();
    }
    expect(getAssetIconUrl('GOLD', 'metal')).toBeNull();
    expect(getAssetIconUrl('SILVER', 'metal')).toBeNull();
  });

  it('ignores historical custom image URLs in desktop and mobile watchlists', () => {
    const watchlists = readFileSync('src/app/watchlists/page.tsx', 'utf8');
    expect(watchlists).toContain('<AssetIcon');
    expect(watchlists).not.toContain('readAssetIcons');
    expect(watchlists).not.toContain('assetIcons[');
    expect(watchlists).not.toContain('<img');
    expect(watchlists).not.toContain('src={assetIcons');
  });

  it('blocks the legacy logo lookup and does not allow its image destination in CSP', () => {
    const code = readFileSync('src/lib/config/asset-icon-sources.ts', 'utf8');
    const config = readFileSync('next.config.ts', 'utf8');
    expect(code).not.toContain('www.google.com/s2/favicons');
    expect(code).not.toContain('SYMBOL_TO_DOMAIN');
    expect(config).not.toContain("'https://www.google.com',");
  });

  it('builds safe and pinned CC0 URLs only for valid crypto symbols', () => {
    expect(getAssetIconUrl(' btc ', 'crypto'))
      .toBe('https://cdn.jsdelivr.net/npm/cryptocurrency-icons@0.18.1/svg/color/btc.svg');
    expect(getAssetIconUrl('BT+C', 'crypto')).toBeNull();
    expect(getAssetIconUrl('../etc', 'crypto')).toBeNull();
    expect(getAssetIconUrl(' '.repeat(20), 'crypto')).toBeNull();
  });
});
