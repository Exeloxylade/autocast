// Optional Telegram alerts. Token is stored sealed.
const { setting, setSetting, event } = require('./db');
const { seal, open } = require('./crypto');

function cfg() { return { onPostFail: true, onLiveDrop: true, chatId: '', ...(setting('alerts') || {}), token: open(setting('alerts_token')) || '' }; }
function save(p) {
  const { token, ...rest } = p;
  setSetting('alerts', { ...(setting('alerts') || {}), ...rest });
  if (token && token !== '••••') setSetting('alerts_token', seal(token));
}
const last = new Map();
async function send(kind, text) {
  const c = cfg();
  if (process.env.NOTIFY_LOG) require('fs').appendFileSync(process.env.NOTIFY_LOG, `${kind}: ${text}\n`);   // tests
  if (!c.token || !c.chatId) return;
  if ((kind === 'post' && !c.onPostFail) || (kind === 'live' && !c.onLiveDrop)) return;
  const k = kind + text; if (Date.now() - (last.get(k) || 0) < 10 * 60 * 1000) return;   // no spam: same alert once per 10 min
  last.set(k, Date.now());
  try {
    await fetch(`https://api.telegram.org/bot${c.token}/sendMessage`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: c.chatId, text: `AutoCast: ${text}` }) });
  } catch (e) { event('alerts', 'warn', `telegram failed: ${e.message}`); }
}
module.exports = { cfg, save, send, publicCfg: () => { const c = cfg(); return { ...c, token: c.token ? '••••' : '' }; } };
