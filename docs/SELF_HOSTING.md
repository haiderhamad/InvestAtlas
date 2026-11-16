# InvestAtlas self-hosting

The full application supports Local Personal and single-owner Private Cloud.
Public Demo is an optional synthetic read-only deployment. Current app icons
have documented original source and reproducible derivatives (see
[LICENSING](../LICENSING.md)).
Do not reuse another installation's credentials or deploy onto an unrelated
Firebase project. The local launcher explicitly selects Local Personal;
ordinary hosting builds require an explicit mode.

## Mode A: Personal on localhost

### Recommended launcher

Install patched Node.js **24.22.3+ within Node 24** (the `.nvmrc` preference), or
**26.13.1+ within Node 26**, then run these commands from the checkout:

```sh
npm ci
npm run local
```

Open **http://127.0.0.1:3000** and stop with **Ctrl+C**. The JavaScript launcher
works without POSIX environment-assignment syntax, so its commands also suit
PowerShell. It forces the Local Personal mode for build/start, binds loopback
and keeps its output in `.next-local`, using `tsconfig.local.json`. Missing or
changed input/build identity triggers a rebuild; an interrupted or failed build
does not leave a reusable success stamp. Windows and physical-device acceptance are separate from the documented
macOS Node and Linux ARM64 container checks.

Use `npm run local:build` to rebuild without starting. Use
`npm run local -- --port 3010` only when deliberately choosing another origin.
A port conflict produces an error rather than silently opening another browser
workspace. An exclusive `.next-local-lock` directory prevents overlapping local
commands. If the process was forcibly killed, confirm it has stopped before
removing that leftover directory. The launcher does not install dependencies,
set up cloud accounts or activate data providers automatically.

### Docker Compose

With Docker and Compose running, no host Node/npm installation is needed:

```sh
docker compose up --build
```

Open **http://127.0.0.1:3000**. The multi-stage image builds from source and runs
as the non-root `node` user. The container listener is isolated behind a
loopback-only host publication; no owner file mounts, Firebase service or
credentials are included. Portfolio records still live in the browser.

If port 3000 is occupied, create an untracked `.env` beside `compose.yaml` with:

```dotenv
INVESTATLAS_PORT=3010
```

Run the same Compose command, then open http://127.0.0.1:3010. This one variable
sets the canonical app port, container listener and loopback host mapping to the
same integer (1024–65535). It preserves the existing Origin/Host checks. Do not
change only one side of the mapping or publish to all interfaces. Compose's
[variable interpolation](https://docs.docker.com/compose/how-tos/environment-variables/variable-interpolation/)
reads this local setting; other dotenv values are not automatically forwarded
into the image or container.

Stop with **Ctrl+C**; `docker compose down` removes this Compose service/network.
After updating source, use `docker compose up --build` again. No restart policy
is imposed. Provider consent and optional keys remain user actions in the app.
The first image build needs network access for the official Node base image and
locked npm dependencies; live prices require network access afterward.
This packaging does not enable WLAN access.

For either installation route, keep the **same browser profile and URL**.
`localhost`, `127.0.0.1`, a LAN IP and different ports have distinct browser
storage. A Docker volume does not back up localStorage/IndexedDB, and a phone
does not share the desktop portfolio. Use and verify the CSV export/restore
workflow described below before relying on a backup.

### Manual setup and existing behavior

1. On a trusted computer, install the project's supported Node.js runtime
   and dependencies using `npm ci`. No Firebase account is required.
2. Start only on the loopback network interface, e.g.:

   ```sh
   NEXT_PUBLIC_INVESTATLAS_DEPLOYMENT_MODE=local_personal npm run dev -- --hostname 127.0.0.1
   ```

   Or build and start a local production bundle with the **same mode**:

   ```sh
   NEXT_PUBLIC_INVESTATLAS_DEPLOYMENT_MODE=local_personal npm run build
   NEXT_PUBLIC_INVESTATLAS_DEPLOYMENT_MODE=local_personal npm run start -- --hostname 127.0.0.1
   ```

3. Visit `http://127.0.0.1:3000`. New browsers default to the Local
   Workspace; existing explicit Demo choice is preserved. Transactions,
   accounts, watchlists and settings use the browser's local storage. They are
   not copied to the operator's Firestore.
4. Use **Settings → Account → Account data** to export and restore a
   CSV. A disposable Chrome session has verified the *actual UI flow*:
   two synthetic accounts, a EUR cash deposit, a stock purchase with
   settlement venue and a watchlist were downloaded, cleared from the test
   browser and restored successfully. Automated roundtrip tests also cover
   205 transactions and explicit duplicate/conflict rejection. A Local
   Personal CSV import is limited to **2 MiB and 1,000 rows**; it no
   longer inherits the **200 account+transaction record** cloud-batch
   limit. Cloud imports still enforce that lower limit. Larger exports may
   not be re-importable as a single file: always verify your own backup.
   Portable imports restore manual account/transaction data, watchlists
   and supported settings, **not** personal API keys, AI analysis or
   historical market prices. Browser storage is **not encrypted at rest**
   and can be erased by browser cleanup, extensions, malware or device
   loss. This is single-browser persistence, not multi-device/server sync.
5. The local runtime **disables Firebase authentication** and blocks
   Firebase-owned API routes. Instead, under **Settings → Data & Sync →
   Data Sources**, a dedicated **Tiingo** connection accepts a personal key
   held only in this tab's JavaScript memory. The key is submitted per request
   to a fixed Tiingo endpoint through the same-origin loopback-only route
   `/api/local/tiingo/series`; neither server nor browser persists it.
   Supported instrument coverage remains limited to the explicit Tiingo
   allowlist; ISWD's Xetra quote is not supported.
6. Under the same settings, the local **AI provider** section permits
   explicit session-only keys for OpenAI, Gemini, OpenRouter or Groq, with
   a model ID when required. A successful connection test keeps the key in
   tab memory, and the existing transaction-import dialog can submit an
   explicitly selected document to the chosen provider through
   `/api/local/transactions/import`. Imported transactions remain
   **uncommitted until user review and confirmation**. Failed tests do not
   save the key. Switching to the read-only Demo Snapshot clears the
   tab's personal Tiingo/AI keys.
7. Server access to both BYOK bridges requires exact browser Origin and
   Host agreement on an **HTTP loopback host and port**. Internal Next.js
   normalization of `127.0.0.1` to `localhost` is accepted only when
   both independently remain loopback; cross-site or Vercel requests are
   rejected. Requests are bounded, rate limited, never redirected to
   arbitrary user URLs, and the API keys are not written to disk. Ordinary
   public data endpoints may still call their providers when used; this
   is **not an offline application**. Local browser data remain unencrypted
   and are not multi-device synchronized.

**Security:** The `local_personal` mode has no remote login gate. Never
expose it on a public interface or tunnel. Bind to loopback by default; the
explicit trusted-WLAN public-data exception below is opt-in. A malicious
browser extension or another local user with browser profile access may read
local data.

### Optional phone access over trusted WLAN

For public Yahoo stock/ETF prices, historical candles and instrument lookup,
`local_personal` can explicitly allow one home-network origin. Set the
**server-only runtime** variable `INVESTATLAS_LOCAL_YAHOO_LAN_ORIGIN` to this
computer's exact HTTP RFC1918 IPv4 origin, including its non-default port.
Bind the server to that same IP. For example, after building in local mode:

```sh
NEXT_PUBLIC_INVESTATLAS_DEPLOYMENT_MODE=local_personal \
INVESTATLAS_LOCAL_YAHOO_LAN_ORIGIN=http://192.168.1.50:3000 \
npm run start -- --hostname 192.168.1.50 --port 3000
```

Replace the example IP with the computer's actual WLAN address. Open
`http://192.168.1.50:3000` on the phone in the same trusted WLAN. Keep the
computer and server running. Choose public sources in that phone's tab when
needed; source approval and local portfolios are device/browser-specific.
This does not synchronize holdings, keys or history from the desktop.

Only the three public Yahoo read routes gain this exception. They require
exact Request URL, browser Origin and Host agreement; forwarded headers do
not authorize access. Missing Fetch Metadata is accepted for HTTP Safari,
but cross-site/same-site metadata is refused. Wildcards, DNS names, public
addresses, HTTPS, paths and comma-separated origins are rejected. Unset the
variable and restart to restore loopback-only Yahoo. If the IP changes,
update the variable and bind address, then use the new URL.

Tiingo/AI key bridges and document import remain **loopback-only**, and
private-cloud/public-demo policies are unchanged. The shared Yahoo request
limits remain in force. HTTP is unencrypted and this mode has no LAN login:
other clients on that trusted WLAN may reach the app and bounded public
quote endpoints. Never use untrusted/guest Wi-Fi, a public bind, router port
forwarding or a tunnel. For remote access, use a separately configured
authenticated private-cloud instance. HTTP LAN does not provide secure-context
PWA installation/service-worker features; use the browser tab for this flow.

## Mode B: Own private cloud (Vercel or another compatible Node host)

**Do not use a production/shared Firebase project.** Set up a **new Firebase
project under your control** and configure its Firebase Authentication (Google
or email/password) and Firestore. Note: Firebase's web configuration is not
itself a secret, but any server-admin credentials and personal BYOK keys are.

On your private hosting account, configure:

- `NEXT_PUBLIC_INVESTATLAS_DEPLOYMENT_MODE` as `private_cloud`.
- All six `NEXT_PUBLIC_FIREBASE_...` web-app configuration values for
  **your own** project (refer to the checked-in example environment file).
- `INVESTATLAS_PRIVATE_OWNER_UID` as your **exact** Firebase Auth user UID.
  This is a server-only variable. **Do not use a public-prefixed variant**.
  A missing/invalid UID causes protected API calls to fail closed.
- If a feature needs encrypted provider storage on your server, configure
  **your own** provider encryption vault and Firebase service credentials,
  never the operator's. Leave such features disabled if unsure.

Protect the hosting deployment with **real deployment authentication**,
not merely an unshared URL. Enable MFA for your Vercel and Firebase
administrators. Run Firestore Security Rules that restrict all client
access to the same single UID:

```sh
mkdir -p .private
node scripts/render-private-firestore-rules.mjs YOUR_FIREBASE_OWNER_UID > .private/firestore.rules
```

The generator validates the UID and preserves existing transactional
ownership/shape checks. Inspect the resulting policy before deploying it.
Create a local ignored `.private/firebase.json` containing:

```json
{"firestore":{"rules":"firestore.rules"}}
```

Only after confirming the **target Firebase project** and reviewing the
generated rules, deploy them via your own Firebase CLI session:

```sh
npx firebase-tools deploy --only firestore:rules --config .private/firebase.json --project YOUR_FIREBASE_PROJECT_ID
```

Never deploy the general shared `firestore.rules` into a personal
single-user project in place of the owner-restricted variant. The
`.private/` folder is ignored by Git. Keep credentials out of shell
history, screenshots, repository commits and published hosting settings.

### Build and start your own cloud installation

After configuring the variables above in your own hosting environment (or an
ignored `.env.local` for a local cloud-mode check), keep `private_cloud` at both
build and runtime:

```sh
npm ci
npm run build
npm run start -- --hostname 127.0.0.1
```

On Vercel, use the normal Next.js build configuration and your own protected
project/environment variables. The explicit `start` command is for a Node host
behind your own protected reverse proxy. Do not use `npm run local` or the local
Docker Compose image for a Private Cloud deployment: those explicitly select
Local Personal. No real account or live deployment is created by a build test.

### Optional local Firestore rule checks

With Java 21+ available, the package scripts use pinned Firebase CLI 15.24.0;
the first run may download CLI/emulator files. They use disposable demo projects,
not your production Firebase data:

```sh
npm run test:rules
npm run test:rules:private
```

These commands start and stop local emulators and check canonical/owner-only
policies. They do not deploy rules. A passing emulator check does not replace a
real two-account test on your own protected cloud installation.

The Next.js `src/proxy.ts` independently verifies bearer-token identity on
private account, AI, financial-data, transaction and prices API routes,
rejecting missing credentials, unknown owner UID and other Firebase users
before the request reaches the handler. Routes not requiring private data
still use public behavior. This **complements but never replaces** your
Firestore Rules and Vercel Deployment Protection.

**Production release gates still open:**

- Verify the service-account/Firestore project pair belongs to the same
  user-owned project and no browser can access the operator's project.
- Run a real **two-account Firestore and API isolation E2E** test, including
  denial of the unapproved second user, both through Firestore Rules and
  direct API requests.
- Configure distributed quota controls or adequate deployment protection;
  identity verification alone is not a rate limiter.
- Confirm Firebase auth authorized domains, Google OAuth redirect setup,
  secret handling, legal/privacy disclosures and EN/DE/AR mobile UX.
- The Firestore Emulator has been executed successfully on the connected
  engineering machine using a command-scoped Homebrew OpenJDK 21 path.
  The generated private-owner rules passed 99 local emulator assertions with
  synthetic owner, other-user and anonymous identities. **This is not a
  hosted Firebase two-real-account test**, which remains a release gate.
- Never claim fully private cloud access merely because a URL is unpublished.

## Mode C: Operator Public Demo (future public launch)


Use `NEXT_PUBLIC_INVESTATLAS_DEPLOYMENT_MODE=public_demo` **explicitly at build
and start time** for the operator's read-only synthetic public site. This mode
turns off Firebase Auth, prevents selection of an editable local workspace,
replaces login and signup with an informational Demo page and denies all
`/api/*` HTTP requests at the server proxy. The Demo must not expose
personal accounts, user BYOK or an operator-funded live financial-data feed.

Omitting the variable still preserves **legacy** behavior, including
historical hosting/auth integration; it is **not equivalent to** `public_demo`.
The already deployed public site is **not migrated automatically**;
a separate authenticated test deployment and the visitor-facing `public_demo`
release must be distinguished by actual hosting environment and domain.
Any change to the existing site needs separate owner authorization and final
live release acceptance. Local production
HTTP/Chrome tests verified selected routes and Demo UI only, not every server
entry point, outbound network request, browser, or device.

This app is not a replacement for provider licenses: synthetic Demo status
does not authorize real provider key use or market-data redistribution.

## Provider / finance and AI

In `local_personal` and `private_cloud`, **Settings → Data & Sync → Data Sources → My market data** lists connectable sources and explicit coverage/backup limits. No public price source is contacted before deliberate tab-session approval (now session v3). Yahoo supplies last reported market prices and completed EOD history for the catalog and individually resolved EUR/USD stock/ETF listings. It remains unofficial; approval does not grant Yahoo data rights. Gold API supplies indicative physical gold/silver USD spot per fine troy ounce and BTC/ETH USD spot. CoinPaprika supplies the exact 27 catalog cryptocurrencies through one bounded bulk request; separately approved CoinGecko is a low-frequency spot fallback for 26 fresh coins (stale MATIC remains unavailable and is never replaced by POL). Crypto batches are reused in tab memory for up to 15 minutes. ECB reference rates support sourced USD/EUR conversion, including inverse conversion for EUR-native listings displayed in USD. A provider failure never invents prices, history, volume or returns.

Optional personal **Tiingo**, **Twelve Data**, **Market Data API** and **EODHD** keys remain in tab memory. Tiingo/Twelve Data retain 13 catalog US stock/ETF listings; Tiingo also supports BTC/ETH daily data. Market Data adds a batched SmartMid path for those catalog US listings and independently verified custom US identities. SmartMid is a calculated indicative midpoint, not an exchange last trade/NBBO; actual source timestamps determine its recent/delayed label. Each symbol consumes a credit. For a compatible current price, users can select “My connections first” and Market Data as preferred. EODHD is history-only here and does not take over live prices. No verified independent free physical-metal backup is connected. Optional Binance BTC/EUR and ETH/EUR and Kraken BTC/USD and ETH/USD remain completed daily-history sources; their exact fiat currency is preserved. The official Twelve Data `demo` AAPL sample cannot value portfolios. Prices refresh on request. Public Demo stays synthetic and provider-isolated; arbitrary custom endpoints remain disabled. Review current in-app source descriptions and your provider plan for capability and retention limits.

### Personal securities and reusable daily history

**Asset Checks → My securities** (also under Data Sources) searches and resolves an exact stock/ETF listing before the user chooses **Track for review**. EUR/USD currency, exchange, class and provider symbol must match. Listing metadata survives account CSV export/import as a hint; each adapter still validates its source independently. Added securities remain `insufficient_data` until separate Shariah evidence exists. Finding a price never produces a Halal decision. Unresolved existing records can be selected for resolution; unsupported records stay stored without suppressing other prices.

Optional EODHD supports exact US, Xetra, Amsterdam and USD London counterparts. Its free account provides **one trailing year and 20 calls/day**, with two calls per history download (identity lookup plus candles). Choose five years only when your own plan includes it. The local/private server forwards the key to fixed `eodhd.com` endpoints, never persists it, and redacts upstream failures. The server's conservative budget is process-local; provider-account limits remain authoritative.

The initial durable cache uses **IndexedDB on each device** in both Local Personal and Private Cloud. It separates owner, installation, listing/venue, provider, native currency, interval and adjustment. Only licensed EODHD candles and ECB reference rates enter durable storage. Yahoo ranges reuse tab memory; the other providers gain no new permanent retention. There is no Firestore/server history collection or cross-device synchronization. Browser eviction is possible: this cache is not a portfolio backup.

Charts request 1/3/5 years explicitly and expose **5Y**. Repeated requests reuse checked ranges; only gaps and a small recent overlap refresh. EODHD/ECB storage can be read after disconnecting the EODHD key. Limited or failed-refresh coverage remains visible, without manufacturing missing sessions. Raw/unadjusted candles stay excluded from derived return/AI calculations; adjusted close remains separate. Long FX conversions reuse dated ECB data in bounded chunks instead of today's rate. Clear the market cache in settings to discard retained data, including before a deliberate complete reload after source corrections.

With EODHD connected, optional idle preload handles at most eight compatible held/watched symbols per session, sequentially after foreground price requests. It stops on hiding the page, owner/source changes or provider failure; it never adds polling. Unwarmed assets load on first chart request. Disconnect/reload/sign-out clears credentials and source approval, while licensed history remains until cache/account deletion. Cache deletion fences late writes, including across tabs; an unconfirmed durable deletion is reported as a failure.

Personal BYOK support varies by provider and deployment mode. In
`local_personal`, dedicated, loopback-only Tiingo and fixed-endpoint
AI test/document-import routes work **without Firebase** using session-only
keys; they are distinct from the existing authenticated Firebase Cloud
provider vault and its routes. Local personal AI document import **requires
the user to select, upload, inspect and explicitly accept extracted rows**
before anything enters their local portfolio. No AI processing occurs merely
because a document exists locally. Generic custom API endpoints remain
disabled until reviewed: a public server must not fetch arbitrary user URLs
because of SSRF and secret-exfiltration risks. Open-source client libraries
do not grant rights to external source data.

## Pre-release checklist

- [ ] Local workflow works in an independent browser profile, on loopback,
      with no Firebase configuration and no forbidden backend calls.
- [ ] Existing Data Sync export/import restores exact local transactions,
      accounts, settings, and preserves venue attribution.
- [ ] Private cloud works in an isolated owner Firebase/Vercel test
      account; Firestore Rules Emulator and manual two-user checks pass.
- [ ] Public existing production and protected Preview are unchanged.
- [ ] Finance provider rights, ISWD and GOLD history limitations are
      truthfully represented; no fictional valuation.
- [ ] English/German/Arabic desktop/iPhone/RTL acceptance, privacy, security
      headers, rate limits, provenance and full build/test suite pass.
- [ ] License and bundled assets/market data, secrets, Git history, release
      notes and documented installation tested before owner approves any
      public source publication.

## Source and dependency maintenance

The canonical public project address is https://github.com/haiderhamad/InvestAtlas.
Keep source updates and hosted deployments separate: installing new source
does not automatically update another user's private instance. A Git-connected
host can deploy automatically on pushes to its configured repository/branches;
review that connection before updating a live installation.

After `npm ci`, `npm run icons:check` validates the original SVG and all shipped
PNG/ICO hashes. `npm run icons:generate` regenerates them using the locked sharp
renderer without fonts or remote artwork. Source and derivation evidence is in
`ASSET_PROVENANCE.json`; the replaced historical artwork remains excluded.

Use `npm audit --omit=dev` for the runtime dependency tree and `npm audit` for
the complete development tree. The 2026-11-14 refresh fixes the glob/minimatch
findings with targeted overrides. The unpatched low-severity deepmerge finding
remains visible through Jest configuration: [security status](../SECURITY.md).
Do not use `npm audit fix --force` as an installation step; audit results and
compatibility tests must be reviewed together when updating the lockfile.
