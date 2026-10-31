// Probe: overlay + logo + music station, print encoder health every 3 s for 45 s.
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const H = require('./helpers');
(async () => {
  const data = H.tempData('probe');
  process.env.TICK_MS = '1000'; process.env.RELAY_URL = 'rtmp://127.0.0.1:1935';
  const wide = H.makeClip(path.join(data, 'w.mp4'), { w: 1280, h: 720, fps: 30, secs: 12, audio: true });
  const mus = H.makeClip(path.join(data, 'm.mp4'), { w: 320, h: 240, fps: 30, secs: 6, audio: true, color: 'rgbtestsrc' });
  spawnSync('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'color=c=red:s=200x80', '-frames:v', '1', path.join(data, 'logo.png')]);
  const relay = H.startRelay(1935); await H.sleep(1500);
  const { startServer } = require('../server');
  const engine = require('../src/live/engine');
  const srv = await startServer(0, '127.0.0.1');
  const base = `http://127.0.0.1:${srv.address().port}`; const api = H.client(base);
  const mw = (await api.post('/api/media/import', { path: wide })).id, mm = (await api.post('/api/media/import', { path: mus })).id;
  const out = (await api.post('/api/accounts/mock', { name: 'o', live: 'rtmp://127.0.0.1:1935/p_out' })).id;
  const st = (await api.post('/api/stations', { name: 'P', profile: '720p30', media_ids: [mw], account_ids: [out] })).id;
  const mpl = (await api.post('/api/playlists', { name: 'mus' })).id; await api.post(`/api/playlists/${mpl}/items`, { media_id: mm });
  const fd = new FormData(); fd.append('logo', await fs.openAsBlob(path.join(data, 'logo.png')), 'logo.png');
  await fetch(`${base}/api/stations/${st}/logo`, { method: 'POST', headers: { 'x-autocast': '1' }, body: fd });
  const mode = process.argv[2] || 'all';
  await api.patch(`/api/stations/${st}/extras`, { overlay: { enabled: true, text: 'probe', clock: true, logo: mode !== 'nologo' }, ...(mode !== 'nomusic' ? { music_playlist_id: mpl } : {}) });
  await api.post(`/api/stations/${st}/start`);
  for (let i = 0; i < 15; i++) {
    await H.sleep(3000);
    const rt = engine.state.get(st);
    const e = rt?.encoder;
    console.log(`${(i + 1) * 3}s enc=${e ? 'up' : 'down'} speed=${e?.stats.speed} kbps=${Math.round(e?.stats.kbps || 0)} outS=${((e?.stats.outUs || 0) / 1e6).toFixed(1)} push=${[...(rt?.pushers.values() || [])].map(p => `${p.status}/${Math.round(p.p?.stats.kbps || 0)}`).join(',')} err=${(e?.stats.err || []).slice(-1)[0] || ''}`);
  }
  for (const ev of (await api.get('/api/events?area=live')).slice(0, 5)) console.log('ev', ev.msg.slice(0, 300));
  engine.shutdown(); srv.close(); relay.kill(); setTimeout(() => process.exit(0), 1000);
})();
