# Troubleshooting

Look in **Activity log** first, or `docker compose logs -f autocast`. Failed posts have **✦ Explain this error** if AI is set up.

## Logins

| Problem | Fix |
|---|---|
| "Set up" instead of "Log in" | Add that platform's app keys in Settings |
| Login page says *redirect_uri mismatch* | The redirect URI in the platform app must match the one in Settings exactly (https, domain, path) |
| Login works, then expires after 7 days (Google) | Your Google app is in *Testing*. Publish the consent screen. |
| "PUBLIC_URL is not set" | Set it in `.env`, then `docker compose up -d` |
| Instagram account not added | It must be Business/Creator and linked to a Facebook Page you manage |
| Account shows "Log in again" | Press Log in. Tokens were revoked, expired or the password changed. |

## Posting

| Problem | Fix |
|---|---|
| YouTube video is private | Google hasn't verified your app yet |
| TikTok "Posted as private" | TikTok hasn't audited your app yet |
| "quotaExceeded" | YouTube daily quota used. Wait for the reset, or ask Google for more. |
| "already goes to … Tick allow repeat" | Duplicate guard. Tick **Allow repeat**, or change the days in Settings. |
| "hit its limit of N posts today" | Daily limit. Use **Next free slot**. |
| "AI safety check: …" | Edit the text, or set Safety to *Warn* |
| Autopilot doesn't pick up a file | The folder must be on the server. Files present when the rule was made are skipped. A file changed in the last 10 s waits. |

## Live

| Problem | Fix |
|---|---|
| Destination "Retrying — Can't reach the server" | Wrong server URL, or the platform is down |
| "Server refused the stream" | Wrong or old stream key. Keys like Instagram's change every live. |
| "… is already live on …" | One account can be on only one station. Turn it off on the other one. |
| Station stays "Preparing…" | Big videos take a while the first time. Watch the library card's %. |
| "Live relay is off" in the sidebar | `docker compose up -d relay` |
| Stutter with overlay on | Overlay re-encodes video. Use 720p, a stronger VPS, or turn the overlay off. |
| A drop every few seconds on all destinations | Not enough upload speed. Use fewer destinations or lower quality. Check Settings → Server. |
| Logo doesn't show | Upload a PNG or JPG, turn **Logo** on, press Save |

## AI

| Problem | Fix |
|---|---|
| "AI key was refused" | Wrong key, or no access to that model |
| "AI service not reachable" | Wrong base URL. It usually ends in `/v1`. From Docker, `127.0.0.1` means the container itself — use the VPS IP or `host.docker.internal`. |
| "AI limit reached" | Rate limit at your provider. Try later. |
| Transcribe fails | Your service has no `/audio/transcriptions`. Use OpenAI `whisper-1` or a proxy that serves it. |
| Thumbnail ignores the frames | Set a vision model |

## Server

| Problem | Fix |
|---|---|
| Forgot the password | `docker compose exec autocast node -e "require('./src/db').run(\"DELETE FROM settings WHERE k='admin'\")"` then open the site to make a new one |
| Disk full | Settings → delete old unused videos after N days; remove old recordings in the control room |
| Container keeps restarting | `docker compose logs autocast` — often a bad `.env` value |
