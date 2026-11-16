import {
  availableField,
  createMoney,
  deriveResultStatus,
  unavailableField,
  type DataField,
} from '@/lib/financial-data/contracts';

const provenance = {
  providerId: 'ecb_reference_rates',
  providerName: 'European Central Bank',
  retrievedAt: '2026-07-31T16:00:00.000Z',
  publicSourceUrl: 'https://data.ecb.europa.eu/',
};

describe('financial-data contract', () => {
  it('keeps available and unavailable values structurally distinct', () => {
    const available = availableField(42, {
      quality: 'reported',
      freshness: 'fresh',
      observedAt: null,
      asOf: '2026-07-31',
      provenance,
    });
    const unavailable = unavailableField('not_provided');

    expect(available).toEqual(expect.objectContaining({
      status: 'available',
      value: 42,
    }));
    expect(unavailable).toEqual({
      status: 'unavailable',
      reason: 'not_provided',
    });
    expect('value' in unavailable).toBe(false);
  });

  it('requires an explicit supported currency for money', () => {
    expect(createMoney(125.5, 'EUR')).toEqual({
      amount: 125.5,
      currency: 'EUR',
    });
    expect(() => createMoney(125.5, 'USDT' as 'USD')).toThrow(
      'Unsupported money currency',
    );
    expect(() => createMoney(Number.NaN, 'EUR')).toThrow(
      'Invalid money amount',
    );
  });

  it('derives complete, partial and unavailable results deterministically', () => {
    const present = availableField(1, {
      quality: 'observed',
      freshness: 'fresh',
      observedAt: '2026-07-31T15:30:00.000Z',
      asOf: null,
      provenance,
    });
    const missing = unavailableField('provider_unavailable');

    expect(deriveResultStatus([present])).toBe('complete');
    expect(deriveResultStatus([present, missing])).toBe('partial');
    expect(deriveResultStatus([missing])).toBe('unavailable');
  });

  it('treats stale fields as partial even when a value remains usable', () => {
    const stale: DataField<number> = availableField(1.14, {
      quality: 'reported',
      freshness: 'stale',
      observedAt: null,
      asOf: '2026-07-24',
      provenance,
    });

    expect(deriveResultStatus([stale])).toBe('partial');
  });
});
