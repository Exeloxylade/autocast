// AI features. Every prompt starts with "TASK:<name>" so logs and tests can tell them apart.
const fs = require('fs');
const path = require('path');
const ai = require('./client');
const { DATA, FFMPEG, FONT_FILE } = require('../config');
const { get, all, run, event, setting, setSetting } = require('../db');
const media = require('../media');

const LIMITS = { youtube: 'title max 100 chars, description up to 5000, 3-5 hashtags', tiktok: 'one caption max 2200 chars, hook first line, 3-6 hashtags', instagram: 'Reels caption max 2200, short lines, emojis ok, 5-10 hashtags', facebook: 'title max 255, friendly description, 1-3 hashtags', x: 'one post max 280 chars incl hashtags', threads: 'max 500 chars, casual', mock: 'title max 100, description up to 500' };
const lang = () => ai.cfg().lang || 'English';
const tdir = path.join(DATA, 'transcripts'); fs.mkdirSync(tdir, { recursive: true });
const athumb = path.join(DATA, 'thumbs_ai'); fs.mkdirSync(athumb, { recursive: true });
const fesc = p => p.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'");
const clean = s => String(s ?? '').replace(/\s+\n/g, '\n').trim();

// ------------------------------------------------------------- transcripts
const transcriptFile = id => path.join(tdir, `${id}.json`);
function transcript(id) { try { return JSON.parse(fs.readFileSync(transcriptFile(id), 'utf8')); } catch { return null; } }
const transcriptText = (id, max = 6000) => { const t = transcript(id); return t ? t.map(s => s.text).join(' ').slice(0, max) : ''; };

async function transcribeMedia(id) {
  const m = get('SELECT * FROM media WHERE id=?', id);
  if (!m) throw new Error('media not found');
  if (!m.has_audio) throw new Error('This video has no sound');
  const dir = path.join(tdir, `tmp_${id}_${Date.now()}`); fs.mkdirSync(dir);
  try {
    // 16 kHz mono mp3 in 10-minute parts: small enough for every speech API.
    await media.sh(FFMPEG, ['-y', '-v', 'error', '-i', m.file, '-vn', '-ac', '1', '-ar', '16000', '-b:a', '32k', '-f', 'segment', '-segment_time', '600', path.join(dir, 'part%03d.mp3')]);
    const parts = fs.readdirSync(dir).filter(f => f.endsWith('.mp3')).sort();
    const segs = [];
    for (let i = 0; i < parts.length; i++) segs.push(...await ai.transcribe(path.join(dir, parts[i]), i * 600));
    fs.writeFileSync(transcriptFile(id), JSON.stringify(segs));
    event('ai', 'info', `transcribed ${m.name}: ${segs.length} lines`, id);
    return segs;
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

// Short caption lines (max ~6 words), timed in proportion to their length.
function captionLines(segs, from = 0, to = Infinity) {
  const out = [];
  for (const s of segs) {
    if (s.end <= from || s.start >= to) continue;
    const words = s.text.split(/\s+/).filter(Boolean);
    const chunks = []; for (let i = 0; i < words.length; i += 6) chunks.push(words.slice(i, i + 6).join(' '));
    const total = chunks.reduce((a, c) => a + c.length, 0) || 1;
    let t = s.start;
    for (const c of chunks) { const d = (s.end - s.start) * (c.length / total); out.push({ start: t, end: t + d, text: c }); t += d; }
  }
  return out.filter(l => l.end > from && l.start < to).map(l => ({ start: Math.max(0, l.start - from), end: Math.min(to, l.end) - from, text: l.text }));
}
const srtTime = s => { const ms = Math.round(s * 1000); const h = Math.floor(ms / 3600000), m = Math.floor(ms / 60000) % 60, x = Math.floor(ms / 1000) % 60; return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(x).padStart(2, '0')},${String(ms % 1000).padStart(3, '0')}`; };
const toSRT = lines => lines.map((l, i) => `${i + 1}\n${srtTime(l.start)} --> ${srtTime(l.end)}\n${l.text}\n`).join('\n');
// Outline captions, no big box (keeps the picture visible).
const capFilter = (srt, h) => `subtitles='${fesc(srt)}':force_style='Fontname=Arial,Bold=1,Fontsize=${h > 1200 ? 14 : 18},PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,BorderStyle=1,Outline=2,Shadow=0,Alignment=2,MarginV=${h > 1200 ? 70 : 30}'`;

async function burnCaptions(id) {
  const m = get('SELECT * FROM media WHERE id=?', id);
  if (!m) throw new Error('media not found');
  const segs = transcript(id) || await transcribeMedia(id);
  const srt = path.join(tdir, `${id}.srt`); fs.writeFileSync(srt, toSRT(captionLines(segs)));
  const base = path.basename(m.name, path.extname(m.name));
  const out = path.join(DATA, 'media', `${Date.now()}_${base}_captions.mp4`);
  await media.sh(FFMPEG, ['-y', '-v', 'error', '-i', m.file, '-vf', capFilter(srt, m.height), '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-c:a', 'copy', '-movflags', '+faststart', out]);
  const nm = await media.addFile(out, `${base} · captions.mp4`, 'ai');
  run('UPDATE media SET parent_id=? WHERE id=?', id, nm.id);
  fs.copyFileSync(transcriptFile(id), transcriptFile(nm.id));
  return nm.id;
}

// ------------------------------------------------------------- frames for vision
async function frames(m, n = 4, width = 512) {
  const dir = path.join(athumb, `f_${m.id}_${Date.now()}`); fs.mkdirSync(dir);
  // Grab all frames at once (each is a fast seek), not one after another.
  const files = [...Array(n)].map((_, i) => ({ f: path.join(dir, `${i}.jpg`), t: Math.max(0, (m.duration * (i + 0.5)) / n) }));
  await Promise.all(files.map(x => media.sh(FFMPEG, ['-y', '-v', 'error', '-ss', x.t.toFixed(2), '-i', m.file, '-frames:v', '1', '-vf', `scale=${width}:-2`, '-q:v', '4', x.f])));
  return { dir, files };
}
const hasVision = () => !!ai.cfg().visionModel;

// ------------------------------------------------------------- 1-3. write, hooks, per-app
async function writePost(id, { topic = '', platforms = [], tone = 'clear, curious, not clickbait' } = {}) {
  const m = get('SELECT * FROM media WHERE id=?', id);
  if (!m) throw new Error('media not found');
  const plats = [...new Set(platforms.length ? platforms : ['youtube', 'tiktok', 'instagram', 'facebook'])];
  const said = transcriptText(id);
  let fr = null;
  try { if (hasVision() && !said) fr = await frames(m, 3, 384); } catch {}
  try {
    const r = await ai.chat({
      system: `TASK:write_post. You write social media text for a video. Language: ${lang()}. Tone: ${tone}. Never invent facts that are not in the input. Reply as JSON:
{"title": "...", "description": "2-4 short sentences", "hashtags": ["#a","#b"], "hooks": ["5 different title options"], "per_app": {${plats.map(p => `"${p}": {"title": "...", "body": "..."}`).join(', ')}}}
Rules per app: ${plats.map(p => `${p}: ${LIMITS[p] || LIMITS.mock}`).join('; ')}.`,
      user: `File name: ${m.name}\nLength: ${Math.round(m.duration)} s, ${m.width}x${m.height}\n${topic ? `Topic from the user: ${topic}\n` : ''}${said ? `What is said in the video: ${said}\n` : ''}${fr ? 'Frames from the video are attached.' : ''}`,
      images: fr ? fr.files.map(x => x.f) : [],
    });
    const out = {
      title: clean(r.title).slice(0, 100), description: clean(r.description),
      hashtags: (r.hashtags || []).map(h => '#' + String(h).replace(/^#+/, '').replace(/\s+/g, '')).filter(h => h.length > 1).slice(0, 12),
      hooks: (r.hooks || []).map(clean).filter(Boolean).slice(0, 5),
      per_app: {},
    };
    for (const p of plats) if (r.per_app?.[p]) out.per_app[p] = { title: clean(r.per_app[p].title).slice(0, p === 'youtube' ? 100 : 2200), body: clean(r.per_app[p].body) };
    event('ai', 'info', `wrote text for ${m.name}`, id);
    return out;
  } finally { if (fr) fs.rmSync(fr.dir, { recursive: true, force: true }); }
}

async function rewriteFor({ title, body, platforms }) {
  const plats = [...new Set(platforms || [])];
  if (!plats.length) throw new Error('Pick accounts first');
  const r = await ai.chat({
    system: `TASK:rewrite. Rewrite the post for each app so it fits its style and limits. Keep the meaning and facts. Language: same as input. Reply JSON {"per_app": {"<app>": {"title": "...", "body": "..."}}}. Rules: ${plats.map(p => `${p}: ${LIMITS[p] || LIMITS.mock}`).join('; ')}`,
    user: `Title: ${title}\nDescription: ${body}`,
  });
  const out = {};
  for (const p of plats) if (r.per_app?.[p]) out[p] = { title: clean(r.per_app[p].title), body: clean(r.per_app[p].body) };
  return out;
}

// ------------------------------------------------------------- 4. translate
async function translate({ title, body, to }) {
  if (!to) throw new Error('Pick a language');
  const r = await ai.chat({ system: `TASK:translate. Translate to ${to}. Keep hashtags (translate the words only if natural), emojis, names and numbers. Reply JSON {"title":"...","body":"..."}`, user: `Title: ${title}\nDescription: ${body}`, temperature: 0.2 });
  return { title: clean(r.title), body: clean(r.body) };
}

// ------------------------------------------------------------- 7. AI shorts
async function aiShorts(id, { count = 3, seconds = 30, captions = true } = {}) {
  const m = get('SELECT * FROM media WHERE id=?', id);
  if (!m) throw new Error('media not found');
  count = Math.max(1, Math.min(10, Number(count) || 3)); seconds = Math.max(5, Math.min(90, Number(seconds) || 30));
  const segs = transcript(id) || (m.has_audio ? await transcribeMedia(id) : []);
  const lines = segs.map(s => `[${s.start.toFixed(1)}-${s.end.toFixed(1)}] ${s.text}`).join('\n').slice(0, 14000);
  const r = await ai.chat({
    system: `TASK:pick_shorts. Pick the ${count} best moments for short vertical clips (about ${seconds} s each, between ${Math.round(seconds * 0.6)} and ${Math.round(seconds * 1.5)} s). Best = a strong hook in the first 3 seconds, one complete idea, a number or surprise. Do not overlap. Language: ${lang()}. Reply JSON {"clips":[{"start":0,"end":30,"hook":"short on-screen hook","title":"post title"}]}`,
    user: `Video length ${Math.round(m.duration)} s. Transcript with times:\n${lines || '(no speech)'}`,
    temperature: 0.4,
  });
  const vertical = m.height >= m.width;
  const vf0 = vertical ? 'scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2' : 'crop=min(iw\\,ih*9/16):ih,scale=1080:1920';
  const base = path.basename(m.name, path.extname(m.name));
  const outIds = [];
  const picks = (r.clips || []).map(c => ({ start: Math.max(0, Number(c.start) || 0), end: Math.min(m.duration, Number(c.end) || 0), hook: clean(c.hook).slice(0, 60), title: clean(c.title).slice(0, 100) }))
    .filter(c => c.end - c.start >= 3).sort((a, b) => a.start - b.start).slice(0, count);
  if (!picks.length) throw new Error('AI found no good moments');
  for (let i = 0; i < picks.length; i++) {
    const c = picks[i];
    const filters = [vf0];
    if (c.hook) filters.push(`drawtext=fontfile='${fesc(FONT_FILE)}':expansion=none:text='${c.hook.replace(/\\/g, ' ').replace(/'/g, '’').replace(/:/g, '\\:')}':fontcolor=white:fontsize=64:borderw=5:bordercolor=black:x=(w-tw)/2:y=h*0.16:enable='lt(t,3.5)'`);
    let srt = null;
    if (captions && segs.length) { srt = path.join(tdir, `${id}_s${i}.srt`); fs.writeFileSync(srt, toSRT(captionLines(segs, c.start, c.end))); filters.push(capFilter(srt, 1920)); }
    filters.push('setsar=1', 'format=yuv420p');
    const out = path.join(DATA, 'media', `${Date.now()}_${base}_ai${i + 1}.mp4`);
    await media.sh(FFMPEG, ['-y', '-v', 'error', '-ss', c.start.toFixed(2), '-t', (c.end - c.start).toFixed(2), '-i', m.file, '-vf', filters.join(','), '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', ...(m.has_audio ? ['-c:a', 'aac', '-b:a', '160k'] : []), '-movflags', '+faststart', out]);
    if (srt) fs.rmSync(srt, { force: true });
    const nm = await media.addFile(out, `${c.title || base} · AI short ${i + 1}.mp4`, 'ai');
    run('UPDATE media SET parent_id=? WHERE id=?', id, nm.id);
    // sidecar so autopilot / push use the AI title
    fs.writeFileSync(out.replace(/\.mp4$/, '.json'), JSON.stringify({ title: c.title, description: c.hook, from: m.name, start: c.start, end: c.end }));
    outIds.push({ id: nm.id, ...c });
  }
  event('ai', 'info', `AI shorts: ${outIds.length} clips from ${m.name}`, id);
  return outIds;
}

// ------------------------------------------------------------- 8. AI thumbnail
const thumbFile = id => path.join(athumb, `${id}.jpg`);
async function aiThumbnail(id, { words = '', number = '' } = {}) {
  const m = get('SELECT * FROM media WHERE id=?', id);
  if (!m) throw new Error('media not found');
  const fr = await frames(m, 6, 640);
  try {
    let pick = Math.floor(fr.files.length / 2), w = words, n = number;
    const r = await ai.chat({
      system: `TASK:thumbnail. Pick the best thumbnail frame (sharp, a face or a clear subject, strong emotion) and write 2-4 BIG words (max 22 letters) and optionally one big number like "-5%" or "$2B". Language: ${lang()}. Reply JSON {"best": <index from 0>, "words": "...", "number": "..."}`,
      user: `Video: ${m.name}. ${transcriptText(id, 800)}${hasVision() ? `\n${fr.files.length} frames attached in order (index 0..${fr.files.length - 1}).` : '\nNo frames; just write the words.'}`,
      images: hasVision() ? fr.files.map(x => x.f) : [],
      temperature: 0.5,
    });
    if (Number.isInteger(r.best) && r.best >= 0 && r.best < fr.files.length) pick = r.best;
    w = (w || clean(r.words)).toUpperCase().slice(0, 26);
    n = (n || clean(r.number)).slice(0, 8);
    const src = fr.files[pick];
    const big = Math.round(720 * 0.13);
    const txt = s => s.replace(/\\/g, ' ').replace(/'/g, '’').replace(/:/g, '\\:');      // expansion=none keeps "%" as is
    const vf = ['scale=1280:720:force_original_aspect_ratio=increase', 'crop=1280:720', 'eq=contrast=1.08:saturation=1.15',
      'drawbox=x=0:y=ih*0.55:w=iw:h=ih*0.45:color=black@0.45:t=fill',
      w && `drawtext=fontfile='${fesc(FONT_FILE)}':expansion=none:text='${txt(w)}':fontcolor=white:fontsize=${big}:borderw=6:bordercolor=black:x=48:y=h-th-60`,
      n && `drawtext=fontfile='${fesc(FONT_FILE)}':expansion=none:text='${txt(n)}':fontcolor=0xffd400:fontsize=${Math.round(big * 1.5)}:borderw=7:bordercolor=black:x=w-tw-48:y=40`].filter(Boolean).join(',');
    await media.sh(FFMPEG, ['-y', '-v', 'error', '-ss', src.t.toFixed(2), '-i', m.file, '-frames:v', '1', '-vf', vf, '-q:v', '3', thumbFile(id)]);
    event('ai', 'info', `AI thumbnail for ${m.name}: "${w}" ${n}`, id);
    return { url: `/files/ai-thumbs/${id}.jpg`, words: w, number: n, frame: pick };
  } finally { fs.rmSync(fr.dir, { recursive: true, force: true }); }
}

// ------------------------------------------------------------- 10. safety
async function safetyCheck({ title, body, platform }) {
  const r = await ai.chat({
    system: `TASK:safety. Check a social post before it is published on ${platform}. Look for: hate, adult content, violence, dangerous advice, spam patterns, misleading money claims ("guaranteed profit"), banned words, personal data. Reply JSON {"ok": true|false, "level": "none"|"low"|"high", "issues": ["short reasons"]}. Only "high" for things that would likely get the post removed.`,
    user: `Title: ${title}\nText: ${body}`, temperature: 0,
  });
  return { ok: r.ok !== false && r.level !== 'high', level: r.level || (r.ok === false ? 'high' : 'none'), issues: (r.issues || []).map(clean).slice(0, 5) };
}

// ------------------------------------------------------------- 12-13. live lines
async function liveLine({ mode, prompt, item, recent = [] }) {
  const r = await ai.chat({
    system: `TASK:live_${mode}. Write ONE line for a live stream overlay. Max 70 characters. No hashtags, no quotes. Language: ${lang()}. Do not repeat these recent lines: ${recent.slice(-5).join(' | ')}. Reply JSON {"line":"..."}`,
    user: mode === 'nowplaying' ? `Now playing: ${item?.name || ''}. ${item?.said ? 'It is about: ' + item.said : ''}\nWrite a short "now playing" line that makes viewers stay.` : `Channel theme: ${prompt || 'general'}.\nWrite a fresh fun fact, tip or question for viewers.`,
    temperature: 0.9, maxTokens: 120,
  });
  return clean(r.line).replace(/[\r\n]+/g, ' ').slice(0, 80);
}

// ------------------------------------------------------------- 14. Ask AutoCast
function contextForAsk() {
  return {
    now: new Date().toString(),
    accounts: all('SELECT id,name,platform,grp,can_upload,can_live FROM accounts'),
    stations: all('SELECT id,name FROM stations'),
    media: all('SELECT id,name,duration FROM media ORDER BY id DESC LIMIT 40'),
  };
}
async function ask(q) {
  const ctx = contextForAsk();
  const r = await ai.chat({
    system: `TASK:ask. You control AutoCast, a tool that posts videos and runs live streams. Turn the user's request into ONE action. Allowed actions:
- {"type":"create_post","media_id":<id>,"account_ids":[ids],"title":"...","body":"...","when":"now"|"slot"|"YYYY-MM-DD HH:MM"}
- {"type":"start_station","id":<id>}  - {"type":"stop_station","id":<id>}
- {"type":"none"} when it is a question or not possible.
Use only ids from the data. Reply JSON {"reply":"one or two short sentences for the user","action":{...}}`,
    user: `Data: ${JSON.stringify(ctx)}\nUser: ${q}`, temperature: 0.1,
  });
  return { reply: clean(r.reply), action: r.action && typeof r.action === 'object' ? r.action : { type: 'none' } };
}

// ------------------------------------------------------------- 15. explain an error
async function explain({ error, context }) {
  const r = await ai.chat({
    system: `TASK:explain. Explain an error from a video posting / live streaming tool to a non-technical person. Language: ${lang()}. Reply JSON {"summary":"one sentence, plain words","steps":["2-4 short fix steps"]}`,
    user: `Error: ${error}\nContext: ${context}`, temperature: 0.2,
  });
  return { summary: clean(r.summary), steps: (r.steps || []).map(clean).slice(0, 5) };
}

// ------------------------------------------------------------- 16. daily digest
async function digest() {
  const since = Date.now() - 864e5;
  const stats = {
    sent: get("SELECT COUNT(*) n FROM post_targets WHERE status='done' AND done_at>=?", since).n,
    failed: get("SELECT COUNT(*) n FROM post_targets WHERE status='failed' AND done_at>=?", since).n,
    waiting: get("SELECT COUNT(*) n FROM post_targets WHERE status='queued'").n,
    stations: all('SELECT name FROM stations').map(s => s.name),
  };
  const ev = all("SELECT area, level, msg FROM events WHERE at>=? AND level IN ('warn','error') ORDER BY id DESC LIMIT 40", since);
  const r = await ai.chat({
    system: `TASK:digest. Write a short daily report for the owner of an auto-posting and live streaming server. Language: ${lang()}. Plain words, max 6 short lines, say what needs action first. Reply JSON {"headline":"...","text":"..."}`,
    user: `Last 24 h: ${JSON.stringify(stats)}\nProblems: ${JSON.stringify(ev)}`, temperature: 0.3,
  });
  const d = { at: Date.now(), headline: clean(r.headline), text: clean(r.text), stats };
  setSetting('ai_last_digest', d);
  event('ai', 'info', `digest: ${d.headline}`);
  return d;
}

// ------------------------------------------------------------- 17. best posting times
async function suggestSlots({ platform, audience = '' }) {
  const r = await ai.chat({
    system: `TASK:slots. Suggest 3 daily posting times (24h HH:MM, server time) for ${platform}. Audience: ${audience || lang() + ' speaking viewers'}. Server time now: ${new Date().toString()}. Reply JSON {"slots":["HH:MM","HH:MM","HH:MM"],"why":"one short sentence"}`,
    user: 'Suggest times.', temperature: 0.2,
  });
  const slots = [...new Set((r.slots || []).map(s => String(s).trim().padStart(5, '0')).filter(s => /^([01]\d|2[0-3]):[0-5]\d$/.test(s)))].sort().slice(0, 6);
  if (!slots.length) throw new Error('AI gave no valid times');
  return { slots, why: clean(r.why) };
}

module.exports = { transcribeMedia, transcript, burnCaptions, writePost, rewriteFor, translate, aiShorts, aiThumbnail, thumbFile, safetyCheck, liveLine, ask, explain, digest, suggestSlots, captionLines, toSRT };
