#!/usr/bin/env node
/*
 * Vekil sözleşme testi.
 *
 *   node iptv/tools/proxy-test.js --proxy http://127.0.0.1:8080 [--static]
 *
 * Aynı test hem tools/server.js (Node) hem de android/.../LocalServer.java
 * (APK'nın içindeki Java sunucusu) için koşar. İkisi de aynı sözleşmeyi
 * uygulamak zorunda: CORS, özel başlıklar, .m3u8 yeniden yazma, Range,
 * yönlendirme. Cihaza kurmadan bu davranışı doğrulamanın tek yolu bu.
 *
 * Gerçek bir canlı yayına bağlanmaz; sahte bir üst sunucu ayağa kaldırıp
 * vekilin onu nasıl aktardığına bakar.
 */
'use strict';

const http = require('http');

function arg(name, dflt) {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : dflt;
}
const PROXY = (arg('proxy', 'http://127.0.0.1:8080') || '').replace(/\/+$/, '');
const WANT_STATIC = process.argv.indexOf('--static') >= 0;
const LABEL = arg('label', PROXY);

const results = [];
function check(name, ok, extra) {
  results.push({ name, ok: !!ok, extra: extra || '' });
  console.log((ok ? '  PASS  ' : '  FAIL  ') + name + (extra ? '  -> ' + extra : ''));
}

/* ---------------- sahte üst sunucu ---------------- */
let UP = '';
const SEG = Buffer.alloc(4096, 0x47);   /* MPEG-TS senkron baytı, içerik önemli değil */

const upstream = http.createServer((req, res) => {
  const u = req.url.split('?')[0];

  if (u === '/master.m3u8') {
    res.writeHead(200, { 'Content-Type': 'application/vnd.apple.mpegurl' });
    return res.end(
      '#EXTM3U\n' +
      '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="a",NAME="tr",URI="audio/tr.m3u8"\n' +
      '#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=640x360\n' +
      'v1/index.m3u8\n' +
      '#EXT-X-STREAM-INF:BANDWIDTH=2000000,RESOLUTION=1280x720\n' +
      UP + '/v2/index.m3u8\n'
    );
  }
  if (u === '/v1/index.m3u8') {
    res.writeHead(200, { 'Content-Type': 'application/vnd.apple.mpegurl' });
    return res.end(
      '#EXTM3U\n#EXT-X-TARGETDURATION:4\n' +
      '#EXT-X-KEY:METHOD=AES-128,URI="key.bin",IV=0x0\n' +
      '#EXT-X-MAP:URI="init.mp4"\n' +
      '#EXTINF:4.0,\nseg1.ts\n' +
      '#EXTINF:4.0,\n../shared/seg2.ts\n'
    );
  }
  if (u === '/v1/seg1.ts') {
    res.writeHead(200, { 'Content-Type': 'video/mp2t', 'Content-Length': SEG.length });
    return res.end(SEG);
  }
  if (u === '/redir') {
    res.writeHead(302, { Location: '/master.m3u8' });
    return res.end();
  }
  if (u === '/agent') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ua: req.headers['user-agent'] || '', ref: req.headers['referer'] || '' }));
  }
  if (u === '/range') {
    const body = Buffer.alloc(1000, 0x41);
    if (req.headers.range) {
      const m = /bytes=(\d+)-(\d*)/.exec(req.headers.range);
      const s = +m[1], e = m[2] ? +m[2] : body.length - 1;
      const part = body.slice(s, e + 1);
      res.writeHead(206, {
        'Content-Type': 'application/octet-stream',
        'Content-Range': `bytes ${s}-${e}/${body.length}`,
        'Content-Length': part.length,
        'Accept-Ranges': 'bytes'
      });
      return res.end(part);
    }
    res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': body.length });
    return res.end(body);
  }
  if (u === '/plain.txt') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    return res.end('duz-metin');
  }
  res.writeHead(404); res.end('yok');
});

/* ---------------- istemci ---------------- */
function get(url, headers) {
  return new Promise((resolve) => {
    const req = http.get(url, { headers: headers || {}, timeout: 15000 }, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({
        status: res.statusCode,
        headers: res.headers,
        body: Buffer.concat(chunks)
      }));
    });
    req.on('timeout', () => { req.destroy(); resolve({ status: 0, headers: {}, body: Buffer.alloc(0), err: 'zaman aşımı' }); });
    req.on('error', (e) => resolve({ status: 0, headers: {}, body: Buffer.alloc(0), err: e.message }));
  });
}

const px = (target, extra) =>
  PROXY + '/proxy?url=' + encodeURIComponent(target) + (extra || '');

/* ---------------- koşum ---------------- */
(async () => {
  await new Promise(r => upstream.listen(0, '127.0.0.1', r));
  UP = 'http://127.0.0.1:' + upstream.address().port;
  console.log('\n=== vekil sözleşme testi: ' + LABEL + ' ===');
  console.log('    üst sunucu: ' + UP + '\n');

  try {
    /* 1. uygulama dosyası (yalnızca uygulamayı da sunan vekiller) */
    if (WANT_STATIC) {
      const r = await get(PROXY + '/index.html');
      check('uygulama dosyası sunuluyor',
            r.status === 200 && r.body.toString().indexOf('<title>') >= 0,
            'HTTP ' + r.status + ', ' + r.body.length + ' bayt');

      /* Nokta-nokta kodlanmış gönderiliyor; düz haliyle istemci adresi
         kendisi normalize edip sunucuya hiç sormuyor. */
      const t = await get(PROXY + '/%2e%2e/%2e%2e/etc/passwd');
      check('dizin dışına çıkılamıyor',
            t.status === 403 || t.status === 404,
            'HTTP ' + t.status + (t.err ? ' (' + t.err + ')' : ''));
    }

    /* 2. düz dosya aktarımı */
    const plain = await get(px(UP + '/plain.txt'));
    check('düz dosya aktarılıyor',
          plain.status === 200 && plain.body.toString() === 'duz-metin',
          'HTTP ' + plain.status + ' "' + plain.body.toString().slice(0, 20) + '"');

    /* 3. CORS başlığı */
    check('CORS başlığı ekleniyor',
          plain.headers['access-control-allow-origin'] === '*',
          String(plain.headers['access-control-allow-origin']));

    /* 4. master playlist yeniden yazılıyor */
    const master = await get(px(UP + '/master.m3u8'));
    const mText = master.body.toString();
    const lines = mText.split('\n').filter(l => l.trim() && !l.startsWith('#'));
    check('master playlist geldi', master.status === 200 && mText.indexOf('#EXTM3U') === 0, 'HTTP ' + master.status);
    check('varyant adresleri vekile yönlendirildi',
          lines.length === 2 && lines.every(l => l.trim().indexOf('/proxy?url=') === 0),
          lines.map(l => l.trim().slice(0, 34)).join(' | '));
    check('göreli varyant mutlak adrese çevrildi',
          lines[0] && decodeURIComponent(lines[0]).indexOf(UP + '/v1/index.m3u8') > 0,
          decodeURIComponent(String(lines[0])).slice(0, 70));
    check('EXT-X-MEDIA içindeki URI yeniden yazıldı',
          /URI="\/proxy\?url=/.test(mText),
          (/URI="[^"]{0,40}/.exec(mText) || [''])[0]);

    /* 5. media playlist: KEY, MAP ve segmentler */
    const media = await get(px(UP + '/v1/index.m3u8'));
    const dText = media.body.toString();
    check('media playlist geldi', media.status === 200 && dText.indexOf('#EXTM3U') === 0,
          'HTTP ' + media.status + (media.err ? ' (' + media.err + ')' : ''));
    const segLines = dText.split('\n').filter(l => l.trim() && !l.startsWith('#'));
    check('EXT-X-KEY URI yeniden yazıldı',
          /#EXT-X-KEY:[^\n]*URI="\/proxy\?url=/.test(dText),
          (/#EXT-X-KEY:[^\n]{0,60}/.exec(dText) || [''])[0]);
    check('EXT-X-MAP URI yeniden yazıldı',
          /#EXT-X-MAP:URI="\/proxy\?url=/.test(dText));
    check('segment adresleri yeniden yazıldı',
          segLines.length === 2 && segLines.every(l => l.trim().indexOf('/proxy?url=') === 0),
          segLines.length + ' segment');
    check('üst dizine çıkan segment (../) doğru çözüldü',
          segLines[1] && decodeURIComponent(segLines[1]).indexOf(UP + '/shared/seg2.ts') > 0,
          decodeURIComponent(String(segLines[1])).slice(0, 70));

    /* 6. yeniden yazılan segment adresi gerçekten çalışıyor mu */
    if (segLines[0]) {
      const segUrl = PROXY + segLines[0].trim();
      const seg = await get(segUrl);
      check('yeniden yazılan segment indirilebiliyor',
            seg.status === 200 && seg.body.length === SEG.length,
            'HTTP ' + seg.status + ', ' + seg.body.length + ' bayt');
    } else {
      check('yeniden yazılan segment indirilebiliyor', false, 'segment satırı yok');
    }

    /* 7. özel User-Agent / Referer */
    const ag = await get(px(UP + '/agent', '&ua=' + encodeURIComponent('NomadsTest/9.9') +
                                           '&ref=' + encodeURIComponent('http://ornek.test/sayfa')));
    let agj = {};
    try { agj = JSON.parse(ag.body.toString()); } catch (e) {}
    check('özel User-Agent iletiliyor', agj.ua === 'NomadsTest/9.9', String(agj.ua));
    check('özel Referer iletiliyor', agj.ref === 'http://ornek.test/sayfa', String(agj.ref));

    /* 8. varsayılan User-Agent (tarayıcının gönderemediği) */
    const ag2 = await get(px(UP + '/agent'));
    let agj2 = {};
    try { agj2 = JSON.parse(ag2.body.toString()); } catch (e) {}
    check('User-Agent verilmezse varsayılan kullanılıyor',
          typeof agj2.ua === 'string' && agj2.ua.length > 10,
          String(agj2.ua).slice(0, 40));

    /* 9. yönlendirme izleniyor */
    const rd = await get(px(UP + '/redir'));
    check('yönlendirme izleniyor',
          rd.status === 200 && rd.body.toString().indexOf('#EXTM3U') === 0,
          'HTTP ' + rd.status);

    /* 10. Range aktarılıyor (ileri/geri sarma) */
    const rg = await get(px(UP + '/range'), { Range: 'bytes=10-19' });
    check('Range isteği aktarılıyor',
          rg.status === 206 && rg.body.length === 10,
          'HTTP ' + rg.status + ', ' + rg.body.length + ' bayt, ' +
          'Content-Range: ' + rg.headers['content-range']);

    /* 11. http/https dışı adres reddediliyor */
    const bad = await get(PROXY + '/proxy?url=' + encodeURIComponent('file:///etc/passwd'));
    check('http/https dışı adres reddediliyor', bad.status === 400, 'HTTP ' + bad.status);

    /* 12. url parametresi yoksa hata */
    const noUrl = await get(PROXY + '/proxy');
    check('url parametresi zorunlu', noUrl.status === 400, 'HTTP ' + noUrl.status);

  } catch (e) {
    check('test koşumu tamamlandı', false, e.message);
    console.error(e);
  } finally {
    upstream.close();
  }

  const fails = results.filter(r => !r.ok);
  console.log('\n  ' + (results.length - fails.length) + '/' + results.length + ' geçti — ' + LABEL + '\n');
  process.exit(fails.length ? 1 : 0);
})();
