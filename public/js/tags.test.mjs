// node public/js/tags.test.mjs
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readId3, mp3Info, buildKey, buildId3, mp3AudioRange, parseFfmetadata, splitArtists, splitNumber, zipParts, crc32, joinArtists, fillBatch } from "./tags.js";

assert.equal(joinArtists(["X", " Y ", "", "Z"]), "X, Y, Z");
assert.deepEqual(splitArtists("A, B feat. C; D"), ["A", "B", "C", "D"]);
assert.deepEqual(splitArtists("AC/DC"), ["AC/DC"]);
assert.deepEqual(splitNumber("3/12"), [3, 12]);
// New builds of one song match; different songs don't.
for (const [a, b] of [["Night Drive v2.wav", "night drive.mp3"], ["night_drive_FINAL_master.flac", "Night Drive"], ["Night Drive (mix 3) 2026-11-10.wav", "Night Drive"], ["Night Drive - bounce 4.aiff", "night-drive.wav"]])
  assert.equal(buildKey(a), buildKey(b), `${a} vs ${b}`);
assert.notEqual(buildKey("Night Drive.wav"), buildKey("Day Drive.wav"));
assert.notEqual(buildKey("Song 2.wav"), buildKey("Song.wav")); // a bare number is part of the title
// Batch fill: blanks come from the richest song; titles and numbers never do; a second album stays apart.
{
  const T = (o) => ({ title: "", artists: [], album: "", albumArtist: "", year: "", genre: "", composer: "", track: 0, trackTotal: 0, compilation: false, ...o });
  const rich = T({ title: "a", artists: ["X", "Y"], album: "LP", albumArtist: "X", year: "2026", genre: "Pop", track: 1, trackTotal: 3 });
  const bare = T({ title: "b" }), half = T({ title: "c", artists: ["Z"], genre: "Rock", track: 3 });
  const other = T({ title: "d", album: "EP" });
  fillBatch([bare, rich, half]);
  assert.deepEqual([bare.title, bare.album, bare.artists, bare.genre, bare.track], ["b", "LP", ["X", "Y"], "Pop", 0]);
  assert.deepEqual([half.artists, half.genre, half.album, half.track], [["Z"], "Rock", "LP", 3]);
  const lone = T({ title: "e" });
  fillBatch([lone, T({ title: "f", album: "LP", genre: "Pop" }), other]);
  assert.equal(lone.album, ""); assert.equal(other.genre, ""); // two albums: untagged files aren't guessed into one
}
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
  // Round trip: what Taglet writes, Taglet reads back (tags and cover), with no audio engine involved.
  const coverBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 0, 0, 4, 0xff, 0xd9]);
  const full = { title: "Ünïcode ☆", artists: ["X", "Y", "Z"], album: "LP", albumArtist: "X", track: 2, trackTotal: 4, disc: 1, discTotal: 1,
    year: "2026", genre: "Pop", composer: "C", comment: "hi", lyrics: "line1\nline2", bpm: "120", isrc: "USABC2600001", copyright: "©", publisher: "P", compilation: true };
  const rt = Buffer.concat([buildId3(full, { bytes: coverBytes, mime: "image/jpeg" }), raw]);
  const back = readId3(new Uint8Array(rt));
  for (const k of Object.keys(full)) assert.deepEqual(back.tags[k], full[k], `round trip ${k}`);
  assert.deepEqual([...back.art.bytes], [...coverBytes]);
  assert.equal(back.art.mime, "image/jpeg");
  const info = mp3Info(new Uint8Array(rt));
  const real = +JSON.parse(execFileSync("ffprobe", ["-v", "error", "-show_format", "-of", "json", out]).toString()).format.duration;
  assert.ok(Math.abs(info.duration - real) < 0.06, `duration ${info.duration} vs ${real}`);
  assert.equal(info.sampleRate, 44100);
  // Noise is not an MP3, even when it happens to contain a frame-header pattern.
  const noise = new Uint8Array(200000); for (let i = 0; i < noise.length; i++) noise[i] = (i * 2654435761 >>> 13) & 255;
  noise[1000] = 0xff; noise[1001] = 0xfb; noise[1002] = 0x90; noise[1003] = 0x64;
  assert.equal(mp3Info(noise), null);
  // ID3v2.4 with a picture, written by ffmpeg (syncsafe frame sizes, UTF-8 text).
  const v24 = join(dir, "v24.mp3"), png = join(dir, "c.png");
  execFileSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "color=c=red:s=64x64", "-frames:v", "1", png]);
  execFileSync("ffmpeg", ["-v", "error", "-i", src, "-i", png, "-map", "0", "-map", "1", "-c", "copy", "-id3v2_version", "4",
    "-metadata", "title=Été", "-metadata", "artist=A; B", "-metadata", "album=Al", "-metadata", "track=3/9", "-disposition:v", "attached_pic", v24]);
  const r24 = readId3(new Uint8Array(readFileSync(v24)));
  assert.equal(r24.tags.title, "Été"); assert.deepEqual(r24.tags.artists, ["A", "B"]); assert.equal(r24.tags.track, 3); assert.equal(r24.tags.trackTotal, 9);
  assert.equal(r24.art.mime, "image/png"); assert.equal(r24.art.bytes[1], 0x50); // "PNG"
  // And the zip opens.
  const z = join(dir, "t.zip");
  writeFileSync(z, Buffer.concat(zipParts([{ name: "01 Ünï.mp3", bytes: new Uint8Array(raw) }]).map((p) => Buffer.from(p))));
  execFileSync("python", ["-c", "import zipfile,sys; z=zipfile.ZipFile(sys.argv[1]); assert z.testzip() is None and z.namelist()==[\"01 Ünï.mp3\"]", z]);
  console.log("ffprobe + zip checks passed");
} catch (err) {
  if (err.code === "ENOENT") console.log("ffmpeg not found; skipped decoder check"); else throw err;
}
console.log("ok");
