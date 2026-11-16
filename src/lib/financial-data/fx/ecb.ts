import { fetchProvider } from '@/lib/data/provider-fetch';
import { inflateRawSync } from 'node:zlib';
import {
  availableField,
  createMoney,
  unavailableField,
  type CurrencyCode,
  type DataField,
  type FieldProvenance,
  type Money,
} from '@/lib/financial-data/contracts';

const ECB_FX_API = 'https://data-api.ecb.europa.eu/service/data/EXR';
const ECB_FX_HISTORY_ZIP = 'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-hist.zip';
const ECB_PUBLIC_SOURCE = 'https://data.ecb.europa.eu/data/datasets/EXR/EXR.D.USD.EUR.SP00.A';
const ECB_PROVIDER_ID = 'ecb_reference_rates';
const ECB_PROVIDER_NAME = 'European Central Bank';
const MAX_CURRENT_AGE_DAYS = 7;
const FRESH_AGE_DAYS = 3;
const MAX_HISTORY_DAYS = 3_700;
const MAX_ECB_ARCHIVE_BYTES = 1024 * 1024;
const MAX_ECB_CSV_BYTES = 3 * 1024 * 1024;
const MAX_ECB_HISTORY_ROWS = 10_000;
const ECB_HISTORY_ENTRY_NAME = 'eurofxref-hist.csv';
const MILLISECONDS_PER_DAY = 86_400_000;

interface EcbReferenceRow {
  date: string;
  usdPerEur: number;
}

export interface FxObservation {
  baseCurrency: CurrencyCode;
  quoteCurrency: CurrencyCode;
  rate: DataField<number>;
}

function parseIsoDate(value: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const timestamp = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isFinite(timestamp)
    && new Date(timestamp).toISOString().slice(0, 10) === value
    ? timestamp
    : null;
}

function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
  let cell = '';
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"') {
      if (quoted && line[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === ',' && !quoted) {
      cells.push(cell);
      cell = '';
    } else {
      cell += character;
    }
  }
  cells.push(cell);
  return cells;
}

function parseEcbCsv(input: string): EcbReferenceRow[] {
  const lines = input.trim().split(/\r?\n/);
  if (lines.length < 2 || lines.length > MAX_HISTORY_DAYS + 2) {
    return [];
  }

  const headers = parseCsvLine(lines[0]);
  const required = [
    'KEY',
    'FREQ',
    'CURRENCY',
    'CURRENCY_DENOM',
    'EXR_TYPE',
    'EXR_SUFFIX',
    'TIME_PERIOD',
    'OBS_VALUE',
  ];
  const positions = Object.fromEntries(
    required.map((header) => [header, headers.indexOf(header)]),
  ) as Record<(typeof required)[number], number>;
  if (required.some((header) => positions[header] < 0)) return [];

  const byDate = new Map<string, EcbReferenceRow>();
  for (const line of lines.slice(1)) {
    if (!line.trim()) continue;
    const cells = parseCsvLine(line);
    const date = cells[positions.TIME_PERIOD]?.trim();
    const value = Number(cells[positions.OBS_VALUE]);
    if (
      cells[positions.KEY] !== 'EXR.D.USD.EUR.SP00.A'
      || cells[positions.FREQ] !== 'D'
      || cells[positions.CURRENCY] !== 'USD'
      || cells[positions.CURRENCY_DENOM] !== 'EUR'
      || cells[positions.EXR_TYPE] !== 'SP00'
      || cells[positions.EXR_SUFFIX] !== 'A'
      || parseIsoDate(date) === null
      || !Number.isFinite(value)
      || value <= 0
    ) {
      continue;
    }
    byDate.set(date, { date, usdPerEur: value });
  }

  return [...byDate.values()].sort(
    (left, right) => Date.parse(left.date) - Date.parse(right.date),
  );
}

const CRC32_TABLE = Array.from({ length: 256 }, (_, initial) => {
  let value = initial;
  for (let bit = 0; bit < 8; bit += 1) {
    value = (value & 1) === 1
      ? 0xedb88320 ^ (value >>> 1)
      : value >>> 1;
  }
  return value >>> 0;
});

function crc32(input: Uint8Array): number {
  let value = 0xffffffff;
  for (const byte of input) {
    value = CRC32_TABLE[(value ^ byte) & 0xff] ^ (value >>> 8);
  }
  return (value ^ 0xffffffff) >>> 0;
}

/**
 * Extract the one fixed file published by the ECB without ever resolving an
 * archive path. ZIP64, encryption, data descriptors, extra entries and
 * oversized compressed/decompressed bodies are intentionally unsupported.
 */
function extractEcbHistoryCsv(archive: Uint8Array): string | null {
  if (
    archive.byteLength < 22
    || archive.byteLength > MAX_ECB_ARCHIVE_BYTES
  ) {
    return null;
  }

  const buffer = Buffer.from(
    archive.buffer,
    archive.byteOffset,
    archive.byteLength,
  );
  const eocdOffset = buffer.byteLength - 22;
  if (
    buffer.readUInt32LE(eocdOffset) !== 0x06054b50
    || buffer.readUInt16LE(eocdOffset + 4) !== 0
    || buffer.readUInt16LE(eocdOffset + 6) !== 0
    || buffer.readUInt16LE(eocdOffset + 8) !== 1
    || buffer.readUInt16LE(eocdOffset + 10) !== 1
    || buffer.readUInt16LE(eocdOffset + 20) !== 0
  ) {
    return null;
  }

  const centralSize = buffer.readUInt32LE(eocdOffset + 12);
  const centralOffset = buffer.readUInt32LE(eocdOffset + 16);
  if (
    centralOffset + centralSize !== eocdOffset
    || centralSize < 46
    || centralOffset + 46 > eocdOffset
    || buffer.readUInt32LE(centralOffset) !== 0x02014b50
  ) {
    return null;
  }

  const flags = buffer.readUInt16LE(centralOffset + 8);
  const method = buffer.readUInt16LE(centralOffset + 10);
  const expectedCrc = buffer.readUInt32LE(centralOffset + 16);
  const compressedSize = buffer.readUInt32LE(centralOffset + 20);
  const uncompressedSize = buffer.readUInt32LE(centralOffset + 24);
  const fileNameLength = buffer.readUInt16LE(centralOffset + 28);
  const extraLength = buffer.readUInt16LE(centralOffset + 30);
  const commentLength = buffer.readUInt16LE(centralOffset + 32);
  const diskStart = buffer.readUInt16LE(centralOffset + 34);
  const localOffset = buffer.readUInt32LE(centralOffset + 42);
  const centralEnd = centralOffset + 46 + fileNameLength
    + extraLength + commentLength;
  const fileName = buffer.subarray(
    centralOffset + 46,
    centralOffset + 46 + fileNameLength,
  ).toString('utf8');

  if (
    (flags & ~0x0800) !== 0
    || method !== 8
    || diskStart !== 0
    || extraLength !== 0
    || commentLength !== 0
    || centralEnd !== eocdOffset
    || fileName !== ECB_HISTORY_ENTRY_NAME
    || compressedSize <= 0
    || compressedSize > MAX_ECB_ARCHIVE_BYTES
    || uncompressedSize <= 0
    || uncompressedSize > MAX_ECB_CSV_BYTES
    || localOffset + 30 > centralOffset
    || buffer.readUInt32LE(localOffset) !== 0x04034b50
  ) {
    return null;
  }

  const localFlags = buffer.readUInt16LE(localOffset + 6);
  const localMethod = buffer.readUInt16LE(localOffset + 8);
  const localCrc = buffer.readUInt32LE(localOffset + 14);
  const localCompressedSize = buffer.readUInt32LE(localOffset + 18);
  const localUncompressedSize = buffer.readUInt32LE(localOffset + 22);
  const localNameLength = buffer.readUInt16LE(localOffset + 26);
  const localExtraLength = buffer.readUInt16LE(localOffset + 28);
  const localName = buffer.subarray(
    localOffset + 30,
    localOffset + 30 + localNameLength,
  ).toString('utf8');
  const compressedStart = localOffset + 30 + localNameLength
    + localExtraLength;
  const compressedEnd = compressedStart + compressedSize;

  if (
    localFlags !== flags
    || localMethod !== method
    || localCrc !== expectedCrc
    || localCompressedSize !== compressedSize
    || localUncompressedSize !== uncompressedSize
    || localExtraLength !== 0
    || localName !== ECB_HISTORY_ENTRY_NAME
    || compressedEnd !== centralOffset
  ) {
    return null;
  }

  try {
    const inflated = inflateRawSync(
      buffer.subarray(compressedStart, compressedEnd),
      { maxOutputLength: MAX_ECB_CSV_BYTES },
    );
    if (
      inflated.byteLength !== uncompressedSize
      || crc32(inflated) !== expectedCrc
    ) {
      return null;
    }
    return new TextDecoder('utf-8', { fatal: true }).decode(inflated);
  } catch {
    return null;
  }
}

function parseEcbHistoryCsv(
  input: string,
  now: Date,
): EcbReferenceRow[] {
  const lines = input.trim().split(/\r?\n/);
  if (lines.length < 2 || lines.length > MAX_ECB_HISTORY_ROWS + 1) {
    return [];
  }

  const headers = parseCsvLine(lines[0]).map((header, index) =>
    (index === 0 ? header.replace(/^\uFEFF/, '') : header).trim()
  );
  const dateIndex = headers.indexOf('Date');
  const usdIndex = headers.indexOf('USD');
  if (dateIndex < 0 || usdIndex < 0) return [];

  const byDate = new Map<string, EcbReferenceRow>();
  for (const line of lines.slice(1)) {
    if (!line.trim()) continue;
    const cells = parseCsvLine(line);
    const date = cells[dateIndex]?.trim();
    const value = Number(cells[usdIndex]);
    if (
      parseIsoDate(date) === null
      || !Number.isFinite(value)
      || value <= 0
      || value > 10
    ) {
      return [];
    }

    const existing = byDate.get(date);
    if (existing && existing.usdPerEur !== value) return [];
    byDate.set(date, { date, usdPerEur: value });
  }

  const rows = [...byDate.values()].sort(
    (left, right) => Date.parse(left.date) - Date.parse(right.date),
  );
  const latest = rows.at(-1);
  if (!latest) return [];
  const ageDays = daysBetween(latest.date, now.toISOString().slice(0, 10));
  if (ageDays < 0 || ageDays > MAX_CURRENT_AGE_DAYS) return [];
  return rows;
}

function daysBetween(earlier: string, later: string): number {
  const earlierTimestamp = parseIsoDate(earlier);
  const laterTimestamp = parseIsoDate(later);
  if (earlierTimestamp === null || laterTimestamp === null) {
    return Number.POSITIVE_INFINITY;
  }
  return (laterTimestamp - earlierTimestamp) / MILLISECONDS_PER_DAY;
}

function ecbProvenance(
  retrievedAt: string,
  method?: string,
): FieldProvenance {
  return {
    providerId: ECB_PROVIDER_ID,
    providerName: ECB_PROVIDER_NAME,
    retrievedAt,
    publicSourceUrl: ECB_PUBLIC_SOURCE,
    ...(method ? { method } : {}),
  };
}

function identityObservation(
  currency: CurrencyCode,
  now: Date,
  asOf: string | null = null,
): FxObservation {
  const retrievedAt = now.toISOString();
  return {
    baseCurrency: currency,
    quoteCurrency: currency,
    rate: availableField(1, {
      quality: 'calculated',
      freshness: 'fresh',
      observedAt: null,
      asOf,
      provenance: {
        providerId: 'investatlas_calculation',
        providerName: 'InvestAtlas',
        retrievedAt,
        method: 'identity exchange rate',
      },
    }),
  };
}

function rowToObservation(
  row: EcbReferenceRow,
  from: CurrencyCode,
  to: CurrencyCode,
  now: Date,
  freshness: 'fresh' | 'stale',
): FxObservation {
  const inverted = from === 'USD' && to === 'EUR';
  const value = inverted ? 1 / row.usdPerEur : row.usdPerEur;
  return {
    baseCurrency: from,
    quoteCurrency: to,
    rate: availableField(value, {
      quality: inverted ? 'calculated' : 'reported',
      freshness,
      observedAt: null,
      asOf: row.date,
      provenance: ecbProvenance(
        now.toISOString(),
        inverted ? 'inverse of ECB EUR/USD reference rate' : undefined,
      ),
      limitations: ['delayed'],
    }),
  };
}

function unavailableObservation(
  from: CurrencyCode,
  to: CurrencyCode,
  reason: Parameters<typeof unavailableField>[0],
): FxObservation {
  return {
    baseCurrency: from,
    quoteCurrency: to,
    rate: unavailableField(reason),
  };
}

function assertSupportedPair(from: CurrencyCode, to: CurrencyCode): void {
  if (
    (from !== 'EUR' && from !== 'USD')
    || (to !== 'EUR' && to !== 'USD')
  ) {
    throw new Error('Unsupported FX currency');
  }
}

export async function fetchEcbCurrentFx(
  from: CurrencyCode,
  to: CurrencyCode,
  now = new Date(),
  signal?: AbortSignal,
): Promise<FxObservation> {
  assertSupportedPair(from, to);
  if (from === to) return identityObservation(from, now);

  let response: Response;
  try {
    response = await fetchProvider(
      `${ECB_FX_API}/D.USD.EUR.SP00.A?lastNObservations=1&format=csvdata`,
      {
        headers: { Accept: 'text/csv' },
        next: { revalidate: 3_600 },
        signal,
      },
    );
  } catch {
    if (signal?.aborted) throw new Error('FX request aborted');
    return unavailableObservation(from, to, 'provider_unavailable');
  }
  if (!response.ok) {
    return unavailableObservation(
      from,
      to,
      response.status === 429 ? 'rate_limited' : 'provider_unavailable',
    );
  }

  const rows = parseEcbCsv(await response.text());
  const latest = rows.at(-1);
  if (!latest) return unavailableObservation(from, to, 'invalid_response');

  const today = now.toISOString().slice(0, 10);
  const ageDays = daysBetween(latest.date, today);
  if (ageDays < 0 || ageDays > MAX_CURRENT_AGE_DAYS) {
    return unavailableObservation(from, to, 'stale_expired');
  }
  return rowToObservation(
    latest,
    from,
    to,
    now,
    ageDays <= FRESH_AGE_DAYS ? 'fresh' : 'stale',
  );
}

export async function fetchEcbFxHistory(
  from: CurrencyCode,
  to: CurrencyCode,
  startDate: string,
  endDate: string,
  now = new Date(),
  signal?: AbortSignal,
): Promise<FxObservation[]> {
  assertSupportedPair(from, to);
  const startTimestamp = parseIsoDate(startDate);
  const endTimestamp = parseIsoDate(endDate);
  if (
    startTimestamp === null
    || endTimestamp === null
    || startTimestamp > endTimestamp
    || (endTimestamp - startTimestamp) / MILLISECONDS_PER_DAY > MAX_HISTORY_DAYS
  ) {
    throw new Error('Invalid FX history range');
  }

  if (from === to) {
    const observations: FxObservation[] = [];
    for (
      let timestamp = startTimestamp;
      timestamp <= endTimestamp;
      timestamp += MILLISECONDS_PER_DAY
    ) {
      const date = new Date(timestamp).toISOString().slice(0, 10);
      observations.push(identityObservation(from, now, date));
    }
    return observations;
  }

  const paddedStart = new Date(
    startTimestamp - MAX_CURRENT_AGE_DAYS * MILLISECONDS_PER_DAY,
  ).toISOString().slice(0, 10);
  let response: Response;
  try {
    response = await fetchProvider(
      ECB_FX_HISTORY_ZIP,
      {
        headers: { Accept: 'application/zip' },
        next: { revalidate: 86_400 },
        signal,
      },
    );
  } catch {
    if (signal?.aborted) throw new Error('FX request aborted');
    return [];
  }
  if (!response.ok) return [];
  if (response.headers.get('content-type')?.toLowerCase() !== 'application/zip') {
    return [];
  }
  const archive = new Uint8Array(await response.arrayBuffer());
  const csv = extractEcbHistoryCsv(archive);
  if (!csv) return [];

  return parseEcbHistoryCsv(csv, now)
    .filter((row) => row.date >= paddedStart && row.date <= endDate)
    .map((row) =>
    rowToObservation(row, from, to, now, 'fresh'),
  );
}

export function resolveHistoricalFx(
  observations: ReadonlyArray<FxObservation>,
  date: string,
): FxObservation | null {
  if (parseIsoDate(date) === null) return null;
  let selected: FxObservation | null = null;

  for (const observation of observations) {
    if (observation.rate.status !== 'available' || !observation.rate.asOf) {
      continue;
    }
    if (observation.rate.asOf > date) continue;
    if (
      selected?.rate.status !== 'available'
      || !selected.rate.asOf
      || observation.rate.asOf > selected.rate.asOf
    ) {
      selected = observation;
    }
  }

  if (
    selected?.rate.status !== 'available'
    || !selected.rate.asOf
    || daysBetween(selected.rate.asOf, date) > MAX_CURRENT_AGE_DAYS
  ) {
    return null;
  }
  return {
    ...selected,
    rate: {
      ...selected.rate,
      provenance: {
        ...selected.rate.provenance,
        derivedFrom: selected.rate.provenance.derivedFrom?.map((source) => ({
          ...source,
        })),
      },
    },
  };
}

export function convertMoneyWithFx(
  money: Money,
  fx: FxObservation,
  moneyProvenance: FieldProvenance,
): DataField<Money> {
  if (fx.rate.status === 'available' && fx.rate.freshness === 'stale') {
    return unavailableField('stale_expired');
  }
  if (
    money.currency !== fx.baseCurrency
    || fx.rate.status !== 'available'
    || !Number.isFinite(fx.rate.value)
    || fx.rate.value <= 0
  ) {
    return unavailableField('fx_unavailable');
  }
  const amount = money.amount * fx.rate.value;
  if (!Number.isFinite(amount)) return unavailableField('fx_unavailable');

  return availableField(createMoney(amount, fx.quoteCurrency), {
    quality: 'calculated',
    freshness: fx.rate.freshness,
    observedAt: null,
    asOf: fx.rate.asOf,
    provenance: {
      providerId: 'investatlas_calculation',
      providerName: 'InvestAtlas',
      retrievedAt: fx.rate.provenance.retrievedAt,
      method: 'source money multiplied by sourced FX rate',
      derivedFrom: [
        { ...moneyProvenance },
        { ...fx.rate.provenance },
      ],
    },
  });
}
