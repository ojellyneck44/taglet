# Taglet brand style sheet

The live version, with swatches and type specimens, is at [taglet.net/brand](https://taglet.net/brand/). Tokens live in `public/css/base.css`.

## Idea

A taglet is a small tag. The brand is a patina-green tag hanging on a string in a dark room: warm, handled, a little playful, and plain-spoken about what it does with your files.

## Colour

| Token | Hex | Role | Contrast on Ink 0 |
|---|---|---|---|
| Ink 0 | `#0B0A09` | Page background, warm near-black | n/a |
| Ink 1 | `#141210` | Panels | n/a |
| Ink 2 | `#1C1916` | Raised rows, toasts | n/a |
| Ink 3 | `#27231F` | Placeholders, tracks, quiet fills | n/a |
| Paper | `#F3ECE2` | Primary text | 16.9:1 |
| Paper 2 | `#BDB4A7` | Secondary text | 9.7:1 |
| Paper 3 | `#8E867B` | Hints, metadata | 5.5:1 |
| Patina (accent) | `#46C2B0` | Primary actions, selection, focus, "Ready" | 9.0:1 |
| Signal | `#FF7558` | Problems and destructive actions only | 7.5:1 |

Text on the accent uses its own dark ink, `#04201B` (7.8:1). The accent is fixed: one colour, so the brand reads the same everywhere.

Why these colours: dark suits the use scene (sorting music late, on a laptop or in bed on a phone), and it lets album art be the brightest thing on screen. The usual "AI app" accents (indigo-violet gradients, neon on black, emerald) were ruled out. Patina was picked over a first-draft manila gold: a classic, calm blue-green that stays clear of Spotify's green.

## Type

Three faces, each with one job. All are open-source and self-hosted.

| Face | Use | Weights |
|---|---|---|
| **Bricolage Grotesque** | Display: headings, album titles, wordmark | 600–700, tracking −0.02 to −0.035em |
| **Hanken Grotesk** | Interface and body text | 400 body, 600 labels/buttons |
| **JetBrains Mono** | Data only: track numbers, durations, file names, pairing codes | 500 |

Scale (1.25 ratio, 16px body): 12.5 / 14 / 16 / 20 / 25.6 / 34.4 / clamp(38–66) px.

## Icon

A patina tag on a string, tipped −14° as if it just swung. The string runs into the eyelet. Three lines on the tag stand for title, artists and album, the first one bold. The tag runs from `#74D8C9` to `#3CB4A3`; the background is a warm radial from `#2A2520` to Ink 0. Files: `public/icon.svg` (source), PNGs at 180/192/512, maskable 512 with an 80% safe zone, and `favicon.ico`.

The small mark (top bar, favicon) is the same tag simplified to a silhouette with an eyelet, so it holds up at 16px.

## Surfaces

- **Liquid Glass** only on the floating control layer: the top bar, the phone dock, menus and sheets. Content is never glass.
- The glass has something to bend because the current album's art is blurred into the room behind it, so the bars take on that album's colours.
- Radii: 5px album art (covers are near-square in real life), 9–10px fields and rows, capsules for buttons and bars, 26px sheets.
- No cards as page structure, no gradient text, no coloured side borders, no glow.

## Motion

- One idea: the tag on a string. It leans toward the pointer on the welcome screen, swings when files arrive, and knocks once when an album becomes "Ready for Spotify".
- Screens slide by direction (deeper goes right, back goes left) using the View Transitions API, and the album cover morphs between the list and the album on phones. Pages cross-fade with a slight blur.
- Ease-out curves (`cubic-bezier(0.16, 1, 0.3, 1)`) and springs that settle. Toasts rise on a spring.
- `prefers-reduced-motion` turns all of it off.

## Voice

- Plain words, sentence case, second person. Buttons say what will happen: "Number in this order", "Save as zip", "Use this cover".
- Errors say what went wrong and what to do next.
- Be exact about privacy: what stays on the device, and the one feature (Link a device) that moves files, encrypted.
- Spotify is named only to say what Taglet works with. It's never part of the brand.
