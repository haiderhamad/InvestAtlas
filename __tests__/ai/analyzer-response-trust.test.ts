import { analyzeMarket, type AIAnalysisRequest } from '@/lib/ai/analyzer';
import { callProvider } from '@/lib/ai/provider-registry';
import type { ProviderStoreUser } from '@/lib/ai/provider-store';

jest.mock('@/lib/ai/provider-registry', () => ({
  callProvider: jest.fn(),
}));

const mockedCallProvider = jest.mocked(callProvider);

const user: ProviderStoreUser = {
  uid: 'trust-test-user',
  token: 'trust-test-token',
};

const bearishRequest: AIAnalysisRequest = {
  asset: 'TEST',
  assetClass: 'stock',
  currency: 'usd',
  currentPrice: 80,
  smaValues: { '50': 100, '200': 120 },
  rsi: 75,
  macd: { macd: -3, signal: -1, histogram: -2 },
  recentPrices: [100, 96, 92, 88, 84, 80],
};

describe('technical analyzer trust boundary', () => {
  beforeEach(() => {
    mockedCallProvider.mockReset();
  });

  it('never calls an AI provider or accepts provider-generated prose', async () => {
    mockedCallProvider.mockResolvedValue({
      response: JSON.stringify({
        technicalPosture: 'positive',
        reasoning: 'Buying this asset is advisable.',
        warnings: ['Die Erlöse und Gewinne steigen.'],
      }),
      latencyMs: 10,
      model: 'untrusted-model',
    });

    const result = await analyzeMarket(bearishRequest, user);

    expect(mockedCallProvider).not.toHaveBeenCalled();
    expect(result.provider).toBe('InvestAtlas');
    expect(result.model).toBe('technical-evidence-v2');
    expect(result.technicalPosture).toBe('negative');
    expect(JSON.stringify(result)).not.toMatch(
      /Buying this asset|Erlöse|Gewinne|untrusted-model/iu,
    );
  });

  it('derives the directional result locally and returns no action fields', async () => {
    const result = await analyzeMarket(bearishRequest, user);
    const serialized = JSON.stringify(result);

    expect(result.trendDirection).toBe('bearish');
    expect(result.signalQuality).toBe('strong');
    expect(result.score).toBe(15);
    expect(result.technicalPosture).toBe('negative');
    expect(result.summary).toBe(
      'Supplied technical inputs currently show a negative posture; this is not an instruction to act.',
    );
    expect(result.bearishSignals.length).toBeGreaterThan(0);
    expect(serialized).not.toMatch(
      /"verdict"|"recommendation"|"actionRequired"|\bBUY\b|\bSELL\b/u,
    );
  });

  it('returns uncertain when no indicator family is available', async () => {
    const result = await analyzeMarket({
      asset: 'GOLD',
      assetClass: 'metal',
      currentPrice: 2_000,
      smaValues: {},
      recentPrices: [],
    }, user);

    expect(result.trendDirection).toBe('uncertain');
    expect(result.technicalPosture).toBe('uncertain');
    expect(result.signalQuality).toBe('weak');
  });

  it('keeps one indicator family uncertain even when it is directional', async () => {
    const result = await analyzeMarket({
      asset: 'TEST',
      currentPrice: 110,
      smaValues: { '50': 100 },
      recentPrices: [],
    }, user);

    expect(result.indicators).toHaveLength(1);
    expect(result.score).toBeGreaterThan(50);
    expect(result.trendDirection).toBe('uncertain');
    expect(result.technicalPosture).toBe('uncertain');
    expect(result.signalQuality).toBe('weak');
  });

  it('returns neutral for conflicting independent indicator families', async () => {
    const result = await analyzeMarket({
      asset: 'TEST',
      currentPrice: 110,
      smaValues: { '50': 100 },
      rsi: 75,
      recentPrices: [],
    }, user);

    expect(result.score).toBe(50);
    expect(result.trendDirection).toBe('neutral');
    expect(result.technicalPosture).toBe('neutral');
  });

  it('requires two independent agreeing families for a directional posture', async () => {
    const result = await analyzeMarket({
      asset: 'TEST',
      currentPrice: 110,
      smaValues: { '50': 100 },
      rsi: 25,
      recentPrices: [],
    }, user);

    expect(result.trendDirection).toBe('bullish');
    expect(result.technicalPosture).toBe('positive');
    expect(result.signalQuality).toBe('moderate');
  });
});
