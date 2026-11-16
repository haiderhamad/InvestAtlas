import {
  DEFAULT_PURIFICATION_SETTINGS,
  setStockRatio,
  type PurificationSettings,
} from '@/lib/purification/purification-store';
import { calculatePurification } from '@/lib/tax/purification';
import type { InvestmentTransaction } from '@/lib/tax/investment-tax';

function transaction(
  overrides: Partial<InvestmentTransaction>,
): InvestmentTransaction {
  return {
    id: overrides.id ?? 'tx',
    date: overrides.date ?? '2026-01-01T00:00:00.000Z',
    venue: overrides.venue ?? 'manual-entry',
    settlementVenue: overrides.settlementVenue,
    type: overrides.type ?? 'buy',
    asset: overrides.asset ?? 'ISWD',
    assetName: overrides.assetName,
    assetClass: overrides.assetClass ?? 'etf',
    quote: overrides.quote ?? 'EUR',
    amount: overrides.amount ?? 10,
    price: overrides.price ?? 10,
    total: overrides.total ?? 100,
    fee: overrides.fee ?? 0,
    taxType: overrides.taxType ?? 'acquisition',
    source: overrides.source ?? 'manual',
  };
}

function settings(
  overrides: Partial<PurificationSettings> = {},
): PurificationSettings {
  return {
    ...DEFAULT_PURIFICATION_SETTINGS,
    ...overrides,
    etfOverrides: overrides.etfOverrides ?? {},
  };
}

describe('calculatePurification', () => {
  test('does not treat an undated issuer purification claim as a known zero', () => {
    const result = calculatePurification(
      [transaction({ asset: 'HLAL', amount: 10 })],
      settings(),
      2026,
    );

    expect(result.etfRows[0]).toEqual(
      expect.objectContaining({
        selfPurified: true,
        status: 'insufficient_data',
        missingReason: 'unverified_self_purification',
        purificationEur: null,
      }),
    );
    expect(result.etfTotalEur).toBeNull();
    expect(result.grandTotalEur).toBeNull();
  });

  test('accepts a dated user confirmation as a known self-purified zero', () => {
    const result = calculatePurification(
      [transaction({ asset: 'HLAL', amount: 10 })],
      settings({
        etfOverrides: {
          HLAL: {
            selfPurified: true,
            ratePeriod: '2026',
            source: 'User confirmed issuer purification',
          },
        },
      }),
      2026,
    );

    expect(result.etfRows[0]).toEqual(
      expect.objectContaining({
        status: 'self_purified',
        purificationEur: 0,
      }),
    );
    expect(result.etfTotalEur).toBe(0);
  });

  test('treats an explicitly sourced zero rate as a known zero', () => {
    const result = calculatePurification(
      [transaction({ asset: 'ISWD', amount: 10 })],
      settings({
        etfOverrides: {
          ISWD: {
            selfPurified: false,
            perSharePurificationNative: 0,
            ratePeriod: '2026',
            source: 'User supplied issuer statement',
          },
        },
      }),
      2026,
    );

    expect(result.etfRows[0]).toEqual(
      expect.objectContaining({
        hasRate: true,
        status: 'calculated',
        purificationEur: 0,
      }),
    );
    expect(result.etfTotalEur).toBe(0);
    expect(result.grandTotalEur).toBe(0);
  });

  test('keeps a missing rate unknown instead of converting it to zero', () => {
    const result = calculatePurification(
      [transaction({ asset: 'ISWD' })],
      settings({
        etfOverrides: {
          ISWD: {
            selfPurified: false,
            ratePeriod: '2026',
            source: 'No rate supplied',
          },
        },
      }),
      2026,
    );

    expect(result.etfRows[0]).toEqual(
      expect.objectContaining({
        hasRate: false,
        status: 'insufficient_data',
        missingReason: 'missing_rate',
        purificationEur: null,
      }),
    );
    expect(result.etfTotalEur).toBeNull();
    expect(result.grandTotalEur).toBeNull();
  });

  test('does not silently reuse a stale issuer rate for another year', () => {
    const result = calculatePurification(
      [transaction({ asset: 'ISWD' })],
      settings(),
      2026,
    );

    expect(result.etfRows[0]).toEqual(
      expect.objectContaining({
        status: 'insufficient_data',
        missingReason: 'stale_rate',
        purificationEur: null,
      }),
    );
  });

  test('does not invent EUR purification for a non-zero USD rate', () => {
    const result = calculatePurification(
      [transaction({ asset: 'HLAL', quote: 'USD' })],
      settings({
        etfOverrides: {
          HLAL: {
            selfPurified: false,
            perSharePurificationNative: 0.25,
            ratePeriod: '2026',
            source: 'User supplied issuer statement',
          },
        },
      }),
      2026,
    );

    expect(result.etfRows[0]).toEqual(
      expect.objectContaining({
        status: 'insufficient_data',
        missingReason: 'missing_fx',
        purificationEur: null,
      }),
    );
  });

  test('requires explicit confirmation before applying the demo stock ratio', () => {
    const stockDividend = transaction({
      id: 'stock-dividend',
      type: 'dividend',
      asset: 'SAP',
      assetClass: 'stock',
      quote: 'EUR',
      amount: 1,
      total: 100,
      taxType: 'dividend_income',
    });

    const unconfirmed = calculatePurification(
      [stockDividend],
      settings(),
      2026,
    );
    const confirmed = calculatePurification(
      [stockDividend],
      settings({ stockRatioConfirmedAt: '2026-01-01T00:00:00.000Z' }),
      2026,
    );

    expect(unconfirmed.stocks).toEqual(
      expect.objectContaining({
        status: 'insufficient_data',
        missingReason: 'unconfirmed_ratio',
        purificationEur: null,
      }),
    );
    expect(unconfirmed.grandTotalEur).toBeNull();
    expect(confirmed.stocks).toEqual(
      expect.objectContaining({
        status: 'calculated',
        basisEur: 100,
        purificationEur: 5,
      }),
    );
  });

  test('does not treat a USD stock dividend as an EUR amount', () => {
    const result = calculatePurification(
      [
        transaction({
          type: 'dividend',
          asset: 'AAPL',
          assetClass: 'stock',
          quote: 'USD',
          total: 100,
          taxType: 'dividend_income',
        }),
      ],
      settings({ stockRatioConfirmedAt: '2026-01-01T00:00:00.000Z' }),
      2026,
    );

    expect(result.stocks).toEqual(
      expect.objectContaining({
        status: 'insufficient_data',
        missingReason: 'missing_fx',
        basisEur: null,
        purificationEur: null,
      }),
    );
    expect(result.grandTotalEur).toBeNull();
  });

  test('keeps an unknown user-defined ETF visible as insufficient data', () => {
    const result = calculatePurification(
      [
        transaction({
          asset: 'CUSTOMETF',
          assetName: 'Custom Ethical ETF',
          amount: 12,
          quote: 'EUR',
        }),
      ],
      settings(),
      2026,
    );

    expect(result.etfRows).toEqual([
      expect.objectContaining({
        symbol: 'CUSTOMETF',
        name: 'Custom Ethical ETF',
        unitsHeld: 12,
        status: 'insufficient_data',
        missingReason: 'unknown_asset',
        purificationEur: null,
      }),
    ]);
    expect(result.etfTotalEur).toBeNull();
    expect(result.grandTotalEur).toBeNull();
  });

  test('does not hide an ETF oversell as a zero holding', () => {
    const result = calculatePurification(
      [
        transaction({
          id: 'buy-five',
          asset: 'ISWD',
          amount: 5,
          total: 50,
        }),
        transaction({
          id: 'sell-ten',
          date: '2026-02-01T00:00:00.000Z',
          type: 'sell',
          asset: 'ISWD',
          amount: 10,
          price: 12,
          total: 120,
          taxType: 'disposal',
        }),
      ],
      settings(),
      2026,
    );

    expect(result.etfRows[0]).toEqual(
      expect.objectContaining({
        symbol: 'ISWD',
        unitsHeld: -5,
        status: 'insufficient_data',
        missingReason: 'invalid_ledger',
        purificationEur: null,
      }),
    );
    expect(result.etfTotalEur).toBeNull();
  });

  test('does not calculate stock purification for a transfer with unknown cost basis', () => {
    const result = calculatePurification(
      [
        transaction({
          id: 'stock-transfer-in',
          type: 'transfer',
          taxType: 'transfer_in',
          asset: 'SAP',
          assetClass: 'stock',
          amount: 10,
          total: 10,
        }),
      ],
      settings({
        stockPurificationMethod: 'holdings',
        stockRatioConfirmedAt: '2026-01-01T00:00:00.000Z',
      }),
      2026,
    );

    expect(result.stocks).toEqual(
      expect.objectContaining({
        status: 'insufficient_data',
        missingReason: 'unknown_cost_basis',
        basisEur: null,
        purificationEur: null,
      }),
    );
    expect(result.grandTotalEur).toBeNull();
  });

  test('does not calculate with a non-finite stock ratio', () => {
    const result = calculatePurification(
      [
        transaction({
          type: 'dividend',
          asset: 'SAP',
          assetClass: 'stock',
          total: 100,
          taxType: 'dividend_income',
        }),
      ],
      settings({
        stockImpermissibleIncomeRatio: Number.NaN,
        stockRatioConfirmedAt: '2026-01-01T00:00:00.000Z',
      }),
      2026,
    );

    expect(Number.isFinite(result.stocks.ratio)).toBe(true);
    expect(result.stocks).toEqual(
      expect.objectContaining({
        status: 'insufficient_data',
        missingReason: 'invalid_ratio',
        purificationEur: null,
      }),
    );
  });

  test('does not confirm a non-finite ratio in the settings store', () => {
    const result = setStockRatio(Number.NaN);

    expect(result.stockImpermissibleIncomeRatio).toBe(
      DEFAULT_PURIFICATION_SETTINGS.stockImpermissibleIncomeRatio,
    );
    expect(result.stockRatioConfirmedAt).toBeUndefined();
  });
});
