import { normalizePersonalHistoryRange, splitHistoryRange } from '@/lib/financial-data/history/request';

const now = Date.parse('2026-11-07T18:00:00Z');
test.each([['1y','2025-11-06'],['3y','2023-11-06'],['5y','2021-11-06'],['all','2021-11-06']])('normalizes bounded %s closed daily coverage', (range, from) => {
  expect(normalizePersonalHistoryRange({range}, now)).toEqual({from,to:'2026-11-06'});
});
test('validates explicit old backfill independently of current-tail recency', () => {
  expect(normalizePersonalHistoryRange({from:'2022-01-01',to:'2023-06-01'},now)).toEqual({from:'2022-01-01',to:'2023-06-01'});
  for (const input of [{from:'2026-02-30',to:'2026-03-04'},{from:'2026-11-05',to:'2026-11-04'},
    {from:'2020-01-01',to:'2026-11-06'},{from:'2026-11-01',to:'2026-11-07'}, {range:'100y'}, {from:'2024-01-01'}]) {
    expect(normalizePersonalHistoryRange(input, now)).toBeNull();
  }
});
test('splits multi-year FX into inclusive non-overlapping windows of at most 400 days', () => {
  const chunks = splitHistoryRange({from:'2021-11-06',to:'2026-11-06'},400);
  expect(chunks).toHaveLength(5);
  expect(chunks[0].from).toBe('2021-11-06'); expect(chunks.at(-1)!.to).toBe('2026-11-06');
  chunks.forEach((row,i) => {
    expect((Date.parse(row.to)-Date.parse(row.from))/86400000+1).toBeLessThanOrEqual(400);
    if(i) expect(Date.parse(row.from)-Date.parse(chunks[i-1].to)).toBe(86400000);
  });
});
