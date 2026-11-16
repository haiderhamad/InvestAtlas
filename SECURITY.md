# Security maintenance and reporting

## Reporting a vulnerability

For this project, contact the maintainer through the [existing LinkedIn contact](https://www.linkedin.com/in/haider-hamad/) and request a private reporting channel. Do not publish passwords, API keys, authentication tokens or portfolio records in a public issue. Self-hosted operators are responsible for their own instance and credentials.

## Dependency status — 2026-11-16

The release candidate uses locked dependencies and targeted overrides for the fixed glob 14.0.6 and minimatch 11.0.8 lines. Actual Jest execution, coverage instrumentation and ESLint compatibility are checked during release preparation. Runtime and development scopes are audited separately:

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

Fresh registry-backed, lock-only audits on **2026-11-16** reported **zero production advisories** and **one low-severity advisory family across six development package entries**, caused by deepmerge 4.3.1 in Jest configuration/preset merging. npm still publishes deepmerge 4.3.1 as latest, and jest-config 30.5.2 still depends on it. No supported compatible published correction was identified; see the [upstream issue](https://github.com/TehShrike/deepmerge/issues/273) and [reviewed advisory](https://github.com/advisories/GHSA-gcqx-w48m-w2h4). Closing an upstream issue does not establish a released fix. The application source imports no deepmerge, and this package is excluded from the production dependency graph. This is a dated, scoped development finding, not a zero-advisory claim or an owner risk-acceptance declaration.

Test configuration and presets must come from trusted project code. The test runner is a development tool and is not a service for processing uploaded configurations. Upgrading within the current Jest line does not remove its deepmerge dependency. A forced Jest downgrade, mismatched dependency substitution or audit suppression is not a fix. Reassess the advisory and rerun compatibility checks when upstream supplies a supported correction.

Maintainer decision on **2026-11-14**: retain the existing test-tool dependency versions and keep this Low finding documented for now. The finding remains open for an upstream correction; it has not been suppressed or declared fixed. This scoped decision does not authorize source publication or deployment.

Audit output changes over time; the counts above are a dated observation. Do not run `npm audit fix --force` blindly or treat these checks as a complete security certification. Source release authorization and each operator's cloud/API permissions remain separate.
