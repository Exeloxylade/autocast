// Auto Live engine.
//
//   playlist (prepared files) -> ENCODER (ffmpeg -c copy, loops forever) -> RELAY (MediaMTX)
//                                                                          -> PUSHER per destination (ffmpeg -c copy)
//
// The encoder never re-encodes: files are prepared once (see media.js), so CPU stays low.
// Each pusher is its own process. One bad destination retries alone and never drops the others.
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { FFMPEG, RELAY_URL, DATA, TICK_MS, FONT_FILE } = require('../config');
const { setting, setSetting } = require('../db');
const { all, get, run, event } = require('../db');
const media = require('../media');
const { open } = require('../crypto');
const connectors = require('../upload/connectors');
const accounts = require('../accounts');
const notify = require('../notify');

const BACKOFF = [2, 4, 8, 15, 30];          // seconds between pusher retries
const state = new Map();                      // stationId -> runtime

const relayPath = id => `${RELAY_URL}/st${id}`;
const listFile = id => path.join(DATA, 'playlists', `station_${id}.ffconcat`);
const snapFile = id => path.join(DATA, 'snapshots', `st${id}.jpg`);
const esc = p => p.replace(/\\/g, '/').replace(/'/g, "'\\''");

function parseProgress(chunk, s) {
  for (const line of String(chunk).split('\n')) {
    const [k, v] = line.trim().split('=');
    if (k === 'out_time_us' || k === 'out_time_ms') { const us = Number(v); if (us > 0) s.outUs = us; }
    else if (k === 'total_size') { const n = Number(v); if (Number.isFinite(n) && n > 0) s.bytes = n; }
    else if (k === 'speed') s.speed = parseFloat(v) || 0;
    else if (k === 'progress') {
      const now = Date.now();
      s.beat = now;
      if (!s.lastAt) { s.lastAt = now; s.lastBytes = s.bytes; continue; }
      const dt = (now - s.lastAt) / 1000;
      if (dt < 0.8) continue;                          // two lines in one chunk: wait for a real gap
      if (s.bytes >= s.lastBytes) {
        const kbps = ((s.bytes - s.lastBytes) * 8) / dt / 1000;
        if (Number.isFinite(kbps)) s.kbps = s.kbps ? s.kbps * 0.6 + kbps * 0.4 : kbps;
      }
      s.lastAt = now; s.lastBytes = s.bytes;
    }
  }
}

function proc(args, label, onExit) {
  const p = spawn(FFMPEG, args, { windowsHide: true });
  const s = { outUs: 0, bytes: 0, kbps: 0, speed: 0, beat: Date.now(), lastAt: 0, lastBytes: 0, err: [] };
  p.stdout.on('data', d => parseProgress(d, s));
  p.stderr.on('data', d => { for (const l of String(d).split(/\r?\n/)) if (l.trim()) { s.err.push(l.trim()); if (s.err.length > 20) s.err.shift(); } });
  p.on('error', e => s.err.push(e.message));
  p.on('close', code => onExit(code, s));
  p.stats = s;
  p.label = label;
  return p;
}
const kill = p => { if (p && p.exitCode === null) { try { p.stdin?.end(); } catch {} p.kill('SIGTERM'); setTimeout(() => { if (p.exitCode === null) p.kill('SIGKILL'); }, 3000); } };

// ---------------------------------------------------------------- playlist
const durCache = new Map();
async function videoDur(f) {
  const k = `${f}|${fs.statSync(f).mtimeMs}`;
  if (durCache.has(k)) return durCache.get(k);
  const out = await media.sh(require('../config').FFPROBE, ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=duration', '-of', 'csv=p=0', f]);
  const d = Number(String(out).trim()) || 0;
  durCache.set(k, d);
  return d;
}
async function buildList(st, rt) {
  const items = all(`SELECT m.* FROM playlist_items pi JOIN media m ON m.id=pi.media_id
                     WHERE pi.playlist_id=? ORDER BY pi.pos, pi.id`, st.playlist_id || 0);
  const pl = st.playlist_id ? get('SELECT * FROM playlists WHERE id=?', st.playlist_id) : null;
  let list = items;
  if (pl?.shuffle) list = [...items].sort(() => Math.random() - 0.5);
  const ready = [];
  for (const m of list) {
    rt.note = `Preparing ${m.name}…`;
    try { const f = await media.prepare(m.id, st.profile); ready.push({ m, f, d: await videoDur(f) }); }
    catch (e) { event('live', 'warn', `skip ${m.name}: ${e.message}`, st.id); }
  }
  rt.note = '';
  if (!ready.length) throw new Error('Playlist has no playable videos');
  // outpoint = exact video end. Audio is usually one AAC frame longer; without this
  // the next file's audio would overlap and break timestamps at every join.
  const body = 'ffconcat version 1.0\n' + ready.map(r => `file '${esc(r.f)}'\noutpoint ${r.d.toFixed(6)}\n`).join('');
  fs.writeFileSync(listFile(st.id), body);
  rt.items = ready.map(r => ({ id: r.m.id, name: r.m.name, duration: r.d, thumb: r.m.thumb ? `/files/thumbs/${r.m.id}.jpg` : null }));
  rt.loopLen = ready.reduce((a, r) => a + r.d, 0);
}

// ---------------------------------------------------------------- overlay + music
const logoFile = id => path.join(DATA, 'logos', `station_${id}.png`);
const textFile = id => path.join(DATA, 'playlists', `overlay_${id}.txt`);
const musicList = id => path.join(DATA, 'playlists', `music_${id}.ffconcat`);
const fesc = p => p.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'");   // path inside a filter option
function overlayOf(st) { try { return { enabled: false, text: '', clock: false, logo: false, aiMode: 'off', aiPrompt: '', aiEvery: 5, ...JSON.parse(st.overlay || '{}') }; } catch { return { enabled: false }; } }
const aiOn = o => o.aiMode === 'ticker' || o.aiMode === 'nowplaying';
function overlayActive(st) { const o = overlayOf(st); return !!(o.enabled && (o.text || aiOn(o) || o.clock || (o.logo && fs.existsSync(logoFile(st.id))))); }
// Text is read from a file every frame (reload=1), so editing it never restarts the stream.
const lastText = new Map();
function writeOverlayText(st, rt) {
  const o = overlayOf(st);
  const ai = aiOn(o) && rt?.aiLine ? rt.aiLine : '';
  const t = String([o.text, ai].filter(Boolean).join('  ·  ') || ' ').replace(/\r/g, '').slice(0, 200);
  if (lastText.get(st.id) === t && fs.existsSync(textFile(st.id))) return;
  fs.writeFileSync(textFile(st.id) + '.tmp', t);
  fs.renameSync(textFile(st.id) + '.tmp', textFile(st.id));           // swap in one step: never a half file
  lastText.set(st.id, t);
}

async function buildMusic(st, rt) {
  rt.music = null;
  if (!st.music_playlist_id) return;
  const items = all('SELECT m.* FROM playlist_items pi JOIN media m ON m.id=pi.media_id WHERE pi.playlist_id=? ORDER BY pi.pos, pi.id', st.music_playlist_id);
  const ready = [];
  for (const m of items) { try { ready.push(await media.prepare(m.id, st.profile)); } catch {} }
  if (!ready.length) return;
  fs.writeFileSync(musicList(st.id), 'ffconcat version 1.0\n' + ready.map(f => `file '${esc(f)}'\n`).join(''));
  rt.music = musicList(st.id);
}

function encoderArgs(st, rt) {
  const P = media.PROFILES[st.profile] || media.PROFILES['1080p30'];
  const o = overlayOf(st);
  const ov = overlayActive(st);
  const logo = ov && o.logo && fs.existsSync(logoFile(st.id));
  const args = ['-hide_banner', '-v', 'warning', '-nostats', '-progress', 'pipe:1',
    '-re', '-stream_loop', '-1', '-f', 'concat', '-safe', '0', '-i', listFile(st.id)];
  let n = 1, mi = -1, li = -1;
  if (rt.music) { args.push('-stream_loop', '-1', '-f', 'concat', '-safe', '0', '-i', rt.music); mi = n++; }
  // Loop the logo as a 1 fps stream. A single-frame input "ends" and can drop off a 24/7 stream.
  // The logo is looped inside the filter (movie + loop). An image input either "ends"
  // or runs ahead of the -re video; both made the logo vanish in tests.
  const f = [];
  let vout = '0:v:0';
  if (ov) {
    let cur = '[0:v]';
    if (logo) { f.push(`movie='${fesc(logoFile(st.id))}',loop=loop=-1:size=1:start=0,setpts=N/${P.fps}/TB,scale=-1:${Math.round(P.h * 0.11)},format=rgba,colorchannelmixer=aa=0.92[lg]`, `${cur}[lg]overlay=W-w-${Math.round(P.w * 0.025)}:${Math.round(P.h * 0.04)}:shortest=0[v1]`); cur = '[v1]'; }
    const font = `fontfile='${fesc(FONT_FILE)}'`;
    const dt = [];
    if (o.text || aiOn(o)) { writeOverlayText(st, rt); dt.push(`drawtext=${font}:textfile='${fesc(textFile(st.id))}':reload=1:fontcolor=white:fontsize=${Math.round(P.h * 0.04)}:box=1:boxcolor=black@0.5:boxborderw=${Math.round(P.h * 0.015)}:x=${Math.round(P.w * 0.025)}:y=h-th-${Math.round(P.h * 0.05)}`); }
    if (o.clock) dt.push(`drawtext=${font}:text='%{localtime\\:%H\\\\\\:%M}':fontcolor=white:fontsize=${Math.round(P.h * 0.035)}:box=1:boxcolor=black@0.45:boxborderw=${Math.round(P.h * 0.012)}:x=${Math.round(P.w * 0.025)}:y=${Math.round(P.h * 0.04)}`);
    f.push(`${cur}${dt.length ? dt.join(',') + ',' : ''}format=yuv420p[v]`);
    vout = '[v]';
  }
  // Audio is always re-encoded (cheap). aresample async smooths the joins between files.
  if (mi >= 0) f.push(`[0:a]volume=1.0[a0]`, `[${mi}:a]volume=${Math.max(0, Math.min(1, Number(st.music_volume ?? 0.25))).toFixed(2)}[a1]`, `[a0][a1]amix=inputs=2:duration=first:dropout_transition=0:normalize=0,aresample=async=1000:first_pts=0[a]`);
  else f.push('[0:a]aresample=async=1000:first_pts=0[a]');
  args.push('-filter_complex', f.join(';'), '-map', vout, '-map', '[a]');
  if (ov) args.push('-c:v', 'libx264', '-preset', 'veryfast', '-tune', 'zerolatency', '-bf', '0', '-b:v', `${P.vb}k`, '-maxrate', `${P.vb}k`, '-bufsize', `${P.vb * 2}k`, '-g', String(P.fps * 2), '-keyint_min', String(P.fps * 2), '-sc_threshold', '0', '-r', String(P.fps));
  else args.push('-c:v', 'copy');                       // no overlay: zero video CPU
  args.push('-c:a', 'aac', '-b:a', `${P.ab}k`, '-ar', '44100', '-ac', '2', '-flvflags', 'no_duration_filesize', '-f', 'flv', relayPath(st.id));
  return args;
}

// ---------------------------------------------------------------- encoder
function startEncoder(st, rt) {
  st = get('SELECT * FROM stations WHERE id=?', st.id) || st;     // fresh overlay/music settings
  const args = encoderArgs(st, rt);
  rt.overlayOn = overlayActive(st);
  rt.musicOn = !!rt.music;
  // Only ONE encoder may publish to the relay. Two would kick each other off forever,
  // so an old encoder's exit never starts a new one if another is already running.
  const me = proc(args, 'encoder', (code, s) => {
    if (rt.encoder !== me) return;                  // replaced by a reload: not our job
    rt.encoder = null;
    if (rt.stopping) return;
    rt.encErrors = (rt.encErrors || 0) + 1;
    event('live', 'warn', `encoder exited (${code}): ${s.err.slice(-2).join(' | ')}`, st.id);
    rt.lastError = s.err.slice(-1)[0] || `encoder exit ${code}`;
    clearTimeout(rt.encTimer);
    rt.encTimer = setTimeout(() => { if (!rt.stopping && state.get(st.id) === rt && !rt.encoder) startEncoder(st, rt); }, 2000);
  });
  clearTimeout(rt.encTimer);
  rt.encoder = me;
  rt.encStartedAt = Date.now();
}

// ---------------------------------------------------------------- pushers
async function destUrl(d, st, rt) {
  const acc = get('SELECT * FROM accounts WHERE id=?', d.account_id);
  if (!acc) throw new Error('account removed');
  if (acc.kind === 'stream_key' || acc.kind === 'mock') {
    const s = open(acc.secret) || {};
    if (!s.server) throw new Error('no RTMP server set');
    return s.key ? `${s.server.replace(/\/$/, '')}/${s.key}` : s.server;
  }
  if (acc.kind === 'oauth' && connectors[acc.platform]?.liveIngest) {
    // Login-based live (YouTube, Facebook): make a broadcast through the API, get its ingest URL.
    const s = await accounts.ensure(acc);
    return connectors[acc.platform].liveIngest(acc, { title: st.name, rt, s, save: ns => accounts.saveSecret(acc.id, ns) });
  }
  throw new Error(`${acc.platform} live needs a stream key`);
}

// Turn ffmpeg's last lines into a short reason. Never show stream keys.
function friendly(lines, code) {
  const all = lines.join(' ');
  const hide = t => t.replace(/(rtmps?:\/\/[^\s/]+\/[^\s/]+\/)[^\s'"]+/g, '$1••••');
  if (/-138|refused|-10061|Connection refused/i.test(all)) return "Can't reach the server. Check the server URL.";
  if (/-10060|timed out|Operation timed out/i.test(all)) return 'Server did not answer (timeout).';
  if (/403|Forbidden|unauthori[sz]ed|-1094995529|Invalid data found/i.test(all) && /output/i.test(all)) return 'Server refused the stream. Check the stream key.';
  if (/Input\/output error|I\/O error/i.test(all) && /input/i.test(all)) return 'Lost the source for a moment.';
  if (/Input\/output error|I\/O error|Broken pipe|-10054|-32/i.test(all)) return 'Connection dropped.';
  if (code === null) return 'Restarted (stalled).';
  return hide(lines.slice(-1)[0] || `ffmpeg exit ${code}`).slice(0, 200);
}

function startPusher(st, rt, d) {
  const ps = rt.pushers.get(d.id) || { id: d.id, label: d.label, tries: 0, status: 'connecting', since: Date.now() };
  rt.pushers.set(d.id, ps);
  ps.status = ps.tries ? 'retrying' : 'connecting';
  (ps.url ? Promise.resolve(ps.url) : destUrl(d, st, rt)).then(url => {
    if (rt.stopping) return;
    ps.url = url;
    const args = ['-hide_banner', '-v', 'warning', '-nostats', '-progress', 'pipe:1',
      '-rw_timeout', '15000000', '-i', relayPath(st.id), '-map', '0', '-c', 'copy',
      '-flvflags', 'no_duration_filesize', '-f', 'flv', url];
    ps.p = proc(args, `dest ${d.id}`, (code, s) => {
      ps.p = null;
      if (rt.stopping || !rt.pushers.has(d.id)) return;
      ps.tries++;
      ps.drops = (ps.drops || 0) + 1;
      ps.status = 'retrying';
      ps.error = friendly(s.err, code);
      const wait = BACKOFF[Math.min(ps.tries - 1, BACKOFF.length - 1)];
      ps.nextTry = Date.now() + wait * 1000;
      event('live', 'warn', `${d.label}: dropped, retry in ${wait}s (${ps.error})`, st.id);
      if (ps.tries === 3) notify.send('live', `${st.name} → ${d.label} keeps dropping: ${ps.error}`);
      ps.timer = setTimeout(() => { if (!rt.stopping && rt.pushers.has(d.id)) startPusher(st, rt, d); }, wait * 1000);
    });
  }).catch(e => {
    ps.status = 'error'; ps.error = e.message; ps.tries++;
    event('live', 'error', `${d.label}: ${e.message}`, st.id);
    const wait = 30;
    ps.nextTry = Date.now() + wait * 1000;
    ps.timer = setTimeout(() => { if (!rt.stopping && rt.pushers.has(d.id)) startPusher(st, rt, d); }, wait * 1000);
  });
}

function syncPushers(st, rt) {
  const want = all('SELECT * FROM destinations WHERE station_id=? AND enabled=1', st.id);
  const ids = new Set(want.map(d => d.id));
  for (const [id, ps] of rt.pushers) if (!ids.has(id)) { clearTimeout(ps.timer); kill(ps.p); rt.pushers.delete(id); }
  for (const d of want) if (!rt.pushers.has(d.id)) startPusher(st, rt, d);
}

// ---------------------------------------------------------------- station lifecycle
const lastConflict = new Map();
function conflicts(id, accountIds) {
  const mine = accountIds || all('SELECT account_id FROM destinations WHERE station_id=? AND enabled=1', id).map(r => r.account_id);
  if (!mine.length) return [];
  const out = [];
  for (const other of state.keys()) {
    if (other === id) continue;
    for (const r of all(`SELECT d.account_id, a.name account, s.name station FROM destinations d JOIN accounts a ON a.id=d.account_id JOIN stations s ON s.id=d.station_id
                         WHERE d.station_id=? AND d.enabled=1`, other)) if (mine.includes(r.account_id)) out.push(r);
  }
  return out;
}
async function start(id) {
  if (state.has(id)) return;
  const st = get('SELECT * FROM stations WHERE id=?', id);
  if (!st) throw new Error('station not found');
  // One account = one stream key. Two stations on the same key kick each other off.
  const busy = conflicts(id);
  if (busy.length) {
    const msg = `${busy[0].account} is already live on "${busy[0].station}". Turn it off there first.`;
    if (lastConflict.get(id) !== msg) { event('live', 'error', msg, id); lastConflict.set(id, msg); }
    throw new Error(msg);
  }
  lastConflict.delete(id);
  const rt = { id, startedAt: Date.now(), pushers: new Map(), stopping: false, status: 'starting', items: [] };
  state.set(id, rt);
  event('live', 'info', `starting ${st.name}`, id);
  try {
    await buildList(st, rt);
    await buildMusic(st, rt);
    if (rt.stopping) return;
    startEncoder(st, rt);
    // Wait until the encoder is really publishing to the relay before pushers read from it.
    // (2 s of output: MediaMTX makes the path readable only after it has seen both tracks.)
    for (let i = 0; i < 80 && !rt.stopping && !(rt.encoder?.stats.outUs >= 2e6); i++) await new Promise(r => setTimeout(r, 250));
    if (rt.stopping) return;
    rt.status = 'live';
    syncPushers(st, rt);
    if (rt.reloadPending) { const w = rt.reloadPending; rt.reloadPending = null; reload(id, w).catch(e => event('live', 'error', `reload: ${e.message}`, id)); }
  } catch (e) {
    rt.status = 'error'; rt.lastError = e.message;
    event('live', 'error', `${st.name}: ${e.message}`, id);
    setTimeout(() => { if (state.get(id) === rt) state.delete(id); }, 1000);
    throw e;
  }
}

function stop(id) {
  const rt = state.get(id);
  if (!rt) return;
  rt.stopping = true;
  countUsage(rt);
  kill(rt.encoder);
  if (rt.rec) { clearTimeout(rt.rec.timer); kill(rt.rec.p); }
  for (const ps of rt.pushers.values()) { clearTimeout(ps.timer); kill(ps.p); }
  state.delete(id);
  for (const h of rt.onStopHooks || []) Promise.resolve().then(h).catch(e => event('live', 'warn', `end broadcast: ${e.message}`, id));
  event('live', 'info', `stopped station ${id}`, id);
}

// Playlist changed: rebuild list, restart only the encoder. Pushers reconnect on their own.
async function reload(id, why = 'playlist changed') {
  const rt = state.get(id);
  if (!rt) return;
  // Still starting, or another reload is running: do it once that is done.
  if (rt.status !== 'live' || rt.reloading) { rt.reloadPending = why; return; }
  rt.reloading = true;
  try { await doReload(id, rt, why); } finally { rt.reloading = false; }
  if (rt.reloadPending && !rt.stopping) { const w = rt.reloadPending; rt.reloadPending = null; return reload(id, w); }
}
async function doReload(id, rt, why) {
  event('live', 'info', `reloading (${why})`, id);
  if (process.env.DEBUG_RELOAD) console.log(new Error('reload trace').stack);
  const st = get('SELECT * FROM stations WHERE id=?', id);
  await buildList(st, rt);
  await buildMusic(st, rt);
  const old = rt.encoder; rt.encoder = null;
  clearTimeout(rt.encTimer);
  if (old && old.exitCode === null) {
    // Wait for the old one to leave the relay, or the new one is refused as a second publisher.
    await new Promise(r => { const t = setTimeout(r, 4000); old.once('close', () => { clearTimeout(t); r(); }); kill(old); });
  }
  if (rt.stopping || rt.encoder) return;
  startEncoder(st, rt);
}

function skip(id) { const rt = state.get(id); if (rt?.encoder) kill(rt.encoder); }   // encoder restarts at item 1

// ---------------------------------------------------------------- schedule
function wantOn(st, now = new Date()) {
  let s; try { s = JSON.parse(st.schedule || '{}'); } catch { s = {}; }
  if (s.mode === 'always') return true;
  if (s.mode === 'daily') {
    const day = now.getDay() || 7;                       // 1..7, Mon..Sun
    const days = s.days?.length ? s.days : [1, 2, 3, 4, 5, 6, 7];
    const mins = now.getHours() * 60 + now.getMinutes();
    const [sh, sm] = String(s.start || '00:00').split(':').map(Number);
    const [eh, em] = String(s.end || '23:59').split(':').map(Number);
    const a = sh * 60 + sm, b = eh * 60 + em;
    if (a <= b) return days.includes(day) && mins >= a && mins < b;
    const prev = ((day + 5) % 7) + 1;                     // window crosses midnight
    return (days.includes(day) && mins >= a) || (days.includes(prev) && mins < b);
  }
  return !!st.want_on;
}

// ---------------------------------------------------------------- snapshots
const snapBusy = new Set();
function snapshot(id) {
  if (snapBusy.has(id)) return;
  snapBusy.add(id);
  const tmp = snapFile(id) + '.tmp.jpg';
  const p = spawn(FFMPEG, ['-hide_banner', '-v', 'error', '-y', '-rw_timeout', '8000000', '-i', relayPath(id), '-frames:v', '1', '-vf', 'scale=640:-2', '-q:v', '6', tmp], { windowsHide: true });
  const t = setTimeout(() => p.kill('SIGKILL'), 12000);
  p.on('close', code => { clearTimeout(t); snapBusy.delete(id); if (code === 0) fs.rename(tmp, snapFile(id), () => {}); });
  p.on('error', () => { clearTimeout(t); snapBusy.delete(id); });
}

// ---------------------------------------------------------------- recording
const recDir = () => path.join(DATA, 'recordings');
function syncRecorder(st, rt) {
  const want = !!st.record;
  if (!want && rt.rec) { clearTimeout(rt.rec.timer); kill(rt.rec.p); rt.rec = null; return; }
  if (!want || (rt.rec && (rt.rec.p || rt.rec.timer))) return;
  const seg = Number(process.env.RECORD_SEGMENT_S || 3600);
  const pattern = path.join(recDir(), `st${st.id}_%Y%m%d_%H%M%S.mp4`);
  rt.rec = rt.rec || { files: 0 };
  rt.rec.p = proc(['-hide_banner', '-v', 'warning', '-nostats', '-progress', 'pipe:1', '-rw_timeout', '15000000', '-i', relayPath(st.id), '-map', '0', '-c', 'copy',
    '-f', 'segment', '-segment_time', String(seg), '-reset_timestamps', '1', '-strftime', '1', '-segment_format', 'mp4', '-segment_format_options', 'movflags=+frag_keyframe+empty_moov', pattern], 'recorder', () => {
    if (!rt.rec || rt.stopping) return;
    rt.rec.p = null;
    rt.rec.timer = setTimeout(() => { if (rt.rec) { rt.rec.timer = null; syncRecorder(get('SELECT * FROM stations WHERE id=?', st.id) || st, rt); } }, 5000);
  });
}
function recordings(id) {
  try {
    return fs.readdirSync(recDir()).filter(f => f.startsWith(`st${id}_`) && f.endsWith('.mp4')).sort().reverse()
      .map(f => { const s = fs.statSync(path.join(recDir(), f)); return { name: f, size: s.size, at: s.mtimeMs }; });
  } catch { return []; }
}

// ---------------------------------------------------------------- data use (per month)
const monthKey = (d = new Date()) => `usage_${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
function countUsage(rt) {
  let add = 0;
  for (const ps of rt.pushers.values()) {
    const b = ps.p?.stats.bytes || 0;
    if (ps.p !== ps.countedProc) { ps.countedProc = ps.p; ps.counted = 0; }
    if (b > (ps.counted || 0)) { add += b - (ps.counted || 0); ps.counted = b; }
  }
  if (!add) return;
  const k = monthKey();
  const total = (setting(k, 0) || 0) + add;
  setSetting(k, total);
  const limit = Number(setting('monthly_tb', 4)) * 1e12;
  if (limit && total > limit * 0.8 && !setting(k + '_alerted')) {
    setSetting(k + '_alerted', true);
    event('live', 'warn', `Data this month passed 80% of ${setting('monthly_tb', 4)} TB`);
    notify.send('live', `Data this month is at ${(total / 1e12).toFixed(2)} TB, over 80% of your ${setting('monthly_tb', 4)} TB limit.`);
  }
}
const usage = () => ({ month: monthKey().slice(6), bytes: setting(monthKey(), 0) || 0, limitTB: Number(setting('monthly_tb', 4)) });

// ---------------------------------------------------------------- folder playlists refill themselves
async function refillFolders() {
  for (const pl of all("SELECT * FROM playlists WHERE folder IS NOT NULL AND folder != ''")) {
    if (!fs.existsSync(pl.folder)) continue;
    let seen; try { seen = new Set(JSON.parse(pl.seen || '[]')); } catch { seen = new Set(); }
    let added = 0;
    for (const f of fs.readdirSync(pl.folder).filter(f => media.VIDEO_EXT.test(f)).sort()) {
      const full = path.join(pl.folder, f);
      let s; try { s = fs.statSync(full); } catch { continue; }
      const key = `${f}|${s.size}`;
      if (seen.has(key) || Date.now() - s.mtimeMs < 10000) continue;
      seen.add(key);
      try {
        const m = await media.addFile(full, f, 'folder');
        const pos = get('SELECT COALESCE(MAX(pos),-1)+1 p FROM playlist_items WHERE playlist_id=?', pl.id).p;
        run('INSERT INTO playlist_items(playlist_id,media_id,pos) VALUES(?,?,?)', pl.id, m.id, pos);
        for (const st of all('SELECT * FROM stations WHERE playlist_id=?', pl.id)) await media.prepare(m.id, st.profile).catch(() => {});
        added++;
      } catch (e) { event('live', 'warn', `folder ${pl.name}: ${f}: ${e.message}`); }
    }
    run('UPDATE playlists SET seen=? WHERE id=?', JSON.stringify([...seen].slice(-5000)), pl.id);
    if (added) {
      event('live', 'info', `playlist "${pl.name}": ${added} new video(s) from folder`);
      for (const st of all('SELECT id FROM stations WHERE playlist_id=?', pl.id)) if (state.has(st.id)) await reload(st.id).catch(() => {});
    }
  }
}
let refilling = false;

// ---------------------------------------------------------------- AI lines on the overlay
// ticker: a fresh line every N minutes. nowplaying: a line about each new video.
function aiLiveLine(st, rt) {
  const o = overlayOf(st);
  if (!aiOn(o) || rt.aiBusy || !require('../ai/client').ready()) return;
  let item = null;
  if (o.aiMode === 'ticker') { if (Date.now() - (rt.aiAt || 0) < Math.max(1, Number(o.aiEvery) || 5) * 60e3) return; }
  else { const now = status(st.id).now; if (!now || now.id === rt.aiItem) return; item = now; rt.aiItem = now.id; }
  rt.aiBusy = true; rt.aiAt = Date.now();
  const fx = require('../ai/features');
  const said = item ? (fx.transcript(item.id) || []).map(s => s.text).join(' ').slice(0, 600) : '';
  fx.liveLine({ mode: o.aiMode, prompt: o.aiPrompt, item: item && { name: item.name, said }, recent: rt.aiRecent || [] })
    .then(line => { if (!line) return; rt.aiLine = line; rt.aiRecent = [...(rt.aiRecent || []), line].slice(-10); writeOverlayText(st, rt); event('ai', 'info', `live line: ${line}`, st.id); })
    .catch(e => event('ai', 'warn', `live line failed: ${e.message}`, st.id))
    .finally(() => { rt.aiBusy = false; });
}

let tickN = 0;
function tick() {
  tickN++;
  if (tickN % 3 === 0 && !refilling) { refilling = true; refillFolders().catch(e => event('live', 'error', e.message)).finally(() => { refilling = false; }); }
  for (const st of all('SELECT * FROM stations')) {
    const on = wantOn(st);
    if (on && !state.has(st.id)) start(st.id).catch(() => {});
    else if (!on && state.has(st.id)) stop(st.id);
    const rt = state.get(st.id);
    if (rt && rt.status === 'live') {
      syncPushers(st, rt);
      syncRecorder(st, rt);
      countUsage(rt);
      // Overlay text changed while live: the file is re-read every frame, just rewrite it.
      if (rt.overlayOn) { aiLiveLine(st, rt); writeOverlayText(st, rt); }
      if (tickN % 2 === 0) snapshot(st.id);
      // Stalled pusher (no progress for 30 s): kill it, the exit handler retries.
      for (const ps of rt.pushers.values()) {
        if (ps.p && ps.p.stats.beat && Date.now() - ps.p.stats.beat > 30000) { event('live', 'warn', `${ps.label}: stalled, restarting`, st.id); kill(ps.p); }
        if (ps.p && ps.p.stats.kbps > 0 && ps.status !== 'live') { ps.status = 'live'; ps.tries = 0; ps.error = ''; ps.since = Date.now(); }
      }
    }
  }
}

// ---------------------------------------------------------------- read model for the UI
function status(id) {
  const rt = state.get(id);
  if (!rt) return { running: false };
  const enc = rt.encoder?.stats;
  let now = null;
  if (enc && rt.loopLen && rt.items.length) {
    let t = (enc.outUs / 1e6) % rt.loopLen;
    for (let i = 0; i < rt.items.length; i++) {
      const it = rt.items[i];
      if (t < it.duration || i === rt.items.length - 1) { now = { index: i, ...it, pos: t, pct: Math.min(100, (t / it.duration) * 100) }; break; }
      t -= it.duration;
    }
  }
  return {
    running: true, status: rt.status, note: rt.note || '', error: rt.lastError || '',
    startedAt: rt.startedAt, uptime: Date.now() - rt.startedAt,
    encoder: enc ? { kbps: Math.round(enc.kbps), speed: enc.speed, up: !!rt.encoder, mode: rt.overlayOn ? 'overlay' : 'copy', music: !!rt.musicOn } : { up: false },
    recording: rt.rec ? { on: !!rt.rec.p, kbps: Math.round(rt.rec.p?.stats.kbps || 0) } : null,
    aiLine: rt.aiLine || '',
    items: rt.items, now,
    pushers: [...rt.pushers.values()].map(ps => ({
      id: ps.id, label: ps.label, status: ps.status, tries: ps.tries, drops: ps.drops || 0, error: ps.error || '',
      kbps: Math.round(ps.p?.stats.kbps || 0), since: ps.since, nextTry: ps.nextTry || null,
    })),
  };
}

let timer = null;
function boot() { if (!timer) { timer = setInterval(tick, TICK_MS); setTimeout(tick, 500); } }
function shutdown() { clearInterval(timer); timer = null; for (const id of [...state.keys()]) stop(id); }

module.exports = { boot, shutdown, start, stop, reload, skip, status, wantOn, state, snapFile, tick, conflicts, recordings, recDir, usage, logoFile, refillFolders, overlayActive };
