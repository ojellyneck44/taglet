FROM python:3.12-slim
# yt-dlp needs ffmpeg for SoundCloud's streams and a JavaScript runtime (Deno) for YouTube.
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg ca-certificates && rm -rf /var/lib/apt/lists/*
COPY --from=denoland/deno:bin /deno /usr/local/bin/deno
# yt-dlp is left unpinned on purpose: YouTube changes often and old versions stop working. Redeploy to update.
RUN pip install --no-cache-dir "yt-dlp[default]" flask gunicorn
WORKDIR /app
COPY app.py .
EXPOSE 8080
CMD ["gunicorn", "-b", "0.0.0.0:8080", "-w", "1", "--threads", "4", "-t", "300", "app:app"]
