// AutoCast server: one web app, two features.
//   /api/upload/*  + /api/posts, /api/rules        -> Auto Upload
//   /api/live/*    + /api/stations, /api/playlists -> Auto Live
//   /api/accounts, /api/settings, /api/media      -> Shared
const express = require('express');
const multer = require('multer');
const fs = require('fs');
const os = require('os');
const net = require('net');
const path = require('path');
const cfg = require('./src/config');
const { all, get, run, setting, setSetting, event } = require('./src/db');
const { hashPassword, checkPassword, sign, unsign, token } = require('./src/crypto');
const accounts = require('./src/accounts');
const connectors = require('./src/upload/connectors');
const media = require('./src/media');
const scheduler = require('./src/upload/scheduler');
const engine = require('./src/live/engine');
const notify = require('./src/notify');

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 'loopback');
app.use(express.json({ limit: '1mb' }));
app.use((req, res, next) => {
  res.set({ 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'same-origin' });
  next();
});

// ------------------------------------------------------------------ auth
const COOKIE = 'ac_s';
const secure = cfg.PUBLIC_URL.startsWith('https://');
const cookieOpts = { httpOnly: true, sameSite: 'lax', secure, path: '/', maxAge: 30 * 864e5 };
const readCookie = req => Object.fromEntries((req.headers.cookie || '').split(';').map(c => c.trim().split('=').map(decodeURIComponent)).filter(p => p[0]))[COOKIE];
function authed(req) {
  if (cfg.DEV_NOAUTH && ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress)) return true;
  const v = unsign(readCookie(req));
  return !!v && Number(v.split(':')[1]) > Date.now() && v.split(':')[0] === String(setting('session_gen', 1));
}
const fails = new Map();
function limited(ip) { const f = fails.get(ip); return f && f.n >= 8 && Date.now() - f.at < 15 * 60e3; }
function fail(ip) { const f = fails.get(ip) || { n: 0 }; f.n++; f.at = Date.now(); fails.set(ip, f); }

app.get('/api/me', (req, res) => res.json({ setup: !setting('admin'), authed: authed(req) }));
app.post('/api/setup', (req, res) => {
  if (setting('admin')) return res.status(400).json({ error: 'Already set up' });
  const pw = String(req.body.password || '');
  if (pw.length < 8) return res.status(400).json({ error: 'Use at least 8 characters' });
  setSetting('admin', hashPassword(pw));
  res.cookie(COOKIE, sign(`${setting('session_gen', 1)}:${Date.now() + 30 * 864e5}`), cookieOpts).json({ ok: true });
});
app.post('/api/login', (req, res) => {
  const ip = req.ip;
  if (limited(ip)) return res.status(429).json({ error: 'Too many tries. Wait 15 minutes.' });
  if (!checkPassword(String(req.body.password || ''), setting('admin'))) { fail(ip); return res.status(401).json({ error: 'Wrong password' }); }
  fails.delete(ip);
  res.cookie(COOKIE, sign(`${setting('session_gen', 1)}:${Date.now() + 30 * 864e5}`), cookieOpts).json({ ok: true });
});
app.post('/api/logout', (req, res) => res.clearCookie(COOKIE, { path: '/' }).json({ ok: true }));

// ------------------------------------------------------------------ push API (token, for your PC / other tools)
// curl -H "Authorization: Bearer <token>" -F file=@video.mp4 -F title=Hi -F accounts="group:Finance" -F when=slot https://host/hook/upload
const tokenHash = t => require('crypto').createHash('sha256').update(String(t)).digest('hex');
function tokenOk(req) {
  const t = (req.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
  if (!t) return null;
  const list = setting('api_tokens', []);
  const h = tokenHash(t);
  const hit = list.find(x => x.hash === h);
  if (hit) { hit.last_used = Date.now(); setSetting('api_tokens', list); }
  return hit || null;
}
const hookUpload = multer({
  storage: multer.diskStorage({ destination: path.join(cfg.DATA, 'media'), filename: (req, f, cb) => cb(null, `${Date.now()}_${f.originalname.replace(/[^\w.\- ]+/g, '_')}`) }),
  limits: { fileSize: 8 * 1024 ** 3 },
});
app.get('/hook/ping', (req, res) => tokenOk(req) ? res.json({ ok: true, name: tokenOk(req).name }) : res.status(401).json({ error: 'Bad token' }));
app.post('/hook/upload', (req, res, next) => tokenOk(req) ? next() : res.status(401).json({ error: 'Bad token' }), hookUpload.single('file'), async (req, res) => {
  try {
    if (!req.file) throw new Error('Send the video as field "file"');
    if (!media.VIDEO_EXT.test(req.file.originalname)) { fs.rm(req.file.path, { force: true }, () => {}); throw new Error('Only video files'); }
    const b = req.body || {};
    let meta = {}; try { meta = b.meta ? JSON.parse(b.meta) : {}; } catch {}
    const m = await media.addFile(req.file.path, req.file.originalname, 'push');
    const out = { media_id: m.id };
    const tags = (meta.tags || String(b.tags || '').split(',')).map(t => String(t).trim().replace(/^#?/, '#')).filter(t => t.length > 1).join(' ');
    const accTok = String(b.accounts || meta.accounts || '').trim();
    if (accTok) {
      out.post_id = scheduler.createPost({
        media_id: m.id,
        title: String(b.title || meta.title || path.basename(req.file.originalname, path.extname(req.file.originalname))).slice(0, 100),
        body: [b.description || meta.description || '', tags].filter(Boolean).join('\n\n'),
        account_ids: scheduler.resolveAccounts(accTok),
        when: scheduler.parseWhen(b.when || meta.when || 'slot'),
        options: { ai: b.ai === '1' || meta.ai === true, privacy: b.privacy || meta.privacy || 'public', repeatDays: Number(b.repeat_days || 0), repeatTimes: Number(b.repeat_times || 0), allowDuplicate: b.allow_repeat === '1' },
      });
    }
    if (b.playlist_id) {
      const pl = get('SELECT id FROM playlists WHERE id=?', Number(b.playlist_id));
      if (!pl) throw new Error('playlist not found');
      const pos = get('SELECT COALESCE(MAX(pos),-1)+1 p FROM playlist_items WHERE playlist_id=?', pl.id).p;
      run('INSERT INTO playlist_items(playlist_id,media_id,pos) VALUES(?,?,?)', pl.id, m.id, pos);
      for (const s of all('SELECT id, profile FROM stations WHERE playlist_id=?', pl.id)) { media.prepare(m.id, s.profile).then(() => engine.state.has(s.id) && engine.reload(s.id)).catch(() => {}); }
      out.playlist_id = pl.id;
    }
    event('upload', 'info', `push: ${req.file.originalname} received${out.post_id ? `, post #${out.post_id}` : ''}${out.playlist_id ? `, added to playlist ${out.playlist_id}` : ''}`);
    res.json(out);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// Everything below needs login. Writes need a custom header (blocks cross-site form posts).
app.use(['/api', '/files', '/oauth'], (req, res, next) => {
  if (!authed(req)) return req.baseUrl === '/oauth' ? res.redirect('/') : res.status(401).json({ error: 'Log in first' });
  if (req.baseUrl === '/api' && req.method !== 'GET' && req.get('x-autocast') !== '1') return res.status(403).json({ error: 'Missing header' });
  next();
});
const wrap = fn => (req, res) => Promise.resolve(fn(req, res)).then(v => { if (!res.headersSent) res.json(v ?? { ok: true }); }).catch(e => { res.status(e.status && e.status < 500 ? e.status : 400).json({ error: e.message }); });
const bad = msg => Object.assign(new Error(msg), { status: 400 });

app.post('/api/password', wrap(req => {
  if (!checkPassword(String(req.body.old || ''), setting('admin'))) throw bad('Old password is wrong');
  if (String(req.body.password || '').length < 8) throw bad('Use at least 8 characters');
  setSetting('admin', hashPassword(String(req.body.password)));
  setSetting('session_gen', setting('session_gen', 1) + 1);       // log out every other browser
}));

// ------------------------------------------------------------------ system
let cpuPrev = os.cpus(), cpuPct = 0;
setInterval(() => {
  const cur = os.cpus(); let idle = 0, total = 0;
  cur.forEach((c, i) => { const p = cpuPrev[i]?.times || c.times; for (const k in c.times) total += c.times[k] - p[k]; idle += c.times.idle - p.idle; });
  cpuPct = total ? Math.round(100 - (idle / total) * 100) : 0; cpuPrev = cur;
}, 3000).unref();
const relayUp = () => new Promise(r => { const u = new URL(cfg.RELAY_URL.replace(/^rtmps?/, 'http')); const s = net.connect(Number(u.port || 1935), u.hostname); s.setTimeout(1500); s.on('connect', () => { s.destroy(); r(true); }); s.on('error', () => r(false)); s.on('timeout', () => { s.destroy(); r(false); }); });
let ffOk = null;
media.sh(cfg.FFMPEG, ['-version']).then(() => { ffOk = true; }).catch(() => { ffOk = false; });

app.get('/api/system', wrap(async () => {
  let disk = null; try { const s = fs.statfsSync(cfg.DATA); disk = { total: s.blocks * s.bsize, free: s.bavail * s.bsize }; } catch {}
  const live = [...engine.state.keys()].map(id => engine.status(id));
  const upKbps = live.reduce((a, s) => a + (s.pushers || []).reduce((b, p) => b + p.kbps, 0), 0);
  return {
    cores: os.cpus().length, cpu: cpuPct, mem: { total: os.totalmem(), free: os.freemem() }, disk,
    relay: await relayUp(), ffmpeg: ffOk, upKbps, liveStations: live.length,
    publicUrl: cfg.PUBLIC_URL, uptime: process.uptime(), version: require('./package.json').version,
    maxUploadMbps: setting('max_upload_mbps', 100), monthlyTB: setting('monthly_tb', 4), usage: engine.usage(),
  };
}));
app.get('/api/events', wrap(req => {
  const w = [], a = [];
  if (req.query.area) { w.push('area=?'); a.push(String(req.query.area)); }
  if (req.query.level) { w.push(`level IN (${String(req.query.level).split(',').map(() => '?').join(',')})`); a.push(...String(req.query.level).split(',')); }
  if (req.query.q) { w.push('msg LIKE ?'); a.push(`%${req.query.q}%`); }
  return all(`SELECT * FROM events ${w.length ? 'WHERE ' + w.join(' AND ') : ''} ORDER BY id DESC LIMIT ?`, ...a, Math.min(1000, Number(req.query.limit || 200)));
}));

// ------------------------------------------------------------------ media (shared)
const upload = multer({
  storage: multer.diskStorage({ destination: path.join(cfg.DATA, 'media'), filename: (req, f, cb) => cb(null, `${Date.now()}_${f.originalname.replace(/[^\w.\- ]+/g, '_')}`) }),
  limits: { fileSize: 8 * 1024 ** 3 },
  fileFilter: (req, f, cb) => cb(media.VIDEO_EXT.test(f.originalname) ? null : bad('Only video files'), true),
});
app.get('/api/media', wrap(() => media.listMedia().map(m => ({ ...m, file: undefined, prepared: undefined, thumb: m.thumb ? `/files/thumbs/${m.id}.jpg` : null }))));
app.post('/api/media', upload.array('files', 20), wrap(async req => {
  const out = [];
  for (const f of req.files || []) {
    try { out.push((await media.addFile(f.path, f.originalname)).id); }
    catch (e) { fs.rm(f.path, { force: true }, () => {}); throw bad(`${f.originalname}: ${e.message}`); }
  }
  return { ids: out };
}));
app.post('/api/media/import', wrap(async req => {
  // Add a file that is already on the VPS (no copy).
  const p = path.resolve(String(req.body.path || ''));
  if (!fs.existsSync(p) || !fs.statSync(p).isFile()) throw bad('File not found on server');
  if (!media.VIDEO_EXT.test(p)) throw bad('Not a video file');
  return { id: (await media.addFile(p, path.basename(p), 'import')).id };
}));
app.delete('/api/media/:id', wrap(req => {
  const used = get("SELECT COUNT(*) n FROM post_targets t JOIN posts p ON p.id=t.post_id WHERE p.media_id=? AND t.status IN ('queued','running')", req.params.id).n;
  if (used) throw bad('This video has posts waiting. Cancel them first.');
  media.removeMedia(Number(req.params.id));
}));
app.post('/api/media/:id/prepare', wrap(req => { media.prepare(Number(req.params.id), req.body.profile || '1080p30').catch(() => {}); }));
app.use('/files/thumbs', express.static(path.join(cfg.DATA, 'thumbs'), { maxAge: '1h' }));

// Signed, short-lived public link (Instagram fetches video_url from here).
app.get('/pub/:t', (req, res) => {
  const v = unsign(decodeURIComponent(req.params.t));
  if (!v) return res.sendStatus(404);
  const [id, exp] = v.split(':').map(Number);
  if (exp < Date.now()) return res.sendStatus(410);
  const m = get('SELECT file FROM media WHERE id=?', id);
  if (!m) return res.sendStatus(404);
  res.sendFile(m.file);
});

// ------------------------------------------------------------------ accounts (shared)
app.get('/api/accounts', wrap(() => accounts.list()));
app.get('/api/platforms', wrap(() => Object.entries(connectors).map(([k, c]) => ({ id: k, label: c.label, upload: !!c.upload, live: !!c.live, oauth: !!c.oauth, app: c.app, defaultServer: c.defaultServer || '' }))));
app.post('/api/accounts/key', wrap(req => ({ id: accounts.addStreamKey(req.body) })));
app.post('/api/accounts/mock', wrap(req => ({ id: accounts.addMock(req.body) })));
app.patch('/api/accounts/:id', wrap(req => {
  const a = get('SELECT * FROM accounts WHERE id=?', req.params.id); if (!a) throw bad('Not found');
  const { name, grp, slots } = req.body;
  if (slots && (!Array.isArray(slots) || slots.some(s => !/^\d\d:\d\d$/.test(s)))) throw bad('Slots look like 09:00');
  run('UPDATE accounts SET name=COALESCE(?,name), grp=COALESCE(?,grp), slots=COALESCE(?,slots) WHERE id=?', name ?? null, grp ?? null, slots ? JSON.stringify([...new Set(slots)].sort()) : null, a.id);
}));
app.delete('/api/accounts/:id', wrap(req => { run('DELETE FROM accounts WHERE id=?', req.params.id); }));

const OAUTH_APP = { google: 'youtube', meta: 'facebook', tiktok: 'tiktok' };
const redirectUri = (req, appName) => `${cfg.PUBLIC_URL || `${req.protocol}://${req.get('host')}`}/oauth/${appName}/callback`;
app.get('/oauth/:app/start', (req, res) => {
  const c = connectors[OAUTH_APP[req.params.app]];
  const keys = accounts.appKeys()[req.params.app];
  if (!c || !keys) return res.redirect('/#shared/settings?need=' + req.params.app);
  const state = sign(`${req.params.app}:${token(8)}:${Date.now() + 10 * 60e3}`);
  res.redirect(c.oauth.url(keys, state, redirectUri(req, req.params.app)));
});
app.get('/oauth/:app/callback', async (req, res) => {
  const appName = req.params.app;
  try {
    const st = unsign(String(req.query.state || ''));
    if (!st || st.split(':')[0] !== appName || Number(st.split(':')[2]) < Date.now()) throw new Error('Login link expired. Try again.');
    if (req.query.error) throw new Error(String(req.query.error_description || req.query.error));
    const c = connectors[OAUTH_APP[appName]];
    const list = await c.oauth.exchange(accounts.appKeys()[appName], String(req.query.code || ''), redirectUri(req, appName));
    for (const a of list) accounts.upsertOauth(a.platform || OAUTH_APP[appName], a);
    event('accounts', 'info', `connected ${list.map(a => a.name).join(', ')}`);
    res.redirect(`/#shared/accounts?added=${list.length}`);
  } catch (e) {
    event('accounts', 'error', `${appName} login failed: ${e.message}`);
    res.redirect(`/#shared/accounts?error=${encodeURIComponent(e.message)}`);
  }
});

// ------------------------------------------------------------------ settings (shared)
app.get('/api/settings', wrap(req => ({
  apps: accounts.appKeysPublic(), alerts: notify.publicCfg(),
  redirects: Object.keys(OAUTH_APP).map(a => ({ app: a, uri: redirectUri(req, a) })),
  retentionDays: setting('retention_days', 30), maxUploadMbps: setting('max_upload_mbps', 100), monthlyTB: setting('monthly_tb', 4),
  defaultProfile: setting('default_profile', '1080p30'), profiles: Object.keys(media.PROFILES), dupDays: setting('dup_days', 7),
})));
app.post('/api/settings', wrap(req => {
  const b = req.body || {};
  if (b.apps) accounts.setAppKeys(b.apps);
  if (b.alerts) notify.save(b.alerts);
  for (const k of ['retention_days', 'max_upload_mbps', 'monthly_tb', 'dup_days']) if (b[k] != null && b[k] !== '') setSetting(k, Number(b[k]));
  if (b.default_profile && media.PROFILES[b.default_profile]) setSetting('default_profile', b.default_profile);
}));
app.post('/api/settings/test-alert', wrap(async () => { await notify.send('test', 'test alert ✅ ' + new Date().toLocaleString()); }));

// ------------------------------------------------------------------ AUTO UPLOAD
const targetRow = t => ({ ...t, post: undefined });
app.get('/api/upload/overview', wrap(() => {
  const now = Date.now(), wk = now - 7 * 864e5;
  const c = s => get('SELECT COUNT(*) n FROM post_targets WHERE status=?', s).n;
  return {
    doneWeek: get("SELECT COUNT(*) n FROM post_targets WHERE status='done' AND done_at>=?", wk).n,
    doneLastWeek: get("SELECT COUNT(*) n FROM post_targets WHERE status='done' AND done_at>=? AND done_at<?", wk - 7 * 864e5, wk).n,
    queued: c('queued'), running: c('running'), failed: c('failed'),
    next: get("SELECT run_at FROM post_targets WHERE status='queued' ORDER BY run_at LIMIT 1")?.run_at || null,
    today: get("SELECT COUNT(*) n FROM post_targets WHERE status IN ('queued','running','done') AND run_at BETWEEN ? AND ?", new Date().setHours(0, 0, 0, 0), new Date().setHours(23, 59, 59, 999)).n,
    perPlatform: all(`SELECT a.platform, COUNT(DISTINCT a.id) accounts, SUM(t.status='done') done, SUM(t.status='failed') failed, SUM(t.status='queued') queued
                      FROM accounts a LEFT JOIN post_targets t ON t.account_id=a.id AND (t.done_at>=? OR t.status='queued') WHERE a.can_upload=1 GROUP BY a.platform`, wk),
    rules: all('SELECT id,name,enabled,runs,last_run FROM rules ORDER BY id'),
    reauth: all("SELECT id,name,platform FROM accounts WHERE status!='ok'"),
  };
}));
const POSTS_SQL = `SELECT t.*, p.title, p.body, p.media_id, p.rule_id, a.name account, a.platform, m.name media_name, m.duration, m.width, m.height
  FROM post_targets t JOIN posts p ON p.id=t.post_id JOIN accounts a ON a.id=t.account_id LEFT JOIN media m ON m.id=p.media_id`;
app.get('/api/posts', wrap(req => {
  const from = Number(req.query.from || 0), to = Number(req.query.to || 8.64e15);
  const st = req.query.status ? String(req.query.status).split(',') : null;
  const rows = all(`${POSTS_SQL} WHERE t.run_at BETWEEN ? AND ? ${st ? `AND t.status IN (${st.map(() => '?').join(',')})` : ''} ORDER BY t.run_at ${req.query.order === 'desc' ? 'DESC' : 'ASC'} LIMIT 500`, from, to, ...(st || []));
  return rows.map(r => ({ ...targetRow(r), thumb: r.media_id ? `/files/thumbs/${r.media_id}.jpg` : null }));
}));
app.post('/api/posts', wrap(req => ({ id: scheduler.createPost(req.body) })));
app.post('/api/targets/:id/retry', wrap(req => { run("UPDATE post_targets SET status='queued', next_try=NULL, attempts=0, error='', run_at=MIN(run_at,?) WHERE id=? AND status IN ('failed','canceled')", Date.now(), req.params.id); }));
app.post('/api/targets/:id/cancel', wrap(req => { run("UPDATE post_targets SET status='canceled' WHERE id=? AND status='queued'", req.params.id); }));
app.patch('/api/targets/:id', wrap(req => {
  const at = Number(req.body.run_at); if (!at) throw bad('Bad time');
  run("UPDATE post_targets SET run_at=? WHERE id=? AND status='queued'", at, req.params.id);
}));
app.get('/api/slots/next', wrap(req => String(req.query.accounts || '').split(',').filter(Boolean).map(id => ({ id: Number(id), at: scheduler.nextSlot(Number(id)) }))));

app.get('/api/rules', wrap(() => all('SELECT id,name,enabled,folder,account_ids,title_tpl,body_tpl,options,runs,last_run FROM rules ORDER BY id').map(r => ({ ...r, account_ids: JSON.parse(r.account_ids), options: JSON.parse(r.options || '{}') }))));
function ruleBody(b) {
  if (!b.name) throw bad('Give the rule a name');
  if (!b.folder) throw bad('Pick a folder on the server');
  if (!Array.isArray(b.account_ids) || !b.account_ids.length) throw bad('Pick at least one account');
  return [b.name, b.enabled === false ? 0 : 1, path.resolve(b.folder), JSON.stringify(b.account_ids.map(Number)), b.title_tpl || '{title}', b.body_tpl ?? '{description}\n\n{tags}', JSON.stringify(b.options || {})];
}
app.post('/api/rules', wrap(req => {
  const v = ruleBody(req.body);
  fs.mkdirSync(v[2], { recursive: true });
  // Mark files already in the folder as seen, so only NEW videos are posted.
  const seen = fs.readdirSync(v[2]).filter(f => media.VIDEO_EXT.test(f)).map(f => `${f}|${fs.statSync(path.join(v[2], f)).size}`);
  return { id: Number(run('INSERT INTO rules(name,enabled,folder,account_ids,title_tpl,body_tpl,options,seen,created_at) VALUES(?,?,?,?,?,?,?,?,?)', ...v, JSON.stringify(req.body.include_existing ? [] : seen), Date.now()).lastInsertRowid) };
}));
app.patch('/api/rules/:id', wrap(req => {
  if (Object.keys(req.body).length === 1 && 'enabled' in req.body) return void run('UPDATE rules SET enabled=? WHERE id=?', req.body.enabled ? 1 : 0, req.params.id);
  const v = ruleBody(req.body);
  run('UPDATE rules SET name=?,enabled=?,folder=?,account_ids=?,title_tpl=?,body_tpl=?,options=? WHERE id=?', ...v, req.params.id);
}));
app.delete('/api/rules/:id', wrap(req => { run('DELETE FROM rules WHERE id=?', req.params.id); }));

// ------------------------------------------------------------------ AUTO LIVE
function stationOut(s) {
  const dests = all('SELECT d.*, a.platform, a.name account FROM destinations d LEFT JOIN accounts a ON a.id=d.account_id WHERE d.station_id=?', s.id);
  const items = all('SELECT COUNT(*) n, COALESCE(SUM(m.duration),0) dur FROM playlist_items pi JOIN media m ON m.id=pi.media_id WHERE pi.playlist_id=?', s.playlist_id || 0)[0];
  const snap = engine.snapFile(s.id);
  let overlay = {}; try { overlay = JSON.parse(s.overlay || '{}'); } catch {}
  return { ...s, schedule: JSON.parse(s.schedule || '{}'), overlay, hasLogo: fs.existsSync(engine.logoFile(s.id)), recCount: s.record ? engine.recordings(s.id).length : 0, destinations: dests, playlistItems: items.n, playlistDuration: items.dur,
    runtime: engine.status(s.id), wantOn: engine.wantOn(s),
    blockedBy: !engine.state.has(s.id) && engine.wantOn(s) ? engine.conflicts(s.id).map(c => `${c.account} is live on "${c.station}"`)[0] || null : null,
    snapshotAt: fs.existsSync(snap) ? fs.statSync(snap).mtimeMs : null };
}
app.get('/api/stations', wrap(() => all('SELECT * FROM stations ORDER BY id').map(stationOut)));
app.get('/api/stations/:id', wrap(req => { const s = get('SELECT * FROM stations WHERE id=?', req.params.id); if (!s) throw bad('Not found'); return stationOut(s); }));
function checkSchedule(sc) {
  if (!sc) return JSON.stringify({ mode: 'manual' });
  if (!['manual', 'always', 'daily'].includes(sc.mode)) throw bad('Schedule must be manual, always or daily');
  if (sc.mode === 'daily' && (!/^\d\d:\d\d$/.test(sc.start || '') || !/^\d\d:\d\d$/.test(sc.end || ''))) throw bad('Daily needs start and end like 08:00');
  return JSON.stringify(sc);
}
app.post('/api/stations', wrap(req => {
  const b = req.body;
  if (!b.name) throw bad('Name the station');
  if (b.profile && !media.PROFILES[b.profile]) throw bad('Unknown quality');
  let pl = b.playlist_id;
  if (!pl) pl = Number(run('INSERT INTO playlists(name,created_at) VALUES(?,?)', `${b.name} playlist`, Date.now()).lastInsertRowid);
  const id = Number(run('INSERT INTO stations(name,kind,playlist_id,profile,schedule,created_at) VALUES(?,?,?,?,?,?)', b.name, b.kind || 'file_loop', pl, b.profile || setting('default_profile', '1080p30'), checkSchedule(b.schedule), Date.now()).lastInsertRowid);
  (b.media_ids || []).forEach((m, i) => run('INSERT INTO playlist_items(playlist_id,media_id,pos) VALUES(?,?,?)', pl, m, i));
  for (const aid of b.account_ids || []) addDest(id, aid);
  // Prepare files now so "Start" is quick later.
  for (const m of b.media_ids || []) media.prepare(m, b.profile || '1080p30').catch(() => {});
  return { id };
}));
app.patch('/api/stations/:id', wrap(async req => {
  const s = get('SELECT * FROM stations WHERE id=?', req.params.id); if (!s) throw bad('Not found');
  const b = req.body;
  if (b.profile && !media.PROFILES[b.profile]) throw bad('Unknown quality');
  run('UPDATE stations SET name=COALESCE(?,name), profile=COALESCE(?,profile), schedule=COALESCE(?,schedule), playlist_id=COALESCE(?,playlist_id) WHERE id=?',
    b.name ?? null, b.profile ?? null, b.schedule ? checkSchedule(b.schedule) : null, b.playlist_id ?? null, s.id);
  if ((b.profile && b.profile !== s.profile) || (b.playlist_id && b.playlist_id !== s.playlist_id)) {
    if (engine.state.has(s.id)) { engine.stop(s.id); if (engine.wantOn(get('SELECT * FROM stations WHERE id=?', s.id))) engine.start(s.id).catch(() => {}); }
  }
}));
app.delete('/api/stations/:id', wrap(req => { engine.stop(Number(req.params.id)); run('DELETE FROM stations WHERE id=?', req.params.id); }));
app.post('/api/stations/:id/start', wrap(async req => {
  const id = Number(req.params.id);
  const s = get('SELECT * FROM stations WHERE id=?', id); if (!s) throw bad('Not found');
  run('UPDATE stations SET want_on=1 WHERE id=?', id);
  if (JSON.parse(s.schedule || '{}').mode === 'daily') run(`UPDATE stations SET schedule='{"mode":"manual"}' WHERE id=?`, id);
  if (!get('SELECT COUNT(*) n FROM destinations WHERE station_id=? AND enabled=1', id).n) throw bad('Add a destination first');
  const c = engine.conflicts(id);
  if (c.length) { run('UPDATE stations SET want_on=0 WHERE id=?', id); throw bad(`${c[0].account} is already live on "${c[0].station}". Turn it off there first.`); }
  engine.start(id).catch(() => {});
}));
app.post('/api/stations/:id/stop', wrap(req => {
  const id = Number(req.params.id);
  run(`UPDATE stations SET want_on=0, schedule=CASE WHEN json_extract(schedule,'$.mode')='always' THEN '{"mode":"manual"}' ELSE schedule END WHERE id=?`, id);
  engine.stop(id);
}));
app.post('/api/stations/:id/skip', wrap(req => engine.skip(Number(req.params.id))));
app.get('/api/stations/:id/snapshot.jpg', (req, res) => {
  const f = engine.snapFile(Number(req.params.id));
  if (!fs.existsSync(f)) return res.sendStatus(404);
  res.set('Cache-Control', 'no-store').sendFile(f);
});
function addDest(stationId, accountId) {
  const a = get('SELECT * FROM accounts WHERE id=?', accountId);
  if (!a) throw bad('Account not found');
  if (!a.can_live) throw bad(`${a.name} can't go live from here. Add its stream key.`);
  if (get('SELECT id FROM destinations WHERE station_id=? AND account_id=?', stationId, accountId)) return;
  if (engine.state.has(stationId)) { const c = engine.conflicts(stationId, [Number(accountId)]); if (c.length) throw bad(`${c[0].account} is already live on "${c[0].station}".`); }
  run('INSERT INTO destinations(station_id,account_id,label) VALUES(?,?,?)', stationId, accountId, `${connectors[a.platform]?.label || a.platform} · ${a.name}`);
}
app.post('/api/stations/:id/destinations', wrap(req => addDest(Number(req.params.id), Number(req.body.account_id))));
app.patch('/api/destinations/:id', wrap(req => {
  const d = get('SELECT * FROM destinations WHERE id=?', req.params.id); if (!d) throw bad('Not found');
  if (req.body.enabled && engine.state.has(d.station_id)) { const c = engine.conflicts(d.station_id, [d.account_id]); if (c.length) throw bad(`${c[0].account} is already live on "${c[0].station}".`); }
  run('UPDATE destinations SET enabled=? WHERE id=?', req.body.enabled ? 1 : 0, d.id);
}));
app.delete('/api/destinations/:id', wrap(req => { run('DELETE FROM destinations WHERE id=?', req.params.id); }));

// playlists
app.get('/api/playlists', wrap(() => all('SELECT * FROM playlists ORDER BY id').map(p => ({
  ...p, items: all('SELECT pi.id, pi.pos, m.id media_id, m.name, m.duration, m.prepare_state, m.prepare_msg FROM playlist_items pi JOIN media m ON m.id=pi.media_id WHERE pi.playlist_id=? ORDER BY pi.pos, pi.id', p.id),
  stations: all('SELECT id,name FROM stations WHERE playlist_id=?', p.id),
}))));
const reloadUsing = pl => { for (const s of all('SELECT id FROM stations WHERE playlist_id=?', pl)) engine.reload(s.id).catch(e => event('live', 'error', `reload: ${e.message}`, s.id)); };
app.post('/api/playlists', wrap(req => { if (!req.body.name) throw bad('Name it'); return { id: Number(run('INSERT INTO playlists(name,shuffle,created_at) VALUES(?,?,?)', req.body.name, req.body.shuffle ? 1 : 0, Date.now()).lastInsertRowid) }; }));
app.patch('/api/playlists/:id', wrap(req => { run('UPDATE playlists SET name=COALESCE(?,name), shuffle=COALESCE(?,shuffle) WHERE id=?', req.body.name ?? null, req.body.shuffle == null ? null : req.body.shuffle ? 1 : 0, req.params.id); reloadUsing(Number(req.params.id)); }));
app.delete('/api/playlists/:id', wrap(req => { if (get('SELECT id FROM stations WHERE playlist_id=?', req.params.id)) throw bad('A station uses this playlist'); run('DELETE FROM playlists WHERE id=?', req.params.id); }));
app.post('/api/playlists/:id/items', wrap(req => {
  const pl = Number(req.params.id);
  const ids = (req.body.media_ids || [req.body.media_id]).filter(Boolean).map(Number);
  const pos = get('SELECT COALESCE(MAX(pos),-1)+1 p FROM playlist_items WHERE playlist_id=?', pl).p;
  ids.forEach((m, i) => run('INSERT INTO playlist_items(playlist_id,media_id,pos) VALUES(?,?,?)', pl, m, pos + i));
  for (const s of all('SELECT profile FROM stations WHERE playlist_id=?', pl)) ids.forEach(m => media.prepare(m, s.profile).catch(() => {}));
  reloadUsing(pl);
}));
app.post('/api/playlists/:id/order', wrap(req => { (req.body.ids || []).forEach((id, i) => run('UPDATE playlist_items SET pos=? WHERE id=? AND playlist_id=?', i, id, req.params.id)); reloadUsing(Number(req.params.id)); }));
app.delete('/api/playlist-items/:id', wrap(req => { const it = get('SELECT * FROM playlist_items WHERE id=?', req.params.id); run('DELETE FROM playlist_items WHERE id=?', req.params.id); if (it) reloadUsing(it.playlist_id); }));

// ------------------------------------------------------------------ v2 features
// API tokens (shown once, stored as hash)
app.get('/api/tokens', wrap(() => setting('api_tokens', []).map(({ hash, ...t }) => t)));
app.post('/api/tokens', wrap(req => {
  const t = 'ac_' + token(24);
  const list = setting('api_tokens', []);
  list.push({ id: token(6), name: String(req.body.name || 'My PC').slice(0, 40), hash: tokenHash(t), created: Date.now(), last_used: null });
  setSetting('api_tokens', list);
  return { token: t };
}));
app.delete('/api/tokens/:id', wrap(req => { setSetting('api_tokens', setting('api_tokens', []).filter(t => t.id !== req.params.id)); }));

// Saved text snippets / hashtag sets
app.get('/api/snippets', wrap(() => setting('snippets', [])));
app.post('/api/snippets', wrap(req => {
  const name = String(req.body.name || '').trim().slice(0, 40), text = String(req.body.text || '').trim().slice(0, 2000);
  if (!name || !text) throw bad('Give it a name and some text');
  const list = setting('snippets', []).filter(s => s.name !== name);
  list.push({ name, text }); setSetting('snippets', list);
}));
app.delete('/api/snippets/:name', wrap(req => { setSetting('snippets', setting('snippets', []).filter(s => s.name !== req.params.name)); }));

// Bulk CSV
app.post('/api/posts/csv', wrap(async req => scheduler.importCSV(String(req.body.csv || ''))));

// Shorts cutter + vertical version
app.post('/api/media/:id/shorts', wrap(async req => {
  const id = Number(req.params.id);
  if (!get('SELECT id FROM media WHERE id=?', id)) throw bad('Not found');
  const job = media.makeShorts(id, req.body || {});
  if (req.body.wait) return { ids: await job };
  job.catch(e => event('media', 'error', `shorts: ${e.message}`, id));
  return { started: true };
}));
app.post('/api/media/:id/vertical', wrap(async req => { const f = await media.verticalVariant(Number(req.params.id)); return { ok: true, file: path.basename(f) }; }));

// Account options: format + daily limit
app.patch('/api/accounts/:id/options', wrap(req => {
  const { fmt, daily_max } = req.body;
  if (fmt && !['auto', 'original', 'vertical'].includes(fmt)) throw bad('Format must be auto, original or vertical');
  run('UPDATE accounts SET fmt=COALESCE(?,fmt), daily_max=COALESCE(?,daily_max) WHERE id=?', fmt ?? null, daily_max == null ? null : Math.max(0, Math.min(50, Number(daily_max) || 0)), req.params.id);
}));

// Station extras: overlay, music, recording
app.patch('/api/stations/:id/extras', wrap(async req => {
  const s = get('SELECT * FROM stations WHERE id=?', req.params.id); if (!s) throw bad('Not found');
  const b = req.body;
  const beforeOverlay = engine.overlayActive(s);
  if (b.overlay) {
    const aiMode = ['ticker', 'nowplaying'].includes(b.overlay.aiMode) ? b.overlay.aiMode : 'off';
    const o = { enabled: !!b.overlay.enabled, text: String(b.overlay.text || '').slice(0, 200), clock: !!b.overlay.clock, logo: !!b.overlay.logo,
      aiMode, aiPrompt: String(b.overlay.aiPrompt || '').slice(0, 300), aiEvery: Math.max(1, Math.min(120, Number(b.overlay.aiEvery) || 5)) };
    run('UPDATE stations SET overlay=? WHERE id=?', JSON.stringify(o), s.id);
  }
  if ('music_playlist_id' in b) {
    if (b.music_playlist_id && !get('SELECT id FROM playlists WHERE id=?', b.music_playlist_id)) throw bad('Music playlist not found');
    if (b.music_playlist_id && Number(b.music_playlist_id) === s.playlist_id) throw bad('Pick a different playlist for music');
    run('UPDATE stations SET music_playlist_id=? WHERE id=?', b.music_playlist_id || null, s.id);
  }
  if (b.music_volume != null) run('UPDATE stations SET music_volume=? WHERE id=?', Math.max(0, Math.min(1, Number(b.music_volume))), s.id);
  if (b.record != null) run('UPDATE stations SET record=? WHERE id=?', b.record ? 1 : 0, s.id);
  const after = get('SELECT * FROM stations WHERE id=?', s.id);
  // Overlay on/off or music change needs a new encoder. Text-only changes apply live.
  // Only restart the picture when something it needs really changed.
  const bo = (() => { try { return JSON.parse(s.overlay || '{}'); } catch { return {}; } })(), ao = (() => { try { return JSON.parse(after.overlay || '{}'); } catch { return {}; } })();
  const needReload = beforeOverlay !== engine.overlayActive(after)
    || (engine.overlayActive(after) && (!!bo.clock !== !!ao.clock || !!bo.logo !== !!ao.logo || !!(bo.text || (bo.aiMode && bo.aiMode !== 'off')) !== !!(ao.text || (ao.aiMode && ao.aiMode !== 'off'))))
    || (s.music_playlist_id || null) !== (after.music_playlist_id || null)
    || (after.music_playlist_id && Number(s.music_volume) !== Number(after.music_volume));
  if (needReload && engine.state.has(s.id)) await engine.reload(s.id).catch(e => event('live', 'error', e.message, s.id));
  return { reloaded: !!(needReload && engine.state.has(s.id)) };
}));
const imgUpload = multer({ dest: path.join(cfg.DATA, 'logos'), limits: { fileSize: 5 * 1024 ** 2 } });
app.post('/api/stations/:id/logo', imgUpload.single('logo'), wrap(async req => {
  const id = Number(req.params.id);
  if (!req.file) throw bad('Send an image');
  // Re-encode to PNG: checks it is a real image and strips anything else.
  try { await media.sh(cfg.FFMPEG, ['-y', '-v', 'error', '-i', req.file.path, '-frames:v', '1', '-vf', 'scale=w=min(iw\\,800):h=-2', engine.logoFile(id)]); }
  catch { throw bad('That file is not an image'); }
  finally { fs.rm(req.file.path, { force: true }, () => {}); }
  const s = get('SELECT * FROM stations WHERE id=?', id);
  if (s && engine.state.has(id) && engine.overlayActive(s)) await engine.reload(id).catch(() => {});
}));
app.get('/api/stations/:id/logo.png', (req, res) => { const f = engine.logoFile(Number(req.params.id)); fs.existsSync(f) ? res.set('Cache-Control', 'no-store').sendFile(f) : res.sendStatus(404); });
app.delete('/api/stations/:id/logo', wrap(req => { fs.rmSync(engine.logoFile(Number(req.params.id)), { force: true }); }));
app.get('/api/stations/:id/recordings', wrap(req => engine.recordings(Number(req.params.id))));
app.get('/files/recordings/:name', (req, res) => {
  const n = path.basename(req.params.name);
  const f = path.join(engine.recDir(), n);
  if (!/^st\d+_[\d_]+\.mp4$/.test(n) || !fs.existsSync(f)) return res.sendStatus(404);
  res.download(f);
});
app.delete('/api/recordings/:name', wrap(req => {
  const n = path.basename(req.params.name);
  if (!/^st\d+_[\d_]+\.mp4$/.test(n)) throw bad('Bad name');
  fs.rmSync(path.join(engine.recDir(), n), { force: true });
}));

// Folder for a playlist (refills itself)
app.patch('/api/playlists/:id/folder', wrap(req => {
  const f = String(req.body.folder || '').trim();
  if (f) fs.mkdirSync(path.resolve(f), { recursive: true });
  // Files already there count as new only when include_existing is set.
  const seen = f && !req.body.include_existing ? fs.readdirSync(path.resolve(f)).filter(x => media.VIDEO_EXT.test(x)).map(x => `${x}|${fs.statSync(path.join(path.resolve(f), x)).size}`) : [];
  run('UPDATE playlists SET folder=?, seen=? WHERE id=?', f ? path.resolve(f) : '', JSON.stringify(seen), req.params.id);
  engine.refillFolders().catch(() => {});
}));

// Backup: a clean copy of the database
app.get('/api/backup', (req, res) => {
  const f = path.join(cfg.DATA, 'backups', `autocast-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.db`);
  try {
    require('./src/db').db.exec(`VACUUM INTO '${f.replace(/'/g, "''")}'`);
    res.download(f, path.basename(f), () => fs.rm(f, { force: true }, () => {}));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ------------------------------------------------------------------ AI
const ai = require('./src/ai/client');
const aiFx = require('./src/ai/features');
const mediaOr404 = id => { const m = get('SELECT * FROM media WHERE id=?', Number(id)); if (!m) throw bad('Video not found'); return m; };
// Long jobs run in the background; the UI polls /api/ai/jobs.
const jobs = new Map();
function bg(kind, ref, fn) {
  const id = token(6);
  const j = { id, kind, ref, state: 'working', at: Date.now() };
  jobs.set(id, j);
  fn().then(r => { j.state = 'done'; j.result = r; }).catch(e => { j.state = 'failed'; j.error = e.message; event('ai', 'error', `${kind}: ${e.message}`, ref); });
  for (const [k, v] of jobs) if (Date.now() - v.at > 3600e3) jobs.delete(k);
  return { job: id };
}
const maybeBg = (req, kind, ref, fn) => (req.body?.wait ? fn() : bg(kind, ref, fn));
app.get('/api/ai/jobs', wrap(() => [...jobs.values()].sort((a, b) => b.at - a.at).slice(0, 30)));
app.get('/api/ai/jobs/:id', wrap(req => { const j = jobs.get(req.params.id); if (!j) throw bad('Job not found'); return j; }));

app.get('/api/ai/settings', wrap(() => ({ ...ai.publicCfg(), ready: ai.ready(), usage: ai.usage(), safety: setting('ai_safety', 'off'), digestHour: setting('ai_digest_hour', -1), lastDigest: setting('ai_last_digest', null) })));
app.post('/api/ai/settings', wrap(req => {
  const b = req.body || {};
  if (b.baseUrl && !/^https?:\/\//i.test(b.baseUrl)) throw bad('Base URL must start with http:// or https://');
  ai.save({ baseUrl: b.baseUrl, apiKey: b.apiKey, model: b.model, visionModel: b.visionModel, sttModel: b.sttModel, lang: b.lang });
  if (b.safety && ['off', 'warn', 'block'].includes(b.safety)) setSetting('ai_safety', b.safety);
  if (b.digestHour != null && b.digestHour !== '') setSetting('ai_digest_hour', Math.max(-1, Math.min(23, Number(b.digestHour))));
}));
app.post('/api/ai/test', wrap(() => ai.test()));
app.post('/api/ai/write', wrap(async req => { mediaOr404(req.body.media_id); return aiFx.writePost(Number(req.body.media_id), { topic: req.body.topic, platforms: req.body.platforms, tone: req.body.tone }); }));
app.post('/api/ai/rewrite', wrap(req => aiFx.rewriteFor(req.body)));
app.post('/api/ai/translate', wrap(req => aiFx.translate(req.body)));
app.post('/api/ai/transcribe/:id', wrap(req => { mediaOr404(req.params.id); return maybeBg(req, 'transcribe', req.params.id, () => aiFx.transcribeMedia(Number(req.params.id)).then(s => ({ lines: s.length }))); }));
app.get('/api/ai/transcript/:id', wrap(req => aiFx.transcript(Number(req.params.id)) || []));
app.post('/api/ai/captions/:id', wrap(req => { mediaOr404(req.params.id); return maybeBg(req, 'captions', req.params.id, () => aiFx.burnCaptions(Number(req.params.id)).then(id => ({ media_id: id }))); }));
app.post('/api/ai/shorts/:id', wrap(req => { mediaOr404(req.params.id); return maybeBg(req, 'ai_shorts', req.params.id, () => aiFx.aiShorts(Number(req.params.id), req.body || {})); }));
app.post('/api/ai/thumbnail/:id', wrap(req => { mediaOr404(req.params.id); return maybeBg(req, 'thumbnail', req.params.id, () => aiFx.aiThumbnail(Number(req.params.id), req.body || {})); }));
app.delete('/api/ai/thumbnail/:id', wrap(req => { fs.rmSync(aiFx.thumbFile(Number(req.params.id)), { force: true }); }));
app.use('/files/ai-thumbs', express.static(path.join(cfg.DATA, 'thumbs_ai'), { maxAge: 0 }));
app.post('/api/ai/safety', wrap(req => aiFx.safetyCheck({ title: req.body.title || '', body: req.body.body || '', platform: req.body.platform || 'youtube' })));
app.post('/api/ai/explain', wrap(async req => {
  const { kind, id } = req.body;
  let error = '', context = '';
  if (kind === 'post') { const t = get('SELECT t.*, a.platform, a.name FROM post_targets t JOIN accounts a ON a.id=t.account_id WHERE t.id=?', id); if (!t) throw bad('Not found'); error = t.error; context = `posting to ${t.platform} account "${t.name}", tries ${t.attempts}`; }
  else if (kind === 'live') { const s = engine.status(Number(req.body.station_id)); const p = s.pushers?.find(x => x.id === Number(id)); error = p?.error || s.error || ''; context = `live stream destination "${p?.label || ''}", status ${p?.status}, drops ${p?.drops}`; }
  else { error = String(req.body.error || ''); context = String(req.body.context || ''); }
  if (!error) throw bad('No error to explain');
  return aiFx.explain({ error, context });
}));
app.post('/api/ai/digest', wrap(async () => { const d = await aiFx.digest(); notify.send('digest', `${d.headline}\n\n${d.text}`); return d; }));
app.post('/api/ai/slots', wrap(async req => {
  const a = get('SELECT * FROM accounts WHERE id=?', req.body.account_id); if (!a) throw bad('Account not found');
  const r = await aiFx.suggestSlots({ platform: a.platform, audience: req.body.audience });
  if (req.body.apply) run('UPDATE accounts SET slots=? WHERE id=?', JSON.stringify(r.slots), a.id);
  return r;
}));
// Ask AutoCast: step 1 = plan (nothing changes). Step 2 = /api/ai/run with the plan the user confirmed.
app.post('/api/ai/ask', wrap(req => { if (!String(req.body.q || '').trim()) throw bad('Type a request'); return aiFx.ask(String(req.body.q).slice(0, 1000)); }));
app.post('/api/ai/run', wrap(async req => {
  const a = req.body.action || {};
  if (a.type === 'create_post') {
    const id = scheduler.createPost({ media_id: Number(a.media_id), title: String(a.title || ''), body: String(a.body || ''), account_ids: (a.account_ids || []).map(Number), when: scheduler.parseWhen(a.when || 'slot'), options: {} });
    return { done: `Post #${id} made`, go: 'upload/posts' };
  }
  if (a.type === 'start_station' || a.type === 'stop_station') {
    const s = get('SELECT * FROM stations WHERE id=?', Number(a.id)); if (!s) throw bad('Station not found');
    if (a.type === 'stop_station') { run('UPDATE stations SET want_on=0 WHERE id=?', s.id); engine.stop(s.id); return { done: `Stopped ${s.name}`, go: 'live/stations' }; }
    if (!get('SELECT COUNT(*) n FROM destinations WHERE station_id=? AND enabled=1', s.id).n) throw bad('That station has no destinations');
    const c = engine.conflicts(s.id); if (c.length) throw bad(`${c[0].account} is already live on "${c[0].station}"`);
    run('UPDATE stations SET want_on=1 WHERE id=?', s.id); engine.start(s.id).catch(() => {});
    return { done: `Starting ${s.name}`, go: `live/control?id=${s.id}` };
  }
  throw bad('Nothing to do');
}));

// ------------------------------------------------------------------ cleanup (daily)
function cleanup() {
  const days = setting('retention_days', 30);
  if (!days) return;
  const cutoff = Date.now() - days * 864e5;
  for (const m of all("SELECT m.id FROM media m WHERE m.created_at < ? AND m.source != 'import' AND NOT EXISTS (SELECT 1 FROM playlist_items pi WHERE pi.media_id=m.id) AND NOT EXISTS (SELECT 1 FROM posts p JOIN post_targets t ON t.post_id=p.id WHERE p.media_id=m.id AND t.status IN ('queued','running'))", cutoff)) {
    media.removeMedia(m.id);
  }
}
setInterval(cleanup, 6 * 3600e3).unref();

// ------------------------------------------------------------------ UI
app.use(express.static(path.join(__dirname, 'public'), { index: 'index.html', maxAge: 0 }));
app.use((err, req, res, next) => res.status(400).json({ error: err.message }));

function startServer(port = cfg.PORT, host = cfg.HOST) {
  return new Promise(resolve => {
    const srv = app.listen(port, host, () => {
      srv.keepAliveTimeout = 65000; srv.headersTimeout = 66000;   // longer than proxy idle timeouts
      srv.requestTimeout = 0;                                       // big uploads can take long
      console.log(`AutoCast on http://${host}:${srv.address().port}  data=${cfg.DATA}`);
      scheduler.boot(); engine.boot();
      resolve(srv);
    });
  });
}
if (require.main === module) {
  startServer();
  const bye = () => { engine.shutdown(); scheduler.shutdown(); setTimeout(() => process.exit(0), 500); };
  process.on('SIGINT', bye); process.on('SIGTERM', bye);
}
module.exports = { app, startServer };
