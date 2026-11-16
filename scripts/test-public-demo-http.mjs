/**
 * Production-mode HTTP acceptance smoke for the operator-only synthetic Demo.
 *
 * Prerequisite: NEXT_PUBLIC_INVESTATLAS_DEPLOYMENT_MODE=public_demo npm run build
 * Run:          NEXT_PUBLIC_INVESTATLAS_DEPLOYMENT_MODE=public_demo node scripts/test-public-demo-http.mjs
 *
 * Starts a disposable production Next server bound to 127.0.0.1 on an OS-chosen
 * port, sends only loopback test requests, and always attempts to stop the server.
 * Next.js may still read project .env* files and initiate its own outbound
 * requests. This is not a network-isolated sandbox. With the optional Chrome
 * flag, the smoke also checks a few hydrated UI invariants, not full QA.
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { setTimeout as delay } from 'node:timers/promises';

const require = createRequire(import.meta.url);
const nextCli = require.resolve('next/dist/bin/next');
const expectedMode = 'public_demo';

if (process.env.NEXT_PUBLIC_INVESTATLAS_DEPLOYMENT_MODE !== expectedMode) {
  throw new Error('Refusing to test without explicit public_demo mode.');
}

async function availablePort() {
  const server = createServer();
  return await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = address && typeof address !== 'string' ? address.port : null;
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

const port = await availablePort();
assert.ok(Number.isInteger(port) && port > 0);
const origin = `http://127.0.0.1:${port}`;

// Do not pass ambient provider keys, Firebase credentials or private owner UID
// through the child environment. Caution: Next may independently load .env*.
const server = spawn(process.execPath, [
  nextCli, 'start', '-H', '127.0.0.1', '-p', String(port),
], {
  cwd: process.cwd(),
  env: {
    PATH: process.env.PATH || '',
    HOME: process.env.HOME || '',
    NODE_ENV: 'production',
    NEXT_TELEMETRY_DISABLED: '1',
    NEXT_PUBLIC_INVESTATLAS_DEPLOYMENT_MODE: expectedMode,
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let stopped = false;
let output = '';
server.once('exit', () => { stopped = true; });
for (const stream of [server.stdout, server.stderr]) {
  stream.on('data', (chunk) => {
    // Only for local failure diagnostics. Do not echo arbitrary app output.
    if (output.length < 2000) output += String(chunk).slice(0, 2000 - output.length);
  });
}

async function request(path, options = {}) {
  return fetch(origin + path, {
    redirect: 'manual',
    signal: AbortSignal.timeout(6000),
    ...options,
  });
}

async function waitUntilReady() {
  const deadline = Date.now() + 40000;
  while (Date.now() < deadline) {
    if (stopped) throw new Error('Next server exited before it became ready.');
    try {
      const response = await request('/');
      if (response.ok) return;
      throw new Error(`Unexpected root status ${response.status}`);
    } catch (error) {
      if (String(error).includes('Unexpected root status')) throw error;
      await delay(350);
    }
  }
  throw new Error('Timed out starting public_demo production server.');
}

async function chromeDom(path) {
  const chrome = process.env.INVESTATLAS_CHROME_BIN
    || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  if (!existsSync(chrome)) throw new Error('Headless Chrome executable not available.');
  const profile = mkdtempSync(join(tmpdir(), 'investatlas-demo-qa-'));
  try {
    const browser = spawn(chrome, [
      '--headless=new',
      '--disable-background-networking',
      '--disable-extensions',
      '--disable-sync',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-component-update',
      '--disable-default-apps',
      '--disable-gpu',
      '--metrics-recording-only',
      '--no-proxy-server',
      '--host-resolver-rules=MAP * ~NOTFOUND , EXCLUDE 127.0.0.1',
      '--virtual-time-budget=8000',
      '--dump-dom',
      `--user-data-dir=${profile}`,
      origin + path,
    ], {
      cwd: process.cwd(),
      env: {
        PATH: process.env.PATH || '',
        HOME: process.env.HOME || '',
        TMPDIR: process.env.TMPDIR || tmpdir(),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let dom = '';
    let stderr = '';
    browser.stdout.on('data', (chunk) => {
      dom += String(chunk);
      if (dom.length > 5 * 1024 * 1024) browser.kill('SIGTERM');
    });
    browser.stderr.on('data', (chunk) => {
      if (stderr.length < 600) stderr += String(chunk).slice(0, 600 - stderr.length);
    });
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      browser.kill('SIGKILL');
    }, 35000);
    const exitCode = await new Promise((resolve, reject) => {
      browser.once('error', reject);
      browser.once('close', resolve);
    }).finally(() => clearTimeout(timeout));
    assert.equal(timedOut, false, `Chrome timed out on ${path}`);
    assert.equal(exitCode, 0, `Chrome failed on ${path}: ${stderr.slice(0, 180)}`);
    return dom;
  } finally {
    rmSync(profile, { recursive: true, force: true });
  }
}

async function stopServer() {
  if (stopped) return;
  server.kill('SIGTERM');
  await Promise.race([
    new Promise((resolve) => server.once('exit', resolve)),
    delay(5000),
  ]);
  if (!stopped) {
    server.kill('SIGKILL');
    await Promise.race([
      new Promise((resolve) => server.once('exit', resolve)),
      delay(1500),
    ]);
  }
}

try {
  await waitUntilReady();

  const pages = ['/', '/login', '/portfolio', '/settings', '/privacy'];
  for (const page of pages) {
    const response = await request(page);
    assert.equal(response.status, 200, `Demo page ${page} must render`);
    assert.ok((response.headers.get('content-type') ?? '').includes('text/html'));
    const html = await response.text();
    if (page === '/login') {
      // AuthProvider intentionally withholds child UI until client hydration;
      // SSR can only prove the shell is served, not that the Demo notice renders.
      assert.ok(!html.includes('type="password"'), 'Login SSR must not expose a password field');
      assert.ok(!html.includes('type="email"'), 'Login SSR must not expose a signup/email field');
    }
    if (page === '/') {
      assert.ok(html.includes('InvestAtlas'), 'The application shell must render');
      const policy = response.headers.get('content-security-policy') ?? '';
      assert.ok(policy.includes("connect-src 'self';"), 'Public Demo must block outbound API connections via CSP');
      assert.ok(!policy.includes('https://api.tiingo.com'), 'Public Demo CSP must not permit Tiingo');
      assert.ok(!policy.includes('https://*.googleapis.com'), 'Public Demo CSP must not permit Firebase');
      assert.ok(policy.includes("frame-src 'none'"), 'Public Demo CSP must deny third-party frames');
      assert.ok(!policy.includes('https://accounts.google.com'), 'Public Demo CSP must not permit Google sign-in');
    }
    console.log(`PASS GET ${page}: 200 HTML shell (hydrated Demo UI requires browser QA)`);
  }

  const apiCases = [
    { path: '/api/ai', method: 'GET' },
    { path: '/api/ai', method: 'POST' },
    { path: '/api/ai/providers', method: 'GET' },
    { path: '/api/financial-data/fx?from=EUR&to=USD', method: 'GET' },
    { path: '/api/prices/current?symbols=AAPL', method: 'GET' },
    { path: '/api/data-providers', method: 'GET' },
    { path: '/api/assets/search?query=AAPL', method: 'GET' },
    { path: '/api/local/tiingo/series', method: 'POST' },
    { path: '/api/transactions/import', method: 'POST' },
    { path: '/api/account/delete', method: 'POST' },
    { path: '/api/ai', method: 'OPTIONS' },
    { path: '/api/prices/history?symbols=AAPL', method: 'HEAD' },
  ];
  for (const { path, method } of apiCases) {
    const response = await request(path, { method });
    assert.equal(response.status, 403, `${method} ${path} must fail closed`);
    assert.match(response.headers.get('cache-control') ?? '', /no-store/);
    if (method !== 'HEAD') {
      assert.deepEqual(await response.json(), { error: 'Unavailable for this installation' });
    }
    console.log(`PASS ${method} ${path}: 403`);
  }

  if (process.env.INVESTATLAS_DEMO_BROWSER === 'true') {
    const dashboard = await chromeDom('/');
    assert.match(dashboard, /class="workspace-mode-notice demo"/,
      'Hydrated dashboard must show the Demo Snapshot notice');
    assert.match(dashboard, /Read-only demo snapshot/,
      'Hydrated dashboard must show read-only wording');
    assert.ok(!dashboard.includes('>Start Local Workspace</button>'),
      'Public Demo must not offer a Local Workspace switch');
    console.log('PASS Chrome /: hydrated public Demo notice without Local Workspace switch');

    const login = await chromeDom('/login');
    assert.ok(login.includes('<h1>Read-only demo snapshot</h1>'),
      'Hydrated /login must show public Demo instead of an authentication form');
    assert.ok(!/<input[^>]+type="(?:email|password)"/.test(login),
      'Hydrated /login must not display credential inputs');
    console.log('PASS Chrome /login: read-only Demo instead of login/signup');
  }

  console.log(`Public Demo smoke passed: ${pages.length} pages, ${apiCases.length} denied API requests (client requests use loopback; server is not network-isolated).`);
} catch (error) {
  console.error(`Public Demo HTTP smoke failed: ${error instanceof Error ? error.message : String(error)}`);
  if (stopped && output) {
    console.error(`Next startup diagnostics (bounded): ${output.slice(0, 500)}`);
  }
  process.exitCode = 1;
} finally {
  await stopServer();
}
