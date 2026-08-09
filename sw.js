const CACHE_PREFIX = "tatiara-test-spray-rate-calculator-shell-";
const LEGACY_CACHE_PREFIX = "tatiara-test-spray-rate-calculator-shell-legacy-";
const CACHE_NAME = `${CACHE_PREFIX}v14-2026-08-09-audit-repair`;
const APP_SHELL = [
  "./",
  "./index.html",
  "./app.js",
  "./config.mjs",
  "./manifest.webmanifest",
  "./brand-mark.png",
  "./robots.txt",
  "./styles/shell.css",
  "./styles/settings.css",
  "./styles/spray.css",
  "./styles/weather.css",
  "./styles/work-notes.css",
  "./modules/storage.mjs",
  "./modules/navigation.mjs",
  "./modules/paddock-library.mjs",
  "./modules/product-records.mjs",
  "./modules/paddock-balance.mjs",
  "./modules/paddock-lifecycle.mjs",
  "./modules/paddock-export.mjs",
  "./modules/paddock-runs.mjs",
  "./modules/pdf-lib-loader.mjs",
  "./modules/share-files.mjs",
  "./modules/settings-app.mjs",
  "./modules/settings-template.mjs",
  "./modules/spray-template.mjs",
  "./modules/spray-app.mjs",
  "./modules/work-notes-ai-demo.mjs",
  "./modules/work-notes-ai-client.mjs",
  "./modules/work-notes-ai.mjs",
  "./modules/work-notes-template.mjs",
  "./modules/work-notes-logic.mjs",
  "./modules/work-notes-export.mjs",
  "./modules/work-notes-app.mjs",
  "./modules/weather/links.mjs",
  "./modules/weather/weather-app.mjs",
  "./vendor/pdf-lib.min.js",
  "./vendor/pdf-lib.LICENSE.md",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys
          .filter((key) =>
            (key.startsWith(CACHE_PREFIX) || key.startsWith(LEGACY_CACHE_PREFIX)) &&
            key !== CACHE_NAME,
          )
          .map((key) => caches.delete(key)),
      ))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) caches.open(CACHE_NAME).then((cache) => cache.put("./index.html", response.clone()));
          return response;
        })
        .catch(() => caches.match("./index.html")),
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => cached || fetch(request).then((response) => {
      if (response.ok) caches.open(CACHE_NAME).then((cache) => cache.put(request, response.clone()));
      return response;
    })),
  );
});
