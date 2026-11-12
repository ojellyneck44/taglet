import { loadEngine, probe, render } from "./engine.js";
// Anonymous usage counts (/api/event). Never send file names, titles or anything personal.
const ping = (name, detail = "") => { try { navigator.sendBeacon?.("/api/event", JSON.stringify({ name, detail })); } catch {} };
{ // Once a day per browser: "new", or how long ago it first came (d1 = within a week, d8 = 8-30 days, d31 = later).
  try {
    const ref = new URLSearchParams(location.search).get("ref");
    if (ref) ping("ref", ref);
    const today = new Date().toISOString().slice(0, 10), first = localStorage.getItem("taglet.firstSeen");
    if (localStorage.getItem("taglet.lastSeen") !== today) {
      if (!first) localStorage.setItem("taglet.firstSeen", today);
      localStorage.setItem("taglet.lastSeen", today);
      const days = first ? (Date.parse(today) - Date.parse(first)) / 86400000 : 0;
      ping("visit", !first ? "new" : days <= 7 ? "d1" : days <= 30 ? "d8" : "d31");
    }
  } catch {}
}
import { buildKey, fillBatch, joinArtists, safeName, splitArtists, zipParts } from "./tags.js";
import { connect, newCode, cleanCode, prettyCode } from "./link.js";
import { b64url, unb64url, newKeyBytes, importKey, seal, shareUrl } from "./sharekit.js";
import { initAccount, onAccountChange, openAccount, schedulePush, syncCardHidden, hideSyncCard, accountAvailable } from "./account.js";

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const wide = matchMedia("(min-width: 900px)");
const calm = matchMedia("(prefers-reduced-motion: reduce)");
const uid = () => [...crypto.getRandomValues(new Uint8Array(10))].map((b) => "abcdefghijklmnopqrstuvwxyz0123456789"[b % 36]).join("");
const fmtTime = (s) => (s ? `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}` : "");
const audioMime = (codec, fallback = "") => ({
  mp3: "audio/mpeg", mpeg: "audio/mpeg", m4a: "audio/mp4", mp4: "audio/mp4", aac: "audio/aac",
  alac: "audio/mp4", wav: "audio/wav", pcm_s16le: "audio/wav", flac: "audio/flac",
  ogg: "audio/ogg", oga: "audio/ogg", opus: "audio/ogg", aiff: "audio/aiff", aif: "audio/aiff",
  caf: "audio/x-caf", wma: "audio/x-ms-wma",
}[String(codec || "").toLowerCase()] || fallback);
const normalizeAudioFile = (file, codec) => {
  const type = file.type || audioMime(codec);
  return type && file.type !== type ? new File([file], file.name, { type, lastModified: file.lastModified }) : file;
};
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const icon = (id) => `<svg aria-hidden="true"><use href="#i-${id}"/></svg>`;

// ---------------------------------------------------------------- motion helpers (the "20 ways" rules)
const EASE = "cubic-bezier(0.23, 1, 0.32, 1)";
const still = () => calm.matches;
/** Rule 3: rows cascade 30 ms apart, capped so the whole list lands within ~300 ms. */
function staggerIn(nodes) {
  if (still()) return;
  [...nodes].forEach((n, i) => n.animate([{ opacity: 0, transform: "translateY(4px)" }, { opacity: 1, transform: "none" }],
    { duration: 200, delay: Math.min(i, 9) * 30, easing: EASE, fill: "backwards" }));
}
/** Rule 8: one small pulse to confirm something worked. */
function pulse(el) { if (el && !still()) el.animate([{ scale: 1 }, { scale: 1.06 }, { scale: 1 }], { duration: 350, easing: "ease-out" }); }
/** Rule 17: new text is revealed through a moving mask instead of crossfading over the old. */
function maskText(el, text) {
  if (!el || el.textContent === text) return;
  el.textContent = text;
  if (!still()) el.animate([{ clipPath: "inset(0 100% 0 0)" }, { clipPath: "inset(0 0 0 0)" }], { duration: 250, easing: EASE });
}
/** Rule 18: icons swap with scale + opacity + a touch of blur, not a hard pop. */
function swapIcon(btn, id) {
  const svg = btn?.querySelector("svg");
  if (!svg) return;
  svg.querySelector("use").setAttribute("href", `#i-${id}`);
  btn.dataset.icon = id;
  if (!still()) svg.animate([{ opacity: 0, scale: 0.6, filter: "blur(4px)" }, { opacity: 1, scale: 1, filter: "blur(0)" }], { duration: 180, easing: EASE });
}
/** Rule 19: past a limit, movement meets more and more resistance (iOS-style). */
const rubber = (x, d = 60, c = 0.55) => (1 - 1 / ((x * c) / d + 1)) * d;

// Installed from the Home Screen, Taglet behaves like an app (same rules as Any Day Now): no pinch or
// double-tap zoom, no pull-to-refresh, and text selection only in fields (base.css, :root[data-native]).
// In a plain browser the page keeps zoom for accessibility.
const standalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
if (standalone) {
  document.documentElement.setAttribute("data-native", "");
  $('meta[name="viewport"]').setAttribute("content", "width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no,viewport-fit=cover");
}
// The splash stays until saved albums are back, so returning people never see the upload screen flash by.
const loaded = new Promise((r) => addEventListener("load", r, { once: true }));
const hideSplash = () => $("#splash").classList.add("done");
setTimeout(hideSplash, 3000); // never stuck if storage hangs
/** A light tap of feedback on Android; iOS has no vibration API for the web, so it's silent there. */
const buzz = (ms = 8) => { try { if (navigator.userActivation?.hasBeenActive !== false) navigator.vibrate?.(ms); } catch {} };

// Sheets: centred on desktop; on phones they sit at the bottom with a grab handle, and dragging the handle or
// header down closes them (past a quarter of the height, or a quick flick). Ported from Any Day Now's dom.js.
function openSheet(dlg) {
  if (dlg.open) return;
  const inner = $(".sheet-inner", dlg);
  if (!$(".sheet-handle", dlg)) inner.prepend(Object.assign(document.createElement("div"), { className: "sheet-handle" }));
  inner.scrollTop = 0;
  dlg.showModal();
  // Focus the sheet itself, not its first button (the close ✕), which would show a focus ring after a tap.
  // Tab still moves straight into the sheet, and screen readers start at its title.
  dlg.tabIndex = -1;
  dlg.focus({ preventScroll: true });
  staggerIn($$(".sheet-body > *, .steps-ol li, .auth-benefits li, .builds li", dlg));
  if (dlg.dataset.drag) return;
  dlg.dataset.drag = "1";
  dlg.addEventListener("click", (e) => { if (e.target === dlg) dlg.close("cancel"); });
  let start = null;
  dlg.addEventListener("pointerdown", (e) => {
    if (wide.matches || !e.target.closest(".sheet-handle, .sheet-head") || e.target.closest("button, a, input, select, textarea")) return;
    start = { y: e.clientY, t: performance.now(), id: e.pointerId, dy: 0 };
    try { dlg.setPointerCapture(e.pointerId); } catch {}
    dlg.classList.add("is-dragging");
  });
  dlg.addEventListener("pointermove", (e) => {
    if (!start || e.pointerId !== start.id) return;
    const raw = e.clientY - start.y;
    start.dy = raw >= 0 ? raw : -rubber(-raw, 40);
    dlg.style.transform = `translateY(${start.dy}px)`;
  });
  const end = (e) => {
    if (!start || e.pointerId !== start.id) return;
    const { dy, t } = start, speed = dy / Math.max(1, performance.now() - t);
    start = null;
    dlg.classList.remove("is-dragging");
    const settle = (to, ms, then) => {
      dlg.style.transition = `transform ${ms}ms var(--ease-out)`;
      dlg.style.transform = to;
      setTimeout(() => { dlg.style.transition = ""; dlg.style.transform = ""; then?.(); }, ms);
    };
    if (dy < 0) settle("", 260);
    else if (dy > dlg.offsetHeight / 4 || (dy > 24 && speed > 0.6)) settle(`translateY(${dlg.offsetHeight}px)`, 200, () => dlg.close("cancel"));
    else settle("", 320);
  };
  dlg.addEventListener("pointerup", end);
  dlg.addEventListener("pointercancel", end);
}

/** Album-level fields live once on the album, so every track in it is written with identical values. */
const albums = new Map(); // id -> { id, title, albumArtist, year, genre, compilation, art: {blob,bytes,url}|null, trackIds: [] }
const tracks = new Map(); // id -> { id, file, codec, sampleRate, duration, albumId, tags: {...per-track} }
let current = { album: null, track: null };
let pendingArt = null;
let lastExports = [];

// ---------------------------------------------------------------- views

function setView(view, dir = 1) {
  if (view === "track" && isSingle()) view = "album";
  const apply = () => {
    document.body.dataset.view = view;
    $("#welcome").hidden = view !== "welcome";
    $("#workspace").hidden = view === "welcome";
    $("#inspMain").hidden = view === "other";
    $("#inspOther").hidden = view !== "other";
    if (!wide.matches) scrollTo(0, 0);
  };
  if (document.body.dataset.view === view) return apply();
  if (!document.startViewTransition || calm.matches || document.hidden) return apply();
  const target = view === "welcome" || document.body.dataset.view === "welcome" ? null : wide.matches ? $("#inspector") : $("#workspace");
  if (target) target.style.viewTransitionName = "pane";
  document.documentElement.style.setProperty("--dir", dir);
  // If the page isn't painting (a background or occluded window), the transition never starts: apply anyway.
  let done = false;
  const once = () => { if (!done) { done = true; apply(); } };
  const t = document.startViewTransition(once);
  setTimeout(() => { if (!done) { once(); t.skipTransition(); } }, 400);
  t.ready.catch(() => {}); // an aborted transition (tab hidden mid-way) still applies the update
  t.finished.catch(() => {}).finally(() => { if (target) target.style.viewTransitionName = ""; });
}

// On desktop the panes are all visible; "view" decides what a phone shows.
const showAlbum = (id, dir = 1) => { selectAlbum(id); setView("album", dir); };

// ---------------------------------------------------------------- import

/** opts.target: a track id whose audio the (single) file should replace, from the "New build" button.
 *  opts.into: an album id to add the songs to, whatever their own album tags say. */
async function addFiles(list, source = "", opts = {}) {
  const files = [...list];
  const images = files.filter((f) => f.type.startsWith("image/") || /\.(jpe?g|png|webp|gif|heic|avif)$/i.test(f.name));
  const audio = files.filter((f) => !images.includes(f));
  if (images.length) {
    const target = current.album && albums.get(current.album);
    if (target) openCrop(images[0], target);
    else { pendingArt = images[0]; toast(`Got ${images[0].name}${source}. It becomes the cover of the next album you add.`); }
  }
  if (!audio.length) return;
  busy++;
  try { await importAudio(audio, source, opts); } finally { busy--; maybeReload(); }
}

async function importAudio(audio, source, opts) {
  ping("import", audio.length > 1 ? "many" : "one");
  if (document.body.dataset.view === "welcome") setView(wide.matches ? "album" : "shelf");
  const engine = $("#engine");
  engine.hidden = false;
  engine.innerHTML = `<span id="engineText">Getting the audio engine ready. This happens once.</span><progress max="1" value="0"></progress>`;
  try {
    await loadEngine((p) => { $("progress", engine).value = p; $("#engineText").textContent = `Downloading the audio engine (about 10 MB, only this once): ${Math.round(p * 100)}%`; });
  } catch (err) {
    engine.innerHTML = `${esc(err.message)} <button class="btn ghost small" type="button" data-act="retryEngine">Try again</button>`;
    retryFiles = audio;
    return;
  }
  const touched = new Set();
  // loose: untagged files dropped together become one album. covers: album id -> embedded covers, settled at the end.
  const batch = { loose: null, covers: new Map(), manual: new Set() };
  const builds = [], addedNow = new Set(), attached = [];
  let n = 0;
  const failed = []; // [file name, reason], reported together at the end
  const read = [];
  if (!opts.hints) audio.sort((a, b) => collator.compare(a.name, b.name)); // songs from a link keep the playlist's order
  for (const file of audio) {
    n++;
    engine.innerHTML = `<span>Reading ${n} of ${audio.length}: ${esc(file.name)}</span><progress max="${audio.length}" value="${n - 1}"></progress>`;
    try {
      const info = await probe(file);
      // Songs from a link: what the site knows wins over the (usually empty) tags in the file.
      const h = opts.hints?.get(file);
      if (h) {
        for (const [k, v] of Object.entries(h)) if (k !== "art" && (Array.isArray(v) ? v.length : v)) info.tags[k] = v;
        if (!info.art && h.art) info.art = h.art;
      }
      read.push({ file, info });
    } catch (err) { failed.push([file.name, readReason(err)]); }
  }
  engine.hidden = true;
  fillBatch(read.map((r) => r.info.tags)); // blanks come from the song with the most tags
  for (const { file, info } of read) {
    // An updated render of a song that's already tagged: hold it back and ask before replacing anything.
    const target = opts.target ? tracks.get(opts.target) : findBuild(file, info, addedNow);
    // A song synced from another device, waiting for its audio: attach it straight away, nothing to confirm.
    if (target && !target.file) { replaceAudio(target, file, info, false); attached.push(target); touched.add(target.albumId); continue; }
    if (target) { builds.push({ file, info, target: target.id }); continue; }
    const t = newTrack(file, info);
    addedNow.add(t.id);
    const album = placeTrack(t, info, batch, opts.into);
    touched.add(album.id);
    if (!current.album) current.album = album.id;
  }
  renderAll();
  if (failed.length) reportFailed(failed, audio.length);
  let replaced = [];
  if (builds.length) {
    const picks = await askBuilds(builds);
    for (const b of builds) {
      if (picks === "new") { const t = newTrack(b.file, b.info); addedNow.add(t.id); touched.add(placeTrack(t, b.info, batch, opts.into).id); continue; }
      if (!(picks instanceof Map) || !picks.has(b)) continue; // closed, or left unticked: nothing changes
      const t = tracks.get(picks.get(b));
      replaced.push([t, replaceAudio(t, b.file, b.info)]);
      touched.add(t.albumId);
    }
  }
  await settleCovers(batch.covers);
  // A lone untagged song is a single: name the album after it.
  if (batch.loose?.trackIds.length === 1 && !batch.loose.title) batch.loose.title = tracks.get(batch.loose.trackIds[0]).tags.title;
  for (const id of touched) tidyAlbum(albums.get(id));
  if (!current.album && albums.size) current.album = [...albums.keys()][0];
  if (opts.into && albums.has(opts.into)) current.album = opts.into;
  if ((wide.matches || isSingle()) && !current.track && current.album) current.track = albums.get(current.album).trackIds[0] || null;
  renderAll();
  if (!wide.matches && albums.size === 1 && document.body.dataset.view === "shelf") setView("album"); // skip a one-item list
  const added = addedNow.size;
  if (attached.length && !replaced.length && !addedNow.size) {
    buzz();
    toast(`Audio added for ${attached.length === 1 ? `“${attached[0].tags.title}”` : `${attached.length} songs`}. ${attached.length === 1 ? "Its" : "Their"} tags came from your account.`);
  } else if (replaced.length) {
    buzz(12);
    toast(`New ${replaced.length === 1 ? "build" : "builds"} swapped in for ${replaced.length === 1 ? `“${replaced[0][0].tags.title}”` : `${replaced.length} songs`}. Tags, cover and order stay the same.`, "", {
      label: "Undo",
      run: () => { for (const [t, prev] of replaced) Object.assign(t, prev); renderAll(); },
    });
  } else if (added || touched.size) {
    buzz();
    const into = opts.into && albums.get(opts.into);
    toast(`${added === 1 ? "1 song" : `${added} songs`} added${source}${into ? ` to “${into.title || "this album"}”` : touched.size > 1 ? ` into ${touched.size} albums` : ""}.`);
  }
}
let retryFiles = null;

function newTrack(file, info) {
  const t = { id: uid(), fileId: uid(), file, fileName: file.name, cloud: false, codec: info.codec, sampleRate: info.sampleRate, duration: info.duration, tags: info.tags };
  tracks.set(t.id, t);
  return t;
}

function findBuild(file, info, skip) {
  const keys = new Set([buildKey(file.name), buildKey(info.tags.title)].filter(Boolean));
  for (const t of tracks.values()) {
    if (skip.has(t.id)) continue;
    if (keys.has(buildKey(t.file?.name || t.fileName)) || keys.has(buildKey(t.tags.title))) return t;
  }
  return null;
}

/** Swap in new audio, keep every tag, the cover and the album position. Returns what's needed to undo. */
function replaceAudio(t, file, info, newBuild = true) {
  const prev = { cloud: t.cloud, file: t.file, fileId: t.fileId, fileName: t.fileName, codec: t.codec, sampleRate: t.sampleRate, duration: t.duration, build: t.build };
  Object.assign(t, { file, fileId: uid(), fileName: file.name, codec: info.codec, sampleRate: info.sampleRate, duration: info.duration, build: newBuild ? (t.build || 1) + 1 : t.build });
  const a = albums.get(t.albumId);
  if (!a.art && info.art) setArt(a, info.art);
  const p = $("#player");
  if (p.dataset.track === t.id) { p.pause(); p.removeAttribute("src"); p.dataset.track = ""; }
  return prev;
}

/** Resolves to a Map(build -> track id to replace), "new" (import them as new songs) or null (skip them). */
function askBuilds(builds) {
  return new Promise((resolve) => {
    const d = $("#buildsDialog"), ol = $("#buildsList");
    const choices = [...albums.values()].flatMap((a) => a.trackIds.map((id) => [id, `${tracks.get(id).tags.title || "Untitled"} · ${a.title || "Untitled album"}`]));
    ol.innerHTML = builds.map((b, i) => `<li>
      <input type="checkbox" checked id="bc${i}"><label class="file" for="bc${i}">${esc(b.file.name)}</label>
      <span class="meta">${esc((b.file.name.match(/\.(\w+)$/)?.[1] || b.info.codec).toUpperCase())} · ${fmtTime(b.info.duration)} · replaces the audio of</span>
      <label class="field"><span class="sr-only">Song to replace with ${esc(b.file.name)}</span>
        <select data-i="${i}">${choices.map(([id, label]) => `<option value="${id}" ${id === b.target ? "selected" : ""}>${esc(label)}</option>`).join("")}</select></label>
    </li>`).join("");
    $("#buildsGo").textContent = builds.length === 1 ? "Replace audio" : `Replace ${builds.length} songs`;
    let result = null;
    const onClick = (e) => {
      const b = e.target.closest("[data-builds]");
      if (!b) return;
      if (b.dataset.builds === "new") result = "new";
      else {
        result = new Map();
        builds.forEach((x, i) => { if ($(`#bc${i}`).checked) result.set(x, $(`select[data-i="${i}"]`, ol).value); });
      }
      d.close();
    };
    d.addEventListener("click", onClick);
    d.addEventListener("close", () => { d.removeEventListener("click", onClick); resolve(result); }, { once: true });
    openSheet(d);
  });
}

function placeTrack(t, info, batch, into) {
  if (into && albums.has(into)) {
    // Added to the open album on purpose: it takes the next numbers rather than its old album's.
    const album = albums.get(into);
    t.tags.track = 0; t.tags.disc = 0;
    t.albumId = album.id;
    album.trackIds.push(t.id);
    return album;
  }
  const title = info.tags.album.trim();
  const artist = (info.tags.albumArtist || "").trim();
  const k = (s) => s.toLowerCase();
  let album = title && [...albums.values()].find((a) => k(a.title) === k(title) && (!artist || !a.albumArtist || k(a.albumArtist) === k(artist)));
  if (!album && !title && batch.loose) album = batch.loose;
  if (!album) {
    album = { id: uid(), title, albumArtist: artist, year: info.tags.year, genre: info.tags.genre, compilation: info.tags.compilation, art: null, trackIds: [] };
    albums.set(album.id, album);
    if (!title) batch.loose = album;
    if (pendingArt) { const f = pendingArt; pendingArt = null; batch.manual.add(album.id); setArtFromFile(f, album); }
  }
  if (!album.year && info.tags.year) album.year = info.tags.year;
  if (!album.genre && info.tags.genre) album.genre = info.tags.genre;
  if (info.art && !album.art && !batch.manual.has(album.id)) {
    if (!batch.covers.has(album.id)) batch.covers.set(album.id, []);
    batch.covers.get(album.id).push({ blob: info.art, title: t.tags.title });
  }
  t.albumId = album.id;
  album.trackIds.push(t.id);
  return album;
}

/** An album has one cover. One embedded cover for some of the songs: ask before giving it to all of them.
 *  Several different ones: ask which to keep. Every song carrying the same one: just use it. */
async function settleCovers(byAlbum) {
  for (const [id, list] of byAlbum) {
    const a = albums.get(id);
    if (!a || a.art) continue;
    const seen = new Map();
    for (const c of list) {
      const h = new Uint8Array(await crypto.subtle.digest("SHA-256", await c.blob.arrayBuffer())).join();
      if (seen.has(h)) seen.get(h).count++; else seen.set(h, { ...c, count: 1 });
    }
    const covers = [...seen.values()].sort((x, y) => y.count - x.count);
    const pick = covers.length > 1 || list.length < a.trackIds.length ? await askCover(a, covers) : covers[0];
    if (pick) setArt(a, pick.blob);
  }
  renderAll();
}

function askCover(a, covers) {
  return new Promise((resolve) => {
    const d = $("#coverDialog"), box = $("#coverPicks"), one = covers.length === 1;
    const name = a.title ? `“${esc(a.title)}”` : "this album";
    $("#coverTitle").textContent = one ? "Use this cover for every song?" : "Pick one cover";
    $("#coverText").innerHTML = one
      ? `Only “${esc(covers[0].title)}” came with cover art. Spotify shows one picture for a whole album, so it can go on all ${a.trackIds.length} songs on ${name}.`
      : `These songs came with ${covers.length} different covers. An album shows one, so pick the one to keep for ${name}.`;
    const urls = covers.map((c) => URL.createObjectURL(c.blob));
    box.innerHTML = covers.map((c, i) => `<label class="pick">
      <input type="radio" name="coverPick" value="${i}" ${i ? "" : "checked"} ${one ? "hidden" : ""}><img src="${urls[i]}" alt="">
      <span>${esc(c.title)}${c.count > 1 ? ` and ${c.count - 1} more` : ""}</span></label>`).join("");
    $("#coverSkip").textContent = one ? "Not now" : "No cover";
    $("#coverGo").textContent = one ? "Use for all" : "Keep this cover";
    // Closing with ✕ keeps what the files brought: the single cover is left off, several fall back to the most used.
    let result = one ? null : covers[0];
    const onClick = (e) => {
      const b = e.target.closest("[data-cover]");
      if (!b) return;
      result = b.dataset.cover === "use" ? covers[+($("input:checked", box)?.value || 0)] : null;
      d.close();
    };
    d.addEventListener("click", onClick);
    d.addEventListener("close", () => { d.removeEventListener("click", onClick); urls.forEach((u) => URL.revokeObjectURL(u)); resolve(result); }, { once: true });
    openSheet(d);
  });
}

/** After an import: sort by disc/track, number untagged tracks in filename order, and guess a missing album artist. */
function tidyAlbum(a) {
  const list = a.trackIds.map((id) => tracks.get(id));
  if (list.some((t) => !t.tags.track)) {
    const used = new Set(list.map((t) => t.tags.track).filter(Boolean));
    let next = 1;
    for (const t of list) if (!t.tags.track) { while (used.has(next)) next++; t.tags.track = next; used.add(next); }
  }
  list.sort((x, y) => (x.tags.disc || 1) - (y.tags.disc || 1) || x.tags.track - y.tags.track || collator.compare(x.file?.name || x.fileName || "", y.file?.name || y.fileName || ""));
  a.trackIds = list.map((t) => t.id);
  if (!a.albumArtist) a.albumArtist = mostCommonArtist(a);
}

function mostCommonArtist(a) {
  const count = new Map();
  for (const id of a.trackIds) { const first = tracks.get(id).tags.artists[0]; if (first) count.set(first, (count.get(first) || 0) + 1); }
  const top = [...count].sort((x, y) => y[1] - x[1])[0];
  if (!top) return "";
  return top[1] / a.trackIds.length >= 0.5 ? top[0] : "Various Artists";
}

// ---------------------------------------------------------------- spotify check

const singleAlbum = (a) => a?.trackIds.length === 1;
const isSingle = () => singleAlbum(albums.get(current.album));

function checkAlbum(a) {
  const issues = [];
  const list = a.trackIds.map((id) => tracks.get(id));
  if (singleAlbum(a)) {
    const t = list[0];
    if (!t.tags.title.trim()) issues.push({ text: "Give the track a title." });
    if (!t.tags.artists.some((x) => x.trim())) issues.push({ text: "Add the artist, so Spotify can show who it’s by." });
    if (!a.art) issues.push({ text: "No cover art yet. Add one so the track has a picture in Spotify.", fix: "Add", act: "art" });
    return { issues, soft: !a.year ? ["No year. Optional, but it keeps things tidy in other players."] : [] };
  }
  if (!a.title.trim()) issues.push({ text: "Give the album a title." });
  if (!a.albumArtist.trim()) issues.push({ text: "Add an album artist, or Spotify may split tracks with guests into separate albums.", fix: "Fill in", act: "fixArtist" });
  const seen = new Set();
  const badNum = list.some((t) => { const key = `${t.tags.disc || 1}:${t.tags.track}`; const bad = !t.tags.track || seen.has(key); seen.add(key); return bad; });
  if (badNum) issues.push({ text: "Some track numbers are missing or repeated, so the order will be off.", fix: "Number in order", act: "renumber" });
  if (!a.art) issues.push({ text: "No cover art yet. Every track gets the same picture, so add one here.", fix: "Add", act: "art" });
  return { issues, soft: !a.year ? ["No year. Optional, but it keeps the album tidy in other players."] : [] };
}

// ---------------------------------------------------------------- rendering

function renderAll() { renderShelf(); renderAlbum(); renderInspector(); updateExport(); }

function renderShelf() {
  const ul = $("#shelfList");
  ul.innerHTML = [...albums.values()].map((a) => {
    const ok = !checkAlbum(a).issues.length;
    return `<li><button class="shelf-item" type="button" data-album-id="${a.id}" aria-current="${a.id === current.album}">
      ${a.art ? `<img class="thumb" src="${a.art.url}" alt="">` : `<span class="thumb">${icon("image")}</span>`}
      ${singleAlbum(a)
        ? `<span><strong>${esc(tracks.get(a.trackIds[0]).tags.title || "Untitled track")}</strong><small>Single · ${esc(joinArtists(tracks.get(a.trackIds[0]).tags.artists) || "No artist")}</small></span>`
        : `<span><strong>${esc(a.title || "Untitled album")}</strong><small>${esc(a.albumArtist || "No album artist")} · ${a.trackIds.length} tracks</small></span>`}
      <span class="dot ${ok ? "ok" : ""}" title="${ok ? "Ready for Spotify" : "Needs a fix"}"></span><span class="sr-only">${ok ? "Ready for Spotify" : "Needs a fix"}</span>
    </button></li>`;
  }).join("");
  updateExport();
  renderSyncCard();
  save();
}

function renderAlbum() {
  const a = albums.get(current.album);
  $("#album").hidden = !a;
  if (!a) return;
  for (const input of $$("[data-album]")) {
    const v = a[input.dataset.album];
    if (input.type === "checkbox") input.checked = !!v;
    else if (document.activeElement !== input) input.value = v ?? "";
  }
  fitAll();
  const art = $("#artImg");
  if (a.art) art.src = a.art.url; else art.removeAttribute("src");
  art.hidden = !a.art;
  setAmbient(a.art?.url);
  renderTracks(a);
  renderCheck(a);
  const single = singleAlbum(a);
  document.body.toggleAttribute("data-single", single);
  $("#deleteLabel").textContent = single ? "Delete track" : "Delete album";
  $("#shareLabel").textContent = a.share ? "Shared" : "Share";
  $("#artBtn").setAttribute("aria-label", single ? "Change the track’s cover art" : "Change the album’s cover art");
  $("#backToAlbum").textContent = a.title || "Album";
}

function renderTracks(a) {
  $("#tracks").innerHTML = a.trackIds.map((id) => {
    const t = tracks.get(id);
    const multiDisc = a.trackIds.some((x) => (tracks.get(x).tags.disc || 1) > 1);
    return `<li class="track" data-track-id="${id}" aria-current="${id === current.track}">
      <button class="grip" type="button" aria-label="Move ${esc(t.tags.title)}. Use arrow keys.">${icon("grip")}</button>
      <button class="track-play" type="button" data-act="trackPlay" aria-label="Play ${esc(t.tags.title || "Untitled")}">${icon("play")}</button>
      <span class="num ${t.tags.track ? "" : "missing"}">${multiDisc ? `${t.tags.disc || 1}·` : ""}${t.tags.track || "?"}</span>
      <button class="track-main" type="button"><strong>${esc(t.tags.title || "Untitled")}${t.build ? `<span class="build-tag">build ${t.build}</span>` : ""}</strong><small>${esc(joinArtists(t.tags.artists) || "No artist")}</small></button>
      <span class="dur">${t.file || t.cloud ? fmtTime(t.duration) : `<span class="no-audio" title="Not uploaded yet. Add the file here to play or export it.">No audio here</span>`}</span>
      <span class="track-scrub-hit" role="slider" tabindex="0" aria-label="Scrub ${esc(t.tags.title || "Untitled")}" aria-valuemin="0" aria-valuemax="${Math.max(1, t.duration || 1)}" aria-valuenow="0" data-scrub="${id}"></span>
    </li>`;
  }).join("");
  requestAnimationFrame(() => $$(".track").forEach((row) => positionScrubHit(row, row.dataset.trackId === player?.dataset.track && player.duration ? player.currentTime / player.duration : 0)));
}

let lastReady = null;
function renderCheck(a) {
  const { issues, soft } = checkAlbum(a);
  const tag = $("#checkTag");
  const ready = !issues.length;
  maskText($("#checkText"), ready ? "Ready for Spotify" : `${issues.length} to fix for Spotify`);
  // Only missing essentials get a tag; a ready album shows none (the text stays for screen readers).
  tag.classList.toggle("warn", !ready);
  tag.classList.toggle("ready", ready);
  if (lastReady !== null && lastReady !== ready) { if (ready) buzz(10); else swing(tag, 8); }
  lastReady = ready;
  save();
  $("#issues").innerHTML = [
    ...issues.map((i) => `<li>${icon("alert")}<span>${esc(i.text)}</span>${i.fix ? `<button class="btn ghost small" type="button" data-fix="${i.act}">${i.fix}</button>` : ""}</li>`),
    ...soft.map((s) => `<li class="ok">${icon("alert")}<span>${esc(s)}</span></li>`),
  ].join("");
}

function renderInspector() {
  const t = tracks.get(current.track);
  $("#inspector").classList.toggle("has-track", !!t);
  if (!t) return;
  for (const input of $$("[data-track]")) {
    if (document.activeElement !== input) input.value = t.tags[input.dataset.track] || "";
  }
  fitAll();
  $("#inspFile").textContent = t.file ? `${t.file.name}${t.build ? ` · build ${t.build}` : ""}` : t.cloud ? `${t.fileName} · in your account` : "No audio here";
  $('[data-act="replaceAudio"] span').textContent = t.file || t.cloud ? "New build" : "Add audio";
  $("#inspFile").title = `${t.codec.toUpperCase()} · ${(t.sampleRate / 1000).toFixed(1)} kHz`;
  renderArtists(t);
  const others = ["composer", "bpm", "isrc", "publisher", "copyright", "comment", "lyrics"].filter((k) => String(t.tags[k] || "").trim());
  $("#otherSummary").textContent = others.length ? `${others.length} filled: ${others.join(", ")}` : "Composer, lyrics, BPM, ISRC…";
  const p = $("#player");
  if (p.dataset.track !== t.id) { p.pause(); p.removeAttribute("src"); p.dataset.track = t.id; setPlayButton(false); $$(".track").forEach((r) => r.style.removeProperty("--play")); }
}

function renderArtists(t, focusIndex) {
  const list = t.tags.artists.length ? t.tags.artists : [""];
  $("#artistList").innerHTML = list.map((name, i) => `<li>
    <input value="${esc(name)}" data-artist="${i}" aria-label="Artist ${i + 1}" autocomplete="off" spellcheck="false" placeholder="${i ? "Featured artist" : "Main artist"}">
    <button class="btn ghost small" type="button" data-remove-artist="${i}" aria-label="Remove artist ${i + 1}" ${list.length < 2 ? "disabled" : ""}>${icon("close")}</button>
  </li>`).join("");
  $("#artistPreview").textContent = joinArtists(t.tags.artists) || "no artist";
  if (focusIndex !== undefined) $(`[data-artist="${focusIndex}"]`)?.focus();
}

function selectAlbum(id) { requestAnimationFrame(() => staggerIn($$("#tracks .track"))); current.album = id; current.track = wide.matches || isSingle() ? albums.get(id)?.trackIds[0] || null : null; renderShelf(); renderAlbum(); renderInspector(); }
function selectTrack(id) { current.track = id; $$(".track").forEach((li) => li.setAttribute("aria-current", li.dataset.trackId === id)); renderInspector(); setView("track"); }

function setAmbient(url) {
  const amb = $(".ambient");
  if (url) { $("#ambient").src = url; $("#ambient").hidden = false; amb.classList.add("on"); } else amb.classList.remove("on");
}

function updateExport() {
  const has = tracks.size > 0;
  $$('[data-act="export"]').forEach((b) => { b.disabled = !has; });
}

// ---------------------------------------------------------------- editing

/** One-line fields that wrap: grow to fit (where field-sizing isn't supported) and never hold a line break. */
function fitText(el) {
  if (CSS.supports("field-sizing", "content")) return;
  el.style.height = "auto"; el.style.height = `${el.scrollHeight + el.offsetHeight - el.clientHeight}px`;
}
const fitAll = () => $$("textarea.autosize").forEach(fitText);
addEventListener("resize", fitAll);
document.addEventListener("keydown", (e) => { if (e.key === "Enter" && e.target.matches?.("textarea.autosize")) { e.preventDefault(); e.target.blur(); } });

document.addEventListener("input", (e) => {
  const el = e.target;
  if (el.matches("textarea.autosize")) { if (/\n/.test(el.value)) el.value = el.value.replace(/\s*\n+\s*/g, " "); fitText(el); }
  const a = albums.get(current.album), t = tracks.get(current.track);
  if (el.dataset.album && a) {
    const key = el.dataset.album;
    a[key] = el.type === "checkbox" ? el.checked : key === "year" ? el.value.replace(/\D/g, "").slice(0, 4) : el.value;
    if (key === "year" && el.value !== a.year) el.value = a.year;
    renderCheck(a); renderShelf();
    if (key === "title") $("#backToAlbum").textContent = a.title || "Album";
  } else if (el.dataset.track && t) {
    const key = el.dataset.track;
    if (key === "title" && singleAlbum(a) && (!a.title || a.title === t.tags.title)) a.title = el.value;
    if (key === "track" || key === "disc") { t.tags[key] = parseInt(el.value, 10) || 0; }
    else t.tags[key] = el.value;
    if (key === "track" || key === "disc") { renderTracks(a); renderCheck(a); }
    else if (key === "title") { const row = $(`.track[data-track-id="${t.id}"] strong`); if (row) row.textContent = t.tags.title || "Untitled"; }
  } else if (el.dataset.artist !== undefined && t) {
    const list = t.tags.artists.length ? [...t.tags.artists] : [""];
    if (+el.dataset.artist === 0 && singleAlbum(a) && (!a.albumArtist || a.albumArtist === list[0])) a.albumArtist = el.value;
    list[+el.dataset.artist] = el.value;
    t.tags.artists = list;
    $("#artistPreview").textContent = joinArtists(list) || "no artist";
    const row = $(`.track[data-track-id="${t.id}"] small`); if (row) row.textContent = joinArtists(list) || "No artist";
  }
  if (singleAlbum(a)) { renderCheck(a); renderShelf(); }
  save();
});

document.addEventListener("keydown", (e) => {
  const el = e.target;
  if (el.dataset?.artist !== undefined) {
    const t = tracks.get(current.track), i = +el.dataset.artist;
    if (e.key === "Enter") { e.preventDefault(); t.tags.artists = [...(t.tags.artists.length ? t.tags.artists : [""])]; t.tags.artists.splice(i + 1, 0, ""); renderArtists(t, i + 1); }
    if (e.key === "Backspace" && !el.value && t.tags.artists.length > 1) { e.preventDefault(); t.tags.artists.splice(i, 1); renderArtists(t, Math.max(0, i - 1)); }
  }
  if (el.classList?.contains("grip") && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
    e.preventDefault();
    const a = albums.get(current.album), id = el.closest(".track").dataset.trackId;
    const i = a.trackIds.indexOf(id), j = i + (e.key === "ArrowUp" ? -1 : 1);
    if (j < 0 || j >= a.trackIds.length) return;
    a.trackIds.splice(i, 1); a.trackIds.splice(j, 0, id);
    renderTracks(a);
    $(`.track[data-track-id="${id}"] .grip`).focus();
    toast("Order changed. Tap “Number in this order” to renumber.");
  }
  if ((e.key === "Delete" || e.key === "Backspace") && el.classList?.contains("shelf-item")) { e.preventDefault(); current.album = el.dataset.albumId; actions.deleteAlbum(); return; }
  if (e.key === "Escape") { $("#addMenu").hidden = true; $("#tintMenu").hidden = true; $('[data-act="tint"]').setAttribute("aria-expanded", "false"); }
});

// ---------------------------------------------------------------- clicks

const actions = {
  pick: () => { pickInto = null; $("#pickAudio").click(); },
  addToAlbum: () => { pickInto = current.album; $("#pickAudio").click(); },
  fromLink: () => { $("#albumLink").value = ""; openSheet($("#linkImportDialog")); $("#albumLink").focus(); },
  share: () => openShare(),
  account: () => { $("#tintMenu").hidden = true; openAccount(); },
  syncLater: () => { hideSyncCard(); renderSyncCard(); },
  shareCreate: () => publishShare(albums.get(current.album)),
  shareStop: () => stopShare(albums.get(current.album)),
  shareCopy: async (btn) => { try { await navigator.clipboard.writeText($("#shareUrl").value); confirmCopied(btn); buzz(); } catch { $("#shareUrl").select(); toast("Couldn’t copy automatically. The link is selected, so copy it from there.", "err"); } },
  shareNative: async () => { const a = albums.get(current.album); try { await navigator.share({ title: shareTitle(a), url: $("#shareUrl").value }); } catch {} },
  deleteAlbum: () => {
    const a = albums.get(current.album);
    if (!a) return;
    const gone = a.trackIds.map((id) => tracks.get(id));
    const at = [...albums.keys()].indexOf(a.id);
    const name = singleAlbum(a) ? gone[0].tags.title || "Untitled track" : a.title || "Untitled album";
    for (const t of gone) tracks.delete(t.id);
    albums.delete(a.id);
    deleted[a.id] = Date.now();
    current.album = [...albums.keys()][Math.min(at, albums.size - 1)] || null;
    current.track = null;
    if (current.album && (wide.matches || isSingle())) current.track = albums.get(current.album).trackIds[0];
    renderAll();
    setView(!albums.size ? "welcome" : wide.matches ? "album" : "shelf", -1);
    // A deleted album's link goes too, once Undo is no longer offered (the toast lasts 7 seconds).
    if (a.share) setTimeout(() => { if (!albums.has(a.id)) stopShare(a); }, 8000);
    toast(`Deleted “${name}”${a.share ? ". Its share link stops working in a few seconds" : ""}.`, "", { label: "Undo", run: () => {
      const order = [...albums.entries()]; order.splice(at, 0, [a.id, a]);
      albums.clear(); for (const [k, v] of order) albums.set(k, v);
      for (const t of gone) tracks.set(t.id, t);
      delete deleted[a.id];
      current.album = a.id; current.track = wide.matches || singleAlbum(a) ? a.trackIds[0] : null;
      renderAll(); setView("album");
    } });
  },
  link: () => openLink(),
  export: () => openExport(),
  renumber: () => {
    const a = albums.get(current.album);
    a.trackIds.forEach((id, i) => { const t = tracks.get(id); t.tags.track = i + 1; t.tags.disc = 0; });
    renderTracks(a); renderCheck(a); renderShelf(); renderInspector();
    toast(`Numbered 1 to ${a.trackIds.length}.`);
  },
  addArtist: () => { const t = tracks.get(current.track); t.tags.artists = [...(t.tags.artists.length ? t.tags.artists : [""]), ""]; renderArtists(t, t.tags.artists.length - 1); },
  artistsAll: () => {
    const t = tracks.get(current.track), a = albums.get(current.album);
    for (const id of a.trackIds) tracks.get(id).tags.artists = [...t.tags.artists];
    renderTracks(a); renderCheck(a);
    toast(`Every track on “${a.title}” now lists ${joinArtists(t.tags.artists) || "no artist"}.`);
  },
  remove: () => {
    const t = tracks.get(current.track), a = albums.get(t.albumId);
    a.trackIds = a.trackIds.filter((id) => id !== t.id);
    tracks.delete(t.id);
    current.track = null;
    if (!a.trackIds.length) { albums.delete(a.id); current.album = [...albums.keys()][0] || null; }
    renderAll();
    if (!tracks.size) setView("welcome");
    else setView(wide.matches ? "album" : current.album === a.id ? "album" : "shelf", -1);
    toast(`Removed “${t.tags.title}”.`, "", { label: "Undo", run: () => { tracks.set(t.id, t); if (!albums.has(a.id)) albums.set(a.id, a); a.trackIds.push(t.id); tidyAlbum(a); current.album = a.id; renderAll(); if (document.body.dataset.view === "welcome") setView("album"); } });
  },
  preview: async () => {
    const p = $("#player"), t = tracks.get(current.track);
    if (!p.paused) { p.pause(); return; }
    // Keep local playback synchronous with the tap. On iOS, awaiting a network fetch first
    // can consume the user gesture and make audio.play() fail with NotAllowedError.
    if (!t.file && !(await ensureFile(t))) { toast("This song’s audio isn’t in your account yet. Add the file here to play it.", "err"); return; }
    t.file = normalizeAudioFile(t.file, t.codec);
    if (playerTrackId !== t.id) {
      if (playerUrl) URL.revokeObjectURL(playerUrl);
      playerUrl = URL.createObjectURL(t.file);
      playerTrackId = t.id;
      p.dataset.track = t.id;
      p.src = playerUrl;
      p.load();
    }
    try {
      await p.play();
    } catch (err) {
      const ext = (t.file.name.match(/\.(\w+)$/)?.[1] || t.codec || "audio").toUpperCase();
      if (err?.name === "NotAllowedError") toast("Audio is ready. Tap Play again to start it.", "err");
      else if (err?.name === "NotSupportedError") toast(`This browser can’t play ${ext} files directly. It still converts fine.`, "err");
      else toast(`Couldn’t play this ${ext} file. Try exporting it again.`, "err");
    }
  },
  trackPlay: async (btn) => {
    const row = btn.closest(".track");
    const id = row?.dataset.trackId;
    if (!id) return;
    current.track = id;
    $$(".track").forEach((row) => row.setAttribute("aria-current", row.dataset.trackId === id ? "true" : "false"));
    positionScrubHit(row, 0);
    renderInspector();
    await actions.preview();
  },
  pickArt: () => $("#pickImage").click(),
  replaceAudio: () => $("#pickBuild").click(),
  install: async () => { const e = installEvent; installEvent = null; showInstallHint(); if (e) { e.prompt(); const r = await e.userChoice.catch(() => null); if (r?.outcome === "accepted") buzz(); } $("#installSheet")?.close(); },
  removeArt: () => { const a = cropTarget; if (a) { a.art = null; renderAll(); } $("#cropDialog").close(); },
  addMenu: (btn) => { const m = $("#addMenu"); m.hidden = !m.hidden; btn.setAttribute("aria-expanded", String(!m.hidden)); if (!m.hidden) $("button", m).focus({ focusVisible: false }); },
  tint: (btn) => { const m = $("#tintMenu"); m.hidden = !m.hidden; btn.setAttribute("aria-expanded", String(!m.hidden)); if (!m.hidden) $("a", m).focus({ focusVisible: false }); },
  copyLink: async (btn) => { try { await navigator.clipboard.writeText(linkURL()); confirmCopied(btn); } catch { toast("Couldn’t copy. Type the code instead.", "err"); } },
  sendPick: () => $("#pickSend").click(),
  sendExports: () => sendFiles(lastExports.map((x) => new File([x.bytes], x.name.split("/").pop(), { type: "audio/mpeg" }))),
  exportZip: () => runExport("zip"),
  exportEach: () => runExport("each"),
  retryEngine: () => { const f = retryFiles; retryFiles = null; if (f) addFiles(f); },
};

document.addEventListener("click", (e) => {
  const act = e.target.closest("[data-act]");
  if (act && actions[act.dataset.act]) { actions[act.dataset.act](act); return; }
  const fix = e.target.closest("[data-fix]");
  if (fix) {
    const a = albums.get(current.album);
    if (fix.dataset.fix === "fixArtist") { a.albumArtist = mostCommonArtist(a) || "Various Artists"; renderAlbum(); renderShelf(); }
    if (fix.dataset.fix === "renumber") actions.renumber();
    if (fix.dataset.fix === "art") $("#pickImage").click();
    return;
  }
  const item = e.target.closest("[data-album-id]");
  if (item) {
    if (!wide.matches) { const th = $(".thumb", item); if (th) th.style.viewTransitionName = "album-art"; setTimeout(() => { if (th) th.style.viewTransitionName = ""; }, 600); }
    showAlbum(item.dataset.albumId);
    return;
  }
  const row = e.target.closest(".track-main");
  if (row) { selectTrack(row.closest(".track").dataset.trackId); return; }
  const rm = e.target.closest("[data-remove-artist]");
  if (rm) { const t = tracks.get(current.track); t.tags.artists.splice(+rm.dataset.removeArtist, 1); renderArtists(t, 0); return; }
  if (e.target.closest("#artBtn")) { $("#pickImage").click(); return; }
  const back = e.target.closest("[data-back]");
  if (back) { setView(back.dataset.back, -1); return; }
  if (e.target.closest('[data-go="other"]')) { setView("other"); return; }
  const close = e.target.closest("[data-close]");
  if (close) { close.closest("dialog").close(); return; }
  if (!e.target.closest("#tintMenu, [data-act=tint]")) $("#tintMenu").hidden = true;
  if (!e.target.closest("[data-act=addMenu]")) { $("#addMenu").hidden = true; $('[data-act="addMenu"]').setAttribute("aria-expanded", "false"); }
});

$("#localChip").addEventListener("click", () => { const tip = $("#localTip"); tip.classList.toggle("show"); setTimeout(() => tip.classList.remove("show"), 5000); });

let pickInto = null;
// iOS can invalidate picked files that haven't been read yet once the input is cleared, so clear it only afterwards.
$("#pickAudio").addEventListener("change", async (e) => { const into = pickInto; pickInto = null; try { await addFiles([...e.target.files], "", { into }); } finally { e.target.value = ""; } });
$("#pickImage").addEventListener("change", (e) => {
  const f = e.target.files[0]; e.target.value = "";
  if (!f) return;
  const a = cropTarget && $("#cropDialog").open ? cropTarget : albums.get(current.album);
  if (a) openCrop(f, a);
});
$("#pickBuild").addEventListener("change", async (e) => { const f = e.target.files[0]; try { if (f && current.track) await addFiles([f], "", { target: current.track }); } finally { e.target.value = ""; } });
$("#pickSend").addEventListener("change", (e) => { sendFiles([...e.target.files]); e.target.value = ""; });

const player = $("#player");
let playerUrl = "", playerTrackId = null;
const setPlayButton = (playing) => {
  const b = $('[data-act="preview"]');
  if (b) {
    swapIcon(b, playing ? "pause" : "play");
    b.setAttribute("aria-label", playing ? "Pause" : "Play");
  }
  $$(".track-play").forEach((play) => {
    const row = play.closest(".track");
    const active = playing && row?.dataset.trackId === player.dataset.track;
    const nextIcon = active ? "pause" : "play";
    if (play.dataset.icon !== nextIcon) {
      const use = play.querySelector("use");
      if (use) use.setAttribute("href", `#i-${nextIcon}`);
      play.dataset.icon = nextIcon;
    }
    play.setAttribute("aria-label", `${active ? "Pause" : "Play"} ${row?.querySelector(".track-main strong")?.textContent?.replace(/build \d+$/, "").trim() || "track"}`);
  });
};
let playRaf = 0;
const SCRUB_START = 34;
const SCRUB_RIGHT = 8;
function positionScrubHit(row, ratio) {
  const scrub = $(".track-scrub-hit", row);
  if (!scrub) return;
  const lineWidth = Math.max(1, row.clientWidth - SCRUB_START - SCRUB_RIGHT);
  scrub.style.left = `${SCRUB_START}px`;
  scrub.style.width = `${lineWidth}px`;
  scrub.style.top = "0px";
  scrub.style.height = `${row.clientHeight}px`;
}
function tickPlay() {
  const row = $(`.track[data-track-id="${player.dataset.track}"]`);
  if (row && player.duration) {
    const progress = (player.currentTime / player.duration) * 100;
    row.style.setProperty("--play", `${progress.toFixed(2)}%`);
    positionScrubHit(row, player.currentTime / player.duration);
    const scrub = $(".track-scrub-hit", row);
    if (scrub) { scrub.setAttribute("aria-valuemax", player.duration); scrub.setAttribute("aria-valuenow", player.currentTime); }
  }
  playRaf = player.paused ? 0 : requestAnimationFrame(tickPlay);
}
player.addEventListener("play", () => { setPlayButton(true); cancelAnimationFrame(playRaf); tickPlay(); });
player.addEventListener("pause", () => { setPlayButton(false); tickPlay(); });
player.addEventListener("ended", () => { $(`.track[data-track-id="${player.dataset.track}"]`)?.style.removeProperty("--play"); });

function scrubTo(clientX, scrub) {
  if (player.dataset.track !== scrub.dataset.scrub || !player.duration) return;
  const row = scrub.closest(".track");
  const rect = row.getBoundingClientRect();
  const lineWidth = Math.max(1, row.clientWidth - SCRUB_START - SCRUB_RIGHT);
  const ratio = Math.max(0, Math.min(1, (clientX - rect.left - SCRUB_START) / lineWidth));
  player.currentTime = ratio * player.duration;
  scrub.setAttribute("aria-valuenow", player.currentTime);
  row.style.setProperty("--play", `${(ratio * 100).toFixed(2)}%`);
  positionScrubHit(row, ratio);
}

document.addEventListener("pointerdown", (e) => {
  const scrub = e.target.closest?.(".track-scrub-hit");
  if (!scrub || player.dataset.track !== scrub.dataset.scrub) return;
  e.preventDefault();
  scrub.setPointerCapture?.(e.pointerId);
  scrubTo(e.clientX, scrub);
  const move = (ev) => scrubTo(ev.clientX, scrub);
  const end = () => { scrub.removeEventListener("pointermove", move); scrub.removeEventListener("pointerup", end); scrub.removeEventListener("pointercancel", end); };
  scrub.addEventListener("pointermove", move);
  scrub.addEventListener("pointerup", end);
  scrub.addEventListener("pointercancel", end);
});

document.addEventListener("wheel", (e) => {
  const scrub = e.target.closest?.(".track-scrub-hit");
  if (!scrub || player.dataset.track !== scrub.dataset.scrub || !player.duration) return;
  const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
  if (!delta) return;
  e.preventDefault();
  const step = Math.max(0.5, player.duration * 0.012);
  player.currentTime = Math.max(0, Math.min(player.duration, player.currentTime + (delta > 0 ? step : -step)));
  scrub.setAttribute("aria-valuenow", player.currentTime);
  const row = scrub.closest(".track");
  row?.style.setProperty("--play", `${((player.currentTime / player.duration) * 100).toFixed(2)}%`);
  if (row) positionScrubHit(row, player.currentTime / player.duration);
}, { passive: false });

document.addEventListener("keydown", (e) => {
  const scrub = e.target.closest?.(".track-scrub-hit");
  if (!scrub || player.dataset.track !== scrub.dataset.scrub || !player.duration) return;
  if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return;
  e.preventDefault();
  if (e.key === "Home") player.currentTime = 0;
  else if (e.key === "End") player.currentTime = player.duration;
  else player.currentTime = Math.max(0, Math.min(player.duration, player.currentTime + (e.key === "ArrowRight" ? 5 : -5)));
  scrub.setAttribute("aria-valuenow", player.currentTime);
  const row = scrub.closest(".track");
  row?.style.setProperty("--play", `${((player.currentTime / player.duration) * 100).toFixed(2)}%`);
  if (row) positionScrubHit(row, player.currentTime / player.duration);
});

// ---------------------------------------------------------------- reorder by dragging the grip

document.addEventListener("pointerdown", (e) => {
  const grip = e.target.closest(".grip");
  if (!grip) return;
  e.preventDefault();
  const li = grip.closest(".track"), list = $("#tracks"), a = albums.get(current.album);
  const rows = $$(".track", list), h = li.offsetHeight, startY = e.clientY, from = rows.indexOf(li);
  let to = from;
  li.classList.add("lifted");
  grip.setPointerCapture(e.pointerId);
  const move = (ev) => {
    const raw = ev.clientY - startY, lo = -from * h, hi = (rows.length - 1 - from) * h;
    const dy = raw < lo ? lo - rubber(lo - raw) : raw > hi ? hi + rubber(raw - hi) : raw;
    to = Math.max(0, Math.min(rows.length - 1, from + Math.round(dy / h)));
    li.style.transform = `translateY(${dy}px) scale(1.01)`;
    rows.forEach((r, i) => {
      if (r === li) return;
      const shift = from < to && i > from && i <= to ? -h : from > to && i < from && i >= to ? h : 0;
      r.style.transition = "transform .25s var(--ease-out)";
      r.style.transform = shift ? `translateY(${shift}px)` : "";
    });
  };
  const up = () => {
    grip.removeEventListener("pointermove", move);
    rows.forEach((r) => { r.style.transform = ""; r.style.transition = ""; });
    li.classList.remove("lifted");
    if (to !== from) {
      const [id] = a.trackIds.splice(from, 1);
      a.trackIds.splice(to, 0, id);
      a.trackIds.forEach((x, i) => { tracks.get(x).tags.track = i + 1; tracks.get(x).tags.disc = 0; });
      renderTracks(a); renderCheck(a); renderInspector();
    }
  };
  grip.addEventListener("pointermove", move);
  grip.addEventListener("pointerup", up, { once: true });
  grip.addEventListener("pointercancel", up, { once: true });
});

// ---------------------------------------------------------------- drag and drop, paste

let dragDepth = 0;
addEventListener("dragenter", (e) => { if (!e.dataTransfer?.types.includes("Files")) return; e.preventDefault(); dragDepth++; document.body.classList.add("dragging"); swing($("#bigTag"), 10); });
addEventListener("dragover", (e) => { if (e.dataTransfer?.types.includes("Files")) e.preventDefault(); });
addEventListener("dragleave", () => { dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) document.body.classList.remove("dragging"); });
addEventListener("drop", (e) => {
  if (!e.dataTransfer?.files.length) return;
  e.preventDefault(); dragDepth = 0; document.body.classList.remove("dragging");
  const files = [...e.dataTransfer.files];
  if (e.target.closest?.("#artBtn") && files[0].type.startsWith("image/")) { openCrop(files[0], albums.get(current.album)); return; }
  if (e.target.closest?.(".drop-send")) { sendFiles(files); return; }
  addFiles(files, "", { into: openAlbumFor(e.target) });
});
addEventListener("paste", (e) => {
  if (e.target.closest?.("input, textarea")) return;
  const f = [...(e.clipboardData?.files || [])];
  if (f.length) { e.preventDefault(); addFiles(f, " from the clipboard", { into: openAlbumFor(document.activeElement) }); return; }
  const link = (e.clipboardData?.getData("text") || "").trim();
  if (LINK.test(link)) { e.preventDefault(); importLink(link, openAlbumFor(document.activeElement)); }
});

// ---------------------------------------------------------------- add from a link (YouTube, SoundCloud)

const LINK = /^https:\/\/(?:[a-z0-9-]+\.)*(?:youtube\.com|youtu\.be|soundcloud\.com)\/\S+$/i;
const LINK_ERRORS = {
  blocked: "YouTube is turning Taglet’s server away right now. Try again in a while, or add the file itself.",
  unavailable: "That song or playlist is private, removed, or not available.",
  too_long: "That’s longer than 20 minutes, which is more than a song link can bring in.",
  unsupported: "Paste a link to a YouTube video or playlist, or a SoundCloud track or set.",
};

document.addEventListener("submit", (e) => {
  const form = e.target.closest("[data-link-form]");
  if (!form) return;
  e.preventDefault();
  const into = "into" in form.dataset ? current.album : null;
  form.closest("dialog")?.close();
  importLink(form.url.value, into).then((ok) => { if (ok) form.url.value = ""; });
});

async function linkApi(path) {
  const r = await fetch(path).catch(() => null);
  if (r?.ok) return r;
  let msg = r ? await r.text().catch(() => "") : "";
  try { msg = LINK_ERRORS[JSON.parse(msg).error] || ""; } catch {}
  if (msg.startsWith("<")) msg = "";
  throw new Error(msg || "Couldn’t get that link. Check you’re online and try again.");
}

/** A thumbnail as { raw, blob }: the picture as the site has it, and a centred square JPEG of it. Or null. */
async function linkCover(u) {
  if (!u) return null;
  try {
    const r = await linkApi(`/api/fetch/thumb?url=${encodeURIComponent(u)}`);
    const raw = await r.blob(), img = await loadImage(raw);
    return { raw, blob: await squareJpeg(img, centerCrop(img)) };
  } catch { return null; }
}

/** Tags for a song from a link. Without an artist field, "Artist - Title" names are split, and the uploader is the fallback. */
function linkTags(m, pl, i, n, art) {
  let title = m.title || "", artists = m.artists?.length ? m.artists : [];
  if (!artists.length) {
    // ponytail: a naive split; it covers the common "Artist - Song (Official Video)" upload.
    const s = title.match(/^(.+?)\s+[-–—]\s+(.+)$/);
    if (s) { artists = splitArtists(s[1]); title = s[2]; } else if (m.uploader) artists = [m.uploader];
  }
  title = title.replace(/\s*[([](?:official\s+)?(?:music\s+|lyric\s+)?(?:video|audio|visuali[sz]er|lyrics?)[)\]]/gi, "").trim() || m.title;
  return { title, artists, album: m.album || pl?.title || "", year: m.year || "", genre: m.genre || "",
    track: m.track || (pl ? i + 1 : 0), trackTotal: pl ? n : 0, art };
}

/** Resolves true when at least one song came in. */
async function importLink(raw, into) {
  const url = String(raw || "").trim();
  if (!LINK.test(url)) { toast(LINK_ERRORS.unsupported, "err"); return false; }
  const engine = $("#engine");
  const status = (t, v, max) => { engine.hidden = false; engine.innerHTML = `<span>${esc(t)}</span><progress max="${max || 1}"${v == null ? "" : ` value="${v}"`}></progress>`; };
  if (document.body.dataset.view === "welcome") setView(wide.matches ? "album" : "shelf");
  busy++;
  try {
    status("Looking up the link…");
    const info = await (await linkApi(`/api/fetch/info?url=${encodeURIComponent(url)}`)).json();
    const list = info.entries || [], pl = info.kind === "playlist" ? info : null;
    if (!list.length) throw new Error("There are no songs at that link.");
    const shared = pl ? await linkCover(pl.thumbnail) : null; // a playlist or set gets one cover
    const files = [], hints = new Map(), failed = [];
    let first = null;
    for (const [i, e] of list.entries()) {
      status(`Getting ${list.length > 1 ? `${i + 1} of ${list.length}: ` : ""}${e.title || "the song"}`, i, list.length);
      try {
        const r = await linkApi(`/api/fetch/audio?url=${encodeURIComponent(e.url)}`);
        const m = JSON.parse(decodeURIComponent(r.headers.get("X-Taglet-Meta") || "%7B%7D"));
        const f = new File([await r.blob()], `${safeName(m.title || e.title || "Song")}.${m.ext || "m4a"}`, { type: r.headers.get("Content-Type") || "" });
        const cover = shared || await linkCover(m.thumbnail);
        first ||= cover;
        hints.set(f, linkTags(m, pl, i, list.length, cover?.blob));
        files.push(f);
      } catch (err) {
        failed.push(e.title || "A song");
        if (/limit|turning/.test(err.message)) { toast(err.message, "err"); break; }
      }
    }
    engine.hidden = true;
    if (failed.length) toast(`${failed.length === list.length ? "None of the songs" : `${failed.length} of ${list.length} songs`} could be brought in${failed.length < 3 ? ` (${failed.join(", ")})` : ""}.`, "err");
    if (!files.length) return false;
    const youtube = !/soundcloud/i.test(url), hadArt = !!albums.get(into)?.art;
    await addFiles(files, ` from ${youtube ? "YouTube" : "SoundCloud"}`, { into, hints });
    // YouTube thumbnails are wide, so the cover starts as the middle square; open the crop straight away to choose it.
    const a = albums.get([...tracks.values()].find((t) => t.file === files[0])?.albumId);
    const crop = shared || (list.length === 1 ? first : null);
    if (youtube && crop && a?.art && !hadArt) openCrop(crop.raw, a);
    return true;
  } catch (err) {
    engine.hidden = true;
    toast(err.message, "err");
    return false;
  } finally { busy--; maybeReload(); }
}
/** The album on screen, if the drop landed on it: anywhere but the welcome screen and the album list. */
function openAlbumFor(target) {
  if (document.body.dataset.view === "welcome" || document.body.dataset.view === "shelf" || target?.closest?.("#shelf")) return null;
  return albums.has(current.album) ? current.album : null;
}

// ---------------------------------------------------------------- cover art

let cropTarget = null, crop = null;

async function setArtFromFile(file, album) {
  const img = await loadImage(file);
  setArt(album, await squareJpeg(img, centerCrop(img)));
  renderAll();
}

function setArt(album, blob, hash = null) {
  if (album.art?.url && ![...albums.values()].some((x) => x !== album && x.art?.url === album.art.url)) URL.revokeObjectURL(album.art.url);
  const art = album.art = { blob, url: URL.createObjectURL(blob), bytes: null, hash };
  // The fingerprint lets the account store each cover once.
  blob.arrayBuffer().then(async (b) => {
    art.bytes = new Uint8Array(b);
    if (!art.hash) { art.hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", b))].map((x) => x.toString(16).padStart(2, "0")).join(""); save(); }
  });
}

function loadImage(file) {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = () => rej(new Error("That image format can’t be opened here. Try a JPEG or PNG."));
    img.src = URL.createObjectURL(file);
  });
}

const centerCrop = (img) => { const s = Math.min(img.naturalWidth, img.naturalHeight); return { sx: (img.naturalWidth - s) / 2, sy: (img.naturalHeight - s) / 2, s }; };

/** Spotify shows art at up to ~640px; 1200px keeps it sharp on retina screens and under ~400 KB. */
function squareJpeg(img, { sx, sy, s }) {
  const size = Math.min(1200, Math.round(s));
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d");
  g.imageSmoothingQuality = "high";
  g.drawImage(img, sx, sy, s, s, 0, 0, size, size);
  return new Promise((res) => c.toBlob(res, "image/jpeg", 0.9));
}

async function openCrop(file, album) {
  if (!album) return;
  cropTarget = album;
  let img;
  try { img = await loadImage(file); } catch (err) { toast(err.message, "err"); return; }
  const el = $("#cropImg");
  el.src = img.src;
  el.hidden = false;
  const box = $("#cropper");
  const d = $("#cropDialog");
  openSheet(d);
  const V = box.clientWidth;
  const nw = img.naturalWidth, nh = img.naturalHeight;
  const base = V / Math.min(nw, nh);
  crop = { img, V, nw, nh, base, zoom: 1, x: (V - nw * base) / 2, y: (V - nh * base) / 2 };
  $("#cropZoom").value = 1;
  const square = Math.abs(nw - nh) < 2;
  $("#cropInfo").textContent = square
    ? `Already square (${nw} × ${nh}). Zoom in to crop tighter.`
    : `Cropped to a square from ${nw} × ${nh} automatically. Drag to choose what shows.`;
  if (Math.min(nw, nh) < 500) $("#cropInfo").textContent += " This image is small, so it may look soft in Spotify.";
  drawCrop();
}

function clampCrop() {
  const sc = crop.base * crop.zoom, w = crop.nw * sc, h = crop.nh * sc;
  crop.x = Math.min(0, Math.max(crop.V - w, crop.x));
  crop.y = Math.min(0, Math.max(crop.V - h, crop.y));
}
function drawCrop(elastic = false) {
  const sc = crop.base * crop.zoom;
  if (!elastic) { clampCrop(); $("#cropImg").style.transform = `translate(${crop.x}px, ${crop.y}px) scale(${sc})`; return; }
  // While a finger is down, show how far past the edge it went, with resistance; the real position stays put.
  const w = crop.nw * sc, h = crop.nh * sc;
  const band = (v, lo) => (v > 0 ? rubber(v) : v < lo ? lo - rubber(lo - v) : v);
  $("#cropImg").style.transform = `translate(${band(crop.x, crop.V - w)}px, ${band(crop.y, crop.V - h)}px) scale(${sc})`;
}
function zoomTo(z, cx = crop.V / 2, cy = crop.V / 2) {
  const old = crop.base * crop.zoom;
  crop.zoom = Math.max(1, Math.min(4, z));
  const sc = crop.base * crop.zoom;
  crop.x = cx - ((cx - crop.x) / old) * sc;
  crop.y = cy - ((cy - crop.y) / old) * sc;
  $("#cropZoom").value = crop.zoom;
  drawCrop();
}

{
  const box = $("#cropper");
  const pts = new Map();
  let last = null, pinch = null;
  box.addEventListener("pointerdown", (e) => { if (!crop) return; box.setPointerCapture(e.pointerId); pts.set(e.pointerId, e); last = { x: e.clientX, y: e.clientY }; });
  box.addEventListener("pointermove", (e) => {
    if (!crop || !pts.has(e.pointerId)) return;
    pts.set(e.pointerId, e);
    if (pts.size === 2) {
      const [a, b] = [...pts.values()];
      const dist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
      const r = box.getBoundingClientRect();
      const cx = (a.clientX + b.clientX) / 2 - r.left, cy = (a.clientY + b.clientY) / 2 - r.top;
      if (pinch) zoomTo(pinch.zoom * (dist / pinch.dist), cx, cy); else pinch = { dist, zoom: crop.zoom };
      return;
    }
    crop.x += e.clientX - last.x; crop.y += e.clientY - last.y; last = { x: e.clientX, y: e.clientY };
    drawCrop(true);
  });
  const end = (e) => {
    pts.delete(e.pointerId); if (pts.size < 2) pinch = null;
    const p = [...pts.values()][0]; if (p) last = { x: p.clientX, y: p.clientY };
    if (!pts.size && crop) {
      const img = $("#cropImg");
      img.style.transition = still() ? "" : "transform .3s cubic-bezier(0.23, 1, 0.32, 1)";
      drawCrop();
      setTimeout(() => { img.style.transition = ""; }, 320);
    }
  };
  box.addEventListener("pointerup", end); box.addEventListener("pointercancel", end);
  box.addEventListener("wheel", (e) => { if (!crop) return; e.preventDefault(); const r = box.getBoundingClientRect(); zoomTo(crop.zoom * Math.exp(-e.deltaY / 400), e.clientX - r.left, e.clientY - r.top); }, { passive: false });
  box.addEventListener("keydown", (e) => {
    if (!crop) return;
    const step = e.shiftKey ? 40 : 10;
    const k = { ArrowLeft: [step, 0], ArrowRight: [-step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] }[e.key];
    if (k) { e.preventDefault(); crop.x += k[0]; crop.y += k[1]; drawCrop(); }
    if (e.key === "+" || e.key === "=") zoomTo(crop.zoom * 1.1);
    if (e.key === "-") zoomTo(crop.zoom / 1.1);
  });
  $("#cropZoom").addEventListener("input", (e) => crop && zoomTo(+e.target.value));
  $("#cropDialog").addEventListener("close", async () => {
    if ($("#cropDialog").returnValue !== "ok" || !crop || !cropTarget) return;
    const sc = crop.base * crop.zoom;
    const blob = await squareJpeg(crop.img, { sx: -crop.x / sc, sy: -crop.y / sc, s: crop.V / sc });
    setArt(cropTarget, blob);
    renderAll();
    pulse($("#artBtn"));
    swing($("#checkTag"), 10);
  });
  $("#cropDialog").addEventListener("cancel", () => { $("#cropDialog").returnValue = "cancel"; });
  $("#cropOk").addEventListener("click", () => { $("#cropDialog").returnValue = "ok"; });
}

// ---------------------------------------------------------------- export

const isTouch = matchMedia("(pointer: coarse)").matches;

function openExport() {
  if (!tracks.size) return;
  const a = albums.get(current.album);
  const single = singleAlbum(a);
  // A single exports as its own MP3; an album defaults to "this album", with "everything" only when there's more.
  $("#scope").hidden = single || albums.size < 2;
  $('input[name="scope"][value="album"]').checked = true;
  $("#scopeAlbum").textContent = a ? `${a.trackIds.length} songs in “${a.title || "Untitled album"}”` : "This album";
  $("#scopeAll").textContent = `Everything: ${tracks.size} songs in ${albums.size} albums`;
  $("#exportTitle").textContent = single ? "Export track" : "Export for Spotify";
  $("#exportSetup").hidden = false; $("#exportActions").hidden = false; $("#exportList").hidden = true; $("#exportDone").hidden = true;
  $('[data-act="exportZip"]').hidden = single;
  const each = $('[data-act="exportEach"]');
  each.textContent = isTouch && navigator.canShare ? "Save to Files" : single ? "Save MP3" : "Save one by one";
  each.className = `btn ${single ? "primary" : "ghost"}`;
  trimNote();
  openSheet($("#exportDialog"));
}

/** What trimming costs for the songs about to be exported: only MP3 sources lose anything, because they get encoded twice. */
function trimNote() {
  const a = albums.get(current.album);
  const scopeAll = $('input[name="scope"][value="all"]').checked && !$("#scope").hidden;
  const list = scopeAll ? [...tracks.values()] : a.trackIds.map((id) => tracks.get(id));
  const mp3s = list.filter((t) => t.codec === "mp3").length;
  $("#trimNote").textContent = !mp3s
    ? "Costs nothing here: these are encoded once either way."
    : `${mp3s === list.length ? (list.length === 1 ? "This MP3 is" : "These MP3s are") : `${mp3s} MP3s are`} re-encoded once if you trim: very hard to hear, but not lossless.`;
}
document.addEventListener("change", (e) => { if (e.target.name === "scope") trimNote(); });

function tagsFor(t) {
  const a = albums.get(t.albumId);
  const list = a.trackIds.map((id) => tracks.get(id));
  const disc = t.tags.disc || 1;
  const discTotal = Math.max(1, ...list.map((x) => x.tags.disc || 1));
  const single = singleAlbum(a);
  return {
    ...t.tags, album: a.title || (single ? t.tags.title : ""), albumArtist: a.albumArtist || (single ? t.tags.artists[0] || "" : ""),
    year: a.year, genre: a.genre, compilation: a.compilation,
    artists: t.tags.artists.filter((x) => x.trim()),
    trackTotal: list.filter((x) => (x.tags.disc || 1) === disc).length, disc, discTotal,
  };
}

async function runExport(mode) {
  const scope = $("#scope").hidden ? "album" : $('input[name="scope"]:checked').value;
  busy++;
  const opts = { quality: $('input[name="quality"]:checked').value, trimSilence: $("#trimSilence").checked };
  const chosen = scope === "album" && current.album ? albums.get(current.album).trackIds.map((id) => tracks.get(id)) : [...albums.values()].flatMap((a) => a.trackIds.map((id) => tracks.get(id)));
  for (const a of new Set(chosen.map((t) => albums.get(t.albumId)))) {
    if (a.art && !a.art.bytes) a.art.bytes = new Uint8Array(await a.art.blob.arrayBuffer());
  }
  $("#exportSetup").hidden = true; $("#exportActions").hidden = true;
  const ol = $("#exportList"); ol.hidden = false;
  ol.innerHTML = chosen.map((t) => `<li class="xfer" data-x="${t.id}"><span>${esc(t.tags.title)}</span><span class="muted">Waiting</span><span class="bar"><i></i></span></li>`).join("");
  const out = [];
  let failed = 0;
  for (const t of chosen) {
    const row = $(`[data-x="${t.id}"]`, ol);
    const a = albums.get(t.albumId);
    const tags = tagsFor(t);
    $(".muted", row).textContent = "Fetching audio";
    if (!(await ensureFile(t))) { failed++; row.classList.add("err"); $(".muted", row).textContent = "No audio for this song yet"; continue; }
    $(".muted", row).textContent = t.codec === "mp3" && !opts.trimSilence ? "Re-tagging" : "Converting";
    try {
      const res = await render(t, tags, a.art?.bytes ? { bytes: a.art.bytes, mime: "image/jpeg" } : null, opts, (p) => row.style.setProperty("--p", p));
      row.style.setProperty("--p", 1);
      $(".muted", row).textContent = `${(res.bytes.length / 1048576).toFixed(1)} MB`;
      const folder = safeName(`${a.albumArtist ? a.albumArtist + " - " : ""}${a.title}`);
      const num = `${tags.discTotal > 1 ? `${tags.disc}-` : ""}${String(tags.track || 0).padStart(2, "0")}`;
      out.push({ name: `${folder}/${num} ${safeName(t.tags.title)}.mp3`, bytes: res.bytes });
    } catch (err) {
      failed++;
      row.classList.add("err");
      $(".muted", row).textContent = err.message || "Failed";
    }
  }
  lastExports = out;
  busy--; maybeReload();
  if (!out.length) { $("#exportDoneText").textContent = "Nothing could be converted. The errors are listed above."; $("#exportDone").hidden = false; return; }
  if (mode === "zip") {
    // Named after the album(s) the person entered.
    const names = [...new Set(chosen.map((t) => albums.get(t.albumId).title || "Untitled album"))];
    const label = safeName(names.length <= 2 ? names.join(" + ") : `${names[0]} and ${names.length - 1} more`);
    download(new Blob(zipParts(out), { type: "application/zip" }), `${label}.zip`);
  } else {
    const files = out.map((x) => new File([x.bytes], x.name.split("/").pop(), { type: "audio/mpeg" }));
    if (isTouch && navigator.canShare?.({ files })) {
      try { await navigator.share({ files }); } catch (err) { if (err.name !== "AbortError") files.forEach((f) => download(f, f.name)); }
    } else {
      for (const f of files) { download(f, f.name); await new Promise((r) => setTimeout(r, 350)); }
    }
  }
  const rebuilt = chosen.some((t) => t.build);
  ping("export", mode === "zip" ? "zip" : "files");
  buzz(12);
  $("#exportDoneText").textContent = `${out.length} ${out.length === 1 ? "file" : "files"} ready${failed ? `, ${failed} failed` : ""}. ` +
    (rebuilt ? "For new builds, save over the old files in the same folder so Spotify keeps one copy of each song." : "Next, add them to Spotify’s Local Files.");
  $("#exportDone").hidden = false;
  pulse($("#exportDone .btn"));
  $("#sendExports").hidden = false;
}

function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

/** "Copy link" turns into a check and "Copied" for a moment, with one pulse (rules 8, 17, 18). */
function confirmCopied(btn) {
  const label = $("span", btn), was = label.textContent;
  swapIcon(btn, "check"); maskText(label, "Copied"); pulse(btn);
  clearTimeout(btn._t);
  btn._t = setTimeout(() => { swapIcon(btn, "copy"); maskText(label, was); }, 1600);
}

// ---------------------------------------------------------------- link a device

let link = null, linkCode = null;
const linkURL = () => `${location.origin}/#link=${cleanCode(linkCode)}`;

async function openLink(joinCode) {
  openSheet($("#linkDialog"));
  if (joinCode) { await startLink(joinCode, true); return; }
  if (!link) await startLink(newCode(), false);
}

async function startLink(code, joining) {
  link?.close();
  linkCode = prettyCode(cleanCode(code));
  $("#linkCode").textContent = linkCode;
  drawQR(linkURL());
  setLinkLive(false, joining ? "Joining…" : "");
  try {
    link = await connect(linkCode, {
      onPeers: (n) => setLinkLive(n >= 2, n >= 2 ? "Linked. Send from either device." : joining ? "Waiting for the other device…" : ""),
      onFileStart: (meta) => transferRow(meta.name, "Receiving", 0),
      onFileProgress: (meta, p) => transferRow(meta.name, "Receiving", p),
      onFile: (file) => { transferRow(file.name, "Received", 1); addFiles([file], " from your other device"); },
      onClose: (reason) => { link = null; if (reason) setLinkLive(false, reason); },
    });
  } catch (err) {
    setLinkLive(false, err.message);
  }
}

function setLinkLive(live, text) {
  $("#linkPair").hidden = live;
  $("#linkLive").hidden = !live && !text;
  const s = $("#linkStatus");
  s.textContent = text;
  s.classList.toggle("live", live);
  $(".drop-send").hidden = !live;
  $("#sendExports").hidden = !live || !lastExports.length;
}

function drawQR(text, el = $("#qr")) {
  if (!window.qrcode) return;
  const qr = window.qrcode(0, "M");
  qr.addData(text); qr.make();
  el.innerHTML = qr.createSvgTag({ cellSize: 4, margin: 0, scalable: true });
}

// ---------------------------------------------------------------- share links

const shareTitle = (a) => (singleAlbum(a) ? tracks.get(a.trackIds[0]).tags.title : a.title) || "Untitled";
/** What a shared link would show: if this changes after sharing, the link is out of date. */
const shareSig = (a) => JSON.stringify([a.title, a.albumArtist, a.year, a.genre, a.art?.blob.size || 0,
  a.trackIds.map((id) => { const t = tracks.get(id); return [t.fileId, t.tags.title, t.tags.artists, t.tags.track, t.tags.disc]; })]);

function openShare() {
  const a = albums.get(current.album);
  if (!a) return;
  $("#shareTitle").textContent = singleAlbum(a) ? "Share track" : "Share album";
  showShareState(a);
  openSheet($("#shareDialog"));
}

function showShareState(a) {
  const s = a.share;
  $("#shareStart").hidden = !!s;
  $("#shareReady").hidden = !s;
  $("#shareProgress").hidden = true;
  $("#shareLabel").textContent = s ? "Shared" : "Share";
  if (!s) return;
  $("#shareUrl").value = s.url;
  drawQR(s.url, $("#shareQr"));
  $('[data-act="shareNative"]').hidden = !navigator.share;
  const until = new Date(s.at + 30 * 864e5).toLocaleDateString(undefined, { month: "long", day: "numeric" });
  const stale = s.sig !== shareSig(a);
  $("#shareMeta").textContent = stale
    ? `You’ve changed this since you shared it. Update the link so it plays the latest version. It works until ${until}.`
    : `Works until ${until}. Updating it restarts the 30 days.`;
  $("#shareUpdate").classList.toggle("primary", stale);
  $("#shareUpdate").classList.toggle("ghost", !stale);
}

async function publishShare(a) {
  if (!a) return;
  const list = a.trackIds.map((id) => tracks.get(id));
  for (const t of list) await ensureFile(t);
  if (list.some((t) => !t.file)) { toast("Some of these songs have no audio yet. Add the files here first, then share.", "err"); return; }
  const ol = $("#shareProgress");
  $("#shareStart").hidden = true; $("#shareReady").hidden = true; ol.hidden = false;
  ol.innerHTML = list.map((t) => `<li class="xfer" data-x="${t.id}"><span>${esc(t.tags.title)}</span><span class="muted">Waiting</span><span class="bar"><i></i></span></li>`).join("");
  busy++;
  try {
    let s = a.share;
    if (!s) {
      const r = await fetch("/api/share", { method: "POST" });
      if (!r.ok) throw new Error(r.status === 429 ? await r.text() : "Couldn’t create a link. Check your connection and try again.");
      const { id, token } = await r.json();
      const raw = newKeyBytes();
      s = { id, token, key: b64url(raw), url: shareUrl(id, raw) };
    }
    s = { ...s, url: shareUrl(s.id, unb64url(s.key)) }; // older links move to the form that shows a preview
    const key = await importKey(unb64url(s.key));
    const put = async (part, bytes) => {
      const r = await fetch(`/api/share/${s.id}/${part}`, { method: "PUT", headers: { Authorization: `Bearer ${s.token}` }, body: await seal(key, bytes) });
      if (r.ok) return;
      if (r.status === 429) throw new Error(await r.text());
      throw new Error(r.status === 413 ? "One of the songs is too big to share (the limit is 24 MB per song)."
        : r.status === 403 ? "This link was removed or has expired. Create a new one." : "The upload didn’t finish. Check your connection and try again.");
    };
    if (a.art && !a.art.bytes) a.art.bytes = new Uint8Array(await a.art.blob.arrayBuffer());
    if (a.art) await put("art", a.art.bytes);
    const single = singleAlbum(a);
    // The preview chat apps show: the cover and name only, readable by the server. The songs stay encrypted.
    const card = await fetch(`/api/share/${s.id}/card`, { method: "PUT", body: a.art ? await previewJpeg(a.art.blob) : new Uint8Array(),
      headers: { Authorization: `Bearer ${s.token}`, "X-Card": encodeURIComponent(JSON.stringify({ title: shareTitle(a), kind: single ? "single" : "album",
        artist: single ? joinArtists(list[0].tags.artists) : a.albumArtist })) } });
    if (card.status === 429) throw new Error(await card.text());
    const meta = { v: 1, kind: single ? "single" : "album", title: shareTitle(a),
      artist: single ? joinArtists(list[0].tags.artists) : a.albumArtist, year: a.year, genre: a.genre, art: !!a.art, tracks: [] };
    for (const [i, t] of list.entries()) {
      const row = $(`[data-x="${t.id}"]`, ol);
      $(".muted", row).textContent = "Preparing";
      const tags = tagsFor(t);
      const res = await render(t, tags, a.art ? { bytes: a.art.bytes, mime: "image/jpeg" } : null, { quality: "320", trimSilence: false }, (p) => row.style.setProperty("--p", p * 0.7));
      $(".muted", row).textContent = "Uploading";
      await put(`t${i}`, res.bytes);
      row.style.setProperty("--p", 1);
      $(".muted", row).textContent = `${(res.bytes.length / 1048576).toFixed(1)} MB`;
      const num = `${tags.discTotal > 1 ? `${tags.disc}-` : ""}${String(tags.track || 1).padStart(2, "0")}`;
      meta.tracks.push({ title: t.tags.title, artists: tags.artists, track: tags.track, disc: tags.disc, duration: t.duration, size: res.bytes.length,
        name: single ? `${safeName(`${joinArtists(tags.artists) ? joinArtists(tags.artists) + " - " : ""}${t.tags.title}`)}.mp3` : `${num} ${safeName(t.tags.title)}.mp3` });
    }
    await put("meta", new TextEncoder().encode(JSON.stringify(meta))); // last, so a half-finished upload never shows
    a.share = { ...s, at: Date.now(), sig: shareSig(a) };
    save(); buzz(12);
    showShareState(a);
    if (!$("#shareDialog").open) toast(`Link ready for “${shareTitle(a)}”.`);
  } catch (err) {
    toast(err.message || "Sharing failed.", "err");
    showShareState(a);
  } finally { busy--; maybeReload(); }
}

/** An 800 px JPEG of the cover for link previews. */
async function previewJpeg(blob) {
  const img = await loadImage(blob), c = document.createElement("canvas");
  c.width = c.height = 800;
  const g = c.getContext("2d");
  g.imageSmoothingQuality = "high";
  g.drawImage(img, 0, 0, 800, 800);
  return new Uint8Array(await (await new Promise((res) => c.toBlob(res, "image/jpeg", 0.85))).arrayBuffer());
}

async function stopShare(a) {
  const s = a?.share;
  if (!s) return;
  try {
    const r = await fetch(`/api/share/${s.id}`, { method: "DELETE", headers: { Authorization: `Bearer ${s.token}` } });
    if (!r.ok && r.status !== 403) throw new Error();
  } catch { toast("Couldn’t reach Taglet to remove the link. Try again when you’re online.", "err"); return; }
  a.share = null;
  save();
  showShareState(a);
  toast("Link removed. Anyone who opens it now sees that it’s gone.");
}

function transferRow(name, verb, p) {
  const ul = $("#transfers");
  let li = [...ul.children].find((x) => x.dataset.name === name);
  if (!li) { li = document.createElement("li"); li.className = "xfer"; li.dataset.name = name; li.innerHTML = `<span></span><span class="muted"></span><span class="bar"><i></i></span>`; ul.prepend(li); }
  li.children[0].textContent = name;
  li.children[1].textContent = p >= 1 ? verb : `${verb} ${Math.round(p * 100)}%`;
  li.style.setProperty("--p", p);
}

async function sendFiles(files) {
  if (!link || link.peers < 2) { toast("Link a device first.", "err"); return; }
  files.forEach((f) => transferRow(f.name, "Sending", 0));
  try {
    await link.send(files, (f, p) => transferRow(f.name, p >= 1 ? "Sent" : "Sending", p));
  } catch (err) { toast(err.message, "err"); }
}

$("#joinForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const c = cleanCode($("#joinCode").value);
  if (c.length !== 10) { toast("Codes are 10 characters, like ABCDE-FGHJK.", "err"); $("#joinCode").focus(); return; }
  startLink(c, true);
});
$("#joinCode").addEventListener("input", (e) => { const c = cleanCode(e.target.value); e.target.value = prettyCode(c); });
{
  const zone = $(".drop-send");
  zone.addEventListener("dragover", (e) => { e.preventDefault(); zone.classList.add("over"); });
  zone.addEventListener("dragleave", () => zone.classList.remove("over"));
  zone.addEventListener("drop", () => zone.classList.remove("over"));
}

// ---------------------------------------------------------------- toasts, tint, motion

/** Plain words for why a file couldn't be read, and what to try. */
function readReason(err) {
  const m = String(err?.message || err?.name || "");
  if (/NotReadable|NotFound|permission|could not be read/i.test(m)) return "your device didn’t hand the file over. Pick it again, or save it to Files first";
  if (/no audio/i.test(m)) return "there’s no audio in it Taglet can read";
  if (/download the audio engine/i.test(m)) return m;
  return "the audio engine couldn’t open it. Try exporting it again, or convert it to WAV";
}

/** One message for every file that failed, instead of a stack of toasts over the form. */
function reportFailed(failed, total) {
  const names = failed.map(([n]) => `“${n}”`);
  const list = names.length <= 2 ? names.join(" and ") : `${names.slice(0, 2).join(", ")} and ${names.length - 2} more`;
  const reasons = [...new Set(failed.map(([, r]) => r))];
  const head = failed.length === 1 ? `Couldn’t read ${list}` : `${failed.length} of ${total} songs couldn’t be read (${list})`;
  toast(`${head}: ${reasons.length === 1 ? reasons[0] : "each for its own reason. Try them one at a time"}.`, "err");
}

function toast(text, kind = "", action) {
  // At most two at once, so toasts never pile up over the fields.
  const shown = $$("#toasts .toast");
  if (shown.length >= 2) shown[0].remove();
  const el = document.createElement("div");
  el.className = `toast ${kind}`;
  el.innerHTML = `<p></p>`;
  el.firstChild.textContent = text;
  if (action) {
    const b = Object.assign(document.createElement("button"), { className: "btn ghost small", type: "button", textContent: action.label });
    b.onclick = () => { action.run(); el.remove(); };
    el.append(b);
  }
  $("#toasts").append(el);
  if (!still()) el.animate([{ opacity: 0, transform: "translateY(16px) scale(0.96)" }, { opacity: 1, transform: "none" }], { duration: 260, easing: EASE });
  setTimeout(() => {
    const done = () => el.remove();
    if (window.Motion && !calm.matches) window.Motion.animate(el, { opacity: 0, y: 8 }, { duration: 0.2 }).then(done); else done();
  }, action ? 7000 : 4200);
}

/** A paper tag on a string: a quick knock, then it settles on a spring. */
function swing(el, deg = 10) {
  if (!el || !window.Motion || calm.matches) return;
  window.Motion.animate(el, { rotate: [0, deg, -deg * 0.55, deg * 0.25, 0] }, { duration: 1.1, ease: [0.22, 1, 0.36, 1] });
}

// The welcome tag leans toward the pointer, like it's hanging in a draft.
{
  const tag = $("#bigTag");
  let raf = 0, target = 0, cur = 0;
  addEventListener("pointermove", (e) => {
    if (document.body.dataset.view !== "welcome" || calm.matches || e.pointerType !== "mouse") return;
    const r = tag.getBoundingClientRect();
    target = Math.max(-9, Math.min(9, (e.clientX - (r.left + r.width / 2)) / 45));
    if (!raf) raf = requestAnimationFrame(function step() {
      cur += (target - cur) * 0.08;
      tag.style.rotate = `${cur.toFixed(2)}deg`;
      raf = Math.abs(target - cur) > 0.02 ? requestAnimationFrame(step) : 0;
    });
  });
  addEventListener("load", () => setTimeout(() => swing(tag, 7), 250));
}

// ---------------------------------------------------------------- install prompt (mobile browser only)

// Like Any Day Now: on a phone that's in the browser rather than the Home Screen app, a sheet explains how to
// install, every time the app is opened. Android gets a one-tap Install button when the browser offers one.
const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const isAndroid = /android/i.test(navigator.userAgent);
let installEvent = null;
addEventListener("beforeinstallprompt", (e) => {
  if (!isAndroid) return; // desktop browsers keep their own install button in the address bar
  e.preventDefault();
  installEvent = e;
  showInstallHint();
  const btn = $("#installSheet [data-act='install']");
  if (btn) btn.hidden = false;
});
addEventListener("appinstalled", () => { ping("install"); installEvent = null; showInstallHint(); $("#installSheet")?.close(); });

function showInstallHint() {
  const el = $("#installHint");
  el.hidden = standalone || !installEvent;
  if (!el.hidden) el.innerHTML = `<button class="btn ghost big" type="button" data-act="install">${icon("phone")}<span>Add Taglet to your home screen</span></button>`;
}

function installPrompt() {
  if (standalone || !(isIOS || isAndroid)) return;
  const steps = isIOS
    ? `<li>Tap <svg class="inline-icon" aria-hidden="true"><use href="#i-share"/></svg> <b>Share</b> in Safari’s toolbar.</li>
       <li>Choose <b>Add to Home Screen</b> (scroll down the list if you don’t see it).</li>
       <li>Tap <b>Add</b>, then open Taglet from your Home Screen.</li>`
    : `<li>Tap the browser’s <b>⋮</b> menu.</li>
       <li>Choose <b>Add to Home screen</b> or <b>Install app</b>.</li>
       <li>Open Taglet from your home screen.</li>`;
  const dlg = document.createElement("dialog");
  dlg.className = "sheet glass";
  dlg.id = "installSheet";
  dlg.setAttribute("aria-labelledby", "installTitle");
  dlg.innerHTML = `<div class="sheet-inner">
    <div class="sheet-head"><h2 id="installTitle">Add Taglet to your Home Screen</h2><button class="btn ghost icon-only" type="button" data-close aria-label="Close">${icon("close")}</button></div>
    <p class="hint-lg">It opens full screen like a regular app, works offline once loaded, and keeps your songs one tap away.</p>
    <ol class="steps-ol">${steps}</ol>
    <div class="sheet-actions">
      <button class="btn ghost" type="button" data-close>Not now</button>
      <button class="btn primary" type="button" data-act="install" ${installEvent ? "" : "hidden"}>${icon("phone")}<span>Install</span></button>
    </div>
  </div>`;
  dlg.addEventListener("close", () => dlg.remove());
  document.body.append(dlg);
  openSheet(dlg);
}

// ---------------------------------------------------------------- boot

wide.addEventListener("change", () => { if (document.body.dataset.view !== "welcome") setView(wide.matches ? "album" : "album"); });

// ---------------------------------------------------------------- saved on this device

// Albums, tags, covers and the audio itself live in IndexedDB, so they're still here next visit (no account needed).
// Audio files are stored once per file and removed when nothing points at them any more.
const openDb = (() => {
  let p;
  return () => (p ||= new Promise((res, rej) => {
    const r = indexedDB.open("taglet", 1);
    r.onupgradeneeded = () => { r.result.createObjectStore("kv"); r.result.createObjectStore("files"); };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  }));
})();
async function idb(store, mode, fn) {
  const d = await openDb();
  return new Promise((res, rej) => {
    const tx = d.transaction(store, mode);
    const req = fn(tx.objectStore(store));
    tx.oncomplete = () => res(req?.result);
    tx.onerror = () => rej(tx.error);
  });
}

let saveTimer = 0, restored = false;
let deleted = {}; // album id -> when it was deleted, so a deletion on one device reaches the others
/** Everything about an album that syncs; when it changes, the album's change time moves on. */
const albumSig = (a) => JSON.stringify([a.title, a.albumArtist, a.year, a.genre, !!a.compilation, a.art?.hash || null, a.trackIds,
  a.trackIds.map((id) => { const t = tracks.get(id); return t && [t.tags, t.build || 0, t.file?.name || t.fileName, !!t.cloud]; })]);
function save() { if (!restored) return; clearTimeout(saveTimer); saveTimer = setTimeout(saveNow, 400); }
async function saveNow() {
  for (const a of albums.values()) { const sig = albumSig(a); if (a.sig !== sig) { a.sig = sig; a.updatedAt = Date.now(); } }
  schedulePush();
  try {
    await idb("kv", "readwrite", (s) => s.put({
      v: 1, current: { ...current }, deleted,
      albums: [...albums.values()].map((a) => ({ ...a, art: a.art ? { blob: a.art.blob, hash: a.art.hash } : null })),
      tracks: [...tracks.values()].map(({ file, ...t }) => t),
    }, "state"));
    const stored = await idb("files", "readonly", (s) => s.getAllKeys());
    const want = new Set([...tracks.values()].map((t) => t.fileId));
    await idb("files", "readwrite", (s) => {
      for (const t of tracks.values()) if (t.file && !stored.includes(t.fileId)) s.put(t.file, t.fileId);
      for (const k of stored) if (!want.has(k)) s.delete(k);
    });
  } catch { /* storage full or blocked (private mode): the session still works, it just won't be kept */ }
}
async function restore() {
  try {
    const state = await idb("kv", "readonly", (s) => s.get("state"));
    if (!state?.tracks?.length) return;
    const files = new Map();
    await idb("files", "readonly", (s) => {
      const r = s.openCursor();
      r.onsuccess = () => { const c = r.result; if (c) { files.set(c.key, c.value); c.continue(); } };
    });
    deleted = state.deleted || {};
    for (const t of state.tracks) tracks.set(t.id, { ...t, file: files.get(t.fileId) || null });
    for (const a of state.albums) {
      a.trackIds = a.trackIds.filter((id) => tracks.has(id));
      if (!a.trackIds.length) continue;
      const art = a.art;
      a.art = null;
      albums.set(a.id, a);
      if (art?.blob) setArt(a, art.blob, art.hash || null);
    }
    if (!albums.size) return;
    current.album = albums.has(state.current?.album) ? state.current.album : [...albums.keys()][0];
    current.track = tracks.has(state.current?.track) ? state.current.track : wide.matches || isSingle() ? albums.get(current.album).trackIds[0] : null;
    renderAll();
    setView(wide.matches ? "album" : "shelf");
  } catch {}
}
// ---------------------------------------------------------------- account sync

const LOSSLESS = /^(flac|pcm_|alac|wavpack|tta|ape)/;
const noCloud = new Set(); // songs that couldn't be encoded this session, so we don't retry them on every sync
/** What goes to the account: the file itself, or for lossless sources a 320 kbps MP3 copy (about a quarter of the size). */
async function cloudFile(id) {
  const t = tracks.get(id);
  if (!t?.file) return null;
  if (!LOSSLESS.test(t.codec || "")) return t.file;
  try {
    const { bytes } = await render(t, t.tags, null, { quality: "320", trimSilence: false });
    return new File([bytes], t.file.name.replace(/\.\w+$/, "") + ".mp3", { type: "audio/mpeg" });
  } catch { noCloud.add(id); return null; }
}

/** The song's audio as a File: already here, or downloaded once from the account and kept on this device. */
async function ensureFile(t) {
  if (t.file) { t.file = normalizeAudioFile(t.file, t.codec); return t.file; }
  if (!t.cloud) return null;
  try {
    const r = await fetch(`/api/account/audio/${t.id}`, { credentials: "same-origin" });
    if (!r.ok) return null;
    const name = t.fileName || `${t.tags.title || "song"}.${t.codec || "mp3"}`;
    const lossy = LOSSLESS.test(t.codec || ""); // lossless songs are stored in the account as 320 kbps MP3 copies
    const type = lossy ? "audio/mpeg" : audioMime(t.codec, r.headers.get("Content-Type") || "");
    t.file = new File([await r.blob()], lossy ? name.replace(/\.\w+$/, "") + ".mp3" : name, { type });
    if (lossy) Object.assign(t, { codec: "mp3", fileName: t.file.name, sampleRate: [44100, 48000].includes(t.sampleRate) ? t.sampleRate : 44100 });
    save();
    return t.file;
  } catch { return null; }
}

function getLibrary() {
  return {
    albums: [...albums.values()].map((a) => ({ id: a.id, title: a.title, albumArtist: a.albumArtist, year: a.year, genre: a.genre, compilation: !!a.compilation,
      trackIds: a.trackIds, cover: a.art?.hash || null, updatedAt: a.updatedAt || Date.now() })),
    tracks: [...tracks.values()].map((t) => ({ id: t.id, albumId: t.albumId, fileName: t.file?.name || t.fileName || "", codec: t.codec,
      sampleRate: t.sampleRate, duration: t.duration, build: t.build, tags: t.tags })),
    deleted,
  };
}

/** Merge the account's library into this device's: album by album the newer copy wins, deletions included. */
async function applyLibrary(remote, covers) {
  let changedAny = false;
  for (const [id, ts] of Object.entries(remote.deleted || {})) {
    deleted[id] = Math.max(deleted[id] || 0, ts);
    const a = albums.get(id);
    if (a && (a.updatedAt || 0) <= ts) { for (const tid of a.trackIds) tracks.delete(tid); albums.delete(id); changedAny = true; }
  }
  for (const R of remote.albums || []) {
    if ((deleted[R.id] || 0) >= R.updatedAt) continue;
    const L = albums.get(R.id);
    if (L && (L.updatedAt || 0) >= R.updatedAt) continue;
    for (const rt of (remote.tracks || []).filter((t) => t.albumId === R.id)) {
      const lt = tracks.get(rt.id);
      if (lt) Object.assign(lt, { tags: rt.tags, build: rt.build, albumId: R.id }, lt.file ? {} : { cloud: !!rt.audio, fileName: rt.fileName, codec: rt.codec, sampleRate: rt.sampleRate, duration: rt.duration });
      else tracks.set(rt.id, { ...rt, cloud: !!rt.audio, fileId: uid(), file: null }); // tags only, until the audio is added here
    }
    if (L) for (const tid of L.trackIds) if (!R.trackIds.includes(tid)) tracks.delete(tid);
    const a = L || { id: R.id, art: null };
    Object.assign(a, { title: R.title, albumArtist: R.albumArtist, year: R.year, genre: R.genre, compilation: R.compilation, trackIds: R.trackIds.filter((id) => tracks.has(id)) });
    if (!L) albums.set(a.id, a);
    if (R.cover && a.art?.hash !== R.cover && covers[R.cover]) { const blob = await covers[R.cover]().catch(() => null); if (blob) setArt(a, blob, R.cover); }
    if (!R.cover && a.art) a.art = null;
    a.updatedAt = R.updatedAt;
    a.sig = albumSig(a);
    changedAny = true;
  }
  if (!changedAny) return;
  if (!albums.has(current.album)) { current.album = [...albums.keys()][0] || null; current.track = null; }
  if (current.album && !current.track && (wide.matches || isSingle())) current.track = albums.get(current.album).trackIds[0] || null;
  renderAll();
  if (!albums.size) setView("welcome");
  else if (document.body.dataset.view === "welcome") setView(wide.matches ? "album" : "shelf");
  save();
}

onAccountChange((user) => {
  $$('[data-act="account"]').forEach((b) => {
    if (!b.closest("#syncCard")) b.hidden = !accountAvailable();
    if (b.classList.contains("account-icon")) {
      const was = b.classList.contains("synced");
      b.classList.toggle("synced", !!user);
      if (was !== !!user) { swapIcon(b, user ? "user-check" : "user"); if (user) pulse(b); }
    } else if (!b.closest("#syncCard")) maskText($("span", b), user ? "Synced" : "Sign in");
    b.setAttribute("aria-label", user ? `Account: ${user.email || user.name || "signed in"}. Your albums sync.` : "Sign in to keep your albums on every device (optional)");
  });
  renderSyncCard();
});
function renderSyncCard() { $("#syncCard").hidden = !accountAvailable() || syncCardHidden() || !albums.size; }

restore().finally(() => {
  restored = true;
  loaded.then(() => setTimeout(hideSplash, 150));
  navigator.storage?.persist?.().catch(() => {});
  initAccount({ openSheet, toast, icon, getLibrary, applyLibrary,
    pendingAudio: () => [...tracks.values()].filter((t) => t.file && !t.cloud && !noCloud.has(t.id)).map((t) => t.id),
    cloudFile,
    markCloud: (id) => { const t = tracks.get(id); if (t) { t.cloud = true; save(); } }, coverBlob: (id) => albums.get(id)?.art?.blob || null });
});

{
  const m = location.hash.match(/link=([0-9A-Za-z-]{10,11})/);
  if (m) { history.replaceState(null, "", location.pathname); addEventListener("load", () => openLink(m[1])); }
  else addEventListener("load", () => setTimeout(installPrompt, 700));
}

// Always run the newest build, the way Any Day Now does: re-check for a new service worker on every visit and
// whenever the app comes back to the foreground, and reload once when a new one takes over. If songs are being
// read or exported (or a device is linked), the reload waits until that's done; everything is saved anyway.
let busy = 0, reloadPending = false;
function maybeReload() {
  if (!reloadPending || busy || link || $("dialog[open]")) return;
  saveNow().finally(() => location.reload());
}
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js", { updateViaCache: "none" })
    .then((reg) => {
      const check = () => reg.update().catch(() => {});
      addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") { check(); maybeReload(); } });
      setInterval(check, 30 * 60 * 1000);
    })
    .catch(() => {});
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener("controllerchange", () => { if (hadController) { reloadPending = true; maybeReload(); } });
  document.addEventListener("close", maybeReload, true);
  if (new URLSearchParams(location.search).has("shared")) {
    history.replaceState(null, "", "/");
    caches.open("taglet-share").then(async (c) => {
      const keys = await c.keys();
      const files = await Promise.all(keys.map(async (k) => { const r = await c.match(k); const b = await r.blob(); return new File([b], decodeURIComponent(r.headers.get("x-name") || "shared"), { type: b.type }); }));
      await Promise.all(keys.map((k) => c.delete(k)));
      if (files.length) addFiles(files, " from the share sheet");
    });
  }
}

// Choosing an item from the Add menu closes it (the action handler stops the click before the outside-click check).
$("#addMenu").addEventListener("click", () => { $("#addMenu").hidden = true; $('[data-act="addMenu"]').setAttribute("aria-expanded", "false"); }, true);
