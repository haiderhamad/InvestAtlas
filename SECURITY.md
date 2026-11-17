# Security maintenance and reporting

For a private reporting channel, [contact the maintainer](https://www.linkedin.com/in/haider-hamad/). Keep credentials, authentication tokens and portfolio records out of public issues.

## Dependency review on 2026-11-17

This source release pins Next.js and eslint-config-next to 16.4.6. The previous version, 16.4.3, was in the affected range for the Next.js cache advisory. The advisory lists 16.4.5 as patched. [GitHub advisory](https://github.com/advisories/GHSA-mfr8-8qww-v76h)

A clean installation using the release lockfile returned the following registry results on 2026-11-17.

| Command | Result |
| --- | --- |
| `npm audit --omit=dev` | Zero reported vulnerabilities in the production dependency graph |
| `npm audit` | One High picomatch advisory affecting 49 reported package entries through development dependency chains |

**Open finding.** The registry flags picomatch 2.3.2, 4.0.4 and 4.0.7 in the locked toolchain. GitHub lists versions through 4.0.7 as affected by excessive CPU use during glob matching and lists no patched release. Jest and build tooling account for the affected dependency chains. Use project-controlled glob patterns and configurations when running these tools. Review upstream releases before changing the lockfile. [picomatch advisory](https://github.com/advisories/GHSA-fc5q-39xc-vjpf)

### Production exposure and release decision

Next.js 16.4.6 ships a compiled copy of picomatch in the production server and Docker image. Its JavaScript matched the official release artifact byte for byte. The Next.js release lockfile resolves picomatch to **4.0.1**, within the advisory range. The production npm audit counts separately installed packages and does not cover this bundled copy. [Next.js release lockfile](https://github.com/vercel/next.js/blob/v16.4.6/pnpm-lock.yaml) · [Compiled artifact](https://github.com/vercel/next.js/blob/v16.4.6/packages/next/src/compiled/picomatch/index.js)

The shipped image optimizer compares the requested image path against a fixed local glob (`**`). Its production configuration contains no remote image patterns or domains. In a fresh Local Personal build, two optimized requests for different app icons each compiled the same fixed glob. Requests for the home, Gold chart, Silver chart, settings and protected provider-list route made no observed calls to the bundled matcher. A source review found no application feature through which users could supply the pattern.

**Release decision.** The advisory remains open. We consider the source suitable for publication with the reviewed configuration because the application controls the pattern passed to the matcher. Use trusted project configuration for builds and tests. Reassess exposure when accepting user-defined patterns, changing image or routing rules, or upgrading the framework. Track both the upstream fix and the version bundled by Next.js.

The 2026-11-16 audit reported a Low deepmerge advisory family in Jest. The maintainer chose to retain the test-tool versions and document the finding. The 2026-11-17 registry result omitted that earlier finding without a Jest or deepmerge change. [Earlier advisory](https://github.com/advisories/GHSA-gcqx-w48m-w2h4)

## Repeating the checks

```sh
npm ci
npm audit --omit=dev
npm audit
npm test -- --runInBand
npm run test:local
npm run typecheck
npm run lint
npm run icons:check
```

Audit counts depend on the date and registry. Re-run both scopes when preparing a release and document the result of each separately.
