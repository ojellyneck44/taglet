# Taglet

**[taglet.net](https://taglet.net)**: convert, tag and group your own music into albums for Spotify Local Files, entirely in the browser.

It opens straight onto the upload screen. Drop in audio in nearly any format. Taglet gives you MP3s that Spotify reads properly: clean titles, a separate field for each artist (written as "X, Y, Z"), square cover art, and album fields kept identical across tracks so the album doesn't split. Nothing is uploaded. Decoding and encoding run in [ffmpeg.wasm](https://github.com/ffmpegwasm/ffmpeg.wasm) on your device.

Designed and built by Stevie McLane. Spotify is a trademark of Spotify AB; Taglet isn’t affiliated with or endorsed by Spotify.

## What it does

- **Converts** WAV, FLAC, AIFF, ALAC, M4A/AAC, OGG, Opus, WMA and more to MP3 320 kbps (or V0). MP3s you add are only re-tagged, never re-encoded.
- **Removes encoder delay and padding.** Sources are decoded gap-free, every MP3 carries a LAME gapless header, and an optional switch trims silent edges.
- **Edits tags.** Album-level fields (album, album artist, year, genre, compilation, cover) live once per album. Per-track fields include title, a list of artists, and track and disc numbers. Composer, BPM, ISRC, publisher, copyright, comment and lyrics are on a separate "Other tags" screen.
- **Checks the album for Spotify**: missing album artist, missing or repeated track numbers, and missing cover, each with a one-tap fix.
- **Cover art**: automatic centred 1:1 crop, with drag, pinch, wheel and keyboard to adjust. Saved as a 1200px JPEG.
- **Exports** one file at a time (on phones, through the share sheet so you can "Save to Files") or as a zip with one folder per album.
- **Link a device**: pair two browsers with a QR code or a 10-character code and send songs or images either way, end-to-end encrypted. The relay only sees ciphertext.
- **New builds**: drop an updated render of a song you've already tagged (say `Night Drive v3 final.wav`) and Taglet matches it to the existing track by file name or title. You confirm, or pick a different track, before anything is replaced. The new audio keeps the track's title, artists, number, album and cover, so the re-export has the same name and tags and replaces the old file in Spotify instead of adding a duplicate. Each song's inspector also has a manual "New build" button, and every replacement can be undone.
- **Saved on the device**: albums, tags, covers and audio are kept in IndexedDB, so they're still there next visit.
- **Optional accounts** (same design as Any Day Now): sign in with an emailed code, Apple, Google or GitHub. Albums, tags, order and covers sync between devices through D1; audio never leaves a device. Synced tracks arrive with their tags and get their audio when you drop the matching file. The account UI stays hidden until a sign-in method is configured.
- **Share links**: share any album or single as a link. Songs are converted, then encrypted with AES-GCM on the device before upload. The key lives in the link's #fragment, so the server (Workers KV, 30-day expiry) only stores ciphertext. The share page decrypts in the browser, plays the songs and downloads them tagged. You can update or stop sharing from the app.
- **Singles**: a one-song upload is edited as a track, with no album fields, and exports as a single MP3.
- **Installs as an app** (PWA) on iPhone, Android and desktop, and works offline. On a phone browser, a sheet explains how to add it to the Home Screen; on Android it's a one-tap Install. Once installed, it behaves like a native app: no zoom, no pull-to-refresh, no stray text selection, a splash screen, bottom sheets you drag to dismiss, and safe-area insets. On Android it appears in the share menu.

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
src/worker.js                     serves the site; /api/link/:room is a Durable Object relay, /api/share stores encrypted shares in KV
public/s/, js/share.js, sharekit.js  the shared-link page and its AES-GCM helpers
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
