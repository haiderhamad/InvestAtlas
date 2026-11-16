import fs from 'node:fs';
import path from 'node:path';

describe('production financial data boundary', () => {
  it('contains no random market-data generator in production provider code', () => {
    const providerRoot = path.join(process.cwd(), 'src', 'lib', 'prices');
    const productionFiles = fs.readdirSync(providerRoot)
      .filter((file) => file.endsWith('.ts'));

    const offendingFiles = productionFiles.filter((file) => {
      const source = fs.readFileSync(path.join(providerRoot, file), 'utf8');
      return source.includes('generateMockHistoricalData')
        || source.includes('Math.random()');
    });

    expect(offendingFiles).toEqual([]);
  });
});
