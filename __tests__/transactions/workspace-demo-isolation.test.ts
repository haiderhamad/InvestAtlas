import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { INVESTATLAS_SHOWCASE_SNAPSHOT } from '@/lib/demo/showcase-snapshot';
import { getDemoTransactions } from '@/lib/transactions/manual-store';

const source = (path: string) =>
  readFileSync(join(process.cwd(), path), 'utf8');

describe('workspace and demo transaction isolation', () => {
  it('adapts every showcase transaction through the runtime schema without unsupported fields', () => {
    const transactions = getDemoTransactions();

    expect(transactions).toHaveLength(
      INVESTATLAS_SHOWCASE_SNAPSHOT.transactions.length,
    );
    expect(transactions).not.toHaveLength(0);

    for (const transaction of transactions) {
      expect(transaction.source).toBe('demo');
      expect(transaction).not.toHaveProperty('provenanceRef');
      expect(transaction).not.toHaveProperty('synthetic');
      expect(transaction.asset).toBe(transaction.asset.toUpperCase());
      expect(transaction.quote).toBe(transaction.quote.toUpperCase());
    }
  });

  it('selects the explicit demo snapshot without merging it into Local or Cloud data', () => {
    const store = source('src/lib/transactions/manual-store.ts');

    expect(store).toContain(
      "readAnonymousWorkspaceMode() === 'demo_snapshot'\n      ? getDemoTransactions()\n      : readManualTransactions()",
    );
    expect(store).not.toContain('[...getDemoTransactions()');
  });

  it.each([
    'src/app/portfolio/page.tsx',
    'src/app/accounts/page.tsx',
    'src/app/accounts/[venue]/page.tsx',
  ])('does not render demo transactions before workspace resolution in %s', (path) => {
    const page = source(path);

    expect(page).not.toContain('useState<AppTransaction[]>(getDemoTransactions())');
    expect(page).toContain('useState<AppTransaction[]>([])');
  });
});
