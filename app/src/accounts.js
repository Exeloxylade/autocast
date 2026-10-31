// Shared accounts: tokens, refresh, stream keys. Used by Auto Upload and Auto Live.
const { get, all, run, setting, setSetting, event } = require('./db');
const { seal, open } = require('./crypto');
const connectors = require('./upload/connectors');

// Platform app keys (Google Cloud app, Meta app, TikTok app). Stored sealed.
function appKeys() { return open(setting('app_keys')) || {}; }
function setAppKeys(patch) {
  const cur = appKeys();
  for (const [app, v] of Object.entries(patch)) {
    cur[app] = { ...(cur[app] || {}) };
    for (const [k, val] of Object.entries(v || {})) if (val !== undefined && val !== '••••') cur[app][k] = val;
  }
  setSetting('app_keys', seal(cur));
}
function appKeysPublic() {
  const k = appKeys();
  const mask = v => (v ? '••••' : '');
  return {
    google: { clientId: k.google?.clientId || '', clientSecret: mask(k.google?.clientSecret) },
    meta: { appId: k.meta?.appId || '', appSecret: mask(k.meta?.appSecret) },
    tiktok: { clientKey: k.tiktok?.clientKey || '', clientSecret: mask(k.tiktok?.clientSecret) },
  };
}

function saveSecret(id, secret, expires_at) {
  if (expires_at === undefined) run('UPDATE accounts SET secret=? WHERE id=?', seal(secret), id);
  else run('UPDATE accounts SET secret=?, expires_at=? WHERE id=?', seal(secret), expires_at, id);
}

// Returns a fresh secret. Refreshes the access token when it ends within 5 minutes.
async function ensure(acc) {
  let s = open(acc.secret) || {};
  if (acc.kind !== 'oauth') return s;
  if (acc.expires_at && acc.expires_at < Date.now() + 5 * 60 * 1000) {
    const c = connectors[acc.platform];
    const app = appKeys()[c.app] || {};
    try {
      const r = await c.refresh(acc, app, s);
      s = r.secret;
      saveSecret(acc.id, s, r.expires_at);
      run("UPDATE accounts SET status='ok', status_msg='' WHERE id=?", acc.id);
    } catch (e) {
      run("UPDATE accounts SET status='expired', status_msg=? WHERE id=?", `Log in again: ${e.message}`.slice(0, 300), acc.id);
      event('accounts', 'error', `${acc.platform} ${acc.name}: refresh failed: ${e.message}`, acc.id);
      throw new Error(`Login expired for ${acc.name}. Log in again.`);
    }
  }
  return s;
}

function upsertOauth(platform, a) {
  const ex = get('SELECT id FROM accounts WHERE platform=? AND ext_id=?', platform, a.ext_id);
  if (ex) {
    run("UPDATE accounts SET name=?, secret=?, expires_at=?, status='ok', status_msg='', can_upload=?, can_live=? WHERE id=?",
      a.name, seal(a.secret), a.expires_at, a.can_upload, a.can_live, ex.id);
    return ex.id;
  }
  return Number(run("INSERT INTO accounts(platform,kind,name,ext_id,secret,expires_at,can_upload,can_live,created_at) VALUES(?,?,?,?,?,?,?,?,?)",
    platform, 'oauth', a.name, a.ext_id, seal(a.secret), a.expires_at, a.can_upload, a.can_live, Date.now()).lastInsertRowid);
}

function addStreamKey({ platform, name, server, key, grp }) {
  if (!connectors[platform]?.live) throw new Error('unknown live platform');
  if (!/^rtmps?:\/\//i.test(server || '')) throw new Error('Server must start with rtmp:// or rtmps://');
  return Number(run("INSERT INTO accounts(platform,kind,name,grp,secret,can_upload,can_live,created_at) VALUES(?,?,?,?,?,0,1,?)",
    platform, 'stream_key', name || connectors[platform].label, grp || '', seal({ server, key: key || '' }), Date.now()).lastInsertRowid);
}

function addMock({ name, grp, live }) {
  const id = Number(run("INSERT INTO accounts(platform,kind,name,grp,can_upload,can_live,created_at) VALUES('mock','mock',?,?,1,?,?)", name || 'Test account', grp || '', live ? 1 : 0, Date.now()).lastInsertRowid);
  if (live) saveSecret(id, { server: live });
  return id;
}

// Never send secrets to the browser.
function publicAccount(a) {
  const s = a.kind === 'stream_key' ? (open(a.secret) || {}) : {};
  return {
    id: a.id, platform: a.platform, kind: a.kind, name: a.name, grp: a.grp, status: a.status, status_msg: a.status_msg,
    can_upload: !!a.can_upload, can_live: !!a.can_live, slots: JSON.parse(a.slots || '[]'), fmt: a.fmt || 'auto', daily_max: a.daily_max || 0,
    expires_at: a.expires_at, server: s.server || '', has_key: !!s.key,
    label: connectors[a.platform]?.label || a.platform,
  };
}
const list = () => all('SELECT * FROM accounts ORDER BY platform, name').map(publicAccount);

module.exports = { appKeys, setAppKeys, appKeysPublic, ensure, saveSecret, upsertOauth, addStreamKey, addMock, publicAccount, list };
