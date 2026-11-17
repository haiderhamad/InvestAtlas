# README images

The mobile charts were captured on November 17, 2026 in an empty Local Personal workspace running the metals-history update. The ETF and Bitcoin images were captured on November 16 from publication commit `078c838142f60abc3ea59646558a22597e257031`. All four individual screenshots show the running application with approved market sources and actual provider responses.

## Market observations

| Original screenshot | Browser view | Price at capture | Provider observation (UTC) and historical coverage |
| --- | --- | ---: | --- |
| [Gold](gold-mobile-de.png) | German, dark, 430 × 932 | €112.87 / fine gram | Gold API XAU spot, Nov 17 at 19:03. The five-year view has 595 closes through Nov 15. |
| [Silver](silver-mobile-ar.png) | Arabic/RTL, light, 430 × 932 | €1.3836 / fine gram | Gold API XAG spot, Nov 17 at 19:05. The five-year view has 595 closes through Nov 16. |
| [ISWD ETF](etf-desktop.png) | English, dark, 1440px desktop | €60.30 | Yahoo IUSD.DE, Nov 16 at 11:37. The chart has 251 daily observations through Nov 13. |
| [Bitcoin](bitcoin-desktop.png) | English, light, 1440px desktop | €58,362.11 | Gold API indicative USD spot, Nov 16 at 11:56. The chart has 99 Binance BTC/EUR daily observations through Nov 15. |

The app converts metal spot observations to euros per fine gram using ECB reference rates. Each metal chart connects available historical closes from a separate source. Five-year coverage is partial. [Data by Standard Bullion](https://standardbullion.com/market-data).

## Refreshing the mobile images

Start a local production instance using the [quick start](../../README.md#quick-start). Open an empty browser profile, review the provider terms and select Gold API, Standard Bullion and ECB conversion. Set the chart currency to EUR. In these captures Chrome used the iPhone 15 Pro Max device profile with a 430 × 932 CSS-pixel viewport.

Open Gold in German dark mode and Silver in Arabic light mode. Select 5Y, wait for the current quote and historical chart to finish loading, and scroll until the spot price, observation time and curve are visible. Save the viewport at CSS-pixel resolution. Use the dates and coverage the application reports to update both tables and the illustration captions.

The [paired mobile illustration](metals-iphone-pair.png) frames the two original PNGs using the [local HTML layout](metals-iphone-stage.html). To render it, open the layout at 1200 CSS pixels wide and capture the full page. The frames and captions are outside the screenshots.

## Wordmark and notices

The InvestAtlas wordmark reproduces the existing Gem and text identity from `src/components/layout/sidebar.tsx`. Its layout and text are project material under Apache-2.0. The Gem geometry comes from Lucide and retains its ISC notice in the [SVG](investatlas-logo.svg) and [third-party notices](../../THIRD_PARTY_NOTICES.md).

Market observations, third-party marks and rendered fonts retain their own terms. The source license and asset provenance are described in [Licensing](../../LICENSING.md).

## File integrity

| File | SHA-256 |
| --- | --- |
| `bitcoin-desktop.png` | `5629841ad5085bb7dfc1a63b993e405b7b58418e6d346bfb23d9ef872c88bfdb` |
| `etf-desktop.png` | `55bbbc08c2fc2406eed050fdb8a40b030cb62ce3e010164e64f460505f240666` |
| `gold-mobile-de.png` | `5454f1b29760e9a3c54e323a0b2836937f8e3a1a6fc44cddfdd484214629d2e4` |
| `investatlas-logo.svg` | `5afd6a2432f09e704a243239e09b1d15c6cc9cd33b4d0eec514abe02bef340bd` |
| `metals-iphone-pair.png` | `3bb08efa41338f38315573a2a886136925a5a1122887d4dd6b0702f649fd7b90` |
| `metals-iphone-stage.html` | `6cf13f78a854a67954fbf7a13cf871f0270d71aab120dd11e6f45242e6298102` |
| `silver-mobile-ar.png` | `d5944e8ae5e08be1bb85fb66e1c8eb66c2efea9b10a8975ff52e1933d7d5c872` |
