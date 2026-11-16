import { GET } from '@/app/api/prices/history/route';

describe('history metadata trust boundary', () => {
  it('does not present synthetic coverage, dates, or freshness as measured data', async () => {
    const response = await GET(
      new Request('http://localhost/api/prices/history?metadata=true'),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.assets.length).toBeGreaterThan(0);
    expect(body.assets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          firstDate: null,
          lastDate: null,
          dataPoints: null,
          isComplete: null,
          lastSyncAt: null,
          warnings: ['Persistent history coverage is not measured.'],
        }),
      ]),
    );
  });
});
