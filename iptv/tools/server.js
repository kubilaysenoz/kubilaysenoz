#!/usr/bin/env node
/*
 * TakIR TV - yerel sunucu ve yayın vekili
 *
 *   node tools/server.js [--port 8080] [--host 0.0.0.0] [--token GIZLI]
 *
 * Iki isi birden yapar:
 *
 *  1) Uygulamayı http:// üzerinden yayınlar.
 *     Bu önemli: sayfa https:// ile acilirsa tarayıcı http:// yayınlarını
 *     "karışık içerik" diye engeller. Aynı ağ içinde http:// sunmak bu sorunu
 *     kökten çözer.
 *
 *  2) /proxy ucu ile yayınları aktarır:
 *       - CORS basliklarini ekler (hls.js / mpegts.js için şart)
 *       - User-Agent ve Referer basliklarini ayarlar (tarayıcı bunu yapamaz)
 *       - .m3u8 dosyalarinin içindeki adresleri de vekile yönlendirir,
 *         böylece segmentler de aynı yoldan gelir
 *       - Range isteklerini aktarır (ileri/geri sarma çalışır)
 *
 * Bu sunucu yalnızca kendi yerel ağında çalıştırılmak icindir. İnternete
 * açarsan herkes üzerinden trafik geçirebilir; o durumda --token kullan.
 */
'use strict';

var http = require('http');
var https = require('https');
var fs = require('fs');
var path = require('path');
var os = require('os');
var url = require('url');

/* ------------------------- parametreler ------------------------- */
var argv = process.argv.slice(2);
function arg(name, dflt) {
  var i = argv.indexOf('--' + name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt;
}
var PORT = parseInt(arg('port', process.env.PORT || '8080'), 10);
var HOST = arg('host', '0.0.0.0');
var TOKEN = arg('token', '');
var ROOT = path.resolve(__dirname, '..');

var MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.woff': 'font/woff', '.woff2': 'font/woff2',
  '.m3u': 'audio/x-mpegurl', '.m3u8': 'application/vnd.apple.mpegurl',
  '.xml': 'application/xml', '.txt': 'text/plain; charset=utf-8'
};

var DEFAULT_UA = 'Mozilla/5.0 (SmartTV; Linux) AppleWebKit/537.36 Chrome/120 Safari/537.36';

/* ------------------------- yardımcılar ------------------------- */
function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Range, Origin, Accept, Content-Type');
  res.setHeader('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Accept-Ranges');
  res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
}

function fail(res, code, msg) {
  cors(res);
  res.writeHead(code, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(msg + '\n');
}

function proxyLink(target, ua, ref) {
  var s = '/proxy?url=' + encodeURIComponent(target);
  if (ua) s += '&ua=' + encodeURIComponent(ua);
  if (ref) s += '&ref=' + encodeURIComponent(ref);
  if (TOKEN) s += '&token=' + encodeURIComponent(TOKEN);
  return s;
}

/* m3u8 içindeki tüm adresleri vekile yonlendir */
function rewriteM3U8(body, baseUrl, ua, ref) {
  var lines = body.split(/\r?\n/);
  var out = [], i, line, trimmed;

  function abs(u) {
    try { return new URL(u, baseUrl).href; } catch (e) { return u; }
  }

  for (i = 0; i < lines.length; i++) {
    line = lines[i];
    trimmed = line.trim();

    if (!trimmed) { out.push(line); continue; }

    if (trimmed.charAt(0) === '#') {
      /* #EXT-X-KEY / #EXT-X-MEDIA / #EXT-X-MAP içindeki URI="..." */
      if (trimmed.indexOf('URI="') >= 0) {
        line = line.replace(/URI="([^"]+)"/g, function (m, u) {
          return 'URI="' + proxyLink(abs(u), ua, ref) + '"';
        });
      }
      out.push(line);
      continue;
    }
    out.push(proxyLink(abs(trimmed), ua, ref));
  }
  return out.join('\n');
}

/* ------------------------- vekil ------------------------- */
function doProxy(req, res, q, depth, target) {
  depth = depth || 0;
  target = target || q.url;

  if (depth > 5) { fail(res, 508, 'Çok fazla yönlendirme'); return; }
  if (!/^https?:\/\//i.test(target)) { fail(res, 400, 'Yalnızca http/https adresleri'); return; }

  var parsed;
  try { parsed = new URL(target); } catch (e) { fail(res, 400, 'Geçersiz adres'); return; }

  var lib = parsed.protocol === 'https:' ? https : http;
  var headers = {
    'User-Agent': q.ua || DEFAULT_UA,
    'Accept': '*/*',
    'Connection': 'keep-alive'
  };
  if (q.ref) { headers['Referer'] = q.ref; headers['Origin'] = new URL(q.ref).origin; }
  if (req.headers.range) headers['Range'] = req.headers.range;

  var upstream = lib.request({
    protocol: parsed.protocol,
    hostname: parsed.hostname,
    port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
    path: parsed.pathname + parsed.search,
    method: req.method === 'HEAD' ? 'HEAD' : 'GET',
    headers: headers,
    /* self-signed sertifikali küçük sunucular için */
    rejectUnauthorized: false,
    timeout: 25000
  }, function (up) {
    /* yönlendirme */
    if (up.statusCode >= 300 && up.statusCode < 400 && up.headers.location) {
      up.resume();
      var next;
      try { next = new URL(up.headers.location, target).href; } catch (e) { next = up.headers.location; }
      doProxy(req, res, q, depth + 1, next);
      return;
    }

    var ctype = String(up.headers['content-type'] || '').toLowerCase();
    var isPlaylist = ctype.indexOf('mpegurl') >= 0 ||
                     /\.m3u8?($|\?)/i.test(parsed.pathname + parsed.search);

    cors(res);

    if (isPlaylist && req.method !== 'HEAD') {
      /* çalma listesini belleğe al, adresleri cevir */
      var chunks = [], size = 0;
      up.on('data', function (c) {
        size += c.length;
        if (size > 8 * 1024 * 1024) { up.destroy(); return; }   /* m3u8 bu kadar büyük olmaz */
        chunks.push(c);
      });
      up.on('end', function () {
        var body = Buffer.concat(chunks).toString('utf8');
        if (body.indexOf('#EXTM3U') < 0) {
          /* çalma listesi değilmiş, oldugu gibi gönder */
          res.writeHead(up.statusCode, { 'Content-Type': ctype || 'application/octet-stream' });
          res.end(Buffer.concat(chunks));
          return;
        }
        var outBody = rewriteM3U8(body, up.headers.location || target, q.ua, q.ref);
        res.writeHead(up.statusCode, {
          'Content-Type': 'application/vnd.apple.mpegurl',
          'Cache-Control': 'no-cache, no-store',
          'Content-Length': Buffer.byteLength(outBody)
        });
        res.end(outBody);
      });
      up.on('error', function (e) { if (!res.headersSent) fail(res, 502, 'Kaynak hatası: ' + e.message); });
      return;
    }

    /* medya / diğer: doğrudan akit */
    var pass = {};
    ['content-type', 'content-length', 'content-range', 'accept-ranges',
     'content-encoding', 'last-modified', 'etag'].forEach(function (h) {
      if (up.headers[h]) pass[h] = up.headers[h];
    });
    pass['Cache-Control'] = 'no-cache, no-store';
    res.writeHead(up.statusCode, pass);
    up.pipe(res);
    up.on('error', function () { try { res.end(); } catch (e) {} });
  });

  upstream.on('timeout', function () { upstream.destroy(new Error('zaman aşımı')); });
  upstream.on('error', function (e) {
    if (!res.headersSent) fail(res, 502, 'Bağlanılamadı: ' + e.message);
    else { try { res.end(); } catch (e2) {} }
  });
  req.on('close', function () { upstream.destroy(); });
  upstream.end();
}

/* ------------------------- statik dosyalar ------------------------- */
function serveStatic(req, res, pathname) {
  var rel = decodeURIComponent(pathname);
  if (rel === '/') rel = '/index.html';
  var file = path.join(ROOT, rel);

  /* dizin disina çıkılmasın */
  if (file.indexOf(ROOT) !== 0) { fail(res, 403, 'Yasak'); return; }

  fs.stat(file, function (err, st) {
    if (err || !st.isFile()) {
      if (!err && st.isDirectory()) { serveStatic(req, res, path.join(rel, 'index.html')); return; }
      fail(res, 404, 'Bulunamadı: ' + rel);
      return;
    }
    var ext = path.extname(file).toLowerCase();
    var head = {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Content-Length': st.size,
      'Cache-Control': 'no-cache'
    };
    cors(res);
    if (req.method === 'HEAD') { res.writeHead(200, head); res.end(); return; }
    res.writeHead(200, head);
    fs.createReadStream(file).pipe(res);
  });
}

/* ------------------------- sunucu ------------------------- */
var server = http.createServer(function (req, res) {
  if (req.method === 'OPTIONS') { cors(res); res.writeHead(204); res.end(); return; }

  var u = url.parse(req.url, true);

  if (u.pathname === '/proxy') {
    if (TOKEN && u.query.token !== TOKEN) { fail(res, 403, 'Geçersiz token'); return; }
    if (!u.query.url) { fail(res, 400, 'url parametresi gerekli'); return; }
    doProxy(req, res, { url: u.query.url, ua: u.query.ua, ref: u.query.ref });
    return;
  }

  if (u.pathname === '/health') {
    cors(res);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, app: 'takirtv-server', node: process.version }));
    return;
  }

  serveStatic(req, res, u.pathname);
});

server.on('clientError', function (err, socket) {
  try { socket.end('HTTP/1.1 400 Bad Request\r\n\r\n'); } catch (e) {}
});

server.listen(PORT, HOST, function () {
  var nets = os.networkInterfaces();
  var addrs = [];
  Object.keys(nets).forEach(function (name) {
    (nets[name] || []).forEach(function (n) {
      if (n.family === 'IPv4' && !n.internal) addrs.push(n.address);
    });
  });

  console.log('');
  console.log('  TakIR TV sunucusu çalışıyor');
  console.log('  ---------------------------');
  console.log('  Klasör : ' + ROOT);
  console.log('  Yerel  : http://localhost:' + PORT + '/');
  addrs.forEach(function (a) {
    console.log('  TV için: http://' + a + ':' + PORT + '/');
  });
  console.log('');
  console.log('  Vekil adresi (Ayarlar > Ağ > Vekil adresi):');
  addrs.forEach(function (a) {
    console.log('    http://' + a + ':' + PORT + '/proxy?url=' + (TOKEN ? '  (token: ' + TOKEN + ')' : ''));
  });
  if (!addrs.length) console.log('    http://localhost:' + PORT + '/proxy?url=');
  console.log('');
  console.log('  Durdurmak için Ctrl+C');
  console.log('');
});
