// Demo server with sample data, for screenshots and click-testing the UI.
// Runs a local relay + 2 live stations to local test outputs + some posts.
//   node test/demo.js        -> http://127.0.0.1:7676 (no login, loopback only)
const path = require('path');
const fs = require('fs');
const H = require('./helpers');

(async () => {
  const data = H.tempData('demo');
  process.env.TICK_MS = '2000';
  process.env.MOCK_DELAY_MS = '400';
  process.env.AUTOCAST_QUIET = '1';
  const clips = [
    ['why_rupiah_fell_5pct.mp4', { w: 1080, h: 1920, fps: 30, secs: 12, audio: true, color: 'testsrc2' }],
    ['gold_vs_bitcoin_2026.mp4', { w: 1920, h: 1080, fps: 30, secs: 10, audio: true, color: 'smptehdbars' }],
    ['nickel_ban_explained.mp4', { w: 1080, h: 1920, fps: 30, secs: 9, audio: true, color: 'rgbtestsrc' }],
    ['lofi_beat_01.mp4', { w: 1280, h: 720, fps: 30, secs: 15, audio: true, color: 'mandelbrot' }],
    ['retro_runner_level14.mp4', { w: 1280, h: 720, fps: 30, secs: 12, audio: true, color: 'life' }],
  ];
  const files = clips.map(([n, o]) => H.makeClip(path.join(data, n), o));   // make clips first (blocking)
  const relay = H.startRelay(1935);
  await H.sleep(1200);
  const { startServer } = require('../server');
  const srv = await startServer(Number(process.env.PORT || 7676), '127.0.0.1');
  const api = H.client(`http://127.0.0.1:${srv.address().port}`);
  const ids = [];
  for (const f of files) ids.push((await api.post('/api/media/import', { path: f })).id);

  await api.post('/api/settings', { dup_days: 0 });      // demo reuses videos; turned back on below
  const yt = (await api.post('/api/accounts/mock', { name: 'Ahmad Finance (test)', grp: 'Finance ID' })).id;
  const tt = (await api.post('/api/accounts/mock', { name: '@ahmad.money (test)', grp: 'Finance ID' })).id;
  await api.post('/api/accounts/mock', { name: 'News channel (test)', grp: 'News' });
  const o1 = (await api.post('/api/accounts/key', { platform: 'youtube_live', name: 'Ahmad Plays', server: 'rtmp://127.0.0.1:1935/yt', key: 'demo1', grp: 'Games' })).id;
  const o2 = (await api.post('/api/accounts/key', { platform: 'twitch', name: 'ahmadplays', server: 'rtmp://127.0.0.1:1935/tw', key: 'demo2', grp: 'Games' })).id;
  const o3 = (await api.post('/api/accounts/key', { platform: 'kick', name: 'ahmadplays', server: 'rtmp://127.0.0.1:1999/app', key: 'demo3', grp: 'Games' })).id;
  const o4 = (await api.post('/api/accounts/key', { platform: 'youtube_live', name: 'Lofi Finance', server: 'rtmp://127.0.0.1:1935/lofi', key: 'demo4' })).id;

  // posts: some sent, one failed, some waiting
  await api.post('/api/posts', { media_id: ids[0], title: 'Why Rupiah Fell 5% in One Week #shorts', body: '#finance #rupiah', account_ids: [yt, tt], when: 'now' });
  await api.post('/api/posts', { media_id: ids[2], title: '[fail] Nickel ban explained', account_ids: [tt], when: 'now' });
  await api.post('/api/posts', { media_id: ids[1], title: 'Gold vs Bitcoin: 2026 Recap', body: 'Which one won?', account_ids: [yt], when: 'slot' });
  await api.post('/api/posts', { media_id: ids[2], title: 'Nickel Ban Explained in 60s', account_ids: [yt, tt], when: 'slot' });
  await api.post('/api/posts', { media_id: ids[0], title: 'Weekly Market Wrap #44', account_ids: [yt], when: Date.now() + 2 * 864e5 });
  const watch = path.join(data, 'watch', 'exports'); fs.mkdirSync(watch, { recursive: true });
  await api.post('/api/rules', { name: 'Automated Lunch Free → all', folder: watch, account_ids: [yt, tt], options: { when: 'slot', ai: true } });
  await api.post('/api/snippets', { name: 'Finance tags', text: '#finance #rupiah #indonesia #market' });
  await api.post('/api/snippets', { name: 'Follow CTA', text: 'Follow for daily market news 👆' });
  await api.post('/api/tokens', { name: 'Ahmad PC' });
  const r2 = (await api.post('/api/rules', { name: 'News folder → News channel', folder: path.join(data, 'watch', 'news'), account_ids: [yt] })).id;
  await api.patch(`/api/rules/${r2}`, { enabled: false });

  const s1 = (await api.post('/api/stations', { name: 'Retro Runner 24/7', profile: '720p30', media_ids: [ids[4], ids[1]], account_ids: [o1, o2, o3], schedule: { mode: 'always' } })).id;
  // overlay on station 1: text + clock + logo
  require('child_process').spawnSync('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'color=c=0x7c6cff:s=240x90', '-vf', "drawbox=x=0:y=0:w=90:h=90:color=0xff4d5e:t=fill", '-frames:v', '1', path.join(data, 'logo.png')]);
  const fd = new FormData(); fd.append('logo', await fs.openAsBlob(path.join(data, 'logo.png'), { type: 'image/png' }), 'logo.png');
  await fetch(`http://127.0.0.1:${srv.address().port}/api/stations/${s1}/logo`, { method: 'POST', headers: { 'x-autocast': '1' }, body: fd });
  await api.patch(`/api/stations/${s1}/extras`, { overlay: { enabled: true, text: 'RETRO RUNNER · live 24/7', clock: true, logo: true }, record: true });
  const s2 = (await api.post('/api/stations', { name: 'Lofi Finance Radio', profile: '720p30', media_ids: [ids[3]], account_ids: [o4], schedule: { mode: 'always' } })).id;
  await api.post('/api/stations', { name: 'Night News Replay', profile: '720p30', media_ids: [ids[0], ids[2]], account_ids: [o4], schedule: { mode: 'daily', start: '22:00', end: '02:00' } });
  await api.post('/api/settings', { dup_days: 7 });
  // Demo AI: a fake OpenAI-style server so every AI button works without a key.
  if (process.env.DEMO_REAL_AI !== '1') {
    const F = await require('./fake-ai').start();
    await api.post('/api/ai/settings', { baseUrl: F.url, apiKey: 'testkey', model: 'demo-fake-ai', visionModel: 'demo-fake-vision', sttModel: 'demo-fake-stt', lang: 'English', safety: 'warn' });
  }
  console.log(`DEMO READY http://127.0.0.1:${srv.address().port}  stations ${s1},${s2}`);
  const bye = () => { require('../src/live/engine').shutdown(); relay.kill(); process.exit(0); };
  process.on('SIGINT', bye); process.on('SIGTERM', bye);
  if (process.env.DEMO_SECONDS) setTimeout(bye, Number(process.env.DEMO_SECONDS) * 1000);
})();
