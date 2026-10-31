// AI features end-to-end against a fake OpenAI-compatible server (real ffmpeg, real relay).
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const H = require('./helpers');
const fake = require('./fake-ai');

const probe = f => JSON.parse(spawnSync('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', f]).stdout || '{}');
const vinfo = f => { const p = probe(f); const v = p.streams?.find(s => s.codec_type === 'video'); return v ? { w: v.width, h: v.height, d: Number(p.format.duration) } : null; };

(async () => {
  const data = H.tempData('ai');
  process.env.TICK_MS = '1000'; process.env.MOCK_DELAY_MS = '150'; process.env.RETRY_SCALE = '0.01';
  process.env.RELAY_URL = 'rtmp://127.0.0.1:1935'; process.env.NOTIFY_LOG = path.join(data, 'notify.log');
  const clip = H.makeClip(path.join(data, 'gold_news.mp4'), { w: 1280, h: 720, fps: 30, secs: 10, audio: true });
  const watch = path.join(data, 'ai-watch'); fs.mkdirSync(watch);
  const F = await fake.start();
  const relay = H.startRelay(1935); await H.sleep(1500);
  const { startServer } = require('../server');
  const engine = require('../src/live/engine');
  const srv = await startServer(0, '127.0.0.1');
  const api = H.client(`http://127.0.0.1:${srv.address().port}`);
  const callsOf = t => F.calls.filter(c => c.task === t);
  let ok = false;
  try {
    // 0. provider setup
    let e0 = ''; try { await api.post('/api/ai/rewrite', { title: 'x', body: 'y', platforms: ['youtube'] }); } catch (e) { e0 = e.message; }
    H.check('0a. clear message before AI is set up', /Set up AI first/.test(e0), e0.split('400 ')[1]);
    await api.post('/api/ai/settings', { baseUrl: F.url, apiKey: 'wrong', model: 'fake-chat', visionModel: 'fake-vision', sttModel: 'fake-stt', lang: 'English', safety: 'block' });
    let e1 = ''; try { await api.post('/api/ai/test'); } catch (e) { e1 = e.message; }
    H.check('0b. wrong key -> plain "key was refused"', /key was refused/.test(e1));
    await api.post('/api/ai/settings', { apiKey: 'testkey' });
    const t = await api.post('/api/ai/test');
    const s = await api.get('/api/ai/settings');
    H.check('0c. AI test works, key hidden', t.ok && s.apiKey === '••••' && s.ready, `${t.ms} ms`);

    const mid = (await api.post('/api/media/import', { path: clip })).id;
    const A = (await api.post('/api/accounts/mock', { name: 'Mock A', grp: 'G' })).id;

    // 1-2. write + hooks (no transcript yet -> uses frames with vision)
    const w = await api.post('/api/ai/write', { media_id: mid, platforms: ['youtube', 'tiktok'] });
    H.check('1. AI writes title, text, hashtags', w.title === 'Gold hits a record' && w.description && w.hashtags.includes('#gold') && w.hashtags.includes('#investing'), w.hashtags.join(' '));
    H.check('2. AI gives 5 hook options', w.hooks.length === 5);
    H.check('1b. frames sent to vision model', callsOf('write_post')[0].images === 3 && callsOf('write_post')[0].model === 'fake-vision');
    H.check('3a. per-app text for each app', w.per_app.youtube?.title === 'youtube title' && w.per_app.tiktok?.body.includes('#gold'));

    // 3. rewrite per app
    const rw = await api.post('/api/ai/rewrite', { title: 'Gold up', body: 'text', platforms: ['youtube', 'instagram'] });
    H.check('3b. rewrite for each app', rw.youtube?.title === 'youtube: Gold up' && rw.instagram?.body === 'instagram style', Object.keys(rw).join(','));

    // 4. translate (fake answer is wrapped in ``` fences)
    const tr = await api.post('/api/ai/translate', { title: 'Gold up', body: 'x', to: 'Indonesian' });
    H.check('4. translate (fenced JSON parsed)', tr.title === '[Indonesian] Gold up');

    // 5. transcribe
    await api.post(`/api/ai/transcribe/${mid}`, { wait: true });
    const ts = await api.get(`/api/ai/transcript/${mid}`);
    H.check('5. transcribe: speech to timed lines', ts.length === 3 && ts[2].start === 6 && callsOf('stt')[0].bytes > 1000, `${ts.length} lines`);
    await api.post('/api/ai/write', { media_id: mid });
    H.check('5b. later writing uses the transcript, not frames', /Gold went up twelve/.test(callsOf('write_post').at(-1).user) && callsOf('write_post').at(-1).images === 0);

    // 6. burned captions
    const cap = await api.post(`/api/ai/captions/${mid}`, { wait: true });
    const capM = (await api.get('/api/media')).find(m => m.id === cap.media_id);
    H.check('6. captions burned into a new video', capM && Math.abs(capM.duration - 10) < 0.3 && capM.width === 1280, capM?.name);
    const srt = fs.readFileSync(path.join(data, 'transcripts', `${mid}.srt`), 'utf8');
    H.check('6b. caption lines are short (<= 6 words)', srt.split('\n').filter(l => l && !/-->|^\d+$/.test(l)).every(l => l.split(' ').length <= 6) && srt.includes('00:00:03,000'));

    // 7. AI shorts
    const sh = await api.post(`/api/ai/shorts/${mid}`, { count: 3, seconds: 4, wait: true });
    const shM = (await api.get('/api/media')).filter(m => sh.map(x => x.id).includes(m.id));
    H.check('7. AI shorts: picks moments, bad pick dropped', sh.length === 2 && shM.every(m => m.width === 1080 && m.height === 1920 && Math.abs(m.duration - 4) < 0.4), shM.map(m => `${m.width}x${m.height} ${m.duration.toFixed(1)}s`).join(', '));
    H.check('7b. shorts get AI titles (name + sidecar)', shM.some(m => m.name.startsWith('Gold up 12%')) && shM.some(m => m.name.startsWith('Why banks buy gold')) && fs.readdirSync(path.join(data, 'media')).some(f => f.endsWith('.json')));

    // 8. AI thumbnail
    const th = await api.post(`/api/ai/thumbnail/${mid}`, { wait: true });
    const thInfo = vinfo(path.join(data, 'thumbs_ai', `${mid}.jpg`));
    H.check('8. AI thumbnail 1280x720 with big words + number', thInfo?.w === 1280 && thInfo?.h === 720 && th.words === 'GOLD RECORD' && th.number === '+12%' && th.frame === 1, JSON.stringify(th));
    H.check('8b. vision saw 6 frames', callsOf('thumbnail')[0].images === 6);

    // 9. thumbnail goes with the post + 10. safety check (block mode)
    await api.post('/api/settings', { dup_days: 0 });
    const good = (await api.post('/api/posts', { media_id: mid, title: 'Gold news', body: 'facts only', account_ids: [A], when: 'now' })).id;
    const bad = (await api.post('/api/posts', { media_id: mid, title: 'Gold', body: 'guaranteed profit 100%', account_ids: [A], when: 'now' })).id;
    await H.until(async () => { const r = await api.get('/api/posts'); return ['done', 'failed'].includes(r.find(x => x.post_id === good)?.status) && ['done', 'failed'].includes(r.find(x => x.post_id === bad)?.status); }, 30000, 'safety posts');
    const rows = await api.get('/api/posts');
    const gT = rows.find(x => x.post_id === good), bT = rows.find(x => x.post_id === bad);
    H.check('10. safety: clean post sent, risky post blocked', gT.status === 'done' && bT.status === 'failed' && /AI safety/.test(bT.error), bT.error);
    H.check('10b. blocked post not retried', bT.attempts === 1);
    const outThumb = fs.readdirSync(path.join(data, 'mock-out')).some(f => f.endsWith('.thumb.jpg'));
    H.check('9. AI thumbnail travels with the post', outThumb);

    // 11. autopilot rule with AI writing
    const rid = (await api.post('/api/rules', { name: 'AI rule', folder: watch, account_ids: [A], options: { when: 'now', aiWrite: true } })).id;
    const nf = path.join(watch, 'new_upload.mp4'); fs.copyFileSync(clip, nf); const old = new Date(Date.now() - 60000); fs.utimesSync(nf, old, old);
    await require('../src/upload/scheduler').tickRules();
    const rp = (await api.get('/api/posts')).find(x => x.rule_id === rid);
    H.check('11. autopilot: AI writes text for new folder video', rp?.title === 'Gold hits a record' && /Why gold went up/.test(rp.body), rp?.title);

    // 12-13. live AI lines
    const out = (await api.post('/api/accounts/mock', { name: 'Live', live: 'rtmp://127.0.0.1:1935/ai_out' })).id;
    const st = (await api.post('/api/stations', { name: 'AI station', profile: '720p30', media_ids: [mid], account_ids: [out] })).id;
    await api.patch(`/api/stations/${st}/extras`, { overlay: { enabled: true, text: 'GOLD TV', aiMode: 'ticker', aiPrompt: 'gold facts', aiEvery: 1 } });
    await api.post(`/api/stations/${st}/start`);
    await H.until(async () => (await api.get(`/api/stations/${st}`)).runtime.pushers?.[0]?.status === 'live', 90000, 'AI station live');
    const txtFile = path.join(data, 'playlists', `overlay_${st}.txt`);
    await H.until(() => fs.existsSync(txtFile) && /Fun fact/.test(fs.readFileSync(txtFile, 'utf8')), 20000, 'ticker line');
    H.check('12. live AI ticker line on screen (with fixed text)', /^GOLD TV  ·  Fun fact #\d/.test(fs.readFileSync(txtFile, 'utf8')), fs.readFileSync(txtFile, 'utf8'));
    const pid = engine.state.get(st).encoder.pid;
    await api.patch(`/api/stations/${st}/extras`, { overlay: { enabled: true, text: 'GOLD TV', aiMode: 'nowplaying' } });
    await H.until(() => /Now: gold_news/.test(fs.readFileSync(txtFile, 'utf8')), 20000, 'now playing line');
    const why13 = (await api.get('/api/events?area=live&limit=20')).filter(e => /reloading|encoder exited/.test(e.msg)).map(e => e.msg.slice(0, 120)).join(' | ');
    H.check('13. "now playing" AI line, no restart', engine.state.get(st).encoder?.pid === pid, `${fs.readFileSync(txtFile, 'utf8')} ${why13}`);
    H.check('13b. now-playing prompt used the transcript', /Gold went up/.test(callsOf('live_nowplaying')[0].user));

    // 14. Ask AutoCast: plan first, run after confirm
    const before = (await api.get('/api/posts')).length;
    const plan = await api.post('/api/ai/ask', { q: 'post my newest video to my account at the next free slot' });
    H.check('14a. ask makes a plan and changes nothing', plan.action.type === 'create_post' && (await api.get('/api/posts')).length === before, plan.reply);
    const done = await api.post('/api/ai/run', { action: plan.action });
    H.check('14b. confirmed plan runs', /Post #\d+ made/.test(done.done) && (await api.get('/api/posts')).length === before + 1);
    const p2 = await api.post('/api/ai/ask', { q: 'stop the live' });
    await api.post('/api/ai/run', { action: p2.action });
    await H.sleep(1500);
    H.check('14c. "stop the live" stops the station', p2.action.type === 'stop_station' && !engine.state.has(st));
    let e14 = ''; try { await api.post('/api/ai/run', { action: { type: 'drop_tables' } }); } catch (e) { e14 = e.message; }
    H.check('14d. unknown actions refused', /Nothing to do/.test(e14));

    // 15. explain an error
    const ex = await api.post('/api/ai/explain', { kind: 'post', id: bT.id });
    H.check('15. explain error in plain words + steps', ex.summary && ex.steps.length === 2 && /misleading/.test(callsOf('explain')[0].user));

    // 16. daily digest
    const dg = await api.post('/api/ai/digest');
    H.check('16. digest made and sent to alerts', dg.headline && /digest: All good/.test(fs.readFileSync(process.env.NOTIFY_LOG, 'utf8')) && /"failed":1/.test(callsOf('digest')[0].user));

    // 17. best posting times
    const sl = await api.post('/api/ai/slots', { account_id: A, apply: true });
    const accA = (await api.get('/api/accounts')).find(a => a.id === A);
    H.check('17. AI posting times: bad ones dropped, sorted, applied', JSON.stringify(sl.slots) === '["08:15","12:00","19:30"]' && JSON.stringify(accA.slots) === JSON.stringify(sl.slots), sl.slots.join(' '));

    // extra: model without response_format support, usage counter
    await api.post('/api/ai/settings', { model: 'nofmt' });
    const r2 = await api.post('/api/ai/rewrite', { title: 'T', body: 'B', platforms: ['youtube'] });
    H.check('x1. works with models that lack JSON mode', r2.youtube?.title === 'youtube: T' && F.calls.at(-1).fmt === false);
    const us = (await api.get('/api/ai/settings')).usage;
    H.check('x2. AI usage counted', us.calls >= 15 && us.in >= 1500, `${us.calls} calls, ${us.in}+${us.out} tokens`);
    ok = H.summary();
  } catch (e) {
    console.error('ERROR', e.stack || e.message);
    H.summary();
  } finally {
    engine.shutdown(); require('../src/upload/scheduler').shutdown(); srv.close(); F.srv.close(); relay.kill();
    setTimeout(() => process.exit(ok ? 0 : 1), 1500);
  }
})();
