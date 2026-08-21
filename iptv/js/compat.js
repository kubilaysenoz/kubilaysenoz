/* compat.js - eski TV tarayıcıları için küçük yamalar ve yetenek tespiti.
   Kod tabanının tamami bilerek ES5'tir: let/const, ok fonksiyonu, sablon dizgesi,
   Promise ve fetch kullanılmaz. Philips Saphi / NetTV gibi eski WebKit
   türeviyle Android TV WebView'i aynı anda desteklemenin en güvenli yolu bu. */
(function (w) {
  'use strict';

  if (!Array.prototype.indexOf) {
    Array.prototype.indexOf = function (o, s) {
      for (var i = s || 0; i < this.length; i++) { if (this[i] === o) return i; }
      return -1;
    };
  }
  if (!Array.prototype.filter) {
    Array.prototype.filter = function (fn, t) {
      var out = [], i;
      for (i = 0; i < this.length; i++) { if (fn.call(t, this[i], i, this)) out.push(this[i]); }
      return out;
    };
  }
  if (!Array.prototype.map) {
    Array.prototype.map = function (fn, t) {
      var out = [], i;
      for (i = 0; i < this.length; i++) { out.push(fn.call(t, this[i], i, this)); }
      return out;
    };
  }
  if (!Array.prototype.forEach) {
    Array.prototype.forEach = function (fn, t) {
      for (var i = 0; i < this.length; i++) { fn.call(t, this[i], i, this); }
    };
  }
  if (!String.prototype.trim) {
    String.prototype.trim = function () { return this.replace(/^[\s﻿\xA0]+|[\s﻿\xA0]+$/g, ''); };
  }
  if (!Date.now) { Date.now = function () { return new Date().getTime(); }; }

  if (!w.requestAnimationFrame) {
    w.requestAnimationFrame = w.webkitRequestAnimationFrame || w.mozRequestAnimationFrame ||
      function (cb) { return w.setTimeout(cb, 16); };
  }

  if (!w.console) { w.console = {}; }
  var noop = function () {};
  var lvl = ['log', 'warn', 'error', 'info', 'debug'];
  for (var i = 0; i < lvl.length; i++) { if (!w.console[lvl[i]]) w.console[lvl[i]] = noop; }

  /* --- yetenek tespiti --- */
  var probe = document.createElement('video');
  var can = function (t) { try { return !!probe.canPlayType && probe.canPlayType(t) !== ''; } catch (e) { return false; } };

  w.CAPS = {
    mse: !!(w.MediaSource && w.MediaSource.isTypeSupported &&
            w.MediaSource.isTypeSupported('video/mp4; codecs="avc1.42E01E,mp4a.40.2"')),
    nativeHls: can('application/vnd.apple.mpegurl') || can('application/x-mpegURL'),
    nativeTs: can('video/mp2t'),
    mp4: can('video/mp4'),
    webm: can('video/webm'),
    hlsjs: false,   /* player.js dolduruyor */
    mpegtsjs: false,
    storage: (function () {
      try { w.localStorage.setItem('__t', '1'); w.localStorage.removeItem('__t'); return true; }
      catch (e) { return false; }
    }()),
    gunzip: typeof w.DecompressionStream === 'function',
    transform: (function () {
      var s = document.createElement('div').style;
      return 'transform' in s || 'webkitTransform' in s;
    }())
  };

  /* translate3d, TV GPU'sunda top/left'ten çok daha akıcı kayar */
  w.setY = function (el, y) {
    if (w.CAPS.transform) {
      var v = 'translate3d(0,' + y + 'px,0)';
      el.style.webkitTransform = v;
      el.style.transform = v;
    } else {
      el.style.top = y + 'px';
    }
  };

  w.$ = function (id) { return document.getElementById(id); };

  w.el = function (tag, cls, txt) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (txt != null) e.appendChild(document.createTextNode(String(txt)));
    return e;
  };

  w.esc = function (s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  };

  w.pad2 = function (n) { return (n < 10 ? '0' : '') + n; };

  w.hhmm = function (d) { return pad2(d.getHours()) + ':' + pad2(d.getMinutes()); };

  w.extend = function (dst, src) {
    for (var k in src) { if (Object.prototype.hasOwnProperty.call(src, k)) dst[k] = src[k]; }
    return dst;
  };

  /* Turkce arama için: aksan/büyük-küçük normalizasyonu (I/i sorunu dahil) */
  var TRMAP = { 'ç': 'c', 'ğ': 'g', 'ı': 'i', 'ö': 'o', 'ş': 's', 'ü': 'u', 'İ': 'i', 'I': 'i', 'Ç': 'c', 'Ğ': 'g', 'Ö': 'o', 'Ş': 's', 'Ü': 'u', 'â': 'a', 'î': 'i', 'û': 'u' };
  w.norm = function (s) {
    s = String(s == null ? '' : s);
    var out = '', i, c;
    for (i = 0; i < s.length; i++) {
      c = s.charAt(i);
      out += TRMAP[c] || c;
    }
    return out.toLowerCase();
  };
}(window));
