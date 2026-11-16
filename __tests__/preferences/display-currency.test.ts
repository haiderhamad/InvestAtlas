import {
  convertEurToDisplayCurrency,
  formatDisplayCurrency,
  formatQuoteCurrency,
  getDisplayCurrencyCode,
  parseEurToUsdFxPayload,
  resolveWorkspaceDisplayCurrency,
} from '@/lib/preferences/display-currency';
import {
  DEFAULT_APP_PREFERENCES,
  readAppPreferences,
  writeAppPreferences,
} from '@/lib/preferences/app-preferences';
import {
  ANONYMOUS_WORKSPACE_MODE_KEY,
} from '@/lib/demo/workspace-mode';
import { resolveBrowserWorkspace } from '@/lib/storage/workspace-storage';

describe('display-currency FX boundary', () => {
  it('keeps the isolated synthetic Demo Snapshot in its source currency', () => {
    expect(resolveWorkspaceDisplayCurrency('usd', null, 'demo_snapshot')).toBe('eur');
    expect(resolveWorkspaceDisplayCurrency('usd', null, 'local_workspace')).toBe('usd');
    expect(resolveWorkspaceDisplayCurrency('usd', 'firebase-user', 'demo_snapshot')).toBe('usd');
  });

  it('shares only presentation preferences with Demo, not Local identity or currency', () => {
    const values = new Map<string, string>();
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        localStorage: {
          getItem: (key: string) => values.get(key) ?? null,
          setItem: (key: string, value: string) => values.set(key, value),
        },
        dispatchEvent: jest.fn(),
      },
    });
    resolveBrowserWorkspace(null);
    values.set(ANONYMOUS_WORKSPACE_MODE_KEY, 'local_workspace');
    writeAppPreferences({
      theme: 'light',
      language: 'ar',
      displayCurrency: 'usd',
      accountProfile: {
        signedIn: true,
        fullName: 'Private Local User',
        email: 'private@example.test',
      },
    });

    values.set(ANONYMOUS_WORKSPACE_MODE_KEY, 'demo_snapshot');
    expect(readAppPreferences()).toEqual({
      theme: 'light',
      language: 'ar',
      displayCurrency: 'eur',
      accountProfile: DEFAULT_APP_PREFERENCES.accountProfile,
    });

    writeAppPreferences({ language: 'en', displayCurrency: 'eur' });
    values.set(ANONYMOUS_WORKSPACE_MODE_KEY, 'local_workspace');
    expect(readAppPreferences()).toMatchObject({
      language: 'en',
      displayCurrency: 'usd',
      accountProfile: {
        fullName: 'Private Local User',
        email: 'private@example.test',
      },
    });
  });

  it('keeps EUR values unchanged without requiring an FX rate', () => {
    expect(convertEurToDisplayCurrency(100, 'eur', null)).toBe(100);
    expect(getDisplayCurrencyCode('eur')).toBe('EUR');
  });

  it('converts EUR to USD only with a finite positive sourced rate', () => {
    expect(convertEurToDisplayCurrency(100, 'usd', 1.15)).toBe(115);
    expect(convertEurToDisplayCurrency(100, 'usd', null)).toBeNull();
    expect(convertEurToDisplayCurrency(100, 'usd', 0)).toBeNull();
    expect(getDisplayCurrencyCode('usd')).toBe('USD');
  });

  it('renders unavailable instead of relabeling EUR as USD', () => {
    expect(formatDisplayCurrency(100, 'usd', null, 'en')).toBe('—');
    expect(formatDisplayCurrency(100, 'usd', null, 'ar')).toBe('—');
    expect(formatDisplayCurrency(100, 'usd', 1.15, 'en')).toBe('$115');
  });

  it('formats already-converted quote values with the active UI locale', () => {
    expect(formatQuoteCurrency(1234.5, 'eur', 'en')).toContain('1,234.50');
    expect(formatQuoteCurrency(1234.5, 'eur', 'de')).toContain('1.234,50');
    expect(formatQuoteCurrency(1234.5, 'eur', 'ar')).toContain('١٬٢٣٤٫٥٠');
  });

  it('accepts only a correctly denominated sourced ECB API response', () => {
    expect(parseEurToUsdFxPayload({
      status: 'complete',
      data: {
        baseCurrency: 'EUR',
        quoteCurrency: 'USD',
        rate: {
          status: 'available',
          value: 1.15,
          freshness: 'fresh',
          asOf: '2026-07-31',
          provenance: { providerId: 'ecb_reference_rates' },
        },
      },
    }, new Date('2026-08-01T12:00:00.000Z'))).toEqual({
      rate: 1.15,
      asOf: '2026-07-31',
      freshness: 'fresh',
    });

    expect(parseEurToUsdFxPayload({
      status: 'complete',
      data: {
        baseCurrency: 'USD',
        quoteCurrency: 'EUR',
        rate: {
          status: 'available',
          value: 0.87,
          provenance: { providerId: 'ecb_reference_rates' },
        },
      },
    })).toBeNull();
    expect(parseEurToUsdFxPayload({
      status: 'complete',
      data: {
        baseCurrency: 'EUR',
        quoteCurrency: 'USD',
        rate: {
          status: 'available',
          value: 1.15,
          provenance: { providerId: 'unknown' },
        },
      },
    })).toBeNull();
  });

  it('recomputes ECB freshness from as-of instead of trusting a cached flag', () => {
    const payload = {
      status: 'complete',
      data: {
        baseCurrency: 'EUR',
        quoteCurrency: 'USD',
        rate: {
          status: 'available',
          value: 1.15,
          freshness: 'fresh',
          asOf: '2026-07-27',
          provenance: { providerId: 'ecb_reference_rates' },
        },
      },
    };

    expect(parseEurToUsdFxPayload(
      payload,
      new Date('2026-07-31T12:00:00.000Z'),
    )).toEqual({
      rate: 1.15,
      asOf: '2026-07-27',
      freshness: 'stale',
    });
  });
});
