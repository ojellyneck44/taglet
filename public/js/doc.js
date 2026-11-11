// Shared by the document pages: keep the reader's accent, and on the Spotify guide, point at their platform first.
try { const t = localStorage.getItem("taglet-tint"); if (t) document.documentElement.dataset.tint = t; } catch {}
{
  const ua = navigator.userAgent;
  const p = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1) ? "iphone" : /Android/.test(ua) ? "android" : "desktop";
  document.querySelector(`[data-p="${p}"]`)?.classList.add("here");
}
if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
