import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const PUBLIC_API_ROUTES = [
  'src/app/api/assets/search/route.ts',
  'src/app/api/backtest/route.ts',
  'src/app/api/coins/route.ts',
  'src/app/api/prices/ath/route.ts',
  'src/app/api/prices/benchmark-history/route.ts',
  'src/app/api/prices/metal-spot/route.ts',
];

describe('public API log hygiene', () => {
  it.each(PUBLIC_API_ROUTES)(
    'does not log raw thrown values from %s',
    (route) => {
      const source = readFileSync(join(process.cwd(), route), 'utf8');

      expect(source).not.toMatch(
        /console\.(?:error|warn)\([^;\n]+,\s*(?:error|err)\s*\)/,
      );
    },
  );
});
