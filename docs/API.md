# Push from PC & API

## Push videos from your PC

Your videos are made on your PC; AutoCast runs on the VPS. `tools/push.js` connects them. It needs Node.js 20+ and nothing else.

1. **Settings → Push from your PC → Make token**. Copy it (shown once).
2. On your PC:

```bash
node tools/push.js \
  --server https://cast.yourdomain.com \
  --token ac_xxxxxxxx \
  --folder "C:\Videos\exports" \
  --accounts "group:Finance" \
  --when slot \
  --skip-existing
```

| Option | Meaning |
|---|---|
| `--server` | Your AutoCast address |
| `--token` | The token from Settings |
| `--folder` | Folder to watch |
| `--accounts` | Names, ids or `group:<name>`, split by `,` `|` or `;`. Empty = only add to the library. |
| `--when` | `now`, `slot` (default) or `2026-11-05 18:30` |
| `--playlist <id>` | Also add to a live playlist |
| `--privacy` | `public`, `unlisted` or `private` |
| `--ai` | Mark as made with AI |
| `--every <s>` | How often to look (default 30) |
| `--once` | Send what is new, then exit |
| `--skip-existing` | First run: mark files already there as sent |

The script remembers what it sent in `<folder>/.autocast-sent.json`, waits until a file is done being written, and retries failed sends.

**Run it at Windows startup**: make a `.bat` with the command, put a shortcut in `shell:startup`.

### Sidecar `.json`

Next to `video.mp4`, a `video.json` sets the text:

```json
{
  "title": "Gold vs Bitcoin: 2026",
  "description": "Which one won?",
  "tags": ["gold", "bitcoin"],
  "when": "slot",
  "privacy": "public",
  "ai": true
}
```

All fields are optional.

## Upload hook (HTTP)

For your own tools. Uses the same token.

```bash
curl -H "Authorization: Bearer ac_xxx" \
     -F file=@video.mp4 \
     -F title="Hello" \
     -F description="Text #tag" \
     -F accounts="group:Finance" \
     -F when=slot \
     https://cast.yourdomain.com/hook/upload
```

| Field | Meaning |
|---|---|
| `file` | The video (required) |
| `title`, `description`, `tags` | Text (`tags` comma separated) |
| `meta` | A JSON string like the sidecar |
| `accounts`, `when`, `privacy` | As above |
| `ai` | `1` = AI label |
| `repeat_days`, `repeat_times` | Repeat post |
| `allow_repeat` | `1` = skip the duplicate guard |
| `playlist_id` | Also add to a live playlist |

Answer: `{"media_id": 12, "post_id": 34, "playlist_id": 3}`.
`GET /hook/ping` checks a token.

## CSV import

**All posts → ⇪ Import CSV**. First line is the header:

```csv
file,title,description,accounts,when,repeat_days,repeat_times,allow_repeat
/data/watch/batch/gold.mp4,"Gold, explained","Why it rose #gold",group:Finance,slot,,,
#12,Nickel ban,,Ahmad Finance|@ahmad.money,2026-11-05 18:30,30,3,
```

| Column | Meaning |
|---|---|
| `file` | A path on the server, or `#<id>` for a library video |
| `title`, `description` | Text. Use quotes for commas; `""` for a quote. New lines are fine inside quotes. |
| `accounts` | Names, ids or `group:<name>`, split by `|` or `;` |
| `when` | `now`, `slot` or `YYYY-MM-DD HH:MM` (server time) |
| `repeat_days`, `repeat_times` | Optional repeat |
| `allow_repeat` | `1` to skip the duplicate guard |

Bad lines are listed with their line number; good lines still import.

## Web API

The browser app uses a JSON API under `/api`. It needs the login cookie, and every write needs the header `x-autocast: 1`. It is meant for the UI; use the hook above for automation. Main groups:

| Path | What |
|---|---|
| `/api/media`, `/api/media/import` | Library |
| `/api/posts`, `/api/posts/csv`, `/api/targets/:id/{retry,cancel}` | Posts |
| `/api/rules` | Autopilot rules |
| `/api/accounts`, `/api/accounts/key`, `/oauth/:app/start` | Accounts |
| `/api/stations`, `/api/stations/:id/{start,stop,skip,extras,logo}` | Live |
| `/api/playlists` | Playlists |
| `/api/ai/*` | AI tools |
| `/api/settings`, `/api/system`, `/api/events`, `/api/backup` | Shared |
