import { INVESTATLAS_DEPLOYMENT_MODE } from './deployment-mode';

/** Server-only guard. Browser Origin and Host must both match local loopback. */
export function isAuthorizedLocalProviderRequest(request: Request): boolean {
  if (INVESTATLAS_DEPLOYMENT_MODE !== 'local_personal' || process.env.VERCEL) return false;
  try {
    const url = new URL(request.url);
    const origin = request.headers.get('origin');
    const host = request.headers.get('host');
    if (url.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
      || !origin || !host) return false;
    const browserOrigin = new URL(origin);
    if (browserOrigin.protocol !== 'http:'
      || !['localhost', '127.0.0.1', '[::1]'].includes(browserOrigin.hostname)
      || browserOrigin.origin !== origin
      || browserOrigin.host !== host
      || browserOrigin.port !== url.port) return false;
    // Next dev normalizes the internal Request.url host to "localhost" on
    // some versions even when the browser was served from 127.0.0.1.
    // Both hostnames MUST independently be verified loopback addresses.
    const site = request.headers.get('sec-fetch-site');
    return site === null || site === 'same-origin';
  } catch {
    return false;
  }
}
