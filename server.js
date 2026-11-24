'use strict';
/*
  Memleket Savaşı - sunucu programı
  1) Oyunu http://localhost:PORT adresinden yayınlar (OBS buraya bakacak)
  2) TikTok canlı yayınındaki yorum / hediye / beğenileri oyuna iletir
  3) Birincilikleri (şeref salonu) stats.json dosyasına kaydeder
*/
const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const DIR = __dirname;
const CONFIG_FILE = path.join(DIR, 'config.json');
const STATS_FILE = path.join(DIR, 'stats.json');
const LOG_FILE = path.join(DIR, 'log.txt');

function log(...a) {
  const line = '[' + new Date().toLocaleString('tr-TR') + '] ' + a.join(' ');
  console.log(line);
  try { fs.appendFileSync(LOG_FILE, line + '\n'); } catch (e) {}
  try { if (fs.statSync(LOG_FILE).size > 2e6) fs.renameSync(LOG_FILE, LOG_FILE + '.eski'); } catch (e) {}
}

/* ---------- AYARLAR ---------- */
function readConfig() {
  let c = {};
  try { c = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8').replace(/^﻿/, '')); } catch (e) { log('config.json okunamadı:', e.message); }
  return {
    tiktokKullanici: String(c.tiktokKullanici || '').replace(/^@/, '').trim(),
    port: parseInt(c.port, 10) || 8080,
    turSuresiSaniye: parseInt(c.turSuresiSaniye, 10) || 120,
    salonAralikSaniye: c.salonAralikSaniye === 0 ? 0 : (parseInt(c.salonAralikSaniye, 10) || 75),
    signApiKey: c.signApiKey ? String(c.signApiKey) : ''
  };
}
let cfg = readConfig();

/* ---------- KALICI KAYIT (şeref salonu) ---------- */
let stats = { rounds: 0, players: {}, provs: {} };
try {
  const o = JSON.parse(fs.readFileSync(STATS_FILE, 'utf8'));
  if (o && o.players) stats = o;
} catch (e) { /* ilk çalışma */ }
function saveStats() {
  try {
    fs.writeFileSync(STATS_FILE + '.tmp', JSON.stringify(stats));
    fs.renameSync(STATS_FILE + '.tmp', STATS_FILE);
  } catch (e) { log('stats kaydedilemedi:', e.message); }
}
setInterval(() => {
  try { fs.copyFileSync(STATS_FILE, STATS_FILE + '.yedek'); } catch (e) {}
}, 60 * 60 * 1000);

function recordRound(m) {
  stats.rounds++;
  const pl = String(parseInt(m.winnerPlate, 10) || 0);
  if (pl !== '0') stats.provs[pl] = (stats.provs[pl] || 0) + 1;
  (Array.isArray(m.players) ? m.players : []).forEach(a => {
    const name = String(a[0] || '').slice(0, 40), pts = Math.round(+a[1] || 0);
    if (!name || pts < 20) return;
    if (!stats.players[name]) stats.players[name] = [0, 0];
    stats.players[name][1] += pts;
  });
  const top = Array.isArray(m.top) && m.top[0] ? String(m.top[0][0] || '').slice(0, 40) : '';
  if (top) {
    if (!stats.players[top]) stats.players[top] = [0, 0];
    stats.players[top][0]++;
  }
  saveStats();
  log('Tur bitti. Kazanan il plakası:', pl, '| Tur birincisi:', top || '-', '| Toplam tur:', stats.rounds);
}

/* ---------- WEB SUNUCU + OYUN ---------- */
const PUBLIC = path.join(DIR, 'public');
const server = http.createServer((req, res) => {
  const url = (req.url || '/').split('?')[0];
  if (url === '/durum') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ tiktok: tiktokState, izleyiciSayisi: wss.clients.size, tur: stats.rounds }));
    return;
  }
  const file = path.join(PUBLIC, url === '/' ? 'index.html' : url.replace(/\.\./g, ''));
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end('Bulunamadi'); return; }
    const ext = path.extname(file).toLowerCase();
    const type = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.png': 'image/png', '.json': 'application/json' }[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' });
    res.end(data);
  });
});
const wss = new WebSocketServer({ server });

function send(ws, o) { try { if (ws.readyState === 1) ws.send(JSON.stringify(o)); } catch (e) {} }
function broadcast(o) { wss.clients.forEach(c => send(c, o)); }
function cfgMsg() { return { type: 'config', roundSeconds: cfg.turSuresiSaniye, hallEverySeconds: cfg.salonAralikSaniye }; }

wss.on('connection', ws => {
  send(ws, cfgMsg());
  send(ws, { type: 'stats', data: stats });
  ws.on('message', raw => {
    let m; try { m = JSON.parse(raw); } catch (e) { return; }
    if (m.type === 'hello') { send(ws, cfgMsg()); send(ws, { type: 'stats', data: stats }); }
    else if (m.type === 'roundEnd') { recordRound(m); broadcast({ type: 'stats', data: stats }); }
    else if (m.type === 'chat' || m.type === 'like' || m.type === 'gift') { broadcast(m); } // deneme için (sunucu yalnız bu bilgisayardan erişilir)
  });
});

// config.json değişirse oyuna hemen haber ver
let lastCfgJson = JSON.stringify(cfg);
fs.watchFile(CONFIG_FILE, { interval: 2000 }, () => {
  const n = readConfig();
  const j = JSON.stringify(n);
  if (j === lastCfgJson) return;
  const userChanged = n.tiktokKullanici !== cfg.tiktokKullanici;
  cfg = n; lastCfgJson = j;
  log('Ayarlar güncellendi. Tur süresi:', cfg.turSuresiSaniye, 'sn');
  broadcast(cfgMsg());
  if (userChanged) { log('TikTok kullanıcı adı değişti, yeniden bağlanılıyor.'); restartTikTok(); }
});

/* ---------- TİKTOK BAĞLANTISI ---------- */
let tiktokState = 'başlamadı';
let conn = null, retryTimer = null, firstGiftLogged = false, stopped = false;

function userName(u) {
  if (!u) return 'Biri';
  return String(u.nickname || u.uniqueId || 'Biri').slice(0, 24);
}
function giftCoins(d) {
  const g = d.giftDetails || {};
  const v = g.diamondCount ?? d.diamondCount ?? g.diamond_count ?? d.diamond_count ?? 1;
  const n = Number(v);
  return n > 0 ? n : 1;
}

function restartTikTok() {
  clearTimeout(retryTimer);
  if (conn) { try { conn.disconnect(); } catch (e) {} conn = null; }
  connectTikTok();
}

async function connectTikTok() {
  if (!cfg.tiktokKullanici) { tiktokState = 'kullanıcı adı yok'; log('config.json içinde tiktokKullanici boş. Oyun deneme modunda çalışıyor.'); return; }
  let lib;
  try { lib = require('tiktok-live-connector'); } catch (e) { log('tiktok-live-connector yüklenemedi:', e.message); return; }
  const { TikTokLiveConnection, WebcastEvent, ControlEvent } = lib;
  const opts = {};
  if (cfg.signApiKey) opts.signApiKey = cfg.signApiKey;
  conn = new TikTokLiveConnection(cfg.tiktokKullanici, opts);
  const mine = conn;
  const retry = (sn) => {
    if (conn !== mine) return;
    tiktokState = 'bekliyor';
    clearTimeout(retryTimer);
    retryTimer = setTimeout(() => { if (conn === mine) { conn = null; connectTikTok(); } }, sn * 1000);
  };

  mine.on(WebcastEvent.CHAT, d => {
    const text = d.comment || '';
    if (!text) return;
    broadcast({ type: 'chat', user: userName(d.user), text: text });
  });
  mine.on(WebcastEvent.LIKE, d => {
    broadcast({ type: 'like', user: userName(d.user), count: Math.max(1, Math.min(parseInt(d.likeCount, 10) || 1, 15)) });
  });
  mine.on(WebcastEvent.GIFT, d => {
    const type = d.giftDetails ? d.giftDetails.giftType : d.giftType;
    if (type === 1 && !d.repeatEnd) return; // seri devam ediyor, bitince sayacağız
    const gd = d.giftDetails || {};
    if (!firstGiftLogged) { // ilk hediyede alan adlarını kaydet (kontrol için)
      firstGiftLogged = true;
      try { log('İlk hediye alanları:', JSON.stringify({ giftName: gd.giftName || d.giftName, coins: giftCoins(d), repeatCount: d.repeatCount, keys: Object.keys(gd).slice(0, 25) })); } catch (e) {}
    }
    broadcast({
      type: 'gift', user: userName(d.user),
      giftName: String(gd.giftName || d.giftName || 'Hediye'),
      coins: giftCoins(d), count: Math.max(1, parseInt(d.repeatCount, 10) || 1)
    });
  });
  mine.on(ControlEvent.DISCONNECTED, () => { log('TikTok bağlantısı koptu, tekrar denenecek.'); retry(10); });
  mine.on(WebcastEvent.STREAM_END, () => { log('Canlı yayın bitti.'); });
  mine.on(ControlEvent.ERROR, e => { log('TikTok hatası:', e && (e.message || e.info || e)); });

  tiktokState = 'bağlanıyor';
  try {
    const st = await mine.connect();
    tiktokState = 'bağlandı';
    log('TikTok canlı yayınına bağlandı: @' + cfg.tiktokKullanici, '| oda:', st && st.roomId);
  } catch (e) {
    const msg = String((e && (e.message || e.info)) || e);
    log('TikTok bağlanamadı (' + msg.slice(0, 120) + '). 20 sn sonra tekrar denenecek. (Canlı yayın açık mı?)');
    retry(20);
  }
}

/* ---------- BAŞLAT ---------- */
server.on('error', e => { log('Sunucu hatası:', e.message, '(port zaten kullanımda olabilir)'); process.exit(1); });
server.listen(cfg.port, '127.0.0.1', () => {
  log('Memleket Savaşı sunucusu açıldı: http://localhost:' + cfg.port);
  log('OBS için adres: http://localhost:' + cfg.port + '/?yayin=1&ws=ws://localhost:' + cfg.port);
  connectTikTok();
});
process.on('uncaughtException', e => log('Beklenmeyen hata:', e && e.stack || e));
process.on('unhandledRejection', e => log('Beklenmeyen söz hatası:', e && e.stack || e));
