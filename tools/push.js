#!/usr/bin/env node
// AutoCast pusher: run on your PC. Watches a folder (e.g. Automated Lunch Free exports)
// and sends every NEW video to your AutoCast server, with its same-name .json text.
//
//   node push.js --server https://cast.yourdomain.com --token ac_xxx --folder "D:\exports" --accounts "group:Finance ID" --when slot
//   node push.js ... --playlist 3          (also/only add to a live playlist)
//   node push.js ... --once                (send what is new, then exit)
//
// No npm install needed (Node 20+). It remembers sent files in <folder>/.autocast-sent.json
const fs = require('fs');
const path = require('path');

const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, arr) => { if (v.startsWith('--')) a.push([v.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : '1']); return a; }, []));
const SERVER = (args.server || process.env.AUTOCAST_SERVER || '').replace(/\/$/, '');
const TOKEN = args.token || process.env.AUTOCAST_TOKEN;
const FOLDER = path.resolve(args.folder || '.');
const EVERY = Number(args.every || 30) * 1000;
const VIDEO = /\.(mp4|mov|mkv|webm|m4v)$/i;
if (!SERVER || !TOKEN) { console.error('Need --server and --token (make a token in AutoCast → Settings → Push from PC)'); process.exit(2); }

const stateFile = path.join(FOLDER, '.autocast-sent.json');
const sent = new Set(fs.existsSync(stateFile) ? JSON.parse(fs.readFileSync(stateFile, 'utf8')) : []);
const save = () => fs.writeFileSync(stateFile, JSON.stringify([...sent]));
const log = (...m) => console.log(new Date().toLocaleTimeString(), ...m);

async function send(file) {
  const st = fs.statSync(file);
  const fd = new FormData();
  fd.append('file', await fs.openAsBlob(file, { type: 'video/mp4' }), path.basename(file));
  const side = [file.replace(/\.[^.]+$/, '.json'), file + '.json'].find(f => fs.existsSync(f));
  if (side) fd.append('meta', fs.readFileSync(side, 'utf8'));
  for (const k of ['accounts', 'when', 'playlist_id', 'privacy']) if (args[k === 'playlist_id' ? 'playlist' : k]) fd.append(k, args[k === 'playlist_id' ? 'playlist' : k]);
  if (args.ai) fd.append('ai', '1');
  const t0 = Date.now();
  const r = await fetch(`${SERVER}/hook/upload`, { method: 'POST', headers: { Authorization: `Bearer ${TOKEN}` }, body: fd });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
  log(`sent ${path.basename(file)} (${(st.size / 1e6).toFixed(1)} MB in ${((Date.now() - t0) / 1000).toFixed(1)} s)`, j.post_id ? `→ post #${j.post_id}` : '', j.playlist_id ? `→ playlist ${j.playlist_id}` : '');
}

async function scan() {
  for (const f of fs.readdirSync(FOLDER).filter(f => VIDEO.test(f)).sort()) {
    const full = path.join(FOLDER, f);
    const st = fs.statSync(full);
    const key = `${f}|${st.size}`;
    if (sent.has(key) || Date.now() - st.mtimeMs < 15000) continue;          // skip files still being written
    try { await send(full); sent.add(key); save(); }
    catch (e) { log(`FAILED ${f}: ${e.message} (will retry)`); }
  }
}

(async () => {
  const ping = await fetch(`${SERVER}/hook/ping`, { headers: { Authorization: `Bearer ${TOKEN}` } }).then(r => r.json()).catch(e => ({ error: e.message }));
  if (!ping.ok) { console.error('Server says:', ping.error || 'no answer'); process.exit(1); }
  log(`connected as "${ping.name}". Watching ${FOLDER}`);
  if (args['skip-existing'] && !fs.existsSync(stateFile)) { for (const f of fs.readdirSync(FOLDER).filter(f => VIDEO.test(f))) sent.add(`${f}|${fs.statSync(path.join(FOLDER, f)).size}`); save(); log(`marked ${sent.size} old files as sent`); }
  await scan();
  if (args.once) return;
  setInterval(() => scan().catch(e => log(e.message)), EVERY);
})();
