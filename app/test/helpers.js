// Shared test helpers: temp data dir, local MediaMTX relay, API client, test clips.
const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const base = process.env.KIROCREW_SCRATCH || os.tmpdir();
function tempData(name) {
  const d = path.join(base, 'autocast-test', `${name}-${Date.now()}`);
  fs.mkdirSync(d, { recursive: true });
  process.env.AUTOCAST_DATA = d;
  process.env.AUTOCAST_DEV_NOAUTH = '1';
  process.env.AUTOCAST_QUIET = process.env.AUTOCAST_QUIET || '1';
  return d;
}

function startRelay(port = 1935) {
  const bin = process.env.MEDIAMTX || path.join(base, 'mediamtx', process.platform === 'win32' ? 'mediamtx.exe' : 'mediamtx');
  if (!fs.existsSync(bin)) throw new Error(`MediaMTX not found at ${bin}. Set MEDIAMTX=...`);
  const yml = path.join(base, 'autocast-test', `mediamtx-${port}.yml`);
  fs.mkdirSync(path.dirname(yml), { recursive: true });
  fs.writeFileSync(yml, `logLevel: warn\nrtmp: yes\nrtmpAddress: 127.0.0.1:${port}\nrtsp: no\nhls: no\nwebrtc: no\nsrt: no\napi: no\nmetrics: no\npprof: no\nplayback: no\npaths:\n  all_others:\n`);
  const p = spawn(bin, [yml], { windowsHide: true });
  const watch = d => {
    if (process.env.DEBUG_RELAY) process.stdout.write('[relay] ' + d);
    // Another relay (e.g. the demo) already owns the port: tests would share it and clash.
    if (/bind:|address already in use|Only one usage/i.test(String(d))) { console.error(`\nSTOP: port ${port} is busy (is test/demo.js running?). Stop it and run again.`); process.exit(3); }
  };
  p.stderr.on('data', watch);
  p.stdout.on('data', watch);
  return p;
}

function makeClip(file, { w, h, fps, secs, audio, color = 'testsrc2' }) {
  const args = ['-y', '-v', 'error', '-f', 'lavfi', '-t', String(secs), '-i', `${color}=size=${w}x${h}:rate=${fps}`];
  if (audio) args.push('-f', 'lavfi', '-i', `sine=frequency=440:sample_rate=48000:duration=${secs}`);
  args.push('-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p');
  if (audio) args.push('-c:a', 'aac', '-shortest');
  args.push(file);
  const r = spawnSync('ffmpeg', args);
  if (r.status !== 0) throw new Error(String(r.stderr));
  return file;
}

function client(baseUrl) {
  const call = async (method, p, body) => {
    let r;
    try { r = await fetch(baseUrl + p, { method, headers: { 'content-type': 'application/json', 'x-autocast': '1' }, body: body ? JSON.stringify(body) : undefined }); }
    catch (e) { throw new Error(`${method} ${p}: ${e.cause?.code || e.message}`); }
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(`${method} ${p} -> ${r.status} ${j.error || ''}`);
    return j;
  };
  return { get: p => call('GET', p), post: (p, b) => call('POST', p, b || {}), patch: (p, b) => call('PATCH', p, b), del: p => call('DELETE', p) };
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, ms, label) {
  const end = Date.now() + ms;
  let last;
  while (Date.now() < end) { try { last = await fn(); if (last) return last; } catch (e) { last = e; } await sleep(1000); }
  throw new Error(`timeout: ${label} (${last?.message || JSON.stringify(last)?.slice(0, 300)})`);
}

const results = [];
function check(name, ok, info = '') { results.push({ name, ok: !!ok, info }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? '  — ' + info : ''}`); }
function summary() { const f = results.filter(r => !r.ok); console.log(`\n${results.length - f.length}/${results.length} passed`); return f.length === 0; }

module.exports = { tempData, startRelay, makeClip, client, sleep, until, check, summary };
