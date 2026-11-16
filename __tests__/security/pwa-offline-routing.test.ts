import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('PWA offline navigation safeguards', () => {
  const serviceWorker = readFileSync(
    join(process.cwd(), 'public/sw.js'),
    'utf8',
  );

  it('does not substitute the cached dashboard for another offline route', () => {
    const navigationHandler = serviceWorker.slice(
      serviceWorker.indexOf('if (request.mode === "navigate")'),
      serviceWorker.indexOf('if (url.pathname.startsWith("/_next/static/"))'),
    );

    expect(navigationHandler).toContain('if (url.pathname === "/")');
    expect(navigationHandler.indexOf('if (url.pathname === "/")')).toBeLessThan(
      navigationHandler.indexOf('caches.match("/")'),
    );
  });

  it('provides an explicit bilingual offline state', () => {
    expect(serviceWorker).toContain('InvestAtlas is offline');
    expect(serviceWorker).toContain('InvestAtlas غير متصل');
    expect(serviceWorker).toContain('lang=\\"ar\\"');
  });
});
