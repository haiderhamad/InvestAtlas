import { fetchProvider } from '@/lib/data/provider-fetch';
import {
  convertMoneyWithFx,
  fetchEcbCurrentFx,
  fetchEcbFxHistory,
  resolveHistoricalFx,
} from '@/lib/financial-data/fx/ecb';
import { createSingleEntryZip } from '../test-utils/zip';

jest.mock('@/lib/data/provider-fetch', () => ({
  fetchProvider: jest.fn(),
}));

const mockedFetchProvider = jest.mocked(fetchProvider);

const ECB_HEADER = [
  'KEY',
  'FREQ',
  'CURRENCY',
  'CURRENCY_DENOM',
  'EXR_TYPE',
  'EXR_SUFFIX',
  'TIME_PERIOD',
  'OBS_VALUE',
  'OBS_STATUS',
].join(',');

function ecbCsv(rows: string[]): Response {
  return new Response([ECB_HEADER, ...rows].join('\n'), {
    headers: { 'Content-Type': 'text/csv' },
  });
}

function ecbHistoryCsv(
  rows: string[],
  options: { contentType?: string; fileName?: string } = {},
): Response {
  const csv = [
    'Date,USD,JPY,',
    ...rows,
  ].join('\n');
  return new Response(createSingleEntryZip(csv, options.fileName), {
    headers: {
      'Content-Type': options.contentType ?? 'application/zip',
    },
  });
}

function ecbHistoryArchiveResponse(archive: ArrayBuffer): Response {
  return new Response(archive, {
    headers: { 'Content-Type': 'application/zip' },
  });
}

describe('ECB FX adapter', () => {
  beforeEach(() => {
    mockedFetchProvider.mockReset();
  });

  it('interprets the ECB USD/EUR series as USD per one EUR', async () => {
    mockedFetchProvider.mockResolvedValueOnce(ecbCsv([
      'EXR.D.USD.EUR.SP00.A,D,USD,EUR,SP00,A,2026-07-31,1.1485,A',
    ]));

    const result = await fetchEcbCurrentFx(
      'EUR',
      'USD',
      new Date('2026-07-31T18:00:00.000Z'),
    );

    expect(result.baseCurrency).toBe('EUR');
    expect(result.quoteCurrency).toBe('USD');
    expect(result.rate).toEqual(expect.objectContaining({
      status: 'available',
      value: 1.1485,
      asOf: '2026-07-31',
      quality: 'reported',
    }));
    expect(result.rate.status === 'available' && result.rate.provenance).toEqual(
      expect.objectContaining({
        providerId: 'ecb_reference_rates',
        providerName: 'European Central Bank',
      }),
    );
  });

  it('inverts the official EUR reference rate for USD to EUR', async () => {
    mockedFetchProvider.mockResolvedValueOnce(ecbCsv([
      'EXR.D.USD.EUR.SP00.A,D,USD,EUR,SP00,A,2026-07-31,1.25,A',
    ]));

    const result = await fetchEcbCurrentFx(
      'USD',
      'EUR',
      new Date('2026-07-31T18:00:00.000Z'),
    );

    expect(result.rate).toEqual(expect.objectContaining({
      status: 'available',
      value: 0.8,
      quality: 'calculated',
      asOf: '2026-07-31',
    }));
    expect(
      result.rate.status === 'available'
        ? result.rate.provenance.method
        : null,
    ).toBe('inverse of ECB EUR/USD reference rate');
  });

  it('returns an explicit calculated identity without contacting a provider', async () => {
    const result = await fetchEcbCurrentFx(
      'EUR',
      'EUR',
      new Date('2026-07-31T18:00:00.000Z'),
    );

    expect(mockedFetchProvider).not.toHaveBeenCalled();
    expect(result.rate).toEqual(expect.objectContaining({
      status: 'available',
      value: 1,
      quality: 'calculated',
    }));
  });

  it('fails closed when the newest reference rate is too old', async () => {
    mockedFetchProvider.mockResolvedValueOnce(ecbCsv([
      'EXR.D.USD.EUR.SP00.A,D,USD,EUR,SP00,A,2026-07-20,1.15,A',
    ]));

    const result = await fetchEcbCurrentFx(
      'EUR',
      'USD',
      new Date('2026-07-31T18:00:00.000Z'),
    );

    expect(result.rate).toEqual({
      status: 'unavailable',
      reason: 'stale_expired',
    });
  });

  it('keeps historical as-of dates when a weekend is forward-filled', async () => {
    mockedFetchProvider.mockResolvedValueOnce(ecbHistoryCsv([
      '2026-07-24,1.2,160.0,',
      '2026-07-27,1.25,161.0,',
    ]));

    const observations = await fetchEcbFxHistory(
      'USD',
      'EUR',
      '2026-07-24',
      '2026-07-27',
      new Date('2026-07-28T12:00:00.000Z'),
    );
    const weekend = resolveHistoricalFx(observations, '2026-07-26');

    expect(weekend?.rate).toEqual(expect.objectContaining({
      status: 'available',
      value: expect.closeTo(1 / 1.2, 10),
      asOf: '2026-07-24',
    }));
    expect(mockedFetchProvider).toHaveBeenCalledWith(
      'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-hist.zip',
      expect.objectContaining({
        headers: { Accept: 'application/zip' },
        next: { revalidate: 86_400 },
      }),
    );
  });

  it('does not forward-fill historical rates beyond seven days', async () => {
    mockedFetchProvider.mockResolvedValueOnce(ecbHistoryCsv([
      '2026-07-01,1.2,160.0,',
    ]));

    const observations = await fetchEcbFxHistory(
      'USD',
      'EUR',
      '2026-07-01',
      '2026-07-10',
      new Date('2026-07-11T12:00:00.000Z'),
    );

    expect(resolveHistoricalFx(observations, '2026-07-10')).toBeNull();
  });

  it('fails closed for a stale ECB archive before filtering the requested range', async () => {
    mockedFetchProvider.mockResolvedValueOnce(ecbHistoryCsv([
      '2026-07-01,1.2,160.0,',
    ]));

    await expect(fetchEcbFxHistory(
      'USD',
      'EUR',
      '2026-07-01',
      '2026-07-01',
      new Date('2026-07-20T12:00:00.000Z'),
    )).resolves.toEqual([]);
  });

  it('rejects an unexpected archive type or entry name', async () => {
    mockedFetchProvider
      .mockResolvedValueOnce(ecbHistoryCsv([
        '2026-07-31,1.2,160.0,',
      ], { contentType: 'text/csv' }))
      .mockResolvedValueOnce(ecbHistoryCsv([
        '2026-07-31,1.2,160.0,',
      ], { fileName: '../eurofxref-hist.csv' }));

    await expect(fetchEcbFxHistory(
      'USD', 'EUR', '2026-07-31', '2026-07-31',
      new Date('2026-08-01T12:00:00.000Z'),
    )).resolves.toEqual([]);
    await expect(fetchEcbFxHistory(
      'USD', 'EUR', '2026-07-31', '2026-07-31',
      new Date('2026-08-01T12:00:00.000Z'),
    )).resolves.toEqual([]);
  });

  it('rejects extra entries and oversized expanded bodies before inflation', async () => {
    const csv = [
      'Date,USD,JPY,',
      '2026-07-31,1.2,160.0,',
    ].join('\n');
    const multipleEntries = Buffer.from(createSingleEntryZip(csv));
    const multipleEocd = multipleEntries.byteLength - 22;
    multipleEntries.writeUInt16LE(2, multipleEocd + 8);
    multipleEntries.writeUInt16LE(2, multipleEocd + 10);

    const oversized = Buffer.from(createSingleEntryZip(csv));
    const oversizedEocd = oversized.byteLength - 22;
    const centralOffset = oversized.readUInt32LE(oversizedEocd + 16);
    oversized.writeUInt32LE(3 * 1024 * 1024 + 1, centralOffset + 24);
    oversized.writeUInt32LE(3 * 1024 * 1024 + 1, 22);

    mockedFetchProvider
      .mockResolvedValueOnce(ecbHistoryArchiveResponse(
        Uint8Array.from(multipleEntries).buffer,
      ))
      .mockResolvedValueOnce(ecbHistoryArchiveResponse(
        Uint8Array.from(oversized).buffer,
      ));

    await expect(fetchEcbFxHistory(
      'USD', 'EUR', '2026-07-31', '2026-07-31',
      new Date('2026-08-01T12:00:00.000Z'),
    )).resolves.toEqual([]);
    await expect(fetchEcbFxHistory(
      'USD', 'EUR', '2026-07-31', '2026-07-31',
      new Date('2026-08-01T12:00:00.000Z'),
    )).resolves.toEqual([]);
  });

  it('rejects conflicting duplicate dates in the trusted archive entry', async () => {
    mockedFetchProvider.mockResolvedValueOnce(ecbHistoryCsv([
      '2026-07-31,1.2,160.0,',
      '2026-07-31,1.3,160.0,',
    ]));

    await expect(fetchEcbFxHistory(
      'USD', 'EUR', '2026-07-31', '2026-07-31',
      new Date('2026-08-01T12:00:00.000Z'),
    )).resolves.toEqual([]);
  });

  it('preserves the original money and both provenance chains after conversion', async () => {
    mockedFetchProvider.mockResolvedValueOnce(ecbCsv([
      'EXR.D.USD.EUR.SP00.A,D,USD,EUR,SP00,A,2026-07-31,1.25,A',
    ]));
    const fx = await fetchEcbCurrentFx(
      'USD',
      'EUR',
      new Date('2026-07-31T18:00:00.000Z'),
    );

    const converted = convertMoneyWithFx(
      {
        amount: 100,
        currency: 'USD',
      },
      fx,
      {
        providerId: 'example_quote',
        providerName: 'Example Quote Provider',
        retrievedAt: '2026-07-31T17:59:00.000Z',
      },
    );

    expect(converted).toEqual(expect.objectContaining({
      status: 'available',
      value: { amount: 80, currency: 'EUR' },
      quality: 'calculated',
    }));
    expect(
      converted.status === 'available'
        ? converted.provenance.derivedFrom
        : null,
    ).toHaveLength(2);
  });

  it('does not use a stale current FX observation for a new money conversion', () => {
    const converted = convertMoneyWithFx(
      { amount: 100, currency: 'USD' },
      {
        baseCurrency: 'USD',
        quoteCurrency: 'EUR',
        rate: {
          status: 'available',
          value: 0.8,
          quality: 'calculated',
          freshness: 'stale',
          observedAt: null,
          asOf: '2026-07-24',
          provenance: {
            providerId: 'ecb_reference_rates',
            providerName: 'European Central Bank',
            retrievedAt: '2026-07-31T12:00:00.000Z',
          },
        },
      },
      {
        providerId: 'example_quote',
        providerName: 'Example Quote Provider',
        retrievedAt: '2026-07-31T12:00:00.000Z',
      },
    );

    expect(converted).toEqual({
      status: 'unavailable',
      reason: 'stale_expired',
    });
  });
});
