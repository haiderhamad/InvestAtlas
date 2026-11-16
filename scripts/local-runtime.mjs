import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const LOCAL_DIST = '.next-local';
export const LOCAL_STAMP = 'investatlas-local-build.json';

export function parseLocalArguments(args) {
  const result = { buildOnly: false, help: false, port: 3000 };
  let hasPort = false;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--build') result.buildOnly = true;
    else if (arg === '--help') result.help = true;
    else if (arg === '--port' && !hasPort && /^\d{4,5}$/.test(args[index + 1] ?? '')) {
      result.port = Number(args[++index]);
      hasPort = true;
      if (result.port < 1024 || result.port > 65535) throw new Error('Use a port between 1024 and 65535.');
    } else throw new Error('Use --build, --help or --port NUMBER. The local listener is loopback-only.');
  }
  return result;
}

export function assertLocalNodeVersion(version) {
  const match = /^(24|26)\.(\d+)\.(\d+)$/.exec(version);
  const minimum = match?.[1] === '24' ? [22, 3] : [13, 1];
  if (!match || Number(match[2]) < minimum[0]
    || (Number(match[2]) === minimum[0] && Number(match[3]) < minimum[1])) {
    throw new Error('Use patched Node.js 24 LTS (24.22.3 or newer), or 26 LTS (26.13.1 or newer). See .nvmrc.');
  }
}

export function createLocalEnvironment(parent) {
  if (parent.VERCEL) throw new Error('The local launcher is for your computer; use the normal build/start commands on hosting.');
  const env = {};
  // Only forward platform/UI settings. Provider keys are entered in the app.
  for (const key of ['PATH', 'Path', 'SystemRoot', 'SYSTEMROOT', 'WINDIR', 'ComSpec', 'COMSPEC',
    'HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'TEMP', 'TMP', 'TMPDIR', 'LANG', 'LC_ALL',
    'TERM', 'COLORTERM', 'CI']) {
    if (parent[key] !== undefined) env[key] = parent[key];
  }
  return { ...env, NODE_ENV: 'production', NEXT_TELEMETRY_DISABLED: '1',
    NEXT_PUBLIC_INVESTATLAS_DEPLOYMENT_MODE: 'local_personal', INVESTATLAS_LOCAL_RUNTIME: 'true' };
}

export function localFingerprint(root, nodeVersion) {
  const hash = createHash('sha256').update(`investatlas-local-v1\0${nodeVersion}\0`);
  const visit = relative => {
    const path = join(root, relative);
    if (!existsSync(path)) { hash.update(`missing:${relative}\0`); return; }
    const stat = lstatSync(path);
    if (stat.isSymbolicLink()) throw new Error(`Local build input must not be a symbolic link: ${relative}`);
    if (stat.isDirectory()) {
      for (const name of readdirSync(path).sort()) visit(`${relative}/${name}`);
    } else if (stat.isFile()) {
      hash.update(`${relative}\0`).update(readFileSync(path)).update('\0');
    } else throw new Error(`Unsupported local build input: ${relative}`);
  };
  for (const relative of ['package.json', 'package-lock.json', 'next.config.ts', 'tsconfig.json', 'tsconfig.local.json',
    'postcss.config.mjs', 'scripts/export-messages.js', 'scripts/check-i18n-coverage.js',
    'scripts/local-runtime.mjs', 'scripts/local.mjs', 'src', 'public',
    // Next loads these production inputs. Hash locally; never log/copy values.
    '.env.production.local', '.env.local', '.env.production', '.env']) visit(relative);
  return hash.digest('hex');
}

function localBuildId(root) {
  const dir = join(root, LOCAL_DIST);
  const id = readFileSync(join(dir, 'BUILD_ID'), 'utf8').trim();
  const { config } = JSON.parse(readFileSync(join(dir, 'required-server-files.json'), 'utf8'));
  if (!id || config?.distDir !== LOCAL_DIST || !lstatSync(join(dir, 'server')).isDirectory()) {
    throw new Error('No complete Local Personal production build. Run npm run local:build.');
  }
  return id;
}

export function readLocalBuild(root, fingerprint) {
  try {
    const stamp = JSON.parse(readFileSync(join(root, LOCAL_DIST, LOCAL_STAMP), 'utf8'));
    return stamp.schema === 1 && stamp.mode === 'local_personal'
      && /^[a-f0-9]{64}$/.test(stamp.fingerprint)
      && (fingerprint === undefined || stamp.fingerprint === fingerprint)
      && stamp.buildId === localBuildId(root);
  } catch { return false; }
}

export function writeLocalBuild(root, fingerprint) {
  if (!/^[a-f0-9]{64}$/.test(fingerprint)) throw new Error('Invalid local build fingerprint.');
  const buildId = localBuildId(root);
  const dir = join(root, LOCAL_DIST);
  mkdirSync(dir, { recursive: true });
  const temporary = join(dir, `${LOCAL_STAMP}.tmp`);
  writeFileSync(temporary, JSON.stringify({ schema: 1, mode: 'local_personal', fingerprint, buildId }) + '\n');
  renameSync(temporary, join(dir, LOCAL_STAMP));
}

export function containerConfiguration(root, env) {
  if (env.VERCEL || env.NEXT_PUBLIC_INVESTATLAS_DEPLOYMENT_MODE !== 'local_personal'
    || env.INVESTATLAS_LOCAL_RUNTIME !== 'true'
    || !readLocalBuild(root)) {
    throw new Error('The container requires a complete Local Personal build. Rebuild the local image.');
  }
  const { port } = parseLocalArguments(['--port', env.PORT ?? '3000']);
  return { hostname: '127.0.0.1', listenHost: '0.0.0.0', port };
}
