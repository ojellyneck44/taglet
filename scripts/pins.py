"""Makes the Pinterest pin images (1000x1500 PNG) and public/social/pinterest/pins.json from the list below.
Needs: pip install fonttools brotli, and sharp (already in node_modules). Run: python scripts/pins.py
Text is turned into outlines with the site's own fonts, so nothing depends on system fonts."""
import json, os, re, subprocess, tempfile
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "public", "social", "pinterest")
tmp = tempfile.mkdtemp()
fonts = {}
for n in ("bricolage", "hanken"):
    f = TTFont(os.path.join(ROOT, "public", "fonts", n + ".woff2")); f.flavor = None
    p = os.path.join(tmp, n + ".ttf"); f.save(p); fonts[n] = TTFont(p)

def glyphs(font, text, size, tracking=0):
    f = fonts[font]; gs = f.getGlyphSet(); cmap = f.getBestCmap(); s = size / f["head"].unitsPerEm
    return [(gs[cmap[ord(c)]], s) if ord(c) in cmap else None for c in text], tracking

def width(font, text, size):
    gl, tr = glyphs(font, text, size)
    return sum((g.width * s if g else size * .3) + tr for g, s in [x or (None, 1) for x in gl]) if False else sum((x[0].width * x[1] if x else size * .3) for x in gl)

def path(font, text, size, x, y, tracking=0):
    gl, _ = glyphs(font, text, size); d = []; cx = x
    for c, x_ in zip(text, gl):
        if not x_: cx += size * .3; continue
        g, s = x_; pen = SVGPathPen(fonts[font].getGlyphSet()); g.draw(TransformPen(pen, (s, 0, 0, -s, cx, y))); d.append(pen.getCommands()); cx += g.width * s + tracking
    return " ".join(d)

def wrap(font, text, size, maxw):
    lines, cur = [], ""
    for w in text.split():
        t = (cur + " " + w).strip()
        if width(font, t, size) <= maxw or not cur: cur = t
        else: lines.append(cur); cur = w
    return lines + [cur]

icon = open(os.path.join(ROOT, "public", "icon.svg"), encoding="utf8").read()
inner = re.search(r"<svg[^>]*>(.*)</svg>", icon, re.S).group(1)
inner = re.sub(r"<defs>.*?</defs>", "", inner, flags=re.S)
inner = re.sub(r'<rect width="512" height="512"[^>]*/>', "", inner)

BASE = "https://taglet.net"
PINS = [
    ("flac-to-mp3", "/guides/flac-to-mp3/", "Convert FLAC to MP3 and keep your tags", "Free, in your browser. Titles, artists and cover art stay.", "How to convert FLAC to MP3 without losing tags or cover art, free and private, in your browser."),
    ("wav-to-mp3", "/guides/wav-to-mp3/", "WAV to MP3, with titles and cover art", "WAV files can't hold tags. MP3 can.", "Convert big WAV files to MP3 and add the title, artist, album and cover art that WAV can't store."),
    ("fix-mp3-tags", "/guides/fix-mp3-tags/", "Fix wrong MP3 tags in minutes", "Split albums, missing artists, blank covers.", "Fix wrong or missing MP3 tags: album split in two, songs out of order, no artist, no cover."),
    ("add-cover-art", "/guides/add-cover-art/", "Add album art to your MP3s", "Square, embedded, shows in every player.", "Embed square album cover art in MP3 files so it shows in Spotify Local Files and every music player."),
    ("spotify-local-files", "/spotify/", "Play your own music files in Spotify", "Local Files on Mac, PC, iPhone and Android.", "How to get your own MP3s into Spotify with Local Files on Mac, PC, iPhone and Android."),
    ("tag-and-convert", "/", "Tag and convert your music, free", "Fix titles, artists and covers. Nothing is uploaded.", "Taglet fixes titles, artists and cover art on your own music files and exports MP3s for Spotify Local Files. Free, private, in your browser."),
]
out = []
for slug, link, title, sub, desc in PINS:
    W, H = 1000, 1500
    tl = wrap("bricolage", title, 104, 820); y = 640
    body = ""
    for l in tl:
        body += f'<path d="{path("bricolage", l, 104, 90, y)}" fill="#f3ece2"/>'; y += 122
    y += 20
    for l in wrap("hanken", sub, 44, 820):
        body += f'<path d="{path("hanken", l, 44, 90, y)}" fill="#bdb4a7"/>'; y += 60
    svg = f'''<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}"><defs>
<radialGradient id="bg" cx="25%" cy="12%" r="100%"><stop offset="0" stop-color="#2a2520"/><stop offset=".55" stop-color="#141210"/><stop offset="1" stop-color="#0b0a09"/></radialGradient>
<radialGradient id="gl" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="#3cb4a3" stop-opacity=".25"/><stop offset="1" stop-color="#3cb4a3" stop-opacity="0"/></radialGradient>
<linearGradient id="tag" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#74d8c9"/><stop offset="1" stop-color="#3cb4a3"/></linearGradient></defs>
<rect width="{W}" height="{H}" fill="url(#bg)"/><ellipse cx="500" cy="300" rx="520" ry="380" fill="url(#gl)"/>
<g transform="translate(330,40) scale(0.68)">{inner}</g>
{body}
<path d="{path("hanken", "TAGLET.NET", 38, 90, 1390, 8)}" fill="#5fcdbc"/></svg>'''
    sp = os.path.join(tmp, slug + ".svg"); open(sp, "w", encoding="utf8").write(svg)
    fn = f"{slug}.png"
    subprocess.run(["node", "-e", f"require('sharp')({json.dumps(sp)}).png().toFile({json.dumps(os.path.join(OUT, fn))}).then(()=>0)"], cwd=ROOT, check=True)
    out.append({"slug": slug, "file": fn, "link": f"{BASE}{link}?ref=pinterest", "title": title[:100], "description": desc + " " + BASE.replace("https://", ""), "alt": f"Taglet pin: {title}"})
json.dump(out, open(os.path.join(OUT, "pins.json"), "w", encoding="utf8"), indent=1)
print(len(out), "pins")
