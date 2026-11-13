// Optional accounts, ported from Any Day Now: sign in with an emailed code, Apple, Google or GitHub, so the library
// (albums, tags, order, covers and the audio itself, kept in R2) follows you between devices.
// Sessions are random tokens in an HttpOnly cookie; only their SHA-256 is stored.

const DAY = 86400000;
const SESSION_DAYS = 180;
export const COOKIE = "__Host-taglet_session";
const STATE_COOKIE = "__Host-taglet_oauth";
const STATE_COOKIE_X = "__Host-taglet_oauth_x"; // Apple returns by a cross-site form POST, which Lax cookies skip
const EMAIL_RE = /^[^\s@<>()",;:]{1,64}@[A-Za-z0-9.-]{1,190}\.[A-Za-z]{2,24}$/;

let ready = false;
export async function authDb(env) {
  const db = env.DB;
  if (!ready) {
    await db.batch([
      db.prepare(`CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY, email TEXT UNIQUE, name TEXT, google_sub TEXT UNIQUE, github_id TEXT UNIQUE, apple_sub TEXT UNIQUE,
        created_at INTEGER NOT NULL, seen_at INTEGER NOT NULL)`),
      db.prepare("CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, expires_at INTEGER NOT NULL)"),
      db.prepare("CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions (user_id)"),
      db.prepare("CREATE TABLE IF NOT EXISTS login_codes (email TEXT PRIMARY KEY, code_hash TEXT NOT NULL, expires_at INTEGER NOT NULL, attempts INTEGER NOT NULL DEFAULT 0)"),
      db.prepare("CREATE TABLE IF NOT EXISTS user_data (user_id TEXT PRIMARY KEY, data TEXT NOT NULL, updated_at INTEGER NOT NULL)"),
      db.prepare("CREATE TABLE IF NOT EXISTS covers (user_id TEXT NOT NULL, hash TEXT NOT NULL, data BLOB NOT NULL, PRIMARY KEY (user_id, hash))"),
      db.prepare("CREATE TABLE IF NOT EXISTS audio (user_id TEXT NOT NULL, track_id TEXT NOT NULL, size INTEGER NOT NULL, PRIMARY KEY (user_id, track_id))"),
    ]);
    ready = true;
  }
  return db;
}

const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
const token = (bytes = 32) => hex(crypto.getRandomValues(new Uint8Array(bytes)));
export const sha256 = async (s) => hex(await crypto.subtle.digest("SHA-256", typeof s === "string" ? new TextEncoder().encode(s) : s));

export const providers = (env) => ({
  // EMAIL_SENDING = "off" in wrangler.toml hides email sign-in until the sending domain is verified.
  email: env.EMAIL_SENDING !== "off" && (!!env.RESEND_API_KEY || env.DEV_LOG_CODES === "1"),
  apple: !!(env.APPLE_CLIENT_ID && env.APPLE_TEAM_ID && env.APPLE_KEY_ID && env.APPLE_PRIVATE_KEY),
  google: !!(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET),
  github: !!(env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET),
});

/* ── Cookies ── */
export function readCookie(request, name) {
  const m = (request.headers.get("cookie") || "").match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return m ? decodeURIComponent(m[1]) : null;
}
const cookie = (name, value, maxAgeSec, sameSite = "Lax") => `${name}=${encodeURIComponent(value)}; Path=/; Secure; HttpOnly; SameSite=${sameSite}; Max-Age=${maxAgeSec}`;
export const clearCookie = (name = COOKIE) => cookie(name, "", 0);

// Requests that change account state must be same-origin JSON (blocks cross-site form posts).
export function sameOrigin(request) {
  const origin = request.headers.get("origin");
  const ok = !origin || origin === new URL(request.url).origin;
  return ok && (request.headers.get("content-type") || "").includes("application/json");
}

/* ── Users and sessions ── */
export async function currentUser(env, request) {
  const t = readCookie(request, COOKIE);
  if (!t) return null;
  const db = await authDb(env);
  return (await db.prepare("SELECT u.*, s.expires_at AS session_expires FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ?")
    .bind(await sha256(t), Date.now()).first()) || null;
}

// Sliding sessions: a visit (at most once a week) restarts the 180 days, so people who keep using Taglet stay signed in.
export async function renewSession(env, request, user) {
  const now = Date.now();
  if (!user?.session_expires || user.session_expires - now > (SESSION_DAYS - 7) * DAY) return null;
  const t = readCookie(request, COOKIE);
  await (await authDb(env)).prepare("UPDATE sessions SET expires_at = ? WHERE token_hash = ?").bind(now + SESSION_DAYS * DAY, await sha256(t)).run();
  return cookie(COOKIE, t, SESSION_DAYS * 86400);
}

export const publicUser = (u) => u && ({ email: u.email, name: u.name || "", google: !!u.google_sub, github: !!u.github_id, apple: !!u.apple_sub });

async function startSession(db, userId) {
  const t = token();
  const now = Date.now();
  await db.batch([
    db.prepare("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)").bind(await sha256(t), userId, now + SESSION_DAYS * DAY),
    db.prepare("DELETE FROM sessions WHERE expires_at < ?").bind(now),
    db.prepare("UPDATE users SET seen_at = ? WHERE id = ?").bind(now, userId),
  ]);
  return cookie(COOKIE, t, SESSION_DAYS * 86400);
}

// One account per verified email: Apple, Google or GitHub with the same verified email joins the same account.
async function findOrCreateUser(db, { email, name = "", googleSub = null, githubId = null, appleSub = null }) {
  email = email ? email.toLowerCase() : null;
  let u = null;
  if (googleSub) u = await db.prepare("SELECT * FROM users WHERE google_sub = ?").bind(googleSub).first();
  if (!u && githubId) u = await db.prepare("SELECT * FROM users WHERE github_id = ?").bind(githubId).first();
  if (!u && appleSub) u = await db.prepare("SELECT * FROM users WHERE apple_sub = ?").bind(appleSub).first();
  if (!u && email) u = await db.prepare("SELECT * FROM users WHERE email = ?").bind(email).first();
  const now = Date.now();
  if (!u) {
    const id = token(12);
    await db.prepare("INSERT INTO users (id, email, name, google_sub, github_id, apple_sub, created_at, seen_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(id, email, name.slice(0, 80) || null, googleSub, githubId, appleSub, now, now).run();
    return db.prepare("SELECT * FROM users WHERE id = ?").bind(id).first();
  }
  await db.prepare("UPDATE users SET email = COALESCE(email, ?), name = COALESCE(name, ?), google_sub = COALESCE(google_sub, ?), github_id = COALESCE(github_id, ?), apple_sub = COALESCE(apple_sub, ?) WHERE id = ?")
    .bind(email, name.slice(0, 80) || null, googleSub, githubId, appleSub, u.id).run();
  return db.prepare("SELECT * FROM users WHERE id = ?").bind(u.id).first();
}

/* ── Email code ── */
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
function codeEmail(code) {
  return `<!doctype html><html lang="en"><body style="margin:0;background:#0b0a09;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#f3ece2">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:28px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#141210;border-radius:20px">
<tr><td style="padding:26px 26px 6px;font-weight:700;font-size:17px;letter-spacing:-.02em;color:#46c2b0">taglet</td></tr>
<tr><td style="padding:0 26px"><h1 style="margin:10px 0 14px;font-size:22px;line-height:1.3;color:#f3ece2">Your sign-in code</h1>
<p style="margin:0 0 18px;font:600 34px/1 Menlo,Consolas,monospace;letter-spacing:.12em;color:#f3ece2">${esc(code)}</p>
<p style="margin:0 0 10px;font-size:15px;line-height:1.55;color:#bdb4a7">Type it on Taglet to sign in. It works for 10 minutes.</p>
<p style="margin:0 0 22px;font-size:15px;line-height:1.55;color:#bdb4a7">If you didn’t try to sign in, ignore this email; nothing changes.</p></td></tr>
<tr><td style="padding:16px 26px 24px;border-top:1px solid #27231f;font-size:13px;color:#8e867b">Taglet · your music, tagged right for Spotify · taglet.net</td></tr>
</table></td></tr></table></body></html>`;
}

export async function emailStart(env, rawEmail, take) {
  if (!providers(env).email) throw { status: 503, error: "email_not_configured" };
  const email = String(rawEmail || "").trim().toLowerCase();
  if (!EMAIL_RE.test(email)) throw { status: 400, error: "invalid_email" };
  if (!(await take(`login-email:${email}`, 5))) throw { status: 429, error: "rate_limited" };
  const code = String(crypto.getRandomValues(new Uint32Array(1))[0] % 1000000).padStart(6, "0");
  const db = await authDb(env);
  await db.prepare("INSERT OR REPLACE INTO login_codes (email, code_hash, expires_at, attempts) VALUES (?, ?, ?, 0)")
    .bind(email, await sha256(`${email}:${code}`), Date.now() + 10 * 60000).run();
  if (!env.RESEND_API_KEY && env.DEV_LOG_CODES === "1") { console.log(`[dev] sign-in code for ${email}: ${code}`); return { ok: true }; }
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: env.EMAIL_FROM || "Taglet <hello@taglet.net>", to: [email],
      subject: `${code} is your Taglet sign-in code`,
      text: `Your Taglet sign-in code is ${code}\n\nIt works for 10 minutes. If you didn't try to sign in, ignore this email.`,
      html: codeEmail(code),
    }),
  });
  if (!r.ok) { console.log("resend refused", r.status, (await r.text()).slice(0, 300)); throw { status: 502, error: "email_failed" }; }
  return { ok: true };
}

export async function emailVerify(env, rawEmail, rawCode) {
  const email = String(rawEmail || "").trim().toLowerCase();
  const code = String(rawCode || "").replace(/\D/g, "");
  const db = await authDb(env);
  const row = await db.prepare("SELECT * FROM login_codes WHERE email = ?").bind(email).first();
  if (!row || row.expires_at < Date.now() || row.attempts >= 5) throw { status: 400, error: "code_expired" };
  if (row.code_hash !== (await sha256(`${email}:${code}`))) {
    await db.prepare("UPDATE login_codes SET attempts = attempts + 1 WHERE email = ?").bind(email).run();
    throw { status: 400, error: "wrong_code" };
  }
  await db.prepare("DELETE FROM login_codes WHERE email = ?").bind(email).run();
  const user = await findOrCreateUser(db, { email });
  return { user, setCookie: await startSession(db, user.id) };
}

/* ── Apple, Google and GitHub (OAuth 2.0 authorization code flow) ── */
export function oauthStart(env, request, provider) {
  const origin = new URL(request.url).origin;
  const state = token(16);
  const redirect = `${origin}/api/auth/${provider}/callback`;
  let url;
  if (provider === "google") {
    url = `https://accounts.google.com/o/oauth2/v2/auth?${new URLSearchParams({ client_id: env.GOOGLE_CLIENT_ID, redirect_uri: redirect, response_type: "code", scope: "openid email profile", state, prompt: "select_account" })}`;
  } else if (provider === "apple") {
    url = `https://appleid.apple.com/auth/authorize?${new URLSearchParams({ client_id: env.APPLE_CLIENT_ID.trim(), redirect_uri: redirect, response_type: "code", response_mode: "form_post", scope: "name email", state })}`;
  } else {
    url = `https://github.com/login/oauth/authorize?${new URLSearchParams({ client_id: env.GITHUB_CLIENT_ID, redirect_uri: redirect, scope: "read:user user:email", state, allow_signup: "true" })}`;
  }
  const set = provider === "apple" ? cookie(STATE_COOKIE_X, state, 600, "None") : cookie(STATE_COOKIE, state, 600);
  return new Response(null, { status: 302, headers: { location: url, "set-cookie": set, "cache-control": "no-store" } });
}

export async function oauthCallback(env, request, provider) {
  const url = new URL(request.url);
  const params = request.method === "POST" ? new URLSearchParams(await request.text()) : url.searchParams; // Apple posts a form
  const stateCookie = provider === "apple" ? STATE_COOKIE_X : STATE_COOKIE;
  const state = readCookie(request, stateCookie);
  const back = (q) => new Response(null, { status: 302, headers: [["location", `/${q}`], ["set-cookie", clearCookie(stateCookie)], ["cache-control", "no-store"]] });
  if (!state || params.get("state") !== state || !params.get("code")) return back("?signin=failed");
  const redirect = `${url.origin}/api/auth/${provider}/callback`;
  let profile;
  try {
    profile = provider === "google" ? await googleProfile(env, params.get("code"), redirect)
      : provider === "apple" ? await appleProfile(env, params.get("code"), redirect, params.get("user"))
      : await githubProfile(env, params.get("code"), redirect);
  } catch { return back("?signin=failed"); }
  if (!profile) return back("?signin=failed");
  const db = await authDb(env);
  const user = await findOrCreateUser(db, profile);
  const res = back("?signin=ok");
  res.headers.append("set-cookie", await startSession(db, user.id));
  return res;
}

// Sign in with Apple's client secret is a short-lived ES256 JWT signed with the .p8 key from the Apple Developer account.
async function appleSecret(env, now = Math.floor(Date.now() / 1000)) {
  const b64url = (b) => btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const enc = (o) => b64url(new TextEncoder().encode(JSON.stringify(o)));
  const der = Uint8Array.from(atob(env.APPLE_PRIVATE_KEY.replace(/-----[^-]+-----|\s+|\\n/g, "")), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey("pkcs8", der, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const body = `${enc({ alg: "ES256", kid: env.APPLE_KEY_ID.trim() })}.${enc({ iss: env.APPLE_TEAM_ID.trim(), iat: now, exp: now + 300, aud: "https://appleid.apple.com", sub: env.APPLE_CLIENT_ID.trim() })}`;
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, new TextEncoder().encode(body));
  return `${body}.${b64url(sig)}`;
}
const claimsOf = (jwt) => JSON.parse(atob(jwt.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));

async function appleProfile(env, code, redirect, userJson) {
  const r = await fetch("https://appleid.apple.com/auth/token", {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: env.APPLE_CLIENT_ID.trim(), client_secret: await appleSecret(env), code, grant_type: "authorization_code", redirect_uri: redirect }),
  });
  const j = await r.json();
  if (!j.id_token) return null;
  // Straight from Apple's token endpoint over TLS, so the claims can be read without re-verifying.
  const claims = claimsOf(j.id_token);
  if (claims.aud !== env.APPLE_CLIENT_ID.trim() || !claims.sub) return null;
  let name = ""; // Apple sends the name only on the very first sign-in
  try { const u = JSON.parse(userJson || "{}"); name = [u.name?.firstName, u.name?.lastName].filter(Boolean).join(" "); } catch {}
  const verified = claims.email_verified === true || claims.email_verified === "true";
  return { appleSub: String(claims.sub), email: verified ? claims.email : null, name };
}

async function googleProfile(env, code, redirect) {
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ code, client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET, redirect_uri: redirect, grant_type: "authorization_code" }),
  });
  const j = await r.json();
  if (!j.id_token) return null;
  const claims = claimsOf(j.id_token);
  if (claims.aud !== env.GOOGLE_CLIENT_ID || !claims.sub) return null;
  return { googleSub: String(claims.sub), email: claims.email_verified ? claims.email : null, name: claims.name || "" };
}

async function githubProfile(env, code, redirect) {
  const r = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST", headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify({ client_id: env.GITHUB_CLIENT_ID, client_secret: env.GITHUB_CLIENT_SECRET, code, redirect_uri: redirect }),
  });
  const { access_token } = await r.json();
  if (!access_token) return null;
  const gh = (path) => fetch(`https://api.github.com${path}`, { headers: { authorization: `Bearer ${access_token}`, accept: "application/vnd.github+json", "user-agent": "taglet.net" } }).then((x) => x.json());
  const [user, emails] = await Promise.all([gh("/user"), gh("/user/emails")]);
  if (!user?.id) return null;
  const primary = Array.isArray(emails) ? emails.find((e) => e.primary && e.verified) : null;
  return { githubId: String(user.id), email: primary?.email || null, name: user.name || user.login || "" };
}

/* ── Sign out, delete ── */
export async function signOut(env, request) {
  const t = readCookie(request, COOKIE);
  if (t) await (await authDb(env)).prepare("DELETE FROM sessions WHERE token_hash = ?").bind(await sha256(t)).run();
}

export async function deleteAccount(env, user) {
  const db = await authDb(env);
  await dropAudio(env, user, null);
  await db.batch([
    db.prepare("DELETE FROM sessions WHERE user_id = ?").bind(user.id),
    db.prepare("DELETE FROM user_data WHERE user_id = ?").bind(user.id),
    db.prepare("DELETE FROM covers WHERE user_id = ?").bind(user.id),
    db.prepare("DELETE FROM audio WHERE user_id = ?").bind(user.id),
    db.prepare("DELETE FROM users WHERE id = ?").bind(user.id),
  ]);
}

/* ── The synced library: albums, tags, order and cover references (no audio) ── */
const str = (v, n) => (typeof v === "string" ? v.slice(0, n) : "");
const num = (v) => (Number.isFinite(+v) ? +v : 0);
const ID = /^[a-z0-9]{6,16}$/;
const HASH = /^[0-9a-f]{64}$/;

export function cleanLibrary(input) {
  const tags = (t = {}) => ({
    title: str(t.title, 300), artists: (Array.isArray(t.artists) ? t.artists : []).slice(0, 20).map((a) => str(a, 200)),
    track: num(t.track), disc: num(t.disc), composer: str(t.composer, 300), comment: str(t.comment, 2000), lyrics: str(t.lyrics, 20000),
    bpm: str(String(t.bpm ?? ""), 10), isrc: str(t.isrc, 20), copyright: str(t.copyright, 300), publisher: str(t.publisher, 300),
  });
  const tracks = (Array.isArray(input?.tracks) ? input.tracks : []).slice(0, 3000).filter((t) => ID.test(t?.id) && ID.test(t?.albumId)).map((t) => ({
    id: t.id, albumId: t.albumId, fileName: str(t.fileName, 300), codec: str(t.codec, 20), sampleRate: num(t.sampleRate), duration: num(t.duration),
    build: num(t.build) || undefined, tags: tags(t.tags),
  }));
  const albums = (Array.isArray(input?.albums) ? input.albums : []).slice(0, 500).filter((a) => ID.test(a?.id)).map((a) => ({
    id: a.id, title: str(a.title, 300), albumArtist: str(a.albumArtist, 300), year: str(a.year, 4), genre: str(a.genre, 100), compilation: !!a.compilation,
    trackIds: (Array.isArray(a.trackIds) ? a.trackIds : []).filter((x) => ID.test(x)).slice(0, 500),
    cover: HASH.test(a.cover || "") ? a.cover : null, updatedAt: num(a.updatedAt),
  }));
  const deleted = {};
  for (const [k, v] of Object.entries(input?.deleted || {}).slice(0, 2000)) if (ID.test(k)) deleted[k] = num(v);
  return { albums, tracks, deleted };
}

export async function readLibrary(env, user) {
  const row = await (await authDb(env)).prepare("SELECT data, updated_at FROM user_data WHERE user_id = ?").bind(user.id).first();
  if (!row) return { albums: [], tracks: [], deleted: {}, updatedAt: 0 };
  const lib = JSON.parse(row.data);
  const have = new Set((await (await authDb(env)).prepare("SELECT track_id FROM audio WHERE user_id = ?").bind(user.id).all()).results.map((r) => r.track_id));
  for (const t of lib.tracks) t.audio = have.has(t.id); // whether the song's audio is in the account's storage
  return { ...lib, updatedAt: row.updated_at };
}

export async function writeLibrary(env, user, input) {
  const data = cleanLibrary(input);
  const text = JSON.stringify(data);
  if (text.length > 1_500_000) throw { status: 413, error: "library_too_big" };
  const updatedAt = Date.now();
  const db = await authDb(env);
  const keep = data.albums.map((a) => a.cover).filter(Boolean);
  await dropAudio(env, user, new Set(data.tracks.map((t) => t.id)));
  await db.batch([
    db.prepare("INSERT OR REPLACE INTO user_data (user_id, data, updated_at) VALUES (?, ?, ?)").bind(user.id, text, updatedAt),
    // Covers no album points at any more are dropped.
    db.prepare(`DELETE FROM covers WHERE user_id = ? AND hash NOT IN (SELECT value FROM json_each(?))`).bind(user.id, JSON.stringify(keep)),
  ]);
  return { updatedAt };
}

export async function putCover(env, user, hash, bytes) {
  if (!HASH.test(hash) || bytes.byteLength > 1_800_000) throw { status: 400, error: "bad_cover" };
  if ((await sha256(bytes)) !== hash) throw { status: 400, error: "bad_cover" };
  await (await authDb(env)).prepare("INSERT OR IGNORE INTO covers (user_id, hash, data) VALUES (?, ?, ?)").bind(user.id, hash, bytes).run();
}

export async function getCover(env, user, hash) {
  if (!HASH.test(hash)) return null;
  const row = await (await authDb(env)).prepare("SELECT data FROM covers WHERE user_id = ? AND hash = ?").bind(user.id, hash).first();
  return row ? row.data : null;
}

/* ── Audio: one R2 object per song, capped per account ── */
// R2 is free up to 10 GB across the whole bucket. AUDIO_TOTAL stays well under that, so nobody is ever billed for storage,
// and once it's reached uploads simply stop (songs stay on the device) until space is freed.
export const AUDIO_CAP = 1024 ** 3, AUDIO_TOTAL = 8 * 1024 ** 3, AUDIO_FILE_MAX = 200 * 1024 ** 2;
const audioKey = (user, id) => `${user.id}/${id}`;

/** Removes stored audio for songs no longer in the library (keep = Set of track ids), or all of it when keep is null. */
async function dropAudio(env, user, keep) {
  const db = await authDb(env);
  const ids = (await db.prepare("SELECT track_id FROM audio WHERE user_id = ?").bind(user.id).all()).results.map((r) => r.track_id).filter((id) => !keep?.has(id));
  for (let i = 0; i < ids.length; i += 100) {
    const part = ids.slice(i, i + 100);
    await env.AUDIO.delete(part.map((id) => audioKey(user, id)));
    await db.batch(part.map((id) => db.prepare("DELETE FROM audio WHERE user_id = ? AND track_id = ?").bind(user.id, id)));
  }
}

export async function putAudio(env, user, id, body, size) {
  if (!ID.test(id) || !(size > 0) || size > AUDIO_FILE_MAX) throw { status: 400, error: "bad_audio" };
  const db = await authDb(env);
  const used = (await db.prepare("SELECT COALESCE(SUM(size), 0) AS n FROM audio WHERE user_id = ? AND track_id != ?").bind(user.id, id).first()).n;
  if (used + size > AUDIO_CAP) throw { status: 413, error: "storage_full" };
  const all = (await db.prepare("SELECT COALESCE(SUM(size), 0) AS n FROM audio WHERE NOT (user_id = ? AND track_id = ?)").bind(user.id, id).first()).n;
  if (all + size > AUDIO_TOTAL) throw { status: 413, error: "storage_full" };
  const obj = await env.AUDIO.put(audioKey(user, id), body);
  // The declared length can't be trusted: record and enforce what R2 actually stored.
  if (obj.size > AUDIO_FILE_MAX || used + obj.size > AUDIO_CAP) { await env.AUDIO.delete(audioKey(user, id)); throw { status: 413, error: "storage_full" }; }
  await db.prepare("INSERT OR REPLACE INTO audio (user_id, track_id, size) VALUES (?, ?, ?)").bind(user.id, id, obj.size).run();
}

export async function getAudio(env, user, id, range) {
  if (!ID.test(id)) return null;
  return env.AUDIO.get(audioKey(user, id), range ? { range } : undefined);
}

export async function audioSize(env, user, id) {
  if (!ID.test(id)) return 0;
  const row = await (await authDb(env)).prepare("SELECT size FROM audio WHERE user_id = ? AND track_id = ?").bind(user.id, id).first();
  return Number(row?.size) || 0;
}
