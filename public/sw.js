// Same approach as Any Day Now: network-first app shell, so every online load gets the newest build and the
// cache is only an offline fallback. The audio engine and fonts never change at a given URL, so they're cache-first.
const CACHE = "taglet-v17";
const SHELL = [
  "/", "/css/base.css", "/css/app.css", "/js/app.js", "/js/engine.js", "/js/tags.js", "/js/link.js",
  "/manifest.webmanifest", "/icon.svg", "/icon-192.png", "/apple-touch-icon.png",
  "/fonts/hanken.woff2", "/fonts/bricolage.woff2", "/fonts/jbmono.woff2",
  "/vendor/motion-12.43.0.js", "/vendor/qrcode.js",
  "/vendor/ffmpeg/index.js", "/vendor/ffmpeg/classes.js", "/vendor/ffmpeg/const.js", "/vendor/ffmpeg/errors.js",
  "/vendor/ffmpeg/types.js", "/vendor/ffmpeg/utils.js", "/vendor/ffmpeg/worker.js", "/vendor/core/ffmpeg-core.js",
  "/spotify/", "/privacy/", "/guides/", "/about/", "/contact/", "/terms/",
];
const IMMUTABLE = /^\/(vendor|fonts)\//;

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE)
    .then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: "reload" }))))
    .then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== CACHE && k !== "taglet-share").map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return;

  // Android share sheet -> Taglet: stash the files, then open the app, which picks them up.
  if (e.request.method === "POST" && url.pathname === "/share") {
    e.respondWith((async () => {
      const form = await e.request.formData();
      const c = await caches.open("taglet-share");
      for (const f of form.getAll("files")) {
        if (typeof f === "string") continue;
        await c.put(`/shared/${crypto.randomUUID()}`, new Response(f, { headers: { "content-type": f.type, "x-name": encodeURIComponent(f.name) } }));
      }
      return Response.redirect("/?shared=1", 303);
    })());
    return;
  }

  if (e.request.method !== "GET" || url.pathname.startsWith("/api/")) return;
  const key = e.request.mode === "navigate" ? (url.pathname.endsWith("/") ? url.pathname : url.pathname + "/") : url.pathname;

  e.respondWith(caches.open(CACHE).then(async (cache) => {
    if (IMMUTABLE.test(url.pathname)) {
      const hit = await cache.match(url.pathname);
      if (hit) return hit;
      const res = await fetch(e.request);
      if (res.ok) e.waitUntil(cache.put(url.pathname, res.clone()));
      return res;
    }
    try {
      const fresh = await fetch(new Request(url.href, { cache: "no-cache", credentials: "same-origin" }));
      if (fresh.ok) e.waitUntil(cache.put(key, fresh.clone()));
      return fresh;
    } catch (err) {
      const hit = (await cache.match(key)) || (e.request.mode === "navigate" && (await cache.match("/")));
      if (hit) return hit;
      throw err;
    }
  }));
});
