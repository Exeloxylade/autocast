// AutoCast UI prototype: static mock data, hash router.
const PF = { yt:'YT', tt:'TT', ig:'IG', fb:'FB', x:'X', tw:'TW', kk:'K', th:'@' };
const pf = (k, sm) => `<span class="pf ${k}${sm ? ' sm' : ''}">${PF[k]}</span>`;
const stack = ks => `<span class="stack">${ks.map(k => pf(k, 1)).join('')}</span>`;
const spark = (pts, c = 'var(--ok)') => {
  const max = Math.max(...pts), min = Math.min(...pts);
  const d = pts.map((p, i) => `${(i / (pts.length - 1)) * 70},${20 - ((p - min) / (max - min || 1)) * 18}`).join(' ');
  return `<svg class="spark" viewBox="0 0 70 22"><polyline fill="none" stroke="${c}" stroke-width="1.6" points="${d}"/></svg>`;
};
const meter = n => `<span class="meter">${[6, 9, 12, 14, 10, 8].map((h, i) => `<i style="height:${h}px;opacity:${i < n ? 1 : .2}"></i>`).join('')}</span>`;

const V = {};

/* ---------------- AUTO UPLOAD ---------------- */
V['upload/overview'] = () => `
<div class="head"><div><h1>Good afternoon, Ahmad</h1><p class="sub">6 posts go out today. 1 needs a re-login.</p></div>
<div class="row"><button class="btn" data-go="upload/calendar">▤ Calendar</button><button class="btn pri" data-go="upload/create">＋ Create post</button></div></div>
<div class="grid g4">
 <div class="card stat"><div class="k">Posted this week</div><div class="v">42</div><div class="d up">▲ 18% vs last week</div></div>
 <div class="card stat"><div class="k">Scheduled</div><div class="v">19</div><div class="d muted">next in 38 min</div></div>
 <div class="card stat"><div class="k">Views (7 days)</div><div class="v">128K</div><div class="d up">▲ 9.4%</div></div>
 <div class="card stat"><div class="k">Failed</div><div class="v" style="color:var(--warn)">1</div><div class="d muted">TikTok · token expired</div></div>
</div>
<div class="grid" style="grid-template-columns:1.5fr 1fr;margin-top:16px">
 <div class="card"><h3>Up next <small>today</small></h3><div class="list">
  ${[
    ['t1','Why Rupiah Fell 5% in One Week','13:20',['yt','tt','ig','fb'],'ok','Ready'],
    ['t2','Gold vs Bitcoin: 2026 Recap','15:00',['yt','fb'],'ok','Ready'],
    ['t3','Short: Nickel Ban Explained','17:30',['tt','ig','yt'],'warn','TikTok login'],
    ['t4','Weekly Market Wrap #44','20:00',['yt','x','th'],'ac','Auto from folder'],
  ].map(([t, n, h, p, s, l]) => `<div class="li"><div class="thumb ${t}"></div><div class="grow"><div class="t">${n}</div><div class="s">Today ${h}</div></div>${stack(p)}<span class="pill ${s}">${l}</span></div>`).join('')}
 </div></div>
 <div class="card"><h3>Autopilot <small>3 rules on</small></h3><div class="list">
  <div class="li"><span class="tgl on"></span><div class="grow"><div class="t">Automated Lunch Free → all</div><div class="s">New video in folder → post next slot</div></div></div>
  <div class="li"><span class="tgl on"></span><div class="grow"><div class="t">Long video → 3 Shorts</div><div class="s">Cut, add captions, post over 3 days</div></div></div>
  <div class="li"><span class="tgl on"></span><div class="grow"><div class="t">Repost winners</div><div class="s">Top 10% post again after 30 days</div></div></div>
 </div><button class="btn ghost sm" style="margin-top:10px" data-go="upload/autopilot">Manage rules →</button></div>
</div>
<div class="card" style="margin-top:16px"><h3>Per platform <small>last 7 days</small></h3>
<table class="tablex"><tr><th>Platform</th><th>Accounts</th><th>Posts</th><th>Views</th><th>Trend</th><th>Health</th></tr>
${[['yt','YouTube',3,14,'71K',[3,4,4,6,5,7,9]],['tt','TikTok',2,12,'38K',[5,4,6,5,7,6,8]],['ig','Instagram',2,9,'12K',[2,3,3,4,3,5,4]],['fb','Facebook Page',1,7,'7K',[4,3,3,2,3,3,4]]]
 .map(([k, n, a, p, v, s]) => `<tr><td><div class="row">${pf(k)} ${n}</div></td><td>${a}</td><td>${p}</td><td><b>${v}</b></td><td>${spark(s, 'var(--ac)')}</td><td>${k === 'tt' ? '<span class="pill warn">1 re-login</span>' : '<span class="pill ok">Good</span>'}</td></tr>`).join('')}
</table></div>`;

V['upload/create'] = () => `
<div class="head"><div><h1>Create post</h1><p class="sub">One video. Many accounts. Text tuned per app.</p></div>
<div class="row"><button class="btn ghost">Save draft</button></div></div>
<div class="steps"><div class="step done"><b>✓</b>Media</div><div class="step done"><b>✓</b>Accounts</div><div class="step on"><b>3</b>Text per app</div><div class="step"><b>4</b>When</div></div>
<div class="create">
 <div class="grid">
  <div class="card"><h3>Media</h3><div class="drop"><div class="thumb t1"></div><div class="grow"><div class="t" style="font-weight:600">rupiah_fell_final.mp4</div><div class="s muted">1080×1920 · 0:58 · 42 MB · from Automated Lunch Free</div><div class="chips" style="margin-top:8px"><span class="chip on">9:16 ✓</span><span class="chip">16:9 auto-crop</span><span class="chip">1:1 auto-crop</span></div></div><button class="btn sm">Replace</button></div></div>
  <div class="card"><h3>Accounts <small>5 picked · group “Finance ID”</small></h3><div class="acc-grid">
   ${[['yt','Ahmad Finance',1],['yt','Ahmad Shorts',1],['tt','@ahmad.money',1],['ig','@ahmad.money',1],['fb','Ahmad Finance Page',1],['x','@ahmadfin',0],['th','@ahmad.money',0],['tt','@ahmad.news',0]]
   .map(([k, n, on]) => `<div class="acc ${on ? 'on' : ''}">${pf(k)}<div><div style="font-weight:600;font-size:13px">${n}</div></div><span class="ck">${on ? '✓' : ''}</span></div>`).join('')}
  </div></div>
  <div class="card"><div class="tabs">
   <button class="tab on">${pf('yt', 1)} YouTube</button><button class="tab">${pf('tt', 1)} TikTok</button><button class="tab">${pf('ig', 1)} Instagram</button><button class="tab">${pf('fb', 1)} Facebook</button></div>
   <label class="f">Title <span class="muted" style="float:right">38 / 100</span></label><input class="in" value="Why Rupiah Fell 5% in One Week #shorts">
   <label class="f">Description</label><textarea class="in">The rupiah just had its worst week since 2020. Here's what happened, in 60 seconds.</textarea>
   <div class="row" style="justify-content:space-between;margin-top:8px"><div class="chips"><span class="chip on"># finance set</span><span class="chip"># indonesia set</span><span class="chip">＋ hashtags</span></div><button class="btn sm">✦ AI rewrite for each app</button></div>
   <label class="f">YouTube options</label>
   <div class="check"><span class="tgl on"></span>Made for kids: No</div>
   <div class="check"><span class="tgl on"></span>Mark as AI-made content</div>
   <div class="check"><span class="tgl"></span>Post first comment: “Full video on the channel 👆”</div>
  </div>
  <div class="card"><h3>When</h3><div class="when">
   <div class="opt"><b>Now</b><small>Send right away</small></div>
   <div class="opt on"><b>Next free slot</b><small>Today 13:20 per account</small></div>
   <div class="opt"><b>Pick time</b><small>Date &amp; time</small></div></div>
  </div>
 </div>
 <div class="card" style="position:sticky;top:0"><h3>Preview <small>live as you type</small></h3>
  <div class="pv-tabs"><span class="chip on">YouTube Shorts</span><span class="chip">TikTok</span><span class="chip">Reels</span></div>
  <div class="phone"><div class="scr"></div><div class="big">RUPIAH<br>−5%</div>
   <div class="rail"><div><span></span>12K</div><div><span></span>340</div><div><span></span>Share</div></div>
   <div class="cap"><b>@AhmadFinance</b>Why Rupiah Fell 5% in One Week #shorts</div></div>
  <div style="margin-top:16px"><div class="check"><span class="dot ok"></span>Size fits all 5 accounts</div><div class="check"><span class="dot ok"></span>Text fits every app limit</div><div class="check"><span class="dot warn"></span>TikTok @ahmad.money needs re-login before 13:20</div></div>
  <button class="btn pri" style="width:100%;justify-content:center;margin-top:12px">Schedule to 5 accounts</button>
 </div>
</div>`;

V['upload/calendar'] = () => {
  const days = [['Mon', 26], ['Tue', 27], ['Wed', 28], ['Thu', 29], ['Fri', 30], ['Sat', 31], ['Sun', 1]];
  const ev = { '0-0': ['y', 'yt', 'Market wrap'], '1-1': ['t', 'tt', 'Nickel short'], '2-0': ['i', 'ig', 'Gold reel'], '2-2': ['y', 'yt', 'Bitcoin'], '3-1': ['f', 'fb', 'Rupiah'], '4-3': ['y', 'yt', 'Weekly #43'], '5-1': ['y', 'yt', 'Rupiah −5%'], '5-2': ['t', 'tt', 'Rupiah'], '5-3': ['i', 'ig', 'Rupiah'], '6-0': ['f', 'fb', 'Recap'] };
  const times = ['09:00', '13:00', '17:00', '20:00'];
  let g = `<div></div>${days.map(([d, n], i) => `<div class="ch ${i === 5 ? 'today' : ''}">${d}<b>${n}</b></div>`).join('')}`;
  times.forEach((t, r) => {
    g += `<div class="tm">${t}</div>`;
    days.forEach((_, c) => {
      const e = ev[`${c}-${r}`];
      g += `<div class="cell">${e ? `<div class="ev ${e[0]}">${pf(e[1], 1)} ${e[2]}</div>` : (c >= 5 && !e ? '<div class="ev slot">＋ free slot</div>' : '')}</div>`;
    });
  });
  return `<div class="head"><div><h1>Calendar</h1><p class="sub">Drag a post to move it. Dashed boxes are free slots.</p></div>
  <div class="row"><div class="seg"><button>Day</button><button class="on">Week</button><button>Month</button></div><div class="seg"><button class="on">All</button><button>YouTube</button><button>TikTok</button><button>IG</button><button>FB</button></div><button class="btn pri" data-go="upload/create">＋ Create</button></div></div>
  <div class="cal">${g}</div>`;
};

V['upload/autopilot'] = () => `
<div class="head"><div><h1>Autopilot rules</h1><p class="sub">“When this happens, do that.” Runs on the VPS, even when your PC is off.</p></div><button class="btn pri">＋ New rule</button></div>
<div class="grid">
${[
  ['on', 'Automated Lunch Free → all accounts', [['📁', 'New file in /exports'], ['✦', 'AI writes title + text'], ['🖼', 'Make thumbnail'], ['⏱', 'Next free slot'], ['', stack(['yt', 'tt', 'ig', 'fb'])]], 'Ran 14× · last 2h ago'],
  ['on', 'Long video → 3 Shorts', [['🎬', 'YouTube long video posted'], ['✂', 'Cut 3 best parts'], ['Aa', 'Burn captions'], ['📅', '1 per day'], ['', stack(['tt', 'ig', 'yt'])]], 'Ran 5× · last yesterday'],
  ['on', 'Repost winners', [['📈', 'Post in top 10%'], ['⏳', 'Wait 30 days'], ['✦', 'New hook text'], ['', stack(['tt', 'ig'])]], 'Ran 2× · last 6 days ago'],
  ['', 'RSS news → X + Threads', [['📰', 'New item in feed'], ['✦', 'AI summary'], ['', stack(['x', 'th'])]], 'Paused'],
].map(([on, n, steps, s]) => `<div class="card rule"><span class="tgl ${on}"></span><div><div style="font-weight:700;margin-bottom:8px">${n}</div><div class="flow">${steps.map(([i, t]) => `<span class="node">${i} ${t}</span>`).join('<span class="arrow">→</span>')}</div></div><div style="text-align:right"><div class="s muted" style="font-size:12px">${s}</div><button class="btn sm" style="margin-top:6px">Edit</button></div></div>`).join('')}
</div>`;

V['upload/library'] = () => `
<div class="head"><div><h1>Media library</h1><p class="sub">Everything you can post. Synced from your folders and Google Drive.</p></div><button class="btn pri">⬆ Upload</button></div>
<div class="grid g4">${['t1', 't2', 't3', 't4', 't2', 't1', 't4', 't3'].map((t, i) => `<div class="card" style="padding:10px"><div class="thumb ${t}" style="width:100%;height:auto;aspect-ratio:16/9"></div><div style="font-weight:600;margin-top:8px;font-size:13px">video_${101 + i}.mp4</div><div class="row" style="justify-content:space-between"><span class="s muted" style="font-size:12px">0:${40 + i}s · 9:16</span>${i % 3 ? '<span class="pill ok">Posted 4×</span>' : '<span class="pill">New</span>'}</div></div>`).join('')}</div>`;

/* ---------------- AUTO LIVE ---------------- */
const stations = [
  ['game', 'Retro Runner 24/7', 'AI plays game', ['yt', 'tw', 'kk', 'tt'], 'live', '3d 04:12', '1,284'],
  ['ai', 'AI Market Host', 'AI host + chat', ['yt', 'fb', 'kk'], 'live', '11:40:05', '412'],
  ['lofi', 'Lofi Finance Radio', 'File loop', ['yt', 'tw'], 'live', '6d 22:01', '96'],
  ['off', 'Night News Replay', 'File loop', ['yt'], 'sched', 'Starts 22:00', '—'],
];
V['live/stations'] = () => `
<div class="head"><div><h1>Stations</h1><p class="sub">Each station is one 24/7 channel sent to many accounts.</p></div>
<div class="row"><button class="btn">⚡ Test VPS speed</button><button class="btn pri" data-go="live/new">＋ New station</button></div></div>
<div class="grid g4" style="margin-bottom:16px">
 <div class="card stat"><div class="k">Live now</div><div class="v" style="color:var(--lv)">3</div><div class="d muted">9 destinations</div></div>
 <div class="card stat"><div class="k">Viewers now</div><div class="v">1,792</div><div class="d up">▲ 220 last hour</div></div>
 <div class="card stat"><div class="k">Upload used</div><div class="v">31 <small style="font-size:14px;color:var(--tx3)">/ 100 Mbps</small></div><div class="d muted">room for ~10 more</div></div>
 <div class="card stat"><div class="k">Auto-fixed today</div><div class="v">2</div><div class="d muted">Kick dropped, reconnected</div></div>
</div>
<div class="grid g2">${stations.map(([sc, n, ty, d, st, up, vw]) => `
 <div class="card station" data-go="live/control" style="cursor:pointer"><div class="screen"><div class="scene ${sc}"></div><div class="ovl"><div class="tl">${st === 'live' ? `<span class="live-b">LIVE</span><span class="glass">${up}</span>` : `<span class="glass">⏱ ${up}</span>`}</div><div class="row" style="justify-content:flex-end">${st === 'live' ? `<span class="glass">👁 ${vw}</span>` : ''}</div></div></div>
 <div class="st-body"><div class="row" style="justify-content:space-between"><div><div class="nm">${n}</div><div class="s muted" style="font-size:12px">${ty}</div></div>${st === 'live' ? '<button class="btn sm danger">■ Stop</button>' : '<button class="btn sm">▶ Start now</button>'}</div>
 <div class="dests">${d.map((k, i) => `<span class="dest">${pf(k, 1)}${st === 'live' ? (k === 'kk' && i === 2 ? '<span class="dot warn"></span>retrying' : `<span class="dot ok"></span>${['6.0', '5.8', '6.1', '4.5'][i]} Mb`) : 'waiting'}</span>`).join('')}</div></div></div>`).join('')}
</div>`;

V['live/control'] = () => `
<div class="head"><div><div class="row"><h1>Retro Runner 24/7</h1><span class="live-b">LIVE</span></div><p class="sub">AI plays game · up 3d 04:12 · 1080p 30fps · 6 Mbps</p></div>
<div class="row"><button class="btn">⏭ Skip</button><button class="btn">⏸ Hold screen</button><button class="btn danger">■ End stream</button></div></div>
<div class="control">
 <div class="grid">
  <div class="card"><h3>Up next <small>never empty</small></h3>
   <div class="q now"><span class="n">▶</span><div class="thumb t4"></div><div class="grow"><div class="t" style="font-size:13px;font-weight:600">Bot run · level 14</div><div class="prog"><span style="width:62%"></span></div></div></div>
   ${[['t2', 'Highlights · 10 min'], ['t1', 'Bot run · level 15'], ['t3', 'Viewer vote break']].map(([t, n], i) => `<div class="q"><span class="n">${i + 2}</span><div class="thumb ${t}"></div><div class="grow"><div style="font-size:13px;font-weight:600">${n}</div><div class="s muted" style="font-size:11.5px">queued</div></div></div>`).join('')}
   <div class="rulebox" style="background:var(--bg2);border-color:var(--line);color:var(--tx2)">🛟 Backup clip plays if the bot stalls &gt; 5 s</div>
  </div>
  <div class="card"><h3>Overlay</h3>
   ${['Logo', 'Clock', 'Chat on screen', 'Viewer poll', 'Follow alerts'].map((o, i) => `<div class="check" style="justify-content:space-between">${o}<span class="tgl ${i !== 3 ? 'on' : ''}"></span></div>`).join('')}
  </div>
 </div>
 <div class="grid">
  <div class="card" style="padding:12px"><div class="screen" style="border-radius:10px"><div class="scene game"></div><div class="ovl"><div class="tl"><span class="live-b">LIVE</span><span class="glass">👁 1,284</span></div><div class="row" style="justify-content:space-between"><span class="glass">LVL 14 · SCORE 48,210</span><span class="glass">22:41</span></div></div></div>
   <div class="kv"><div><small>Bitrate out</small><b>6.0 Mbps</b></div><div><small>Dropped frames</small><b>0.02%</b></div><div><small>CPU</small><b>41%</b></div><div><small>Encoder</small><b>x264 fast</b></div></div></div>
  <div class="card"><h3>Chat from all apps <small>AI replies on</small></h3><div class="chat">
   <div class="msg">${pf('yt', 1)}<div><span class="who">rizky_07</span> jump earlier bro 😂</div></div>
   <div class="msg">${pf('tw', 1)}<div><span class="who">pixelmama</span> how many runs today?</div></div>
   <div class="msg ai">${pf('kk', 1)}<div><span class="who" style="color:var(--lv2)">AI host</span> 214 runs today, pixelmama! Best score was 51K at 3am 👀</div></div>
   <div class="msg">${pf('tt', 1)}<div><span class="who">nana.id</span> vote slow mode!!</div></div>
  </div><div class="row" style="margin-top:10px"><input class="in" placeholder="Say something as host…"><button class="btn pri">Send</button></div></div>
 </div>
 <div class="card"><h3>Destinations <small>4 on</small></h3>
  ${[['yt', 'Ahmad Plays', 'ok', '6.0 Mbps · 812 viewers', [5, 6, 6, 6, 5, 6, 6]], ['tw', 'ahmadplays', 'ok', '6.0 Mbps · 301 viewers', [6, 6, 5, 6, 6, 6, 6]], ['kk', 'ahmadplays', 'warn', 'Reconnecting… try 2/5', [6, 6, 4, 1, 0, 2, 3]], ['tt', '@ahmad.plays', 'ok', '4.5 Mbps · 171 viewers', [4, 4, 5, 4, 4, 5, 4]]]
   .map(([k, n, s, d, sp]) => `<div class="dl">${pf(k)}<div><div style="font-weight:600;font-size:13px">${n}</div><div class="s muted" style="font-size:11.5px">${d}</div></div><div style="text-align:right">${spark(sp, s === 'ok' ? 'var(--ok)' : 'var(--warn)')}<div><span class="pill ${s}">${s === 'ok' ? 'Healthy' : 'Retrying'}</span></div></div></div>`).join('')}
  <button class="btn" style="width:100%;justify-content:center;margin-top:12px">＋ Add destination live</button>
  <div class="rulebox">⚠ TikTok needs a real live part. This station passes: AI plays in real time.</div>
 </div>
</div>`;

V['live/new'] = () => `
<div class="wiz">
<div class="head"><div><h1>New station</h1><p class="sub">Three steps. You can change everything later.</p></div></div>
<div class="steps"><div class="step on"><b>1</b>What plays</div><div class="step"><b>2</b>Where it goes</div><div class="step"><b>3</b>When &amp; quality</div></div>
<div class="types">
 <div class="type"><div class="screen"><div class="scene lofi"></div></div><div class="tb"><b>File loop</b><small>Play your videos in order, forever.</small><div style="margin-top:8px"><span class="pill">YouTube · Twitch · Kick</span></div></div></div>
 <div class="type on"><div class="screen"><div class="scene ai"></div></div><div class="tb"><b>AI host</b><small>AI talks, reads chat, shows clips.</small><div style="margin-top:8px"><span class="pill ok">All apps</span></div></div></div>
 <div class="type"><div class="screen"><div class="scene game"></div></div><div class="tb"><b>AI plays game</b><small>A bot plays a web game live.</small><div style="margin-top:8px"><span class="pill ok">All apps</span></div></div></div>
</div>
<div class="card" style="margin-top:16px"><h3>AI host setup</h3>
 <div class="grid g2"><div><label class="f">Station name</label><input class="in" value="AI Market Host"></div><div><label class="f">Voice</label><select class="in"><option>Gemini · Enzo (storyteller)</option></select></div></div>
 <label class="f">Host style</label><textarea class="in">Friendly finance host. Talks about markets, answers chat, never gives buy/sell advice.</textarea>
 <label class="f">Clips to show between talks</label><div class="chips"><span class="chip on">📁 /exports (Automated Lunch Free)</span><span class="chip on">📁 /shorts</span><span class="chip">＋ Add folder</span></div>
 <div class="rulebox">🛡 Word filter is on. The AI host will skip banned words and unsafe topics.</div>
</div>
<div class="card" style="margin-top:16px"><h3>Where it goes <small>step 2 preview</small></h3><div class="dest-pick">
 ${[['yt', 'Ahmad Finance', 1, ''], ['fb', 'Ahmad Finance Page', 1, ''], ['kk', 'ahmadfin', 1, ''], ['tw', 'ahmadfin', 0, ''], ['tt', '@ahmad.money', 0, 'No live key yet'], ['ig', '@ahmad.money', 0, 'Paste stream key']]
  .map(([k, n, on, why]) => `<div class="acc ${on ? 'on' : ''} ${why ? 'blocked' : ''}">${pf(k)}<div><div style="font-weight:600;font-size:13px">${n}</div>${why ? `<div class="why">${why}</div>` : ''}</div><span class="ck">${on ? '✓' : ''}</span></div>`).join('')}
</div></div>
<div class="sumbar"><div class="row"><span class="pill ac">AI host</span><span class="pill">3 destinations</span><span class="pill">~18 Mbps upload</span><span class="pill ok">VPS has room</span></div><button class="btn pri">Next: where it goes →</button></div>
</div>`;

V['live/sources'] = () => `
<div class="head"><div><h1>Sources &amp; playlists</h1><p class="sub">What stations can play. Folders refill themselves.</p></div><button class="btn pri">＋ New playlist</button></div>
<div class="grid g3">${[['t4', 'Game runs', '128 clips · 41 h', 'Auto-fill from bot'], ['t1', 'Finance clips', '64 clips · 9 h', 'Auto-fill from /exports'], ['t3', 'Lofi music beds', '30 tracks · 2 h', 'Shuffle'], ['t2', 'Backup screens', '3 clips', 'Plays on error']].map(([t, n, s, m]) => `<div class="card"><div class="thumb ${t}" style="width:100%;height:auto;aspect-ratio:16/7;border-radius:10px"></div><div style="font-weight:700;margin-top:10px">${n}</div><div class="row" style="justify-content:space-between;margin-top:4px"><span class="s muted" style="font-size:12px">${s}</span><span class="pill ac">${m}</span></div></div>`).join('')}</div>`;

V['live/schedule'] = () => `
<div class="head"><div><h1>Live schedule</h1><p class="sub">When each station turns on and off.</p></div></div>
<div class="card"><table class="tablex"><tr><th>Station</th><th>Mon–Fri</th><th>Sat–Sun</th><th>Destinations</th><th>State</th></tr>
${[['Retro Runner 24/7', 'Always on', 'Always on', ['yt', 'tw', 'kk', 'tt'], 'live'], ['AI Market Host', '08:00 – 23:00', 'Off', ['yt', 'fb', 'kk'], 'live'], ['Lofi Finance Radio', 'Always on', 'Always on', ['yt', 'tw'], 'live'], ['Night News Replay', '22:00 – 02:00', '22:00 – 02:00', ['yt'], 'sched']]
 .map(([n, a, b, d, s]) => `<tr><td style="font-weight:600">${n}</td><td>${a}</td><td>${b}</td><td>${stack(d)}</td><td>${s === 'live' ? '<span class="pill bad"><span class="dot live"></span>Live</span>' : '<span class="pill">Scheduled</span>'}</td></tr>`).join('')}
</table></div>`;

/* ---------------- SHARED ---------------- */
V['shared/accounts'] = () => `
<div class="head"><div><h1>Accounts</h1><p class="sub">Log in once. Used by Auto Upload and Auto Live.</p></div><button class="btn pri">＋ Connect account</button></div>
<div class="grid g4" style="margin-bottom:16px">${[['yt', 'YouTube', 'Google login'], ['tt', 'TikTok', 'TikTok login'], ['ig', 'Instagram', 'Meta login'], ['fb', 'Facebook', 'Meta login'], ['x', 'X', 'X login · paid'], ['th', 'Threads', 'Meta login'], ['tw', 'Twitch', 'Stream key'], ['kk', 'Kick', 'Stream key']].map(([k, n, m]) => `<div class="card acc-card" style="padding:14px">${pf(k)}<div><div style="font-weight:700">${n}</div><div class="s muted" style="font-size:12px">${m}</div></div></div>`).join('')}</div>
<div class="card"><h3>Connected <small>groups: Finance ID · Games · News</small></h3><table class="tablex"><tr><th>Account</th><th>Group</th><th>Used for</th><th>Login</th><th>Proxy</th><th></th></tr>
${[['yt', 'Ahmad Finance', 'Finance ID', 'Upload · Live', 'ok', 'Good · auto-refresh', 'SG-1'], ['yt', 'Ahmad Plays', 'Games', 'Live', 'ok', 'Good · auto-refresh', 'SG-2'], ['tt', '@ahmad.money', 'Finance ID', 'Upload', 'warn', 'Expired · re-login', 'ID-1'], ['ig', '@ahmad.money', 'Finance ID', 'Upload', 'ok', 'Good · 41 days left', 'ID-1'], ['fb', 'Ahmad Finance Page', 'Finance ID', 'Upload · Live', 'ok', 'Good · 52 days left', 'ID-1'], ['kk', 'ahmadplays', 'Games', 'Live', 'ok', 'Stream key saved', '—']]
 .map(([k, n, g, u, s, l, p]) => `<tr><td><div class="row">${pf(k)}<b>${n}</b></div></td><td><span class="chip">${g}</span></td><td>${u}</td><td><span class="pill ${s}">${l}</span></td><td class="muted">${p}</td><td>${s === 'warn' ? '<button class="btn sm pri">Re-login</button>' : '<button class="btn sm ghost">⋯</button>'}</td></tr>`).join('')}
</table></div>`;

V['shared/settings'] = () => `
<div class="head"><div><h1>Settings</h1><p class="sub">Set once. Most people never come back here.</p></div></div>
<div class="grid g2">
 <div class="card"><h3>App keys <small>one per platform</small></h3>${[['yt', 'Google Cloud app', 'ok', 'Verified'], ['fb', 'Meta app', 'warn', 'In review · day 6'], ['tt', 'TikTok app', 'warn', 'Audit pending'], ['x', 'X app', '', 'Not set']].map(([k, n, s, l]) => `<div class="dl">${pf(k)}<div style="font-weight:600">${n}</div><span class="pill ${s}">${l}</span></div>`).join('')}</div>
 <div class="card"><h3>Live quality</h3><label class="f">Default</label><div class="seg"><button>720p</button><button class="on">1080p 30</button><button>1080p 60</button></div><label class="f">Encoder</label><div class="seg"><button class="on">CPU (x264)</button><button>Nvidia (NVENC)</button></div><label class="f">Max upload for all stations</label><input class="in" value="80 Mbps"></div>
 <div class="card"><h3>Alerts</h3>${['Telegram when a post fails', 'Telegram when a live drops > 1 min', 'Email weekly report', 'Warn at 80% monthly data'].map((o, i) => `<div class="check" style="justify-content:space-between">${o}<span class="tgl ${i < 2 || i === 3 ? 'on' : ''}"></span></div>`).join('')}</div>
 <div class="card"><h3>Storage</h3><div class="check" style="justify-content:space-between">Delete played live files after<select class="in" style="width:120px"><option>7 days</option></select></div><div class="check" style="justify-content:space-between">Delete posted media after<select class="in" style="width:120px"><option>30 days</option></select></div><div style="margin-top:10px"><div class="bar"><span style="width:46%"></span></div><div class="s muted" style="font-size:12px;margin-top:6px">46 GB of 100 GB used</div></div></div>
</div>`;

/* ---------------- router ---------------- */
const NAMES = { overview: 'Overview', create: 'Create post', calendar: 'Calendar', autopilot: 'Autopilot rules', library: 'Media library', stations: 'Stations', control: 'Control room', new: 'New station', sources: 'Sources & playlists', schedule: 'Schedule', accounts: 'Accounts', settings: 'Settings' };
const SPACE = { upload: 'Auto Upload', live: 'Auto Live', shared: 'Shared' };
function render() {
  const r = location.hash.slice(1) || 'upload/overview';
  const [sp, pg] = r.split('/');
  document.body.dataset.space = sp;
  document.getElementById('view').innerHTML = (V[r] || V['upload/overview'])();
  document.getElementById('crumbs').innerHTML = `<span class="tag">${SPACE[sp]}</span><b>${NAMES[pg] || ''}</b>`;
  document.querySelectorAll('.nav a').forEach(a => a.classList.toggle('on', a.dataset.go === r));
  document.getElementById('view').scrollTop = 0;
}
document.addEventListener('click', e => {
  const t = e.target.closest('[data-go]');
  if (t) { location.hash = t.dataset.go; }
  const tg = e.target.closest('.tgl'); if (tg) tg.classList.toggle('on');
  const ac = e.target.closest('.acc:not(.blocked)'); if (ac) { ac.classList.toggle('on'); ac.querySelector('.ck').textContent = ac.classList.contains('on') ? '✓' : ''; }
  const ty = e.target.closest('.type'); if (ty) { document.querySelectorAll('.type').forEach(x => x.classList.remove('on')); ty.classList.add('on'); }
});
addEventListener('hashchange', render);
render();
