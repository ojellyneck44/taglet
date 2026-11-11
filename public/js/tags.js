// Pure helpers with no browser APIs, so `node public/js/tags.test.mjs` can check them.
// ID3v2.3 writing (the version Spotify reads most reliably), ffmetadata parsing and a store-only zip.

const te = new TextEncoder();

function utf16(str) {
  // UTF-16LE with BOM: safe for any script, and every ID3v2.3 reader understands it.
  const out = new Uint8Array(2 + str.length * 2);
  out[0] = 0xff; out[1] = 0xfe;
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    out[2 + i * 2] = c & 0xff; out[3 + i * 2] = c >> 8;
  }
  return out;
}

function concat(parts) {
  const len = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(len);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

function frame(id, body) {
  const head = new Uint8Array(10);
  head.set(te.encode(id), 0);
  new DataView(head.buffer).setUint32(4, body.length); // v2.3 frame sizes are plain 32-bit, not syncsafe
  return concat([head, body]);
}

const textFrame = (id, value) => frame(id, concat([Uint8Array.of(1), utf16(value)]));
const langFrame = (id, value) => frame(id, concat([Uint8Array.of(1), te.encode("eng"), utf16(""), Uint8Array.of(0, 0), utf16(value)]));

/** Artists are kept as a list in the editor and written the way Spotify shows them: "X, Y, Z". */
export const joinArtists = (list) => list.map((a) => a.trim()).filter(Boolean).join(", ");

/**
 * Build an ID3v2.3 tag.
 * t: { title, artists[], album, albumArtist, track, trackTotal, disc, discTotal, year, genre, composer,
 *      comment, lyrics, bpm, isrc, copyright, publisher, compilation, encodedBy }
 * art: { bytes: Uint8Array, mime } or null
 */
export function buildId3(t, art) {
  const frames = [];
  const add = (id, v) => { if (v !== undefined && v !== null && String(v).trim() !== "") frames.push(textFrame(id, String(v).trim())); };
  add("TIT2", t.title);
  add("TPE1", joinArtists(t.artists || []));
  add("TALB", t.album);
  add("TPE2", t.albumArtist);
  if (t.track) add("TRCK", t.trackTotal ? `${t.track}/${t.trackTotal}` : t.track);
  if (t.disc) add("TPOS", t.discTotal ? `${t.disc}/${t.discTotal}` : t.disc);
  add("TYER", t.year);
  add("TCON", t.genre);
  add("TCOM", t.composer);
  add("TBPM", t.bpm);
  add("TSRC", t.isrc);
  add("TCOP", t.copyright);
  add("TPUB", t.publisher);
  add("TENC", t.encodedBy);
  if (t.compilation) add("TCMP", "1");
  if (t.comment && t.comment.trim()) frames.push(langFrame("COMM", t.comment.trim()));
  if (t.lyrics && t.lyrics.trim()) frames.push(langFrame("USLT", t.lyrics.trim()));
  if (art && art.bytes?.length) {
    // encoding 0, mime, picture type 3 (front cover), empty description
    frames.push(frame("APIC", concat([Uint8Array.of(0), te.encode(art.mime || "image/jpeg"), Uint8Array.of(0, 3, 0), art.bytes])));
  }
  const body = concat(frames);
  const padding = new Uint8Array(512); // room for players that like to edit in place
  const size = body.length + padding.length;
  const head = Uint8Array.of(0x49, 0x44, 0x33, 3, 0, 0,
    (size >> 21) & 0x7f, (size >> 14) & 0x7f, (size >> 7) & 0x7f, size & 0x7f);
  return concat([head, body, padding]);
}

/** Byte range of the MP3 audio once any ID3v2 tags at the start and an ID3v1 tag at the end are removed. */
export function mp3AudioRange(bytes) {
  let start = 0;
  // Some files carry more than one ID3v2 tag back to back.
  while (bytes.length >= start + 10 && bytes[start] === 0x49 && bytes[start + 1] === 0x44 && bytes[start + 2] === 0x33) {
    const size = (bytes[start + 6] << 21) | (bytes[start + 7] << 14) | (bytes[start + 8] << 7) | bytes[start + 9];
    const footer = bytes[start + 5] & 0x10 ? 10 : 0;
    start += 10 + size + footer;
  }
  let end = bytes.length;
  if (end - start >= 128 && bytes[end - 128] === 0x54 && bytes[end - 127] === 0x41 && bytes[end - 126] === 0x47) end -= 128;
  // ponytail: APEv2 footers are left in place; they're rare in MP3s and Spotify ignores them.
  return [start, end];
}

/** Parse ffmpeg's `-f ffmetadata` output (global section only) into a plain object with lowercase keys. */
export function parseFfmetadata(text) {
  const out = {};
  const lines = text.replace(/\\\r?\n/g, "\u0000").split(/\r?\n/);
  for (const line of lines) {
    if (line.startsWith("[")) break; // stream/chapter sections follow the global tags
    if (!line || line.startsWith(";") || line.startsWith("#")) continue;
    const m = line.match(/^((?:\\.|[^=\\])+)=(.*)$/);
    if (!m) continue;
    const un = (s) => s.replace(/\\(.)/g, "$1").replace(/\u0000/g, "\n");
    const key = un(m[1]).toLowerCase();
    if (!(key in out)) out[key] = un(m[2]);
  }
  return out;
}

const SHARED = ["artists", "album", "albumArtist", "year", "genre", "composer", "publisher", "copyright", "trackTotal", "discTotal", "compilation"];
const hasValue = (v) => (Array.isArray(v) ? v.length > 0 : !!v);

/** Songs imported together share what one of them knows: within each album (files with no album tag join
 *  the batch's album when there is exactly one), empty fields are filled from the song with the most tags.
 *  Titles, numbers, lyrics and other per-song fields are never copied. Mutates the tags objects. */
export function fillBatch(list) {
  const albumOf = (t) => (t.album || "").trim().toLowerCase();
  const named = new Set(list.map(albumOf).filter(Boolean));
  const groups = new Map();
  for (const t of list) {
    const k = albumOf(t) || (named.size === 1 ? [...named][0] : "");
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(t);
  }
  const score = (t) => Object.entries(t).filter(([k, v]) => k !== "title" && hasValue(v)).length;
  for (const g of groups.values()) {
    if (g.length < 2) continue;
    const best = g.reduce((a, b) => (score(b) > score(a) ? b : a));
    for (const t of g) for (const k of SHARED) if (!hasValue(t[k]) && hasValue(best[k])) t[k] = Array.isArray(best[k]) ? [...best[k]] : best[k];
  }
}

/** "3/12" -> [3, 12]; "03" -> [3, 0] */
export function splitNumber(v) {
  const [a, b] = String(v || "").split("/");
  return [parseInt(a, 10) || 0, parseInt(b, 10) || 0];
}

/** Split an artist string the way most taggers write it, so each artist gets its own field. */
export function splitArtists(v) {
  if (!v) return [];
  // Bare "/" and "&" are left alone so AC/DC and Simon & Garfunkel stay whole; fields are easy to split by hand.
  return String(v).split(/\s*(?:;|\u0000|,|\s\/\s|\s(?:feat\.?|ft\.|featuring)\s)\s*/i)
    .map((s) => s.trim()).filter(Boolean);
}

// ---------- store-only zip (MP3s don't compress, so deflate would only cost time) ----------

const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** files: [{ name, bytes: Uint8Array }] -> array of Uint8Array parts (wrap in a Blob). */
export function zipParts(files) {
  const parts = [], central = [];
  let offset = 0;
  const now = new Date();
  const time = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
  const date = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  for (const f of files) {
    const name = te.encode(f.name);
    const crc = crc32(f.bytes);
    const local = new Uint8Array(30 + name.length);
    const v = new DataView(local.buffer);
    v.setUint32(0, 0x04034b50, true); v.setUint16(4, 20, true); v.setUint16(6, 0x0800, true); // UTF-8 names
    v.setUint16(8, 0, true); v.setUint16(10, time, true); v.setUint16(12, date, true);
    v.setUint32(14, crc, true); v.setUint32(18, f.bytes.length, true); v.setUint32(22, f.bytes.length, true);
    v.setUint16(26, name.length, true); local.set(name, 30);
    parts.push(local, f.bytes);

    const c = new Uint8Array(46 + name.length);
    const w = new DataView(c.buffer);
    w.setUint32(0, 0x02014b50, true); w.setUint16(4, 20, true); w.setUint16(6, 20, true); w.setUint16(8, 0x0800, true);
    w.setUint16(12, time, true); w.setUint16(14, date, true);
    w.setUint32(16, crc, true); w.setUint32(20, f.bytes.length, true); w.setUint32(24, f.bytes.length, true);
    w.setUint16(28, name.length, true); w.setUint32(42, offset, true); c.set(name, 46);
    central.push(c);
    offset += local.length + f.bytes.length;
  }
  const cd = concat(central);
  const end = new Uint8Array(22);
  const e = new DataView(end.buffer);
  e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true);
  e.setUint32(12, cd.length, true); e.setUint32(16, offset, true);
  // ponytail: no zip64, so one zip tops out at 4 GB (about 13 hours of 320 kbps audio).
  return [...parts, cd, end];
}

/** A filename every OS accepts: "01 Title.mp3" */
export function safeName(s) {
  return String(s || "Untitled").replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").replace(/\s+/g, " ").trim().slice(0, 120) || "Untitled";
}

/** Strip what changes between renders ("v3", "final", "master", dates, separators) so builds of one song match. */
export const buildKey = (s) => String(s || "").toLowerCase()
  .replace(/\.[a-z0-9]{2,5}$/, "")
  .replace(/[_.]+|\s-\s|-(?=\d)/g, " ")
  .replace(/\b\d{4}[ -]?\d{2}[ -]?\d{2}\b|\b\d{6,8}\b/g, " ")
  .replace(/\b(v|ver|version|take|mix|mixdown|bounce|render|master|mastered|final|draft|wip|rough|demo|edit|new)\s*\d*\b/g, " ")
  .replace(/[^\p{L}\p{N}]+/gu, " ").trim();


// ---------- reading MP3s without the audio engine ----------
// Taglet's own exports (and most MP3s) carry ID3v2.3/2.4 tags and a LAME/Xing header, which is all an import
// needs. Reading them in plain JS means MP3s never depend on ffmpeg.wasm's file mount, the part that fails with
// files from the iOS picker, and imports are faster.

function decodeText(enc, b) {
  if (enc === 0) return String.fromCharCode(...b);
  if (enc === 3) return new TextDecoder("utf-8").decode(b);
  let le = enc === 1, start = 0;
  if (b[0] === 0xff && b[1] === 0xfe) { le = true; start = 2; } else if (b[0] === 0xfe && b[1] === 0xff) { le = false; start = 2; }
  let s = "";
  for (let i = start; i + 1 < b.length; i += 2) s += String.fromCharCode(le ? b[i] | (b[i + 1] << 8) : (b[i] << 8) | b[i + 1]);
  return s;
}
const strip0 = (s) => s.replace(/\u0000+$/, "").split("\u0000");

/** Find the end of a null-terminated string in `b` from `at` for text encoding `enc` (2-byte terminator for UTF-16). */
function nullEnd(b, at, enc) {
  if (enc === 1 || enc === 2) { for (let i = at; i + 1 < b.length; i += 2) if (b[i] === 0 && b[i + 1] === 0) return i; return b.length; }
  const i = b.indexOf(0, at); return i < 0 ? b.length : i;
}

/** Parse the first ID3v2 tag. Returns { tags, art } or null when the file has no ID3v2.3/2.4 tag. */
export function readId3(bytes) {
  if (bytes.length < 10 || bytes[0] !== 0x49 || bytes[1] !== 0x44 || bytes[2] !== 0x33) return null;
  const ver = bytes[3];
  if (ver !== 3 && ver !== 4) return null;
  const size = (bytes[6] << 21) | (bytes[7] << 14) | (bytes[8] << 7) | bytes[9];
  const end = Math.min(bytes.length, 10 + size);
  let p = 10;
  if (bytes[5] & 0x40) { // extended header
    const ext = ver === 4 ? (bytes[p] << 21) | (bytes[p + 1] << 14) | (bytes[p + 2] << 7) | bytes[p + 3] : ((bytes[p] << 24) | (bytes[p + 1] << 16) | (bytes[p + 2] << 8) | bytes[p + 3]) + 4;
    p += ext;
  }
  const f = {};
  let art = null;
  while (p + 10 <= end) {
    const id = String.fromCharCode(bytes[p], bytes[p + 1], bytes[p + 2], bytes[p + 3]);
    if (!/^[A-Z0-9]{4}$/.test(id)) break; // padding
    const n = ver === 4 ? (bytes[p + 4] << 21) | (bytes[p + 5] << 14) | (bytes[p + 6] << 7) | bytes[p + 7]
      : ((bytes[p + 4] << 24) | (bytes[p + 5] << 16) | (bytes[p + 6] << 8) | bytes[p + 7]) >>> 0;
    const body = bytes.subarray(p + 10, Math.min(end, p + 10 + n));
    p += 10 + n;
    if (!body.length) continue;
    const enc = body[0];
    if (id[0] === "T" && id !== "TXXX") f[id] = strip0(decodeText(enc, body.subarray(1)));
    else if (id === "COMM" || id === "USLT") { // enc, lang(3), description\0, text
      const d = nullEnd(body, 4, enc), skip = enc === 1 || enc === 2 ? 2 : 1;
      f[id] = [decodeText(enc, body.subarray(d + skip)).replace(/\u0000+$/, "")];
    } else if (id === "APIC" && !art) { // enc, mime\0, type, description\0, data
      const m = body.indexOf(0, 1);
      const mime = String.fromCharCode(...body.subarray(1, m)) || "image/jpeg";
      const d = nullEnd(body, m + 2, enc), skip = enc === 1 || enc === 2 ? 2 : 1;
      art = { bytes: body.slice(d + skip), mime: mime.includes("/") ? mime : `image/${mime.toLowerCase().replace("jpg", "jpeg")}` };
    }
  }
  const one = (k) => (f[k] ? f[k][0].trim() : "");
  const [track, trackTotal] = splitNumber(one("TRCK"));
  const [disc, discTotal] = splitNumber(one("TPOS"));
  return {
    art,
    tags: {
      title: one("TIT2"), artists: f.TPE1 ? f.TPE1.flatMap(splitArtists) : [], album: one("TALB"), albumArtist: one("TPE2"),
      track, trackTotal, disc, discTotal, year: (one("TYER") || one("TDRC")).slice(0, 4), genre: one("TCON"),
      composer: one("TCOM"), comment: one("COMM"), lyrics: one("USLT"), bpm: one("TBPM"), isrc: one("TSRC"),
      copyright: one("TCOP"), publisher: one("TPUB"), compilation: one("TCMP") === "1",
    },
  };
}

const BITRATES = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320]; // MPEG-1 Layer III, kbps
const RATES = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] };

/** Parse a Layer III frame header at i: { verBits, sampleRate, kbps, len } or null. */
function frameAt(bytes, i) {
  if (i + 4 > bytes.length || bytes[i] !== 0xff || (bytes[i + 1] & 0xe0) !== 0xe0) return null;
  const verBits = (bytes[i + 1] >> 3) & 3, layer = (bytes[i + 1] >> 1) & 3;
  const bri = bytes[i + 2] >> 4, sri = (bytes[i + 2] >> 2) & 3, pad = (bytes[i + 2] >> 1) & 1;
  if (verBits === 1 || layer !== 1 || bri === 0 || bri === 15 || sri === 3) return null; // Layer III only
  const sampleRate = RATES[verBits][sri];
  const kbps = verBits === 3 ? BITRATES[bri] : [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160][bri];
  const len = Math.floor(((verBits === 3 ? 144000 : 72000) * kbps) / sampleRate) + pad;
  return { verBits, sampleRate, kbps, len };
}

/** Sample rate and duration of an MP3 from its first frame (and its Xing/Info header when present), or null. */
export function mp3Info(bytes) {
  const [start, end] = mp3AudioRange(bytes);
  for (let i = start; i < Math.min(end - 4, start + 65536); i++) {
    const h = frameAt(bytes, i);
    if (!h) continue;
    // A real stream chains: the next two frames start exactly where this one ends, with the same version and rate.
    // Random data matches one header by chance; three in a row is what tells audio from noise.
    const h2 = frameAt(bytes, i + h.len), h3 = h2 && frameAt(bytes, i + h.len + h2.len);
    if (!h2 || !h3 || h2.sampleRate !== h.sampleRate || h3.sampleRate !== h.sampleRate) continue;
    const { verBits } = h;
    const bri = bytes[i + 2] >> 4;
    const sampleRate = h.sampleRate;
    const mono = (bytes[i + 3] >> 6) === 3;
    const samplesPerFrame = verBits === 3 ? 1152 : 576;
    const sideInfo = verBits === 3 ? (mono ? 17 : 32) : (mono ? 9 : 17);
    const x = i + 4 + sideInfo;
    const tag = String.fromCharCode(bytes[x], bytes[x + 1], bytes[x + 2], bytes[x + 3]);
    if ((tag === "Xing" || tag === "Info") && (bytes[x + 7] & 1)) {
      const frames = ((bytes[x + 8] << 24) | (bytes[x + 9] << 16) | (bytes[x + 10] << 8) | bytes[x + 11]) >>> 0;
      return { sampleRate, duration: (frames * samplesPerFrame) / sampleRate };
    }
    const kbps = verBits === 3 ? BITRATES[bri] : [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160][bri];
    return { sampleRate, duration: ((end - i) * 8) / (kbps * 1000) }; // constant bitrate estimate
  }
  return null;
}
