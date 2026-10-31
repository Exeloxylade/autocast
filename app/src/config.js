// All runtime settings come from env vars. Defaults are safe for a single VPS.
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
const DATA = path.resolve(process.env.AUTOCAST_DATA || path.join(ROOT, 'data'));
for (const d of ['', 'media', 'thumbs', 'prepared', 'playlists', 'snapshots', 'logs', 'mock-out', 'watch', 'variants', 'logos', 'recordings', 'backups']) {
  fs.mkdirSync(path.join(DATA, d), { recursive: true });
}

module.exports = {
  ROOT,
  DATA,
  // Bind to loopback by default. Put Caddy/nginx in front for HTTPS.
  HOST: process.env.HOST || '127.0.0.1',
  PORT: Number(process.env.PORT || 7676),
  // Public HTTPS address, needed for OAuth callbacks and Instagram video_url.
  PUBLIC_URL: (process.env.PUBLIC_URL || '').replace(/\/$/, ''),
  FFMPEG: process.env.FFMPEG_PATH || 'ffmpeg',
  FFPROBE: process.env.FFPROBE_PATH || 'ffprobe',
  // Local relay (MediaMTX). The encoder publishes here, pushers read from here.
  RELAY_URL: (process.env.RELAY_URL || 'rtmp://127.0.0.1:1935').replace(/\/$/, ''),
  TICK_MS: Number(process.env.TICK_MS || 5000),
  // Dev only: skip login when bound to loopback. Never set on a VPS.
  DEV_NOAUTH: process.env.AUTOCAST_DEV_NOAUTH === '1',
  // Font for live text overlays.
  FONT_FILE: process.env.FONT_FILE || (process.platform === 'win32' ? 'C:/Windows/Fonts/arialbd.ttf' : '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'),
};
