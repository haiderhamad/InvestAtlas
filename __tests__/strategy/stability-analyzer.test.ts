import { runStabilityAnalysis } from '@/lib/strategy/stability-analyzer';

function weekdaySeries(
  startIso: string,
  endIso: string,
): { dates: string[]; prices: number[] } {
  const dates: string[] = [];
  const cursor = new Date(`${startIso}T00:00:00.000Z`);
  const end = new Date(`${endIso}T00:00:00.000Z`);

  while (cursor <= end) {
    const day = cursor.getUTCDay();
    if (day !== 0 && day !== 6) {
      dates.push(cursor.toISOString().slice(0, 10));
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return {
    dates,
    prices: dates.map((_, index) => 100 + index / 100),
  };
}

describe('strategy stability calendar windows', () => {
  it('uses elapsed calendar years instead of treating market observations as days', () => {
    const { dates, prices } = weekdaySeries('2020-01-01', '2026-01-05');
    const expectedFourYearDates = dates.filter(
      (date) => date < '2024-01-01',
    );
    const expectedTwoYearDates = dates.filter(
      (date) => date < '2022-01-01',
    );
    const expectedSecondWindowStart = dates.find(
      (date) => date >= '2021-01-01',
    );

    const report = runStabilityAnalysis([], prices, dates, 'TEST');

    expect(report.segments4Y[0]).toMatchObject({
      startDate: '2020-01-01',
      endDate: expectedFourYearDates.at(-1),
      dataPoints: expectedFourYearDates.length,
    });
    expect(report.segments2Y[0]).toMatchObject({
      startDate: '2020-01-01',
      endDate: expectedTwoYearDates.at(-1),
      dataPoints: expectedTwoYearDates.length,
    });
    expect(report.segments2Y[1]?.startDate).toBe(
      expectedSecondWindowStart,
    );
  });
});
