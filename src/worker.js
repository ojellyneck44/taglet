// Static site plus one tiny relay for "Link a device". The relay only ever sees ciphertext:
// the key is derived from the pairing code, which stays in the URL fragment and never reaches the server.
import { DurableObject } from "cloudflare:workers";

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const m = url.pathname.match(/^\/api\/link\/([a-f0-9]{32})$/);
    if (m) {
      if (req.headers.get("Upgrade") !== "websocket") return new Response("Expected a WebSocket", { status: 426 });
      return env.ROOMS.get(env.ROOMS.idFromName(m[1])).fetch(req);
    }
    if (url.pathname.startsWith("/api/")) return new Response("Not found", { status: 404 });
    return env.ASSETS.fetch(req);
  },
};

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
