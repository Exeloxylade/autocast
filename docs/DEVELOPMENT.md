# Development

## Stack

Node.js 22.5+ (built-in `node:sqlite`), Express, FFmpeg, MediaMTX. The UI is plain HTML/CSS/JS with no build step. Only two npm packages: `express` and `multer`.

## Layout

```
app/
  server.js              routes: auth, upload, live, shared, AI, push hook
  src/
    config.js            env settings, data folders
    db.js                SQLite schema + small helpers + event log
    crypto.js            AES-GCM sealing, scrypt, HMAC signing
    accounts.js          tokens, refresh, stream keys
    media.js             probe, thumbnails, prepare-for-live, vertical, shorts
    notify.js            Telegram alerts
    upload/
      connectors.js      YouTube, TikTok, Facebook, Instagram, mock, stream-key apps
      scheduler.js       send queue, retries, slots, autopilot rules, CSV, digest timer
      http.js            fetch helpers
    live/engine.js       stations: encoder → relay → pushers, overlay, music, recording, schedules
    ai/client.js         OpenAI-compatible client, JSON parsing, usage
    ai/features.js       the AI tools
  public/                index.html, app.js, style.css
  test/                  unit + end-to-end tests, fake AI, demo
tools/push.js            PC uploader
docs/                    this documentation
```

## Live engine

```
prepared files ─► ffconcat list (outpoint = exact video end)
               ─► ENCODER  ffmpeg -re -stream_loop -1 -f concat … -c:v copy (or x264 when overlay is on)
                           audio always re-encoded with aresample=async (smooths the joins)
               ─► RELAY    rtmp://relay:1935/st<id>
               ─► PUSHER   one ffmpeg -c copy per destination, own retry (2,4,8,15,30 s), stall check
```

Lessons built in:

- Prepared files have **no B-frames**, and the concat list cuts each file at its exact video end, so joins never break timestamps.
- Pushers start only after **2 s of encoder output**; MediaMTX needs both tracks before a path can be read.
- Only **one** encoder per station may publish. Overlapping reloads wait for the old encoder to leave the relay.
- The logo is looped **inside the filter** (`movie=…,loop`). An image input either ends or runs ahead of `-re` video.
- Overlay text is read from a file every frame (`reload=1`), so text and AI lines change with no restart.

## Run tests

Needs FFmpeg on PATH. Live tests need a MediaMTX binary (`MEDIAMTX=/path/to/mediamtx`, default looks in `$KIROCREW_SCRATCH/mediamtx` or the temp folder). Port 1935 must be free.

```bash
cd app && npm install
npm test                      # unit (crypto, schedules, CSV parser)
node test/upload.e2e.js       # posting, retries, slots, autopilot, login security
node test/live.e2e.js         # real relay: 3 destinations, joins, drops, reloads, schedules
node test/features.e2e.js     # push script, vertical, shorts, CSV, overlay, music, recording, backup …
node test/ai.e2e.js           # every AI tool against a fake OpenAI-style server
node test/demo.js             # demo on :7676 with sample data and a fake AI
node test/ui.e2e.js           # browser click-through (needs playwright-core + the demo)
```

Tests use a temp data folder and never touch `app/data`.

## Adding a platform

Add an entry to `src/upload/connectors.js` with any of:

```js
{
  label, app,                // app = which Settings keys it uses
  upload: true, live: true,
  oauth: { url(app, state, redirect), exchange(app, code, redirect) },
  refresh(acc, app, secret),
  upload(acc, secret, job),  // job: { file, title, body, tags, options, thumbnail }
  liveIngest(acc, { title, rt, s, save }),  // returns an rtmp(s) URL
}
```

## Contributing

Pull requests are welcome. Please run the tests, keep the UI text short and plain, and never log secrets.
