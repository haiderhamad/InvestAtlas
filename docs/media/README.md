# README images

Current InvestAtlas v1.2.4 interface, captured on **2026-11-16** from source
publication commit `078c838142f60abc3ea59646558a22597e257031`.

## Actual market observations

All four PNG files are direct browser screenshots from an empty Local Personal
workspace with explicitly approved public sources. No prices, candles, holdings
or provider labels were injected or mocked. No personal portfolio or API keys
were used. The screenshots include source/time and coverage states.

| Image | View | Price visible at capture | Provider observation (UTC) |
| --- | --- | --- | --- |
| `etf-desktop.png` | English, dark, 1440px desktop | ISWD / IUSD.DE: EUR 60.30 | Yahoo, 2026-11-16 11:37; 251 daily observations through Nov 13 |
| `bitcoin-desktop.png` | English, light, 1440px desktop | BTC: EUR 58,362.11 | Gold API indicative USD spot, 2026-11-16 11:56; Binance BTC/EUR daily history through Nov 15, 99 observations |
| `gold-mobile-de.png` | German, dark, 390 × 1100px | Gold: EUR 112.84 per fine gram | Gold API indicative XAU spot, 2026-11-16 11:57 |
| `silver-mobile-ar.png` | Arabic/RTL, light, 390 × 1100px | Silver: EUR 1.3875 per fine gram | Gold API indicative XAG spot, 2026-11-16 11:58 |

USD spot observations are displayed in EUR using the app's sourced FX conversion;
metal units are converted to fine grams. Spot quotes and historical candles are
separate inputs. The metal views honestly show unavailable history. Limited
stock/crypto history and raw-series indicator restrictions remain visible.
Screenshots record past observations; prices and available coverage change.

## Wordmark and notices

`investatlas-logo.svg` reproduces the existing app's Gem + InvestAtlas +
Shariah-aware identity from `src/components/layout/sidebar.tsx`, using the
project's blue/navy palette. Layout and text are project material under
Apache-2.0. Gem path geometry comes from the existing `lucide-react@0.577.0`
dependency under ISC. Its copyright and permission notice are embedded in the
SVG; the complete dependency notices remain in
[THIRD_PARTY_NOTICES](../../THIRD_PARTY_NOTICES.md).
No font file, remote script or external image is embedded in the SVG.

Screenshots depict the app with its normal third-party marks and rendered fonts.
Those assets and market observations retain their terms as described in
[LICENSING](../../LICENSING.md). The images do not grant feed redistribution or
supply a continuously updated data service. Original historical posters are not
reused in the current README.

## Refreshing captures

Start a clean local instance using the root README. Review the current provider
terms, deliberately activate permitted sources and keep personal account data
out of the screenshot profile. Open Charts for ISWD, BTC, Gold and Silver; use
the visible theme/language controls. Wait for quote/history loading and chart
animation to finish. Capture the real interface with source, unit, observation
time and coverage labels intact. Update this table and hashes when recapturing.

## File integrity

| File | SHA-256 |
| --- | --- |
| `bitcoin-desktop.png` | `5629841ad5085bb7dfc1a63b993e405b7b58418e6d346bfb23d9ef872c88bfdb` |
| `etf-desktop.png` | `55bbbc08c2fc2406eed050fdb8a40b030cb62ce3e010164e64f460505f240666` |
| `gold-mobile-de.png` | `7f0b9b9cb74e199fb67ac491500aa3ee4ab7a198ad39bdc9951fceb384f44079` |
| `investatlas-logo.svg` | `5afd6a2432f09e704a243239e09b1d15c6cc9cd33b4d0eec514abe02bef340bd` |
| `silver-mobile-ar.png` | `aa5dabe1045b84ecfc3c7c9c3071c5406de66480d5a6e826f12c1a594a51a80c` |
