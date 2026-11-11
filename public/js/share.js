// The page behind a shared link: fetch the encrypted album, decrypt it here with the key from the #fragment,
// and let the visitor play or download it. The server never sees the key.
import { unb64url, importKey, unseal } from "./sharekit.js";
import { safeName, zipParts } from "./tags.js";

const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const icon = (id) => `<svg aria-hidden="true"><use href="#i-${id}"/></svg>`;
const fmt = (s) => (s ? `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}` : "");
const main = $("#main");

function fail(title, body) {
  main.innerHTML = `<div class="state"><h1>${esc(title)}</h1><p>${esc(body)}</p><a class="btn primary" href="/">Open Taglet</a></div>`;
  document.title = `${title} · Taglet`;
}

const [, id, keyText] = location.hash.match(/^#([A-Za-z0-9]{12})\.([A-Za-z0-9_-]{20,})$/) || [];
let key;

/** Fetch one encrypted part. A brand-new link can take a few seconds to reach every Cloudflare location. */
async function part(name, tries = 3) {
  for (let i = 0; ; i++) {
    const r = await fetch(`/api/share/${id}/${name}`);
    if (r.status === 200) return unseal(key, new Uint8Array(await r.arrayBuffer()));
    const status = r.status === 204 ? 404 : r.status;
    if (status !== 404 || i >= tries - 1) throw Object.assign(new Error(String(status)), { status });
    await new Promise((res) => setTimeout(res, 1500));
  }
}

const cache = new Map(); // track index -> blob URL
async function trackUrl(i) {
  if (!cache.has(i)) cache.set(i, part(`t${i}`).then((b) => URL.createObjectURL(new Blob([b], { type: "audio/mpeg" }))));
  return cache.get(i);
}

function save(url, name) {
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  document.body.append(a); a.click(); a.remove();
}

async function boot() {
  if (!id) return fail("This link isn’t complete", "Part of the address is missing. Ask whoever sent it to copy the whole link again.");
  let meta;
  try {
    key = await importKey(unb64url(keyText));
    meta = JSON.parse(new TextDecoder().decode(await part("meta")));
  } catch (err) {
    return err.status === 404
      ? fail("This link has expired or was removed", "Shared links last 30 days, and the person who shared it can stop sharing at any time.")
      : fail("This link can’t be opened", "The key in the address doesn’t match. Make sure the whole link was copied, including everything after the #.");
  }
  const single = meta.kind === "single";
  const total = meta.tracks.reduce((s, t) => s + (t.duration || 0), 0);
  document.title = `${meta.title}${meta.artist ? ` by ${meta.artist}` : ""} · Taglet`;
  main.innerHTML = `
    <div class="cover" id="cover">${icon("image")}</div>
    <div class="info">
      <p class="kind">${single ? "Single" : "Album"} shared with you · listen and download only</p>
      <h1>${esc(meta.title)}</h1>
      ${meta.artist ? `<p class="by">${esc(meta.artist)}</p>` : ""}
      <p class="facts">${[meta.year, meta.genre, single ? fmt(total) : `${meta.tracks.length} songs, ${total >= 60 ? `${Math.round(total / 60)} min` : fmt(total)}`].filter(Boolean).map(esc).join(" · ")}</p>
      <div class="actions">
        <button class="btn primary big" type="button" id="getAll">${icon("export")}<span>${single ? "Download MP3" : "Download album"}</span></button>
        <a class="btn ghost big" href="/spotify/">Add it to Spotify</a>
      </div>
      <ol class="list" id="list">${meta.tracks.map((t, i) => `
        <li class="row" data-i="${i}">
          <button class="play" type="button" aria-label="Play ${esc(t.title)}">${icon("play")}</button>
          <span><strong>${esc(t.title)}</strong><small>${esc((t.artists || []).join(", "))}</small></span>
          <span class="dur">${fmt(t.duration)}</span>
          <button class="dl" type="button" aria-label="Download ${esc(t.title)}">${icon("export")}</button>
        </li>`).join("")}</ol>
      <p class="note">These are MP3s with the title, artists, album and cover already written in, so Spotify’s Local Files shows them properly. They were decrypted in your browser; Taglet’s server only ever held scrambled data.</p>
    </div>`;
  if (meta.art) part("art").then((b) => {
    const url = URL.createObjectURL(new Blob([b], { type: "image/jpeg" }));
    $("#cover").innerHTML = `<img src="${url}" alt="Cover of ${esc(meta.title)}">`;
    const amb = $("#ambient"); amb.src = url; amb.hidden = false; $(".ambient").classList.add("on");
  }).catch(() => {});

  const player = $("#player");
  let playing = -1, raf = 0;
  const rowOf = (i) => $(`.row[data-i="${i}"]`);
  const setBtn = (i, on) => { const b = $(".play", rowOf(i)); if (b) { b.innerHTML = icon(on ? "pause" : "play"); b.setAttribute("aria-label", `${on ? "Pause" : "Play"} ${meta.tracks[i].title}`); } };
  const tick = () => {
    const r = rowOf(playing);
    if (r && player.duration) r.style.setProperty("--play", `${((player.currentTime / player.duration) * 100).toFixed(2)}%`);
    raf = player.paused ? 0 : requestAnimationFrame(tick);
  };
  async function play(i) {
    if (i === playing && !player.paused) { player.pause(); return; }
    if (i !== playing) {
      if (playing >= 0) { rowOf(playing).classList.remove("on"); rowOf(playing).style.removeProperty("--play"); setBtn(playing, false); }
      playing = i;
      rowOf(i).classList.add("on");
      try { player.src = await trackUrl(i); } catch { rowOf(i).querySelector("small").textContent = "Couldn’t load this song."; return; }
    }
    player.play().catch(() => {});
  }
  player.addEventListener("play", () => { setBtn(playing, true); cancelAnimationFrame(raf); tick(); });
  player.addEventListener("pause", () => { setBtn(playing, false); tick(); });
  player.addEventListener("ended", () => { if (playing + 1 < meta.tracks.length) play(playing + 1); else setBtn(playing, false); });

  $("#list").addEventListener("click", async (e) => {
    const row = e.target.closest(".row");
    if (!row) return;
    const i = +row.dataset.i;
    if (e.target.closest(".dl")) { save(await trackUrl(i), meta.tracks[i].name); return; }
    play(i);
  });

  $("#getAll").addEventListener("click", async (e) => {
    const btn = e.currentTarget, label = $("span", btn);
    if (single) { save(await trackUrl(0), meta.tracks[0].name); return; }
    btn.disabled = true;
    try {
      const files = [];
      for (const [i, t] of meta.tracks.entries()) {
        label.textContent = `Preparing ${i + 1} of ${meta.tracks.length}…`;
        files.push({ name: `${safeName(meta.title)}/${t.name}`, bytes: new Uint8Array(await (await fetch(await trackUrl(i))).arrayBuffer()) });
      }
      save(URL.createObjectURL(new Blob(zipParts(files), { type: "application/zip" })), `${safeName(meta.title)}.zip`);
      label.textContent = "Download album";
    } catch { label.textContent = "Download failed. Try again"; }
    btn.disabled = false;
  });
}

boot();
