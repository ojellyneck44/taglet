// node public/js/tags.test.mjs
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildKey, buildId3, mp3AudioRange, parseFfmetadata, splitArtists, splitNumber, zipParts, crc32, joinArtists } from "./tags.js";

assert.equal(joinArtists(["X", " Y ", "", "Z"]), "X, Y, Z");
assert.deepEqual(splitArtists("A, B feat. C; D"), ["A", "B", "C", "D"]);
assert.deepEqual(splitArtists("AC/DC"), ["AC/DC"]);
assert.deepEqual(splitNumber("3/12"), [3, 12]);
// New builds of one song match; different songs don't.
for (const [a, b] of [["Night Drive v2.wav", "night drive.mp3"], ["night_drive_FINAL_master.flac", "Night Drive"], ["Night Drive (mix 3) 2026-11-10.wav", "Night Drive"], ["Night Drive - bounce 4.aiff", "night-drive.wav"]])
  assert.equal(buildKey(a), buildKey(b), `${a} vs ${b}`);
assert.notEqual(buildKey("Night Drive.wav"), buildKey("Day Drive.wav"));
assert.notEqual(buildKey("Song 2.wav"), buildKey("Song.wav")); // a bare number is part of the title
assert.equal(crc32(new TextEncoder().encode("123456789")), 0xcbf43926);

const meta = parseFfmetadata(";FFMETADATA1\ntitle=Hello\\=World\nARTIST=A\\;B\nlyrics=line1\\\nline2\n[STREAM]\ntitle=nope\n");
assert.deepEqual(meta, { title: "Hello=World", artist: "A;B", lyrics: "line1\nline2" });

// A tag we write, prepended twice (as a retag of a retag), still strips back to the same audio.
const audio = Uint8Array.of(0xff, 0xfb, 1, 2, 3);
const tag = buildId3({ title: "T", artists: ["A", "B"], album: "Al", track: 2, trackTotal: 9 }, { bytes: Uint8Array.of(1, 2), mime: "image/jpeg" });
const twice = new Uint8Array([...tag, ...tag, ...audio]);
const [s, e] = mp3AudioRange(twice);
assert.deepEqual([...twice.slice(s, e)], [...audio]);

// If ffprobe is installed, check that a real decoder reads our frames.
try {
  const dir = mkdtempSync(join(tmpdir(), "taglet-"));
  const src = join(dir, "a.mp3");
  execFileSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "sine=d=1", "-c:a", "libmp3lame", "-id3v2_version", "0", src]);
  const raw = readFileSync(src);
  const out = join(dir, "b.mp3");
  writeFileSync(out, Buffer.concat([buildId3({ title: "Ünïcode ☆", artists: ["X", "Y", "Z"], album: "LP", albumArtist: "X", track: 1, trackTotal: 3, disc: 1, discTotal: 1, year: "2026", compilation: true }, null), raw]));
  const probe = JSON.parse(execFileSync("ffprobe", ["-v", "error", "-show_format", "-of", "json", out]).toString()).format.tags;
  assert.equal(probe.title, "Ünïcode ☆");
  assert.equal(probe.artist, "X, Y, Z");
  assert.equal(probe.track, "1/3");
  assert.equal(probe.album_artist, "X");
  // And the zip opens.
  const z = join(dir, "t.zip");
  writeFileSync(z, Buffer.concat(zipParts([{ name: "01 Ünï.mp3", bytes: new Uint8Array(raw) }]).map((p) => Buffer.from(p))));
  execFileSync("python", ["-c", "import zipfile,sys; z=zipfile.ZipFile(sys.argv[1]); assert z.testzip() is None and z.namelist()==[\"01 Ünï.mp3\"]", z]);
  console.log("ffprobe + zip checks passed");
} catch (err) {
  if (err.code === "ENOENT") console.log("ffmpeg not found; skipped decoder check"); else throw err;
}
console.log("ok");
