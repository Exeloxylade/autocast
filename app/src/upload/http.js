// Small fetch helpers that turn platform API errors into readable messages.
async function jfetch(url, opts = {}) {
  const r = await fetch(url, opts);
  const text = await r.text();
  let j = null; try { j = text ? JSON.parse(text) : {}; } catch { j = { raw: text }; }
  if (!r.ok || j?.error?.message || (j?.error && typeof j.error === 'string')) {
    const e = j?.error;
    const msg = e?.message || e?.error_description || j?.error_description || (typeof e === 'string' ? e : '') || j?.raw || `HTTP ${r.status}`;
    // TikTok always returns error:{code:'ok'} on success.
    if (r.ok && e?.code === 'ok') return { json: j, res: r };
    const err = new Error(`${msg}`.slice(0, 400));
    err.status = r.status; err.body = j;
    throw err;
  }
  return { json: j, res: r };
}
const form = o => new URLSearchParams(Object.entries(o).filter(([, v]) => v != null).map(([k, v]) => [k, String(v)]));
const sleep = ms => new Promise(r => setTimeout(r, ms));
module.exports = { jfetch, form, sleep };
