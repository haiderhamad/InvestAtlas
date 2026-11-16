import {
  getHistoryTrustState,
  isHistoryCurrent,
  isHistoryUsableForAi,
  isHistoryUsableForDerivedPerformance,
} from '@/lib/financial-data/history/trust';

describe('historical response trust state', () => {
  it('prioritizes stale cache disclosure over a structurally complete payload', () => {
    expect(getHistoryTrustState({
      status: 'complete',
      cache: { status: 'hit_stale' },
    })).toBe('stale');
    expect(getHistoryTrustState({
      status: 'complete',
      freshness: 'stale',
      cache: { status: 'miss' },
    })).toBe('stale');
  });

  it('preserves partial and unavailable response states', () => {
    expect(getHistoryTrustState({ status: 'partial' })).toBe('partial');
    expect(getHistoryTrustState({ status: 'unavailable' })).toBe('unavailable');
    expect(getHistoryTrustState({ status: 'complete' })).toBeNull();
    expect(getHistoryTrustState(null)).toBe('unavailable');
  });

  it('fails closed for AI interpretation when history is stale or unavailable', () => {
    expect(isHistoryUsableForAi({
      status: 'complete',
      cache: { status: 'hit_stale' },
    })).toBe(false);
    expect(isHistoryUsableForAi({ status: 'unavailable' })).toBe(false);
    expect(isHistoryUsableForAi({ status: 'partial' })).toBe(true);
    expect(isHistoryUsableForAi({ status: 'complete' })).toBe(true);
    expect(isHistoryUsableForAi({ status: 'partial', adjustment: 'raw_unadjusted' })).toBe(false);
  });

  it('blocks stale and unavailable history without discarding valid partial coverage', () => {
    expect(isHistoryCurrent({
      status: 'complete',
      cache: { status: 'hit_stale' },
    })).toBe(false);
    expect(isHistoryCurrent({ status: 'unavailable' })).toBe(false);
    expect(isHistoryCurrent({ status: 'partial' })).toBe(true);
    expect(isHistoryCurrent({ status: 'complete' })).toBe(true);
  });

  it('blocks unadjusted history from performance and backtest calculations', () => {
    expect(isHistoryUsableForDerivedPerformance({ status: 'partial' })).toBe(true);
    expect(isHistoryUsableForDerivedPerformance({
      status: 'partial',
      adjustment: 'raw_unadjusted',
    })).toBe(false);
    expect(isHistoryUsableForDerivedPerformance({
      status: 'complete',
      cache: { status: 'hit_stale' },
    })).toBe(false);
  });
});
