// Static site plus two small APIs. Neither can read what it carries:
// - /api/link/:room relays "Link a device" traffic; the key comes from the pairing code, which never reaches us.
// - /api/share stores shared albums for 30 days, encrypted on the sender's device; the key lives in the link's
//   #fragment, which browsers never send to a server.
import { DurableObject } from "cloudflare:workers";

const SHARE_TTL = 30 * 24 * 60 * 60; // seconds
const MAX_PART = 24 * 1024 * 1024; // KV values top out at 25 MiB
const PART = /^(meta|art|t\d{1,3})$/;

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const m = url.pathname.match(/^\/api\/link\/([a-f0-9]{32})$/);
    if (m) {
      if (req.headers.get("Upgrade") !== "websocket") return new Response("Expected a WebSocket", { status: 426 });
      return env.ROOMS.get(env.ROOMS.idFromName(m[1])).fetch(req);
    }
    if (url.pathname.startsWith("/api/share")) return share(req, env, url);
    if (url.pathname.startsWith("/api/")) return new Response("Not found", { status: 404 });
    return env.ASSETS.fetch(req);
  },
};

const text = (body, status) => new Response(body, { status, headers: { "Content-Type": "text/plain; charset=utf-8" } });
const sha = async (s) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)))].map((b) => b.toString(16).padStart(2, "0")).join("");
const rand = (n, abc) => [...crypto.getRandomValues(new Uint8Array(n))].map((b) => abc[b % abc.length]).join("");

async function share(req, env, url) {
  const [, , , id, part] = url.pathname.split("/"); // /api/share/:id/:part
  if (req.method === "POST" && !id) {
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
  // ponytail: no per-IP rate limit; add one with a Durable Object counter if the links get abused.
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
