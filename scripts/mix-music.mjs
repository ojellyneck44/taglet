// Mixes a random song from the music folder under each short, into a separate tg-<name>-music.mp4 (the picture is copied, not re-encoded).
// usage: node scripts/mix-music.mjs [video.mp4 ...]   (no arguments: every public/social/videos/tg-*.mp4 that has no -music copy yet)
// env: MUSIC_DIR (default C:\Users\stevi\Desktop\taglet-music). Used songs are remembered in MUSIC_DIR/.used.json so none repeats
// until all have been used. Light on the CPU: one ffmpeg at a time, audio only.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";

const MUSIC = process.env.MUSIC_DIR || "C:\Users\stevi\Desktop\taglet-music";
const VIDEOS = resolve("public/social/videos");
const songs = existsSync(MUSIC) ? readdirSync(MUSIC).filter((f) => /\.(mp3|wav|flac|m4a|ogg)$/i.test(f)) : [];
if (!songs.length) { console.log("No songs in " + MUSIC); process.exit(0); }
mkdirSync(VIDEOS, { recursive: true });
const usedFile = join(MUSIC, ".used.json");
let used = []; try { used = JSON.parse(readFileSync(usedFile, "utf8")); } catch {}
const dur = (f) => parseFloat(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", f]).toString());

const todo = process.argv.slice(2).length ? process.argv.slice(2) : readdirSync(VIDEOS).filter((f) => /^tg-.+\.mp4$/.test(f) && !/-music\.mp4$/.test(f) && !existsSync(join(VIDEOS, f.replace(/\.mp4$/, "-music.mp4"))));
for (const name of todo) {
  const src = existsSync(name) ? name : join(VIDEOS, basename(name));
  let pool = songs.filter((s) => !used.includes(s));
  if (!pool.length) { used = []; pool = songs; }
  const song = pool[Math.floor(Math.random() * pool.length)];
  const vd = dur(src), sd = dur(join(MUSIC, song));
  const ss = sd > vd + 2 ? Math.random() * (sd - vd - 1) : 0; // a random stretch of the song
  const out = join(VIDEOS, basename(src).replace(/\.mp4$/, "-music.mp4"));
  const fade = Math.min(1.5, vd / 4);
  const filter = `[1:a]atrim=0:${vd},asetpts=PTS-STARTPTS,loudnorm=I=-26:TP=-4,afade=t=in:d=0.6,afade=t=out:st=${(vd - fade).toFixed(2)}:d=${fade.toFixed(2)}[m];[0:a][m]amix=inputs=2:duration=first:normalize=0,alimiter=limit=0.84[a]`;
  execFileSync("ffmpeg", ["-v", "error", "-y", "-i", src, "-ss", ss.toFixed(2), "-t", String(vd + 1), "-i", join(MUSIC, song), "-filter_complex", filter, "-map", "0:v", "-map", "[a]", "-c:v", "copy", "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", out], { stdio: "inherit" });
  used.push(song); writeFileSync(usedFile, JSON.stringify(used));
  console.log(`${basename(out)} <- ${song} (from ${ss.toFixed(1)}s)`);
}
