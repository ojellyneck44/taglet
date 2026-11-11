# Competitor analysis

November 2026. The goal: find what people trying to get their own music into Spotify have to put up with today, and what Taglet can do better.

## The job

Someone has audio that isn't on Spotify: a friend's demo, a bootleg, a DJ edit, a rip of an old CD, stems they bounced themselves. They want it in Spotify next to everything else, looking like a real album: right titles, every artist, a cover, tracks in order, one album instead of six. Today that takes two or three tools and a forum thread.

## Who they use now

| Tool | Platform | What it's good at | Where it falls short for this job |
|---|---|---|---|
| **Mp3tag** | Windows (free), macOS (paid) | The widest tag editing around: every field, scripting, batch actions, online lookups. | Desktop only. Doesn't convert audio. Dense, dated UI with a steep learning curve. Knows nothing about Spotify, so it can't tell you why an album splits. |
| **MusicBrainz Picard** | Win / Mac / Linux | Automatic tagging from a huge open database. | Built for music that's already in the database; little help for demos and edits. Doesn't convert. Clustering and matching confuse newcomers. |
| **Evertag** | iPhone / iPad | A clean, readable mobile tag editor with batch mode, cover editing, cloud sources and light/dark themes. | iOS only. Doesn't convert formats. No album-consistency check. Its reviewer's main complaint: no audio preview. |
| **WALTR PRO** | Mac / Windows (paid) | Beautiful drag-and-drop into Apple's apps. Converts on the fly and fills in metadata automatically. | Paid, and sends files to Apple Music, TV and Books, not Spotify. Needs a desktop app plus a cable or Wi-Fi bridge. |
| **Online converters** (123apps, CloudConvert, TagMP3.net and similar) | Browser | Nothing to install. | Your files are **uploaded to their server**. Ads, size caps and queues. Tags are an afterthought, cover cropping is rare, and none of them group tracks into albums. |
| **ffmpeg / foobar2000 / Kid3** | Desktop | Powerful and free. | You need to know what you're doing. No guidance about what Spotify actually reads. |

## Gaps we can close

1. **Nobody makes albums hold together in Spotify.** Spotify groups local files by the album tag, and in practice also by album artist, cover and track numbers. A guest artist on track 4 with no album artist set, or one track with a slightly different cover, splits the album. Every tool above edits tags; none checks the album as a whole.
   **Taglet:** album fields (title, album artist, year, genre, cover) are stored once on the album and written identically to every track. A live check on the album tag says "Ready for Spotify" or lists what's wrong, each with a one-tap fix: fill in the album artist, number tracks in order, add a cover.

2. **Converting and tagging are separate trips.** People convert in one tool, tag in another, then find the converter stripped the tags.
   **Taglet:** one place. Drop anything (FLAC, WAV, AIFF, ALAC, M4A, OGG, Opus, WMA, MP3) and get tagged MP3s out.

3. **"Which format does Spotify want?" is a forum question.** WAV and FLAC play on some desktops but their tags and art are ignored, and phones skip them.
   **Taglet:** picks MP3 (320 kbps by default) and says why in one sentence. MP3s you add are only re-tagged, never re-encoded, so they keep their quality.

4. **Gaps and dead air.** MP3 and AAC encoders add silence at the start and end. Careless converters bake it in, so albums meant to flow get clicks and gaps.
   **Taglet:** decodes with encoder delay removed, writes a LAME gapless header on every MP3, and has an optional "trim silent edges" switch for files that start with dead air.

5. **Privacy is an act of faith.** The online converters require uploading unreleased music to a stranger's server.
   **Taglet:** everything runs in the browser through ffmpeg compiled to WebAssembly. It says so in the interface, and you can verify it in the network panel.

6. **Multiple artists are mangled.** Tools write "A feat. B", "A/B" or "A; B" inconsistently, and Spotify shows the raw string.
   **Taglet:** each artist gets its own field. They're written the way Spotify displays its own catalogue: "A, B, C". There's a preview line, and a button to apply the same artists to every track.

7. **Phone and computer don't talk.** The audio is on the laptop and the cover is in the camera roll, and the finished files need to reach the phone's Spotify folder.
   **Taglet:** Link a device. Scan a QR code (or type a 10-character code) and either device can send songs or images to the other, end-to-end encrypted. Images arriving on a device become the cover. On iPhone, export goes straight to the Files app's Spotify folder through the share sheet. On Android, Taglet appears in the share menu once it's installed.

8. **Cover art is fiddly.** Most tools embed whatever you give them, so wide photos get squashed or Spotify crops them.
   **Taglet:** every image is cropped to a square automatically, centred. You can drag and pinch to choose the crop, and it warns when an image is too small to look sharp.

9. **Mobile is an afterthought** (Mp3tag, Picard, WALTR) or **desktop is** (Evertag).
   **Taglet:** one responsive app that installs to the home screen on iPhone, Android and desktop, and works offline once it has loaded.

## What we're not doing (yet)

- Online metadata lookup (MusicBrainz or Discogs). It's useful, but it means sending track names to a third party. It should be opt-in if it's ever added.
- Scripting and tag-format conversions on the scale of Mp3tag. Out of scope for a focused tool.
- Native apps. Live Activities and share extensions need App Store builds.
