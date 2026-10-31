// UI click-through against a running demo server (node test/demo.js).
//   PLAYWRIGHT_CORE=<path to playwright-core> node test/ui.e2e.js
const H = require('./helpers');
const { chromium } = require(process.env.PLAYWRIGHT_CORE || 'playwright-core');
const BASE = process.env.BASE || 'http://127.0.0.1:7676';
const api = H.client(BASE);

(async () => {
  const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || 'msedge', headless: true });
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  const errors = [];
  page.on('pageerror', e => errors.push(`pageerror: ${e.message}`));
  page.on('console', m => { if (m.type() === 'error' && !/404|Failed to load resource/.test(m.text())) errors.push(`console: ${m.text()}`); });
  page.on('dialog', d => d.accept());
  let ok = false;
  try {
    // every page renders without JS errors
    const routes = ['upload/overview', 'upload/create', 'upload/calendar', 'upload/posts', 'upload/autopilot', 'upload/library', 'live/stations', 'live/control?id=1', 'live/new', 'live/playlists', 'live/schedule', 'live/library', 'shared/accounts', 'shared/activity', 'shared/settings'];
    for (const r of routes) {
      await page.goto(`${BASE}/#${r}`); await page.waitForTimeout(900);
      const txt = await page.locator('#view').innerText();
      if (/Something went wrong|Loading…/.test(txt)) errors.push(`${r}: ${txt.slice(0, 120)}`);
    }
    H.check('all 15 pages render, no JS errors', errors.length === 0, errors.slice(0, 3).join(' | '));

    // 1. create a post through the form
    await page.goto(`${BASE}/#upload/create`); await page.waitForTimeout(800);
    await page.locator('.mcard').first().click();
    await page.locator('.acc', { hasText: 'Ahmad Finance (test)' }).click();
    await page.locator('#title').click(); await page.keyboard.type('UI test post #autocast');
    await page.locator('#body').click(); await page.keyboard.type('Typed in the browser');
    H.check('typing keeps focus (text not lost)', (await page.locator('#title').inputValue()) === 'UI test post #autocast');
    await page.locator('[data-w="now"]').click();
    await page.locator('#dup').click();                  // test may run twice on the same demo
    H.check('preview shows the caption', (await page.locator('.phone .cap').innerText()).includes('UI test post'));
    await page.locator('#send').click();
    await page.waitForURL(/upload\/posts/, { timeout: 5000 });
    const sent = await H.until(async () => (await api.get('/api/posts?status=done')).find(t => t.title === 'UI test post #autocast'), 20000, 'UI post sent');
    H.check('post made in UI gets sent', !!sent, sent?.account);

    // 2. per-app text toggle
    await page.goto(`${BASE}/#upload/create`); await page.waitForTimeout(800);
    await page.locator('.acc', { hasText: '@ahmad.money' }).click();
    await page.locator('#perOn').click();
    H.check('per-app tabs appear', await page.locator('.tabs .tab').count() >= 1);

    // 3. stream key via modal
    await page.goto(`${BASE}/#shared/accounts`); await page.waitForTimeout(800);
    await page.locator('#key').click();
    await page.locator('#kp').selectOption('twitch');
    await page.locator('#kn').fill('UI Twitch');
    await page.locator('#ks').fill('rtmp://127.0.0.1:1935/ui');   // local test relay, not real Twitch
    await page.locator('#kk').fill('live_ui_key');
    await page.locator('#ksv').click(); await page.waitForTimeout(800);
    H.check('stream key added from modal', (await page.locator('#view').innerText()).includes('UI Twitch'));
    H.check('key never shown in page', !(await page.content()).includes('live_ui_key'));

    // 4. autopilot rule via modal
    await page.goto(`${BASE}/#upload/autopilot`); await page.waitForTimeout(800);
    await page.locator('#new').click();
    await page.locator('#rn').fill('UI rule');
    await page.locator('#rf').fill(require('path').join(process.env.AUTOCAST_DATA || require('os').tmpdir(), 'ui-watch'));
    await page.locator('.modal .acc').first().click();
    await page.locator('#rs').click(); await page.waitForTimeout(800);
    H.check('rule made from modal', (await page.locator('#view').innerText()).includes('UI rule'));

    // 5. new station wizard -> control room -> go live -> stop
    await page.goto(`${BASE}/#live/new`); await page.waitForTimeout(800);
    await page.locator('#nm').fill('UI Station');
    await page.locator('#pq').selectOption('720p30');
    await page.locator('.mcard').nth(1).click();
    await page.locator('.dest-pick .acc', { hasText: 'UI Twitch' }).last().click();
    await page.locator('#mk').click();
    await page.waitForURL(/live\/control\?id=\d+/, { timeout: 5000 });
    H.check('wizard opens control room', true, page.url().split('#')[1]);
    await page.locator('#start').click({ timeout: 10000 });
    await page.locator('#hb .live-b').waitFor({ timeout: 60000 });
    H.check('Go live button -> LIVE badge', true);
    await page.locator('.dl .pill.ok').first().waitFor({ timeout: 60000 });
    H.check('destination shows Live', true);
    await page.waitForTimeout(3000);
    const kbps = await page.locator('#kv b').first().innerText();
    H.check('sending rate shown', /\d/.test(kbps) && !/NaN|null/.test(kbps), kbps);
    await page.locator('#stop').click();
    await page.locator('#start').waitFor({ timeout: 10000 });
    H.check('Stop button stops it', true);

    // 6. calendar card opens detail
    await page.goto(`${BASE}/#upload/calendar`); await page.waitForTimeout(900);
    await page.locator('.pcard').first().click();
    H.check('calendar post opens detail', await page.locator('.modal').isVisible());
    await page.keyboard.press('Escape');

    // ---------------- v2 screens
    const isLight = () => page.evaluate(() => document.body.classList.contains('light'));
    const before = await isLight();
    await page.locator('#theme').click();
    const flipped = (await isLight()) !== before;
    if (!(await isLight())) await page.locator('#theme').click();          // make sure we are in light for the picture
    await page.goto(`${BASE}/#live/stations`); await page.waitForTimeout(1200);
    const kept = await isLight();                                           // remembered after navigation
    await page.screenshot({ path: require('path').join(process.env.KIROCREW_SCRATCH || '.', 'ui-light.png') });
    H.check('v2: light / dark toggles and is remembered', flipped && kept);
    await page.locator('#theme').click();

    await page.goto(`${BASE}/#upload/create`); await page.waitForTimeout(800);
    await page.locator('[data-snip]').first().click();
    H.check('v2: snippet chip fills description', (await page.locator('#body').inputValue()).includes('#finance'));
    await page.locator('#rep').click();
    H.check('v2: repeat options appear', await page.locator('#rDays').isVisible());

    await page.goto(`${BASE}/#upload/posts`); await page.waitForTimeout(800);
    await page.locator('#csv').click();
    await page.locator('#cv').fill('file,title,description,accounts,when,allow_repeat\n#3,CSV from UI,made in a test,Ahmad Finance (test),slot,1\n#3,Bad row,,Nobody,slot,1');
    await page.locator('#cgo').click(); await page.waitForTimeout(1200);
    const cr = await page.locator('#cr').innerText();
    H.check('v2: CSV modal imports and shows errors', /1 post made/.test(cr) && /Line 3/.test(cr), cr.replace(/\n/g, ' | '));
    await page.keyboard.press('Escape');

    await page.goto(`${BASE}/#shared/accounts`); await page.waitForTimeout(800);
    await page.locator('[data-opt]').first().click();
    await page.locator('#od').fill('2'); await page.locator('#osv').click(); await page.waitForTimeout(800);
    H.check('v2: account daily limit saved', (await page.locator('#view').innerText()).includes('max 2/day'));

    await page.goto(`${BASE}/#live/control?id=1`); await page.waitForTimeout(1500);
    await page.locator('#xt').fill('Changed from the UI test');
    await page.locator('#xsave').click(); await page.waitForTimeout(1200);
    const st1 = await api.get('/api/stations/1');
    H.check('v2: overlay text saved from control room', st1.overlay.text === 'Changed from the UI test');
    H.check('v2: encoder shows overlay mode', /overlay/.test(await page.locator('#kv').innerText()));

    await page.goto(`${BASE}/#shared/settings`); await page.waitForTimeout(900);
    await page.locator('#tn').fill('UI test PC'); await page.locator('#tmk').click(); await page.waitForTimeout(800);
    H.check('v2: push token shown once with PC command', /ac_/.test(await page.locator('#tnew').innerText()) && /push\.js/.test(await page.locator('#tnew').innerText()));

    await page.goto(`${BASE}/#shared/activity`); await page.waitForTimeout(900);
    const rowsAll = await page.locator('.ev-row').count();
    await page.locator('[data-lv="error,warn"]').click(); await page.waitForTimeout(700);
    const lv = await page.locator('.ev-row .lvl').allInnerTexts();
    H.check('v2: activity log + problem filter', rowsAll > 5 && lv.every(t => /warn|error/i.test(t)), `${rowsAll} rows, ${lv.length} problems`);

    await page.goto(`${BASE}/#live/playlists`); await page.waitForTimeout(800);
    H.check('v2: playlists show folder link', await page.locator('[data-fold]').count() > 0);

    // ---------------- v3 AI screens (demo runs a fake AI)
    await page.goto(`${BASE}/#shared/settings`); await page.waitForTimeout(1200);
    H.check('ai: settings card shows Ready', /Ready/.test(await page.locator('#aistat').innerText()));
    await page.locator('#ats').click(); await page.waitForSelector('.toast:has-text("AI answered")', { timeout: 10000 });
    H.check('ai: Test button answers', true);

    await page.goto(`${BASE}/#upload/overview`); await page.waitForTimeout(1500);
    await page.locator('#askq').fill('post my newest video at the next free slot');
    await page.locator('#askgo').click();
    await page.locator('#askyes').waitFor({ timeout: 60000 });
    H.check('ai: Ask shows a plan to confirm', /Post video #\d+/.test(await page.locator('#askout').innerText()));
    await page.locator('#askyes').click();
    await page.waitForURL(/upload\/posts/, { timeout: 8000 });
    H.check('ai: confirmed plan made the post', (await page.locator('#view').innerText()).includes('Asked post'));

    await page.goto(`${BASE}/#upload/create`); await page.waitForTimeout(1000);
    await page.locator('.mcard').first().click();
    await page.locator('.acc', { hasText: '@ahmad.money (test)' }).click();
    await page.locator('#aiw').click();
    await page.waitForFunction(() => document.querySelector('#title')?.value === 'Gold hits a record', null, { timeout: 90000 });
    H.check('ai: Write with AI fills title + description', (await page.locator('#body').inputValue()).includes('#gold'));
    H.check('ai: 5 title ideas shown', await page.locator('[data-hook]').count() === 5);
    await page.locator('[data-hook]').nth(1).click();
    H.check('ai: clicking an idea sets the title', (await page.locator('#title').inputValue()) === 'Why gold is up 12%');
    await page.locator('#aisf').click(); await page.waitForFunction(() => /safety check:/.test(document.querySelector('#view').innerText), null, { timeout: 60000 });
    H.check('ai: safety check result shown', /safety check: looks fine/.test(await page.locator('#view').innerText()));

    await page.goto(`${BASE}/#upload/library`); await page.waitForTimeout(1000);
    await page.locator('[data-ai]').first().click();
    await page.locator('#t4').click();
    await page.locator('#t4o img').waitFor({ timeout: 120000 });
    H.check('ai: thumbnail made from the library', true);
    await page.screenshot({ path: require('path').join(process.env.KIROCREW_SCRATCH || '.', 'ui-ai-thumb.png') });
    await page.keyboard.press('Escape');

    await page.goto(`${BASE}/#live/control?id=1`); await page.waitForTimeout(1500);
    await page.locator('#xam').selectOption('ticker');
    await page.locator('#xap').fill('retro games'); await page.locator('#xae').fill('1');
    await page.locator('#xsave').click();
    await page.waitForFunction(() => /On screen now: Fun fact/.test(document.querySelector('#xaline')?.textContent || ''), null, { timeout: 60000 });
    H.check('ai: live ticker line shows in control room', true);

    H.check('no JS errors during flows', errors.length === 0, errors.slice(0, 3).join(' | '));
    ok = H.summary();
  } catch (e) {
    console.error('ERROR', e.message.split('\n')[0]);
    await page.screenshot({ path: require('path').join(process.env.KIROCREW_SCRATCH || '.', 'ui-fail.png') }).catch(() => {});
    H.summary();
  } finally {
    await browser.close();
    process.exit(ok ? 0 : 1);
  }
})();
