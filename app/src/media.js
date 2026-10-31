// Media library: probe, thumbnail, and "prepare for live".
// Prepare = re-encode once into a fixed profile (same size, fps, codec, audio, 2 s keyframes).
// Then the live encoder only copies packets, so a 24/7 station uses almost no CPU.
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { FFMPEG, FFPROBE, DATA } = require('./config');
const { get, run, all, event } = require('./db');

const PROFILES = {
  '720p30':  { w: 1280, h: 720,  fps: 30, vb: 3000, ab: 128 },
  '1080p30': { w: 1920, h: 1080, fps: 30, vb: 6000, ab: 160 },
  '1080p60': { w: 1920, h: 1080, fps: 60, vb: 9000, ab: 160 },
  '720p30v':  { w: 720, h: 1280, fps: 30, vb: 3000, ab: 128 },   // vertical (TikTok / IG live)
  '1080p30v': { w: 1080, h: 1920, fps: 30, vb: 6000, ab: 160 },
};

function sh(bin, args, { onLine, timeoutMs } = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(bin, args, { windowsHide: true });
    let out = '', err = '';
    p.stdout.on('data', d => { out += d; });
    p.stderr.on('data', d => { err += d; if (onLine) String(d).split(/\r|\n/).forEach(l => l && onLine(l)); if (err.length > 20000) err = err.slice(-10000); });
    const t = timeoutMs ? setTimeout(() => p.kill('SIGKILL'), timeoutMs) : null;
    p.on('error', reject);
    p.on('close', code => { if (t) clearTimeout(t); code === 0 ? resolve(out) : reject(new Error(err.split('\n').filter(Boolean).slice(-3).join(' | ') || `exit ${code}`)); });
  });
}

async function probe(file) {
  const j = JSON.parse(await sh(FFPROBE, ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file], { timeoutMs: 60000 }));
  const v = (j.streams || []).find(s => s.codec_type === 'video');
  const a = (j.streams || []).find(s => s.codec_type === 'audio');
  if (!v) throw new Error('No video stream in file');
  return {
    duration: Number(j.format?.duration || v.duration || 0),
    width: v.width, height: v.height, has_audio: a ? 1 : 0,
    vcodec: v.codec_name, acodec: a?.codec_name || null,
  };
}

async function thumbnail(file, out, at = 1) {
  await sh(FFMPEG, ['-y', '-v', 'error', '-ss', String(at), '-i', file, '-frames:v', '1', '-vf', 'scale=480:-2', out], { timeoutMs: 60000 });
}

async function addFile(file, name, source = 'upload') {
  const info = await probe(file);
  const st = fs.statSync(file);
  const r = run('INSERT INTO media(name,file,size,duration,width,height,has_audio,source,created_at) VALUES(?,?,?,?,?,?,?,?,?)',
    name || path.basename(file), file, st.size, info.duration, info.width, info.height, info.has_audio, source, Date.now());
  const id = Number(r.lastInsertRowid);
  const th = path.join(DATA, 'thumbs', `${id}.jpg`);
  try { await thumbnail(file, th, Math.min(1, info.duration / 2)); run('UPDATE media SET thumb=? WHERE id=?', th, id); } catch (e) { event('media', 'warn', `thumb failed: ${e.message}`, id); }
  return get('SELECT * FROM media WHERE id=?', id);
}

// One prepare job at a time so a small VPS stays responsive.
const queue = [];
let busy = false;
function prepare(mediaId, profile = '1080p30') {
  const m = get('SELECT * FROM media WHERE id=?', mediaId);
  if (!m) throw new Error('media not found');
  const out = path.join(DATA, 'prepared', `${mediaId}_${profile}.mp4`);
  if (fs.existsSync(out)) return Promise.resolve(out);
  const same = queue.find(j => j.mediaId === mediaId && j.profile === profile);
  if (same) return new Promise((resolve, reject) => { const r0 = same.resolve, j0 = same.reject; same.resolve = v => { r0(v); resolve(v); }; same.reject = e => { j0(e); reject(e); }; });
  run("UPDATE media SET prepare_state='queued', prepare_msg='' WHERE id=?", mediaId);
  return new Promise((resolve, reject) => { queue.push({ mediaId, profile, out, resolve, reject }); pump(); });
}
async function pump() {
  if (busy || !queue.length) return;
  busy = true;
  const job = queue.shift();
  try { await doPrepare(job); job.resolve(job.out); } catch (e) { job.reject(e); }
  busy = false;
  pump();
}
async function doPrepare({ mediaId, profile, out }) {
  const m = get('SELECT * FROM media WHERE id=?', mediaId);
  const P = PROFILES[profile] || PROFILES['1080p30'];
  run("UPDATE media SET prepare_state='working', prepare_msg='0%' WHERE id=?", mediaId);
  const tmp = out + '.part.mp4';
  const vf = `scale=${P.w}:${P.h}:force_original_aspect_ratio=decrease,pad=${P.w}:${P.h}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,fps=${P.fps},format=yuv420p`;
  const args = ['-y', '-v', 'error', '-stats', '-i', m.file];
  if (!m.has_audio) args.push('-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100');
  args.push('-map', '0:v:0', '-map', m.has_audio ? '0:a:0' : '1:a:0',
    // -bf 0: no B-frames, so DTS == PTS and files join cleanly in copy mode.
    '-vf', vf, '-c:v', 'libx264', '-preset', 'veryfast', '-profile:v', 'high', '-bf', '0',
    '-b:v', `${P.vb}k`, '-maxrate', `${P.vb}k`, '-bufsize', `${P.vb * 2}k`,
    '-g', String(P.fps * 2), '-keyint_min', String(P.fps * 2), '-sc_threshold', '0',
    '-c:a', 'aac', '-b:a', `${P.ab}k`, '-ar', '44100', '-ac', '2',
    '-af', 'aresample=async=1:first_pts=0',
    '-shortest', '-movflags', '+faststart', '-video_track_timescale', '90000', tmp);
  let last = 0;
  await sh(FFMPEG, args, {
    onLine: l => {
      const t = /time=(\d+):(\d+):([\d.]+)/.exec(l);
      if (t && m.duration && Date.now() - last > 1000) {
        last = Date.now();
        const s = (+t[1]) * 3600 + (+t[2]) * 60 + (+t[3]);
        run('UPDATE media SET prepare_msg=? WHERE id=?', `${Math.min(99, Math.round((s / m.duration) * 100))}%`, mediaId);
      }
    },
  }).catch(e => { run("UPDATE media SET prepare_state='failed', prepare_msg=? WHERE id=?", e.message.slice(0, 300), mediaId); throw e; });
  fs.renameSync(tmp, out);
  run("UPDATE media SET prepared=?, prepare_state='ready', prepare_msg='' WHERE id=?", out, mediaId);
  event('media', 'info', `prepared ${m.name} for ${profile}`, mediaId);
}

function removeMedia(id) {
  const m = get('SELECT * FROM media WHERE id=?', id);
  if (!m) return;
  for (const f of [m.thumb, m.prepared, path.join(DATA, 'variants', `${id}_v.mp4`)]) if (f) fs.rm(f, { force: true }, () => {});
  for (const f of fs.readdirSync(path.join(DATA, 'prepared')).filter(f => f.startsWith(`${id}_`))) fs.rm(path.join(DATA, 'prepared', f), { force: true }, () => {});
  if (m.file && m.file.startsWith(path.join(DATA, 'media'))) fs.rm(m.file, { force: true }, () => {});
  run('DELETE FROM media WHERE id=?', id);
}

// ---------------------------------------------------------------- vertical + shorts
// Wide video -> 1080x1920 with the same video blurred behind it (no black bars).
const BLUR_PAD = 'split[a][b];[a]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,boxblur=24:2,eq=brightness=-0.08[bg];[b]scale=1080:1920:force_original_aspect_ratio=decrease[fg];[bg][fg]overlay=(W-w)/2:(H-h)/2,setsar=1,format=yuv420p';
const CENTER_CROP = 'crop=min(iw\\,ih*9/16):ih,scale=1080:1920,setsar=1,format=yuv420p';
const encArgs = hasAudio => ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-movflags', '+faststart', ...(hasAudio ? ['-c:a', 'aac', '-b:a', '160k'] : [])];

const busyVariants = new Map();
function verticalVariant(mediaId) {
  const m = get('SELECT * FROM media WHERE id=?', mediaId);
  if (!m) return Promise.reject(new Error('media not found'));
  if (m.height >= m.width) return Promise.resolve(m.file);            // already vertical
  const out = path.join(DATA, 'variants', `${mediaId}_v.mp4`);
  if (fs.existsSync(out)) return Promise.resolve(out);
  if (busyVariants.has(mediaId)) return busyVariants.get(mediaId);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const p = sh(FFMPEG, ['-y', '-v', 'error', '-i', m.file, '-filter_complex', `[0:v]${BLUR_PAD}[v]`, '-map', '[v]', ...(m.has_audio ? ['-map', '0:a:0'] : []), ...encArgs(m.has_audio), out + '.part.mp4'])
    .then(() => { fs.renameSync(out + '.part.mp4', out); event('media', 'info', `made vertical version of ${m.name}`, mediaId); return out; })
    .finally(() => busyVariants.delete(mediaId));
  busyVariants.set(mediaId, p);
  return p;
}

// Cut a long video into N short vertical clips, spread evenly through it.
async function makeShorts(mediaId, { count = 3, seconds = 30, mode = 'crop' } = {}) {
  const m = get('SELECT * FROM media WHERE id=?', mediaId);
  if (!m) throw new Error('media not found');
  count = Math.max(1, Math.min(20, Number(count) || 3));
  seconds = Math.max(3, Math.min(180, Number(seconds) || 30));
  if (m.duration < seconds) seconds = Math.floor(m.duration);
  const vertical = m.height >= m.width;
  const vf = vertical ? 'scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2,setsar=1,format=yuv420p' : mode === 'pad' ? BLUR_PAD : CENTER_CROP;
  const base = path.basename(m.name, path.extname(m.name));
  const ids = [];
  for (let i = 0; i < count; i++) {
    const start = Math.max(0, ((m.duration - seconds) * (i + 0.5)) / count);
    const out = path.join(DATA, 'media', `${Date.now()}_${base}_short${i + 1}.mp4`);
    await sh(FFMPEG, ['-y', '-v', 'error', '-ss', start.toFixed(2), '-t', String(seconds), '-i', m.file,
      '-filter_complex', `[0:v]${vf}[v]`, '-map', '[v]', ...(m.has_audio ? ['-map', '0:a:0'] : []), ...encArgs(m.has_audio), out]);
    const nm = await addFile(out, `${base} · short ${i + 1}.mp4`, 'shorts');
    run('UPDATE media SET parent_id=? WHERE id=?', mediaId, nm.id);
    ids.push(nm.id);
  }
  event('media', 'info', `made ${ids.length} shorts from ${m.name}`, mediaId);
  return ids;
}

const VIDEO_EXT = /\.(mp4|mov|mkv|webm|m4v|avi|flv)$/i;
module.exports = { PROFILES, probe, thumbnail, addFile, prepare, removeMedia, sh, VIDEO_EXT, verticalVariant, makeShorts, listMedia: () => all('SELECT * FROM media ORDER BY id DESC') };
