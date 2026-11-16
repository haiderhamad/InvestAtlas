# Source release status — 2026-11-16

The complete **InvestAtlas v1.2.4** application source is published at
[haiderhamad/InvestAtlas](https://github.com/haiderhamad/InvestAtlas).
Application source publication commit:
[`078c838`](https://github.com/haiderhamad/InvestAtlas/commit/078c838142f60abc3ea59646558a22597e257031).
This documentation refresh adds the existing app wordmark, a fuller feature
reference and current real-price desktop/mobile captures. Application,
dependency, build/configuration, icon and test bytes are unchanged.

## Published scope

- All 286 application source files and 216 retained test files, plus the local
  launcher, source-built Docker configuration and self-hosting instructions.
- No private Git ancestry, credentials, owner setup, account or portfolio data.
- Five tests requiring withheld private history/publication-audit inputs are
  excluded; retained functional/security tests were not weakened. Their pass
  does not clear the separate original private historical-marker finding.
- Four legacy posters were removed from the published tip with owner approval;
  existing public history is unchanged. Tip removal does not establish rights
  to earlier artwork. The current README uses new browser captures and an
  explicitly attributed reproduction of the existing app wordmark.

## Independent recovery from GitHub

After the authorized source push, two separate clean HTTPS clones were made
from GitHub at the exact publication commit. Both matched all 546 distribution
files at that checkpoint, with no submodules or LFS pointers. Neither received
application files, dependencies, builds, environment files or credentials from
an older checkout.

| Path | Actual verification |
| --- | --- |
| Node.js | Clean npm ci; Node 24.22.3 / npm 11.19.1, macOS ARM64 |
| Tests | 215 Jest suites / 1,838 tests and 12 local-launcher tests passed |
| Production launcher | Cold npm run local build/start, 15 HTTP checks, clean Ctrl+C and cached restart with the same build ID |
| Docker | Independent no-cache Compose source build; official Node 24, resolved runtime 24.22.3, Linux ARM64 |
| Container boundaries | Non-root UID 1000, loopback publication, no host mounts, dropped capabilities, no-new-privileges; deepmerge physically absent |
| Docker lifecycle | 15 HTTP checks, clean stop with exit 0, restart of the same container/image, repeated HTTP checks |
| Browser | Real sourced ISWD quote, 251 annual observations, finite desktop/mobile chart curves and no horizontal overflow in tested views |

These checks concern the application published in 078c838. This later
README/assets/status refresh does not change runtime inputs; it receives scoped
link, image, manifest and factual review instead of claiming another full build.
The new images show real provider responses in an empty workspace, with exact
sources, times, history limits and language/theme details in
[docs/media](docs/media/README.md).

## Known findings and limits

- The 2026-11-16 registry audit found zero production advisories and one Low
  deepmerge/Jest development family across six affected entries. The maintainer
  chose to retain it as documented; no suppression or dependency substitution
  was added. See [SECURITY](SECURITY.md).
- Initial full-source staging exposed 729 inherited whitespace diagnostics in
  62 files, including preserved dependency notice text. Affected bytes matched
  the approved package. They were recorded rather than silently reformatted or
  reported as a passing whitespace check. No project hook or test was bypassed.
- Prices are dated provider observations. History can be partial; raw equity
  series may disable indicators. Gold/silver spot supplies no metal history.
- Clean-install acceptance is scoped to the platforms above. Physical-phone
  price/chart acceptance, Windows, broad accessibility, new cloud deployment,
  two-account isolation and real personal API-key plans are separate scopes.
- Installation acceptance is not universal ownership, licensing or financial
  accuracy clearance. Data feeds and third-party works keep their own terms.

## Publication boundary

The owner explicitly authorized the public source commit/push and repository
description update. No history rewrite, private-repository push, registry image
upload or hosted deployment was included. The inspected hosting projects had
no new deployment from the source publication. Each installation must review
its own Git/hosting connection before a source update.
