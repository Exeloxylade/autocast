// Auto Live end-to-end: real ffmpeg + real MediaMTX relay.
// One station, playlist of 2 different clips, 3 destinations (2 good, 1 dead on purpose).
const { spawnSync, spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const H = require('./helpers');

(async () => {
  const data = H.tempData('live');
  process.env.RELAY_URL = 'rtmp://127.0.0.1:1935';
  process.env.TICK_MS = '1000';
  const relay = H.startRelay(1935);
  await H.sleep(1500);
  const { startServer } = require('../server');
  const engine = require('../src/live/engine');
  const srv = await startServer(0, '127.0.0.1');
  const api = H.client(`http://127.0.0.1:${srv.address().port}`);
  let ok = false;
  try {
    // two clips with different size, fps and audio, so "prepare" must normalise them
    const a = H.makeClip(path.join(data, 'clipA.mp4'), { w: 1280, h: 720, fps: 25, secs: 8, audio: true });
    const b = H.makeClip(path.join(data, 'clipB.mp4'), { w: 720, h: 1280, fps: 30, secs: 6, audio: false, color: 'smptebars' });
    const ma = (await api.post('/api/media/import', { path: a })).id;
    const mb = (await api.post('/api/media/import', { path: b })).id;
    H.check('import 2 clips', ma && mb);

    const d1 = (await api.post('/api/accounts/mock', { name: 'Out 1', live: 'rtmp://127.0.0.1:1935/out1' })).id;
    const d2 = (await api.post('/api/accounts/mock', { name: 'Out 2', live: 'rtmp://127.0.0.1:1935/out2' })).id;
    const d3 = (await api.post('/api/accounts/key', { platform: 'rtmp', name: 'Dead server', server: 'rtmp://127.0.0.1:1999/app', key: 'secretkey123' })).id;

    const st = (await api.post('/api/stations', { name: 'Test station', profile: '720p30', media_ids: [ma, mb], account_ids: [d1, d2, d3] })).id;
    await H.until(async () => (await api.get('/api/media')).every(m => m.prepare_state === 'ready'), 120000, 'prepare');
    H.check('prepare both clips', true);

    const t0 = Date.now();
    await api.post(`/api/stations/${st}/start`);
    const s1 = await H.until(async () => {
      const s = (await api.get(`/api/stations/${st}`)).runtime;
      const good = (s.pushers || []).filter(p => p.status === 'live');
      if (good.length >= 2) return s;
      throw new Error(JSON.stringify({ status: s.status, note: s.note, enc: s.encoder, p: (s.pushers || []).map(p => [p.status, p.kbps, p.error]) }));
    }, 60000, 'two pushers live');
    H.check('2 good destinations go live', true, `${((Date.now() - t0) / 1000).toFixed(1)}s after start`);

    const probe = JSON.parse(spawnSync('ffprobe', ['-v', 'error', '-rw_timeout', '8000000', '-print_format', 'json', '-show_streams', 'rtmp://127.0.0.1:1935/out1']).stdout || '{}');
    const v = probe.streams?.find(x => x.codec_type === 'video'), au = probe.streams?.find(x => x.codec_type === 'audio');
    H.check('destination gets 1280x720 h264 + aac', v?.codec_name === 'h264' && v.width === 1280 && v.height === 720 && au?.codec_name === 'aac', `${v?.width}x${v?.height} ${v?.codec_name}/${au?.codec_name}`);

    // record 30 s from out2: covers 2 playlist loops (14 s each)
    const rec = path.join(data, 'rec.flv');
    // async: a blocking call would freeze the app under test
    const r = await new Promise(res => { const p = spawn('ffmpeg', ['-y', '-v', 'error', '-rw_timeout', '8000000', '-i', 'rtmp://127.0.0.1:1935/out2', '-t', '30', '-c', 'copy', rec]); p.on('close', status => res({ status })); });
    const dur = Number(spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', rec]).stdout);
    H.check('recorded 30 s across loop joins', r.status === 0 && dur > 28, `duration ${dur.toFixed(2)}s`);
    const dec = spawnSync('ffmpeg', ['-v', 'error', '-i', rec, '-f', 'null', '-']);
    const errs = String(dec.stderr).trim();
    H.check('recording decodes with no errors', !errs, errs.slice(0, 200));
    // frame timestamps keep going up (no jump back at loop joins)
    const pts = String(spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'v', '-show_entries', 'packet=pts_time', '-of', 'csv=p=0', rec], { maxBuffer: 1e8 }).stdout).trim().split('\n').map(Number).filter(n => !isNaN(n));
    let back = 0, maxGap = 0; for (let i = 1; i < pts.length; i++) { if (pts[i] < pts[i - 1] - 0.5) back++; maxGap = Math.max(maxGap, pts[i] - pts[i - 1]); }
    H.check('timestamps never jump back', back === 0, `${pts.length} frames, biggest gap ${(maxGap * 1000).toFixed(0)} ms`);
    H.check('no freeze longer than 0.5 s', maxGap < 0.5);

    let s = (await api.get(`/api/stations/${st}`)).runtime;
    const dead = s.pushers.find(p => p.label.includes('Dead'));
    H.check('dead destination retries alone', dead && dead.status !== 'live' && dead.tries >= 1, `${dead?.status}, tries ${dead?.tries}`);
    H.check('stream key hidden, plain error shown', !String(dead?.error).includes('secretkey123') && /reach/i.test(dead?.error), dead?.error);
    const goodOnes = s.pushers.filter(p => !p.label.includes('Dead'));
    H.check('good destinations stay live, never dropped', goodOnes.every(p => p.status === 'live' && p.drops === 0), goodOnes.map(p => `${p.status} drops=${p.drops} ${p.error}`).join(' ; '));
    if (process.env.SHOW_EVENTS) for (const e of (await api.get('/api/events?area=live')).reverse()) console.log('   ev', new Date(e.at).toISOString().slice(11, 19), e.level, e.msg.slice(0, 220));
    H.check('bitrate per destination is a real number', goodOnes.every(p => Number.isFinite(p.kbps) && p.kbps > 50), goodOnes.map(p => p.kbps + ' kbps').join(', '));
    H.check('now-playing is tracked', s.now && s.now.name, `${s.now?.name} ${s.now?.pct?.toFixed(0)}%`);

    // snapshot preview
    await H.until(async () => (await api.get(`/api/stations/${st}`)).snapshotAt, 30000, 'snapshot');
    H.check('preview snapshot made', true);

    // turn the dead destination off -> pusher removed
    const dd = (await api.get(`/api/stations/${st}`)).destinations.find(x => x.account_id === d3);
    await api.patch(`/api/destinations/${dd.id}`, { enabled: false });
    await H.sleep(2500);
    s = (await api.get(`/api/stations/${st}`)).runtime;
    H.check('turning a destination off removes it', s.pushers.length === 2);

    // change playlist while live -> encoder reloads, pushers come back on their own
    const pl = (await api.get(`/api/stations/${st}`)).playlist_id;
    await api.post(`/api/playlists/${pl}/items`, { media_id: ma });
    await H.sleep(3000);
    await H.until(async () => (await api.get(`/api/stations/${st}`)).runtime.pushers.filter(p => p.status === 'live').length === 2 && (await api.get(`/api/stations/${st}`)).runtime.items.length === 3, 45000, 'live after playlist change');
    H.check('playlist change while live (3 items now)', true);

    // many reloads at once must still leave exactly ONE encoder (two would kick each other off)
    await Promise.all([engine.reload(st, 'test a'), engine.reload(st, 'test b'), engine.reload(st, 'test c')]);
    await H.sleep(9000);
    const list = process.platform === 'win32'
      ? spawnSync('powershell', ['-NoProfile', '-Command', "Get-CimInstance Win32_Process -Filter \"Name='ffmpeg.exe'\" | ForEach-Object { $_.CommandLine }"], { encoding: 'utf8' }).stdout
      : spawnSync('ps', ['-eo', 'args'], { encoding: 'utf8' }).stdout;
    const encs = String(list).split('\n').filter(l => l.includes(`station_${st}.ffconcat`)).length;
    const after = (await api.get(`/api/stations/${st}`)).runtime;
    H.check('3 reloads at once -> one encoder, still live', encs === 1 && after.encoder.up && after.pushers.filter(p => p.status === 'live').length === 2, `${encs} encoder(s)`);

    // same account on two stations at once is refused
    const clash = (await api.post('/api/stations', { name: 'Clash', profile: '720p30', media_ids: [ma], account_ids: [d1] })).id;
    let cerr = ''; try { await api.post(`/api/stations/${clash}/start`); } catch (e) { cerr = e.message; }
    H.check('same account on 2 live stations refused', /already live/.test(cerr), cerr.split('400 ')[1]);
    H.check('first station not disturbed', (await api.get(`/api/stations/${st}`)).runtime.pushers.filter(p => p.status === 'live').length === 2);
    await api.del(`/api/stations/${clash}`);

    // CPU check: copy mode means low CPU
    const sys = await api.get('/api/system');
    H.check('system stats readable', sys.cores > 0 && sys.relay === true, `cpu ${sys.cpu}% relay ${sys.relay} up ${sys.upKbps} kbps`);

    await api.post(`/api/stations/${st}/stop`);
    await H.sleep(1500);
    H.check('stop ends the station', !engine.state.has(st));
    const probe2 = spawnSync('ffprobe', ['-v', 'error', '-rw_timeout', '3000000', '-show_streams', 'rtmp://127.0.0.1:1935/out1'], { timeout: 10000 });
    H.check('destination is empty after stop', probe2.status !== 0);

    // schedule: daily window that covers now -> station starts by itself
    const now = new Date(); const hh = n => String(n).padStart(2, '0');
    const start = `${hh(now.getHours())}:${hh(now.getMinutes())}`;
    const endD = new Date(now.getTime() + 10 * 60e3); const end = `${hh(endD.getHours())}:${hh(endD.getMinutes())}`;
    await api.patch(`/api/destinations/${dd.id}`, { enabled: false });
    await api.patch(`/api/stations/${st}`, { schedule: { mode: 'daily', start, end } });
    await H.until(async () => engine.state.has(st), 15000, 'scheduled start');
    H.check('daily schedule starts the station', true, `${start}-${end}`);
    await api.patch(`/api/stations/${st}`, { schedule: { mode: 'manual' } });
    await api.post(`/api/stations/${st}/stop`);
    await H.sleep(1000);
    H.check('switch back to manual + stop', !engine.state.has(st));
    ok = H.summary();
  } catch (e) {
    console.error('ERROR', e.message);
    H.summary();
  } finally {
    engine.shutdown();
    require('../src/upload/scheduler').shutdown();
    srv.close();
    relay.kill();
    setTimeout(() => process.exit(ok ? 0 : 1), 1500);
  }
})();
