import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertLocalNodeVersion, createLocalEnvironment, LOCAL_DIST, LOCAL_STAMP,
  localFingerprint, parseLocalArguments, readLocalBuild, writeLocalBuild } from './local-runtime.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function runNode(args, env, cwd) {
  return new Promise((accept, reject) => {
    const child = spawn(process.execPath, args, { cwd, env, shell: false, stdio: 'inherit' });
    const signals = ['SIGINT', 'SIGTERM'];
    const handlers = signals.map(signal => () => child.kill(signal));
    signals.forEach((signal, index) => process.on(signal, handlers[index]));
    const clean = () => signals.forEach((signal, index) => process.off(signal, handlers[index]));
    child.once('error', error => { clean(); reject(error); });
    child.once('exit', (code, signal) => { clean(); accept(code ?? (signal === 'SIGINT' ? 130 : 143)); });
  });
}

export async function buildLocal(directory, env, run, nodeVersion) {
  // An interrupted rebuild must not leave an apparently valid old stamp.
  rmSync(join(directory, LOCAL_DIST, LOCAL_STAMP), { force: true });
  const fingerprint = localFingerprint(directory, nodeVersion);
  const steps = [
    [join(directory, 'scripts/export-messages.js')],
    [join(directory, 'scripts/check-i18n-coverage.js')],
    [join(directory, 'node_modules/next/dist/bin/next'), 'build', '--webpack'],
  ];
  for (const args of steps) {
    const code = await run(args, env, directory);
    if (code !== 0) throw new Error(`Local build stopped (exit ${code}). Fix the reported error and run npm run local again.`);
  }
  if (localFingerprint(directory, nodeVersion) !== fingerprint) {
    throw new Error('Local build inputs changed during compilation. Run npm run local again.');
  }
  writeLocalBuild(directory, fingerprint);
}

async function requireFreePort(port) {
  await new Promise((accept, reject) => {
    const probe = createServer();
    probe.once('error', error => reject(new Error(error.code === 'EADDRINUSE'
      ? `Port ${port} is in use. Stop that server or choose --port NUMBER. Changing the port creates a different browser workspace.`
      : `Cannot listen on 127.0.0.1:${port} (${error.code ?? 'network error'}).`)));
    probe.listen(port, '127.0.0.1', () => probe.close(accept));
  });
}

async function main() {
  const options = parseLocalArguments(process.argv.slice(2));
  if (options.help) {
    console.log('npm ci\nnpm run local [-- --port 3010]\nnpm run local:build\n\nBuilds when necessary, then serves Local Personal at http://127.0.0.1:3000.\nStop with Ctrl+C. No Firebase account is required.');
    return;
  }
  assertLocalNodeVersion(process.versions.node);
  const env = createLocalEnvironment(process.env);
  if (!existsSync(join(root, 'node_modules/next/dist/bin/next'))
    || !existsSync(join(root, 'node_modules/typescript/package.json'))) {
    throw new Error('Dependencies are missing. Run npm ci in this directory, then npm run local.');
  }
  const lock = join(root, '.next-local-lock');
  try { mkdirSync(lock); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    throw new Error('Another local command is running. If it previously crashed, confirm it has stopped before removing .next-local-lock.');
  }
  try {
    writeFileSync(join(lock, 'pid'), String(process.pid) + '\n');
    if (!options.buildOnly) await requireFreePort(options.port);
    if (options.buildOnly || !readLocalBuild(root, localFingerprint(root, process.versions.node))) {
      console.log('Preparing the Local Personal production build…');
      await buildLocal(root, env, runNode, process.versions.node);
    }
    if (options.buildOnly) { console.log('Local Personal build ready. Start it with npm run local.'); return; }
    console.log(`Open http://127.0.0.1:${options.port} in the same browser each time. Stop with Ctrl+C.`);
    process.exitCode = await runNode([join(root, 'node_modules/next/dist/bin/next'), 'start',
      '--hostname', '127.0.0.1', '--port', String(options.port)], env, root);
  } finally { rmSync(lock, { recursive: true, force: true }); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(`InvestAtlas: ${error.message}`); process.exitCode = 1; });
}
