// Shared links: everything is encrypted with AES-GCM on the sender's device before upload. The key goes in the
// link after "#", which browsers never send to a server, so taglet.net only ever stores scrambled bytes.

export const b64url = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
export const unb64url = (s) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));

export const newKeyBytes = () => crypto.getRandomValues(new Uint8Array(16));
export const importKey = (raw) => crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);

export async function seal(key, bytes) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, bytes));
  const out = new Uint8Array(12 + ct.length);
  out.set(iv); out.set(ct, 12);
  return out;
}

export async function unseal(key, bytes) {
  return new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: bytes.subarray(0, 12) }, key, bytes.subarray(12)));
}

/** "https://taglet.net/s/#<id>.<key>" */
export const shareUrl = (id, keyBytes) => `${location.origin}/s/#${id}.${b64url(keyBytes)}`;
