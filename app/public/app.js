// AutoCast web UI. No build step. Two spaces (Auto Upload, Auto Live) + Shared.
'use strict';
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ------------------------------------------------------------------ api
async function call(method, url, body) {
  const r = await fetch(url, { method, headers: { 'content-type': 'application/json', 'x-autocast': '1' }, body: body ? JSON.stringify(body) : undefined });
  if (r.status === 401) { showGate(); throw new Error('Log in first'); }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `Error ${r.status}`);
  return j;
}
const api = { get: u => call('GET', u), post: (u, b) => call('POST', u, b || {}), patch: (u, b) => call('PATCH', u, b), del: u => call('DELETE', u) };
function uploadFiles(files, onProgress) {
  return new Promise((resolve, reject) => {
    const fd = new FormData(); for (const f of files) fd.append('files', f);
    const x = new XMLHttpRequest();
    x.open('POST', '/api/media'); x.setRequestHeader('x-autocast', '1');
    x.upload.onprogress = e => e.lengthComputable && onProgress(e.loaded / e.total);
    x.onload = () => { const j = JSON.parse(x.responseText || '{}'); x.status < 300 ? resolve(j) : reject(new Error(j.error || 'Upload failed')); };
    x.onerror = () => reject(new Error('Upload failed'));
    x.send(fd);
  });
}

// ------------------------------------------------------------------ small ui kit
function toast(msg, err) {
  const t = document.createElement('div'); t.className = 'toast' + (err ? ' err' : ''); t.textContent = msg;
  $('#toasts').append(t); setTimeout(() => t.remove(), err ? 6000 : 3000);
}
const run = fn => async (...a) => { try { await fn(...a); } catch (e) { toast(e.message, true); } };
let openModal = null;
function modal(html, mount) {
  closeModal();
  const bg = document.createElement('div'); bg.className = 'modal-bg';
  bg.innerHTML = `<div class="modal">${html}</div>`;
  bg.addEventListener('mousedown', e => { if (e.target === bg) closeModal(); });
  document.body.append(bg); openModal = bg;
  $$('[data-close]', bg).forEach(b => b.onclick = closeModal);
  mount && mount($('.modal', bg));
  $('input,select,textarea', bg)?.focus();
  return bg;
}
function closeModal() { openModal?.remove(); openModal = null; }
addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

const PF = {
  youtube: ['yt', 'YT'], tiktok: ['tt', 'TT'], instagram: ['ig', 'IG'], facebook: ['fb', 'FB'], x: ['x', 'X'], threads: ['th', '@'],
  twitch: ['tw', 'TW'], kick: ['kk', 'K'], rtmp: ['rtmp', '⇢'], mock: ['mock', 'T'],
  youtube_live: ['yk', 'YT'], facebook_live: ['fk', 'FB'], tiktok_live: ['tk', 'TT'], instagram_live: ['ik', 'IG'], x_live: ['x', 'X'],
};
const pf = (p, sm) => { const [c, l] = PF[p] || ['rtmp', '?']; return `<span class="pf ${c}${sm ? ' sm' : ''}" title="${esc(p)}">${l}</span>`; };
const pad = n => String(n).padStart(2, '0');
const fmtTime = t => { if (!t) return '—'; const d = new Date(t), now = new Date(); const same = d.toDateString() === now.toDateString(); const tm = `${pad(d.getHours())}:${pad(d.getMinutes())}`; if (same) return `Today ${tm}`; const tmr = new Date(now); tmr.setDate(now.getDate() + 1); if (d.toDateString() === tmr.toDateString()) return `Tomorrow ${tm}`; return `${d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })} ${tm}`; };
const fmtDur = s => { s = Math.round(s || 0); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60; return h ? `${h}:${pad(m)}:${pad(x)}` : `${m}:${pad(x)}`; };
const fmtUp = ms => { const s = Math.floor(ms / 1000), d = Math.floor(s / 86400); return d ? `${d}d ${fmtDur(s % 86400)}` : fmtDur(s); };
const fmtBytes = b => b > 1e12 ? `${(b / 1e12).toFixed(2)} TB` : b > 1e9 ? `${(b / 1e9).toFixed(1)} GB` : b > 1e6 ? `${(b / 1e6).toFixed(0)} MB` : `${Math.round((b || 0) / 1e3)} KB`;
const fmtRate = k => k >= 1000 ? `${(k / 1000).toFixed(1)} Mbps` : `${Math.round(k || 0)} kbps`;
const ago = t => { if (!t) return 'never'; const s = (Date.now() - t) / 1000; return s < 60 ? 'just now' : s < 3600 ? `${Math.round(s / 60)} min ago` : s < 86400 ? `${Math.round(s / 3600)} h ago` : `${Math.round(s / 86400)} days ago`; };
const STATUS = { queued: ['ac', 'Waiting'], running: ['warn', 'Sending…'], done: ['ok', 'Sent'], failed: ['bad', 'Failed'], canceled: ['', 'Canceled'], retry: ['warn', 'Will retry'] };
const tpill = t => pill(t.status === 'queued' && t.attempts ? 'retry' : t.status);
const pill = s => { const [c, l] = STATUS[s] || ['', s]; return `<span class="pill ${c}">${l}</span>`; };
const toLocalInput = t => { const d = new Date(t); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const empty = (title, text, btn) => `<div class="empty"><b>${title}</b>${text}${btn ? `<div>${btn}</div>` : ''}</div>`;
const tgl = (on, attrs = '') => `<span class="tgl ${on ? 'on' : ''}" ${attrs}></span>`;
const thumb = (src, cls = '') => `<div class="thumb ${cls}">${src ? `<img src="${esc(src)}" alt="" loading="lazy" onerror="this.remove()">` : ''}</div>`;

// ------------------------------------------------------------------ gate (setup / login)
async function showGate() {
  const me = await fetch('/api/me').then(r => r.json());
  if (me.authed) { $('#gate').hidden = true; $('#app').hidden = false; return true; }
  $('#app').hidden = true; const g = $('#gate'); g.hidden = false;
  g.innerHTML = `<form class="box"><div class="brand"><span class="logo">◆</span> AutoCast</div>
    <p>${me.setup ? 'Welcome! Make a password for this server.' : 'Log in to your server.'}</p>
    <label class="f">Password</label><input class="in" type="password" name="pw" autocomplete="${me.setup ? 'new-password' : 'current-password'}" required minlength="${me.setup ? 8 : 1}">
    ${me.setup ? '<label class="f">Password again</label><input class="in" type="password" name="pw2" autocomplete="new-password" required>' : ''}
    <div class="err-t" id="gerr"></div>
    <button class="btn pri" style="width:100%;justify-content:center;margin-top:6px">${me.setup ? 'Create password' : 'Log in'}</button></form>`;
  $('input', g).focus();
  $('form', g).onsubmit = async e => {
    e.preventDefault();
    const f = e.target; const pw = f.pw.value;
    if (me.setup && pw !== f.pw2.value) return ($('#gerr').textContent = 'The two passwords are not the same.');
    const r = await fetch(me.setup ? '/api/setup' : '/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: pw }) });
    const j = await r.json();
    if (!r.ok) return ($('#gerr').textContent = j.error);
    g.hidden = true; $('#app').hidden = false; render(); sidebar();
  };
  return false;
}
$('#logout').onclick = async () => { await api.post('/api/logout'); showGate(); };
// light / dark, remembered in this browser
const setTheme = t => { document.body.classList.toggle('light', t === 'light'); $('#theme').textContent = t === 'light' ? '☾' : '☀'; localStorage.setItem('ac_theme', t); };
setTheme(localStorage.getItem('ac_theme') || (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'));
$('#theme').onclick = () => setTheme(document.body.classList.contains('light') ? 'dark' : 'light');

// ------------------------------------------------------------------ router
const V = {};
let cur = null;
const NAMES = { activity: 'Activity log', overview: 'Overview', create: 'Create post', calendar: 'Calendar', posts: 'All posts', autopilot: 'Autopilot rules', library: 'Media library', stations: 'Stations', control: 'Control room', new: 'New station', playlists: 'Playlists', schedule: 'Schedule', accounts: 'Accounts', settings: 'Settings' };
const SPACE = { upload: 'Auto Upload', live: 'Auto Live', shared: 'Shared' };
function route() {
  const h = location.hash.slice(1) || 'upload/overview';
  const [p, q] = h.split('?');
  return { key: p, params: Object.fromEntries(new URLSearchParams(q || '')) };
}
async function render() {
  const { key, params } = route();
  const [sp, pg] = key.split('/');
  cur?.cleanup?.();
  cur = null; closeModal();
  document.body.dataset.space = sp in SPACE ? sp : 'upload';
  $('#crumbs').innerHTML = `<span class="tag">${SPACE[sp] || ''}</span><b>${NAMES[pg] || ''}</b>`;
  $$('.nav a').forEach(a => a.classList.toggle('on', a.dataset.go === key || (key === 'live/control' && a.dataset.go === 'live/stations')));
  const el = $('#view'); el.scrollTop = 0;
  const view = V[key] || V['upload/overview'];
  el.innerHTML = '<div class="sub">Loading…</div>';
  try { cur = (await view(el, params)) || {}; } catch (e) { el.innerHTML = empty('Something went wrong', esc(e.message)); }
}
document.addEventListener('click', e => { const t = e.target.closest('[data-go]'); if (t && !e.target.closest('button:not([data-go]),a[href]') ) location.hash = t.dataset.go; });
addEventListener('hashchange', render);
setInterval(() => { if (!openModal && cur?.poll && !document.hidden) cur.poll().catch(() => {}); }, 2500);

async function sidebar() {
  try {
    const [s, ov, acc, st] = await Promise.all([api.get('/api/system'), api.get('/api/upload/overview'), api.get('/api/accounts'), api.get('/api/stations')]);
    const memPct = Math.round((1 - s.mem.free / s.mem.total) * 100);
    const live = st.filter(x => x.runtime.running).length;
    $('#sysbox').innerHTML = `
      <div class="vps"><span class="dot ${s.relay && s.ffmpeg ? 'ok' : 'bad'}"></span>Server · ${s.cores} cores · ${s.cpu}% CPU</div>
      <div class="bar"><span style="width:${s.cpu}%"></span></div>
      <div class="vps muted">RAM ${memPct}% · ${s.disk ? fmtBytes(s.disk.free) + ' free' : ''}</div>
      <div class="vps muted" title="Live data sent this month">Data ${fmtBytes(s.usage.bytes)} of ${s.usage.limitTB} TB</div>
      <div class="bar"><span style="width:${Math.min(100, (s.usage.bytes / (s.usage.limitTB * 1e12 || 1)) * 100).toFixed(1)}%;${s.usage.bytes > s.usage.limitTB * 8e11 ? 'background:var(--warn)' : ''}"></span></div>
      ${!s.relay ? '<div class="vps" style="color:var(--lv2)">⚠ Live relay is off</div>' : ''}${s.ffmpeg === false ? '<div class="vps" style="color:var(--lv2)">⚠ FFmpeg missing</div>' : ''}`;
    const set = (id, n, txt) => { const e = $(id); e.hidden = !n; if (n) e.textContent = txt ?? n; };
    set('#c-failed', ov.failed); $('#c-failed').className = 'warn';
    set('#c-rules', ov.rules.filter(r => r.enabled).length);
    set('#c-acc', acc.filter(a => a.status !== 'ok').length);
    set('#c-live', live, `${live} LIVE`);
  } catch {}
}
setInterval(() => !document.hidden && !$('#app').hidden && sidebar(), 6000);

// ------------------------------------------------------------------ AI helpers
let aiReady = false;
const refreshAi = () => api.get('/api/ai/settings').then(s => { aiReady = s.ready; return s; }).catch(() => ({}));
const aiBtn = (id, label, extra = '') => `<button class="btn sm ai-btn" id="${id}" ${extra} ${aiReady ? '' : 'title="Set up AI in Settings first"'}>✦ ${label}</button>`;
async function needAi() { if (!aiReady) { await refreshAi(); if (!aiReady) { toast('Set up AI first: Settings → AI', true); location.hash = 'shared/settings'; throw new Error('AI not set up'); } } }
// Start a background AI job and wait for it, with a progress toast.
async function aiJob(url, body = {}, label = 'Working') {
  await needAi();
  const { job } = await api.post(url, body);
  const t = document.createElement('div'); t.className = 'toast'; t.textContent = `✦ ${label}…`; $('#toasts').append(t);
  try {
    for (let i = 0; i < 900; i++) {
      await new Promise(r => setTimeout(r, 2000));
      const j = await api.get(`/api/ai/jobs/${job}`);
      if (j.state === 'done') return j.result;
      if (j.state === 'failed') throw new Error(j.error);
      t.textContent = `✦ ${label}… ${Math.round((i + 1) * 2)} s`;
    }
    throw new Error('Took too long');
  } finally { t.remove(); }
}
function askBox(el) {
  const box = document.createElement('div'); box.className = 'card ask';
  box.innerHTML = `<div class="row"><span class="ask-ico">✦</span><input class="in" id="askq" placeholder='Ask AutoCast: "post my newest video to Finance at the next slot" or "stop Retro Runner"'><button class="btn pri" id="askgo">Ask</button></div><div id="askout"></div>`;
  el.prepend(box);
  const go = run(async () => {
    await needAi();
    const q = $('#askq').value.trim(); if (!q) return;
    $('#askout').innerHTML = '<div class="hint">Thinking…</div>';
    const r = await api.post('/api/ai/ask', { q });
    const a = r.action || {};
    const what = a.type === 'create_post' ? `Post video #${a.media_id} to ${(a.account_ids || []).length} account(s), ${esc(a.when || 'slot')}: “${esc(a.title || '')}”` : a.type === 'start_station' ? `Start station #${a.id}` : a.type === 'stop_station' ? `Stop station #${a.id}` : '';
    $('#askout').innerHTML = `<div class="ask-plan"><div>${esc(r.reply)}</div>${what ? `<div class="row" style="margin-top:8px;justify-content:space-between"><span class="code">${what}</span><span class="row"><button class="btn sm" id="askno">Cancel</button><button class="btn sm pri" id="askyes">Do it</button></span></div>` : ''}</div>`;
    $('#askno') && ($('#askno').onclick = () => { $('#askout').innerHTML = ''; });
    $('#askyes') && ($('#askyes').onclick = run(async () => { const d = await api.post('/api/ai/run', { action: a }); toast(d.done); $('#askout').innerHTML = ''; $('#askq').value = ''; if (d.go) location.hash = d.go; }));
  });
  $('#askgo').onclick = go;
  $('#askq').onkeydown = e => { if (e.key === 'Enter') go(); };
}

// ================================================================== AUTO UPLOAD
V['upload/overview'] = async el => {
  const draw = async () => {
    const [ov, next, recent] = await Promise.all([
      api.get('/api/upload/overview'),
      api.get(`/api/posts?status=queued,running&from=0`),
      api.get(`/api/posts?status=done,failed&order=desc&from=${Date.now() - 7 * 864e5}`),
    ]);
    const diff = ov.doneLastWeek ? Math.round(((ov.doneWeek - ov.doneLastWeek) / ov.doneLastWeek) * 100) : null;
    const hr = new Date().getHours();
    el.innerHTML = `
    <div class="head"><div><h1>Good ${hr < 12 ? 'morning' : hr < 18 ? 'afternoon' : 'evening'}</h1><p class="sub">${ov.today} post${ov.today === 1 ? '' : 's'} today.${ov.reauth.length ? ` ${ov.reauth.length} account${ov.reauth.length > 1 ? 's need' : ' needs'} a new login.` : ''}</p></div>
    <div class="row"><button class="btn" data-go="upload/calendar">▤ Calendar</button><button class="btn pri" data-go="upload/create">＋ Create post</button></div></div>
    ${ov.reauth.map(a => `<div class="rulebox" style="margin:0 0 14px">⚠ <b>${esc(a.name)}</b> needs a new login. <a href="#shared/accounts">Fix it →</a></div>`).join('')}
    <div class="grid g4">
      <div class="card stat"><div class="k">Sent this week</div><div class="v">${ov.doneWeek}</div><div class="d ${diff == null ? 'muted' : diff >= 0 ? 'up' : 'down'}">${diff == null ? 'first week' : `${diff >= 0 ? '▲' : '▼'} ${Math.abs(diff)}% vs last week`}</div></div>
      <div class="card stat"><div class="k">Waiting</div><div class="v">${ov.queued + ov.running}</div><div class="d muted">${ov.next ? 'next ' + fmtTime(ov.next) : 'nothing waiting'}</div></div>
      <div class="card stat"><div class="k">Autopilot rules on</div><div class="v">${ov.rules.filter(r => r.enabled).length}</div><div class="d muted">${ov.rules.reduce((a, r) => a + r.runs, 0)} videos picked up</div></div>
      <div class="card stat"><div class="k">Failed</div><div class="v" style="color:${ov.failed ? 'var(--warn)' : 'inherit'}">${ov.failed}</div><div class="d muted">${ov.failed ? '<a href="#upload/posts?s=failed">See and retry →</a>' : 'all good'}</div></div>
    </div>
    <div class="grid" style="grid-template-columns:1.5fr 1fr;margin-top:16px">
      <div class="card"><h3>Up next <small>${next.length} waiting</small></h3>
        ${next.length ? `<div class="list">${next.slice(0, 6).map(t => `<div class="li">${thumb(t.thumb)}<div class="grow"><div class="t">${esc(t.title || t.media_name)}</div><div class="s">${fmtTime(t.run_at)} · ${esc(t.account)}</div></div>${pf(t.platform, 1)}${tpill(t)}</div>`).join('')}</div>`
          : empty('Nothing waiting', 'Make a post or turn on an autopilot rule.', '<button class="btn pri sm" data-go="upload/create">＋ Create post</button>')}
      </div>
      <div class="card"><h3>Autopilot</h3>
        ${ov.rules.length ? `<div class="list">${ov.rules.map(r => `<div class="li">${tgl(r.enabled, `data-rule="${r.id}"`)}<div class="grow"><div class="t">${esc(r.name)}</div><div class="s">${r.runs} run${r.runs === 1 ? '' : 's'} · last ${ago(r.last_run)}</div></div></div>`).join('')}</div>`
          : empty('No rules yet', 'Auto-post every new video from a folder.')}
        <button class="btn ghost sm" style="margin-top:10px" data-go="upload/autopilot">Manage rules →</button>
      </div>
    </div>
    <div class="card" style="margin-top:16px"><h3>Last 7 days <small>${recent.length} sent or failed</small></h3>
      ${recent.length ? `<table class="tablex"><tr><th>Video</th><th>Account</th><th>When</th><th>Status</th><th></th></tr>${recent.slice(0, 8).map(t => `<tr><td><div class="row">${thumb(t.thumb)}<b>${esc(t.title || t.media_name)}</b></div></td><td><div class="row">${pf(t.platform, 1)}${esc(t.account)}</div></td><td class="muted">${fmtTime(t.done_at || t.run_at)}</td><td>${tpill(t)}${t.status === 'failed' ? `<div class="hint">${esc(t.error)}</div>` : ''}</td><td>${t.url && /^https?:/.test(t.url) ? `<a href="${esc(t.url)}" target="_blank" rel="noopener">Open ↗</a>` : t.status === 'failed' ? `<button class="btn sm" data-retry="${t.id}">Retry</button>` : ''}</td></tr>`).join('')}</table>` : '<div class="sub">Nothing sent yet.</div>'}
    </div>`;
    $$('[data-rule]', el).forEach(t => t.onclick = run(async () => { await api.patch(`/api/rules/${t.dataset.rule}`, { enabled: !t.classList.contains('on') }); draw(); }));
    $$('[data-retry]', el).forEach(b => b.onclick = run(async () => { await api.post(`/api/targets/${b.dataset.retry}/retry`); toast('Sending again'); draw(); }));
    // AI: ask box + last digest
    const ais = await refreshAi();
    const holder = document.createElement('div'); el.querySelector('.head').after(holder); askBox(holder);
    const d = ais.lastDigest;
    const dg = document.createElement('div'); dg.className = 'card'; dg.style.marginBottom = '16px';
    dg.innerHTML = `<h3>✦ Daily AI report <small>${d ? ago(d.at) : 'not made yet'}</small></h3>${d ? `<b>${esc(d.headline)}</b><div style="white-space:pre-line;color:var(--tx2);margin-top:4px">${esc(d.text)}</div>` : '<div class="hint">A short daily summary, also sent to Telegram if set.</div>'}<button class="btn sm" id="mkdg" style="margin-top:10px">✦ Make report now</button>`;
    holder.after(dg);
    $('#mkdg').onclick = run(async () => { await needAi(); $('#mkdg').textContent = 'Writing…'; await api.post('/api/ai/digest'); draw(); });
  };
  await draw();
  return { poll: async () => { if (!document.activeElement?.closest('.ask')) await draw(); } };
};

const LIMITS = { youtube: { title: 100, body: 5000 }, tiktok: { title: 2200 }, instagram: { title: 2200 }, facebook: { title: 255, body: 60000 }, mock: { title: 100, body: 5000 } };
V['upload/create'] = async (el, params) => {
  const [lib, accs, snippets] = await Promise.all([api.get('/api/media'), api.get('/api/accounts'), api.get('/api/snippets')]);
  const up = accs.filter(a => a.can_upload);
  const S = { media: params.media ? Number(params.media) : lib[0]?.id || null, acc: new Set(), title: '', body: '', per: {}, perOn: false, tab: null, privacy: 'public', ai: false, kids: false, when: 'slot', at: Date.now() + 3600e3, repeat: false, rDays: 30, rTimes: 3, allowDup: false };
  const groups = [...new Set(up.map(a => a.grp).filter(Boolean))];

  const draw = () => {
    const m = lib.find(x => x.id === S.media);
    const sel = up.filter(a => S.acc.has(a.id));
    const plats = [...new Set(sel.map(a => a.platform))];
    if (!plats.includes(S.tab)) S.tab = plats[0] || null;
    const vertical = m && m.height > m.width;
    const checks = [];
    if (m) {
      const toVert = sel.filter(a => a.fmt === 'vertical' || (a.fmt !== 'original' && ['tiktok', 'instagram'].includes(a.platform)));
      if (toVert.length && !vertical) checks.push(['ok', `Wide video: a 9:16 version is made for ${toVert.map(a => a.name).join(', ')}`]);
      if (plats.includes('tiktok') && m.duration > 600) checks.push(['bad', 'TikTok max is 10 min']);
      if (plats.includes('instagram') && m.duration > 900) checks.push(['bad', 'Reels max is 15 min']);
      if (plats.includes('youtube') && vertical && m.duration <= 180) checks.push(['ok', 'Will be a YouTube Short']);
    }
    for (const a of sel) if (a.status !== 'ok') checks.push(['bad', `${a.name} needs a new login`]);
    for (const p of plats) {
      const L = LIMITS[p] || {}; const t = (S.perOn && S.per[p]?.title) ?? S.title;
      if (L.title && t.length > L.title) checks.push(['bad', `${p}: title is ${t.length}/${L.title}`]);
    }
    if (m && sel.length && !checks.some(c => c[0] === 'bad')) checks.unshift(['ok', `Ready for ${sel.length} account${sel.length > 1 ? 's' : ''}`]);
    const cur = S.perOn && S.tab ? (S.per[S.tab] ||= { title: S.title, body: S.body }) : S;
    const L = LIMITS[S.tab] || LIMITS.youtube;
    const caption = [cur.title, cur.body].filter(Boolean).join(' ');

    el.innerHTML = `
    <div class="head"><div><h1>Create post</h1><p class="sub">One video. Many accounts. Text tuned per app.</p></div></div>
    <div class="steps">${['Video', 'Accounts', 'Text', 'When'].map((s, i) => { const done = [!!m, sel.length > 0, !!S.title, true][i]; return `<div class="step ${done ? 'done' : ''}"><b>${done ? '✓' : i + 1}</b>${s}</div>`; }).join('')}</div>
    <div class="create">
     <div class="grid">
      <div class="card"><h3>1. Video <small><a href="#upload/library">Library →</a></small></h3>
        ${lib.length ? `<div class="lib" style="grid-template-columns:repeat(auto-fill,minmax(130px,1fr))">${lib.slice(0, 12).map(x => `<div class="mcard ${x.id === S.media ? 'on' : ''}" data-m="${x.id}"><div class="tb">${x.thumb ? `<img src="${esc(x.thumb)}" alt="">` : ''}</div><div class="nm">${esc(x.name)}</div><div class="mt">${x.width}×${x.height} · ${fmtDur(x.duration)}</div></div>`).join('')}</div>` : ''}
        <div class="dz" id="dz" style="margin-top:10px">Drop a video here or <a href="#" id="pick">choose a file</a><input type="file" id="file" accept="video/*" hidden><div class="prog-big" id="pg" hidden><span></span></div></div>
      </div>
      <div class="card"><h3>2. Accounts <small>${sel.length} picked</small></h3>
        ${groups.length ? `<div class="chips" style="margin-bottom:10px">${groups.map(g => `<span class="chip" data-g="${esc(g)}" style="cursor:pointer">＋ ${esc(g)}</span>`).join('')}<span class="chip" data-g="" style="cursor:pointer">Clear</span></div>` : ''}
        ${up.length ? `<div class="acc-grid">${up.map(a => `<div class="acc ${S.acc.has(a.id) ? 'on' : ''}" data-a="${a.id}">${pf(a.platform)}<div><div style="font-weight:600;font-size:13px">${esc(a.name)}</div><div class="hint" style="margin:0">${esc(a.label)}${a.grp ? ' · ' + esc(a.grp) : ''}${a.status !== 'ok' ? ' · <span style="color:var(--warn)">re-login</span>' : ''}</div></div><span class="ck">${S.acc.has(a.id) ? '✓' : ''}</span></div>`).join('')}</div>`
          : empty('No posting accounts yet', 'Connect YouTube, TikTok, Instagram or Facebook.', '<button class="btn pri sm" data-go="shared/accounts">Connect account</button>')}
      </div>
      <div class="card"><h3>3. Text <span class="row" style="font-size:12.5px;font-weight:500;color:var(--tx2)">Different text per app ${tgl(S.perOn, 'id="perOn"')}</span></h3>
        ${S.perOn && plats.length ? `<div class="tabs">${plats.map(p => `<button class="tab ${p === S.tab ? 'on' : ''}" data-tab="${p}">${pf(p, 1)} ${esc(p)}</button>`).join('')}</div>` : ''}
        <label class="f">Title <span class="limit ${cur.title.length > (L.title || 1e9) ? 'over' : ''}">${cur.title.length} / ${L.title || '∞'}</span></label><input class="in" id="title" value="${esc(cur.title)}" placeholder="Why Rupiah fell 5% in one week">
        <label class="f">Description</label><textarea class="in" id="body" placeholder="What is this video about? Add #hashtags.">${esc(cur.body)}</textarea>
        <div class="snips">${snippets.map((s, i) => `<span class="chip" data-snip="${i}" title="${esc(s.text)}">＋ ${esc(s.name)}</span>`).join('')}<span class="chip" id="saveSnip" title="Save the description as a reusable snippet">☆ Save as snippet</span></div>
        <div class="ai-row">${aiBtn('aiw', 'Write with AI')}${aiBtn('air', 'Rewrite per app')}<select class="in" id="trl" style="width:auto;padding:5px 28px 5px 10px;font-size:12.5px"><option value="">Translate to…</option>${['Indonesian', 'English', 'Malay', 'Spanish', 'Arabic', 'Japanese', 'Korean', 'Chinese', 'Hindi', 'Portuguese'].map(l => `<option>${l}</option>`).join('')}</select>${aiBtn('aisf', 'Check safety')}</div>
        ${S.hooks?.length ? `<label class="f">AI title ideas (click to use)</label><div class="hooks">${S.hooks.map((h, i) => `<span class="chip" data-hook="${i}">${esc(h)}</span>`).join('')}</div>` : ''}
        ${S.safety ? `<div class="check" style="margin-top:8px"><span class="dot ${S.safety.ok ? 'ok' : 'bad'}"></span>${S.safety.ok ? 'AI safety check: looks fine' : 'AI safety check: ' + esc(S.safety.issues.join('; '))}</div>` : ''}
        <label class="f">Options</label>
        <div class="form-row"><select class="in" id="privacy">${[['public', 'Public'], ['unlisted', 'Unlisted / friends'], ['private', 'Private']].map(([v, l]) => `<option value="${v}" ${S.privacy === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
        <div><div class="check">${tgl(S.ai, 'id="ai"')} Made with AI (adds the AI label)</div><div class="check">${tgl(S.kids, 'id="kids"')} Made for kids</div></div></div>
      </div>
      <div class="card"><h3>4. When</h3><div class="when">
        ${[['now', 'Now', 'Send right away'], ['slot', 'Next free slot', 'Each account’s post times'], ['at', 'Pick time', 'Date and time']].map(([v, b, s]) => `<div class="opt ${S.when === v ? 'on' : ''}" data-w="${v}" style="cursor:pointer"><b>${b}</b><small>${s}</small></div>`).join('')}</div>
        ${S.when === 'at' ? `<input class="in" type="datetime-local" id="at" value="${toLocalInput(S.at)}" style="margin-top:10px">` : ''}
        <div id="slotinfo" class="hint"></div>
        <div class="check" style="margin-top:10px">${tgl(S.repeat, 'id="rep"')} Post again later (evergreen)</div>
        ${S.repeat ? `<div class="form-row"><div><label class="f">Every (days)</label><input class="in" type="number" min="1" id="rDays" value="${S.rDays}"></div><div><label class="f">More times</label><input class="in" type="number" min="1" max="52" id="rTimes" value="${S.rTimes}"></div></div>` : ''}
        <div class="check">${tgl(S.allowDup, 'id="dup"')} Allow repeat (skip the “already posted” check)</div>
      </div>
     </div>
     <div class="card" style="position:sticky;top:0"><h3>Preview</h3>
      <div class="phone" style="${m && !vertical ? 'aspect-ratio:9/16' : ''}"><div class="scr" style="background:#000;display:grid;place-items:center">${m?.thumb ? `<img src="${esc(m.thumb)}" style="width:100%;${vertical ? 'height:100%;object-fit:cover' : ''}">` : ''}</div>
        <div class="rail"><div><span></span>♥</div><div><span></span>💬</div><div><span></span>↗</div></div>
        <div class="cap"><b>${esc(sel[0]?.name || '@you')}</b>${esc(caption.slice(0, 120)) || '<span style="opacity:.6">Your text shows here</span>'}</div></div>
      <div style="margin-top:16px">${checks.map(([c, t]) => `<div class="check"><span class="dot ${c}"></span>${esc(t)}</div>`).join('') || '<div class="check muted">Pick a video and accounts.</div>'}</div>
      <button class="btn pri" id="send" style="width:100%;justify-content:center;margin-top:12px" ${!m || !sel.length || checks.some(c => c[0] === 'bad') ? 'disabled' : ''}>${S.when === 'now' ? 'Post' : 'Schedule'} to ${sel.length || '…'} account${sel.length === 1 ? '' : 's'}</button>
     </div>
    </div>`;
    bind();
    if (S.when === 'slot' && sel.length) api.get(`/api/slots/next?accounts=${sel.map(a => a.id).join(',')}`).then(r => { const e = $('#slotinfo'); if (e) e.innerHTML = r.map(x => `${esc(up.find(a => a.id === x.id)?.name)}: <b>${fmtTime(x.at)}</b>`).join(' · '); }).catch(() => {});
  };
  const plats0 = () => [...new Set(up.filter(a => S.acc.has(a.id)).map(a => a.platform))];
  refreshAi().then(() => { if ($('#aiw')) draw(); });
  const keep = (id, fn) => { const e = $(id); if (!e) return; e.oninput = () => { const pos = e.selectionStart; fn(e.value); draw(); const n = $(id); n.focus(); try { n.setSelectionRange(pos, pos); } catch {} }; };
  const bind = () => {
    $$('[data-m]', el).forEach(c => c.onclick = () => { S.media = Number(c.dataset.m); draw(); });
    $$('[data-a]', el).forEach(c => c.onclick = () => { const id = Number(c.dataset.a); S.acc.has(id) ? S.acc.delete(id) : S.acc.add(id); draw(); });
    $$('[data-g]', el).forEach(c => c.onclick = () => { if (!c.dataset.g) S.acc.clear(); else up.filter(a => a.grp === c.dataset.g).forEach(a => S.acc.add(a.id)); draw(); });
    $$('[data-tab]', el).forEach(c => c.onclick = () => { S.tab = c.dataset.tab; draw(); });
    $$('[data-w]', el).forEach(c => c.onclick = () => { S.when = c.dataset.w; draw(); });
    const target = () => (S.perOn && S.tab ? S.per[S.tab] : S);
    keep('#title', v => { target().title = v; });
    keep('#body', v => { target().body = v; });
    $('#perOn').onclick = () => { S.perOn = !S.perOn; draw(); };
    $('#ai').onclick = () => { S.ai = !S.ai; draw(); };
    $('#kids').onclick = () => { S.kids = !S.kids; draw(); };
    $('#privacy').onchange = e => { S.privacy = e.target.value; };
    if ($('#at')) $('#at').onchange = e => { S.at = new Date(e.target.value).getTime(); };
    $('#rep').onclick = () => { S.repeat = !S.repeat; draw(); };
    $('#dup').onclick = () => { S.allowDup = !S.allowDup; draw(); };
    if ($('#rDays')) { $('#rDays').onchange = e => { S.rDays = Number(e.target.value) || 30; }; $('#rTimes').onchange = e => { S.rTimes = Number(e.target.value) || 1; }; }
    $$('[data-snip]', el).forEach(c => c.onclick = () => { const t = target(); t.body = (t.body ? t.body.replace(/\s*$/, '') + '\n\n' : '') + snippets[Number(c.dataset.snip)].text; draw(); });
    const busy = (id, txt) => { const b = $(id); if (b) { b.disabled = true; b.textContent = txt; } };
    $('#aiw').onclick = run(async () => {
      await needAi(); if (!S.media) throw new Error('Pick a video first');
      const topic = S.title || '';
      busy('#aiw', '✦ Writing…');
      try {
        const r = await api.post('/api/ai/write', { media_id: S.media, topic, platforms: plats0() });
        S.title = r.title; S.body = [r.description, r.hashtags.join(' ')].filter(Boolean).join('\n\n'); S.hooks = r.hooks;
        // Main text stays in view. Per-app versions wait under "Different text per app".
        if (Object.keys(r.per_app).length) S.per = r.per_app;
        toast(Object.keys(r.per_app).length ? '✦ Written. Per-app versions are ready under "Different text per app".' : '✦ Written. Check it before posting.');
      } finally { draw(); }
    });
    $('#air').onclick = run(async () => {
      await needAi(); const p = plats0(); if (!p.length) throw new Error('Pick accounts first');
      busy('#air', '✦ Rewriting…');
      try { S.per = await api.post('/api/ai/rewrite', { title: S.title, body: S.body, platforms: p }); S.perOn = true; toast('✦ Text made for each app. See the tabs.'); }
      finally { draw(); }
    });
    $('#trl').onchange = run(async e => {
      const to = e.target.value; if (!to) return; await needAi();
      const t = target(); const r = await api.post('/api/ai/translate', { title: t.title, body: t.body, to });
      t.title = r.title; t.body = r.body; toast(`✦ Translated to ${to}`); draw();
    });
    $('#aisf').onclick = run(async () => {
      await needAi(); busy('#aisf', '✦ Checking…');
      try { const t = target(); S.safety = await api.post('/api/ai/safety', { title: t.title, body: t.body, platform: S.tab || plats0()[0] || 'youtube' }); }
      finally { draw(); }
    });
    $$('[data-hook]', el).forEach(c => c.onclick = () => { target().title = S.hooks[Number(c.dataset.hook)]; draw(); });
    $('#saveSnip').onclick = run(async () => { const t = target(); if (!t.body.trim()) throw new Error('Write a description first'); const name = prompt('Snippet name', 'My hashtags'); if (!name) return; await api.post('/api/snippets', { name, text: t.body.trim() }); snippets.splice(0, snippets.length, ...(await api.get('/api/snippets'))); toast('Snippet saved'); draw(); });
    mediaDrop($('#dz'), $('#file'), $('#pick'), $('#pg'), async ids => { lib.unshift(...(await api.get('/api/media')).filter(x => ids.includes(x.id))); S.media = ids[0]; draw(); });
    $('#send').onclick = run(async () => {
      const per = S.perOn ? S.per : {};
      await api.post('/api/posts', { media_id: S.media, title: S.title, body: S.body, per_app: per, account_ids: [...S.acc], when: S.when === 'at' ? S.at : S.when, options: { privacy: S.privacy, ai: S.ai, kids: S.kids, allowDuplicate: S.allowDup, ...(S.repeat ? { repeatDays: S.rDays, repeatTimes: S.rTimes } : {}) } });
      toast(S.when === 'now' ? 'Sending now' : 'Scheduled ✓');
      location.hash = 'upload/posts';
    });
  };
  draw();
};

function mediaDrop(dz, input, pick, pg, done) {
  if (!dz) return;
  const go = run(async files => {
    if (!files.length) return;
    pg.hidden = false;
    const r = await uploadFiles(files, p => { pg.firstChild.style.width = `${Math.round(p * 100)}%`; });
    pg.hidden = true; toast(`Added ${r.ids.length} video${r.ids.length > 1 ? 's' : ''}`);
    await done(r.ids);
  });
  pick && (pick.onclick = e => { e.preventDefault(); input.click(); });
  input.onchange = () => go([...input.files]);
  dz.ondragover = e => { e.preventDefault(); dz.classList.add('over'); };
  dz.ondragleave = () => dz.classList.remove('over');
  dz.ondrop = e => { e.preventDefault(); dz.classList.remove('over'); go([...e.dataTransfer.files]); };
}

function postDetail(t, after) {
  modal(`<h2>${esc(t.title || t.media_name)}</h2><p class="sub">${pf(t.platform, 1)} ${esc(t.account)} · ${fmtTime(t.run_at)}</p>
    <div class="row" style="gap:14px">${thumb(t.thumb)}<div>${tpill(t)} <span class="muted">tries: ${t.attempts}</span></div></div>
    ${t.error ? `<div class="rulebox">${esc(t.error)}</div><div id="expl"></div>${t.status === 'failed' ? `<button class="btn sm ai-btn" id="exb" style="margin-top:8px">✦ Explain this error</button>` : ''}` : ''}
    ${t.url && /^https?:/.test(t.url) ? `<p><a href="${esc(t.url)}" target="_blank" rel="noopener">Open the post ↗</a></p>` : ''}
    ${t.status === 'queued' ? `<label class="f">Move to</label><input class="in" type="datetime-local" id="mv" value="${toLocalInput(t.run_at)}">` : ''}
    <div class="foot">${t.status === 'queued' ? '<button class="btn danger" id="cx">Cancel post</button><button class="btn pri" id="sv">Save time</button>' : ''}${['failed', 'canceled'].includes(t.status) ? '<button class="btn pri" id="rt">Send again</button>' : ''}<button class="btn" data-close>Close</button></div>`, m => {
    $('#cx', m) && ($('#cx', m).onclick = run(async () => { await api.post(`/api/targets/${t.id}/cancel`); closeModal(); toast('Canceled'); after(); }));
    $('#sv', m) && ($('#sv', m).onclick = run(async () => { await api.patch(`/api/targets/${t.id}`, { run_at: new Date($('#mv', m).value).getTime() }); closeModal(); toast('Moved'); after(); }));
    $('#rt', m) && ($('#rt', m).onclick = run(async () => { await api.post(`/api/targets/${t.id}/retry`); closeModal(); toast('Sending again'); after(); }));
    $('#exb', m) && ($('#exb', m).onclick = run(async () => {
      await needAi(); $('#exb', m).textContent = '✦ Thinking…';
      const r = await api.post('/api/ai/explain', { kind: 'post', id: t.id });
      $('#expl', m).innerHTML = `<div class="ask-plan"><b>${esc(r.summary)}</b><ol style="margin:6px 0 0 18px;padding:0">${r.steps.map(s => `<li>${esc(s)}</li>`).join('')}</ol></div>`;
      $('#exb', m).remove();
    }));
  });
}

V['upload/calendar'] = async (el, params) => {
  let week = Number(params.w || 0), filter = params.p || '';
  const draw = async () => {
    const start = new Date(); start.setHours(0, 0, 0, 0); start.setDate(start.getDate() - ((start.getDay() + 6) % 7) + week * 7);
    const end = new Date(start); end.setDate(start.getDate() + 7);
    const rows = (await api.get(`/api/posts?from=${start.getTime()}&to=${end.getTime() - 1}`)).filter(t => !filter || t.platform === filter);
    const plats = [...new Set((await api.get('/api/accounts')).filter(a => a.can_upload).map(a => a.platform))];
    const today = new Date().toDateString();
    const days = [...Array(7)].map((_, i) => { const d = new Date(start); d.setDate(start.getDate() + i); return d; });
    el.innerHTML = `<div class="head"><div><h1>Calendar</h1><p class="sub">Drag a waiting post to another day. Click a post to see it.</p></div>
      <div class="row"><div class="seg"><button id="pw">‹</button><button class="on" id="tw">${week === 0 ? 'This week' : start.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}</button><button id="nw">›</button></div>
      <div class="seg"><button class="${!filter ? 'on' : ''}" data-f="">All</button>${plats.map(p => `<button class="${filter === p ? 'on' : ''}" data-f="${p}">${esc(p)}</button>`).join('')}</div>
      <button class="btn pri" data-go="upload/create">＋ Create</button></div></div>
      <div class="daycol">${days.map(d => { const list = rows.filter(t => new Date(t.run_at).toDateString() === d.toDateString()); return `<div class="day ${d.toDateString() === today ? 'today' : ''}" data-day="${d.getTime()}"><div class="dh">${d.toLocaleDateString(undefined, { weekday: 'short' })}<b>${d.getDate()}</b></div><div class="db">${list.map(t => `<div class="pcard ${t.status}" draggable="${t.status === 'queued'}" data-t="${t.id}"><div class="tm"><span>${pad(new Date(t.run_at).getHours())}:${pad(new Date(t.run_at).getMinutes())}</span>${pf(t.platform, 1)}</div><div class="tt">${esc(t.title || t.media_name)}</div></div>`).join('') || '<div class="hint" style="text-align:center;margin-top:20px">—</div>'}</div></div>`; }).join('')}</div>`;
    $('#pw').onclick = () => { week--; draw(); }; $('#nw').onclick = () => { week++; draw(); }; $('#tw').onclick = () => { week = 0; draw(); };
    $$('[data-f]', el).forEach(b => b.onclick = () => { filter = b.dataset.f; draw(); });
    $$('.pcard', el).forEach(c => {
      c.onclick = () => postDetail(rows.find(t => t.id === Number(c.dataset.t)), draw);
      c.ondragstart = e => e.dataTransfer.setData('text/plain', c.dataset.t);
    });
    $$('.day', el).forEach(d => {
      d.ondragover = e => { e.preventDefault(); d.classList.add('over'); };
      d.ondragleave = () => d.classList.remove('over');
      d.ondrop = run(async e => {
        e.preventDefault(); d.classList.remove('over');
        const t = rows.find(x => x.id === Number(e.dataTransfer.getData('text/plain'))); if (!t) return;
        const old = new Date(t.run_at), nd = new Date(Number(d.dataset.day)); nd.setHours(old.getHours(), old.getMinutes());
        if (nd.getTime() < Date.now()) throw new Error('That time has passed');
        await api.patch(`/api/targets/${t.id}`, { run_at: nd.getTime() }); toast('Moved'); draw();
      });
    });
  };
  await draw();
};

V['upload/posts'] = async (el, params) => {
  let s = params.s || 'queued,running';
  const draw = async () => {
    const rows = await api.get(`/api/posts?order=${s.startsWith('queued') ? 'asc' : 'desc'}${s ? `&status=${s}` : ''}`);
    const tabs = [['queued,running', 'Waiting'], ['done', 'Sent'], ['failed', 'Failed'], ['', 'All']];
    el.innerHTML = `<div class="head"><div><h1>All posts</h1><p class="sub">Every video, every account, one line each.</p></div><div class="row"><button class="btn" id="csv">⇪ Import CSV</button><button class="btn pri" data-go="upload/create">＋ Create post</button></div></div>
      <div class="seg" style="margin-bottom:14px">${tabs.map(([v, l]) => `<button class="${s === v ? 'on' : ''}" data-s="${v}">${l}</button>`).join('')}</div>
      <div class="card">${rows.length ? `<table class="tablex"><tr><th>Video</th><th>Account</th><th>When</th><th>Status</th><th></th></tr>${rows.map(t => `<tr data-t="${t.id}" style="cursor:pointer"><td><div class="row">${thumb(t.thumb)}<div><b>${esc(t.title || t.media_name)}</b><div class="hint" style="margin:0">${t.rule_id ? '⟳ autopilot' : 'manual'}</div></div></div></td><td><div class="row">${pf(t.platform, 1)}${esc(t.account)}</div></td><td class="muted">${fmtTime(t.status === 'done' ? t.done_at : t.run_at)}</td><td>${tpill(t)}${t.error ? `<div class="hint" style="max-width:280px">${esc(t.error)}</div>` : ''}</td><td>${t.url && /^https?:/.test(t.url) ? `<a href="${esc(t.url)}" target="_blank" rel="noopener">Open ↗</a>` : ''}</td></tr>`).join('')}</table>`
        : empty('Nothing here', s === 'failed' ? 'No failed posts. 🎉' : 'Posts you make show up here.')}</div>`;
    $$('[data-s]', el).forEach(b => b.onclick = () => { s = b.dataset.s; draw(); });
    $$('[data-t]', el).forEach(r => r.onclick = e => { if (e.target.closest('a')) return; postDetail(rows.find(t => t.id === Number(r.dataset.t)), draw); });
    $('#csv').onclick = () => modal(`<h2>Import posts from CSV</h2><p class="sub">One line per post. Paste it or pick a .csv file.</p>
      <div class="help">First line: <span class="code">file,title,description,accounts,when</span><br>
      <b>file</b> = path on the server, or <span class="code">#12</span> for library video 12<br>
      <b>accounts</b> = names, ids or <span class="code">group:Finance</span>, split by <span class="code">|</span><br>
      <b>when</b> = <span class="code">now</span>, <span class="code">slot</span> or <span class="code">2026-11-05 18:30</span><br>
      Optional: <span class="code">repeat_days</span>, <span class="code">repeat_times</span>, <span class="code">allow_repeat</span></div>
      <textarea class="in" id="cv" style="min-height:160px;font-family:ui-monospace,Consolas,monospace;font-size:12px;margin-top:10px" placeholder="file,title,description,accounts,when&#10;#3,Gold vs Bitcoin,Which won? #gold,group:Finance,slot"></textarea>
      <input type="file" id="cf" accept=".csv,text/csv" style="margin-top:8px"><div id="cr"></div>
      <div class="foot"><button class="btn" data-close>Close</button><button class="btn pri" id="cgo">Import</button></div>`, m => {
      $('#cf', m).onchange = async e => { $('#cv', m).value = await e.target.files[0].text(); };
      $('#cgo', m).onclick = run(async () => {
        const r = await api.post('/api/posts/csv', { csv: $('#cv', m).value });
        $('#cr', m).innerHTML = `<div class="check"><span class="dot ok"></span>${r.created.length} post${r.created.length === 1 ? '' : 's'} made</div>${r.errors.map(x => `<div class="check"><span class="dot bad"></span>Line ${x.line}: ${esc(x.error)}</div>`).join('')}`;
        if (r.created.length) draw();
      });
    });
  };
  await draw();
  return { poll: () => (s.startsWith('queued') ? draw() : Promise.resolve()) };
};

V['upload/autopilot'] = async el => {
  const draw = async () => {
    const [rules, accs] = await Promise.all([api.get('/api/rules'), api.get('/api/accounts')]);
    const byId = Object.fromEntries(accs.map(a => [a.id, a]));
    el.innerHTML = `<div class="head"><div><h1>Autopilot rules</h1><p class="sub">“A new video lands in this folder → post it.” Runs on the server, even when your PC is off.</p></div><button class="btn pri" id="new">＋ New rule</button></div>
      <div class="grid">${rules.map(r => `<div class="card rule">${tgl(r.enabled, `data-t="${r.id}"`)}<div><div style="font-weight:700;margin-bottom:8px">${esc(r.name)}</div><div class="flow">
        <span class="node">📁 ${esc(r.folder)}</span><span class="arrow">→</span><span class="node">Aa ${esc(r.title_tpl)}</span><span class="arrow">→</span><span class="node">⏱ ${r.options.when === 'now' ? 'Post now' : 'Next free slot'}</span><span class="arrow">→</span>
        <span class="node"><span class="stack">${r.account_ids.map(id => byId[id] ? pf(byId[id].platform, 1) : '').join('')}</span> ${r.account_ids.length} account${r.account_ids.length === 1 ? '' : 's'}</span></div></div>
        <div style="text-align:right"><div class="hint">${r.runs} run${r.runs === 1 ? '' : 's'} · last ${ago(r.last_run)}</div><div class="row" style="justify-content:flex-end;margin-top:6px"><button class="btn sm" data-e="${r.id}">Edit</button><button class="btn sm ghost" data-d="${r.id}">✕</button></div></div></div>`).join('')
        || empty('No rules yet', 'Point a rule at the folder where Automated Lunch Free saves videos. Each new video gets posted to your accounts.', '<button class="btn pri sm" id="new2">＋ New rule</button>')}</div>
      <div class="help" style="margin-top:16px"><b>Tip:</b> put a <span class="code">same-name.json</span> next to the video with <span class="code">{"title": "...", "description": "...", "tags": ["..."]}</span>. The rule uses it for the text.</div>`;
    const edit = r => ruleModal(r, accs, draw);
    $('#new').onclick = () => edit(null); $('#new2') && ($('#new2').onclick = () => edit(null));
    $$('[data-t]', el).forEach(t => t.onclick = run(async () => { await api.patch(`/api/rules/${t.dataset.t}`, { enabled: !t.classList.contains('on') }); draw(); }));
    $$('[data-e]', el).forEach(b => b.onclick = () => edit(rules.find(r => r.id === Number(b.dataset.e))));
    $$('[data-d]', el).forEach(b => b.onclick = run(async () => { if (!confirm('Delete this rule? Posts already made stay.')) return; await api.del(`/api/rules/${b.dataset.d}`); draw(); }));
  };
  await draw();
};
function ruleModal(r, accs, after) {
  const up = accs.filter(a => a.can_upload);
  const R = r ? { ...r, account_ids: new Set(r.account_ids) } : { name: '', folder: '', title_tpl: '{title}', body_tpl: '{description}\n\n{tags}', options: { when: 'slot', privacy: 'public', ai: false }, account_ids: new Set() };
  modal(`<h2>${r ? 'Edit rule' : 'New autopilot rule'}</h2><p class="sub">Watches a folder on the server. Only videos added after the rule is made get posted.</p>
    <label class="f">Name</label><input class="in" id="rn" value="${esc(R.name)}" placeholder="Automated Lunch Free → all">
    <label class="f">Folder on the server</label><input class="in" id="rf" value="${esc(R.folder)}" placeholder="/data/watch/exports">
    <div class="hint">Use the same folder your video maker saves into. In Docker this is <span class="code">/data/watch/…</span></div>
    <label class="f">Post to</label><div class="acc-grid">${up.map(a => `<div class="acc ${R.account_ids.has(a.id) ? 'on' : ''}" data-a="${a.id}">${pf(a.platform)}<div style="font-weight:600;font-size:13px">${esc(a.name)}</div><span class="ck">${R.account_ids.has(a.id) ? '✓' : ''}</span></div>`).join('') || '<div class="hint">Connect an account first.</div>'}</div>
    <div class="form-row"><div><label class="f">Title</label><input class="in" id="rt" value="${esc(R.title_tpl)}"></div><div><label class="f">When</label><select class="in" id="rw"><option value="slot" ${R.options.when !== 'now' ? 'selected' : ''}>Next free slot</option><option value="now" ${R.options.when === 'now' ? 'selected' : ''}>Right away</option></select></div></div>
    <label class="f">Description</label><textarea class="in" id="rb">${esc(R.body_tpl)}</textarea>
    <div class="hint">Words you can use: <span class="code">{title}</span> <span class="code">{description}</span> <span class="code">{tags}</span> <span class="code">{name}</span> <span class="code">{date}</span></div>
    <div class="check" style="margin-top:8px">${tgl(R.options.ai, 'id="rai"')} Mark as made with AI</div>
    <div class="check">${tgl(R.options.aiWrite, 'id="raw"')} ✦ AI writes the text when there is no .json</div>
    <div class="check">${tgl(R.options.aiThumb, 'id="rat"')} ✦ AI makes a thumbnail for each video</div>
    <div class="foot"><button class="btn" data-close>Cancel</button><button class="btn pri" id="rs">Save rule</button></div>`, m => {
    $$('[data-a]', m).forEach(c => c.onclick = () => { const id = Number(c.dataset.a); R.account_ids.has(id) ? R.account_ids.delete(id) : R.account_ids.add(id); c.classList.toggle('on'); $('.ck', c).textContent = c.classList.contains('on') ? '✓' : ''; });
    $('#rai', m).onclick = e => { R.options.ai = !R.options.ai; e.target.classList.toggle('on'); };
    $('#raw', m).onclick = e => { R.options.aiWrite = !R.options.aiWrite; e.target.classList.toggle('on'); };
    $('#rat', m).onclick = e => { R.options.aiThumb = !R.options.aiThumb; e.target.classList.toggle('on'); };
    $('#rs', m).onclick = run(async () => {
      const body = { name: $('#rn', m).value.trim(), folder: $('#rf', m).value.trim(), account_ids: [...R.account_ids], title_tpl: $('#rt', m).value, body_tpl: $('#rb', m).value, options: { ...R.options, when: $('#rw', m).value } };
      r ? await api.patch(`/api/rules/${r.id}`, { ...body, enabled: !!r.enabled }) : await api.post('/api/rules', body);
      closeModal(); toast('Rule saved'); after();
    });
  });
}

// ------------------------------------------------------------------ media library (used by both spaces)
async function libraryView(el) {
  const draw = async () => {
    const lib = await api.get('/api/media');
    el.innerHTML = `<div class="head"><div><h1>Media library</h1><p class="sub">Videos for posts and live stations. Shared by both.</p></div><button class="btn" id="imp">⇣ Add file already on server</button></div>
      <div class="dz" id="dz">Drop videos here or <a href="#" id="pick">choose files</a><input type="file" id="file" accept="video/*" multiple hidden><div class="prog-big" id="pg" hidden><span></span></div></div>
      <div class="lib" style="margin-top:14px">${lib.map(x => `<div class="mcard"><div class="tb">${x.thumb ? `<img src="${esc(x.thumb)}" alt="" loading="lazy">` : ''}</div>
        <div class="nm" title="${esc(x.name)}">${esc(x.name)}</div><div class="mt">${x.width}×${x.height} · ${fmtDur(x.duration)} · ${fmtBytes(x.size)}${x.has_audio ? '' : ' · no sound'}</div>
        <div class="row" style="justify-content:space-between;margin-top:6px">${x.prepare_state === 'ready' ? '<span class="pill ok">Live-ready</span>' : x.prepare_state === 'working' ? `<span class="pill warn">Preparing ${esc(x.prepare_msg)}</span>` : x.prepare_state === 'failed' ? `<span class="pill bad" title="${esc(x.prepare_msg)}">Prepare failed</span>` : x.prepare_state === 'queued' ? '<span class="pill">In line</span>' : `<span class="pill">${esc(x.source)}</span>`}<span class="row" style="gap:8px"><a href="#" class="hint" style="margin:0" data-ai="${x.id}" title="AI tools">✦ AI</a>${x.duration > 20 ? `<a href="#" class="hint" style="margin:0" data-sh="${x.id}" title="Cut into short vertical clips">✂ Shorts</a>` : ''}<a href="#upload/create?media=${x.id}" class="hint" style="margin:0">Post →</a></span></div>
        <button class="iconb x" data-d="${x.id}" title="Delete">✕</button></div>`).join('')}</div>
      ${lib.length ? '' : empty('No videos yet', 'Drop a video above, or let an autopilot rule pick them up.')}`;
    mediaDrop($('#dz'), $('#file'), $('#pick'), $('#pg'), draw);
    $('#imp').onclick = () => modal(`<h2>Add a file from the server</h2><p class="sub">For big files you copied to the VPS. Nothing is copied again.</p><label class="f">Full path</label><input class="in" id="ip" placeholder="/data/watch/exports/video.mp4"><div class="foot"><button class="btn" data-close>Cancel</button><button class="btn pri" id="ig">Add</button></div>`, m => {
      $('#ig', m).onclick = run(async () => { await api.post('/api/media/import', { path: $('#ip', m).value.trim() }); closeModal(); toast('Added'); draw(); });
    });
    $$('[data-d]', el).forEach(b => b.onclick = run(async e => { e.stopPropagation(); if (!confirm('Delete this video?')) return; await api.del(`/api/media/${b.dataset.d}`); draw(); }));
    $$('[data-ai]', el).forEach(b => b.onclick = e => {
      e.preventDefault();
      const m0 = lib.find(x => x.id === Number(b.dataset.ai));
      modal(`<h2>✦ AI tools</h2><p class="sub">${esc(m0.name)} · ${fmtDur(m0.duration)}</p>
        <div class="grid g2">
          <div class="card" style="padding:14px"><b>Speech to text</b><div class="hint">Writes down what is said. Makes AI text and shorts smarter.</div><button class="btn sm ai-btn" id="t1" style="margin-top:8px" ${m0.has_audio ? '' : 'disabled'}>✦ Transcribe</button><div id="t1o" class="mini"></div></div>
          <div class="card" style="padding:14px"><b>Burn captions</b><div class="hint">Makes a copy with captions on the video. Outline style, no big box.</div><button class="btn sm ai-btn" id="t2" style="margin-top:8px" ${m0.has_audio ? '' : 'disabled'}>✦ Add captions</button></div>
          <div class="card" style="padding:14px"><b>AI Shorts</b><div class="hint">AI finds the best moments, adds a hook and captions.</div>
            <div class="form-row" style="margin-top:6px"><input class="in" type="number" id="t3n" value="3" min="1" max="10" title="How many"><input class="in" type="number" id="t3s" value="30" min="5" max="90" title="Seconds each"></div>
            <button class="btn sm ai-btn" id="t3" style="margin-top:8px">✦ Make AI Shorts</button></div>
          <div class="card" style="padding:14px"><b>AI thumbnail</b><div class="hint">Picks the best frame, adds 2–4 big words and a number. Sent with YouTube posts.</div>
            <input class="in" id="t4w" placeholder="Words (empty = AI picks)" style="margin-top:6px"><button class="btn sm ai-btn" id="t4" style="margin-top:8px">✦ Make thumbnail</button><div id="t4o"></div></div>
        </div>
        <div class="foot"><button class="btn" data-close>Close</button></div>`, mm => {
        $('#t1', mm).onclick = run(async () => { const r = await aiJob(`/api/ai/transcribe/${m0.id}`, {}, 'Transcribing'); $('#t1o', mm).textContent = `${r.lines} lines saved`; toast('✦ Transcript saved'); });
        $('#t2', mm).onclick = run(async () => { closeModal(); await aiJob(`/api/ai/captions/${m0.id}`, {}, 'Adding captions'); toast('✦ Captioned copy added to the library'); draw(); });
        $('#t3', mm).onclick = run(async () => { const n = $('#t3n', mm).value, s0 = $('#t3s', mm).value; closeModal(); const r = await aiJob(`/api/ai/shorts/${m0.id}`, { count: n, seconds: s0 }, 'Finding the best moments'); toast(`✦ ${r.length} AI shorts added`); draw(); });
        $('#t4', mm).onclick = run(async () => { $('#t4', mm).textContent = '✦ Making…'; const r = await aiJob(`/api/ai/thumbnail/${m0.id}`, { words: $('#t4w', mm).value.trim() }, 'Making thumbnail'); $('#t4o', mm).innerHTML = `<img class="ai-thumb" src="${esc(r.url)}?t=${Date.now()}" alt="">`; $('#t4', mm).textContent = '✦ Make another'; });
      });
    });
    $$('[data-sh]', el).forEach(b => b.onclick = e => {
      e.preventDefault();
      const m0 = lib.find(x => x.id === Number(b.dataset.sh));
      modal(`<h2>Make Shorts</h2><p class="sub">Cuts <b>${esc(m0.name)}</b> (${fmtDur(m0.duration)}) into vertical clips, spread through the video.</p>
        <div class="form-row"><div><label class="f">How many clips</label><input class="in" type="number" id="sc" value="3" min="1" max="20"></div><div><label class="f">Seconds each</label><input class="in" type="number" id="ss" value="30" min="3" max="180"></div></div>
        <label class="f">Wide video becomes vertical by</label><select class="in" id="sm"><option value="crop">Cutting the middle (fills the screen)</option><option value="pad">Fitting it with a blurred background</option></select>
        <div class="foot"><button class="btn" data-close>Cancel</button><button class="btn pri" id="sgo">Make clips</button></div>`, m => {
        $('#sgo', m).onclick = run(async () => { await api.post(`/api/media/${m0.id}/shorts`, { count: $('#sc', m).value, seconds: $('#ss', m).value, mode: $('#sm', m).value }); closeModal(); toast('Making clips. They show up here in a minute.'); setTimeout(draw, 4000); setTimeout(draw, 15000); });
      });
    });
  };
  await draw();
  return { poll: async () => { if ($$('.pill.warn,.pill:not(.ok):not(.bad)', el).some(p => /Preparing|In line/.test(p.textContent))) await draw(); } };
}
V['upload/library'] = libraryView;
V['live/library'] = libraryView;

// ================================================================== AUTO LIVE
const DST = { live: ['ok', 'Live'], connecting: ['warn', 'Connecting'], retrying: ['warn', 'Retrying'], error: ['bad', 'Error'] };
const dpill = s => { const [c, l] = DST[s] || ['', s]; return `<span class="pill ${c}">${l}</span>`; };
const snapImg = s => s.runtime.running && s.snapshotAt ? `<img class="snap" src="/api/stations/${s.id}/snapshot.jpg?t=${Math.floor(s.snapshotAt)}" alt="">` : `<div class="idle">${s.runtime.running ? (s.runtime.note || 'Starting…') : 'Off'}</div>`;
const schedText = sc => sc.mode === 'always' ? 'Always on' : sc.mode === 'daily' ? `Daily ${sc.start}–${sc.end}` : 'Manual';

V['live/stations'] = async el => {
  const draw = async () => {
    const [st, sys, ev] = await Promise.all([api.get('/api/stations'), api.get('/api/system'), api.get('/api/events?area=live')]);
    const live = st.filter(s => s.runtime.running);
    const destLive = live.reduce((a, s) => a + s.runtime.pushers.filter(p => p.status === 'live').length, 0);
    const destAll = live.reduce((a, s) => a + s.runtime.pushers.length, 0);
    const fixed = ev.filter(e => e.at > new Date().setHours(0, 0, 0, 0) && /retry in/.test(e.msg)).length;
    el.innerHTML = `<div class="head"><div><h1>Stations</h1><p class="sub">Each station is one channel that plays your videos, sent to many accounts at once.</p></div><button class="btn pri" data-go="live/new">＋ New station</button></div>
      <div class="grid g4" style="margin-bottom:16px">
        <div class="card stat"><div class="k">Live now</div><div class="v" style="color:${live.length ? 'var(--lv)' : 'inherit'}">${live.length}</div><div class="d muted">of ${st.length} station${st.length === 1 ? '' : 's'}</div></div>
        <div class="card stat"><div class="k">Destinations healthy</div><div class="v">${destLive}<small style="font-size:14px;color:var(--tx3)"> / ${destAll}</small></div><div class="d ${destLive < destAll ? 'down' : 'muted'}">${destLive < destAll ? `${destAll - destLive} reconnecting` : 'all good'}</div></div>
        <div class="card stat"><div class="k">Upload used</div><div class="v">${fmtRate(sys.upKbps).split(' ')[0]}<small style="font-size:14px;color:var(--tx3)"> ${fmtRate(sys.upKbps).split(' ')[1]} of ${sys.maxUploadMbps} Mbps</small></div><div class="d muted">CPU ${sys.cpu}%</div></div>
        <div class="card stat"><div class="k">Auto-fixed today</div><div class="v">${fixed}</div><div class="d muted">drops that reconnected</div></div>
      </div>
      ${st.length ? `<div class="grid g2">${st.map(s => `<div class="card station" data-go="live/control?id=${s.id}" style="cursor:pointer"><div class="screen">${snapImg(s)}<div class="ovl"><div class="tl">${s.runtime.running ? `<span class="live-b">LIVE</span><span class="glass">${fmtUp(s.runtime.uptime)}</span>` : `<span class="glass">${schedText(s.schedule)}</span>`}</div><div class="row" style="justify-content:flex-end">${s.runtime.now ? `<span class="glass">▶ ${esc(s.runtime.now.name)}</span>` : ''}</div></div></div>
        <div class="st-body"><div class="row" style="justify-content:space-between"><div><div class="nm">${esc(s.name)}</div><div class="hint" style="margin:0">${s.playlistItems} video${s.playlistItems === 1 ? '' : 's'} · ${fmtDur(s.playlistDuration)} loop · ${esc(s.profile)}</div></div>${s.runtime.running ? `<button class="btn sm danger" data-stop="${s.id}">■ Stop</button>` : `<button class="btn sm" data-start="${s.id}">▶ Start</button>`}</div>
        <div class="dests">${s.destinations.map(d => { const p = s.runtime.pushers?.find(x => x.id === d.id); return `<span class="dest">${pf(d.platform, 1)}${esc(d.account || d.label)} ${!d.enabled ? '<span class="muted">off</span>' : p ? `<span class="dot ${p.status === 'live' ? 'ok' : 'warn'}"></span>${p.status === 'live' ? `${fmtRate(p.kbps)}` : esc(DST[p.status]?.[1] || p.status)}` : '<span class="dot"></span>'}</span>`; }).join('') || '<span class="hint">No destinations yet</span>'}</div>
        ${s.runtime.error || s.blockedBy ? `<div class="hint" style="color:var(--lv2)">⚠ ${esc(s.runtime.error || s.blockedBy)}</div>` : ''}</div></div>`).join('')}</div>`
        : empty('No stations yet', 'A station plays your videos on a loop and sends them live to many accounts at once.', '<button class="btn pri sm" data-go="live/new">＋ Make a station</button>')}`;
    $$('[data-start]', el).forEach(b => b.onclick = run(async e => { e.stopPropagation(); await api.post(`/api/stations/${b.dataset.start}/start`); toast('Starting…'); setTimeout(draw, 800); }));
    $$('[data-stop]', el).forEach(b => b.onclick = run(async e => { e.stopPropagation(); if (!confirm('Stop this station on all destinations?')) return; await api.post(`/api/stations/${b.dataset.stop}/stop`); toast('Stopped'); draw(); }));
  };
  await draw();
  return { poll: draw };
};

V['live/control'] = async (el, params) => {
  const id = Number(params.id);
  let s = await api.get(`/api/stations/${id}`);
  const [accs, lib, settings, allPl] = await Promise.all([api.get('/api/accounts'), api.get('/api/media'), api.get('/api/settings'), api.get('/api/playlists')]);
  const ov = { enabled: false, text: '', clock: false, logo: false, ...s.overlay };
  const extrasCard = () => `<div class="card"><h3>On screen and sound</h3>
    <div class="check" style="justify-content:space-between"><b>Overlay</b>${tgl(ov.enabled, 'id="xo"')}</div>
    <div class="hint" style="margin-top:0">Logo, text and clock on the video. Uses about 1 CPU core.</div>
    <label class="f">Text (changes live, no restart)</label><input class="in" id="xt" maxlength="200" value="${esc(ov.text)}" placeholder="Follow for daily market news">
    <label class="f">✦ AI line next to the text</label><select class="in" id="xam">
      <option value="off" ${ov.aiMode === 'off' || !ov.aiMode ? 'selected' : ''}>Off</option>
      <option value="ticker" ${ov.aiMode === 'ticker' ? 'selected' : ''}>Fresh fact / tip / question every few minutes</option>
      <option value="nowplaying" ${ov.aiMode === 'nowplaying' ? 'selected' : ''}>A line about each video as it starts</option></select>
    <div id="xai" style="${ov.aiMode === 'ticker' ? '' : 'display:none'}"><div class="form-row" style="grid-template-columns:2fr 1fr;margin-top:6px"><input class="in" id="xap" value="${esc(ov.aiPrompt || '')}" placeholder="Theme, like: Indonesian stock market"><input class="in" type="number" id="xae" min="1" max="120" value="${ov.aiEvery || 5}" title="Every N minutes"></div></div>
    <div class="mini" id="xaline" style="margin-top:4px"></div>
    <div class="check" style="justify-content:space-between">Clock ${tgl(ov.clock, 'id="xc"')}</div>
    <div class="check" style="justify-content:space-between">Logo (top right) ${tgl(ov.logo, 'id="xl"')}</div>
    <div class="row" style="margin-top:4px"><div class="logo-prev">${s.hasLogo ? `<img src="/api/stations/${id}/logo.png?t=${Date.now()}" alt="">` : '<span class="mini">no logo</span>'}</div><button class="btn sm" id="xlu">Upload logo</button>${s.hasLogo ? '<button class="iconb" id="xlr" title="Remove logo">✕</button>' : ''}<input type="file" id="xlf" accept="image/*" hidden></div>
    <label class="f">Background music</label><select class="in" id="xm"><option value="">None</option>${allPl.filter(p => p.id !== s.playlist_id).map(p => `<option value="${p.id}" ${p.id === s.music_playlist_id ? 'selected' : ''}>${esc(p.name)} (${p.items.length})</option>`).join('')}</select>
    <label class="f">Music volume <span class="limit" id="xvl">${Math.round((s.music_volume ?? 0.25) * 100)}%</span></label><input type="range" id="xv" min="0" max="100" value="${Math.round((s.music_volume ?? 0.25) * 100)}">
    <div class="check" style="justify-content:space-between;margin-top:6px"><b>Record the live</b>${tgl(s.record, 'id="xr"')}</div>
    <div class="hint" style="margin-top:0">Saves hour-long files on the server.</div>
    <button class="btn pri sm" id="xsave" style="margin-top:10px">Save</button>
    <div id="recs" style="margin-top:10px"></div></div>`;
  const bindExtras = () => {
    for (const [i, k] of [['#xo', 'enabled'], ['#xc', 'clock'], ['#xl', 'logo']]) $(i).onclick = e => { ov[k] = !ov[k]; e.target.classList.toggle('on'); };
    $('#xr').onclick = e => e.target.classList.toggle('on');
    $('#xam').onchange = e => { $('#xai').style.display = e.target.value === 'ticker' ? '' : 'none'; if (e.target.value !== 'off') { refreshAi().then(() => { if (!aiReady) toast('Set up AI in Settings first', true); }); } };
    $('#xv').oninput = e => { $('#xvl').textContent = `${e.target.value}%`; };
    $('#xlu').onclick = () => $('#xlf').click();
    $('#xlf').onchange = run(async e => {
      const fd = new FormData(); fd.append('logo', e.target.files[0]);
      const r = await fetch(`/api/stations/${id}/logo`, { method: 'POST', headers: { 'x-autocast': '1' }, body: fd });
      if (!r.ok) throw new Error((await r.json()).error || 'Upload failed');
      ov.logo = true; await api.patch(`/api/stations/${id}/extras`, { overlay: { ...ov } });
      s = await api.get(`/api/stations/${id}`); toast('Logo saved'); shell(); refresh();
    });
    $('#xlr') && ($('#xlr').onclick = run(async () => { await api.del(`/api/stations/${id}/logo`); s = await api.get(`/api/stations/${id}`); shell(); refresh(); }));
    $('#xsave').onclick = run(async () => {
      ov.text = $('#xt').value; ov.aiMode = $('#xam').value; ov.aiPrompt = $('#xap').value; ov.aiEvery = Number($('#xae').value) || 5;
      const r = await api.patch(`/api/stations/${id}/extras`, { overlay: { ...ov }, music_playlist_id: $('#xm').value ? Number($('#xm').value) : null, music_volume: Number($('#xv').value) / 100, record: $('#xr').classList.contains('on') });
      toast(r.reloaded ? 'Saved. Restarting the picture (a few seconds).' : 'Saved'); refresh();
    });
  };
  const shell = () => {
    el.innerHTML = `<div class="head"><div><div class="row"><h1>${esc(s.name)}</h1><span id="hb"></span></div><p class="sub" id="hs"></p></div>
      <div class="row" id="hbtn"></div></div>
      <div class="control">
        <div class="grid">
          <div class="card"><h3>Playlist <small id="loop"></small></h3><div id="queue"></div><button class="btn sm" id="addv" style="margin-top:10px;width:100%;justify-content:center">＋ Add videos</button></div>
          <div class="card"><h3>When it runs</h3>
            <select class="in" id="sm"><option value="manual">Manual (Start / Stop buttons)</option><option value="always">Always on (24/7)</option><option value="daily">Every day between…</option></select>
            <div class="form-row" id="sd" style="margin-top:8px"><input class="in" type="time" id="ss"><input class="in" type="time" id="se"></div>
            <label class="f">Quality</label><select class="in" id="pq">${settings.profiles.map(p => `<option ${p === s.profile ? 'selected' : ''}>${p}</option>`).join('')}</select>
            <div class="hint">“v” = vertical (for TikTok / Instagram live).</div>
            <button class="btn pri sm" id="ssave" style="margin-top:10px">Save</button>
          </div>
          ${extrasCard()}
        </div>
        <div class="grid">
          <div class="card" style="padding:12px"><div class="screen" style="border-radius:10px" id="pv"></div><div class="kv" id="kv"></div></div>
          <div class="card"><h3>Log <small>this station</small></h3><div class="log" id="log"></div></div>
        </div>
        <div class="card"><h3>Destinations <small id="dc"></small></h3><div id="dl"></div>
          <div class="row" style="margin-top:12px"><select class="in" id="addd"><option value="">＋ Add destination…</option>${accs.filter(a => a.can_live).map(a => `<option value="${a.id}">${esc(a.label)} · ${esc(a.name)}</option>`).join('')}</select></div>
          <div class="hint">Need another? <a href="#shared/accounts">Add a stream key</a>.</div>
          <div class="rulebox">⚠ TikTok and Facebook may punish replayed video shown as live. Use them only for streams with a real live part.</div>
        </div>
      </div>
      <div style="margin-top:16px;text-align:right"><button class="btn ghost sm" id="delst" style="color:var(--lv2)">Delete station</button></div>`;
    const sc = s.schedule;
    $('#sm').value = sc.mode || 'manual'; $('#ss').value = sc.start || '08:00'; $('#se').value = sc.end || '23:00';
    const showD = () => { $('#sd').style.display = $('#sm').value === 'daily' ? '' : 'none'; };
    $('#sm').onchange = showD; showD();
    $('#ssave').onclick = run(async () => {
      const mode = $('#sm').value;
      await api.patch(`/api/stations/${id}`, { schedule: mode === 'daily' ? { mode, start: $('#ss').value, end: $('#se').value } : { mode }, profile: $('#pq').value });
      toast('Saved'); refresh();
    });
    $('#addd').onchange = run(async e => { if (!e.target.value) return; await api.post(`/api/stations/${id}/destinations`, { account_id: Number(e.target.value) }); e.target.value = ''; toast('Destination added'); refresh(); });
    $('#addv').onclick = () => pickVideos(lib, async ids => { await api.post(`/api/playlists/${s.playlist_id}/items`, { media_ids: ids }); toast('Added. The playlist reloads in a moment.'); refresh(); });
    $('#delst').onclick = run(async () => { if (!confirm('Delete this station? Videos stay in the library.')) return; await api.del(`/api/stations/${id}`); location.hash = 'live/stations'; });
    bindExtras();
  };
  const refresh = async () => {
    s = await api.get(`/api/stations/${id}`);
    const rt = s.runtime;
    const [pls, ev] = await Promise.all([api.get('/api/playlists'), api.get('/api/events?area=live')]);
    const pl = pls.find(p => p.id === s.playlist_id) || { items: [] };
    $('#hb').innerHTML = rt.running ? '<span class="live-b">LIVE</span>' : '<span class="pill">Off</span>';
    $('#hs').textContent = rt.running ? `Up ${fmtUp(rt.uptime)} · ${s.profile} · ${schedText(s.schedule)}${rt.note ? ' · ' + rt.note : ''}` : `${schedText(s.schedule)} · ${s.profile}`;
    $('#hbtn').innerHTML = rt.running ? '<button class="btn" id="skip">⏮ Restart playlist</button><button class="btn danger" id="stop">■ Stop</button>' : '<button class="btn pri" id="start">▶ Go live</button>';
    $('#start') && ($('#start').onclick = run(async () => { await api.post(`/api/stations/${id}/start`); toast('Starting…'); setTimeout(refresh, 800); }));
    $('#stop') && ($('#stop').onclick = run(async () => { if (!confirm('Stop on all destinations?')) return; await api.post(`/api/stations/${id}/stop`); toast('Stopped'); refresh(); }));
    $('#skip') && ($('#skip').onclick = run(async () => { await api.post(`/api/stations/${id}/skip`); toast('Restarting from the first video'); }));
    $('#loop').textContent = `${pl.items.length} video${pl.items.length === 1 ? '' : 's'} · loops forever`;
    $('#queue').innerHTML = pl.items.map((it, i) => { const now = rt.now && rt.now.index === i; return `<div class="q ${now ? 'now' : ''}"><span class="n">${now ? '▶' : i + 1}</span>${thumb(`/files/thumbs/${it.media_id}.jpg`)}<div class="grow"><div style="font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:130px">${esc(it.name)}</div><div class="hint" style="margin:0">${fmtDur(it.duration)}${it.prepare_state !== 'ready' ? ` · ${esc(it.prepare_state === 'working' ? 'preparing ' + it.prepare_msg : it.prepare_state)}` : ''}</div>${now ? `<div class="prog"><span style="width:${rt.now.pct.toFixed(1)}%"></span></div>` : ''}</div><div class="qbtns"><button class="iconb" data-up="${i}" title="Move up">↑</button><button class="iconb" data-rm="${it.id}" title="Remove">✕</button></div></div>`; }).join('') || empty('Empty playlist', 'Add videos to play.');
    $$('[data-rm]', el).forEach(b => b.onclick = run(async () => { await api.del(`/api/playlist-items/${b.dataset.rm}`); refresh(); }));
    $$('[data-up]', el).forEach(b => b.onclick = run(async () => { const i = Number(b.dataset.up); if (!i) return; const ids = pl.items.map(x => x.id); [ids[i - 1], ids[i]] = [ids[i], ids[i - 1]]; await api.post(`/api/playlists/${pl.id}/order`, { ids }); refresh(); }));
    $('#pv').innerHTML = snapImg(s) + (rt.running ? `<div class="ovl"><div class="tl"><span class="live-b">LIVE</span></div><div class="row" style="justify-content:space-between">${rt.now ? `<span class="glass">▶ ${esc(rt.now.name)} · ${fmtDur(rt.now.pos)} / ${fmtDur(rt.now.duration)}</span>` : '<span></span>'}<span class="glass">preview every 10 s</span></div></div>` : '');
    const totalKbps = rt.running ? rt.pushers.reduce((a, p) => a + p.kbps, 0) : 0;
    if ($('#xaline')) $('#xaline').textContent = rt.aiLine ? `On screen now: ${rt.aiLine}` : '';
    const recs = s.record ? await api.get(`/api/stations/${id}/recordings`) : [];
    $('#recs').innerHTML = recs.length ? `<div class="mini" style="margin-bottom:4px">${recs.length} recording${recs.length > 1 ? 's' : ''}</div>${recs.slice(0, 5).map(r => `<div class="row" style="justify-content:space-between;font-size:12px;padding:3px 0"><span>${new Date(r.at).toLocaleString()} · ${fmtBytes(r.size)}</span><a href="/files/recordings/${encodeURIComponent(r.name)}">Download</a></div>`).join('')}` : '';
    $('#kv').innerHTML = `<div><small>Sending out</small><b>${fmtRate(totalKbps)}</b></div><div><small>Encoder</small><b>${rt.running ? (rt.encoder.up ? (rt.encoder.mode === 'overlay' ? 'overlay' : 'copy ✓') + (rt.encoder.music ? ' + ♫' : '') : 'restarting') : '—'}</b></div><div><small>Uptime</small><b>${rt.running ? fmtUp(rt.uptime) : '—'}</b></div><div><small>Quality</small><b>${esc(s.profile)}</b></div>`;
    $('#dc').textContent = `${s.destinations.filter(d => d.enabled).length} on`;
    $('#dl').innerHTML = s.destinations.map(d => { const p = rt.running ? rt.pushers.find(x => x.id === d.id) : null; return `<div class="dl">${pf(d.platform)}<div><div style="font-weight:600;font-size:13px">${esc(d.account || d.label)}</div><div class="hint" style="margin:0">${!d.enabled ? 'Turned off' : p ? (p.status === 'live' ? `${fmtRate(p.kbps)}ps · since ${fmtUp(Date.now() - p.since)}` : esc(p.error || 'connecting')) + (p.drops ? ` · ${p.drops} drop${p.drops > 1 ? 's' : ''} fixed` : '') : 'Waiting for start'}</div></div><div style="text-align:right;display:grid;gap:6px;justify-items:end">${p ? dpill(p.status) : ''}<div class="row" style="gap:6px">${tgl(d.enabled, `data-den="${d.id}" title="On / off"`)}<button class="iconb" data-dd="${d.id}" title="Remove">✕</button></div></div></div>`; }).join('') || '<div class="hint">No destinations yet. Pick one below.</div>';
    $$('[data-den]', el).forEach(t => t.onclick = run(async () => { await api.patch(`/api/destinations/${t.dataset.den}`, { enabled: !t.classList.contains('on') }); refresh(); }));
    $$('[data-dd]', el).forEach(b => b.onclick = run(async () => { if (!confirm('Remove this destination?')) return; await api.del(`/api/destinations/${b.dataset.dd}`); refresh(); }));
    const mine = ev.filter(e => e.ref === String(id)).slice(0, 40);
    $('#log').innerHTML = mine.map(e => `<div class="${e.level === 'warn' ? 'w' : e.level === 'error' ? 'e' : ''}">${new Date(e.at).toLocaleTimeString()}  ${esc(e.msg)}</div>`).join('') || '<div class="muted">Nothing yet.</div>';
  };
  shell(); await refresh();
  return { poll: refresh };
};

function pickVideos(lib, done) {
  const sel = new Set();
  modal(`<h2>Add videos</h2><p class="sub">They get prepared once for live, then play with almost no CPU.</p>
    <div class="lib" style="grid-template-columns:repeat(auto-fill,minmax(140px,1fr));max-height:50vh;overflow:auto">${lib.map(x => `<div class="mcard" data-v="${x.id}"><div class="tb">${x.thumb ? `<img src="${esc(x.thumb)}" alt="">` : ''}</div><div class="nm">${esc(x.name)}</div><div class="mt">${fmtDur(x.duration)}</div></div>`).join('') || '<div class="hint">Library is empty. Upload videos first.</div>'}</div>
    <div class="foot"><button class="btn" data-close>Cancel</button><button class="btn pri" id="vok">Add</button></div>`, m => {
    $$('[data-v]', m).forEach(c => c.onclick = () => { const id = Number(c.dataset.v); sel.has(id) ? sel.delete(id) : sel.add(id); c.classList.toggle('on'); $('#vok', m).textContent = `Add ${sel.size || ''}`; });
    $('#vok', m).onclick = run(async () => { if (!sel.size) return; await done([...sel]); closeModal(); });
  });
}

V['live/new'] = async el => {
  const [lib, accs, settings] = await Promise.all([api.get('/api/media'), api.get('/api/accounts'), api.get('/api/settings')]);
  const live = accs.filter(a => a.can_live);
  const S = { name: '', profile: settings.defaultProfile, media: new Set(), acc: new Set(), mode: 'manual', start: '08:00', end: '23:00' };
  const draw = () => {
    const dur = lib.filter(m => S.media.has(m.id)).reduce((a, m) => a + m.duration, 0);
    const P = { '720p30': 3, '1080p30': 6, '1080p60': 9, '720p30v': 3, '1080p30v': 6 }[S.profile] || 6;
    el.innerHTML = `<div class="wiz">
    <div class="head"><div><h1>New station</h1><p class="sub">Pick what plays, where it goes, and when. You can change all of it later.</p></div></div>
    <div class="types">
      <div class="type on"><div class="screen" style="aspect-ratio:16/7"><div class="scene lofi"></div></div><div class="tb"><b>Video loop</b><small>Plays your videos in order, forever.</small><div style="margin-top:8px"><span class="pill ok">Ready</span></div></div></div>
      <div class="type dis"><span class="pill soon">Coming next</span><div class="screen" style="aspect-ratio:16/7"><div class="scene ai"></div></div><div class="tb"><b>AI host</b><small>AI talks, reads chat, shows clips.</small></div></div>
      <div class="type dis"><span class="pill soon">Coming next</span><div class="screen" style="aspect-ratio:16/7"><div class="scene game"></div></div><div class="tb"><b>AI plays game</b><small>A bot plays a web game live.</small></div></div>
    </div>
    <div class="card" style="margin-top:16px"><h3>1. What plays <small>${S.media.size} video${S.media.size === 1 ? '' : 's'} · ${fmtDur(dur)} loop</small></h3>
      <div class="form-row"><div><label class="f">Station name</label><input class="in" id="nm" value="${esc(S.name)}" placeholder="Lofi Finance Radio 24/7"></div>
      <div><label class="f">Quality</label><select class="in" id="pq">${settings.profiles.map(p => `<option ${p === S.profile ? 'selected' : ''}>${p}</option>`).join('')}</select></div></div>
      <label class="f">Videos</label>
      ${lib.length ? `<div class="lib" style="grid-template-columns:repeat(auto-fill,minmax(140px,1fr))">${lib.map(x => `<div class="mcard ${S.media.has(x.id) ? 'on' : ''}" data-v="${x.id}"><div class="tb">${x.thumb ? `<img src="${esc(x.thumb)}" alt="">` : ''}</div><div class="nm">${esc(x.name)}</div><div class="mt">${fmtDur(x.duration)}</div></div>`).join('')}</div>`
        : empty('No videos yet', 'Upload videos to the library first.', '<button class="btn sm" data-go="live/library">Open library</button>')}
    </div>
    <div class="card" style="margin-top:16px"><h3>2. Where it goes <small>${S.acc.size} picked</small></h3>
      ${live.length ? `<div class="dest-pick">${live.map(a => `<div class="acc ${S.acc.has(a.id) ? 'on' : ''}" data-a="${a.id}">${pf(a.platform)}<div><div style="font-weight:600;font-size:13px">${esc(a.name)}</div><div class="hint" style="margin:0">${esc(a.label)}</div></div><span class="ck">${S.acc.has(a.id) ? '✓' : ''}</span></div>`).join('')}</div>`
        : empty('No live accounts yet', 'Add a stream key (YouTube, Twitch, Kick, TikTok, Facebook, any RTMP).', '<button class="btn pri sm" data-go="shared/accounts">Add stream key</button>')}
    </div>
    <div class="card" style="margin-top:16px"><h3>3. When</h3>
      <div class="when">${[['manual', 'Manual', 'You press Go live'], ['always', 'Always on', '24/7, restarts by itself'], ['daily', 'Every day', 'Between two times']].map(([v, b, s]) => `<div class="opt ${S.mode === v ? 'on' : ''}" data-w="${v}" style="cursor:pointer"><b>${b}</b><small>${s}</small></div>`).join('')}</div>
      ${S.mode === 'daily' ? `<div class="form-row" style="margin-top:10px"><input class="in" type="time" id="ts" value="${S.start}"><input class="in" type="time" id="te" value="${S.end}"></div>` : ''}
    </div>
    <div class="sumbar"><div class="row"><span class="pill ac">Video loop</span><span class="pill">${S.acc.size} destination${S.acc.size === 1 ? '' : 's'}</span><span class="pill">~${P * S.acc.size} Mbps upload</span><span class="pill">${esc(S.profile)}</span></div><button class="btn pri" id="mk">Create station</button></div>
    </div>`;
    $('#nm').oninput = e => { S.name = e.target.value; };
    $('#pq').onchange = e => { S.profile = e.target.value; draw(); };
    $$('[data-v]', el).forEach(c => c.onclick = () => { const id = Number(c.dataset.v); S.media.has(id) ? S.media.delete(id) : S.media.add(id); draw(); });
    $$('[data-a]', el).forEach(c => c.onclick = () => { const id = Number(c.dataset.a); S.acc.has(id) ? S.acc.delete(id) : S.acc.add(id); draw(); });
    $$('[data-w]', el).forEach(c => c.onclick = () => { S.mode = c.dataset.w; draw(); });
    $('#ts') && ($('#ts').onchange = e => { S.start = e.target.value; }); $('#te') && ($('#te').onchange = e => { S.end = e.target.value; });
    $('#mk').onclick = run(async () => {
      if (!S.name.trim()) throw new Error('Give the station a name');
      if (!S.media.size) throw new Error('Pick at least one video');
      const r = await api.post('/api/stations', { name: S.name.trim(), profile: S.profile, media_ids: [...S.media], account_ids: [...S.acc], schedule: S.mode === 'daily' ? { mode: 'daily', start: S.start, end: S.end } : { mode: S.mode } });
      toast('Station made. Videos are being prepared.'); location.hash = `live/control?id=${r.id}`;
    });
  };
  draw();
};

V['live/playlists'] = async el => {
  const draw = async () => {
    const [pls, lib] = await Promise.all([api.get('/api/playlists'), api.get('/api/media')]);
    el.innerHTML = `<div class="head"><div><h1>Playlists</h1><p class="sub">What stations play. Each station has one.</p></div></div>
      <div class="grid g3">${pls.map(p => `<div class="card"><h3>${esc(p.name)} <small>${p.items.length} video${p.items.length === 1 ? '' : 's'}</small></h3>
        <div class="hint" style="margin:-8px 0 10px">${p.stations.length ? 'Used by ' + p.stations.map(s => `<a href="#live/control?id=${s.id}">${esc(s.name)}</a>`).join(', ') : 'Not used'}</div>
        <div class="list">${p.items.slice(0, 6).map(it => `<div class="li">${thumb(`/files/thumbs/${it.media_id}.jpg`)}<div class="grow"><div class="t" style="font-size:13px">${esc(it.name)}</div><div class="s">${fmtDur(it.duration)}</div></div>${it.prepare_state === 'ready' ? '<span class="pill ok">ready</span>' : `<span class="pill">${esc(it.prepare_state)}</span>`}</div>`).join('')}${p.items.length > 6 ? `<div class="hint">+ ${p.items.length - 6} more</div>` : ''}</div>
        <div class="row" style="justify-content:space-between;margin-top:10px"><div class="check">${tgl(p.shuffle, `data-sh="${p.id}"`)} Shuffle</div><button class="btn sm" data-add="${p.id}">＋ Add videos</button></div>
        <div class="row" style="justify-content:space-between;margin-top:8px"><span class="mini" title="${esc(p.folder)}">${p.folder ? `📁 Auto-adds from ${esc(p.folder.split(/[\\/]/).slice(-2).join('/'))}` : 'No folder linked'}</span><button class="btn sm ghost" data-fold="${p.id}">${p.folder ? 'Change' : '📁 Link folder'}</button></div></div>`).join('') || empty('No playlists yet', 'Making a station makes its playlist.', '<button class="btn pri sm" data-go="live/new">＋ New station</button>')}</div>`;
    $$('[data-sh]', el).forEach(t => t.onclick = run(async () => { await api.patch(`/api/playlists/${t.dataset.sh}`, { shuffle: !t.classList.contains('on') }); draw(); }));
    $$('[data-add]', el).forEach(b => b.onclick = () => pickVideos(lib, async ids => { await api.post(`/api/playlists/${b.dataset.add}/items`, { media_ids: ids }); toast('Added'); draw(); }));
    $$('[data-fold]', el).forEach(b => b.onclick = () => {
      const p = pls.find(x => x.id === Number(b.dataset.fold));
      modal(`<h2>Link a folder</h2><p class="sub">New videos in this folder join <b>${esc(p.name)}</b> by themselves, even while live.</p>
        <label class="f">Folder on the server</label><input class="in" id="pf" value="${esc(p.folder || '')}" placeholder="/data/watch/live">
        <div class="check">${tgl(false, 'id="pex"')} Also add the videos already in it</div>
        <div class="hint">Leave empty to unlink.</div>
        <div class="foot"><button class="btn" data-close>Cancel</button><button class="btn pri" id="pfs">Save</button></div>`, m => {
        $('#pex', m).onclick = e => e.target.classList.toggle('on');
        $('#pfs', m).onclick = run(async () => { await api.patch(`/api/playlists/${p.id}/folder`, { folder: $('#pf', m).value.trim(), include_existing: $('#pex', m).classList.contains('on') }); closeModal(); toast('Folder saved'); setTimeout(draw, 1500); });
      });
    });
  };
  await draw();
};

V['live/schedule'] = async el => {
  const st = await api.get('/api/stations');
  el.innerHTML = `<div class="head"><div><h1>Live schedule</h1><p class="sub">When each station turns on and off. Times use the server clock.</p></div></div>
    <div class="card">${st.length ? `<table class="tablex"><tr><th>Station</th><th>Mode</th><th>From</th><th>To</th><th>Now</th><th></th></tr>${st.map(s => `<tr data-id="${s.id}"><td><b>${esc(s.name)}</b></td><td><select class="in" style="width:170px" data-k="mode">${['manual', 'always', 'daily'].map(m => `<option value="${m}" ${s.schedule.mode === m ? 'selected' : ''}>${{ manual: 'Manual', always: 'Always on', daily: 'Every day' }[m]}</option>`).join('')}</select></td><td><input class="in" type="time" data-k="start" value="${s.schedule.start || '08:00'}" style="width:120px"></td><td><input class="in" type="time" data-k="end" value="${s.schedule.end || '23:00'}" style="width:120px"></td><td>${s.runtime.running ? '<span class="pill bad"><span class="dot live"></span>Live</span>' : '<span class="pill">Off</span>'}</td><td><button class="btn sm pri" data-save>Save</button></td></tr>`).join('')}</table>` : empty('No stations', 'Make a station first.')}</div>`;
  $$('[data-save]', el).forEach(b => b.onclick = run(async () => {
    const tr = b.closest('tr'); const v = k => $(`[data-k="${k}"]`, tr).value; const mode = v('mode');
    await api.patch(`/api/stations/${tr.dataset.id}`, { schedule: mode === 'daily' ? { mode, start: v('start'), end: v('end') } : { mode } });
    toast('Saved');
  }));
};

// ================================================================== SHARED
V['shared/accounts'] = async (el, params) => {
  if (params.error) toast(params.error, true);
  if (params.added) toast(`Connected ${params.added} account${params.added > 1 ? 's' : ''} ✓`);
  if (params.error || params.added) history.replaceState(null, '', '#shared/accounts');
  const draw = async () => {
    const [accs, plats, settings] = await Promise.all([api.get('/api/accounts'), api.get('/api/platforms'), api.get('/api/settings')]);
    const has = { google: !!settings.apps.google.clientId, meta: !!settings.apps.meta.appId, tiktok: !!settings.apps.tiktok.clientKey };
    const C = [['google', 'youtube', 'YouTube', 'Google login · posts + live'], ['meta', 'facebook', 'Facebook + Instagram', 'Meta login · Pages + IG Business'], ['tiktok', 'tiktok', 'TikTok', 'TikTok login · posts']];
    el.innerHTML = `<div class="head"><div><h1>Accounts</h1><p class="sub">Log in once. Both Auto Upload and Auto Live use these.</p></div><div class="row"><button class="btn" id="mock">＋ Test account</button><button class="btn pri" id="key">＋ Stream key</button></div></div>
      <div class="grid g4" style="margin-bottom:16px">${C.map(([app, p, n, d]) => `<div class="card acc-card" style="padding:14px">${pf(p)}<div style="flex:1"><div style="font-weight:700">${n}</div><div class="hint" style="margin:0">${d}</div></div>${has[app] ? `<a class="btn sm pri" href="/oauth/${app}/start">Log in</a>` : `<a class="btn sm" href="#shared/settings" title="Add the app key first">Set up</a>`}</div>`).join('')}
        <div class="card acc-card" style="padding:14px">${pf('rtmp')}<div style="flex:1"><div style="font-weight:700">Any live app</div><div class="hint" style="margin:0">Twitch, Kick, TikTok LIVE, IG LIVE, X, RTMP</div></div><button class="btn sm" id="key2">Add key</button></div></div>
      <div class="card"><h3>Connected <small>${accs.length}</small></h3>${accs.length ? `<table class="tablex"><tr><th>Account</th><th>Group</th><th>Used for</th><th>Login</th><th>Post times</th><th></th></tr>
        ${accs.map(a => `<tr><td><div class="row">${pf(a.platform)}<div><b>${esc(a.name)}</b><div class="hint" style="margin:0">${esc(a.label)}</div></div></div></td><td><span class="chip" data-grp="${a.id}" style="cursor:pointer">${esc(a.grp || '＋ group')}</span></td>
        <td>${[a.can_upload && 'Upload', a.can_live && 'Live'].filter(Boolean).join(' · ')}</td>
        <td>${a.status === 'ok' ? `<span class="pill ok">${a.kind === 'stream_key' ? 'Key saved' : a.kind === 'mock' ? 'Test' : a.expires_at ? 'Good · auto-refresh' : 'Good'}</span>` : `<span class="pill warn" title="${esc(a.status_msg)}">Log in again</span>`}</td>
        <td>${a.can_upload ? `<span class="chip" data-slots="${a.id}" style="cursor:pointer">${a.slots.join(' · ') || 'any time'}</span>${a.daily_max ? `<div class="mini">max ${a.daily_max}/day</div>` : ''}` : '<span class="muted">—</span>'}</td>
        <td style="text-align:right">${a.can_upload ? `<button class="iconb" data-opt="${a.id}" title="Video format and daily limit">⚙</button> ` : ''}${a.status !== 'ok' && a.kind === 'oauth' ? `<a class="btn sm pri" href="/oauth/${{ youtube: 'google', facebook: 'meta', instagram: 'meta', tiktok: 'tiktok' }[a.platform]}/start">Log in</a> ` : ''}<button class="iconb" data-del="${a.id}" title="Remove">✕</button></td></tr>`).join('')}</table>`
        : empty('No accounts yet', 'Log in with YouTube, Meta or TikTok above, or add a stream key for live.')}</div>`;
    const keyModal = () => {
      const lp = plats.filter(p => p.live && !p.oauth && p.id !== 'mock');
      modal(`<h2>Add a stream key</h2><p class="sub">Find it in the app's live or creator studio.</p>
        <label class="f">App</label><select class="in" id="kp">${lp.map(p => `<option value="${p.id}" data-s="${esc(p.defaultServer)}">${esc(p.label)}</option>`).join('')}</select>
        <label class="f">Name (for you)</label><input class="in" id="kn" placeholder="My Twitch">
        <label class="f">Server URL</label><input class="in" id="ks" placeholder="rtmp://…"><div class="hint">Filled in for you. Change it if the app shows a different one.</div>
        <label class="f">Stream key</label><input class="in" id="kk" type="password" autocomplete="off"><div class="hint">Saved locked (encrypted) on your server. Never shown again.</div>
        <label class="f">Group (optional)</label><input class="in" id="kg" placeholder="Games">
        <div class="foot"><button class="btn" data-close>Cancel</button><button class="btn pri" id="ksv">Save</button></div>`, m => {
        const fill = () => { $('#ks', m).value = $('#kp', m).selectedOptions[0].dataset.s; };
        $('#kp', m).onchange = fill; fill();
        $('#ksv', m).onclick = run(async () => { await api.post('/api/accounts/key', { platform: $('#kp', m).value, name: $('#kn', m).value.trim(), server: $('#ks', m).value.trim(), key: $('#kk', m).value.trim(), grp: $('#kg', m).value.trim() }); closeModal(); toast('Stream key saved'); draw(); });
      });
    };
    $('#key').onclick = keyModal; $('#key2').onclick = keyModal;
    $('#mock').onclick = () => modal(`<h2>Test account</h2><p class="sub">A fake account for trying the app. Posts are saved to the server's <span class="code">data/mock-out</span> folder.</p>
      <label class="f">Name</label><input class="in" id="mn" value="Test account"><label class="f">Live test server (optional)</label><input class="in" id="ml" placeholder="rtmp://127.0.0.1:1935/test">
      <div class="foot"><button class="btn" data-close>Cancel</button><button class="btn pri" id="msv">Add</button></div>`, m => {
      $('#msv', m).onclick = run(async () => { await api.post('/api/accounts/mock', { name: $('#mn', m).value, live: $('#ml', m).value.trim() || undefined }); closeModal(); draw(); });
    });
    $$('[data-grp]', el).forEach(c => c.onclick = run(async () => { const a = accs.find(x => x.id === Number(c.dataset.grp)); const g = prompt('Group name (empty to clear)', a.grp || ''); if (g === null) return; await api.patch(`/api/accounts/${a.id}`, { grp: g.trim() }); draw(); }));
    $$('[data-slots]', el).forEach(c => c.onclick = run(async () => { const a = accs.find(x => x.id === Number(c.dataset.slots)); const v = prompt('Post times, comma separated (24h)', a.slots.join(', ')); if (v === null) return; await api.patch(`/api/accounts/${a.id}`, { slots: v.split(',').map(s => s.trim()).filter(Boolean).map(s => s.padStart(5, '0')) }); draw(); }));
    $$('[data-del]', el).forEach(b => b.onclick = run(async () => { if (!confirm('Remove this account? Its waiting posts and live destinations are removed too.')) return; await api.del(`/api/accounts/${b.dataset.del}`); draw(); }));
    $$('[data-opt]', el).forEach(b => b.onclick = () => {
      const a = accs.find(x => x.id === Number(b.dataset.opt));
      modal(`<h2>${esc(a.name)}</h2><p class="sub">${esc(a.label)}</p>
        <label class="f">Video shape</label><select class="in" id="of">
          <option value="auto" ${a.fmt === 'auto' ? 'selected' : ''}>Auto (9:16 for TikTok and Instagram, as-is for others)</option>
          <option value="vertical" ${a.fmt === 'vertical' ? 'selected' : ''}>Always vertical 9:16</option>
          <option value="original" ${a.fmt === 'original' ? 'selected' : ''}>Always as-is</option></select>
        <div class="hint">Wide videos get a blurred background, not black bars.</div>
        <label class="f">Post times</label><div class="row"><input class="in" id="osl" value="${esc(a.slots.join(', '))}"><button class="btn sm ai-btn" id="osa" title="AI suggests good times for this app">✦ Suggest</button></div><div class="hint" id="osw"></div>
        <label class="f">Most posts per day (0 = no limit)</label><input class="in" type="number" id="od" min="0" max="50" value="${a.daily_max}">
        <div class="hint">“Next free slot” skips days that are full. Helps avoid spam flags.</div>
        <div class="foot"><button class="btn" data-close>Cancel</button><button class="btn pri" id="osv">Save</button></div>`, m => {
        $('#osa', m).onclick = run(async () => { await needAi(); $('#osa', m).textContent = '✦ …'; const r = await api.post('/api/ai/slots', { account_id: a.id }); $('#osl', m).value = r.slots.join(', '); $('#osw', m).textContent = `✦ ${r.why}`; $('#osa', m).textContent = '✦ Suggest'; });
        $('#osv', m).onclick = run(async () => {
          await api.patch(`/api/accounts/${a.id}/options`, { fmt: $('#of', m).value, daily_max: Number($('#od', m).value) });
          await api.patch(`/api/accounts/${a.id}`, { slots: $('#osl', m).value.split(',').map(s => s.trim()).filter(Boolean).map(s => s.padStart(5, '0')) });
          closeModal(); toast('Saved'); draw();
        });
      });
    });
  };
  await draw();
};

V['shared/settings'] = async el => {
  const [s, sys] = await Promise.all([api.get('/api/settings'), api.get('/api/system')]);
  const uri = a => s.redirects.find(r => r.app === a)?.uri || '';
  const copy = v => `<div class="copy"><input class="in" readonly value="${esc(v)}"><button class="btn sm" data-copy="${esc(v)}">Copy</button></div>`;
  el.innerHTML = `<div class="head"><div><h1>Settings</h1><p class="sub">Set once. Most people never come back here.</p></div></div>
  ${!sys.publicUrl ? '<div class="rulebox" style="margin:0 0 16px">⚠ <b>PUBLIC_URL</b> is not set. App logins need your HTTPS address, like <span class="code">https://cast.yourdomain.com</span>. Set it in the server .env file.</div>' : ''}
  <div class="grid g2">
    <div class="card"><h3>${pf('youtube', 1)} Google app <small>for YouTube login</small></h3>
      <div class="help"><ol><li>Open <a href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noopener">Google Cloud → Credentials</a></li><li>Turn on <b>YouTube Data API v3</b></li><li>Make an <b>OAuth client ID</b> (Web app)</li><li>Paste this redirect URI:</li></ol></div>${copy(uri('google'))}
      <div class="form-row"><div><label class="f">Client ID</label><input class="in" data-app="google.clientId" value="${esc(s.apps.google.clientId)}"></div><div><label class="f">Client secret</label><input class="in" type="password" data-app="google.clientSecret" value="${esc(s.apps.google.clientSecret)}"></div></div>
      <div class="hint">Until Google checks your app, uploads stay private and logins expire after 7 days in “testing”.</div></div>
    <div class="card"><h3>${pf('facebook', 1)} Meta app <small>for Facebook + Instagram</small></h3>
      <div class="help"><ol><li>Open <a href="https://developers.facebook.com/apps" target="_blank" rel="noopener">Meta for Developers</a> → Create app (Business)</li><li>Add <b>Facebook Login</b> and <b>Instagram Graph API</b></li><li>Paste this redirect URI:</li></ol></div>${copy(uri('meta'))}
      <div class="form-row"><div><label class="f">App ID</label><input class="in" data-app="meta.appId" value="${esc(s.apps.meta.appId)}"></div><div><label class="f">App secret</label><input class="in" type="password" data-app="meta.appSecret" value="${esc(s.apps.meta.appSecret)}"></div></div>
      <div class="hint">Instagram must be a Business or Creator account linked to a Facebook Page.</div></div>
    <div class="card"><h3>${pf('tiktok', 1)} TikTok app <small>for TikTok posts</small></h3>
      <div class="help"><ol><li>Open <a href="https://developers.tiktok.com/apps" target="_blank" rel="noopener">TikTok for Developers</a> → Create app</li><li>Add <b>Login Kit</b> + <b>Content Posting API</b> (Direct Post)</li><li>Paste this redirect URI:</li></ol></div>${copy(uri('tiktok'))}
      <div class="form-row"><div><label class="f">Client key</label><input class="in" data-app="tiktok.clientKey" value="${esc(s.apps.tiktok.clientKey)}"></div><div><label class="f">Client secret</label><input class="in" type="password" data-app="tiktok.clientSecret" value="${esc(s.apps.tiktok.clientSecret)}"></div></div>
      <div class="hint">Until TikTok audits your app, posts go up as private.</div></div>
    <div class="card"><h3>Alerts <small>Telegram</small></h3>
      <div class="form-row"><div><label class="f">Bot token</label><input class="in" type="password" id="tt" value="${esc(s.alerts.token)}" placeholder="from @BotFather"></div><div><label class="f">Chat ID</label><input class="in" id="tc" value="${esc(s.alerts.chatId)}"></div></div>
      <div class="check" style="justify-content:space-between">When a post fails ${tgl(s.alerts.onPostFail, 'id="a1"')}</div>
      <div class="check" style="justify-content:space-between">When a live destination keeps dropping ${tgl(s.alerts.onLiveDrop, 'id="a2"')}</div>
      <button class="btn sm" id="ta">Send test alert</button></div>
    <div class="card"><h3>Live and storage</h3>
      <div class="form-row"><div><label class="f">Default live quality</label><select class="in" id="dp">${s.profiles.map(p => `<option ${p === s.defaultProfile ? 'selected' : ''}>${p}</option>`).join('')}</select></div><div><label class="f">Your VPS upload limit (Mbps)</label><input class="in" type="number" id="mu" value="${s.maxUploadMbps}"></div></div>
      <div class="form-row"><div><label class="f">Monthly data limit (TB)</label><input class="in" type="number" step="0.5" id="mt" value="${s.monthlyTB}"></div><div><label class="f">Delete old unused videos after (days, 0 = never)</label><input class="in" type="number" id="rd" value="${s.retentionDays}"></div></div></div>
    <div class="card"><h3>Server</h3>
      <table class="tablex"><tr><td>Version</td><td>${esc(sys.version)}</td></tr><tr><td>CPU</td><td>${sys.cores} cores · ${sys.cpu}%</td></tr><tr><td>RAM</td><td>${fmtBytes(sys.mem.total - sys.mem.free)} / ${fmtBytes(sys.mem.total)}</td></tr><tr><td>Disk free</td><td>${sys.disk ? fmtBytes(sys.disk.free) : '—'}</td></tr><tr><td>Live relay</td><td>${sys.relay ? '<span class="pill ok">Running</span>' : '<span class="pill bad">Off</span>'}</td></tr><tr><td>FFmpeg</td><td>${sys.ffmpeg ? '<span class="pill ok">OK</span>' : '<span class="pill bad">Missing</span>'}</td></tr><tr><td>Public URL</td><td>${esc(sys.publicUrl || 'not set')}</td></tr></table>
      <button class="btn sm" id="pw" style="margin-top:12px">Change password</button></div>
  </div>
  <div class="card" style="margin-top:16px" id="aicard"><h3>✦ AI <small id="aistat"></small></h3>
    <div class="hint" style="margin-top:-6px">Works with any OpenAI-style service. Pick one, or paste your own (like your OmniRoute on the VPS).</div>
    <div class="chips" style="margin:10px 0">${[['OmniRoute', 'http://127.0.0.1:20128/v1', ''], ['OpenAI', 'https://api.openai.com/v1', 'gpt-4o-mini'], ['Gemini', 'https://generativelanguage.googleapis.com/v1beta/openai', 'gemini-2.5-flash'], ['OpenRouter', 'https://openrouter.ai/api/v1', 'openai/gpt-4o-mini'], ['Ollama', 'http://127.0.0.1:11434/v1', 'llama3.1']].map(([n, u, m]) => `<span class="chip preset" data-u="${u}" data-m="${m}">${n}</span>`).join('')}</div>
    <div class="form-row"><div><label class="f">Base URL</label><input class="in" id="abu" placeholder="https://…/v1"></div><div><label class="f">API key</label><input class="in" type="password" id="akey" autocomplete="off"></div></div>
    <div class="form-row" style="grid-template-columns:1fr 1fr 1fr"><div><label class="f">Text model</label><input class="in" id="amd" placeholder="gpt-4o-mini"></div><div><label class="f">Vision model (sees frames)</label><input class="in" id="avm" placeholder="same or empty"></div><div><label class="f">Speech-to-text model</label><input class="in" id="ast" placeholder="whisper-1"></div></div>
    <div class="form-row" style="grid-template-columns:1fr 1fr 1fr"><div><label class="f">Language for AI text</label><input class="in" id="alg" placeholder="English"></div>
      <div><label class="f">Safety check before posting</label><select class="in" id="asf"><option value="off">Off</option><option value="warn">Warn (log it, still post)</option><option value="block">Block risky posts</option></select></div>
      <div><label class="f">Daily AI report at</label><select class="in" id="adh"><option value="-1">Off</option>${[...Array(24)].map((_, h) => `<option value="${h}">${pad(h)}:00</option>`).join('')}</select></div></div>
    <div class="row" style="margin-top:12px"><button class="btn pri sm" id="asv">Save AI</button><button class="btn sm" id="ats">Test</button><span class="mini" id="aus"></span></div></div>
  <div class="grid g2" style="margin-top:16px">
    <div class="card"><h3>Push from your PC <small>for Automated Lunch Free</small></h3>
      <div class="hint" style="margin-top:-6px">A small script on your PC sends every new video here, with its .json text.</div>
      <div id="toks" style="margin-top:8px"></div>
      <div class="row" style="margin-top:10px"><input class="in" id="tn" placeholder="Name, like My PC"><button class="btn sm pri" id="tmk">Make token</button></div>
      <div id="tnew"></div></div>
    <div class="card"><h3>Posting rules</h3>
      <label class="f">Block the same video to the same account within (days, 0 = off)</label><input class="in" type="number" id="dd" min="0" value="${s.dupDays}">
      <div class="hint">Stops spam-looking repeats. You can still tick “Allow repeat” on a post.</div>
      <h3 style="margin-top:18px">Backup</h3>
      <div class="hint" style="margin-top:-6px">Downloads the database: accounts, posts, stations, settings. Keep your <span class="code">AUTOCAST_SECRET</span> too, or saved logins can't be read.</div>
      <a class="btn sm" href="/api/backup" style="margin-top:10px">⇩ Download backup</a></div>
  </div>
  <div class="sumbar"><span class="muted">Secrets are stored encrypted on your server.</span><button class="btn pri" id="save">Save settings</button></div>`;
  const loadAi = async () => {
    const a = await refreshAi();
    $('#abu').value = a.baseUrl || ''; $('#akey').value = a.apiKey || ''; $('#amd').value = a.model || ''; $('#avm').value = a.visionModel || ''; $('#ast').value = a.sttModel || ''; $('#alg').value = a.lang || '';
    $('#asf').value = a.safety || 'off'; $('#adh').value = String(a.digestHour ?? -1);
    $('#aistat').innerHTML = a.ready ? '<span class="pill ok">Ready</span>' : '<span class="pill">Not set</span>';
    $('#aus').textContent = a.usage ? `This month: ${a.usage.calls} calls · ${(a.usage.in + a.usage.out).toLocaleString()} tokens` : '';
  };
  loadAi();
  $$('.preset', el).forEach(c => c.onclick = () => { $('#abu').value = c.dataset.u; if (c.dataset.m) $('#amd').value = c.dataset.m; });
  const saveAi = () => api.post('/api/ai/settings', { baseUrl: $('#abu').value, apiKey: $('#akey').value, model: $('#amd').value, visionModel: $('#avm').value, sttModel: $('#ast').value, lang: $('#alg').value, safety: $('#asf').value, digestHour: $('#adh').value });
  $('#asv').onclick = run(async () => { await saveAi(); await loadAi(); toast('AI saved'); });
  $('#ats').onclick = run(async () => { await saveAi(); $('#ats').textContent = 'Testing…'; try { const r = await api.post('/api/ai/test'); toast(`✦ AI answered in ${r.ms} ms: ${r.reply}`); } finally { $('#ats').textContent = 'Test'; loadAi(); } });
  const drawTokens = async () => {
    const t = await api.get('/api/tokens');
    $('#toks').innerHTML = t.map(x => `<div class="dl" style="grid-template-columns:1fr auto auto"><div><b>${esc(x.name)}</b><div class="mini">made ${ago(x.created)} · used ${ago(x.last_used)}</div></div><span></span><button class="iconb" data-tk="${x.id}" title="Delete token">✕</button></div>`).join('') || '<div class="mini">No tokens yet.</div>';
    $$('[data-tk]', el).forEach(b => b.onclick = run(async () => { if (!confirm('Delete this token? The PC script using it stops working.')) return; await api.del(`/api/tokens/${b.dataset.tk}`); drawTokens(); }));
  };
  drawTokens();
  $('#tmk').onclick = run(async () => {
    const { token } = await api.post('/api/tokens', { name: $('#tn').value.trim() || 'My PC' });
    const server = sys.publicUrl || location.origin;
    $('#tnew').innerHTML = `<div class="rulebox" style="display:block">Copy it now. It is shown only once.</div><div class="token-box" style="margin-top:8px">${esc(token)}</div>
      <label class="f">Run on your PC (in the AutoCast tools folder)</label><div class="token-box">node push.js --server ${esc(server)} --token ${esc(token)} --folder "C:\\path\\to\\exports" --accounts "group:Finance ID" --when slot --skip-existing</div>`;
    drawTokens();
  });
  $$('[data-copy]', el).forEach(b => b.onclick = () => { navigator.clipboard?.writeText(b.dataset.copy); toast('Copied'); });
  $$('.tgl', el).forEach(t => t.onclick = () => t.classList.toggle('on'));
  $('#save').onclick = run(async () => {
    const apps = {}; $$('[data-app]', el).forEach(i => { const [a, k] = i.dataset.app.split('.'); (apps[a] ||= {})[k] = i.value.trim(); });
    await api.post('/api/settings', { apps, alerts: { token: $('#tt').value.trim(), chatId: $('#tc').value.trim(), onPostFail: $('#a1').classList.contains('on'), onLiveDrop: $('#a2').classList.contains('on') }, default_profile: $('#dp').value, max_upload_mbps: $('#mu').value, monthly_tb: $('#mt').value, retention_days: $('#rd').value, dup_days: $('#dd').value });
    toast('Settings saved');
  });
  $('#ta').onclick = run(async () => { await api.post('/api/settings/test-alert'); toast('Test sent (if token and chat ID are right)'); });
  $('#pw').onclick = () => modal(`<h2>Change password</h2><label class="f">Old password</label><input class="in" type="password" id="po"><label class="f">New password</label><input class="in" type="password" id="pn"><div class="hint">Other browsers get logged out.</div><div class="foot"><button class="btn" data-close>Cancel</button><button class="btn pri" id="ps">Change</button></div>`, m => {
    $('#ps', m).onclick = run(async () => { await api.post('/api/password', { old: $('#po', m).value, password: $('#pn', m).value }); closeModal(); toast('Password changed'); showGate(); });
  });
};

V['shared/activity'] = async el => {
  const F = { area: '', level: '', q: '' };
  const shell = () => {
    el.innerHTML = `<div class="head"><div><h1>Activity log</h1><p class="sub">Everything the server did: posts, lives, logins, errors.</p></div></div>
      <div class="row" style="margin-bottom:14px;flex-wrap:wrap">
        <div class="seg">${[['', 'All'], ['upload', 'Upload'], ['live', 'Live'], ['accounts', 'Accounts'], ['media', 'Media']].map(([v, l]) => `<button data-ar="${v}" class="${F.area === v ? 'on' : ''}">${l}</button>`).join('')}</div>
        <div class="seg">${[['', 'Any'], ['error,warn', 'Problems'], ['error', 'Errors']].map(([v, l]) => `<button data-lv="${v}" class="${F.level === v ? 'on' : ''}">${l}</button>`).join('')}</div>
        <input class="in" id="aq" placeholder="Search…" style="width:240px" value="${esc(F.q)}"></div>
      <div class="card" id="evs"></div>`;
    $$('[data-ar]', el).forEach(b => b.onclick = () => { F.area = b.dataset.ar; shell(); list(); });
    $$('[data-lv]', el).forEach(b => b.onclick = () => { F.level = b.dataset.lv; shell(); list(); });
    let tm; $('#aq').oninput = e => { clearTimeout(tm); tm = setTimeout(() => { F.q = e.target.value; list(); }, 300); };
  };
  const list = async () => {
    const qs = new URLSearchParams(Object.entries({ ...F, limit: 300 }).filter(([, v]) => v)).toString();
    const ev = await api.get(`/api/events?${qs}`);
    $('#evs').innerHTML = ev.map(e => `<div class="ev-row"><span class="muted">${new Date(e.at).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span><span class="lvl ${e.level}">${esc(e.level)}</span><span class="muted">${esc(e.area)}</span><span>${esc(e.msg)}</span></div>`).join('') || '<div class="sub">Nothing found.</div>';
  };
  shell(); await list();
  return { poll: list };
};

// ------------------------------------------------------------------ boot
(async () => { if (await showGate()) { render(); sidebar(); } })();
