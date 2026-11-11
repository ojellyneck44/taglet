// Shared by the document pages: on the Spotify guide, point at the reader's platform first.
{
  const ua = navigator.userAgent;
  const p = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1) ? "iphone" : /Android/.test(ua) ? "android" : "desktop";
  document.querySelector(`[data-p="${p}"]`)?.classList.add("here");
}
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js", { updateViaCache: "none" }).catch(() => {});
  const had = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener("controllerchange", () => { if (had) location.reload(); });
}
// Opened from the Home Screen app: same app behaviour as the editor (no zoom, no pull-to-refresh).
if (matchMedia("(display-mode: standalone)").matches || navigator.standalone === true) {
  document.documentElement.setAttribute("data-native", "");
  document.querySelector('meta[name="viewport"]')?.setAttribute("content", "width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no,viewport-fit=cover");
}
