// One connector per platform. Each one can do some of:
//   oauth.url(app, state, redirect)          -> login page URL
//   oauth.exchange(app, code, redirect)      -> [{ name, ext_id, secret, expires_at, can_upload, can_live }]
//   refresh(acc, app, secret)                -> { secret, expires_at }
//   upload(acc, secret, job)                 -> { url }
//   liveIngest(acc, { title, rt })           -> rtmp(s) URL for the live pusher
//
// API references (checked 2026):
//   YouTube Data API v3 videos.insert (resumable), liveStreams / liveBroadcasts
//   TikTok Content Posting API v2 (Direct Post, FILE_UPLOAD chunks)
//   Meta Graph API v21: /{page}/videos, /{page}/live_videos, /{ig}/media + media_publish (REELS)
const fs = require('fs');
const path = require('path');
const { jfetch, form, sleep } = require('./http');
const { DATA, PUBLIC_URL } = require('../config');

const G = 'v21.0';
const fileBlob = f => fs.openAsBlob(f, { type: 'video/mp4' });

// ======================================================= YouTube
const youtube = {
  label: 'YouTube', app: 'google', upload: true, live: true,
  oauth: {
    url: (app, state, redirect) => 'https://accounts.google.com/o/oauth2/v2/auth?' + form({
      client_id: app.clientId, redirect_uri: redirect, response_type: 'code', access_type: 'offline', prompt: 'consent',
      include_granted_scopes: 'true', state,
      scope: 'https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube',
    }),
    async exchange(app, code, redirect) {
      const { json: t } = await jfetch('https://oauth2.googleapis.com/token', { method: 'POST', body: form({ code, client_id: app.clientId, client_secret: app.clientSecret, redirect_uri: redirect, grant_type: 'authorization_code' }) });
      const { json: ch } = await jfetch('https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true', { headers: { Authorization: `Bearer ${t.access_token}` } });
      if (!ch.items?.length) throw new Error('This Google login has no YouTube channel');
      return ch.items.map(c => ({ name: c.snippet.title, ext_id: c.id, secret: { access_token: t.access_token, refresh_token: t.refresh_token }, expires_at: Date.now() + t.expires_in * 1000, can_upload: 1, can_live: 1 }));
    },
  },
  async refresh(acc, app, s) {
    if (!s.refresh_token) throw new Error('No refresh token. Log in again.');
    const { json: t } = await jfetch('https://oauth2.googleapis.com/token', { method: 'POST', body: form({ client_id: app.clientId, client_secret: app.clientSecret, refresh_token: s.refresh_token, grant_type: 'refresh_token' }) });
    return { secret: { ...s, access_token: t.access_token }, expires_at: Date.now() + t.expires_in * 1000 };
  },
  async upload(acc, s, job) {
    const size = fs.statSync(job.file).size;
    const meta = {
      snippet: { title: job.title.slice(0, 100), description: job.body.slice(0, 5000), tags: job.tags, categoryId: job.options.categoryId || '22' },
      status: { privacyStatus: job.options.privacy || 'public', selfDeclaredMadeForKids: !!job.options.kids, containsSyntheticMedia: !!job.options.ai },
    };
    const init = await fetch('https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status', {
      method: 'POST', body: JSON.stringify(meta),
      headers: { Authorization: `Bearer ${s.access_token}`, 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Length': String(size), 'X-Upload-Content-Type': 'video/*' },
    });
    if (!init.ok) throw new Error(`YouTube: ${(await init.text()).slice(0, 300)}`);
    const loc = init.headers.get('location');
    const { json: v } = await jfetch(loc, { method: 'PUT', body: await fileBlob(job.file), headers: { 'Content-Type': 'video/*', Authorization: `Bearer ${s.access_token}` } });
    // Custom thumbnail (AI thumbnail). Needs a verified channel; failure doesn't fail the post.
    let note = '';
    if (job.thumbnail) {
      try { await jfetch(`https://www.googleapis.com/upload/youtube/v3/thumbnails/set?videoId=${v.id}`, { method: 'POST', body: await fs.openAsBlob(job.thumbnail, { type: 'image/jpeg' }), headers: { Authorization: `Bearer ${s.access_token}`, 'Content-Type': 'image/jpeg' } }); }
      catch (e) { note = `Thumbnail not set: ${e.message}`; }
    }
    return { url: `https://youtu.be/${v.id}`, note };
  },
  // Login-based live: one reusable stream per account, a new broadcast per station start.
  async liveIngest(acc, { title, rt, s, save }) {
    const H = { Authorization: `Bearer ${s.access_token}`, 'Content-Type': 'application/json' };
    const api = 'https://www.googleapis.com/youtube/v3';
    let stream = null;
    if (s.liveStreamId) {
      const { json } = await jfetch(`${api}/liveStreams?part=cdn&id=${s.liveStreamId}`, { headers: H });
      stream = json.items?.[0];
    }
    if (!stream) {
      ({ json: stream } = await jfetch(`${api}/liveStreams?part=snippet,cdn,contentDetails`, { method: 'POST', headers: H, body: JSON.stringify({ snippet: { title: 'AutoCast' }, cdn: { ingestionType: 'rtmp', resolution: 'variable', frameRate: 'variable' }, contentDetails: { isReusable: true } }) }));
      save({ ...s, liveStreamId: stream.id });
    }
    const { json: b } = await jfetch(`${api}/liveBroadcasts?part=snippet,status,contentDetails`, { method: 'POST', headers: H, body: JSON.stringify({
      snippet: { title: title.slice(0, 100), scheduledStartTime: new Date().toISOString() },
      status: { privacyStatus: 'public', selfDeclaredMadeForKids: false },
      contentDetails: { enableAutoStart: true, enableAutoStop: true, latencyPreference: 'normal' },
    }) });
    await jfetch(`${api}/liveBroadcasts/bind?id=${b.id}&part=id,contentDetails&streamId=${stream.id}`, { method: 'POST', headers: H });
    if (rt) rt.onStopHooks = [...(rt.onStopHooks || []), () => jfetch(`${api}/liveBroadcasts/transition?broadcastStatus=complete&id=${b.id}&part=status`, { method: 'POST', headers: H })];
    const ing = stream.cdn.ingestionInfo;
    return `${ing.ingestionAddress}/${ing.streamName}`;
  },
};

// ======================================================= TikTok
const tiktok = {
  label: 'TikTok', app: 'tiktok', upload: true, live: false,
  oauth: {
    url: (app, state, redirect) => 'https://www.tiktok.com/v2/auth/authorize/?' + form({ client_key: app.clientKey, response_type: 'code', scope: 'user.info.basic,video.publish,video.upload', redirect_uri: redirect, state }),
    async exchange(app, code, redirect) {
      const { json: t } = await jfetch('https://open.tiktokapis.com/v2/oauth/token/', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form({ client_key: app.clientKey, client_secret: app.clientSecret, code, grant_type: 'authorization_code', redirect_uri: redirect }) });
      if (!t.access_token) throw new Error(t.error_description || 'TikTok login failed');
      let name = t.open_id;
      try { const { json: u } = await jfetch('https://open.tiktokapis.com/v2/user/info/?fields=open_id,display_name', { headers: { Authorization: `Bearer ${t.access_token}` } }); name = u.data?.user?.display_name || name; } catch {}
      return [{ name, ext_id: t.open_id, secret: { access_token: t.access_token, refresh_token: t.refresh_token }, expires_at: Date.now() + t.expires_in * 1000, can_upload: 1, can_live: 0 }];
    },
  },
  async refresh(acc, app, s) {
    const { json: t } = await jfetch('https://open.tiktokapis.com/v2/oauth/token/', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form({ client_key: app.clientKey, client_secret: app.clientSecret, grant_type: 'refresh_token', refresh_token: s.refresh_token }) });
    if (!t.access_token) throw new Error(t.error_description || 'TikTok refresh failed');
    return { secret: { ...s, access_token: t.access_token, refresh_token: t.refresh_token || s.refresh_token }, expires_at: Date.now() + t.expires_in * 1000 };
  },
  async upload(acc, s, job) {
    const H = { Authorization: `Bearer ${s.access_token}`, 'Content-Type': 'application/json; charset=UTF-8' };
    const api = 'https://open.tiktokapis.com/v2/post/publish';
    const { json: ci } = await jfetch(`${api}/creator_info/query/`, { method: 'POST', headers: H });
    const opts = ci.data?.privacy_level_options || ['SELF_ONLY'];
    const wantMap = { public: 'PUBLIC_TO_EVERYONE', unlisted: 'MUTUAL_FOLLOW_FRIENDS', private: 'SELF_ONLY' };
    const want = wantMap[job.options.privacy || 'public'];
    const privacy = opts.includes(want) ? want : (opts.includes('SELF_ONLY') ? 'SELF_ONLY' : opts[0]);
    const size = fs.statSync(job.file).size;
    const MB = 1024 * 1024;
    const chunk = size <= 64 * MB ? size : 10 * MB;          // one chunk up to 64 MB, else 10 MB chunks
    const count = Math.max(1, Math.floor(size / chunk));       // last chunk takes the remainder
    const { json: init } = await jfetch(`${api}/video/init/`, { method: 'POST', headers: H, body: JSON.stringify({
      post_info: { title: [job.title, job.body].filter(Boolean).join('\n').slice(0, 2200), privacy_level: privacy, disable_comment: false, disable_duet: false, disable_stitch: false, is_aigc: !!job.options.ai },
      source_info: { source: 'FILE_UPLOAD', video_size: size, chunk_size: chunk, total_chunk_count: count },
    }) });
    const { publish_id, upload_url } = init.data;
    const fd = await fs.promises.open(job.file, 'r');
    try {
      for (let i = 0; i < count; i++) {
        const start = i * chunk, end = i === count - 1 ? size - 1 : start + chunk - 1;
        const buf = Buffer.alloc(end - start + 1);
        await fd.read(buf, 0, buf.length, start);
        const r = await fetch(upload_url, { method: 'PUT', body: buf, headers: { 'Content-Type': 'video/mp4', 'Content-Length': String(buf.length), 'Content-Range': `bytes ${start}-${end}/${size}` } });
        if (!r.ok && r.status !== 206 && r.status !== 201) throw new Error(`TikTok chunk ${i + 1}/${count}: HTTP ${r.status}`);
      }
    } finally { await fd.close(); }
    for (let i = 0; i < 60; i++) {
      await sleep(5000);
      const { json: st } = await jfetch(`${api}/status/fetch/`, { method: 'POST', headers: H, body: JSON.stringify({ publish_id }) });
      if (st.data?.status === 'PUBLISH_COMPLETE') return { url: `https://www.tiktok.com/@${acc.name}`, note: privacy === 'SELF_ONLY' ? 'Posted as private (app not audited yet)' : '' };
      if (st.data?.status === 'FAILED') throw new Error(`TikTok: ${st.data.fail_reason || 'failed'}`);
    }
    throw new Error('TikTok: still processing after 5 min');
  },
};

// ======================================================= Meta (Facebook Page + Instagram)
const metaOauth = {
  url: (app, state, redirect) => `https://www.facebook.com/${G}/dialog/oauth?` + form({
    client_id: app.appId, redirect_uri: redirect, state, response_type: 'code',
    scope: 'pages_show_list,pages_read_engagement,pages_manage_posts,publish_video,business_management,instagram_basic,instagram_content_publish',
  }),
  async exchange(app, code, redirect) {
    const { json: t } = await jfetch(`https://graph.facebook.com/${G}/oauth/access_token?` + form({ client_id: app.appId, client_secret: app.appSecret, redirect_uri: redirect, code }));
    const { json: ll } = await jfetch(`https://graph.facebook.com/${G}/oauth/access_token?` + form({ grant_type: 'fb_exchange_token', client_id: app.appId, client_secret: app.appSecret, fb_exchange_token: t.access_token }));
    const { json: pages } = await jfetch(`https://graph.facebook.com/${G}/me/accounts?` + form({ fields: 'id,name,access_token,instagram_business_account{id,username}', access_token: ll.access_token, limit: 100 }));
    const out = [];
    for (const p of pages.data || []) {
      // Page tokens made from a long-lived user token do not expire.
      out.push({ platform: 'facebook', name: p.name, ext_id: p.id, secret: { access_token: p.access_token }, expires_at: null, can_upload: 1, can_live: 1 });
      if (p.instagram_business_account) out.push({ platform: 'instagram', name: '@' + p.instagram_business_account.username, ext_id: p.instagram_business_account.id, secret: { access_token: p.access_token, page_id: p.id }, expires_at: null, can_upload: 1, can_live: 0 });
    }
    if (!out.length) throw new Error('No Facebook Pages found. Instagram must be a Business/Creator account linked to a Page.');
    return out;
  },
};

const facebook = {
  label: 'Facebook Page', app: 'meta', upload: true, live: true, oauth: metaOauth,
  async upload(acc, s, job) {
    const fd = new FormData();
    fd.append('access_token', s.access_token);
    fd.append('title', job.title.slice(0, 255));
    fd.append('description', job.body);
    fd.append('source', await fileBlob(job.file), path.basename(job.file));
    const { json } = await jfetch(`https://graph-video.facebook.com/${G}/${acc.ext_id}/videos`, { method: 'POST', body: fd });
    return { url: `https://www.facebook.com/${json.id}` };
  },
  async liveIngest(acc, { title, rt, s }) {
    const { json } = await jfetch(`https://graph.facebook.com/${G}/${acc.ext_id}/live_videos`, { method: 'POST', body: form({ status: 'LIVE_NOW', title, access_token: s.access_token }) });
    if (rt) rt.onStopHooks = [...(rt.onStopHooks || []), () => jfetch(`https://graph.facebook.com/${G}/${json.id}`, { method: 'POST', body: form({ end_live_video: 'true', access_token: s.access_token }) })];
    return json.secure_stream_url || json.stream_url;
  },
};

const instagram = {
  label: 'Instagram', app: 'meta', upload: true, live: false, oauth: metaOauth,
  async upload(acc, s, job) {
    const api = `https://graph.facebook.com/${G}`;
    const caption = [job.title, job.body].filter(Boolean).join('\n\n').slice(0, 2200);
    let creation;
    if (PUBLIC_URL && job.publicUrl) {
      ({ json: creation } = await jfetch(`${api}/${acc.ext_id}/media`, { method: 'POST', body: form({ media_type: 'REELS', video_url: job.publicUrl, caption, share_to_feed: 'true', access_token: s.access_token }) }));
    } else {
      // Resumable upload: no public URL needed.
      ({ json: creation } = await jfetch(`${api}/${acc.ext_id}/media`, { method: 'POST', body: form({ media_type: 'REELS', upload_type: 'resumable', caption, share_to_feed: 'true', access_token: s.access_token }) }));
      const size = fs.statSync(job.file).size;
      await jfetch(`https://rupload.facebook.com/ig-api-upload/${G}/${creation.id}`, { method: 'POST', body: await fileBlob(job.file), headers: { Authorization: `OAuth ${s.access_token}`, offset: '0', file_size: String(size) } });
    }
    for (let i = 0; i < 60; i++) {
      await sleep(5000);
      const { json: st } = await jfetch(`${api}/${creation.id}?` + form({ fields: 'status_code,status', access_token: s.access_token }));
      if (st.status_code === 'FINISHED') break;
      if (st.status_code === 'ERROR' || st.status_code === 'EXPIRED') throw new Error(`Instagram: ${st.status || st.status_code}`);
      if (i === 59) throw new Error('Instagram: still processing after 5 min');
    }
    const { json: pub } = await jfetch(`${api}/${acc.ext_id}/media_publish`, { method: 'POST', body: form({ creation_id: creation.id, access_token: s.access_token }) });
    let url = 'https://www.instagram.com/';
    try { const { json: p } = await jfetch(`${api}/${pub.id}?` + form({ fields: 'permalink', access_token: s.access_token })); url = p.permalink || url; } catch {}
    return { url };
  },
};

// ======================================================= Mock (for tests and dry runs)
const mock = {
  label: 'Test account', app: null, upload: true, live: true,
  async upload(acc, s, job) {
    await sleep(Number(process.env.MOCK_DELAY_MS || 800));
    if (/\[fail\]/i.test(job.title) || s?.failNext) throw new Error('Mock platform said no (test failure)');
    const out = path.join(DATA, 'mock-out', `${acc.id}_${Date.now()}_${path.basename(job.file)}`);
    await fs.promises.copyFile(job.file, out);
    if (job.thumbnail) await fs.promises.copyFile(job.thumbnail, out + '.thumb.jpg');
    fs.writeFileSync(out + '.json', JSON.stringify({ account: acc.name, title: job.title, body: job.body, tags: job.tags, options: job.options, thumbnail: !!job.thumbnail }, null, 2));
    return { url: `file://${out.replace(/\\/g, '/')}` };
  },
};

// Stream-key only platforms. Live only, no posting API used here.
const keyOnly = (label, server) => ({ label, app: null, upload: false, live: true, defaultServer: server });

module.exports = {
  youtube, tiktok, facebook, instagram, mock,
  twitch: keyOnly('Twitch', 'rtmp://live.twitch.tv/app'),
  kick: keyOnly('Kick', 'rtmps://fa723fc1b171.global-contribute.live-video.net/app'),
  youtube_live: keyOnly('YouTube LIVE (key)', 'rtmp://a.rtmp.youtube.com/live2'),
  facebook_live: keyOnly('Facebook LIVE (key)', 'rtmps://live-api-s.facebook.com:443/rtmp'),
  tiktok_live: keyOnly('TikTok LIVE (key)', 'rtmp://push.tiktokcdn.com/live'),
  instagram_live: keyOnly('Instagram LIVE (key)', 'rtmps://edgetee-upload.instagram.com:443/rtmp'),
  x_live: keyOnly('X LIVE (key)', 'rtmp://va.pscp.tv:80/x'),
  rtmp: keyOnly('Custom RTMP', ''),
};
