/* xmltv.js - XMLTV yayın akışı çözümleyici.
   XMLTV dosyalari 20-100 MB olabiliyor; DOMParser bir TV'de bunu kaldırmaz.
   Bu yuzden metni elle tarıyoruz ve yalnızca
     (a) listede gerçekten bulunan kanalların,
     (b) seçilen zaman penceresine düşen
   programlarını belleğe alıyoruz. Gerisi hiç kopyalanmıyor. */
(function (w) {
  'use strict';

  /* "20240131203000 +0300" -> ms */
  function xtime(s) {
    if (!s) return 0;
    var m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})?(?:\s*([+-])(\d{2})(\d{2}))?/.exec(s);
    if (!m) return 0;
    var ms = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0));
    if (m[7]) {
      var off = ((+m[8]) * 60 + (+m[9])) * 60000;
      ms += (m[7] === '+' ? -off : off);
    }
    return ms;
  }

  function attr(tagSrc, name) {
    var re = new RegExp(name + '\\s*=\\s*"([^"]*)"');
    var m = re.exec(tagSrc);
    if (m) return m[1];
    re = new RegExp(name + "\\s*=\\s*'([^']*)'");
    m = re.exec(tagSrc);
    return m ? m[1] : '';
  }

  function unxml(s) {
    if (!s) return '';
    if (s.indexOf('&') < 0 && s.indexOf('<') < 0) return s;
    return s
      .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
      .replace(/<[^>]*>/g, '')
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
      .replace(/&#(\d+);/g, function (_, d) { return String.fromCharCode(+d); })
      .replace(/&amp;/g, '&')
      .trim();
  }

  function firstTag(body, tag) {
    var open = '<' + tag;
    var i = body.indexOf(open);
    while (i >= 0) {
      var c = body.charAt(i + open.length);
      if (c === '>' || c === ' ' || c === '\t' || c === '\n' || c === '/') break;
      i = body.indexOf(open, i + 1);
    }
    if (i < 0) return '';
    var gt = body.indexOf('>', i);
    if (gt < 0) return '';
    if (body.charAt(gt - 1) === '/') return '';
    var close = body.indexOf('</' + tag, gt);
    if (close < 0) return '';
    return unxml(body.substring(gt + 1, close));
  }

  /* parse(text, opts) -> { byId:{}, names:{}, count:n, channels:n }
     opts: { ids: {tvgId:1}, from: ms, to: ms, max: n } */
  function parse(txt, opts) {
    opts = opts || {};
    var ids = opts.ids || null;
    var from = opts.from || 0;
    var to = opts.to || 0;
    var max = opts.max || 200000;

    var byId = {}, names = {}, count = 0, chCount = 0;
    if (!txt) return { byId: byId, names: names, count: 0, channels: 0 };

    /* --- <channel> kayitlari: görüntülenen ad -> id eslemesi --- */
    var p = 0, i, gt, endIdx, tagSrc, body, id;
    while ((i = txt.indexOf('<channel', p)) >= 0) {
      gt = txt.indexOf('>', i);
      if (gt < 0) break;
      tagSrc = txt.substring(i, gt);
      /* <channels> gibi baska bir etiketi yanlislikla yakalamayalim */
      if (!/^<channel[\s\/>]/.test(txt.substring(i, i + 9) + ' ')) { p = i + 8; continue; }
      id = attr(tagSrc, 'id');
      endIdx = txt.indexOf('</channel>', gt);
      if (endIdx < 0) { p = gt + 1; continue; }
      if (id) {
        body = txt.substring(gt + 1, endIdx);
        var dn = firstTag(body, 'display-name');
        if (dn) { names[norm(dn)] = id; chCount++; }
        names[norm(id)] = id;
      }
      p = endIdx + 10;
    }

    /* --- <programme> kayitlari --- */
    p = 0;
    while ((i = txt.indexOf('<programme', p)) >= 0) {
      gt = txt.indexOf('>', i);
      if (gt < 0) break;
      tagSrc = txt.substring(i, gt);
      var selfClose = txt.charAt(gt - 1) === '/';
      endIdx = selfClose ? gt : txt.indexOf('</programme>', gt);
      if (endIdx < 0) break;
      var nextP = selfClose ? gt + 1 : endIdx + 12;

      var ch = attr(tagSrc, 'channel');
      if (!ch || (ids && !ids[ch])) { p = nextP; continue; }

      var s = xtime(attr(tagSrc, 'start'));
      var e = xtime(attr(tagSrc, 'stop')) || (s + 3600000);
      if (to && s > to) { p = nextP; continue; }
      if (from && e < from) { p = nextP; continue; }

      body = selfClose ? '' : txt.substring(gt + 1, endIdx);
      var rec = {
        s: s, e: e,
        t: firstTag(body, 'title') || 'Program',
        d: firstTag(body, 'desc') || '',
        c: firstTag(body, 'category') || ''
      };
      if (!byId[ch]) byId[ch] = [];
      byId[ch].push(rec);
      count++;
      if (count >= max) break;
      p = nextP;
    }

    for (var k in byId) {
      if (Object.prototype.hasOwnProperty.call(byId, k)) {
        byId[k].sort(function (a, b) { return a.s - b.s; });
      }
    }

    return { byId: byId, names: names, count: count, channels: chCount };
  }

  /* --- çalışma zamani sorguları --- */
  function Epg() {
    this.byId = {};
    this.names = {};
    this.loadedAt = 0;
    this.count = 0;
  }

  Epg.prototype.load = function (res) {
    this.byId = res.byId;
    this.names = res.names;
    this.count = res.count;
    this.loadedAt = Date.now();
  };

  Epg.prototype.clear = function () { this.byId = {}; this.names = {}; this.count = 0; this.loadedAt = 0; };

  /* Kanalin EPG anahtarini bul: önce tvg-id, olmazsa adiyla eşle */
  Epg.prototype.keyFor = function (ch) {
    if (!ch) return '';
    if (ch.tvgId && this.byId[ch.tvgId]) return ch.tvgId;
    var n = this.names[ch.key];
    if (n && this.byId[n]) return n;
    if (this.byId[ch.name]) return ch.name;
    return '';
  };

  Epg.prototype.at = function (ch, when) {
    var k = this.keyFor(ch);
    if (!k) return null;
    var list = this.byId[k];
    if (!list) return null;
    when = when || Date.now();
    /* ikili arama */
    var lo = 0, hi = list.length - 1, mid, r = null;
    while (lo <= hi) {
      mid = (lo + hi) >> 1;
      if (list[mid].s <= when) { r = mid; lo = mid + 1; } else { hi = mid - 1; }
    }
    if (r == null) return null;
    var cur = list[r];
    return (cur.e > when) ? { now: cur, next: list[r + 1] || null, idx: r, list: list }
                          : { now: null, next: list[r + 1] || null, idx: r, list: list };
  };

  Epg.prototype.range = function (ch, from, to) {
    var k = this.keyFor(ch);
    if (!k) return [];
    var list = this.byId[k], out = [], i;
    for (i = 0; i < list.length; i++) {
      if (list[i].e <= from) continue;
      if (list[i].s >= to) break;
      out.push(list[i]);
    }
    return out;
  };

  w.XMLTV = { parse: parse, xtime: xtime, Epg: Epg };
}(window));
