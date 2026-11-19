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

The [InvestAtlas wordmark](investatlas-logo.svg) uses the same two original IA strokes as the [app icon](../../public/app-icon.svg). The monogram and wordmark layout are project artwork under Apache-2.0.

Market observations, third-party marks and rendered fonts retain their own terms. The source license and asset provenance are described in [Licensing](../../LICENSING.md).

## File integrity

| File | SHA-256 |
| --- | --- |
| `bitcoin-desktop.png` | `5629841ad5085bb7dfc1a63b993e405b7b58418e6d346bfb23d9ef872c88bfdb` |
| `etf-desktop.png` | `55bbbc08c2fc2406eed050fdb8a40b030cb62ce3e010164e64f460505f240666` |
| `gold-mobile-de.png` | `5454f1b29760e9a3c54e323a0b2836937f8e3a1a6fc44cddfdd484214629d2e4` |
| `investatlas-logo.svg` | `636d4e0354e6255c268a3caf409c6d4e24d2985036870410543459de6b9dc6be` |
| `metals-iphone-pair.png` | `9acc0b1856580e8fce38f7f424bb86bd2a1ede2fdb738fb6bc9d69b49087efad` |
| `metals-iphone-stage.html` | `0a4619b2e280d79ed227a331ea9170f6a8a4ff448d56fb77abad11f4ef3acf5d` |
| `silver-mobile-ar.png` | `d5944e8ae5e08be1bb85fb66e1c8eb66c2efea9b10a8975ff52e1933d7d5c872` |
