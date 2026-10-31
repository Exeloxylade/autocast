# Install

AutoCast runs as three Docker containers on one server:

| Container | Job | Port |
|---|---|---|
| `autocast` | The web app, scheduler and live engine (Node.js + FFmpeg) | `127.0.0.1:7676` only |
| `relay` | MediaMTX, the internal stream hub | inside Docker only |
| `caddy` *(optional)* | HTTPS front door with free certificates | `80`, `443` |

## What you need

| Thing | Minimum | Good for 24/7 live |
|---|---|---|
| VPS | 1 CPU, 1 GB RAM, 20 GB disk | 2–4 CPU, 4 GB RAM, 100 GB disk |
| OS | Ubuntu 22.04+ or Debian 12+ | |
| Upload speed | 10 Mbps | ~6 Mbps per destination at 1080p |
| Monthly data | — | ~2 TB per 1080p destination running 24/7 |
| A domain | `cast.yourdomain.com` pointing (DNS A record) to the VPS IP | |

The domain is needed because Google, Meta and TikTok only send logins back to an HTTPS address.

## 1. Install

```bash
git clone https://github.com/Exeloxylade/autocast.git
cd autocast
```

**A. Nothing else on ports 80/443** — let AutoCast handle HTTPS:

```bash
PUBLIC_URL=https://cast.yourdomain.com WITH_CADDY=1 ./install.sh
```

**B. You already run nginx or Caddy** (for example for other apps):

```bash
PUBLIC_URL=https://cast.yourdomain.com ./install.sh
```

then add one site to your existing proxy.

nginx:

```nginx
server {
  listen 443 ssl;
  server_name cast.yourdomain.com;
  # ssl_certificate ... (certbot adds these)
  client_max_body_size 8G;
  location / {
    proxy_pass http://127.0.0.1:7676;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_read_timeout 3600s;
    proxy_request_buffering off;
  }
}
```

Caddy (host install):

```
cast.yourdomain.com {
  request_body { max_size 8GB }
  reverse_proxy 127.0.0.1:7676
}
```

The installer:

1. installs Docker if it is missing,
2. makes `.env` with a new random `AUTOCAST_SECRET`,
3. sets your `PUBLIC_URL` (and the domain in `Caddyfile`),
4. builds and starts the containers.

## 2. First login

Open `https://cast.yourdomain.com`. The first visit asks you to **make a password** (8+ characters). That is the only account.

## 3. Set up

1. **Settings → app keys**: add the Google, Meta and/or TikTok app keys. Each card shows the redirect URI to copy. See [PLATFORMS.md](PLATFORMS.md).
2. **Accounts**: press **Log in** for each platform, or **＋ Stream key** for live-only apps.
3. **Settings → AI** *(optional)*: connect an AI service. See [AI.md](AI.md).
4. **Settings → Alerts** *(optional)*: Telegram bot token + chat ID.

## Settings in `.env`

| Name | Default | What it does |
|---|---|---|
| `PUBLIC_URL` | — | Your HTTPS address. Needed for logins. |
| `AUTOCAST_SECRET` | random | Locks saved tokens and keys. **Keep it.** Changing it makes saved logins unreadable. |
| `TZ` | `Asia/Jakarta` | Server clock for schedules and post times |
| `UPLOAD_PARALLEL` | `2` | Posts sent at the same time |
| `FONT_FILE` | DejaVu Sans Bold | Font for overlays, thumbnails, captions |
| `RECORD_SEGMENT_S` | `3600` | Length of each live recording file |
| `AI_TIMEOUT_MS` | `180000` | How long to wait for the AI service |

After changing `.env`: `docker compose up -d`.

## Folders

Everything lives in `./data` on the VPS (`/data` inside the container):

| Folder | What |
|---|---|
| `data/autocast.db` | Database: accounts, posts, stations, settings |
| `data/media/` | Uploaded videos |
| `data/prepared/` | Videos prepared for live |
| `data/watch/<name>/` | Put folders here for autopilot rules and folder playlists (use `/data/watch/<name>` in the app) |
| `data/recordings/` | Live recordings |
| `data/secret.key` | Only if `AUTOCAST_SECRET` is not set |

## Update

```bash
cd autocast
git pull
docker compose up -d --build
```

## Backup

- **Settings → Backup → Download** gives a clean copy of the database.
- For everything, copy the whole `data/` folder and your `.env`.
- Without `AUTOCAST_SECRET`, saved logins and keys in a backup cannot be read. Store it somewhere safe.

## Logs

```bash
docker compose logs -f autocast
```

Or open **Activity log** in the app.

## Try it locally (no VPS)

Needs Node.js 22.5+ and FFmpeg on your PC.

```bash
cd app
npm install
npm start                 # http://127.0.0.1:7676
```

For live streaming locally you also need [MediaMTX](https://github.com/bluenviron/mediamtx/releases) running with the bundled `mediamtx.yml` (`mediamtx ../mediamtx.yml`).

**Demo with sample data** (fake test accounts, local test streams, a fake AI so every button works):

```bash
MEDIAMTX=/path/to/mediamtx node test/demo.js
```

Open `http://127.0.0.1:7676`. The demo skips the password on your own machine only.

## Uninstall

```bash
docker compose down          # stop
rm -rf data .env             # delete all data — cannot be undone
```
