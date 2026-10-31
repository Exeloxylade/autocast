// AES-256-GCM for tokens and stream keys at rest. Key from env or data/secret.key.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { DATA } = require('./config');

function loadKey() {
  if (process.env.AUTOCAST_SECRET) {
    return crypto.createHash('sha256').update(process.env.AUTOCAST_SECRET).digest();
  }
  const f = path.join(DATA, 'secret.key');
  if (!fs.existsSync(f)) {
    fs.writeFileSync(f, crypto.randomBytes(32).toString('hex'), { mode: 0o600 });
  }
  return Buffer.from(fs.readFileSync(f, 'utf8').trim(), 'hex');
}
const KEY = loadKey();

function seal(obj) {
  if (obj == null) return null;
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', KEY, iv);
  const enc = Buffer.concat([c.update(JSON.stringify(obj), 'utf8'), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), enc]).toString('base64');
}

function open(str) {
  if (!str) return null;
  const b = Buffer.from(str, 'base64');
  const d = crypto.createDecipheriv('aes-256-gcm', KEY, b.subarray(0, 12));
  d.setAuthTag(b.subarray(12, 28));
  return JSON.parse(Buffer.concat([d.update(b.subarray(28)), d.final()]).toString('utf8'));
}

function hashPassword(pw, salt = crypto.randomBytes(16).toString('hex')) {
  const h = crypto.scryptSync(pw, salt, 64).toString('hex');
  return `${salt}:${h}`;
}
function checkPassword(pw, stored) {
  const [salt, h] = String(stored).split(':');
  if (!salt || !h) return false;
  const a = Buffer.from(h, 'hex');
  const b = crypto.scryptSync(pw, salt, 64);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function sign(v) { return v + '.' + crypto.createHmac('sha256', KEY).update(v).digest('base64url'); }
function unsign(s) {
  const i = String(s || '').lastIndexOf('.');
  if (i < 0) return null;
  const v = s.slice(0, i);
  const want = sign(v);
  return want.length === s.length && crypto.timingSafeEqual(Buffer.from(want), Buffer.from(s)) ? v : null;
}
const token = (n = 24) => crypto.randomBytes(n).toString('base64url');

module.exports = { seal, open, hashPassword, checkPassword, sign, unsign, token };
