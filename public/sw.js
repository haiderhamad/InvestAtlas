const CACHE_NAME = "investatlas-pwa-v3";
const SHELL_ASSETS = [
  "/",
  "/manifest.webmanifest",
  "/app-icon.svg",
  "/app-icon-192.png",
  "/app-icon-512.png",
  "/apple-touch-icon.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(SHELL_ASSETS))
      .catch(() => undefined),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;

  if (request.method !== "GET") {
    return;
  }

  const url = new URL(request.url);

  if (url.origin !== self.location.origin || url.pathname.startsWith("/api/")) {
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(async () => {
        if (url.pathname === "/") {
          const cachedHome = await caches.match("/");

          if (cachedHome) {
            return cachedHome;
          }
        }

        return new Response(
          "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>InvestAtlas offline</title><style>body{margin:0;background:#0b1220;color:#f8fafc;font-family:system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;display:grid;min-height:100vh;place-items:center;padding:24px}main{max-width:460px}p{color:#cbd5e1;line-height:1.55}.ar{direction:rtl;text-align:right;border-top:1px solid #334155;margin-top:24px;padding-top:24px}</style></head><body><main><section><h1>InvestAtlas is offline</h1><p>The app is installed, but live data and portfolio analysis require a network connection.</p></section><section class=\"ar\" lang=\"ar\"><h1>InvestAtlas غير متصل</h1><p>التطبيق مثبّت، لكن البيانات المباشرة وتحليل المحفظة يتطلبان اتصالاً بالإنترنت.</p></section></main></body></html>",
          {
            headers: {
              "Content-Type": "text/html; charset=utf-8",
            },
          },
        );
      }),
    );
    return;
  }

  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(
      caches.match(request).then((response) => {
        return (
          response ||
          fetch(request).then((networkResponse) => {
            const copy = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
            return networkResponse;
          })
        );
      }),
    );
    return;
  }

  if (
    url.pathname === "/manifest.webmanifest" ||
    url.pathname.startsWith("/app-icon") ||
    url.pathname === "/apple-touch-icon.png"
  ) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          return response;
        })
        .catch(() => caches.match(request)),
    );
  }
});
