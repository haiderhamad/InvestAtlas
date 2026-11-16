import type { NextConfig } from "next";

const isDevelopment = process.env.NODE_ENV === 'development';
const isPublicDemo = process.env.NEXT_PUBLIC_INVESTATLAS_DEPLOYMENT_MODE === 'public_demo';
const isLocalRuntime = process.env.INVESTATLAS_LOCAL_RUNTIME === 'true';
if (isLocalRuntime && process.env.NEXT_PUBLIC_INVESTATLAS_DEPLOYMENT_MODE !== 'local_personal') {
  throw new Error('The local runtime requires the local_personal deployment mode.');
}
const localEmulatorQA = isDevelopment
  && process.env.NEXT_PUBLIC_FIREBASE_EMULATORS === 'true'
  && process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID === 'demo-investatlas-e2e';

/**
 * This policy is enforced. The existing UI still needs inline scripts/styles,
 * so nonce/hash hardening remains a later step, but destination, framing,
 * object, form, worker, and connection boundaries already have real effect.
 * Firebase Auth/Firestore and the PWA are covered by explicit destinations.
 */
const contentSecurityPolicy = [
  "default-src 'self'",
  [
    "script-src 'self' 'unsafe-inline'",
    isDevelopment ? "'unsafe-eval'" : '',
    ...(!isPublicDemo ? ['https://apis.google.com', 'https://www.gstatic.com'] : []),
  ].filter(Boolean).join(' '),
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  [
    "img-src 'self' data: blob:",
    'https://cdn.jsdelivr.net',
    'https://*.googleusercontent.com',
    'https://*.gstatic.com',
  ].join(' '),
  [
    "connect-src 'self'",
    // The operator's public Demo uses only its bundled synthetic dataset.
    // Disallow accidental browser-to-provider/Firebase network connections.
    ...(!isPublicDemo ? [
      'https://*.googleapis.com',
      'https://*.firebaseio.com',
      'wss://*.firebaseio.com',
      'https://*.firebaseapp.com',
      'https://accounts.google.com',
      'https://api.tiingo.com',
      'https://api.gold-api.com',
      ...(['private_cloud', 'local_personal'].includes(process.env.NEXT_PUBLIC_INVESTATLAS_DEPLOYMENT_MODE ?? '')
        ? ['https://api.twelvedata.com', 'https://api.coinpaprika.com', 'https://api.coingecko.com', 'https://api.marketdata.app', 'https://data-api.binance.vision', 'https://api.kraken.com'] : []),
      ...(localEmulatorQA ? ['http://127.0.0.1:9099', 'http://127.0.0.1:8080'] : []),
    ] : []),
  ].join(' '),
  isPublicDemo ? "frame-src 'none'" : "frame-src 'self' https://*.firebaseapp.com https://accounts.google.com",
  "worker-src 'self' blob:",
  isPublicDemo ? "child-src 'self' blob:" : "child-src 'self' blob: https://*.firebaseapp.com https://accounts.google.com",
  "manifest-src 'self'",
  "media-src 'self' data: blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

const nextConfig: NextConfig = {
  ...(isLocalRuntime ? { distDir: '.next-local', typescript: { tsconfigPath: 'tsconfig.local.json' } } : {}),
  poweredByHeader: false,
  // Mirror only the capability bit; server ingress still enforces the original flag.
  env: { NEXT_PUBLIC_INVESTATLAS_TIINGO_AVAILABLE: String(process.env.INVESTATLAS_TIINGO_HOSTED_ENABLED === 'true') },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff',
          },
          {
            key: 'X-Frame-Options',
            value: 'DENY',
          },
          {
            key: 'Referrer-Policy',
            value: 'strict-origin-when-cross-origin',
          },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=()',
          },
          {
            key: 'Cross-Origin-Opener-Policy',
            value: 'same-origin-allow-popups',
          },
          {
            key: 'Content-Security-Policy',
            value: contentSecurityPolicy,
          },
        ],
      },
    ];
  },
};

export default nextConfig;
