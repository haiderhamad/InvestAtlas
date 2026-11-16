import { getFinancialDataProviders } from '@/lib/financial-data/providers/catalog';
import {
  resolvePersonalFinancialProviderAvailability,
  resolvePersonalProviderHintMode,
} from '@/lib/financial-data/providers/personal-provider-availability';

describe('personal financial provider availability', () => {
  it('keeps personal Tiingo BYOK connectable in every deployment', () => {
    expect(
      resolvePersonalFinancialProviderAvailability(
        getFinancialDataProviders('development'),
      ),
    ).toBe(true);
    expect(
      resolvePersonalFinancialProviderAvailability(
        getFinancialDataProviders('preview'),
      ),
    ).toBe(true);
    expect(
      resolvePersonalFinancialProviderAvailability(
        getFinancialDataProviders('production'),
      ),
    ).toBe(true);
  });

  it.each([
    { providers: [] },
    { providers: [{}] },
    { providers: [{ id: 'tiingo_browser_byok', isActive: 'false' }] },
    { providers: [{ id: 'other_provider', isActive: true }] },
  ])('keeps malformed or incomplete catalog data unknown', ({ providers }) => {
    expect(resolvePersonalFinancialProviderAvailability(providers)).toBeNull();
  });

  it('shows an informational hosted-off notice even for a legacy connection', () => {
    expect(resolvePersonalProviderHintMode({
      isSignedIn: true,
      pathname: '/',
      providerAvailability: false,
      hasConnection: true,
      dismissed: false,
    })).toBe('hosted_unavailable');
  });

  it('offers connection only when the adapter is active and no key exists', () => {
    expect(resolvePersonalProviderHintMode({
      isSignedIn: true,
      pathname: '/',
      providerAvailability: true,
      hasConnection: false,
      dismissed: false,
    })).toBe('connect');
  });

  it('fails closed while availability is unknown and respects dismissal', () => {
    expect(resolvePersonalProviderHintMode({
      isSignedIn: true,
      pathname: '/',
      providerAvailability: null,
      hasConnection: false,
      dismissed: false,
    })).toBeNull();
    expect(resolvePersonalProviderHintMode({
      isSignedIn: true,
      pathname: '/',
      providerAvailability: false,
      hasConnection: false,
      dismissed: null,
    })).toBeNull();
    expect(resolvePersonalProviderHintMode({
      isSignedIn: true,
      pathname: '/',
      providerAvailability: false,
      hasConnection: false,
      dismissed: true,
    })).toBeNull();
  });
});
