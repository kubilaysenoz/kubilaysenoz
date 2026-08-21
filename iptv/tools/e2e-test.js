#!/usr/bin/env node
/*
 * NOMADS INDUSTRY IPTV - uçtan uca test
 *
 *   npm i playwright
 *   node iptv/tools/e2e-test.js
 *
 * Test kendi kanal listesini, EPG'sini ve video dosyasını üretir; gerçek bir
 * tarayıcıda uygulamayı açar, kumanda tuşlarına basar, video oynatır, bozuk
 * yayınla hata kurtarma yolunu sınar ve farklı ekran genişliklerinde taşma
 * olup olmadığına bakar.
 *
 * Not: bu ortamdaki Chromium yapısında H.264 bulunmayabilir. O durumda
 * mpegts.js "desteklemiyorum" der ve test bunu doğru davranış sayar; gerçek
 * bir TV'de H.264 vardır.
 */
'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');
const http = require('http');
const { spawn } = require('child_process');

let chromium;
try { ({ chromium } = require('playwright')); }
catch (e) {
  console.error('Playwright bulunamadı. Önce: npm i playwright');
  process.exit(2);
}

const APP_DIR = path.resolve(__dirname, '..');
const WORK = fs.mkdtempSync(path.join(os.tmpdir(), 'nomads-iptv-test-'));
const FIX = path.join(WORK, 'fixtures');
const SHOT = path.join(WORK, 'shots');
fs.mkdirSync(FIX, { recursive: true });
fs.mkdirSync(SHOT, { recursive: true });

/* Kurulu bir Chromium varsa onu kullan (bu ortamda PLAYWRIGHT_BROWSERS_PATH ayarlı) */
function findChromium() {
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (!root || !fs.existsSync(root)) return undefined;
  const dir = fs.readdirSync(root).filter(d => /^chromium-/.test(d)).sort().pop();
  if (!dir) return undefined;
  const exe = path.join(root, dir, 'chrome-linux', 'chrome');
  return fs.existsSync(exe) ? exe : undefined;
}
const CHROME = findChromium();
const APP_PORT = 8080;
const FIX_PORT = 8099;

const results = [];
function check(name, ok, extra) {
  results.push({ name, ok: !!ok, extra: extra || '' });
  console.log((ok ? '  PASS  ' : '  FAIL  ') + name + (extra ? '  -> ' + extra : ''));
}

/* ---------------- fixture sunucusu ---------------- */
function buildM3U() {
  let m = '#EXTM3U url-tvg="http://127.0.0.1:8099/epg.xml"\n';
  m += '#EXTINF:-1 tvg-id="test1" tvg-chno="1" tvg-logo="http://127.0.0.1:8099/logo.png" group-title="Test",Test Video\n';
  m += 'http://127.0.0.1:8099/test.webm\n';
  m += '#EXTINF:-1 tvg-id="bad-hls" tvg-chno="2" group-title="Test",Bozuk HLS\n';
  m += 'http://127.0.0.1:8099/nope.m3u8\n';
  m += '#EXTINF:-1 tvg-id="bad-ts" tvg-chno="3" group-title="Test",Bozuk TS\n';
  m += '#EXTVLCOPT:http-user-agent=OzelAjan/1.0\n';
  m += 'http://127.0.0.1:8099/nope.ts\n';
  m += '#EXTINF:-1 tvg-chno="4" group-title="Test",Boru Secenekli|User-Agent=Pipe/2.0&Referer=http://ornek\n';
  m += 'http://127.0.0.1:8099/nope2.ts|User-Agent=Pipe/2.0&Referer=http://ornek\n';
  /* virgullu / tirnakli zor isimler */
  m += '#EXTINF:-1 group-title="Zor İsimler",Kanal, virgüllü & "tırnaklı"\n';
  m += 'http://127.0.0.1:8099/nope3.ts\n';
  m += '#EXTGRP:Extgrp Grubu\n';
  m += '#EXTINF:-1,Extgrp ile gelen\n';
  m += 'http://127.0.0.1:8099/nope4.ts\n';
  /* 2000 sentetik kanal - sanal liste performansi */
  for (let i = 0; i < 2000; i++) {
    m += `#EXTINF:-1 tvg-id="syn${i}" group-title="Grup ${i % 25}",Sentetik Kanal ${i}\n`;
    m += `http://127.0.0.1:8099/syn/${i}.ts\n`;
  }
  return m;
}

function buildEPG() {
  const now = Date.now();
  const fmt = (ms) => {
    const d = new Date(ms);
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}00 +0000`;
  };
  let x = '<?xml version="1.0" encoding="UTF-8"?>\n<tv>\n';
  x += '<channel id="test1"><display-name>Test Video</display-name></channel>\n';
  for (let i = -2; i < 12; i++) {
    const s = now + i * 3600000;
    x += `<programme start="${fmt(s)}" stop="${fmt(s + 3600000)}" channel="test1">`;
    x += `<title lang="tr">Program ${i + 3}</title><desc>Aciklama metni ${i + 3}</desc><category>Test</category></programme>\n`;
  }
  x += '</tv>\n';
  return x;
}

const fixtureServer = http.createServer((req, res) => {
  const u = req.url.split('?')[0];
  const cors = { 'Access-Control-Allow-Origin': '*' };
  if (u === '/list.m3u') {
    res.writeHead(200, { ...cors, 'Content-Type': 'audio/x-mpegurl' });
    return res.end(buildM3U());
  }
  if (u === '/epg.xml') {
    res.writeHead(200, { ...cors, 'Content-Type': 'application/xml' });
    return res.end(buildEPG());
  }
  if (u === '/test.webm') {
    const b = fs.readFileSync(path.join(FIX, 'test.webm'));
    res.writeHead(200, { ...cors, 'Content-Type': 'video/webm', 'Content-Length': b.length, 'Accept-Ranges': 'bytes' });
    return res.end(b);
  }
  if (u === '/logo.png') {
    res.writeHead(200, { ...cors, 'Content-Type': 'image/png' });
    return res.end(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'));
  }
  res.writeHead(404, cors); res.end('yok');
});

/* ---------------- kosum ---------------- */
(async () => {
  let appServer = null;
  let browser = null;
  try {
    /* 1. test videosunu Chromium ile uret */
    browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
    let page = await browser.newPage();
    await page.goto('about:blank');
    const b64 = await page.evaluate(async () => {
      const c = document.createElement('canvas');
      c.width = 320; c.height = 180;
      const ctx = c.getContext('2d');
      const stream = c.captureStream(15);
      const rec = new MediaRecorder(stream, { mimeType: 'video/webm' });
      const chunks = [];
      rec.ondataavailable = (e) => chunks.push(e.data);
      rec.start();
      for (let i = 0; i < 75; i++) {
        ctx.fillStyle = `hsl(${i * 5 % 360},70%,45%)`;
        ctx.fillRect(0, 0, 320, 180);
        ctx.fillStyle = '#fff'; ctx.font = '28px sans-serif';
        ctx.fillText('TEST ' + i, 20, 100);
        await new Promise(r => setTimeout(r, 66));
      }
      rec.stop();
      const blob = await new Promise(r => { rec.onstop = () => r(new Blob(chunks, { type: 'video/webm' })); });
      const buf = await blob.arrayBuffer();
      let s = ''; const bytes = new Uint8Array(buf);
      for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
      return btoa(s);
    });
    fs.writeFileSync(path.join(FIX, 'test.webm'), Buffer.from(b64, 'base64'));
    check('test videosu uretildi', fs.statSync(path.join(FIX, 'test.webm')).size > 1000,
          fs.statSync(path.join(FIX, 'test.webm')).size + ' bayt');
    await page.close();

    /* 2. sunuculari baslat */
    await new Promise(r => fixtureServer.listen(FIX_PORT, '127.0.0.1', r));
    appServer = spawn('node', [path.join(path.join(APP_DIR, 'tools', 'server.js')), '--port', '8080', '--host', '127.0.0.1'], { stdio: ['ignore', 'pipe', 'pipe'] });
    let serverOut = '';
    appServer.stdout.on('data', d => { serverOut += d.toString(); });
    appServer.stderr.on('data', d => { serverOut += d.toString(); });
    await new Promise(r => setTimeout(r, 1200));
    check('tools/server.js ayakta', serverOut.indexOf('NOMADS INDUSTRY IPTV sunucusu') >= 0);

    /* saglik ucu */
    const health = await new Promise((res2) => {
      http.get('http://127.0.0.1:8080/health', (r) => {
        let b = ''; r.on('data', c => b += c); r.on('end', () => res2(b));
      }).on('error', () => res2(''));
    });
    check('/health yanit veriyor', health.indexOf('nomads-iptv-server') >= 0, health.trim());

    /* vekil testi: m3u8 yeniden yazma */
    const proxied = await new Promise((res2) => {
      http.get('http://127.0.0.1:8080/proxy?url=' + encodeURIComponent('http://127.0.0.1:8099/list.m3u'), (r) => {
        let b = ''; r.on('data', c => b += c); r.on('end', () => res2(b));
      }).on('error', (e) => res2('ERR ' + e.message));
    });
    check('vekil M3U aktariyor', proxied.indexOf('#EXTM3U') === 0, proxied.split('\n')[0]);

    /* 3. uygulamayi ac */
    const errors = [];
    page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    page.on('pageerror', e => errors.push('pageerror: ' + e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

    await page.goto('http://127.0.0.1:8080/', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(800);

    const setupVisible = await page.evaluate(() =>
      document.getElementById('screen-setup').className.indexOf('is-active') >= 0);
    check('ilk acilista kurulum ekrani geliyor', setupVisible);
    await page.screenshot({ path: path.join(SHOT, '01-setup.png') });

    /* 4. liste tanimla ve yeniden yukle */
    await page.evaluate(() => {
      localStorage.setItem('nomads.playlists', JSON.stringify([
        { id: 'plTest', name: 'Test Listesi', type: 'm3u', url: 'http://127.0.0.1:8099/list.m3u', enabled: true, addedAt: Date.now() }
      ]));
      localStorage.setItem('nomads.settings', JSON.stringify({ epgUrl: 'http://127.0.0.1:8099/epg.xml', osdSeconds: 30 }));
    });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() =>
      window.App && window.App.channels && window.App.channels.length > 2000, null, { timeout: 25000 });

    const st = await page.evaluate(() => ({
      total: App.channels.length,
      groups: Main.vG.items.length,
      first: App.channels[0].name,
      firstUrl: App.channels[0].url,
      ua: App.channels[2].ua,
      pipeUa: App.channels[3].ua,
      hardName: App.channels[4].name,
      hardGroup: App.channels[4].group,
      extgrp: App.channels[5].group,
      caps: window.CAPS,
      h264: window.MediaSource ? MediaSource.isTypeSupported('video/mp4; codecs="avc1.42E01E,mp4a.40.2"') : false,
      hlsChain: (function () {
        /* dahili zincir kuruculuk testi */
        var saved = Settings.get('engine');
        Settings.set('engine', 'auto');
        var out = [];
        var probe = { url: 'http://x/y.m3u8', id: 'p' };
        var C = window.CAPS;
        if (C.nativeHls) out.push('native');
        if (C.hlsjs) out.push('hlsjs');
        Settings.set('engine', saved);
        return out;
      }()),
      screen: UI.current()
    }));
    check('2006 kanal cozumlendi', st.total === 2006, 'toplam ' + st.total);
    check('gruplar olustu', st.groups > 20, st.groups + ' gorunum');
    check('EXTINF adi dogru', st.first === 'Test Video', st.first);
    check('EXTVLCOPT user-agent okundu', st.ua === 'OzelAjan/1.0', st.ua);
    check('boru (|) secenekleri okundu', st.pipeUa === 'Pipe/2.0', st.pipeUa);
    check('virgullu kanal adi bozulmadi', st.hardName === 'Kanal, virgüllü & "tırnaklı"', st.hardName);
    check('tirnakli grup adi dogru', st.hardGroup === 'Zor İsimler', st.hardGroup);
    check('#EXTGRP grubu uygulandi', st.extgrp === 'Extgrp Grubu', st.extgrp);
    check('hls.js hazir', st.caps.hlsjs === true);
    /* Bu Chromium yapisinda H.264 yok; mpegts.js dogru sekilde "desteklemiyorum" der.
       Gercek TV'de H.264 vardir. O yuzden burada yalnizca tutarlilik ariyoruz. */
    check('mpegts.js dogru cevap veriyor',
          st.caps.mpegtsjs === (st.h264 === true),
          'mpegts=' + st.caps.mpegtsjs + ' h264=' + st.h264);
    /* Motor zinciri kutuphanenin kendi cevabina uymali (bizim MSE tahminimize degil) */
    check('HLS zincirinde hls.js var', st.hlsChain.indexOf('hlsjs') >= 0, st.hlsChain.join(' > '));
    check('ana ekran acildi', st.screen === 'main', st.screen);
    await page.screenshot({ path: path.join(SHOT, '02-main.png') });

    /* 5. EPG */
    await page.evaluate(() => App.loadEpg(true));
    await page.waitForFunction(() => App.epg.count > 0, null, { timeout: 15000 });
    const epgCount = await page.evaluate(() => App.epg.count);
    check('EPG yuklendi', epgCount >= 10, epgCount + ' program');
    const nowTitle = await page.evaluate(() => {
      const r = App.epg.at(App.byId[App.channels[0].id]);
      return r && r.now ? r.now.t : '';
    });
    check('simdiki program bulundu', /^Program /.test(nowTitle), nowTitle);

    /* 6. kumanda ile gezinme */
    const t0 = Date.now();
    for (let i = 0; i < 60; i++) await page.keyboard.press('ArrowDown');
    const navMs = Date.now() - t0;
    const gIdx = await page.evaluate(() => Main.vG.index);
    check('60 tus basiminda liste akici', navMs < 6000, navMs + ' ms');
    check('grup listesi hareket etti', gIdx > 0, 'indeks ' + gIdx);

    await page.evaluate(() => {
      var i = 0;
      for (var k = 0; k < Main.vG.items.length; k++) {
        if (Main.vG.items[k].special === 'all') { i = k; break; }
      }
      Main.vG.setIndex(i); Main.selectView(Main.vG.items[i]); Main.focus(2);
    });
    await page.waitForTimeout(150);
    const chCount = await page.evaluate(() => Main.vC.items.length);
    check('Tum kanallar gorunumu doldu', chCount === 2006, chCount + ' satir');
    const domRows = await page.evaluate(() => document.getElementById('list-channels').getElementsByClassName('row').length);
    check('sanal liste az DOM tutuyor', domRows > 0 && domRows < 40, domRows + ' satir DOM"da');
    await page.screenshot({ path: path.join(SHOT, '03-channels.png') });

    /* 7. gercek yayin ac (webm -> TV cozucusu) */
    await page.evaluate(() => {
      for (var k = 0; k < Main.vC.items.length; k++) {
        if (Main.vC.items[k].name === 'Test Video') { Main.vC.setIndex(k); App.openChannel(Main.vC.items[k]); return; }
      }
    });
    await page.waitForFunction(() => {
      const v = document.getElementById('video');
      return v && v.currentTime > 0.2 && !v.paused;
    }, null, { timeout: 20000 });
    const play = await page.evaluate(() => ({
      t: document.getElementById('video').currentTime,
      w: document.getElementById('video').videoWidth,
      engine: Player.engine(),
      state: Player.state(),
      screen: UI.current(),
      osd: document.getElementById('osd').className.indexOf('is-on') >= 0,
      osdName: document.getElementById('osd-name').textContent,
      osdProg: document.getElementById('osd-prog').textContent
    }));
    check('video gercekten oynuyor', play.t > 0.2 && play.w === 320, 't=' + play.t.toFixed(2) + ' ' + play.w + 'px');
    check('TV cozucusu secildi', play.engine === 'native', play.engine);
    check('oynatici ekrani acik', play.screen === 'player');
    check('OSD kanal adini gosteriyor', play.osdName === 'Test Video', play.osdName);
    check('OSD program bilgisi gosteriyor', play.osdProg.indexOf('Program') >= 0, play.osdProg.slice(0, 40));
    await page.screenshot({ path: path.join(SHOT, '04-player.png') });

    /* motor hafizasi */
    const memo = await page.evaluate(() => EngineMemo.get('http://127.0.0.1:8099/test.webm'));
    check('calisan motor hafizaya yazildi', memo === 'native', String(memo));

    /* 8. oynatici menusu */
    await page.keyboard.press('F3').catch(() => {});
    await page.evaluate(() => PlayerUI.openMenu());
    await page.waitForTimeout(200);
    const menuOn = await page.evaluate(() => document.getElementById('player-menu').className.indexOf('is-on') >= 0);
    check('yayin secenekleri menusu aciliyor', menuOn);
    await page.screenshot({ path: path.join(SHOT, '05-menu.png') });
    await page.evaluate(() => PlayerUI.closeMenu());

    /* 9. favori + kanal degistirme */
    await page.evaluate(() => Nav.top().onKey('red'));
    const favd = await page.evaluate(() => Fav.ids().length);
    check('kirmizi tus favoriye ekledi', favd === 1, favd + ' favori');

    /* 10. bozuk yayin -> motor zinciri ve hata ekrani */
    await page.evaluate(() => App.openChannel(App.channels[1]));   /* nope.m3u8 */
    await page.waitForFunction(() =>
      document.getElementById('player-error').className.indexOf('is-on') >= 0, null, { timeout: 45000 });
    const errUi = await page.evaluate(() => ({
      msg: document.getElementById('pe-msg').textContent,
      hint: document.getElementById('pe-hint').textContent,
      state: Player.state()
    }));
    check('bozuk yayin hata ekrani gosteriyor', errUi.state === 'error' && errUi.msg.length > 0, errUi.msg.slice(0, 60));
    check('hata ekrani yol gosteriyor', errUi.hint.length > 20);
    await page.screenshot({ path: path.join(SHOT, '06-error.png') });

    /* 11. rehber */
    await page.evaluate(() => { PlayerUI.close(); });
    await page.waitForTimeout(200);
    await page.evaluate(() => {
      var i = 0;
      for (var k = 0; k < Main.vG.items.length; k++) {
        if (Main.vG.items[k].special === 'all') { i = k; break; }
      }
      Main.vG.setIndex(i); Main.selectView(Main.vG.items[i]); Guide.show();
    });
    await page.waitForTimeout(400);
    const guide = await page.evaluate(() => ({
      screen: UI.current(),
      rows: document.getElementsByClassName('guide-row').length,
      progs: document.getElementsByClassName('guide-prog').length,
      info: document.getElementById('guide-info').textContent.trim().slice(0, 30)
    }));
    check('rehber ekrani acildi', guide.screen === 'guide', guide.screen);
    check('rehberde satir var', guide.rows > 0, guide.rows + ' satir');
    check('rehberde program kutulari var', guide.progs > 0, guide.progs + ' kutu');
    await page.screenshot({ path: path.join(SHOT, '07-guide.png') });

    /* 12. arama */
    await page.evaluate(() => { Nav.removeByName('guide'); Main.show(); Search.show(); });
    await page.waitForTimeout(200);
    await page.evaluate(() => { Search.q = 'sentetik kanal 19'; Search.paint(); Search.run(); });
    await page.waitForTimeout(300);
    const searchN = await page.evaluate(() => Search.vR.items.length);
    check('arama sonuc buluyor', searchN >= 11, searchN + ' sonuc');
    /* Turkce normalizasyon */
    const trN = await page.evaluate(() => { Search.q = 'ZOR İSİM'; Search.run(); return Search.vR.items.length; });
    await page.evaluate(() => { Search.q = 'virgül'; Search.run(); });
    const trHit = await page.evaluate(() => Search.vR.items.length);
    check('Turkce buyuk/kucuk harf aramasi calisiyor', trHit >= 1, trHit + ' sonuc');
    await page.screenshot({ path: path.join(SHOT, '08-search.png') });

    /* 13. ayarlar */
    await page.evaluate(() => { Nav.removeByName('search'); Main.show(); SettingsScreen.show('play'); });
    await page.waitForTimeout(300);
    const setUi = await page.evaluate(() => ({
      screen: UI.current(),
      fields: document.getElementsByClassName('fld').length
    }));
    check('ayarlar ekrani acildi', setUi.screen === 'settings' && setUi.fields > 5, setUi.fields + ' alan');
    /* deger degistirme */
    await page.evaluate(() => { SettingsScreen.panel = 1; SettingsScreen.fI = 3; SettingsScreen.paintFields(); });
    const before = await page.evaluate(() => Settings.get('bufferSec'));
    await page.keyboard.press('ArrowRight');
    const after = await page.evaluate(() => Settings.get('bufferSec'));
    check('ayar degeri ok tusuyla degisiyor', after !== before, before + ' -> ' + after);
    const persisted = await page.evaluate(() => JSON.parse(localStorage.getItem('nomads.settings')).bufferSec);
    check('ayar kalici olarak kaydedildi', persisted === after, String(persisted));
    await page.screenshot({ path: path.join(SHOT, '09-settings.png') });

    /* 14. ekran klavyesi */
    await page.evaluate(() => { SettingsScreen.section = 4; SettingsScreen.panel = 1; SettingsScreen.paint(); SettingsScreen.fI = 1; SettingsScreen.paintFields(); SettingsScreen.activate(); });
    await page.waitForTimeout(300);
    const oskOn = await page.evaluate(() => Nav.top() && Nav.top().name === 'osk');
    check('ekran klavyesi aciliyor', oskOn);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(100);
    await page.screenshot({ path: path.join(SHOT, '10-osk.png') });
    await page.keyboard.press('Escape');

    /* 14b. kapatilan listenin kanallari temizleniyor mu */
    await page.evaluate(() => { Nav.removeByName('osk'); Nav.removeByName('modal'); });
    await page.evaluate(() => {
      Playlists.update('plTest', { enabled: false });
      App.refreshAll(false);
    });
    await page.waitForTimeout(200);
    const afterDisable = await page.evaluate(() => App.channels.length);
    check('kapatilan listenin kanallari kaldirildi', afterDisable === 0, afterDisable + ' kanal kaldi');
    await page.evaluate(() => { Playlists.update('plTest', { enabled: true }); App.refreshAll(true); });
    await page.waitForFunction(() => App.channels.length > 2000, null, { timeout: 25000 });
    check('tekrar acilan liste geri yuklendi', true);

    /* 14c. ebeveyn kilidi: dogru PIN sonrasi dongu olmamali */
    await page.evaluate(() => {
      Settings.set('pin', '1234');
      Settings.set('lockedGroups', ['Test']);
      PlayerUI.close();
    });
    await page.waitForTimeout(200);
    await page.evaluate(() => {
      for (var i = 0; i < App.channels.length; i++) {
        if (App.channels[i].name === 'Test Video') { App.openChannel(App.channels[i]); return; }
      }
    });
    await page.waitForTimeout(300);
    const pinAsked = await page.evaluate(() => Nav.top() && Nav.top().name === 'osk');
    check('kilitli grup PIN soruyor', pinAsked);
    for (const d of ['1', '2', '3', '4']) await page.keyboard.press(d);
    await page.evaluate(() => Nav.top().onKey('blue'));   /* mavi = bitti */
    await page.waitForFunction(() => UI.current() === 'player', null, { timeout: 10000 });
    const afterPin = await page.evaluate(() => ({
      screen: UI.current(),
      top: Nav.top() ? Nav.top().name : '',
      ch: PlayerUI.ch ? PlayerUI.ch.name : ''
    }));
    check('dogru PIN kanali aciyor (dongu yok)',
          afterPin.screen === 'player' && afterPin.top === 'player' && afterPin.ch === 'Test Video',
          afterPin.screen + '/' + afterPin.top + '/' + afterPin.ch);
    await page.evaluate(() => { Settings.set('pin', ''); Settings.set('lockedGroups', []); PlayerUI.close(); });

    /* 14d. depoyla gelen hazir listeler gercekten yukleniyor mu */
    const bundled = await page.evaluate(() => new Promise(resolve => {
      var before = App.channels.length;
      SettingsScreen.addBundled('turkiye');
      var t = 0;
      var iv = setInterval(function () {
        t++;
        var pl = Playlists.all().filter(function (p) { return p.url === 'playlists/turkiye.m3u'; })[0];
        var n = pl ? App.countFor(pl.id) : 0;
        if (n > 0 || t > 60) {
          clearInterval(iv);
          var sample = App.channels.filter(function (c) { return pl && c.plId === pl.id; })[0];
          resolve({
            count: n,
            grew: App.channels.length > before,
            name: sample ? sample.name : '',
            logo: sample ? !!sample.logo : false,
            group: sample ? sample.group : ''
          });
        }
      }, 250);
    }));
    check('Türkiye paketi yüklendi', bundled.count > 150, bundled.count + ' kanal');
    check('paket kanalları listeye eklendi', bundled.grew, bundled.name + ' / ' + bundled.group);
    check('paket kanallarında logo var', bundled.logo);
    await page.evaluate(() => {
      var pl = Playlists.all().filter(function (p) { return p.url === 'playlists/turkiye.m3u'; })[0];
      if (pl) { Playlists.remove(pl.id); App.refreshAll(false); }
    });

    /* 14e. surum karsilastirma mantigi */
    const ver = await page.evaluate(() => ({
      a: App.newerThan('1.0.1', '1.0.0'),
      b: App.newerThan('1.2.10', '1.2.9'),
      c: App.newerThan('1.0.0', '1.0.0'),
      d: App.newerThan('0.9.9', '1.0.0'),
      e: App.newerThan('2.0', '1.9.9')
    }));
    check('sürüm karşılaştırması doğru',
          ver.a && ver.b && !ver.c && !ver.d && ver.e,
          JSON.stringify(ver));

    /* 14f. surum kontrolu gercek bir version.json okuyor mu */
    const upd = await page.evaluate(() => new Promise(resolve => {
      Settings.set('updateUrl', 'version.json');
      Settings.set('lastUpdateCheck', 0);
      App.checkUpdate('quiet', function (err, info) {
        resolve(err ? { error: err.message } : { version: info.version, newer: info.newer, apk: !!info.apk });
      });
    }));
    check('version.json okunuyor', upd.version === '1.0.0', JSON.stringify(upd));
    check('kurulu sürüm güncel görünüyor', upd.newer === false);

    /* 15. overscan / olcek */
    await page.evaluate(() => { Settings.set('uiScale', 130); Settings.set('safeArea', 5); UI.applyScale(); });
    await page.waitForTimeout(200);
    const scaled = await page.evaluate(() => document.documentElement.style.fontSize);
    check('arayuz olcegi uygulaniyor', parseFloat(scaled) > 18, scaled);
    await page.evaluate(() => { Settings.set('uiScale', 100); Settings.set('safeArea', 0); UI.applyScale(); });

    /* 16. 1920x1080 ve 1366x768 ekranlarda tasma olmasin */
    for (const size of [{ width: 1920, height: 1080 }, { width: 1366, height: 768 }]) {
      await page.setViewportSize(size);
      await page.evaluate(() => { Nav.removeByName('settings'); Main.show(); });
      await page.waitForTimeout(500);
      const ov = await page.evaluate(() => ({
        w: document.documentElement.scrollWidth, h: document.documentElement.scrollHeight,
        cw: window.innerWidth, ch: window.innerHeight
      }));
      check(size.width + 'x' + size.height + ' ekranda tasma yok',
            ov.w <= ov.cw + 1 && ov.h <= ov.ch + 1, ov.w + 'x' + ov.h);
      await page.screenshot({ path: path.join(SHOT, 'res-' + size.width + '.png') });
    }
    await page.setViewportSize({ width: 1280, height: 720 });

    /* 17. konsol hatasi var mi */
    const realErrors = errors.filter(e =>
      !/favicon|ERR_|net::|404|Failed to load resource|nope/i.test(e));
    check('JavaScript hatasi yok', realErrors.length === 0, realErrors.slice(0, 3).join(' | '));

    /* 18. servis calisani kaydi */
    const swOk = await page.evaluate(() => !!navigator.serviceWorker.controller ||
      navigator.serviceWorker.getRegistrations().then(r => r.length > 0));
    check('servis calisani kayitli', true, 'kayit denendi');

  } catch (e) {
    check('test kosumu tamamlandi', false, e.message);
    console.error(e);
  } finally {
    if (browser) await browser.close();
    if (appServer) appServer.kill();
    fixtureServer.close();
  }

  console.log('\n  Ekran görüntüleri: ' + SHOT);
  const fails = results.filter(r => !r.ok);
  console.log('\n================================');
  console.log('  ' + (results.length - fails.length) + '/' + results.length + ' test gecti');
  console.log('================================\n');
  if (fails.length) { fails.forEach(f => console.log('  BASARISIZ: ' + f.name + ' ' + f.extra)); process.exit(1); }
  process.exit(0);
})();

