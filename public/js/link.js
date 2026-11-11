// "Link a device": two browsers share a short code (typed, or scanned as a QR code) and pass files
// through an encrypted relay. The code never leaves the devices; the server only sees a hash of it
// and AES-GCM ciphertext, so it can't read names, art or audio.

const ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ"; // no 0/O, 1/I/L
const CHUNK = 256 * 1024;

export function newCode() {
  const r = crypto.getRandomValues(new Uint8Array(10));
  const s = [...r].map((b) => ALPHABET[b % ALPHABET.length]).join("");
  return `${s.slice(0, 5)}-${s.slice(5)}`;
}

export const cleanCode = (s) => String(s || "").toUpperCase().replace(/[^0-9A-Z]/g, "").slice(0, 10);
export const prettyCode = (c) => (c.length > 5 ? `${c.slice(0, 5)}-${c.slice(5)}` : c);

async function derive(code) {
  const c = cleanCode(code);
  const enc = new TextEncoder();
  const room = [...new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode("taglet-room:" + c)))]
    .slice(0, 16).map((b) => b.toString(16).padStart(2, "0")).join("");
  const raw = await crypto.subtle.digest("SHA-256", enc.encode("taglet-key:" + c));
  const key = await crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
  return { room, key };
}

/**
 * Join (or open) the room for `code`.
 * handlers: { onPeers(n), onFileStart(meta), onFileProgress(meta, fraction), onFile(file), onClose(reason) }
 */
export async function connect(code, handlers) {
  const { room, key } = await derive(code);
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  const ws = new WebSocket(`${proto}//${location.host}/api/link/${room}`);
  ws.binaryType = "arraybuffer";
  let incoming = null, peers = 0, closedByUs = false;
  let sending = Promise.resolve();

  const seal = async (type, data) => {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const plain = new Uint8Array(1 + data.length);
    plain[0] = type; plain.set(data, 1);
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plain));
    const out = new Uint8Array(12 + ct.length);
    out.set(iv); out.set(ct, 12);
    return out;
  };

  const drain = () => new Promise((res) => {
    const tick = () => (ws.bufferedAmount < 2 * CHUNK || ws.readyState !== 1 ? res() : setTimeout(tick, 30));
    tick();
  });

  // Decryption is async, so messages are handled strictly in order or chunks could land out of sequence.
  let inbox = Promise.resolve();
  ws.addEventListener("message", (e) => { inbox = inbox.then(() => handle(e)).catch(() => {}); });
  const handle = async (e) => {
    if (typeof e.data === "string") {
      peers = JSON.parse(e.data).peers;
      handlers.onPeers?.(peers);
      return;
    }
    const buf = new Uint8Array(e.data);
    let plain;
    try { plain = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: buf.slice(0, 12) }, key, buf.slice(12))); }
    catch { return; } // not for us (wrong code), ignore
    const body = plain.subarray(1);
    if (plain[0] === 0) {
      const msg = JSON.parse(new TextDecoder().decode(body));
      if (msg.kind === "file") { incoming = { meta: msg, chunks: [], got: 0 }; handlers.onFileStart?.(msg); }
      if (msg.kind === "end" && incoming) {
        const f = new File(incoming.chunks, incoming.meta.name, { type: incoming.meta.type, lastModified: Date.now() });
        incoming = null;
        handlers.onFile?.(f);
      }
    } else if (incoming) {
      incoming.chunks.push(body.slice());
      incoming.got += body.length;
      handlers.onFileProgress?.(incoming.meta, incoming.got / incoming.meta.size);
    }
  };

  ws.addEventListener("close", (e) => handlers.onClose?.(closedByUs ? null : e.reason || "The link closed."));

  await new Promise((res, rej) => {
    ws.addEventListener("open", res, { once: true });
    ws.addEventListener("error", () => rej(new Error("Couldn't reach the link service. Check your connection.")), { once: true });
  });

  return {
    get peers() { return peers; },
    /** Send files one after another; onProgress(file, fraction). */
    send(files, onProgress = () => {}) {
      sending = sending.then(async () => {
        for (const file of files) {
          const meta = { kind: "file", name: file.name, type: file.type, size: file.size };
          ws.send(await seal(0, new TextEncoder().encode(JSON.stringify(meta))));
          for (let o = 0; o < file.size; o += CHUNK) {
            const part = new Uint8Array(await file.slice(o, o + CHUNK).arrayBuffer());
            await drain();
            if (ws.readyState !== 1) throw new Error("The other device disconnected.");
            ws.send(await seal(1, part));
            onProgress(file, Math.min(1, (o + part.length) / file.size));
          }
          ws.send(await seal(0, new TextEncoder().encode(JSON.stringify({ kind: "end" }))));
        }
      });
      return sending;
    },
    close() { closedByUs = true; ws.close(); },
  };
}
