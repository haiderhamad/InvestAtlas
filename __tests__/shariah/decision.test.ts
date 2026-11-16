import {
  isShariahCompliant,
  resolveShariahDecision,
  toLegacyShariahStatus,
} from '@/lib/shariah/decision';

describe('Shariah decision model', () => {
  test('never treats a missing or failed evaluation as compliant', () => {
    expect(resolveShariahDecision({})).toBe('insufficient_data');
    expect(resolveShariahDecision({
      legacyStatus: 'Compliant',
      hasVerifiedEvidence: true,
      evaluationFailed: true,
    })).toBe('insufficient_data');
  });

  test('requires verified evidence before returning compliant', () => {
    expect(resolveShariahDecision({ legacyStatus: 'Compliant' })).toBe('review_required');
    expect(resolveShariahDecision({
      legacyStatus: 'Compliant',
      hasVerifiedEvidence: true,
    })).toBe('compliant');
  });

  test('preserves explicit negative, review, and insufficient outcomes', () => {
    expect(resolveShariahDecision({ legacyStatus: 'Non-Compliant' })).toBe('non_compliant');
    expect(resolveShariahDecision({ legacyStatus: 'Blocked: Source Conflict' })).toBe('review_required');
    expect(resolveShariahDecision({ legacyStatus: 'Blocked: Insufficient Evidence' })).toBe('insufficient_data');
  });

  test('only the compliant decision is positive', () => {
    expect(isShariahCompliant('compliant')).toBe(true);
    expect(isShariahCompliant('review_required')).toBe(false);
    expect(isShariahCompliant('insufficient_data')).toBe(false);
    expect(toLegacyShariahStatus('insufficient_data')).toBe('Blocked: Insufficient Evidence');
  });
});
