"""Taglet's link fetcher: YouTube and SoundCloud audio for "Add from a link".

Adapted from yt-audio-api by Alperen Sümeroğlu (MIT, see LICENSE.txt). It runs in a Cloudflare Container that
only Taglet's Worker can reach; the Worker checks the link and applies the daily limits first.
Changes from upstream: no debug server and no token store (the file goes straight back in the response),
playlists and sets are listed by /info, the original audio is returned (Taglet encodes once, no 192 kbps
round trip), song details travel in a header, and only YouTube/SoundCloud links of up to 20 minutes are taken.
"""
import json
import os
import re
import shutil
import tempfile
import urllib.parse

import yt_dlp
from flask import Flask, Response, jsonify, request

app = Flask(__name__)

HOSTS = re.compile(r"^(?:[a-z0-9-]+\.)*(youtube\.com|youtu\.be|soundcloud\.com)$")
MAX_SECONDS = 20 * 60
MAX_ENTRIES = 40
BASE = {"quiet": True, "no_warnings": True, "noplaylist": True, "cachedir": False}
TYPES = {"m4a": "audio/mp4", "mp3": "audio/mpeg", "webm": "audio/webm", "opus": "audio/ogg", "ogg": "audio/ogg"}


def allowed(url):
    try:
        u = urllib.parse.urlparse(url)
    except ValueError:
        return False
    return u.scheme == "https" and bool(HOSTS.match(u.hostname or ""))


def failure(e):
    """A short code the app turns into plain words."""
    s = str(e)
    if "confirm you" in s or "Sign in" in s or "429" in s:
        return jsonify(error="blocked"), 503
    if "Private" in s or "unavailable" in s or "not available" in s or "404" in s:
        return jsonify(error="unavailable"), 404
    app.logger.warning("fetch failed: %s", s[:500])
    return jsonify(error="failed"), 502


def thumb(i):
    return i.get("thumbnail") or ((i.get("thumbnails") or [{}])[-1].get("url") or "")


def uploader(i):
    return re.sub(r"\s*-\s*Topic$", "", i.get("artist") or i.get("uploader") or i.get("channel") or "")


@app.get("/info")
def info():
    url = request.args.get("url", "")
    if not allowed(url):
        return jsonify(error="unsupported"), 400
    try:
        with yt_dlp.YoutubeDL({**BASE, "extract_flat": "in_playlist", "playlistend": MAX_ENTRIES}) as y:
            i = y.extract_info(url, download=False)
    except Exception as e:  # noqa: BLE001 - yt-dlp raises many kinds
        return failure(e)
    entries = i.get("entries")
    playlist = entries is not None
    items = [{"url": e.get("url") or e.get("webpage_url"), "title": e.get("track") or e.get("title") or "",
              "artists": e.get("artists") or ([e["artist"]] if e.get("artist") else []),
              "album": e.get("album") or (i.get("title") if playlist else ""),
              "albumArtist": e.get("album_artist") or e.get("albumartist") or (uploader(i) if playlist else ""),
              "uploader": uploader(e) or uploader(i), "year": str(e.get("release_year") or (e.get("upload_date") or "")[:4]),
              "track": e.get("track_number") or 0, "genre": (e.get("genres") or [e.get("genre") or ""])[0] or "",
              "thumbnail": thumb(e), "duration": e.get("duration")}
             for e in (list(entries) if playlist else [i]) if e]
    return jsonify(kind="playlist" if playlist else "single", title=i.get("title") or "", uploader=uploader(i),
                   thumbnail=thumb(i), entries=[e for e in items if e["url"]][:MAX_ENTRIES])


@app.get("/audio")
def audio():
    url = request.args.get("url", "")
    if not allowed(url):
        return jsonify(error="unsupported"), 400
    tmp = tempfile.mkdtemp()
    try:
        opts = {**BASE, "format": "bestaudio/best", "outtmpl": f"{tmp}/a.%(ext)s",
                "postprocessors": [{"key": "FFmpegExtractAudio", "preferredcodec": "mp3", "preferredquality": "320"}],
                "match_filter": yt_dlp.utils.match_filter_func(f"duration < {MAX_SECONDS}")}
        try:
            with yt_dlp.YoutubeDL(opts) as y:
                i = y.extract_info(url, download=True)
        except Exception as e:  # noqa: BLE001
            return failure(e)
        files = os.listdir(tmp)
        if not files:  # skipped by the length filter
            return jsonify(error="too_long"), 413
        name = files[0]
        with open(os.path.join(tmp, name), "rb") as f:
            data = f.read()
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    ext = name.rsplit(".", 1)[-1]
    year = i.get("release_year") or (i.get("upload_date") or "")[:4]
    meta = {"title": i.get("track") or i.get("title") or "", "artists": i.get("artists") or ([i["artist"]] if i.get("artist") else []),
            "album": i.get("album") or "", "year": str(year or ""), "track": i.get("track_number") or 0,
            "genre": (i.get("genres") or [i.get("genre") or ""])[0] or "", "uploader": uploader(i), "thumbnail": thumb(i),
            "duration": i.get("duration") or 0, "ext": ext}
    return Response(data, mimetype=TYPES.get(ext, "application/octet-stream"),
                    headers={"X-Taglet-Meta": urllib.parse.quote(json.dumps(meta))})


@app.get("/health")
def health():
    return "ok"
