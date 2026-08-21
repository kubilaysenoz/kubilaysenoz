/* http.js - XHR tabanli indirme (fetch/Promise yok, geri çağırım var).
   Ayrica isteg-e bağlı CORS/basli vekil sunucu destegi: tools/server.js. */
(function (w) {
  'use strict';

  function proxied(url, opt) {
    var s = Settings.all();
    var p = String(s.proxyUrl || '').trim();
    if (!p) return url;
    var force = opt && opt.forceProxy;
    if (!force && !s.proxyAlways) {
      /* HTTPS sayfadan HTTP kaynak cekilemez (karışık içerik).
         Bu durumda vekil zorunlu; digerlerinde kullanicinin tercihi. */
      var pageHttps = w.location.protocol === 'https:';
      var srcHttp = /^http:\/\//i.test(url);
      if (!(pageHttps && srcHttp)) return url;
    }
    if (p.indexOf('{url}') >= 0) return p.replace('{url}', encodeURIComponent(url));
    return p + (p.charAt(p.length - 1) === '=' ? '' : '') + encodeURIComponent(url);
  }

  /* cb(err, text, xhr) */
  function text(url, opt, cb) {
    if (typeof opt === 'function') { cb = opt; opt = {}; }
    opt = opt || {};
    var target = opt.noProxy ? url : proxied(url, opt);
    var xhr = new XMLHttpRequest();
    var done = false;
    var timer;

    function finish(err, body) {
      if (done) return;
      done = true;
      if (timer) w.clearTimeout(timer);
      cb(err, body, xhr);
    }

    try { xhr.open(opt.method || 'GET', target, true); }
    catch (e) { finish(new Error('Adres açılamadı: ' + e.message)); return null; }

    if (opt.headers) {
      for (var k in opt.headers) {
        if (Object.prototype.hasOwnProperty.call(opt.headers, k)) {
          try { xhr.setRequestHeader(k, opt.headers[k]); } catch (e2) {}
        }
      }
    }
    if (opt.responseType) { try { xhr.responseType = opt.responseType; } catch (e3) {} }

    xhr.onreadystatechange = function () {
      if (xhr.readyState !== 4) return;
      var st = xhr.status;
      /* file:// üzerinde status 0 ama içerik gelmis olabilir */
      if (st === 0 && !xhr.responseText && !xhr.response) {
        finish(new Error('Bağlantı kurulamadı (CORS, karışık içerik ya da ağ hatası)'));
        return;
      }
      if (st >= 400) { finish(new Error('HTTP ' + st + (xhr.statusText ? ' ' + xhr.statusText : ''))); return; }
      finish(null, opt.responseType ? xhr.response : xhr.responseText);
    };
    xhr.onerror = function () { finish(new Error('Ağ hatası (CORS ya da erişim engeli olabilir)')); };

    if (opt.onprogress && 'onprogress' in xhr) {
      xhr.onprogress = function (e) {
        opt.onprogress(e.loaded || 0, e.lengthComputable ? e.total : 0);
      };
    }

    timer = w.setTimeout(function () {
      try { xhr.abort(); } catch (e4) {}
      finish(new Error('Zaman aşımı (' + Math.round((opt.timeout || 30000) / 1000) + ' sn)'));
    }, opt.timeout || 30000);

    try { xhr.send(opt.body || null); }
    catch (e5) { finish(new Error('İstek gönderilemedi: ' + e5.message)); }
    return xhr;
  }

  /* gzip'li XMLTV için: mumkunse tarayicida ac, değilse anlasilir hata dondur */
  function maybeGunzip(buf, cb) {
    var bytes = new Uint8Array(buf);
    if (!(bytes.length > 2 && bytes[0] === 0x1f && bytes[1] === 0x8b)) {
      /* düz metin */
      cb(null, bufToStr(buf));
      return;
    }
    if (!w.CAPS.gunzip) {
      cb(new Error('Sıkıştırılmış (.gz) EPG bu TV tarayıcısında açılamıyor. ' +
                   'Sıkıştırılmamış .xml adresini kullan ya da vekil sunucuyu ac.'));
      return;
    }
    try {
      var ds = new w.DecompressionStream('gzip');
      var stream = new w.Response(buf).body.pipeThrough(ds);
      new w.Response(stream).text().then(function (t) { cb(null, t); },
                                         function (e) { cb(new Error('Gzip açılamadı: ' + e.message)); });
    } catch (e) {
      cb(new Error('Gzip açılamadı: ' + e.message));
    }
  }

  function bufToStr(buf) {
    if (w.TextDecoder) { try { return new w.TextDecoder('utf-8').decode(new Uint8Array(buf)); } catch (e) {} }
    var bytes = new Uint8Array(buf), s = '', i, CH = 8192;
    for (i = 0; i < bytes.length; i += CH) {
      s += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
    }
    try { return decodeURIComponent(escape(s)); } catch (e2) { return s; }
  }

  w.Http = { text: text, proxied: proxied, maybeGunzip: maybeGunzip, bufToStr: bufToStr };
}(window));
