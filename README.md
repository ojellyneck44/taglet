# Taglet

**[taglet.net](https://taglet.net)**: convert, tag and group your own music into albums for Spotify Local Files, entirely in the browser.

Drop in audio in nearly any format. Taglet gives you MP3s that Spotify reads properly: clean titles, a separate field for each artist (written as "X, Y, Z"), square cover art, and album fields kept identical across tracks so the album doesn't split. Nothing is uploaded. Decoding and encoding run in [ffmpeg.wasm](https://github.com/ffmpegwasm/ffmpeg.wasm) on your device.

Designed and built by Stevie McLane.

## What it does

- **Converts** WAV, FLAC, AIFF, ALAC, M4A/AAC, OGG, Opus, WMA and more to MP3 320 kbps (or V0). MP3s you add are only re-tagged, never re-encoded.
- **Removes encoder delay and padding.** Sources are decoded gap-free, every MP3 carries a LAME gapless header, and an optional switch trims silent edges.
- **Edits tags.** Album-level fields (album, album artist, year, genre, compilation, cover) live once per album. Per-track fields include title, a list of artists, and track and disc numbers. Composer, BPM, ISRC, publisher, copyright, comment and lyrics are on a separate "Other tags" screen.
- **Checks the album for Spotify**: missing album artist, missing or repeated track numbers, and missing cover, each with a one-tap fix.
- **Cover art**: automatic centred 1:1 crop, with drag, pinch, wheel and keyboard to adjust. Saved as a 1200px JPEG.
- **Exports** one file at a time (on phones, through the share sheet so you can "Save to Files") or as a zip with one folder per album.
- **Link a device**: pair two browsers with a QR code or a 10-character code and send songs or images either way, end-to-end encrypted. The relay only sees ciphertext.
- **Installs as an app** (PWA) on iPhone, Android and desktop, and works offline. On Android it appears in the share menu.

## How it's built

No framework and no build step. Static files in `public/` and one small Cloudflare Worker.

```
public/
  index.html, css/, js/app.js     the editor
  js/engine.js                    ffmpeg.wasm: probe, convert, gapless, silence trim
  js/tags.js                      ID3v2.3 writer, ffmetadata parser, store-only zip (pure, tested)
  js/link.js                      device link: code -> room hash + AES-GCM key, encrypted chunks
  sw.js, manifest.webmanifest     PWA (network-first shell, cache-first engine), Android share target
  vendor/core/core-0*.wasm        ffmpeg core split into three parts (Cloudflare's 25 MB asset limit)
  spotify/, privacy/, brand/      guide, privacy notes, live brand style sheet
src/worker.js                     serves the site; /api/link/:room is a Durable Object relay
docs/                             brand style sheet, competitor analysis
```

## Develop

```bash
npm install
npx wrangler dev        # http://localhost:8787
npm test                # tag writer, parser and zip checks (uses ffprobe if installed)
npx wrangler deploy     # deploys to taglet.net
```

## Licences

ffmpeg.wasm core is LGPL/GPL (see the ffmpeg.wasm project). Fonts: Bricolage Grotesque, Hanken Grotesk and JetBrains Mono, all under the SIL Open Font License. Motion (MIT) and qrcode-generator (MIT).
