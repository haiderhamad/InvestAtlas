import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();

function read(relativePath: string): string {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

describe('financial BYOK browser security boundary', () => {
  it('uses one exact provider origin and never accepts a custom endpoint', () => {
    const source = read('src/lib/financial-data/providers/alpha-vantage-browser.ts');

    expect(source).toContain("const ALPHA_VANTAGE_ORIGIN = 'https://www.alphavantage.co'");
    expect(source).toContain("const ALPHA_VANTAGE_PATH = '/query'");
    expect(source).toContain("url.searchParams.set('function', 'TIME_SERIES_DAILY')");
    expect(source).toContain("url.searchParams.set('outputsize', 'compact')");
    expect(source).not.toMatch(/baseUrl|endpointUrl|customUrl|proxyUrl/i);
  });

  it('keeps the provider key out of React state and persistent storage calls', () => {
    const provider = read('src/lib/financial-data/providers/alpha-vantage-browser.ts');
    const manager = read('src/components/settings/financial-provider-manager-v124.tsx');

    expect(provider).toContain('let sessionCredential: SessionCredential | null = null');
    expect(provider).not.toMatch(/writeWorkspaceStorageItem\([^\n]*(apiKey|credential)/);
    expect(provider).not.toMatch(/localStorage\.(setItem|getItem)/);
    expect(manager).toContain('keyInputRef = useRef<HTMLInputElement | null>(null)');
    expect(manager).not.toMatch(/useState\([^\n]*(apiKey|keyInput)/i);
    expect(manager).toContain('autoComplete="off"');
    expect(manager).toContain('type="password"');
  });

  it('prevents the service worker from handling or caching provider requests', () => {
    const worker = read('public/sw.js');

    expect(worker).toContain('if (url.origin !== self.location.origin || url.pathname.startsWith("/api/"))');
    expect(worker).not.toContain('alphavantage.co');
  });

  it('clears the tab key before logout, account switch, and account deletion', () => {
    const auth = read('src/lib/auth/auth-context.tsx');
    const settings = read('src/app/settings/page.tsx');

    expect(auth).toMatch(/reconcileAlphaVantageCredentialOwner\(nextUserId\)[\s\S]*resolveBrowserWorkspace\(nextUserId\)/);
    expect(auth).toMatch(/const signOut = async \(\) => \{\s*clearAlphaVantageSessionCredential\(\);\s*clearTiingoBrowserCredential\(\);\s*clearTwelve\(\);\s*clearPublicSourceConsent\(\);\s*clearMarketData\(\);\s*clearEodhd\(\);\s*clearYahooPersonalDiscoverySession\(\);\s*clearYahooPersonalCache\(\);\s*clearLocalAIConfig\(\);\s*await db\.signOut\(\)/);
    expect(settings).toMatch(/const deletedUserId = user\.id;\s*clearAlphaVantageSessionCredential\(\);\s*clearTiingoBrowserCredential\(\);/);
    expect(settings).toMatch(/if \(!response\.ok\)[\s\S]*clearAlphaVantageNormalizedCache\(deletedUserId\)/);
  });

  it('has no server route that accepts or proxies an Alpha Vantage key', () => {
    const apiFiles = fs.readdirSync(path.join(root, 'src/app/api'), { recursive: true })
      .filter((entry): entry is string => typeof entry === 'string' && entry.endsWith('.ts'));
    const apiSource = apiFiles.map((entry) => read(path.join('src/app/api', entry))).join('\n');

    expect(apiSource).not.toContain('alphavantage.co');
    expect(apiSource).not.toContain('alpha_vantage_browser_byok');
  });

  it('keeps raw unadjusted history out of derived performance and chart indicators', () => {
    const trust = read('src/lib/financial-data/history/trust.ts');
    const charts = read('src/app/charts/page.tsx');

    expect(trust).toContain('isHistoryUsableForDerivedPerformance');
    expect(trust).toContain("adjustment !== 'raw_unadjusted'");
    expect(charts).toContain('const technicalIndicatorsAvailable = !historyIsRawUnadjusted');
    expect(charts).toContain('technicalIndicatorsAvailable ? calculateSMA');
    expect(charts).toContain('technicalIndicatorsAvailable ? calculateRSI');
    expect(charts).toContain('technicalIndicatorsAvailable ? calculateMACD');
  });
});
