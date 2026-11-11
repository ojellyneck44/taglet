// Everything that touches audio runs here, inside ffmpeg.wasm in a worker on this device.
import { FFmpeg } from "/vendor/ffmpeg/index.js";
import { buildId3, mp3AudioRange, parseFfmetadata, splitArtists, splitNumber } from "./tags.js";

// The core is 31 MB; Cloudflare caps a single asset at 25 MB, so it ships in three parts.
const WASM_PARTS = ["/vendor/core/core-00.wasm", "/vendor/core/core-01.wasm", "/vendor/core/core-02.wasm"];
const WASM_SIZE = 32232419;

let ff = null, loading = null, log = [];
let queue = Promise.resolve(); // ffmpeg.wasm runs one command at a time

/** onProgress(fraction) while the engine downloads the first time (later loads come from the cache). */
export function loadEngine(onProgress = () => {}) {
  if (loading) return loading;
  loading = (async () => {
    let got = 0;
    const parts = await Promise.all(WASM_PARTS.map(async (url) => {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Couldn't download the audio engine (${res.status}).`);
      const reader = res.body.getReader(), chunks = [];
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value); got += value.length;
        onProgress(Math.min(got / WASM_SIZE, 1));
      }
      return new Blob(chunks);
    }));
    const wasmURL = URL.createObjectURL(new Blob(parts, { type: "application/wasm" }));
    const f = new FFmpeg();
    f.on("log", ({ message }) => { log.push(message); });
    await f.load({ coreURL: new URL("/vendor/core/ffmpeg-core.js", location.href).href, wasmURL });
    URL.revokeObjectURL(wasmURL);
    ff = f;
    return f;
  })();
  loading.catch(() => { loading = null; });
  return loading;
}

function serial(job) {
  const run = queue.then(job, job);
  queue = run.catch(() => {});
  return run;
}

async function withInput(file, fn) {
  const dir = "/in" + Math.random().toString(36).slice(2, 8);
  await ff.createDir(dir);
  await ff.mount("WORKERFS", { files: [file] }, dir); // reads the File in place, no copy into wasm memory
  try { return await fn(`${dir}/${file.name}`); }
  finally { await ff.unmount(dir); await ff.deleteDir(dir); }
}

async function exec(args) {
  log = [];
  const code = await ff.exec(args);
  return { code, log: log.join("\n") };
}

async function tryRead(path) {
  try { const d = await ff.readFile(path); await ff.deleteFile(path); return d; } catch { return null; }
}

/** Read tags, cover art and stream facts from any file ffmpeg understands. */
export function probe(file) {
  return serial(async () => {
    await loadEngine();
    return withInput(file, async (path) => {
      const { log: info } = await exec(["-hide_banner", "-i", path, "-f", "ffmetadata", "-y", "/meta.txt"]);
      const metaBytes = await tryRead("/meta.txt");
      const m = metaBytes ? parseFfmetadata(new TextDecoder().decode(metaBytes)) : {};
      const audio = info.match(/Stream #\d+:\d+[^:]*: Audio: (\w+)[^,]*, (\d+) Hz/);
      if (!audio) throw new Error("This file has no audio we can read.");
      const dur = info.match(/Duration: (\d+):(\d+):(\d+\.\d+)/);
      const hasArt = /Stream #\d+:\d+[^:]*: Video: (mjpeg|png|bmp|gif|webp)/.test(info);
      let art = null;
      if (hasArt) {
        await exec(["-hide_banner", "-i", path, "-an", "-frames:v", "1", "-c:v", "mjpeg", "-q:v", "2", "-y", "/art.jpg"]);
        const a = await tryRead("/art.jpg");
        if (a?.length) art = new Blob([a], { type: "image/jpeg" });
      }
      const [track, trackTotal] = splitNumber(m.track);
      const [disc, discTotal] = splitNumber(m.disc);
      return {
        codec: audio[1],
        sampleRate: +audio[2],
        duration: dur ? +dur[1] * 3600 + +dur[2] * 60 + +dur[3] : 0,
        art,
        tags: {
          title: m.title || file.name.replace(/\.[^.]+$/, ""),
          artists: splitArtists(m.artist),
          album: m.album || "",
          albumArtist: m.album_artist || m["album artist"] || "",
          track, trackTotal, disc, discTotal,
          year: (m.date || m.year || "").slice(0, 4),
          genre: m.genre || "", composer: m.composer || "", comment: m.comment || "",
          lyrics: m.lyrics || Object.entries(m).find(([k]) => k.startsWith("lyrics"))?.[1] || "",
          bpm: m.tbpm || m.bpm || "", isrc: m.tsrc || m.isrc || "", copyright: m.copyright || "",
          publisher: m.publisher || m.label || "", compilation: m.compilation === "1",
        },
      };
    });
  });
}

/** Leading/trailing digital silence, in seconds, found with one quick decode pass. */
async function findSilence(path, duration) {
  const { log: out } = await exec(["-hide_banner", "-i", path, "-map", "0:a:0", "-af", "silencedetect=n=-72dB:d=0.04", "-f", "null", "-"]);
  const starts = [...out.matchAll(/silence_start: (-?[\d.]+)/g)].map((x) => +x[1]);
  const ends = [...out.matchAll(/silence_end: ([\d.]+)/g)].map((x) => +x[1]);
  let head = 0, tail = duration;
  if (starts.length && starts[0] <= 0.001 && ends.length) head = ends[0];
  const lastStart = starts[starts.length - 1];
  if (starts.length && (ends.length < starts.length || ends[ends.length - 1] >= duration - 0.05) && lastStart > head) tail = lastStart;
  return { head, tail };
}

/**
 * Turn one track into a Spotify-ready MP3.
 * opts: { quality: "320" | "v0", trimSilence: bool }, art: { bytes, mime } | null
 * Returns { bytes: Uint8Array, reencoded: bool }
 */
export function render(track, tags, art, opts, onProgress = () => {}) {
  return serial(async () => {
    await loadEngine();
    const tag = buildId3({ ...tags, encodedBy: "Taglet" }, art);
    // An MP3 with nothing to trim keeps its original audio and LAME gapless header: only the tags change.
    if (track.codec === "mp3" && !opts.trimSilence) {
      const bytes = new Uint8Array(await track.file.arrayBuffer());
      const [s, e] = mp3AudioRange(bytes);
      onProgress(1);
      return { bytes: concatBytes(tag, bytes.subarray(s, e)), reencoded: false };
    }
    return withInput(track.file, async (path) => {
      const args = ["-hide_banner", "-i", path, "-map", "0:a:0", "-vn", "-map_metadata", "-1"];
      if (opts.trimSilence) {
        const { head, tail } = await findSilence(path, track.duration);
        if (head > 0 || tail < track.duration) args.push("-af", `atrim=start=${head.toFixed(4)}:end=${tail.toFixed(4)},asetpts=N/SR/TB`);
      }
      // MP3 only allows 32/44.1/48 kHz; hi-res sources come down to 44.1 kHz, the rate Spotify streams at.
      if (![44100, 48000].includes(track.sampleRate)) args.push("-ar", "44100");
      args.push("-c:a", "libmp3lame", ...(opts.quality === "v0" ? ["-q:a", "0"] : ["-b:a", "320k"]));
      // The LAME/Xing header (on by default) records encoder delay and padding so players can skip them.
      args.push("-id3v2_version", "0", "-write_id3v1", "0", "-f", "mp3", "-y", "/out.mp3");
      const onP = ({ progress }) => onProgress(Math.max(0, Math.min(1, progress)));
      ff.on("progress", onP);
      try {
        const { code, log: out } = await exec(args);
        const audio = await tryRead("/out.mp3");
        if (code !== 0 || !audio?.length) throw new Error(lastError(out) || "The conversion failed.");
        return { bytes: concatBytes(tag, audio), reencoded: true };
      } finally { ff.off("progress", onP); }
    });
  });
}

function lastError(out) {
  const line = out.split("\n").reverse().find((l) => /error|invalid|could not/i.test(l));
  return line ? `ffmpeg: ${line.trim()}` : "";
}

function concatBytes(a, b) {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0); out.set(b, a.length);
  return out;
}
