// A fake OpenAI-compatible server for tests. Answers each "TASK:<name>" with fixed JSON.
const http = require('http');

function start({ key = 'testkey' } = {}) {
  const calls = [];
  let n = 0;
  const srv = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => {
      const send = (code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
      if ((req.headers.authorization || '') !== `Bearer ${key}`) return send(401, { error: { message: 'Invalid API key' } });
      const raw = Buffer.concat(chunks);
      if (req.url.endsWith('/audio/transcriptions')) {
        calls.push({ task: 'stt', bytes: raw.length });
        return send(200, { text: 'gold went up today. here is why. buy low sell high.', duration: 9, segments: [
          { start: 0, end: 3, text: 'Gold went up twelve percent today.' }, { start: 3, end: 6, text: 'Here is why it happened.' }, { start: 6, end: 9, text: 'Central banks are buying.' }] });
      }
      if (!req.url.endsWith('/chat/completions')) return send(404, { error: { message: 'no route' } });
      const body = JSON.parse(raw.toString('utf8'));
      if (body.model === 'nofmt' && body.response_format) return send(400, { error: { message: 'response_format is not supported by this model' } });
      const sys = body.messages[0].content;
      const u = body.messages[1].content;
      const userText = typeof u === 'string' ? u : u.find(p => p.type === 'text').text;
      const images = typeof u === 'string' ? 0 : u.filter(p => p.type === 'image_url').length;
      const task = (/TASK:(\w+)/.exec(sys) || [])[1] || '?';
      calls.push({ task, images, model: body.model, fmt: !!body.response_format, user: userText });
      const plats = [...sys.matchAll(/"(\w+)": \{"title"/g)].map(m => m[1]);
      const rulePlats = [...new Set([...sys.matchAll(/(?:^|; |Rules: )(\w+): /g)].map(m => m[1]).filter(p => !['Rules', 'Language', 'Tone'].includes(p)))];
      let out;
      switch (task) {
        case 'write_post': out = { title: 'Gold hits a record', description: 'Why gold went up 12%.', hashtags: ['gold', '#markets', 'invest ing'], hooks: ['Gold just did THIS', 'Why gold is up 12%', 'Banks are buying gold', 'The gold rush is back', 'Is it too late?'], per_app: Object.fromEntries(plats.map(p => [p, { title: `${p} title`, body: `${p} body #gold` }])) }; break;
        case 'rewrite': out = { per_app: Object.fromEntries(rulePlats.map(p => [p, { title: `${p}: ${/Title: (.*)/.exec(userText)[1]}`, body: `${p} style` }])) }; break;
        case 'translate': out = { title: `[${/Translate to (\w+)/.exec(sys)[1]}] ${/Title: (.*)/.exec(userText)[1]}`, body: 'terjemahan' }; break;
        case 'pick_shorts': out = { clips: [{ start: 0.5, end: 4.5, hook: 'WAIT FOR IT', title: 'Gold up 12%' }, { start: 5, end: 9, hook: "Banks' secret", title: 'Why banks buy gold' }, { start: 50, end: 40, hook: 'bad', title: 'bad' }] }; break;
        case 'thumbnail': out = { best: 1, words: 'Gold record', number: '+12%' }; break;
        case 'safety': out = /guaranteed profit/i.test(userText) ? { ok: false, level: 'high', issues: ['misleading money claim'] } : { ok: true, level: 'none', issues: [] }; break;
        case 'live_ticker': out = { line: `Fun fact #${++n}: gold never rusts` }; break;
        case 'live_nowplaying': out = { line: `Now: ${(/Now playing: ([^.]+)/.exec(userText) || [])[1] || '?'}` }; break;
        case 'ask': {
          const data = JSON.parse(/Data: (.*)\nUser:/s.exec(userText)[1]);
          if (/stop/i.test(userText)) out = { reply: 'I will stop it.', action: { type: 'stop_station', id: data.stations[0]?.id } };
          else out = { reply: 'I will post it.', action: { type: 'create_post', media_id: (data.media.find(m => /lofi/.test(m.name)) || data.media[0]).id, account_ids: data.accounts.filter(a => a.can_upload).map(a => a.id).slice(0, 1), title: 'Asked post', body: 'made by ask', when: 'slot' } };
          break;
        }
        case 'explain': out = { summary: 'The server address is wrong.', steps: ['Check the server URL', 'Try again'] }; break;
        case 'digest': out = { headline: 'All good, 1 thing to check', text: 'Posts went out. One failed.' }; break;
        case 'slots': out = { slots: ['19:30', '8:15', '12:00', '99:99'], why: 'Lunch and evening.' }; break;
        default: out = { ok: true, hello: 'hi' };
      }
      const content = task === 'translate' ? '```json\n' + JSON.stringify(out) + '\n```' : JSON.stringify(out);   // fenced once, to test the parser
      send(200, { choices: [{ message: { role: 'assistant', content } }], usage: { prompt_tokens: 100, completion_tokens: 20 } });
    });
  });
  return new Promise(r => srv.listen(0, '127.0.0.1', () => r({ srv, url: `http://127.0.0.1:${srv.address().port}/v1`, calls })));
}
module.exports = { start };
