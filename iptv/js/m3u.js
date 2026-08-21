/* m3u.js - M3U / M3U8 kanal listesi çözümleyici.
   Desteklenen satırlar:
     #EXTM3U url-tvg="..."          -> liste içindeki EPG adresi
     #EXTINF:-1 tvg-id="" tvg-name="" tvg-logo="" tvg-chno="" group-title="",Ad
     #EXTGRP:Grup                    -> grup (group-title yoksa)
     #EXTVLCOPT:http-user-agent=..   -> özel User-Agent (vekil sunucu gerektirir)
     #EXTVLCOPT:http-referrer=..     -> özel Referer  (vekil sunucu gerektirir)
     #KODIPROP:...                   -> not olarak saklanır (DRM tespiti için)
     url|User-Agent=..&Referer=..    -> boru isaretli ek secenekler        */
(function (w) {
  'use strict';

  var ATTR = /([A-Za-z0-9_-]+)\s*=\s*"([^"]*)"/g;

  function attrs(s) {
    var out = {}, m;
    ATTR.lastIndex = 0;
    while ((m = ATTR.exec(s)) !== null) { out[m[1].toLowerCase()] = m[2]; }
    return out;
  }

  function splitPipe(url) {
    var res = { url: url, ua: '', referer: '' };
    var bar = url.indexOf('|');
    if (bar < 0) return res;
    res.url = url.substring(0, bar);
    var opts = url.substring(bar + 1).split('&');
    for (var i = 0; i < opts.length; i++) {
      var eq = opts[i].indexOf('=');
      if (eq < 0) continue;
      var k = opts[i].substring(0, eq).toLowerCase();
      var v = opts[i].substring(eq + 1);
      if (k === 'user-agent') res.ua = v;
      else if (k === 'referer' || k === 'referrer') res.referer = v;
    }
    return res;
  }

  function slug(s) {
    return norm(s).replace(/[^a-z0-9]+/g, '');
  }

  /* parse(text, playlist) -> { channels:[], epgUrl:'', warnings:[] } */
  function parse(txt, pl) {
    var out = [], warnings = [], epgUrl = '';
    if (!txt) return { channels: out, epgUrl: epgUrl, warnings: ['Liste boş geldi.'] };

    /* BOM ve satır sonu normalizasyonu */
    if (txt.charCodeAt(0) === 0xFEFF) txt = txt.substring(1);
    var lines = txt.split(/\r\n|\n|\r/);
    var plId = (pl && pl.id) || 'pl';
    var defUa = (pl && pl.ua) || '';
    var defRef = (pl && pl.referer) || '';

    var pending = null;
    var extgrp = '';
    var seen = {};
    var i, line, low, m, a, vlc, eq, key, val, u, id, base, n;

    if (lines.length && lines[0].indexOf('#EXTM3U') === 0) {
      a = attrs(lines[0]);
      epgUrl = a['url-tvg'] || a['x-tvg-url'] || a['tvg-url'] || '';
      if (epgUrl.indexOf(',') > 0) epgUrl = epgUrl.split(',')[0];
    } else if (txt.indexOf('#EXTINF') < 0) {
      /* Bazı sağlayıcılar düz metin dondurur; en sik neden hatalı kullanıcı/şifre */
      warnings.push('Bu içerik M3U listesi gibi görünmüyor. Adres, kullanıcı adı ' +
                    've şifreyi kontrol et.');
    }

    for (i = 0; i < lines.length; i++) {
      line = lines[i];
      if (!line) continue;
      /* satır başı/sonu boşluklarını sadece gerektiğinde temizle (hız) */
      if (line.charCodeAt(0) === 32 || line.charCodeAt(0) === 9) line = line.trim();
      if (!line) continue;

      if (line.charAt(0) === '#') {
        if (line.indexOf('#EXTINF:') === 0) {
          m = /^#EXTINF:\s*(-?\d+(?:\.\d+)?)?\s*(.*)$/.exec(line);
          var rest = m ? m[2] : '';
          /* Kanal adı virgul icerebilir ("Kanal, virgüllü"), nitelik değerleri de
             oyle. Bu yuzden tirnak DISINDAKI ilk virgulden bölüyoruz. */
          var comma = -1, inQ = false, ci, cc;
          for (ci = 0; ci < rest.length; ci++) {
            cc = rest.charAt(ci);
            if (cc === '"') inQ = !inQ;
            else if (cc === ',' && !inQ) { comma = ci; break; }
          }
          var attrPart = comma >= 0 ? rest.substring(0, comma) : rest;
          var namePart = comma >= 0 ? rest.substring(comma + 1) : '';
          a = attrs(attrPart);
          pending = {
            name: (namePart || a['tvg-name'] || 'İsimsiz').trim(),
            tvgId: a['tvg-id'] || '',
            logo: a['tvg-logo'] || '',
            group: a['group-title'] || '',
            chno: parseInt(a['tvg-chno'] || a['tvg-num'] || '', 10) || 0,
            shift: a['tvg-shift'] || '',
            ua: '', referer: '', drm: ''
          };
        } else if (line.indexOf('#EXTGRP:') === 0) {
          extgrp = line.substring(8).trim();
        } else if (line.indexOf('#EXTVLCOPT:') === 0 && pending) {
          vlc = line.substring(11);
          eq = vlc.indexOf('=');
          if (eq > 0) {
            key = vlc.substring(0, eq).toLowerCase();
            val = vlc.substring(eq + 1);
            if (key === 'http-user-agent') pending.ua = val;
            else if (key === 'http-referrer' || key === 'http-referer') pending.referer = val;
          }
        } else if (line.indexOf('#KODIPROP:') === 0 && pending) {
          if (line.toLowerCase().indexOf('license') > 0 || line.toLowerCase().indexOf('drm') > 0) {
            pending.drm = line.substring(10);
          }
        }
        continue;
      }

      /* URL satırı */
      if (!pending) {
        pending = { name: 'Kanal ' + (out.length + 1), tvgId: '', logo: '', group: '', chno: 0, ua: '', referer: '', drm: '' };
      }
      u = splitPipe(line);
      base = slug(pending.tvgId || pending.name) || ('c' + out.length);
      id = plId + ':' + base;
      if (seen[id]) { n = seen[id]++; id = id + '~' + n; } else { seen[id] = 1; }

      out.push({
        id: id,
        plId: plId,
        num: pending.chno || 0,
        name: pending.name,
        group: pending.group || extgrp || 'Diğer',
        logo: pending.logo,
        tvgId: pending.tvgId,
        url: u.url,
        ua: pending.ua || u.ua || defUa,
        referer: pending.referer || u.referer || defRef,
        drm: pending.drm,
        key: norm(pending.name)
      });
      pending = null;
      /* extgrp bilerek sifirlanmiyor: yeni bir #EXTGRP gelene kadar geçerli
         kalır (Kodi'nin uyguladığı davranis). */
    }

    /* numarasi olmayanlara sıralı numara ver */
    var next = 1;
    var used = {};
    for (i = 0; i < out.length; i++) { if (out[i].num) used[out[i].num] = 1; }
    for (i = 0; i < out.length; i++) {
      if (!out[i].num) {
        while (used[next]) next++;
        out[i].num = next;
        used[next] = 1;
      }
    }

    if (!out.length && !warnings.length) warnings.push('Listede hiç kanal bulunamadı.');
    return { channels: out, epgUrl: epgUrl, warnings: warnings };
  }

  /* Kanalları gruplara ayir */
  function groupsOf(channels, hideEmpty) {
    var map = {}, order = [], i, g;
    for (i = 0; i < channels.length; i++) {
      g = channels[i].group || 'Diğer';
      if (!map[g]) { map[g] = []; order.push(g); }
      map[g].push(channels[i]);
    }
    var out = [];
    for (i = 0; i < order.length; i++) {
      if (hideEmpty && !map[order[i]].length) continue;
      out.push({ name: order[i], channels: map[order[i]] });
    }
    out.sort(function (x, y) { return norm(x.name) < norm(y.name) ? -1 : (norm(x.name) > norm(y.name) ? 1 : 0); });
    return out;
  }

  w.M3U = { parse: parse, groupsOf: groupsOf };
}(window));
