import { createServer } from 'node:http';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertLocalNodeVersion, containerConfiguration } from './local-runtime.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

async function main() {
  assertLocalNodeVersion(process.versions.node);
  const { hostname, listenHost, port } = containerConfiguration(root, process.env);
  const { default: next } = await import('next');
  // Keep Next's canonical request URL loopback. Only the container listener
  // uses all interfaces; Compose publishes it on the host's loopback only.
  // No request headers or application authorization checks are rewritten.
  const app = next({ dev: false, dir: root, hostname, port });
  await app.prepare();
  const handle = app.getRequestHandler();
  const server = createServer((request, response) => {
    Promise.resolve(handle(request, response)).catch(() => {
      console.error('InvestAtlas: local request failed.');
      if (!response.headersSent) { response.statusCode = 500; response.end('Request failed'); }
      else response.destroy();
    });
  });
  server.once('error', error => {
    console.error(`InvestAtlas: container listener failed (${error.code ?? 'server error'}).`);
    process.exitCode = 1;
    app.close().catch(() => {});
  });
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.once(signal, () => {
      const timeout = setTimeout(() => process.exit(1), 10_000).unref();
      server.close(() => {
        app.close().then(() => { clearTimeout(timeout); process.exitCode = 0; })
          .catch(() => { clearTimeout(timeout); process.exitCode = 1; });
      });
      server.closeIdleConnections();
    });
  }
  server.listen(port, listenHost, () => console.log(`InvestAtlas: open http://127.0.0.1:${port}.`));
}

main().catch(error => { console.error(`InvestAtlas: ${error.message}`); process.exitCode = 1; });
