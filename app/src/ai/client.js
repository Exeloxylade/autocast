// AI client for any OpenAI-compatible service:
//   OmniRoute / OpenRouter / OpenAI / Gemini (generativelanguage.googleapis.com/v1beta/openai) / Ollama (localhost:11434/v1)
// Settings (sealed): { baseUrl, apiKey, model, visionModel, sttModel, lang }
const fs = require('fs');
const path = require('path');
const { setting, setSetting, event } = require('../db');
const { seal, open } = require('../crypto');

function cfg() {
  const c = open(setting('ai_cfg')) || {};
  return { baseUrl: '', apiKey: '', model: '', visionModel: '', sttModel: 'whisper-1', lang: 'English', ...c };
}
function save(p) {
  const cur = cfg();
  for (const [k, v] of Object.entries(p || {})) if (v !== undefined && v !== '••••') cur[k] = typeof v === 'string' ? v.trim() : v;
  if (cur.baseUrl) cur.baseUrl = cur.baseUrl.replace(/\/+$/, '');
  setSetting('ai_cfg', seal(cur));
}
const publicCfg = () => { const c = cfg(); return { ...c, apiKey: c.apiKey ? '••••' : '' }; };
const ready = () => { const c = cfg(); return !!(c.baseUrl && c.model); };

// Monthly token counter (shown in Settings).
const monthKey = () => `ai_usage_${new Date().toISOString().slice(0, 7)}`;
function count(u) {
  if (!u) return;
  const cur = setting(monthKey(), { calls: 0, in: 0, out: 0 });
  cur.calls++; cur.in += u.prompt_tokens || 0; cur.out += u.completion_tokens || 0;
  setSetting(monthKey(), cur);
}
const usage = () => ({ month: monthKey().slice(9), ...setting(monthKey(), { calls: 0, in: 0, out: 0 }) });

async function post(url, body, isForm) {
  const c = cfg();
  const headers = c.apiKey ? { Authorization: `Bearer ${c.apiKey}` } : {};
  if (!isForm) headers['Content-Type'] = 'application/json';
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), Number(process.env.AI_TIMEOUT_MS || 180000));
  let r;
  try { r = await fetch(`${c.baseUrl}${url}`, { method: 'POST', headers, body: isForm ? body : JSON.stringify(body), signal: ctl.signal }); }
  catch (e) { throw new Error(`AI service not reachable (${c.baseUrl}): ${e.name === 'AbortError' ? 'timed out' : e.cause?.code || e.message}`); }
  finally { clearTimeout(t); }
  const text = await r.text();
  let j; try { j = JSON.parse(text); } catch { j = null; }
  if (!r.ok) {
    const msg = j?.error?.message || j?.message || text.slice(0, 200) || `HTTP ${r.status}`;
    throw new Error(r.status === 401 || r.status === 403 ? `AI key was refused: ${msg}` : r.status === 429 ? `AI limit reached, try later: ${msg}` : `AI error ${r.status}: ${msg}`);
  }
  if (!j) throw new Error('AI gave a non-JSON answer');
  return j;
}

// Pull the first JSON object out of a reply (models sometimes wrap it in ``` fences).
function parseJSON(s) {
  const t = String(s || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  try { return JSON.parse(t); } catch {}
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a >= 0 && b > a) { try { return JSON.parse(t.slice(a, b + 1)); } catch {} }
  throw new Error('AI answer was not valid JSON');
}

// chat({ system, user, images:[path], json:true, model, temperature })
async function chat({ system, user, images = [], json = true, model, temperature = 0.7, maxTokens = 1500 }) {
  const c = cfg();
  if (!ready()) throw Object.assign(new Error('Set up AI first: Settings → AI'), { status: 400 });
  const content = images.length
    ? [{ type: 'text', text: user }, ...images.map(f => ({ type: 'image_url', image_url: { url: `data:image/jpeg;base64,${fs.readFileSync(f).toString('base64')}` } }))]
    : user;
  const body = { model: model || (images.length ? c.visionModel || c.model : c.model), temperature, max_tokens: maxTokens, messages: [{ role: 'system', content: system }, { role: 'user', content }] };
  if (json) body.response_format = { type: 'json_object' };
  let j;
  try { j = await post('/chat/completions', body); }
  catch (e) {
    // Some services don't support response_format. Try once without it.
    if (json && /response_format|json_object|not supported|Unknown parameter/i.test(e.message)) { delete body.response_format; j = await post('/chat/completions', body); }
    else throw e;
  }
  count(j.usage);
  const out = j.choices?.[0]?.message?.content;
  if (out == null) throw new Error('AI gave an empty answer');
  return json ? parseJSON(out) : String(out).trim();
}

// Speech to text. Returns [{start,end,text}] with times in seconds.
async function transcribe(file, offset = 0) {
  const c = cfg();
  if (!c.baseUrl) throw Object.assign(new Error('Set up AI first: Settings → AI'), { status: 400 });
  const fd = new FormData();
  fd.append('file', await fs.openAsBlob(file, { type: 'audio/mpeg' }), path.basename(file));
  fd.append('model', c.sttModel || 'whisper-1');
  fd.append('response_format', 'verbose_json');
  const j = await post('/audio/transcriptions', fd, true);
  const segs = (j.segments || []).map(s => ({ start: +(s.start + offset).toFixed(2), end: +(s.end + offset).toFixed(2), text: String(s.text || '').trim() })).filter(s => s.text);
  if (!segs.length && j.text) segs.push({ start: offset, end: offset + Number(j.duration || 0), text: j.text.trim() });
  return segs;
}

async function test() {
  const t0 = Date.now();
  const r = await chat({ system: 'Reply with JSON {"ok":true,"hello":"<one short greeting>"}', user: 'Say hi', temperature: 0, maxTokens: 50 });
  event('ai', 'info', `AI test ok in ${Date.now() - t0} ms`);
  return { ok: true, ms: Date.now() - t0, reply: r.hello || JSON.stringify(r) };
}

module.exports = { cfg, save, publicCfg, ready, chat, transcribe, test, usage, parseJSON };
