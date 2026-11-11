// Static site plus two small APIs. Neither can read what it carries:
// - /api/link/:room relays "Link a device" traffic; the key comes from the pairing code, which never reaches us.
// - /api/share stores shared albums for 30 days, encrypted on the sender's device; the key lives in the link's
//   #fragment, which browsers never send to a server.
import { DurableObject } from "cloudflare:workers";
import * as auth from "./auth.js";

const SHARE_TTL = 30 * 24 * 60 * 60; // seconds
const MAX_PART = 24 * 1024 * 1024; // KV values top out at 25 MiB
const PART = /^(meta|art|t\d{1,3})$/;

// Daily limits, reset at midnight UTC. Per person (by IP address) so one sender can't fill the store, and an
// overall cap that keeps the whole site under Workers KV's free 1,000 writes a day.
const LIMITS = {
  links: 15,                     // new share links per person
  uploads: 300,                  // files uploaded per person (an album of 12 is about 14)
  bytes: 750 * 1024 * 1024,      // megabytes uploaded per person
  writes: 950,                   // KV writes for everyone together
};

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const m = url.pathname.match(/^\/api\/link\/([a-f0-9]{32})$/);
    if (m) {
      if (req.headers.get("Upgrade") !== "websocket") return new Response("Expected a WebSocket", { status: 426 });
      return env.ROOMS.get(env.ROOMS.idFromName(m[1])).fetch(req);
    }
    if (url.pathname.startsWith("/api/share")) return share(req, env, url);
    if (url.pathname.startsWith("/api/auth/") || url.pathname.startsWith("/api/account/")) return account(req, env, url);
    if (url.pathname.startsWith("/api/")) return new Response("Not found", { status: 404 });
    return env.ASSETS.fetch(req);
  },
};

const text = (body, status) => new Response(body, { status, headers: { "Content-Type": "text/plain; charset=utf-8" } });
const sha = async (s) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)))].map((b) => b.toString(16).padStart(2, "0")).join("");
const rand = (n, abc) => [...crypto.getRandomValues(new Uint8Array(n))].map((b) => abc[b % abc.length]).join("");

/** Spend `amount` from this period's allowance for `scope` (per day, or per hour); false when it would go over. */
async function take(env, scope, amount, limit, per = "day") {
  const period = new Date().toISOString().slice(0, per === "hour" ? 13 : 10);
  return env.QUOTA.get(env.QUOTA.idFromName(`${scope}:${period}`)).take(amount, limit);
}
function tooMany(message) {
  const midnight = new Date(); midnight.setUTCHours(24, 0, 0, 0);
  return new Response(message, { status: 429, headers: { "Content-Type": "text/plain; charset=utf-8", "Retry-After": String(Math.ceil((midnight - Date.now()) / 1000)) } });
}
const BUSY = "Sharing is very busy today. Try again tomorrow; the album stays saved in Taglet.";

async function share(req, env, url) {
  const [, , , id, part] = url.pathname.split("/"); // /api/share/:id/:part
  const ip = req.headers.get("CF-Connecting-IP") || "unknown";
  if (req.method === "POST" && !id) {
    if (!(await take(env, `links:${ip}`, 1, LIMITS.links))) return tooMany(`You’ve made ${LIMITS.links} share links today, which is the daily limit. Try again tomorrow, or update a link you already made.`);
    if (!(await take(env, "writes", 1, LIMITS.writes))) return tooMany(BUSY);
    const newId = rand(12, "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789");
    const token = rand(32, "0123456789abcdef");
    await env.SHARES.put(`s:${newId}:token`, await sha(token), { expirationTtl: SHARE_TTL });
    return Response.json({ id: newId, token });
  }
  if (!/^[A-Za-z0-9]{12}$/.test(id || "")) return text("Not found", 404);

  if (req.method === "GET" && PART.test(part || "")) {
    const body = await env.SHARES.get(`s:${id}:${part}`, "stream");
    // 204 rather than 404: a gone link is a normal answer here, not an error for the browser console.
    if (!body) return new Response(null, { status: 204, headers: { "Cache-Control": "no-cache" } });
    return new Response(body, { headers: { "Content-Type": "application/octet-stream", "Cache-Control": "no-cache" } });
  }

  // Changes need the token handed out when the link was made.
  const stored = await env.SHARES.get(`s:${id}:token`);
  const given = (req.headers.get("Authorization") || "").replace(/^Bearer /, "");
  if (!stored || !given || stored !== (await sha(given))) return text("Not allowed", 403);

  if (req.method === "PUT" && PART.test(part || "")) {
    const size = +req.headers.get("Content-Length");
    if (!size || size > MAX_PART) return text("Each file has to be under 24 MB.", 413);
    if (!(await take(env, `uploads:${ip}`, 1, LIMITS.uploads)) || !(await take(env, `bytes:${ip}`, size, LIMITS.bytes)))
      return tooMany("You’ve reached today’s sharing limit for this connection. It resets at midnight UTC.");
    if (!(await take(env, "writes", part === "meta" ? 2 : 1, LIMITS.writes))) return tooMany(BUSY);
    await env.SHARES.put(`s:${id}:${part}`, req.body, { expirationTtl: SHARE_TTL });
    // Writing the track list (always last) restarts the 30 days for the whole link.
    if (part === "meta") await env.SHARES.put(`s:${id}:token`, stored, { expirationTtl: SHARE_TTL });
    return new Response(null, { status: 204 });
  }
  if (req.method === "DELETE" && !part) {
    const { keys } = await env.SHARES.list({ prefix: `s:${id}:` });
    await Promise.all(keys.map((k) => env.SHARES.delete(k.name)));
    return new Response(null, { status: 204 });
  }
  return text("Not found", 404);
}

// Accounts (same design as Any Day Now):
//   GET  /api/auth/me → { user, providers }        POST /api/auth/email/start { email }, /email/verify { email, code }
//   GET  /api/auth/apple | google | github → provider sign-in, then …/callback (Apple's is a form POST)
//   POST /api/auth/logout, /api/auth/delete
//   GET/PUT /api/account/library                   the synced library (albums, tags, order, cover references)
//   GET/PUT /api/account/cover/:sha256             cover images, stored once each
async function account(req, env, url) {
  const json = (body, status = 200, extra = {}) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...extra } });
  const withCookie = (res, c) => { res.headers.append("set-cookie", c); return res; };
  const route = url.pathname.replace(/^\/api\//, "");
  const method = req.method;
  const ip = req.headers.get("CF-Connecting-IP") || "unknown";
  try {
    if (route === "auth/me" && method === "GET") {
      const user = await auth.currentUser(env, req);
      const res = json({ user: auth.publicUser(user), providers: auth.providers(env) });
      const renewed = await auth.renewSession(env, req, user).catch(() => null);
      return renewed ? withCookie(res, renewed) : res;
    }
    const provider = route.match(/^auth\/(apple|google|github)$/)?.[1];
    if (provider && method === "GET") {
      if (!auth.providers(env)[provider]) return json({ error: "not_configured" }, 503);
      return auth.oauthStart(env, req, provider);
    }
    const back = route.match(/^auth\/(apple|google|github)\/callback$/)?.[1];
    if (back && (method === "GET" || (back === "apple" && method === "POST"))) return auth.oauthCallback(env, req, back);

    // Covers are binary; everything else that changes state is same-origin JSON.
    const cover = route.match(/^account\/cover\/([0-9a-f]{64})$/)?.[1];
    if (cover) {
      const user = await auth.currentUser(env, req);
      if (!user) return json({ error: "signed_out" }, 401);
      if (method === "GET") {
        const data = await auth.getCover(env, user, cover);
        return data ? new Response(new Uint8Array(data), { headers: { "Content-Type": "image/jpeg", "Cache-Control": "private, max-age=31536000, immutable" } }) : new Response(null, { status: 204 });
      }
      if (method === "PUT") {
        const origin = req.headers.get("origin");
        if (origin && origin !== url.origin) return json({ error: "forbidden" }, 403);
        await auth.putCover(env, user, cover, await req.arrayBuffer());
        return new Response(null, { status: 204 });
      }
    }
    if (route === "account/library" && method === "GET") {
      const user = await auth.currentUser(env, req);
      return user ? json(await auth.readLibrary(env, user)) : json({ error: "signed_out" }, 401);
    }
    if (!["POST", "PUT"].includes(method)) return json({ error: "not_found" }, 404);
    if (!auth.sameOrigin(req)) return json({ error: "forbidden" }, 403);
    const body = await req.json().catch(() => ({}));
    if (route === "account/library" && method === "PUT") {
      const user = await auth.currentUser(env, req);
      return user ? json(await auth.writeLibrary(env, user, body)) : json({ error: "signed_out" }, 401);
    }
    if (route === "auth/email/start") {
      if (!(await take(env, `login-ip:${ip}`, 1, 10, "hour"))) return json({ error: "rate_limited" }, 429);
      return json(await auth.emailStart(env, body.email, (scope, limit) => take(env, scope, 1, limit, "hour")));
    }
    if (route === "auth/email/verify") {
      const { user, setCookie } = await auth.emailVerify(env, body.email, body.code);
      return withCookie(json({ user: auth.publicUser(user) }), setCookie);
    }
    if (route === "auth/logout") { await auth.signOut(env, req); return withCookie(json({ ok: true }), auth.clearCookie()); }
    if (route === "auth/delete") {
      const user = await auth.currentUser(env, req);
      if (!user) return json({ error: "signed_out" }, 401);
      await auth.deleteAccount(env, user);
      return withCookie(json({ ok: true }), auth.clearCookie());
    }
    return json({ error: "not_found" }, 404);
  } catch (e) {
    return json({ error: e?.error || "server_error" }, e?.status || 500);
  }
}

/** One counter per scope per day. It deletes itself a day later, so nothing about anyone is kept. */
export class Quota extends DurableObject {
  async take(amount, limit) {
    const used = (await this.ctx.storage.get("used")) || 0;
    if (used + amount > limit) return false;
    await this.ctx.storage.put("used", used + amount);
    if (!(await this.ctx.storage.getAlarm())) await this.ctx.storage.setAlarm(Date.now() + 26 * 3600 * 1000);
    return true;
  }
  async alarm() { await this.ctx.storage.deleteAll(); }
}

export class Room extends DurableObject {
  async fetch() {
    const peers = this.ctx.getWebSockets();
    if (peers.length >= 2) return new Response("This code is already in use by two devices.", { status: 409 });
    const [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server);
    this.broadcast();
    return new Response(null, { status: 101, webSocket: client });
  }

  webSocketMessage(ws, msg) {
    if (typeof msg === "string") return; // only the server speaks in text; peers send encrypted binary
    for (const other of this.ctx.getWebSockets()) if (other !== ws) other.send(msg);
  }

  webSocketClose(ws) { ws.close(); this.broadcast(); }
  webSocketError(ws) { this.broadcast(); }

  broadcast() {
    const all = this.ctx.getWebSockets().filter((w) => w.readyState === WebSocket.OPEN);
    for (const w of all) w.send(JSON.stringify({ peers: all.length }));
  }
}
