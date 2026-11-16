/** @jest-environment jsdom */

import { createElement } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { AssetIcon } from '@/components/ui/asset-icon';

describe('asset icon fallback and reusable asset rows', () => {
  afterEach(cleanup);

  it('renders unbranded identifiable stock and ETF tiles without remote images', () => {
    const view = render(createElement(AssetIcon, { symbol: 'AAPL', assetClass: 'stock' }));
    const first = screen.getByRole('img', { name: 'AAPL' });
    expect(first.querySelector('img')).toBeNull();
    expect(screen.getByText('AAPL')).toBeTruthy();

    view.rerender(createElement(AssetIcon, { symbol: 'MSFT', assetClass: 'stock' }));
    const second = screen.getByRole('img', { name: 'MSFT' });
    expect(second.querySelector('img')).toBeNull();
    expect(screen.getByText('MSFT')).toBeTruthy();

    view.rerender(createElement(AssetIcon, { symbol: 'ISWD', assetClass: 'etf', size: 24 }));
    expect(screen.getByRole('img', { name: 'ISWD' }).querySelector('img')).toBeNull();
    expect(screen.getByText('ISWD')).toBeTruthy();
  });

  it('provides an accessible fallback when external imagery fails', () => {
    render(createElement(AssetIcon, {
      symbol: 'AAPL',
      name: 'Apple',
      assetClass: 'stock',
    }));
    const tile = screen.getByRole('img', { name: 'Apple' });
    expect(tile.querySelector('img')).toBeNull();
    expect(screen.getByText('AAPL')).toBeTruthy();
  });

  it('uses the pinned CC0 cryptocurrency icon set, not CoinCap images', () => {
    const view = render(createElement(AssetIcon, { symbol: 'BTC', assetClass: 'crypto' }));
    const first = screen.getByRole('img', { name: 'BTC' });
    expect(first.getAttribute('src')).toBe(
      'https://cdn.jsdelivr.net/npm/cryptocurrency-icons@0.18.1/svg/color/btc.svg',
    );
    fireEvent.error(first);
    expect(screen.getByText('BTC')).toBeTruthy();
    view.rerender(createElement(AssetIcon, { symbol: 'ETH', assetClass: 'crypto' }));
    expect(screen.getByRole('img', { name: 'ETH' }).getAttribute('src'))
      .toContain('/svg/color/eth.svg');
  });

  it.each(['GOLD', 'SILVER'] as const)(
    'uses a locally rendered generic icon for %s without downloading unknown artwork',
    (symbol) => {
      render(createElement(AssetIcon, { symbol, assetClass: 'metal' }));
      const icon = screen.getByRole('img', { name: symbol });
      expect(icon.querySelector('svg')).not.toBeNull();
      expect(icon.querySelector('img')).toBeNull();
    },
  );

  it('keeps category icons meaningfully named for assistive technologies', () => {
    render(createElement(AssetIcon, { symbol: 'ETF', assetClass: 'etf' }));
    expect(screen.getByRole('img', { name: 'ETFs' })).toBeTruthy();
  });
});
