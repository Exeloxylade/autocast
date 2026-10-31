// Auto Upload end-to-end with mock accounts: post now, retries, slots, timed post,
// cancel, folder autopilot with sidecar JSON, and login/security checks.
const fs = require('fs');
const path = require('path');
const H = require('./helpers');

(async () => {
  const data = H.tempData('upload');
  process.env.TICK_MS = '500';
  process.env.RETRY_SCALE = '0.01';          // retries after 0.6 s, 3 s
  process.env.MOCK_DELAY_MS = '200';
  const { startServer } = require('../server');
  const cfg = require('../src/config');
  const scheduler = require('../src/upload/scheduler');
  const srv = await startServer(0, '127.0.0.1');
  const base = `http://127.0.0.1:${srv.address().port}`;
  const api = H.client(base);
  let ok = false;
  try {
    await api.post('/api/settings', { dup_days: 0 });   // this test reuses one video on purpose
    const clip = H.makeClip(path.join(data, 'rupiah_fell_5pct.mp4'), { w: 1080, h: 1920, fps: 30, secs: 3, audio: true });
    const mid = (await api.post('/api/media/import', { path: clip })).id;
    const m = (await api.get('/api/media')).find(x => x.id === mid);
    H.check('media probed', m.width === 1080 && m.height === 1920 && m.duration > 2.9 && m.has_audio === 1, `${m.width}x${m.height} ${m.duration}s`);
    H.check('thumbnail made', fs.existsSync(path.join(data, 'thumbs', `${mid}.jpg`)));
    const thumbRes = await fetch(base + m.thumb);
    H.check('thumbnail served', thumbRes.ok && thumbRes.headers.get('content-type').includes('image'));

    const A = (await api.post('/api/accounts/mock', { name: 'Mock YT', grp: 'Finance' })).id;
    const B = (await api.post('/api/accounts/mock', { name: 'Mock TT', grp: 'Finance' })).id;
    const K = (await api.post('/api/accounts/key', { platform: 'twitch', name: 'Twitch key', server: 'rtmp://live.twitch.tv/app', key: 'live_123' })).id;
    const accs = await api.get('/api/accounts');
    H.check('accounts list hides secrets', !JSON.stringify(accs).includes('live_123') && accs.find(a => a.id === K).has_key === true);

    // 1. post now to 2 accounts
    const p1 = (await api.post('/api/posts', { media_id: mid, title: 'Why Rupiah fell #finance', body: 'Short version #rupiah', per_app: { mock: { body: 'Per-app text #rupiah' } }, account_ids: [A, B], when: 'now', options: { ai: true } })).id;
    const done = await H.until(async () => { const r = (await api.get('/api/posts')).filter(t => t.post_id === p1); return r.every(t => t.status === 'done') ? r : null; }, 20000, 'post now');
    H.check('post now -> 2 accounts done', done.length === 2);
    const outs = fs.readdirSync(path.join(data, 'mock-out')).filter(f => f.endsWith('.json'));
    const meta = JSON.parse(fs.readFileSync(path.join(data, 'mock-out', outs[0]), 'utf8'));
    H.check('per-app text + hashtags used', meta.body === 'Per-app text #rupiah' && meta.tags.includes('finance') && meta.tags.includes('rupiah') && meta.options.ai === true, JSON.stringify(meta.tags));

    // 2. live-only account cannot be a posting target
    let err = ''; try { await api.post('/api/posts', { media_id: mid, title: 'x', account_ids: [K], when: 'now' }); } catch (e) { err = e.message; }
    H.check('live-only account refused for posting', /live only/.test(err), err);

    // 3. failing post: 3 tries then failed
    const p2 = (await api.post('/api/posts', { media_id: mid, title: '[fail] test', account_ids: [A], when: 'now' })).id;
    const f = await H.until(async () => { const t = (await api.get('/api/posts')).find(t => t.post_id === p2); return t.status === 'failed' ? t : null; }, 30000, 'retries then failed');
    H.check('failure retried 3 times then marked failed', f.attempts === 3 && /test failure/.test(f.error), `attempts ${f.attempts}`);
    await api.post(`/api/targets/${f.id}/retry`);
    const fr = (await api.get('/api/posts')).find(t => t.id === f.id);
    H.check('retry button re-queues', ['queued', 'running'].includes(fr.status) && fr.attempts <= 1);

    // 4. next free slot: two posts to same account land on different slots
    await api.patch(`/api/accounts/${A}`, { slots: ['09:00', '13:00', '20:00'] });
    const s1 = (await api.post('/api/posts', { media_id: mid, title: 'slot 1', account_ids: [A], when: 'slot' })).id;
    const s2 = (await api.post('/api/posts', { media_id: mid, title: 'slot 2', account_ids: [A], when: 'slot' })).id;
    const all = await api.get('/api/posts');
    const t1 = all.find(t => t.post_id === s1), t2 = all.find(t => t.post_id === s2);
    const hm = t => { const d = new Date(t); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
    H.check('slot posts use slot times', ['09:00', '13:00', '20:00'].includes(hm(t1.run_at)) && ['09:00', '13:00', '20:00'].includes(hm(t2.run_at)), `${new Date(t1.run_at).toString().slice(0, 21)} / ${new Date(t2.run_at).toString().slice(0, 21)}`);
    H.check('two slot posts do not share a slot', t1.run_at !== t2.run_at && t1.run_at > Date.now() && t2.run_at > Date.now());

    // 5. cancel a queued post
    await api.post(`/api/targets/${t2.id}/cancel`);
    H.check('cancel works', (await api.get('/api/posts')).find(t => t.id === t2.id).status === 'canceled');

    // 6. move post to a time 2 s from now -> it is sent
    await api.patch(`/api/targets/${t1.id}`, { run_at: Date.now() + 2000 });
    await H.until(async () => (await api.get('/api/posts')).find(t => t.id === t1.id).status === 'done', 15000, 'timed post');
    H.check('rescheduled post is sent on time', true);

    // 7. autopilot folder rule with sidecar JSON from the video maker
    const folder = path.join(data, 'watch', 'exports');
    fs.mkdirSync(folder, { recursive: true });
    H.makeClip(path.join(folder, 'old_video.mp4'), { w: 640, h: 360, fps: 30, secs: 2, audio: true });
    const rid = (await api.post('/api/rules', { name: 'Lunch Free -> all', folder, account_ids: [A, B], options: { when: 'now' } })).id;
    const newf = H.makeClip(path.join(folder, 'gold_vs_bitcoin.mp4'), { w: 640, h: 360, fps: 30, secs: 2, audio: true });
    fs.writeFileSync(path.join(folder, 'gold_vs_bitcoin.json'), JSON.stringify({ title: 'Gold vs Bitcoin: 2026', description: 'Which one won?', tags: ['gold', 'bitcoin'] }));
    const past = new Date(Date.now() - 60000); fs.utimesSync(newf, past, past);
    await scheduler.tickRules();
    const rp = (await api.get('/api/posts')).filter(t => t.rule_id === rid);
    H.check('rule picks only the NEW file', rp.length === 2 && rp.every(t => t.title === 'Gold vs Bitcoin: 2026'), `${rp.length} targets, title "${rp[0]?.title}"`);
    H.check('sidecar description + tags used', rp[0]?.body.includes('Which one won?') && rp[0]?.body.includes('#gold'), JSON.stringify(rp[0]?.body));
    await scheduler.tickRules();
    H.check('rule does not post the same file twice', (await api.get('/api/posts')).filter(t => t.rule_id === rid).length === 2);
    await H.until(async () => (await api.get('/api/posts')).filter(t => t.rule_id === rid).every(t => t.status === 'done'), 20000, 'rule posts done');
    H.check('rule posts sent', true);
    const ov = await api.get('/api/upload/overview');
    H.check('overview counts', ov.doneWeek >= 5 && ov.failed >= 0 && ov.rules.length === 1, `done ${ov.doneWeek}, queued ${ov.queued}, failed ${ov.failed}`);

    // 8. deleting media with waiting posts is blocked
    const s3 = (await api.post('/api/posts', { media_id: mid, title: 'later', account_ids: [B], when: Date.now() + 3600e3 })).id;
    err = ''; try { await api.del(`/api/media/${mid}`); } catch (e) { err = e.message; }
    H.check('cannot delete video with waiting posts', /waiting/.test(err), err);

    // 9. security: real login
    cfg.DEV_NOAUTH = false;
    const raw = (p, o = {}) => fetch(base + p, { ...o, headers: { 'content-type': 'application/json', ...(o.headers || {}) } });
    H.check('API locked without login', (await raw('/api/accounts')).status === 401);
    H.check('setup needs 8+ chars', (await raw('/api/setup', { method: 'POST', body: JSON.stringify({ password: 'short' }) })).status === 400);
    const su = await raw('/api/setup', { method: 'POST', body: JSON.stringify({ password: 'correct horse battery' }) });
    const cookie = su.headers.get('set-cookie').split(';')[0];
    H.check('setup sets httpOnly cookie', su.ok && /HttpOnly/i.test(su.headers.get('set-cookie')));
    H.check('cookie opens API', (await raw('/api/accounts', { headers: { cookie } })).ok);
    H.check('write without header refused (CSRF)', (await raw('/api/accounts/mock', { method: 'POST', headers: { cookie }, body: '{}' })).status === 403);
    H.check('second setup refused', (await raw('/api/setup', { method: 'POST', body: JSON.stringify({ password: 'another password' }) })).status === 400);
    let codes = [];
    for (let i = 0; i < 9; i++) codes.push((await raw('/api/login', { method: 'POST', body: JSON.stringify({ password: 'wrong' }) })).status);
    H.check('wrong password 401, then rate-limited', codes[0] === 401 && codes[8] === 429, codes.join(','));
    H.check('forged cookie refused', (await raw('/api/accounts', { headers: { cookie: 'ac_s=1:9999999999999.AAAA' } })).status === 401);
    ok = H.summary();
  } catch (e) {
    console.error('ERROR', e.stack);
    H.summary();
  } finally {
    scheduler.shutdown();
    require('../src/live/engine').shutdown();
    srv.close();
    setTimeout(() => process.exit(ok ? 0 : 1), 500);
  }
})();
