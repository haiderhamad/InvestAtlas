import fs from 'node:fs';
import path from 'node:path';

function projectFile(relativePath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

describe('current quote polling consumers', () => {
  test.each([
    'src/app/page.tsx',
    'src/app/accounts/page.tsx',
  ])('%s pauses in hidden tabs and honors the route refresh policy', (relativePath) => {
    const source = projectFile(relativePath);

    expect(source).toContain('shouldRefreshCurrentQuotes(');
    expect(source).toContain('document.visibilityState');
    expect(source).toContain("document.addEventListener('visibilitychange'");
    expect(source).toContain("document.removeEventListener('visibilitychange'");
    expect(source).toContain('createCurrentQuoteRequestCoordinator');
    expect(source).toContain('quoteRequestCoordinatorRef.current!.run(');
    expect(source).toContain("fetchCurrentQuoteBatches(symbols, 'eur', undefined, signal)");
    expect(source).toContain("outcome.status === 'stale'");
    expect(source).toContain('quoteRequestCoordinatorRef.current?.cancel()');
    expect(source).not.toContain('quoteRefreshInFlightRef');
    expect(source).not.toContain('setInterval(fetchPrices');
  });

  test('manual-only refresh policy never blocks local holding reconciliation', () => {
    const dashboard = projectFile('src/app/page.tsx');
    const accounts = projectFile('src/app/accounts/page.tsx');

    expect(dashboard).toContain(
      'setAssets(\n      baseHoldings.length > 0\n        ? buildAssetSnapshot(baseHoldings, undefined, fxRatesToEur)\n        : [],\n    );',
    );
    expect(dashboard).not.toContain(
      "    } else {\n      setAssets([]);\n      setLastSync(null);\n      setIsLive(false);\n    }\n  }, [fetchPrices, visibleTransactions.length]);",
    );

    const accountFallback = 'buildCurrentHoldingValuations(\n        baseHoldings,\n        undefined,\n        fxRatesToEur,\n      )';
    expect(accounts).toContain(accountFallback);
    expect(accounts.indexOf(accountFallback)).toBeLessThan(
      accounts.indexOf('shouldRefreshCurrentQuotes('),
    );
  });
});
