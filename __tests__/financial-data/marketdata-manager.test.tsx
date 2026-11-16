/** @jest-environment jsdom */
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MarketDataProviderConnection } from '@/components/settings/marketdata-provider-connection';
import {
  clearMarketData, connectMarketData, hasMarketData,
} from '@/lib/financial-data/providers/marketdata-personal';

jest.mock('@/lib/i18n/use-app-translation', () => ({
  useAppTranslation: () => ({ language: 'de' }),
}));
jest.mock('@/lib/financial-data/providers/marketdata-personal', () => ({
  clearMarketData: jest.fn(), connectMarketData: jest.fn(), hasMarketData: jest.fn(() => false),
}));

describe('owner Market Data preset UI', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(hasMarketData).mockReturnValue(false);
    jest.mocked(connectMarketData).mockResolvedValue();
  });

  it('requires explicit personal license acceptance and never stores token in React state', async () => {
    render(React.createElement(MarketDataProviderConnection, { owner: 'owner-1' }));
    const connect = screen.getByRole('button', { name: 'Market Data API für diesen Tab testen und verbinden' }) as HTMLButtonElement;
    expect(connect.disabled).toBe(true);
    const key = screen.getByLabelText('Mein Market Data API Bearer-Token') as HTMLInputElement;
    expect(key.type).toBe('password');
    fireEvent.input(key, { target: { value: 'sample-personal-marketdata-token' } });
    expect(connect.disabled).toBe(true);
    fireEvent.click(screen.getByRole('checkbox', { name: /Mein eigener Market-Data-Tarif erlaubt/ }));
    expect(connect.disabled).toBe(false);
    fireEvent.click(connect);
    await waitFor(() => {
      expect(connectMarketData).toHaveBeenCalledWith(
        'owner-1', 'sample-personal-marketdata-token', expect.anything(),
      );
    });
    expect(key.value).toBe('');
    expect(clearMarketData).not.toHaveBeenCalled();
  });
});
