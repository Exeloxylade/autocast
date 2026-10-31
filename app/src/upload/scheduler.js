// Auto Upload engine: sends due post targets, retries, and runs folder autopilot rules.
const fs = require('fs');
const path = require('path');
const { all, get, run, event, setting } = require('../db');
const { TICK_MS, PUBLIC_URL } = require('../config');
const accounts = require('../accounts');
const connectors = require('./connectors');
const media = require('../media');
const notify = require('../notify');
const { sign } = require('../crypto');

const aiClient = require('../ai/client');
const aiFx = () => require('../ai/features');      // lazy: features needs media + db ready
const safetyCache = new Map();
const RETRY_S = [60, 300, 900];      // wait after try 1, 2, 3
const MAX_TRIES = 3;
const PARALLEL = Number(process.env.UPLOAD_PARALLEL || 2);
let running = 0;

// ------------------------------------------------------------ free slots
function parseSlots(a) { try { return JSON.parse(a.slots || '[]').filter(s => /^\d\d:\d\d$/.test(s)).sort(); } catch { return []; } }
function nextSlot(accountId, after = Date.now() + 2 * 60 * 1000, taken = new Set()) {
  const a = get('SELECT * FROM accounts WHERE id=?', accountId);
  const slots = parseSlots(a || {});
  if (!slots.length) return after;
  const rows = all("SELECT run_at FROM post_targets WHERE account_id=? AND status IN ('queued','running','done') AND run_at>=?", accountId, after - 86400000).map(r => r.run_at);
  const busy = new Set(rows);
  for (const t of taken) busy.add(t);
  const max = Number(a?.daily_max || 0);
  const perDay = new Map();
  for (const t of [...rows, ...taken]) { const k = new Date(t).toDateString(); perDay.set(k, (perDay.get(k) || 0) + 1); }
  const d = new Date(after);
  for (let day = 0; day < 90; day++) {
    const dayKey = new Date(d.getFullYear(), d.getMonth(), d.getDate() + day).toDateString();
    if (max && (perDay.get(dayKey) || 0) >= max) continue;          // daily limit reached
    for (const s of slots) {
      const [h, m] = s.split(':').map(Number);
      const t = new Date(d.getFullYear(), d.getMonth(), d.getDate() + day, h, m, 0, 0).getTime();
      if (t >= after && !busy.has(t)) return t;
    }
  }
  return after;
}

// ------------------------------------------------------------ create
// when: 'now' | 'slot' | epoch ms
function createPost({ media_id, title, body, per_app, options, account_ids, when, rule_id }) {
  if (!get('SELECT id FROM media WHERE id=?', media_id)) throw new Error('Pick a video first');
  const ids = [...new Set((account_ids || []).map(Number))];
  if (!ids.length) throw new Error('Pick at least one account');
  const dupDays = Number(setting('dup_days', 7));
  for (const id of ids) {
    const a = get('SELECT * FROM accounts WHERE id=?', id);
    if (!a) throw new Error(`Account ${id} not found`);
    if (!a.can_upload) throw new Error(`${a.name} can't post videos (live only)`);
    // Duplicate guard: same video to the same account again within N days looks like spam.
    if (dupDays > 0 && !options?.allowDuplicate) {
      const dup = get(`SELECT t.run_at FROM post_targets t JOIN posts p ON p.id=t.post_id WHERE p.media_id=? AND t.account_id=? AND t.status IN ('queued','running','done') AND t.run_at > ?`, media_id, id, Date.now() - dupDays * 864e5);
      if (dup) throw Object.assign(new Error(`This video already goes to ${a.name} (${new Date(dup.run_at).toLocaleDateString()}). Tick "allow repeat" to post again.`), { code: 'DUP' });
    }
    // "Post now" also respects the daily limit.
    if (a.daily_max && (when === 'now' || when == null)) {
      const today = get("SELECT COUNT(*) n FROM post_targets WHERE account_id=? AND status IN ('queued','running','done') AND run_at BETWEEN ? AND ?", id, new Date().setHours(0, 0, 0, 0), new Date().setHours(23, 59, 59, 999)).n;
      if (today >= a.daily_max) throw new Error(`${a.name} hit its limit of ${a.daily_max} posts today. Use "Next free slot".`);
    }
  }
  const r = run('INSERT INTO posts(media_id,title,body,per_app,options,rule_id,created_at) VALUES(?,?,?,?,?,?,?)',
    media_id, title || '', body || '', JSON.stringify(per_app || {}), JSON.stringify(options || {}), rule_id || null, Date.now());
  const postId = Number(r.lastInsertRowid);
  const now = Date.now();
  const rDays = Math.max(0, Number(options?.repeatDays || 0));
  const rLeft = rDays ? Math.max(0, Math.min(52, Number(options?.repeatTimes || 0))) : 0;
  for (const id of ids) {
    const at = when === 'now' || when == null ? now : when === 'slot' ? nextSlot(id) : Math.max(now, Number(when));
    run('INSERT INTO post_targets(post_id,account_id,run_at,repeat_days,repeat_left) VALUES(?,?,?,?,?)', postId, id, at, rDays, rLeft);
  }
  event('upload', 'info', `post #${postId} queued to ${ids.length} account(s)`, postId);
  return postId;
}

// ------------------------------------------------------------ send
const VERTICAL_APPS = new Set(['tiktok', 'instagram']);
const wantsVertical = a => a.fmt === 'vertical' || (a.fmt !== 'original' && VERTICAL_APPS.has(a.platform));
async function jobFor(t) {
  const p = get('SELECT * FROM posts WHERE id=?', t.post_id);
  const m = p.media_id ? get('SELECT * FROM media WHERE id=?', p.media_id) : null;
  if (!m || !fs.existsSync(m.file)) throw new Error('Video file is missing');
  const a = get('SELECT * FROM accounts WHERE id=?', t.account_id);
  // Wide video to a vertical app: send a 9:16 version with a blurred background.
  const file = wantsVertical(a) && m.width > m.height ? await media.verticalVariant(m.id) : m.file;
  const per = JSON.parse(p.per_app || '{}')[a.platform] || {};
  const title = per.title ?? p.title ?? '';
  const body = per.body ?? p.body ?? '';
  const tags = [...new Set((`${title} ${body}`.match(/#[\p{L}\p{N}_]+/gu) || []).map(x => x.slice(1)))].slice(0, 30);
  const publicUrl = PUBLIC_URL ? `${PUBLIC_URL}/pub/${encodeURIComponent(sign(`${m.id}:${Date.now() + 3600e3}`))}` : null;
  const thumb = path.join(require('../config').DATA, 'thumbs_ai', `${m.id}.jpg`);
  return { a, p, job: { file, title, body, tags, options: JSON.parse(p.options || '{}'), publicUrl, thumbnail: fs.existsSync(thumb) ? thumb : null } };
}

async function sendOne(t) {
  running++;
  run("UPDATE post_targets SET status='running', attempts=attempts+1 WHERE id=?", t.id);
  let a;
  try {
    a = get('SELECT * FROM accounts WHERE id=?', t.account_id);
    const x = await jobFor(t); a = x.a;
    const c = connectors[a.platform];
    if (!c?.upload) throw new Error(`${a.platform} has no posting API`);
    // AI safety check (once per post + app; cached so retries don't pay again).
    const mode = setting('ai_safety', 'off');
    if (mode !== 'off' && aiClient.ready()) {
      const key = `${t.post_id}:${a.platform}`;
      let verdict = safetyCache.get(key);
      if (!verdict) {
        try { verdict = await aiFx().safetyCheck({ title: x.job.title, body: x.job.body, platform: a.platform }); safetyCache.set(key, verdict); }
        catch (e) { event('ai', 'warn', `safety check skipped: ${e.message}`, t.post_id); }
      }
      if (verdict && !verdict.ok) {
        const why = `AI safety check: ${verdict.issues.join('; ') || 'risky text'}`;
        if (mode === 'block') throw Object.assign(new Error(why + '. Edit the text, or set safety to "warn".'), { noRetry: true });
        event('upload', 'warn', `post #${t.post_id} -> ${a.name}: ${why} (sending anyway, mode=warn)`, t.post_id);
      }
    }
    const s = await accounts.ensure(a);
    const res = await c.upload(a, s, x.job);
    run("UPDATE post_targets SET status='done', url=?, error=?, done_at=? WHERE id=?", res.url || '', res.note || '', Date.now(), t.id);
    event('upload', 'info', `post #${t.post_id} -> ${a.name}: done ${res.url || ''}`, t.post_id);
    // Repeat post (evergreen): queue the next one.
    if (t.repeat_left > 0 && t.repeat_days > 0) {
      const next = t.run_at + t.repeat_days * 864e5;
      run('INSERT INTO post_targets(post_id,account_id,run_at,repeat_days,repeat_left) VALUES(?,?,?,?,?)', t.post_id, t.account_id, Math.max(next, Date.now() + 1000), t.repeat_days, t.repeat_left - 1);
      event('upload', 'info', `post #${t.post_id} -> ${a.name}: repeat queued for ${new Date(next).toLocaleString()} (${t.repeat_left - 1} left)`, t.post_id);
    }
  } catch (e) {
    const cur = get('SELECT attempts FROM post_targets WHERE id=?', t.id);
    const tries = cur?.attempts || 1;
    const auth = e.noRetry || /log in again|expired|invalid_grant|OAuthException|401/i.test(e.message);
    if (tries < MAX_TRIES && !auth) {
      const wait = RETRY_S[tries - 1] * 1000 * (Number(process.env.RETRY_SCALE || 1));
      run("UPDATE post_targets SET status='queued', next_try=?, error=? WHERE id=?", Date.now() + wait, e.message.slice(0, 500), t.id);
      event('upload', 'warn', `post #${t.post_id} -> ${a?.name || t.account_id}: try ${tries} failed, retry in ${Math.round(wait / 1000)}s: ${e.message}`, t.post_id);
    } else {
      run("UPDATE post_targets SET status='failed', error=?, done_at=? WHERE id=?", e.message.slice(0, 500), Date.now(), t.id);
      event('upload', 'error', `post #${t.post_id} -> ${a?.name || t.account_id}: failed: ${e.message}`, t.post_id);
      notify.send('post', `post to ${a?.name || 'account'} failed: ${e.message}`);
    }
  } finally { running--; }
}

function tickSend() {
  const now = Date.now();
  const due = all(`SELECT * FROM post_targets WHERE status='queued' AND run_at<=? AND (next_try IS NULL OR next_try<=?) ORDER BY run_at LIMIT ?`, now, now, Math.max(0, PARALLEL - running));
  for (const t of due) sendOne(t);
}

// ------------------------------------------------------------ autopilot rules
const pretty = n => path.basename(n, path.extname(n)).replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim().replace(/^./, c => c.toUpperCase());
function fill(tpl, vars) { return String(tpl || '').replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? ''); }

async function tickRules() {
  for (const r of all('SELECT * FROM rules WHERE enabled=1')) {
    if (!r.folder || !fs.existsSync(r.folder)) continue;
    let seen; try { seen = new Set(JSON.parse(r.seen || '[]')); } catch { seen = new Set(); }
    let files; try { files = fs.readdirSync(r.folder).filter(f => media.VIDEO_EXT.test(f)); } catch { continue; }
    for (const f of files) {
      const full = path.join(r.folder, f);
      let st; try { st = fs.statSync(full); } catch { continue; }
      const key = `${f}|${st.size}`;
      if (seen.has(key)) continue;
      if (Date.now() - st.mtimeMs < 10000) continue;            // still being written
      seen.add(key);
      run('UPDATE rules SET seen=? WHERE id=?', JSON.stringify([...seen].slice(-2000)), r.id);
      try {
        const m = await media.addFile(full, f, 'rule');
        // Sidecar from the video maker: same name + .json with {title, description, tags}
        let side = {};
        for (const sc of [full.replace(/\.[^.]+$/, '.json'), full + '.json']) if (fs.existsSync(sc)) { try { side = JSON.parse(fs.readFileSync(sc, 'utf8')); } catch {} break; }
        const opts = JSON.parse(r.options || '{}');
        // No sidecar text? Let AI write it (if the rule asks for it).
        let perApp = {};
        if (opts.aiWrite && !side.title && aiClient.ready()) {
          try {
            const plats = all(`SELECT DISTINCT platform FROM accounts WHERE id IN (${JSON.parse(r.account_ids || '[]').map(Number).join(',') || 0})`).map(x => x.platform);
            const w = await aiFx().writePost(m.id, { platforms: plats });
            side = { title: w.title, description: w.description, tags: w.hashtags };
            perApp = w.per_app;
          } catch (e) { event('ai', 'warn', `rule "${r.name}": AI writing failed, using file name: ${e.message}`, r.id); }
        }
        if (opts.aiThumb && aiClient.ready()) aiFx().aiThumbnail(m.id).catch(e => event('ai', 'warn', `AI thumbnail: ${e.message}`, m.id));
        const vars = { name: pretty(f), file: f, date: new Date().toISOString().slice(0, 10), title: side.title || pretty(f), description: side.description || '', tags: (side.tags || []).map(t => '#' + String(t).replace(/^#/, '')).join(' ') };
        createPost({
          media_id: m.id, title: fill(r.title_tpl || '{title}', vars).slice(0, 100), body: fill(r.body_tpl || '{description}\n\n{tags}', vars).trim(),
          options: opts, account_ids: JSON.parse(r.account_ids || '[]'), when: opts.when === 'now' ? 'now' : 'slot', rule_id: r.id, per_app: perApp,
        });
        run('UPDATE rules SET runs=runs+1, last_run=? WHERE id=?', Date.now(), r.id);
        event('upload', 'info', `rule "${r.name}": new video ${f}`, r.id);
      } catch (e) { event('upload', 'error', `rule "${r.name}": ${f}: ${e.message}`, r.id); }
    }
  }
}

// ------------------------------------------------------------ bulk CSV import
// Columns: file,title,description,accounts,when[,repeat_days,repeat_times]
//   file      server path, or #<media id>
//   accounts  names / ids / group:<name>, split by | or ;
//   when      now | slot | 2026-11-05 18:30
function parseCSV(text) {
  const rows = []; let row = [], cell = '', q = false;
  const s = String(text || '').replace(/^\uFEFF/, '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) { if (c === '"' && s[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && s[i + 1] === '\n') i++; row.push(cell); cell = ''; if (row.some(x => x.trim())) rows.push(row); row = []; }
    else cell += c;
  }
  row.push(cell); if (row.some(x => x.trim())) rows.push(row);
  if (!rows.length) return [];
  const head = rows[0].map(h => h.trim().toLowerCase());
  return rows.slice(1).map(r => Object.fromEntries(head.map((h, i) => [h, (r[i] || '').trim()])));
}
// "12 | Ahmad Finance | group:Games" -> [ids]
function resolveAccounts(str, accs = all('SELECT * FROM accounts WHERE can_upload=1')) {
  const ids = new Set();
  for (const tok of String(str || '').split(/[|;,]/).map(x => x.trim()).filter(Boolean)) {
    if (/^group:/i.test(tok)) {
      const g = tok.slice(6).trim().toLowerCase();
      const hit = accs.filter(a => (a.grp || '').toLowerCase() === g);
      if (!hit.length) throw new Error(`no accounts in group: ${tok.slice(6).trim()}`);
      hit.forEach(a => ids.add(a.id)); continue;
    }
    const a = accs.find(a => String(a.id) === tok || a.name.toLowerCase() === tok.toLowerCase());
    if (!a) throw new Error(`account not found: ${tok}`);
    ids.add(a.id);
  }
  return [...ids];
}
function parseWhen(w) {
  const s = String(w || 'slot').trim().toLowerCase();
  if (s === 'now' || s === 'slot') return s;
  const t = new Date(String(w).trim().replace(' ', 'T')).getTime();
  if (!t) throw new Error(`bad time: ${w}`);
  return t;
}
async function importCSV(text) {
  const rows = parseCSV(text);
  if (!rows.length) throw new Error('CSV is empty. First line must be: file,title,description,accounts,when');
  const accs = all('SELECT * FROM accounts WHERE can_upload=1');
  const out = { created: [], errors: [] };
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i], line = i + 2;
    try {
      let mediaId;
      if (/^#\d+$/.test(r.file)) mediaId = Number(r.file.slice(1));
      else {
        const p = path.resolve(r.file || '');
        if (!r.file || !fs.existsSync(p)) throw new Error(`file not found: ${r.file}`);
        const ex = get('SELECT id FROM media WHERE file=?', p);
        mediaId = ex ? ex.id : (await media.addFile(p, path.basename(p), 'csv')).id;
      }
      out.created.push(createPost({ media_id: mediaId, title: r.title, body: r.description, account_ids: resolveAccounts(r.accounts, accs), when: parseWhen(r.when), options: { repeatDays: Number(r.repeat_days || 0), repeatTimes: Number(r.repeat_times || 0), allowDuplicate: /^(1|yes|true)$/i.test(r.allow_repeat || '') } }));
    } catch (e) { out.errors.push({ line, error: e.message }); }
  }
  event('upload', 'info', `CSV import: ${out.created.length} posts, ${out.errors.length} errors`);
  return out;
}

// ------------------------------------------------------------ token health (hourly)
async function tickTokens() {
  for (const a of all("SELECT * FROM accounts WHERE kind='oauth' AND expires_at IS NOT NULL AND expires_at < ?", Date.now() + 30 * 60 * 1000)) {
    try { await accounts.ensure(a); } catch {}
  }
}

let timers = [];
function boot() {
  if (timers.length) return;
  run("UPDATE post_targets SET status='queued' WHERE status='running'");    // crash recovery
  timers.push(setInterval(tickSend, TICK_MS));
  timers.push(setInterval(() => tickRules().catch(e => event('upload', 'error', e.message)), Math.max(TICK_MS, 10000)));
  timers.push(setInterval(() => tickTokens().catch(() => {}), 3600e3));
  // Daily AI digest at the chosen hour (-1 = off), sent to Telegram.
  timers.push(setInterval(async () => {
    const h = Number(setting('ai_digest_hour', -1));
    if (h < 0 || new Date().getHours() !== h || !aiClient.ready()) return;
    const last = setting('ai_last_digest', null);
    if (last && new Date(last.at).toDateString() === new Date().toDateString()) return;
    try { const d = await aiFx().digest(); notify.send('digest', `${d.headline}\n\n${d.text}`); } catch (e) { event('ai', 'warn', `digest failed: ${e.message}`); }
  }, 60000));
  setTimeout(tickSend, 300);
}
function shutdown() { timers.forEach(clearInterval); timers = []; }

module.exports = { boot, shutdown, createPost, nextSlot, tickSend, tickRules, importCSV, parseCSV, resolveAccounts, parseWhen, running: () => running };
