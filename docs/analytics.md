# Analytics

Anonymous, cookieless usage counts in Workers Analytics Engine (binding `EVENTS`, dataset `taglet_events`). The dataset is created on the first write; data is kept for three months. Nothing personal is ever written: no emails, file names, titles or IPs. Cloudflare's Web Analytics beacon stays off (`Cache-Control: no-transform` on pages).

| blob1 | blob2 | Sent from |
| --- | --- | --- |
| `visit` | `new` / `d1` / `d8` / `d31` (first visit, or days since: ≤7, 8–30, >30) | browser, once a day |
| `import` | `one` / `many` | browser, when songs are added |
| `export` | `zip` / `files` | browser, when an export finishes |
| `install` | | browser, app installed |
| `page` | path with `/` as `-` (e.g. `guides-flac-to-mp3`) | browser, on doc pages |
| `ref` | `?ref=` value | browser, on arrival |
| `share_created` | | Worker, new share link |
| `link_import` | `youtube` / `soundcloud` | Worker, song fetched from a link |
| `sign_in` | `email` | Worker |
| `audio_synced` | | Worker, a song uploaded to the account |

Browser events go through `POST /api/event` (limited to 300 per IP per day, names allow-listed).

## Leaving ourselves out

Not counted: anything that isn't a real browser (curl, scripts, headless Chrome), and any browser that opened **https://taglet.net/api/team** once (`?off=1` undoes it). Open that link on every device you use.

## Querying

Create an API token with **Account → Account Analytics → Read**, then:

```bash
curl "https://api.cloudflare.com/client/v4/accounts/$ACCOUNT_ID/analytics_engine/sql" -H "Authorization: Bearer $API_TOKEN" -d "SELECT blob1 AS event, blob2 AS detail, SUM(_sample_interval) AS count FROM taglet_events WHERE timestamp > NOW() - INTERVAL '7' DAY GROUP BY event, detail ORDER BY count DESC"
```

Use `SUM(_sample_interval)` rather than `COUNT()`; Analytics Engine samples at high volume.
