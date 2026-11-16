import { sanitizeImportedTransaction } from '@/lib/ai/transaction-import-schema';

const validInput = {
  date: '2026-05-09T00:00:00Z',
  venue: 'broker',
  type: 'buy',
  asset: 'AAPL',
  assetClass: 'stock',
  quote: 'EUR',
  amount: 2,
  price: 100,
  total: 200,
  fee: 1,
};

describe('AI transaction import trust boundary', () => {
  it('preserves the original quote instead of guessing an EUR conversion', () => {
    expect(
      sanitizeImportedTransaction({ ...validInput, quote: 'GBP' }, 0),
    ).toEqual(expect.objectContaining({ quote: 'GBP', total: 200 }));
  });

  it.each([
    { ...validInput, quote: undefined },
    { ...validInput, date: 'not-a-date' },
    { ...validInput, asset: '../../secret' },
    { ...validInput, type: 'invented' },
  ])('rejects incomplete or invalid model output', (input) => {
    expect(sanitizeImportedTransaction(input, 0)).toBeNull();
  });
});
