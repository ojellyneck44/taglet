// Optional account, the same way Any Day Now does it: sign in with an emailed code, Apple, Google or GitHub, and the
// library (albums, tags, order, covers) follows you to every device. Audio files stay on each device. Everything
// works without an account; signing in only adds syncing.

let me = null, providers = { email: false, apple: false, google: false, github: false };
let ui = null; // { openSheet, toast, icon, getLibrary, applyLibrary, coverBlob, setCoverFromBlob }
let pushTimer = 0, pulling = null, lastPull = 0;
const listeners = new Set();
export const currentUser = () => me;
/** Accounts only show up once at least one way to sign in is switched on, so nobody meets a dead-end button. */
export const accountAvailable = () => Object.values(providers).some(Boolean);
export const onAccountChange = (f) => { listeners.add(f); f(me); };
const changed = () => listeners.forEach((f) => f(me));
const ls = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch {} },
  del: (k) => { try { localStorage.removeItem(k); } catch {} },
};
const COVERS_SENT = "taglet-covers-sent", CARD_HIDDEN = "taglet-sync-card";

async function api(path, { method = "GET", body } = {}) {
  const r = await fetch(path, { method, credentials: "same-origin", headers: body ? { "Content-Type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) throw new Error(j.error || "server_error");
  return j;
}

/* ── Sync ── */

async function push() {
  if (!me) return;
  try {
    const lib = ui.getLibrary();
    const sent = new Set(JSON.parse(ls.get(COVERS_SENT) || "[]"));
    for (const a of lib.albums) {
      if (!a.cover || sent.has(a.cover)) continue;
      const blob = ui.coverBlob(a.id);
      if (!blob) continue;
      const r = await fetch(`/api/account/cover/${a.cover}`, { method: "PUT", credentials: "same-origin", body: blob });
      if (r.ok) sent.add(a.cover);
    }
    ls.set(COVERS_SENT, JSON.stringify([...sent].slice(-500)));
    await api("/api/account/library", { method: "PUT", body: lib });
  } catch {}
}
export function schedulePush() { if (!me) return; clearTimeout(pushTimer); pushTimer = setTimeout(push, 1500); }

// Album by album, the newer copy wins; deletions carry a time too, so removing an album on one device sticks.
async function pull() {
  if (!me) return;
  if (pulling) return pulling;
  pulling = (async () => {
    const remote = await api("/api/account/library");
    const covers = {};
    for (const a of remote.albums || []) if (a.cover) covers[a.cover] = () => fetch(`/api/account/cover/${a.cover}`, { credentials: "same-origin" }).then((r) => (r.status === 200 ? r.blob() : null));
    await ui.applyLibrary(remote, covers);
    lastPull = Date.now();
    await push();
  })().catch(() => {}).finally(() => { pulling = null; });
  return pulling;
}

export function initAccount(helpers) {
  ui = helpers;
  const q = new URLSearchParams(location.search);
  const back = q.get("signin");
  if (back) {
    q.delete("signin");
    history.replaceState(null, "", location.pathname + (q.size ? `?${q}` : "") + location.hash);
    if (back === "failed") ui.toast("Sign-in didn’t finish. Try again.", "err");
  }
  addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && me && Date.now() - lastPull > 60000) pull(); });
  return api("/api/auth/me").then(async (r) => {
    providers = r.providers || providers;
    me = r.user || null;
    changed();
    if (me) {
      if (back === "ok") ui.toast(`Signed in. Your albums now sync to ${me.email || "your account"}.`);
      await pull();
    }
  }).catch(() => {});
}

async function signedIn(user) {
  me = user;
  changed();
  await pull();
  ui.toast(`Signed in. Your albums now sync to ${me.email || "your account"}.`);
}

/* ── Sign-in sheet ── */
const LOGOS = {
  apple: '<svg viewBox="0 0 814 1000" width="16" height="18" aria-hidden="true" fill="currentColor"><path d="M788.1 340.9c-5.8 4.5-108.2 62.2-108.2 190.5 0 148.4 130.3 200.9 134.2 202.2-.6 3.2-20.7 71.9-68.7 141.9-42.8 61.6-87.5 123.1-155.5 123.1s-85.5-39.5-164-39.5c-76.5 0-103.7 40.8-165.9 40.8s-105.6-57-155.5-127C46.7 790.7 0 663 0 541.8c0-194.4 126.4-297.5 250.8-297.5 66.1 0 121.2 43.4 162.7 43.4 39.5 0 101.1-46 176.3-46 28.5 0 130.9 2.6 198.3 99.2zm-234-181.5c31.1-36.9 53.1-88.1 53.1-139.3 0-7.1-.6-14.3-1.9-20.1-50.6 1.9-110.8 33.7-147.1 75.8-28.5 32.4-55.1 83.6-55.1 135.5 0 7.8 1.3 15.6 1.9 18.1 3.2.6 8.4 1.3 13.6 1.3 45.4 0 102.5-30.4 135.5-71.3z"/></svg>',
  google: '<svg viewBox="0 0 48 48" width="18" height="18" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>',
  github: '<svg viewBox="0 0 16 16" width="18" height="18" aria-hidden="true" fill="currentColor"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>',
};
const NAMES = { apple: "Apple", google: "Google", github: "GitHub" };
const ERRORS = {
  invalid_email: "That email address doesn’t look right.",
  rate_limited: "Too many tries. Wait a few minutes and try again.",
  wrong_code: "That code isn’t right. Check the email and try again.",
  code_expired: "That code has expired. Send a new one.",
  email_not_configured: "Email sign-in isn’t available right now.",
};
const errText = (e) => ERRORS[e?.message] || "Something went wrong. Try again in a moment.";
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

function sheet(id, title, inner) {
  document.getElementById(id)?.remove();
  const dlg = document.createElement("dialog");
  dlg.className = "sheet glass";
  dlg.id = id;
  dlg.setAttribute("aria-labelledby", `${id}-title`);
  dlg.innerHTML = `<div class="sheet-inner"><div class="sheet-head"><h2 id="${id}-title">${esc(title)}</h2><button class="btn ghost icon-only" type="button" data-close aria-label="Close">${ui.icon("close")}</button></div><div class="sheet-body"></div></div>`;
  dlg.addEventListener("close", () => dlg.remove());
  document.body.append(dlg);
  dlg.querySelector(".sheet-body").innerHTML = inner;
  ui.openSheet(dlg);
  return dlg;
}

export function openSignIn() {
  const oauth = ["apple", "google", "github"].filter((p) => providers[p]);
  const dlg = sheet("signin", "Keep your albums everywhere", "");
  const body = dlg.querySelector(".sheet-body");
  const emailStep = () => {
    body.innerHTML = `
      <ul class="auth-benefits">
        <li>${ui.icon("check")}Your albums, tags and covers on every phone and computer</li>
        <li>${ui.icon("check")}Nothing lost when you clear your browser or switch phones</li>
        <li>${ui.icon("check")}Free, with no password to remember</li>
      </ul>
      ${oauth.map((p) => `<a class="btn ghost big auth-provider" href="/api/auth/${p}">${LOGOS[p]}<span>Continue with ${NAMES[p]}</span></a>`).join("")}
      ${oauth.length && providers.email ? `<p class="auth-or"><span>or</span></p>` : ""}
      ${providers.email ? `<form class="auth-form" novalidate>
        <label class="field"><span>Email</span><input type="email" name="email" autocomplete="email" inputmode="email" placeholder="you@example.com" required aria-describedby="auth-msg"></label>
        <p class="auth-msg" id="auth-msg" role="alert" hidden></p>
        <button class="btn primary big" type="submit">Email me a sign-in code</button>
      </form>` : ""}
      ${!oauth.length && !providers.email ? `<p class="hint-lg">Sign-in isn’t switched on yet. Taglet works fully without it, and your albums stay saved on this device.</p>` : ""}
      <p class="hint">Optional. Audio files stay on each device; the account keeps the tagging work.</p>`;
    const form = body.querySelector("form");
    if (!form) return;
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const input = form.email, msg = body.querySelector("#auth-msg"), btn = form.querySelector("button");
      const email = input.value.trim();
      if (!/^\S+@\S+\.\S+$/.test(email)) { msg.textContent = ERRORS.invalid_email; msg.hidden = false; input.focus(); return; }
      btn.disabled = true; msg.hidden = true;
      try { await api("/api/auth/email/start", { method: "POST", body: { email } }); codeStep(email); }
      catch (err) { btn.disabled = false; msg.textContent = errText(err); msg.hidden = false; }
    });
  };
  const codeStep = (email) => {
    body.innerHTML = `<form class="auth-form" novalidate>
      <p class="hint-lg">We sent a 6-digit code to <strong>${esc(email)}</strong>. It works for 10 minutes.</p>
      <label class="field"><span>Sign-in code</span><input class="mono auth-code" name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="123456" aria-describedby="auth-code-msg"></label>
      <p class="auth-msg" id="auth-code-msg" role="alert" hidden></p>
      <button class="btn primary big" type="submit">Sign in</button>
      <button class="btn ghost small" type="button" data-again>Use a different email</button>
    </form>`;
    const form = body.querySelector("form"), input = form.code, msg = body.querySelector("#auth-code-msg");
    form.querySelector("[data-again]").addEventListener("click", emailStep);
    input.addEventListener("input", () => { input.value = input.value.replace(/\D/g, "").slice(0, 6); if (input.value.length === 6) form.requestSubmit(); });
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const btn = form.querySelector("button[type=submit]");
      btn.disabled = true; msg.hidden = true;
      try { const r = await api("/api/auth/email/verify", { method: "POST", body: { email, code: input.value } }); dlg.close(); await signedIn(r.user); }
      catch (err) { btn.disabled = false; msg.textContent = errText(err); msg.hidden = false; input.select(); }
    });
    input.focus();
  };
  emailStep();
}

export function openAccount() {
  if (!me) return openSignIn();
  const via = [me.apple && "Apple", me.google && "Google", me.github && "GitHub"].filter(Boolean).join(", ");
  const dlg = sheet("account", "Your account", `
    <p class="hint-lg">Signed in as <strong>${esc(me.email || me.name || "you")}</strong>${via ? ` · ${esc(via)}` : ""}</p>
    <p class="hint">Your albums, tags, track order and covers sync to this account. Audio files stay on each device: on a new device, add the files and Taglet matches them to your tracks by name.</p>
    <div class="sheet-actions" style="justify-content:flex-start"><button class="btn ghost" type="button" data-signout>Sign out</button></div>
    <details class="danger-zone"><summary>Delete account</summary>
      <p class="hint">Deletes your account and its synced library from Taglet’s servers. Everything saved on this device stays.</p>
      <button class="btn ghost danger" type="button" data-delete>${ui.icon("trash")}<span>Delete my account</span></button>
    </details>`);
  dlg.querySelector("[data-signout]").addEventListener("click", async () => {
    await api("/api/auth/logout", { method: "POST", body: {} }).catch(() => {});
    me = null; ls.del(COVERS_SENT); changed(); dlg.close();
    ui.toast("Signed out. Your albums stay on this device.");
  });
  dlg.querySelector("[data-delete]").addEventListener("click", async () => {
    try { await api("/api/auth/delete", { method: "POST", body: {} }); } catch { ui.toast("Couldn’t delete the account. Try again.", "err"); return; }
    me = null; ls.del(COVERS_SENT); changed(); dlg.close();
    ui.toast("Account deleted. Your albums stay on this device.");
  });
}

/** The gentle nudge under the album list: only with something worth keeping, and quiet for 30 days after "Not now". */
export function syncCardHidden() { return !!me || Date.now() - Number(ls.get(CARD_HIDDEN) || 0) < 30 * 864e5; }
export function hideSyncCard() { ls.set(CARD_HIDDEN, String(Date.now())); }
