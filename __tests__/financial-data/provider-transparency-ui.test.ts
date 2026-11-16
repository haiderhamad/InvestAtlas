import fs from 'node:fs';
import path from 'node:path';

describe('visible provider transparency', () => {
  it('does not claim a universal triple-source consensus that the data flow does not provide', () => {
    const portfolioSource = fs.readFileSync(
      path.join(process.cwd(), 'src', 'app', 'portfolio', 'page.tsx'),
      'utf8',
    );

    expect(portfolioSource).not.toContain('Triple-source consensus');
    expect(portfolioSource).toContain(
      'Data sources vary by asset and availability. Missing or unverified inputs remain unavailable.',
    );
  });

  it('shows the required linked CoinGecko attribution while that provider is active', () => {
    const appShellSource = fs.readFileSync(
      path.join(process.cwd(), 'src', 'components', 'layout', 'app-shell.tsx'),
      'utf8',
    );

    expect(appShellSource).toContain('Powered by CoinGecko API');
    expect(appShellSource).toContain('https://www.coingecko.com/en/api');
    expect(appShellSource).toContain(
      "candidate.id === 'coingecko_public' && candidate.isActive === true",
    );
  });
});
