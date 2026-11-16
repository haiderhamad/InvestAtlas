import {
  normalizeAppPreferences,
} from '@/lib/preferences/app-preferences';

describe('app preference normalization', () => {
  it('preserves a supported USD display preference', () => {
    expect(normalizeAppPreferences({
      theme: 'light',
      language: 'ar',
      displayCurrency: 'usd',
      accountProfile: {
        signedIn: false,
        fullName: '',
        email: '',
      },
    })).toEqual(expect.objectContaining({
      theme: 'light',
      language: 'ar',
      displayCurrency: 'usd',
    }));
  });

  it('falls back to EUR for unsupported currencies', () => {
    expect(normalizeAppPreferences({ displayCurrency: 'usdt' }))
      .toEqual(expect.objectContaining({ displayCurrency: 'eur' }));
  });
});
