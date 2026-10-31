// v2 features end-to-end: push API + PC script, vertical, shorts, snippets, repeat, CSV,
// duplicate guard, daily limit, overlay, music, folder refill, recording, data use, activity, backup.
const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const H = require('./helpers');

const probe = f => JSON.parse(spawnSync('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', f]).stdout || '{}');
const runAsync = (bin, args) => new Promise(res => { let out = ''; const p = spawn(bin, args); p.stdout.on('data', d => out += d); p.stderr.on('data', d => out += d); p.on('close', status => res({ status, stdout: out, stderr: '' })); });
const vdims = f => { const v = probe(f).streams?.find(s => s.codec_type === 'video'); return v ? `${v.width}x${v.height}` : 'none'; };

(async () => {
  const data = H.tempData('features');
  process.env.TICK_MS = '1000';
  process.env.MOCK_DELAY_MS = '150';
  process.env.RECORD_SEGMENT_S = '4';
  process.env.RELAY_URL = 'rtmp://127.0.0.1:1935';
  // clips first (blocking ffmpeg would stall the server)
  const wide = H.makeClip(path.join(data, 'wide_market.mp4'), { w: 1280, h: 720, fps: 30, secs: 12, audio: true });
  const tall = H.makeClip(path.join(data, 'tall.mp4'), { w: 720, h: 1280, fps: 30, secs: 4, audio: true, color: 'smptebars' });
  const pushDir = path.join(data, 'pc-exports'); fs.mkdirSync(pushDir);
  const pushed = H.makeClip(path.join(pushDir, 'gold_report.mp4'), { w: 1080, h: 1920, fps: 30, secs: 3, audio: true });
  fs.writeFileSync(path.join(pushDir, 'gold_report.json'), JSON.stringify({ title: 'Gold hits record', description: 'Why gold went up', tags: ['gold', 'markets'] }));
  const old = new Date(Date.now() - 60000); fs.utimesSync(pushed, old, old);
  const music = H.makeClip(path.join(data, 'music_bed.mp4'), { w: 320, h: 240, fps: 30, secs: 6, audio: true, color: 'rgbtestsrc' });
  spawnSync('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'color=c=red:s=200x80', '-frames:v', '1', path.join(data, 'logo.png')]);

  const relay = H.startRelay(1935);
  await H.sleep(1500);
  const { startServer } = require('../server');
  const engine = require('../src/live/engine');
  const srv = await startServer(0, '127.0.0.1');
  const base = `http://127.0.0.1:${srv.address().port}`;
  const api = H.client(base);
  let ok = false;
  const doneFor = async (postId, n = 1, ms = 20000) => H.until(async () => { const r = (await api.get('/api/posts')).filter(t => t.post_id === postId && t.status === 'done'); return r.length >= n ? r : null; }, ms, `post ${postId} done x${n}`);
  try {
    const mWide = (await api.post('/api/media/import', { path: wide })).id;
    const A = (await api.post('/api/accounts/mock', { name: 'Mock A', grp: 'Finance' })).id;
    const B = (await api.post('/api/accounts/mock', { name: 'Mock B', grp: 'Finance' })).id;

    // 1. Push API + PC script
    const tok = (await api.post('/api/tokens', { name: 'Test PC' })).token;
    H.check('1a. token made, shown once', /^ac_/.test(tok) && !JSON.stringify(await api.get('/api/tokens')).includes(tok));
    const bad = await fetch(`${base}/hook/ping`, { headers: { Authorization: 'Bearer nope' } });
    H.check('1b. wrong token refused', bad.status === 401);
    const pr = await runAsync(process.execPath, [path.join(__dirname, '..', '..', 'tools', 'push.js'), '--server', base, '--token', tok, '--folder', pushDir, '--accounts', 'group:Finance', '--when', 'now', '--once']);
    await H.sleep(500);
    const pp = (await api.get('/api/posts')).filter(t => t.title === 'Gold hits record');
    H.check('1c. PC script pushed video + made post to group', pr.status === 0 && pp.length === 2, (pr.stdout + pr.stderr).trim().split('\n').pop());
    H.check('1d. sidecar text + tags used', pp[0]?.body.includes('Why gold went up') && pp[0]?.body.includes('#gold'));
    const again = await runAsync(process.execPath, [path.join(__dirname, '..', '..', 'tools', 'push.js'), '--server', base, '--token', tok, '--folder', pushDir, '--accounts', 'group:Finance', '--once']);
    H.check('1e. script does not send the same file twice', !/sent /.test(again.stdout));

    // 2. auto vertical
    await api.patch(`/api/accounts/${A}/options`, { fmt: 'vertical' });
    const pv = (await api.post('/api/posts', { media_id: mWide, title: 'vertical test', account_ids: [A], when: 'now' })).id;
    await doneFor(pv, 1, 90000);
    const outA = fs.readdirSync(path.join(data, 'mock-out')).filter(f => f.startsWith(`${A}_`) && f.endsWith('.mp4')).map(f => path.join(data, 'mock-out', f)).sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0];
    H.check('2. wide video sent as 1080x1920 to vertical account', vdims(outA) === '1080x1920', vdims(outA));
    await api.patch(`/api/accounts/${A}/options`, { fmt: 'original' });

    // 3. shorts cutter
    const sh = await api.post(`/api/media/${mWide}/shorts`, { count: 2, seconds: 3, wait: true });
    const shorts = (await api.get('/api/media')).filter(m => sh.ids.includes(m.id));
    H.check('3. shorts cutter: 2 vertical 3 s clips', shorts.length === 2 && shorts.every(m => m.width === 1080 && m.height === 1920 && Math.abs(m.duration - 3) < 0.3), shorts.map(m => `${m.width}x${m.height} ${m.duration.toFixed(1)}s`).join(', '));

    // 4. snippets
    await api.post('/api/snippets', { name: 'finance tags', text: '#finance #money #indonesia' });
    await api.post('/api/snippets', { name: 'cta', text: 'Follow for more 👆' });
    await api.del('/api/snippets/cta');
    const sn = await api.get('/api/snippets');
    H.check('4. snippets save + delete', sn.length === 1 && sn[0].text.includes('#money'));

    // 5. repeat posts (every ~2.6 s, 2 more times)
    const prp = (await api.post('/api/posts', { media_id: sh.ids[0], title: 'evergreen', account_ids: [B], when: 'now', options: { repeatDays: 0.00003, repeatTimes: 2 } })).id;
    const rep = await doneFor(prp, 3, 40000);
    H.check('5. repeat post ran 3 times', rep.length === 3, rep.map(r => new Date(r.done_at).toISOString().slice(17, 21)).join(' '));

    // 6. CSV import
    const csv = `file,title,description,accounts,when\n"${tall.replace(/\\/g, '\\\\')}","CSV one, with comma","line ""quoted""",group:Finance,now\n#${sh.ids[1]},CSV two,,Mock A,2030-01-01 10:00\n#${sh.ids[1]},CSV bad,,Nobody,now\n`;
    const ci = await api.post('/api/posts/csv', { csv: csv.replace(/\\\\/g, '\\') });
    H.check('6a. CSV: 2 made, 1 error with line number', ci.created.length === 2 && ci.errors.length === 1 && ci.errors[0].line === 4, JSON.stringify(ci.errors));
    const c1 = (await api.get('/api/posts')).find(t => t.title === 'CSV one, with comma');
    H.check('6b. CSV quotes and commas parsed', c1 && c1.body === 'line "quoted"');

    // 7. duplicate guard + daily limit
    let e7 = ''; try { await api.post('/api/posts', { media_id: sh.ids[0], title: 'dup', account_ids: [B], when: 'now' }); } catch (e) { e7 = e.message; }
    H.check('7a. duplicate guard blocks same video, same account', /already goes/.test(e7));
    const okDup = await api.post('/api/posts', { media_id: sh.ids[0], title: 'dup ok', account_ids: [B], when: 'slot', options: { allowDuplicate: true } });
    H.check('7b. "allow repeat" lets it through', !!okDup.id);
    const C = (await api.post('/api/accounts/mock', { name: 'Mock C' })).id;
    await api.patch(`/api/accounts/${C}/options`, { daily_max: 1 });
    await api.patch(`/api/accounts/${C}`, { slots: ['09:00', '13:00', '20:00'] });
    const s1 = (await api.post('/api/posts', { media_id: mWide, title: 'lim1', account_ids: [C], when: 'slot' })).id;
    const s2 = (await api.post('/api/posts', { media_id: sh.ids[1], title: 'lim2', account_ids: [C], when: 'slot' })).id;
    const all = await api.get('/api/posts');
    const d1 = new Date(all.find(t => t.post_id === s1).run_at), d2 = new Date(all.find(t => t.post_id === s2).run_at);
    H.check('7c. daily limit 1: second post moves to another day', d1.toDateString() !== d2.toDateString(), `${d1.toString().slice(0, 21)} / ${d2.toString().slice(0, 21)}`);

    // ---------------- live
    const out1 = (await api.post('/api/accounts/mock', { name: 'Live out', live: 'rtmp://127.0.0.1:1935/f_out1' })).id;
    const out2 = (await api.post('/api/accounts/mock', { name: 'Live out 2', live: 'rtmp://127.0.0.1:1935/f_out2' })).id;
    const st = (await api.post('/api/stations', { name: 'Feature station', profile: '720p30', media_ids: [mWide], account_ids: [out1] })).id;
    const mMusic = (await api.post('/api/media/import', { path: music })).id;
    const mpl = (await api.post('/api/playlists', { name: 'Music beds' })).id;
    await api.post(`/api/playlists/${mpl}/items`, { media_id: mMusic });
    // logo upload
    const fd = new FormData(); fd.append('logo', await fs.openAsBlob(path.join(data, 'logo.png'), { type: 'image/png' }), 'logo.png');
    const lr = await fetch(`${base}/api/stations/${st}/logo`, { method: 'POST', headers: { 'x-autocast': '1' }, body: fd });
    H.check('8a. logo upload', lr.ok && fs.existsSync(engine.logoFile(st)));
    const fdBad = new FormData(); fdBad.append('logo', new Blob(['not an image']), 'x.png');
    H.check('8b. fake image refused', (await fetch(`${base}/api/stations/${st}/logo`, { method: 'POST', headers: { 'x-autocast': '1' }, body: fdBad })).status === 400);
    await api.patch(`/api/stations/${st}/extras`, { overlay: { enabled: true, text: 'AutoCast test', clock: true, logo: true }, music_playlist_id: mpl, music_volume: 0.3, record: true });
    await api.post(`/api/stations/${st}/start`);
    const live = await H.until(async () => { const r = (await api.get(`/api/stations/${st}`)).runtime; return r.pushers?.[0]?.status === 'live' ? r : null; }, 90000, 'feature station live');
    H.check('8c. overlay mode live (logo + text + clock)', live.encoder.mode === 'overlay', live.encoder.mode);
    H.check('9a. music bed on', live.encoder.music === true);
    const p1 = probe('rtmp://127.0.0.1:1935/f_out1');
    H.check('9b. destination has video + audio', p1.streams?.some(s => s.codec_type === 'video' && s.width === 1280) && p1.streams?.some(s => s.codec_type === 'audio'));
    const encPid = engine.state.get(st).encoder.pid;
    await api.patch(`/api/stations/${st}/extras`, { overlay: { enabled: true, text: 'New text, no restart', clock: true, logo: true } });
    await H.sleep(2500);
    const txtNow = fs.existsSync(path.join(data, 'playlists', `overlay_${st}.txt`)) ? fs.readFileSync(path.join(data, 'playlists', `overlay_${st}.txt`), 'utf8') : '(none)';
    H.check('8d. text change applies without restarting', engine.state.get(st).encoder?.pid === encPid && txtNow === 'New text, no restart', `pid ${encPid} -> ${engine.state.get(st).encoder?.pid}, text "${txtNow}"`);
    // look at a frame: the red logo must be in the top-right corner
    const frame = path.join(data, 'frame.png');
    const g = await runAsync('ffmpeg', ['-y', '-v', 'error', '-rw_timeout', '8000000', '-i', 'rtmp://127.0.0.1:1935/f_out1', '-frames:v', '1', frame]);
    if (g.status) console.log('   grab:', g.stdout.slice(0, 200));
    if (process.env.SHOW_EVENTS) for (const e of (await api.get('/api/events?area=live')).reverse().slice(-12)) console.log('   ev', e.level, e.msg.slice(0, 200));
    const px = spawnSync('ffmpeg', ['-v', 'error', '-i', frame, '-vf', 'crop=10:10:1180:40,scale=1:1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { encoding: 'buffer' }).stdout;
    H.check('8e. logo really drawn (top-right is red)', px && px[0] > 180 && px[1] < 80 && px[2] < 80, px ? `rgb(${px[0]},${px[1]},${px[2]})` : 'no frame');

    // 10. folder playlist refill
    const plId = (await api.get(`/api/stations/${st}`)).playlist_id;
    const watch = path.join(data, 'live-watch'); fs.mkdirSync(watch);
    await api.patch(`/api/playlists/${plId}/folder`, { folder: watch });
    fs.copyFileSync(tall, path.join(watch, 'new_clip.mp4')); fs.utimesSync(path.join(watch, 'new_clip.mp4'), old, old);
    await H.until(async () => (await api.get('/api/playlists')).find(p => p.id === plId).items.length === 2, 30000, 'folder refill');
    await H.until(async () => (await api.get(`/api/stations/${st}`)).runtime.items?.length === 2, 40000, 'station reloaded with new clip');
    H.check('10. new file in folder joins the live playlist', true);

    // 11. recording
    await H.sleep(9000);
    const recs = await api.get(`/api/stations/${st}/recordings`);
    const firstRec = recs.length ? path.join(engine.recDir(), recs[recs.length - 1].name) : null;
    H.check('11a. recording makes segment files', recs.length >= 2, `${recs.length} files`);
    H.check('11b. recording file plays', firstRec && probe(firstRec).streams?.length === 2, firstRec ? vdims(firstRec) : '');
    const dl = await fetch(`${base}/files/recordings/${recs[0]?.name}`);
    H.check('11c. recording downloads; bad names refused', dl.ok && (await fetch(`${base}/files/recordings/..%2Fautocast.db`)).status === 404);

    // 12. data use
    await api.post(`/api/stations/${st}/destinations`, { account_id: out2 });
    await H.sleep(4000);
    const sys = await api.get('/api/system');
    H.check('12. monthly data use counted', sys.usage.bytes > 100000, `${(sys.usage.bytes / 1e6).toFixed(1)} MB in ${sys.usage.month}`);
    // logo still there after several loops and a playlist reload
    await H.sleep(15000);
    const frame2 = path.join(data, 'frame2.png');
    await runAsync('ffmpeg', ['-y', '-v', 'error', '-rw_timeout', '8000000', '-i', 'rtmp://127.0.0.1:1935/f_out1', '-frames:v', '1', frame2]);
    const px2 = spawnSync('ffmpeg', ['-v', 'error', '-i', frame2, '-vf', 'crop=10:10:1180:40,scale=1:1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { encoding: 'buffer' }).stdout;
    const up = Math.round((Date.now() - (await api.get(`/api/stations/${st}`)).runtime.startedAt) / 1000);
    H.check('8f. logo still drawn after loops + reload', px2 && px2[0] > 180 && px2[1] < 80, `${up}s live, rgb(${px2?.[0]},${px2?.[1]},${px2?.[2]})`);
    await api.post(`/api/stations/${st}/stop`);

    // 13. activity log filters
    const errs = await api.get('/api/events?level=error,warn&limit=50');
    const search = await api.get('/api/events?q=push');
    H.check('13. activity log: level + search filters', Array.isArray(errs) && errs.every(e => ['error', 'warn'].includes(e.level)) && search.length >= 1 && search.every(e => /push/i.test(e.msg)));

    // 14. backup
    const bk = await fetch(`${base}/api/backup`);
    const buf = Buffer.from(await bk.arrayBuffer());
    H.check('14. backup downloads a real SQLite file', bk.ok && buf.subarray(0, 15).toString() === 'SQLite format 3', `${(buf.length / 1024).toFixed(0)} KB`);
    ok = H.summary();
  } catch (e) {
    console.error('ERROR', e.stack || e.message);
    try { for (const ev of (await api.get('/api/events?area=live')).slice(0, 6)) console.error('   ev', ev.level, ev.msg.slice(0, 400)); } catch {}
    H.summary();
  } finally {
    engine.shutdown(); require('../src/upload/scheduler').shutdown(); srv.close(); relay.kill();
    setTimeout(() => process.exit(ok ? 0 : 1), 1500);
  }
})();
