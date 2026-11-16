import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';

const fixtures = [];
const runtimeUrl = new URL('../local-runtime.mjs', import.meta.url);
async function runtime() {
  assert.ok(existsSync(fileURLToPath(runtimeUrl)), 'The local startup runtime is missing');
  return import(runtimeUrl.href);
}
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'investatlas-local-'));
  fixtures.push(root);
  mkdirSync(join(root, 'src'));
  mkdirSync(join(root, 'public'));
  writeFileSync(join(root, 'package.json'), '{"name":"fixture"}\n');
  writeFileSync(join(root, 'package-lock.json'), '{"lockfileVersion":3}\n');
  writeFileSync(join(root, 'src', 'page.tsx'), 'export default 1;\n');
  return root;
}
function buildArtifacts(root, id = 'fixture-build') {
  const dir = join(root, '.next-local');
  mkdirSync(join(dir, 'server'), { recursive: true });
  writeFileSync(join(dir, 'BUILD_ID'), id);
  writeFileSync(join(dir, 'required-server-files.json'), JSON.stringify({ config: { distDir: '.next-local' } }));
  return dir;
}
afterEach(() => {
  for (const root of fixtures.splice(0)) rmSync(root, { recursive: true, force: true });
});

test('local startup accepts explicit ports without interpreting shell syntax', async () => {
  const { parseLocalArguments } = await runtime();
  assert.deepEqual(parseLocalArguments([]), { buildOnly: false, help: false, port: 3000 });
  assert.deepEqual(parseLocalArguments(['--port', '3010', '--build']), { buildOnly: true, help: false, port: 3010 });
  assert.equal(parseLocalArguments(['--help']).help, true);
  for (const args of [['--host', '0.0.0.0'], ['--port'], ['--port', '0'], ['--port', '1023'],
    ['--port', '65536'], ['--port', '3000;echo injected'], ['--port', '3e3'], ['--port', '3000', '--port', '3001']]) {
    assert.throws(() => parseLocalArguments(args));
  }
});

test('local startup rejects unsupported or older Node releases before building', async () => {
  const { assertLocalNodeVersion } = await runtime();
  for (const version of ['24.22.3', '24.23.0', '26.13.1', '26.14.0']) {
    assert.doesNotThrow(() => assertLocalNodeVersion(version));
  }
  for (const version of ['20.19.0', '24.22.2', '25.0.0', '26.10.0', '26.13.0', '27.0.0', 'invalid']) {
    assert.throws(() => assertLocalNodeVersion(version));
  }
});

test('local launch overrides a cloud mode without forwarding credential variables', async () => {
  const { createLocalEnvironment } = await runtime();
  const parent = { PATH: '/fixture/bin', SystemRoot: 'C:\\Windows', NEXT_PUBLIC_INVESTATLAS_DEPLOYMENT_MODE: 'private_cloud',
    FIREBASE_SERVICE_ACCOUNT_JSON: 'synthetic-not-a-secret', AWS_SECRET_ACCESS_KEY: 'synthetic-not-a-secret',
    NODE_OPTIONS: '--require=/synthetic/injection.js', INVESTATLAS_PRIVATE_OWNER_UID: 'synthetic-owner' };
  const env = createLocalEnvironment(parent);
  assert.equal(env.NEXT_PUBLIC_INVESTATLAS_DEPLOYMENT_MODE, 'local_personal');
  assert.equal(env.INVESTATLAS_LOCAL_RUNTIME, 'true');
  assert.equal(env.NODE_ENV, 'production');
  assert.equal(env.PATH, '/fixture/bin');
  assert.equal(env.SystemRoot, 'C:\\Windows');
  for (const key of ['FIREBASE_SERVICE_ACCOUNT_JSON', 'AWS_SECRET_ACCESS_KEY', 'NODE_OPTIONS', 'INVESTATLAS_PRIVATE_OWNER_UID']) {
    assert.equal(env[key], undefined);
  }
  assert.equal(parent.NEXT_PUBLIC_INVESTATLAS_DEPLOYMENT_MODE, 'private_cloud');
  assert.throws(() => createLocalEnvironment({ VERCEL: '1' }));
});

test('source, production env and lock changes invalidate output while notes and generated files do not', async () => {
  const { localFingerprint } = await runtime();
  const root = fixture();
  const original = localFingerprint(root, '24.22.3');
  assert.match(original, /^[a-f0-9]{64}$/);
  writeFileSync(join(root, '.env.local'), 'SYNTHETIC_PRIVATE_VALUE=not-a-secret\n');
  assert.notEqual(localFingerprint(root, '24.22.3'), original);
  rmSync(join(root, '.env.local'));
  mkdirSync(join(root, 'docs'));
  writeFileSync(join(root, 'docs', 'notes.md'), 'local notes');
  buildArtifacts(root);
  assert.equal(localFingerprint(root, '24.22.3'), original);
  assert.notEqual(localFingerprint(root, '26.13.1'), original);
  writeFileSync(join(root, 'src', 'page.tsx'), 'export default 2;\n');
  assert.notEqual(localFingerprint(root, '24.22.3'), original);
  writeFileSync(join(root, 'src', 'page.tsx'), 'export default 1;\n');
  writeFileSync(join(root, 'package-lock.json'), '{"lockfileVersion":3,"changed":true}\n');
  assert.notEqual(localFingerprint(root, '24.22.3'), original);
});

test('build metadata cannot be written for an incomplete or ordinary hosting build', async () => {
  const { localFingerprint, readLocalBuild, writeLocalBuild } = await runtime();
  const root = fixture();
  const fingerprint = localFingerprint(root, '24.22.3');
  assert.equal(readLocalBuild(root, fingerprint), false);
  assert.throws(() => writeLocalBuild(root, fingerprint));
  const dir = buildArtifacts(root);
  writeFileSync(join(dir, 'required-server-files.json'), JSON.stringify({ config: { distDir: '.next' } }));
  assert.throws(() => writeLocalBuild(root, fingerprint));
  assert.equal(readLocalBuild(root, fingerprint), false);
});

test('successful local metadata is reusable only for the same inputs and actual build identity', async () => {
  const { localFingerprint, readLocalBuild, writeLocalBuild } = await runtime();
  const root = fixture();
  const dir = buildArtifacts(root);
  const fingerprint = localFingerprint(root, '24.22.3');
  writeLocalBuild(root, fingerprint);
  assert.equal(readLocalBuild(root, fingerprint), true);
  assert.equal(readLocalBuild(root, 'different-inputs'), false);
  writeFileSync(join(dir, 'BUILD_ID'), 'other-build');
  assert.equal(readLocalBuild(root, fingerprint), false);
});

test('container validation refuses wrong mode, invalid port and forged local build metadata', async () => {
  const { localFingerprint, writeLocalBuild, containerConfiguration } = await runtime();
  const root = fixture();
  const dir = buildArtifacts(root);
  writeLocalBuild(root, localFingerprint(root, '24.22.3'));
  const env = { NEXT_PUBLIC_INVESTATLAS_DEPLOYMENT_MODE: 'local_personal', INVESTATLAS_LOCAL_RUNTIME: 'true', PORT: '3000' };
  assert.deepEqual(containerConfiguration(root, env), { hostname: '127.0.0.1', listenHost: '0.0.0.0', port: 3000 });
  for (const invalid of [{ ...env, VERCEL: '1' }, { ...env, NEXT_PUBLIC_INVESTATLAS_DEPLOYMENT_MODE: 'private_cloud' },
    { ...env, INVESTATLAS_LOCAL_RUNTIME: undefined }, { ...env, PORT: '1023' },
    { ...env, PORT: '65536' }, { ...env, PORT: '3000;bad' }, { ...env, PORT: '3e3' }]) {
    assert.throws(() => containerConfiguration(root, invalid));
  }
  const stampPath = join(dir, 'investatlas-local-build.json');
  const stamp = JSON.parse(readFileSync(stampPath, 'utf8'));
  writeFileSync(stampPath, JSON.stringify({ ...stamp, mode: 'private_cloud' }));
  assert.throws(() => containerConfiguration(root, env));
});

test('a failed rebuild invalidates its stamp and preserves the ordinary hosting build', async () => {
  const { localFingerprint, readLocalBuild, writeLocalBuild } = await runtime();
  const root = fixture();
  const dir = buildArtifacts(root);
  const fingerprint = localFingerprint(root, '24.22.3');
  writeLocalBuild(root, fingerprint);
  mkdirSync(join(root, '.next'));
  writeFileSync(join(root, '.next', 'BUILD_ID'), 'ordinary-host-build');
  const launcherUrl = new URL('../local.mjs', import.meta.url);
  assert.ok(existsSync(fileURLToPath(launcherUrl)), 'The local launcher is missing');
  const { buildLocal } = await import(launcherUrl.href);
  await assert.rejects(() => buildLocal(root, {}, async () => 2, '24.22.3'));
  assert.equal(existsSync(join(dir, 'investatlas-local-build.json')), false);
  assert.equal(readLocalBuild(root, fingerprint), false);
  assert.equal(readFileSync(join(root, '.next', 'BUILD_ID'), 'utf8'), 'ordinary-host-build');
});

test('a source edit during compilation cannot receive a reusable success stamp', async () => {
  await runtime();
  const { buildLocal } = await import(new URL('../local.mjs', import.meta.url).href);
  const root = fixture();
  await assert.rejects(() => buildLocal(root, {}, async () => {
    buildArtifacts(root);
    writeFileSync(join(root, 'src/page.tsx'), 'export default 99;\n');
    return 0;
  }, '24.22.3'));
  assert.equal(existsSync(join(root, '.next-local/investatlas-local-build.json')), false);
});

test('i18n coverage scans nested source without a POSIX find program and still rejects missing translations', () => {
  const root = fixture();
  mkdirSync(join(root, 'src/lib/i18n'), { recursive: true });
  mkdirSync(join(root, 'src/components/nested folder'), { recursive: true });
  mkdirSync(join(root, 'src/app/api/fixture'), { recursive: true });
  writeFileSync(join(root, 'src/lib/i18n/app-localization.ts'),
    'const DE_TEXT = { "Fixture greeting": "Hallo" }; const AR_TEXT = { "Fixture greeting": "مرحبا" };');
  writeFileSync(join(root, 'src/components/nested folder/page.tsx'), '<span>Fixture greeting</span>');
  writeFileSync(join(root, 'src/app/api/fixture/route.ts'), 't("API-only untranslated fixture")');
  const checker = readFileSync(new URL('../check-i18n-coverage.js', import.meta.url), 'utf8');
  const require = createRequire(import.meta.url);
  const run = () => {
    const output = [];
    let code = 0;
    try {
      runInNewContext(checker, {
        require: name => {
          if (name === 'child_process') return { execSync: () => { throw new Error('No POSIX find is installed'); } };
          if (['fs', 'path', 'typescript'].includes(name)) return require(name);
          throw new Error('Unexpected checker dependency');
        },
        process: { cwd: () => root, exit: status => { throw Object.assign(new Error('checker exit'), { status }); } },
        console: { log: text => output.push(text), error: text => output.push(text) },
      });
    } catch (error) {
      if (error.status === undefined) throw error;
      code = error.status;
    }
    return { code, text: output.join('\n') };
  };
  assert.equal(run().code, 0);
  writeFileSync(join(root, 'src/components/nested folder/missing.tsx'), '<span>Missing fixture translation</span>');
  const missing = run();
  assert.equal(missing.code, 1);
  assert.match(missing.text, /Missing fixture translation/);
  assert.match(missing.text, /de, ar/);
});

test('local build configuration stays isolated from every ordinary hosting mode', () => {
  const require = createRequire(import.meta.url);
  const ts = require('typescript');
  const source = readFileSync(new URL('../../next.config.ts', import.meta.url), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  const load = env => {
    const exports = {};
    runInNewContext(code, { exports, process: { env } });
    return exports.default;
  };
  for (const mode of [undefined, 'legacy', 'private_cloud', 'public_demo', 'local_personal']) {
    const normal = load({ NODE_ENV: 'production', NEXT_PUBLIC_INVESTATLAS_DEPLOYMENT_MODE: mode });
    assert.equal(normal.distDir, undefined);
    assert.equal(normal.typescript, undefined);
  }
  const local = load({ NODE_ENV: 'production', NEXT_PUBLIC_INVESTATLAS_DEPLOYMENT_MODE: 'local_personal', INVESTATLAS_LOCAL_RUNTIME: 'true' });
  assert.equal(local.distDir, '.next-local');
  assert.equal(local.typescript.tsconfigPath, 'tsconfig.local.json');
  for (const mode of [undefined, 'legacy', 'private_cloud', 'public_demo']) {
    assert.throws(() => load({ NEXT_PUBLIC_INVESTATLAS_DEPLOYMENT_MODE: mode, INVESTATLAS_LOCAL_RUNTIME: 'true' }));
  }
});

test('container alternate ports retain the loopback canonical origin and fixed listener scope', async () => {
  const { localFingerprint, writeLocalBuild, containerConfiguration } = await runtime();
  const root = fixture();
  buildArtifacts(root);
  writeLocalBuild(root, localFingerprint(root, '24.22.3'));
  const base = { NEXT_PUBLIC_INVESTATLAS_DEPLOYMENT_MODE: 'local_personal', INVESTATLAS_LOCAL_RUNTIME: 'true' };
  assert.equal(containerConfiguration(root, base).port, 3000);
  assert.deepEqual(containerConfiguration(root, { ...base, PORT: '3112' }), {
    hostname: '127.0.0.1', listenHost: '0.0.0.0', port: 3112,
  });
});
