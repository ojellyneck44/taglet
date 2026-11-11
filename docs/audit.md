# Taglet: UX/UI audit

Live site https://taglet.net, 10 November 2026. Viewports 390×844 (touch) and 1440×900. Pages: `/` (welcome, plus the editor with two songs loaded), `/spotify/`, `/privacy/`, `/brand/`, and the 404 page. Measured with the ux-ui-audit probes (core, heuristics, perception, LTR) in Chrome via Playwright, Impeccable's detector, and manual keyboard and reading passes. Judged against WCAG 2.2 AA, Nielsen's ten heuristics, and `docs/brand.md`.

## Summary

The first pass found 6 issues, and all 6 are fixed and re-measured. The final pass found no contrast, tap-target, naming, heading or overflow failures on any page at either width, and no console errors.

## Findings (all fixed)

01 · Accessibility · every page: footer links were 21px tall.
```
"Privacy" 46 x 21, "Brand" 37 x 21 (SC 2.5.8 minimum 24, house rule 44)
```
FIX: footer links are now `inline-flex; min-height: 44px` and measure 44 tall.

02 · Accessibility · editor: the "Album" select was wrapped by its label, so its accessible name swallowed every option.
```
accessibleName: "Album Untitled album New album from this song" (SC 4.1.2)
```
FIX: an explicit `<label for="moveAlbum">`.

03 · Accessibility · editor: the duration text on the selected track row was 4.24:1.
```
"0:02" rgb(142,134,123) on rgb(43,37,28) = 4.24:1 (SC 1.4.3 needs 4.5)
```
FIX: the selected row uses Paper 2 for numbers (8.5:1 or better).

04 · Accessibility · editor: once the welcome screen hides, the page had no h1.
```
h1Count: 0, outline: ["H2: Albums", "H2: Tracks", "H2: Track"]
```
FIX: a visually hidden `<h1>Taglet editor</h1>` in the workspace.

05 · Major · live: Cloudflare injected its Web Analytics beacon, which contradicted the privacy page's "no analytics". The CSP blocked it, so the console showed an error.
```
Loading the script 'https://static.cloudflareinsights.com/beacon.min.js/...' violates ... script-src
```
FIX: `Cache-Control: no-transform` on HTML pages stops the injection. To be thorough, also turn off Web Analytics for the zone in the dashboard.

06 · Major · import: untagged files dropped together each became their own album, which works against the app's main promise.
FIX: untagged files from one drop now form one album. A lone untagged song becomes a single named after itself. On phones, when there's only one album, Taglet opens it directly instead of showing a one-item list.

## Heuristic pass (Nielsen)

- **Visibility of status:** engine download percentage, "Reading 2 of 12", per-file export progress, the album's "Ready for Spotify" / "N to fix" tag, and link status.
- **Match with the real world:** Spotify's own wording ("Local Files", "Show audio files from this device"). Artists are written the way Spotify displays them.
- **Control and freedom:** Undo when removing a song, cancel in the crop sheet, Back on every phone pane. Escape closes menus and sheets.
- **Error prevention:** a warning before leaving with unsaved work, Year accepts digits only, and the album check flags problems before export.
- **Recognition over recall:** album fields sit next to the album. The artist preview line shows the exact string Spotify will display.
- **Flexibility:** drag and drop, paste an image to set the cover, keyboard reordering (arrow keys on the grip), pinch, wheel and arrow keys in the cropper.
- **Help:** the guide (`/spotify/`) is linked from the welcome screen, the album list and the end of every export.

## Checked and fine

- Text contrast is 4.5:1 or better on every measured node (16–66 per page). The focus ring is 2px Patina, 9.0:1 against Ink 0, and shows only on `:focus-visible`.
- One h1 per page, no skipped heading levels, a skip link on every page, and landmarks in place.
- Sentence case throughout. "Open Taglet" and "Liquid Glass" are proper nouns.
- SEO: unique titles and descriptions, canonicals that match their own URLs, Open Graph image, `WebApplication` JSON-LD, robots.txt pointing at the sitemap. The sitemap lists 4 URLs, all 200 with no redirects, no noindex and HTTPS only. The 404 page is `noindex`.

## Not verified

- A real iPhone and a real Android phone. Phone checks used Chrome's touch emulation at 390px.
- Link a device between two separate networks. It was tested between two tabs on the same machine. It relays through Cloudflare, so NAT doesn't matter, but real cellular-to-Wi-Fi speed wasn't measured.
- How Spotify itself displays the exported files. The tags were checked by reading them back with ffmpeg.
