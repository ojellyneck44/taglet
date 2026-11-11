# Taglet: 7 social shorts (brief for the Mac render session)

Render on the MacBook with the **walkthrough-video** method (raea, GPU). Do NOT render on Stevie's Windows PC: it crashes. Work in `~/Studio/anydaynow` (clone of github.com/ojellyneck44/studio), project `projects/taglet/`. Run `raea context .` first. The finished Taglet walkthrough (`walkthrough.tsx`, `SHOTLIST.md`, `brief.ts`, v2 approved) is the source for look, screens, lifts and SFX. Build the shorts the way the Any Day Now shorts were built (`../walkthrough/short-lib.tsx` + `shorts.ts` + one `short-<id>.tsx` each), but cut from Taglet's own segments (add `short-lib.tsx`/`shorts.ts` to `projects/taglet/` if they don't exist there).

## One correction from Stevie (apply to all 7)
**Less horizontal rotation of the phone in 3D: it turns the text away from the viewer.** Cut every yaw by roughly half and keep headline plates square to the camera:
- camera keyframe `yaw`: multiply by 0.5 (for example 0.32 becomes 0.16, 0.7 intro becomes 0.35, -0.45 outro becomes -0.22), and the slow sine drift 0.06 becomes 0.03;
- phone body `yaw` sway `0.26 * sin(f / 24)` becomes `0.12`, the constant `-0.1` becomes `-0.05`;
- lift tilt `ry` (the `tilt * k * 0.6` and `-0.25 * k * sin(yaw)` terms) halved so lifted elements stay readable;
- whips (full spins between features) stay, since they are the transition, but must finish facing the camera, and text must never be on screen while the phone is side-on.
All other house rules stay (anti-flicker, per-line plates, no pulsing to the beat, SFX only, no music, -14 LUFS, no Spotify logo or green, 142 bpm grid).

## Format
9:16, 1080x1920, 30 fps, 142 bpm, **18 to 26 seconds each** (hook 6 beats, 2 to 4 feature segments cut from the walkthrough's own shots, end card 8 beats padded to a bar). Same end card (icon, taglet wordmark, a tagline, taglet.net pill, iPhone model credit). Never show UI that does not exist. Each short is a different audience and angle.

## The seven (one per day, Nov 12 to Nov 18, 2026)

| # | Day | File name (final share copy) | Audience / use case | Hook (max 3 short lines) | Segments (SHOTLIST rows) | Sub line |
|---|---|---|---|---|---|---|
| 1 | Nov 12 | tg-localfiles | Spotify Local Files users whose own songs show with no artist or art | "Your own songs." / "Tagged right." | 0 hook, 1 add songs, 3 auto-albums, 6 Ready for Spotify (show moment) | Local Files, finally readable. |
| 2 | Nov 13 | tg-demos | Musicians sending demos and mixes | "Demos deserve" / "a real cover." | 4 cover art, 5 every artist, 6 Ready, 13 share link | Send it to anyone. |
| 3 | Nov 14 | tg-flac | People with FLAC / WAV collections who need phone-friendly MP3 | "FLAC to MP3," / "tags kept." | 1 any format in (chips), 11 export sheet, 2 nothing uploaded | Nothing uploaded. |
| 4 | Nov 15 | tg-messy | Anyone with a messy album (split in two, wrong order) | "Messy album?" / "20 seconds." | 3 auto-albums, 7 reorder and renumber, 8 other tags | Drag. Renumber. Done. |
| 5 | Nov 16 | tg-newmix | Producers and bedroom artists with many bounces | "New mix?" / "Swap it in." | 10 new builds, 9 singles, 13 share link | Tags carry over. |
| 6 | Nov 17 | tg-devices | People moving files between phone and laptop | "Phone to laptop." / "No cable." | 12 link a device, 14 sync, 15 install | End-to-end encrypted. |
| 7 | Nov 18 | tg-car | USB-stick and car-stereo / old iPod listeners (track order, cover art in the dash) | "USB for the car?" / "Number them." | 7 reorder and renumber, 4 cover art, 11 export zip | Order and art, in the dash. |

(The share-link and sync rows use the same motion graphics as the approved walkthrough; no real signed-in screens, as agreed there.)

## Render safety (the PC crashes under heavy load; keep the Mac gentle too)
One render at a time. `tools/render-shorts.sh PYTHON <id>` per short, with `KBPS=40000` for dark-heavy cuts. Look at the check output and flash scan; fix P0/P1. Share copy per the skill (crf 16, aq-mode=3, aq-strength 1.3, `-c:a copy`). Shares of 18 to 26 s should be roughly 10 to 25 MB: keep each under **25 MB** because the file is hosted on taglet.net (Cloudflare limit 25 MiB per file). If one is larger, re-encode that share copy at a higher crf. Keep masters on the Mac.

## Delivery
1. Commit the share copies (not masters) to `projects/taglet/out/shorts/` in ojellyneck44/studio, named `<file name>.mp4` exactly as in the table (`tg-localfiles.mp4` and so on), and push.
2. Write `projects/taglet/out/shorts/DONE.md` listing each file, its duration and size, and any problem.
3. The Windows session then copies them into `taglet/public/social/videos/`, deploys, and the daily routine posts the matching queue item (Reels and Shorts) on its day.

## Captions and hashtags (already queued, for reference)
Reels/Shorts captions are in the Taglet HQ queue (https://claude.ai/artifact/KCjB3xbacVMi7S44fY1fSn). Do not change the hook text without updating them.
