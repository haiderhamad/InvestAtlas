import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { analyzeMarket } from '@/lib/ai/analyzer';
import {
  AI_ANALYSIS_STORAGE_KEY,
  parseStoredAnalysis,
} from '@/lib/ai/analysis-cache';

const user = { uid: 'cache-test-user', token: 'verified-token' };

async function validEntry() {
  const result = await analyzeMarket({
    asset: 'TEST',
    currentPrice: 110,
    smaValues: { '50': 100 },
    rsi: 25,
    recentPrices: [],
  }, user);
  return {
    id: 'TEST-1',
    asset: 'TEST',
    date: '2026-08-14T10:00:00.000Z',
    ...result,
  };
}

describe('analysis cache v2 trust boundary', () => {
  it('uses a versioned cache key and accepts only deterministic v2 output', async () => {
    expect(AI_ANALYSIS_STORAGE_KEY).toBe('investatlas.ai-analysis-v2');
    const entry = await validEntry();

    expect(parseStoredAnalysis(JSON.stringify(entry))).toEqual(entry);
  });

  it.each([
    { verdict: 'BUY' },
    { recommendation: 'Sell now.' },
    { provider: 'Untrusted Provider' },
    { model: 'arbitrary-model' },
    { reasoning: 'Buying this asset is advisable.' },
    { warnings: ['قم بالاستثمار في هذا الأصل الآن.'] },
    { technicalPosture: 'neutral' },
    { trendDirection: 'neutral' },
    { score: 50 },
    { latencyMs: 1 },
    { bullishSignals: [{ label: 'Provider controlled signal' }] },
    { indicators: [{ label: '<script>alert(1)</script>' }] },
    {
      indicators: [{
        label: 'RSI(14)',
        kind: 'rsi',
        status: 'bullish',
        value: '25.0',
        numbers: { current: 'not-a-number' },
      }],
    },
  ])('rejects legacy or tampered cached output: %o', async (tampering) => {
    const entry = await validEntry();

    expect(parseStoredAnalysis(JSON.stringify({ ...entry, ...tampering }))).toBeNull();
  });

  it('does not restore portable AI-analysis output into the v2 cache', () => {
    const source = readFileSync(
      join(process.cwd(), 'src/lib/account-data/account-data-io.ts'),
      'utf8',
    );
    const importSection = source.slice(source.indexOf('function applyLocalImportRecords'));

    expect(importSection).not.toMatch(
      /writeJsonStorage\(AI_ANALYSIS_STORAGE_KEY/u,
    );
  });
});
