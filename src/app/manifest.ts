import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "InvestAtlas",
    short_name: "InvestAtlas",
    description:
      "Mobile portfolio tracking, analytics, ledger review, and account overview.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait-primary",
    background_color: "#0b1220",
    theme_color: "#14223a",
    categories: ["finance", "productivity"],
    icons: [
      {
        src: "/app-icon-192.png",
        sizes: "192x192",
        type: "image/png",
      },
      {
        src: "/app-icon-512.png",
        sizes: "512x512",
        type: "image/png",
      },
      {
        src: "/app-icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
    shortcuts: [
      {
        name: "Portfolio",
        url: "/portfolio",
        description: "View your portfolio",
      },
      {
        name: "Transactions",
        url: "/transactions",
        description: "View transactions",
      },
      {
        name: "Analytics",
        url: "/analytics",
        description: "View analytics",
      },
    ],
  };
}
