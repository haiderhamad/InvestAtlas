import { INVESTATLAS_DEPLOYMENT_MODE } from './deployment-mode';
import { isAuthorizedLocalProviderRequest } from './local-provider-request';

/** Public Yahoo reads only; credential/document routes retain the loopback guard. */
export function isAuthorizedLocalYahooRequest(request: Request): boolean {
  if (isAuthorizedLocalProviderRequest(request)) return true;
  if (INVESTATLAS_DEPLOYMENT_MODE !== 'local_personal' || process.env.VERCEL) return false;
  try {
    const configured = process.env.INVESTATLAS_LOCAL_YAHOO_LAN_ORIGIN;
    if (!configured) return false;
    const allowed = new URL(configured);
    const octets = allowed.hostname.split('.').map(Number);
    const privateAddress = /^\d+\.\d+\.\d+\.\d+$/.test(allowed.hostname)
      && octets.every(part => Number.isInteger(part) && part >= 0 && part <= 255)
      && (octets[0] === 10 || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31)
        || (octets[0] === 192 && octets[1] === 168));
    // Exact canonical origin excludes credentials, paths, URL shorthand,
    // DNS names (including rebinding), public addresses and wildcard hosts.
    if (!privateAddress || allowed.protocol !== 'http:' || allowed.origin !== configured) return false;
    const url = new URL(request.url);
    const site = request.headers.get('sec-fetch-site');
    return url.origin === configured
      && request.headers.get('origin') === configured
      && request.headers.get('host') === allowed.host
      && !request.headers.has('authorization')
      && (site === null || site === 'same-origin');
  } catch {
    return false;
  }
}
