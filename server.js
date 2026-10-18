// ===== سرور کهکشان بازی (مرحله ۱: شطرنج آنلاین) =====
const express = require('express'), http = require('http'), path = require('path');
const { Server } = require('socket.io'), { Chess } = require('chess.js');
const bcrypt = require('bcryptjs'), Database = require('better-sqlite3');

const app = express(), srv = http.createServer(app), io = new Server(srv);
app.use(express.static(path.join(__dirname, 'public')));
app.use('/lib', express.static(path.join(__dirname, 'node_modules/three/build'))); // Three.js از خود سرور
app.get('/health', (q, r) => r.send('ok'));

// ---- دیتابیس SQLite ----
const db = new Database(process.env.DB_PATH || 'data.db');
db.exec(`CREATE TABLE IF NOT EXISTS players(name TEXT PRIMARY KEY,hash TEXT,avatar TEXT,elo INTEGER DEFAULT 1200,
 w INTEGER DEFAULT 0,l INTEGER DEFAULT 0,d INTEGER DEFAULT 0,day TEXT,dp INTEGER DEFAULT 0);
 CREATE TABLE IF NOT EXISTS reports(id INTEGER PRIMARY KEY,by TEXT,who TEXT,at TEXT)`);
const getP = n => db.prepare('SELECT * FROM players WHERE name=?').get(n);
const today = () => new Date().toISOString().slice(0, 10);
db.prepare("INSERT OR IGNORE INTO players(name,avatar,elo) VALUES('ربات','🤖',1000)").run();

// ---- امنیت: پاک‌سازی ورودی و فیلتر کلمات بد ----
const san = (s, n = 200) => String(s || '').replace(/[<>&"'`]/g, '').trim().slice(0, n);
const BAD = ['کثافت', 'احمق', 'لعنتی', 'fuck', 'shit']; // لیست را خودتان کامل کنید
const clean = t => BAD.reduce((a, w) => a.split(w).join('***'), t);
const EMO = ['👍', '😂', '😮', '😡', '🔥', '👏', '🤝'];

const rooms = new Map(), online = new Map();
const code = () => { let c; do { c = Array.from({ length: 5 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ'[Math.random() * 24 | 0]).join('') } while (rooms.has(c)); return c };
const pk = (r, n) => r.p.w && r.p.w.name === n ? 'w' : r.p.b && r.p.b.name === n ? 'b' : null;
const elo = (a, b, s) => Math.round(32 * (s - 1 / (1 + 10 ** ((b - a) / 400))));

// وضعیت عمومی اتاق که برای همه فرستاده می‌شود
function pub(r, fresh) {
  const c = r.chess, cl = { ...r.clock };
  if (r.status === 'play') cl[c.turn()] -= Date.now() - r.t0;
  const P = k => r.p[k] && { name: r.p[k].name, avatar: r.p[k].avatar, off: !!r.p[k].off, elo: (getP(r.p[k].name) || {}).elo };
  const h = c.history({ verbose: true }), l = h[h.length - 1];
  return { id: r.id, fen: c.fen(), turn: c.turn(), status: r.status, p: { w: P('w'), b: P('b') }, clock: cl, limit: r.limit / 60000,
    last: l && { from: l.from, to: l.to }, chk: c.isCheck(), mate: c.isCheckmate(), fresh: !!fresh, spec: r.spec.size };
}
const push = (r, f) => io.to(r.id).emit('state', pub(r, f));
function bl() { // لیست لابی
  const L = [...rooms.values()].filter(r => !r.priv);
  io.emit('lobby', { online: online.size,
    open: L.filter(r => r.status === 'wait').map(r => ({ id: r.id, host: r.p.w.name, min: r.limit / 60000 })),
    live: L.filter(r => r.status === 'play').map(r => ({ id: r.id, w: r.p.w.name, b: r.p.b.name })) });
}
function upd(n, dl, k) {
  const t = today();
  db.prepare(`UPDATE players SET elo=elo+?,${k}=${k}+1,dp=CASE WHEN day=? THEN dp+? ELSE ? END,day=? WHERE name=?`).run(dl, t, dl, dl, t, n);
}
// پایان بازی (فقط از سرور)
function finish(r, res, why) {
  if (r.status === 'end') return;
  r.status = 'end'; const d = { w: 0, b: 0 };
  const a = getP(r.p.w.name), b = getP(r.p.b.name);
  d.w = elo(a.elo, b.elo, res === 'w' ? 1 : res === 'b' ? 0 : .5); d.b = -d.w;
  upd(a.name, d.w, res === 'w' ? 'w' : res === 'b' ? 'l' : 'd');
  upd(b.name, d.b, res === 'b' ? 'w' : res === 'w' ? 'l' : 'd');
  io.to(r.id).emit('over', { res, why, d }); push(r); bl();
}
function mkRoom(s, limit, priv) {
  const r = { id: code(), priv: !!priv, limit: [3, 5, 10].includes(+limit) ? limit * 60000 : 300000, chess: new Chess(), status: 'wait',
    p: { w: { name: s.name, avatar: s.av, sid: s.id, off: 0 }, b: null }, spec: new Set(), clock: {}, t0: 0, ask: null };
  r.clock = { w: r.limit, b: r.limit }; rooms.set(r.id, r); enter(s, r); return r;
}
function enter(s, r) {
  leaveRoom(s, true);
  if (r.status === 'wait' && !r.p.b && r.p.w.name !== s.name) { r.p.b = { name: s.name, avatar: s.av, sid: s.id, off: 0 }; r.status = 'play'; r.t0 = Date.now(); clearTimeout(r.botT) }
  else if (!pk(r, s.name)) r.spec.add(s.name);
  s.rid = r.id; s.join(r.id); push(r); bl();
}
function leaveRoom(s, silent) {
  const r = rooms.get(s.rid); if (!r) return; s.leave(r.id); s.rid = null;
  const k = pk(r, s.name);
  if (k && r.status === 'play') { finish(r, k === 'w' ? 'b' : 'w', 'حریف از بازی خارج شد'); }
  else if (k && r.status === 'wait') { clearTimeout(r.botT); rooms.delete(r.id); }
  else r.spec.delete(s.name);
  if (r.status === 'end' && !io.sockets.adapter.rooms.get(r.id)) rooms.delete(r.id);
  bl();
}

// ---- ربات شطرنج ----
const VAL = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 0 };
const evalB = c => { let s = 0; for (const row of c.board()) for (const x of row) if (x) s += (x.color === 'w' ? 1 : -1) * VAL[x.type]; return s };
function search(c, d, al, be) { // جست‌وجوی ساده (نگاه چند حرکت جلوتر)
  if (!d) return (c.turn() === 'w' ? 1 : -1) * evalB(c);
  const ms = c.moves({ verbose: true }); if (!ms.length) return c.isCheckmate() ? -99999 - d : 0;
  ms.sort((a, b) => (b.captured ? 1 : 0) - (a.captured ? 1 : 0)); let best = -1e9;
  for (const m of ms) { c.move(m); const v = -search(c, d - 1, -be, -al); c.undo(); if (v > best) best = v; if (best > al) al = best; if (al >= be) break }
  return best;
}
function botPick(c) {
  const ms = c.moves({ verbose: true }); if (Math.random() < .25) return ms[Math.random() * ms.length | 0]; // گاهی اشتباه می‌کند
  let best = null, bv = -1e9; ms.sort(() => Math.random() - .5);
  for (const m of ms) { c.move(m); const v = -search(c, 1, -1e9, 1e9); c.undo(); if (v > bv) { bv = v; best = m } }
  return best;
}
function addBot(r) {
  if (r.status !== 'wait' || r.p.b) return;
  r.p.b = { name: 'ربات', avatar: '🤖', sid: null, off: 0, bot: true }; r.status = 'play'; r.t0 = Date.now();
  push(r); bl(); io.to(r.id).emit('msg', { sys: 1, t: '🤖 حریفی پیدا نشد؛ با ربات داری بازی می‌کنی' });
}
function botMove(r) {
  setTimeout(() => {
    if (r.status !== 'play') return; const c = r.chess, k = c.turn(); if (!r.p[k] || !r.p[k].bot) return;
    const m = botPick(c); if (!m) return; const now = Date.now(); r.clock[k] -= now - r.t0;
    c.move({ from: m.from, to: m.to, promotion: m.promotion || 'q' }); r.t0 = now; r.ask = null; after(r, k);
  }, 800 + Math.random() * 700);
}
// بعد از هر حرکت: ارسال وضعیت، بررسی پایان، نوبت ربات
function after(r, k) {
  const c = r.chess; push(r, true);
  if (c.isCheckmate()) finish(r, k, 'کیش و مات!');
  else if (c.isDraw()) finish(r, 'd', c.isStalemate() ? 'پات' : 'مساوی');
  else if (r.p[c.turn()].bot) botMove(r);
}
function undoFor(r, by) { // برگشت حرکت‌های درخواست‌دهنده
  const n = r.chess.turn() === pk(r, by) ? 2 : 1; if (r.chess.history().length < n) return;
  for (let i = 0; i < n; i++) r.chess.undo(); r.t0 = Date.now(); push(r);
}

io.on('connection', s => {
  s.name = null; s.lc = 0; s.hits = []; s.av = '🚀';
  // محدودیت سرعت: حداکثر ۲۰ پیام در ۵ ثانیه
  const on = (ev, fn) => s.on(ev, async (...a) => {
    const t = Date.now(); s.hits = s.hits.filter(x => t - x < 5000); if (s.hits.length > 20) return; s.hits.push(t);
    if (ev !== 'login' && !s.name) return;
    try { await fn(...a) } catch (e) { console.error(e.message) }
  });
  const room = () => rooms.get(s.rid);

  on('login', async d => {
    const name = san(d.name, 14), pass = String(d.pass || '').slice(0, 60), token = san(d.token, 40) || s.id;
    if (name.length < 2) return s.emit('err', 'نام باید حداقل ۲ حرف باشد');
    if (name === 'ربات') return s.emit('err', 'این نام رزرو است');
    let p = getP(name);
    if (p && p.hash && !(pass && await bcrypt.compare(pass, p.hash))) return s.emit('err', 'رمز این نام اشتباه است');
    const ex = online.get(name);
    if (ex && ex.token !== token && !(p && p.hash)) return s.emit('err', 'این نام همین الان آنلاین است');
    if (!p) db.prepare('INSERT INTO players(name,hash,avatar) VALUES(?,?,?)').run(name, pass ? await bcrypt.hash(pass, 8) : null, san(d.avatar, 4) || '🚀');
    else db.prepare('UPDATE players SET avatar=? WHERE name=?').run(san(d.avatar, 4) || p.avatar, name);
    p = getP(name); s.name = name; s.av = p.avatar;
    online.set(name, { sid: s.id, token });
    if (ex && ex.sid !== s.id) io.sockets.sockets.get(ex.sid)?.disconnect(true);
    s.emit('logged', { name, avatar: p.avatar, elo: p.elo, token });
    // اتصال مجدد: برگشت به بازی در جریان
    for (const r of rooms.values()) { const k = pk(r, name);
      if (k && r.status === 'play') { r.p[k].sid = s.id; r.p[k].off = 0; s.rid = r.id; s.join(r.id); push(r); io.to(r.id).emit('msg', { sys: 1, t: '✅ ' + name + ' برگشت' }) } }
    bl();
  });

  on('create', d => mkRoom(s, d.limit, d.priv));
  on('join', id => { const r = rooms.get(san(id, 5).toUpperCase()); if (!r) return s.emit('err', 'اتاقی با این کد پیدا نشد'); enter(s, r) });
  on('quick', m => { // بازی سریع: پیدا کردن حریف خودکار
    const lim = [3, 5, 10].includes(+m) ? m * 60000 : 300000;
    const r = [...rooms.values()].find(x => !x.priv && x.status === 'wait' && x.limit === lim && x.p.w.name !== s.name);
    if (r) enter(s, r); else { const nr = mkRoom(s, m, false); nr.botT = setTimeout(() => addBot(nr), 15000); } // اگر ۱۵ ثانیه حریف نیامد، ربات وارد می‌شود
  });
  on('leave', () => leaveRoom(s));

  on('legal', sq => { const r = room(); if (!r || r.status !== 'play') return; const k = r.chess.turn();
    if (!r.p[k] || r.p[k].name !== s.name) return;
    s.emit('legal', r.chess.moves({ square: san(sq, 2), verbose: true }).map(m => m.to)) });

  on('move', m => { // همه قوانین را chess.js در سرور بررسی می‌کند
    const r = room(); if (!r || r.status !== 'play') return;
    const c = r.chess, k = c.turn(); if (!r.p[k] || r.p[k].name !== s.name) return;
    const now = Date.now(); r.clock[k] -= now - r.t0;
    if (r.clock[k] <= 0) return finish(r, k === 'w' ? 'b' : 'w', 'زمان تمام شد ⏰');
    try { c.move({ from: san(m.from, 2), to: san(m.to, 2), promotion: ['q', 'r', 'b', 'n'].includes(m.promotion) ? m.promotion : 'q' }) }
    catch (e) { r.clock[k] += now - r.t0; return s.emit('err', 'حرکت غیرمجاز') }
    r.t0 = now; r.ask = null; after(r, k);
  });
  on('resign', () => { const r = room(), k = r && pk(r, s.name); if (k && r.status === 'play') finish(r, k === 'w' ? 'b' : 'w', 'تسلیم') });
  const ask = kind => { const r = room(), k = r && pk(r, s.name); if (!k || r.status !== 'play') return;
    const o = r.p[k === 'w' ? 'b' : 'w']; if (o.bot) return kind === 'draw' ? s.emit('msg', { sys: 1, t: 'ربات مساوی را قبول نکرد 🤖' }) : undoFor(r, s.name);
    r.ask = { kind, by: s.name }; io.to(r.p[k === 'w' ? 'b' : 'w'].sid).emit('ask', { kind, by: s.name }) };
  on('draw', () => ask('draw')); on('undo', () => ask('undo'));
  on('ans', ok => { const r = room(); if (!r || !r.ask || r.ask.by === s.name || r.status !== 'play') return;
    const a = r.ask; r.ask = null;
    if (!ok) return io.to(r.id).emit('msg', { sys: 1, t: 'درخواست رد شد' });
    if (a.kind === 'draw') return finish(r, 'd', 'مساوی با توافق');
    undoFor(r, a.by); });

  on('chat', t => { const r = room(); if (!r || Date.now() - s.lc < 800) return; s.lc = Date.now();
    io.to(r.id).emit('msg', { n: s.name, t: clean(san(t, 200)) }) });
  on('emo', e => { const r = room(); if (r && EMO.includes(e)) io.to(r.id).emit('msg', { n: s.name, t: e }) });
  on('report', n => { db.prepare('INSERT INTO reports(by,who,at) VALUES(?,?,?)').run(s.name, san(n, 14), new Date().toISOString()); s.emit('msg', { sys: 1, t: 'گزارش ثبت شد' }) });
  on('top', () => s.emit('top', {
    all: db.prepare('SELECT name,avatar,elo,w,l,d FROM players WHERE name!=? ORDER BY elo DESC LIMIT 10').all('ربات'),
    day: db.prepare('SELECT name,avatar,dp FROM players WHERE day=? AND name!=? ORDER BY dp DESC LIMIT 10').all(today(), 'ربات') }));
  on('profile', n => s.emit('profile', getP(san(n, 14))));

  s.on('disconnect', () => {
    const cur = online.get(s.name); if (!cur || cur.sid !== s.id) return; online.delete(s.name);
    const r = room(); if (r) { const k = pk(r, s.name);
      if (k && r.status === 'play') { r.p[k].off = Date.now(); io.to(r.id).emit('msg', { sys: 1, t: '⚠️ ' + s.name + ' قطع شد؛ ۶۰ ثانیه فرصت بازگشت دارد' }); push(r) }
      else if (k && r.status === 'wait') { clearTimeout(r.botT); rooms.delete(r.id); } else r.spec.delete(s.name) }
    bl();
  });
});

// ساعت شطرنج و مهلت اتصال مجدد (هر نیم ثانیه)
setInterval(() => {
  const now = Date.now();
  for (const r of rooms.values()) { if (r.status !== 'play') continue;
    const k = r.chess.turn();
    if (r.clock[k] - (now - r.t0) <= 0) { finish(r, k === 'w' ? 'b' : 'w', 'زمان تمام شد ⏰'); continue }
    for (const c of ['w', 'b']) if (r.p[c].off && now - r.p[c].off > 60000) finish(r, c === 'w' ? 'b' : 'w', 'حریف به بازی برنگشت') }
}, 500);

srv.listen(process.env.PORT || 3000, '0.0.0.0', () => console.log('Server running on port ' + (process.env.PORT || 3000)));
