# Licensing and source distribution

**Selected license: Apache-2.0.** Standard terms are in [LICENSE](LICENSE).
They apply to original InvestAtlas software the owner is entitled to license.
Third-party works, data and trademarks retain their own terms. The package field
`private: true` prevents accidental npm publication; it does not determine Git
repository visibility or revoke the source license.

The complete source distribution supports Local Personal and owner-operated
Private Cloud; the optional synthetic Demo is one mode. Source licensing does
not supply a hosted account, cloud credentials or market-data entitlements.

## Artwork and external assets

The five current app-icon/favicon files are generated from original, font-free
vector geometry in `public/app-icon.svg`, created during owner-authorized release
preparation on 2026-11-14. The owner approved licensing this source and its
PNG/ICO derivatives under the existing Apache-2.0 selection. Exact source and
output hashes are recorded in [ASSET_PROVENANCE](ASSET_PROVENANCE.json).
Run `npm run icons:generate` to regenerate or `npm run icons:check` to verify
byte-for-byte consistency with the locked sharp 0.35.5 renderer.

The earlier artwork's origin remains unverified. Those bytes are preserved
privately and are excluded from this source distribution; replacement does not clear
historical artwork rights. Unused starter SVGs and legacy gold/silver photos
also remain excluded. The provenance record is an engineering source/derivation
record, not a trademark registration or legal opinion.

The README wordmark reproduces the existing app's Gem-and-text identity. Its
Gem paths retain Lucide's ISC copyright/permission notice in the SVG and in
THIRD_PARTY_NOTICES; it is separate from the original app-icon generator above.
Current README screenshots are actual browser captures with real provider
observations, sources and timestamps, not historical posters or synthetic
portfolio data. Their capture scope is recorded in [docs/media](docs/media/README.md).
Market observations, third-party marks and externally rendered assets retain
their respective terms; these screenshots supply no reusable market-data feed.

Crypto icons and Google Fonts are fetched at runtime, rather than bundled as
cleared project artwork. Their terms and network/privacy implications still
apply. Dependency texts/notices are in [THIRD_PARTY_NOTICES](THIRD_PARTY_NOTICES.md),
including collection input and platform limits. Installation acceptance is not
blanket rights clearance for a source, container or binary release.

## Data and accounts

Apache-2.0 supplies no market-data quota, entitlement or right to redistribute
exchange feeds. Users independently review provider conditions. No owner
portfolio, authentication account, secret, dotenv file or private Git history
belongs in the public export. Private deployment credentials and data backups
remain separate from the source repository.

The canonical setup documents are [README](README.md) and
[SELF_HOSTING](docs/SELF_HOSTING.md). Source packages also carry a reviewed
environment template, asset-provenance record, release status and file manifest.
Those records describe exact files and dated validation; they do not supply
provider rights or credentials for an installation.
