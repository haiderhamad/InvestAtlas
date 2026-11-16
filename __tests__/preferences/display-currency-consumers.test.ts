import fs from 'node:fs';
import path from 'node:path';

describe('display-currency consumers', () => {
  it('requests watchlist quotes in the active display currency', () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), 'src', 'app', 'watchlists', 'page.tsx'),
      'utf8',
    );

    expect(source).toContain(
      'fetchCurrentQuoteBatches(allSymbols, displayCurrency, undefined, controller.signal)',
    );
    expect(source).toContain('[allSymbols, displayCurrency, registryRevision]');
  });
});
