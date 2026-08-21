/* store.js - localStorage üzerinde kalıcı ayar/liste deposu.
   TV tarayıcılarında localStorage bazen kapalı ya da ~2-5 MB ile sınırlı olur;
   yazma basarisiz olursa bellekteki kopya çalışmaya devam eder. */
(function (w) {
  'use strict';

  var NS = 'nomads.';
  var mem = {};                 /* localStorage yoksa / dolduysa yedek */
  var ok = w.CAPS.storage;

  function raw(k) {
    if (ok) { try { return w.localStorage.getItem(NS + k); } catch (e) {} }
    return mem[k] != null ? mem[k] : null;
  }
  function rawSet(k, v) {
    mem[k] = v;
    if (!ok) return false;
    try { w.localStorage.setItem(NS + k, v); return true; }
    catch (e) { return false; }   /* QuotaExceededError vb. */
  }
  function rawDel(k) {
    delete mem[k];
    if (ok) { try { w.localStorage.removeItem(NS + k); } catch (e) {} }
  }

  var Store = {
    get: function (k, dflt) {
      var v = raw(k);
      if (v == null) return dflt;
      try { return JSON.parse(v); } catch (e) { return dflt; }
    },
    set: function (k, val) {
      var s;
      try { s = JSON.stringify(val); } catch (e) { return false; }
      return rawSet(k, s);
    },
    del: rawDel,
    /* yaklaşık kullanim (bayt) - ayarlar ekraninda gosteriyoruz */
    usage: function () {
      var n = 0, k;
      if (!ok) return -1;
      try {
        for (k in w.localStorage) {
          if (k.indexOf(NS) === 0) n += (w.localStorage.getItem(k) || '').length + k.length;
        }
      } catch (e) { return -1; }
      return n * 2;   /* UTF-16 */
    },
    clearAll: function () {
      var keys = [], k;
      if (ok) {
        try {
          for (k in w.localStorage) { if (k.indexOf(NS) === 0) keys.push(k); }
          for (var i = 0; i < keys.length; i++) w.localStorage.removeItem(keys[i]);
        } catch (e) {}
      }
      mem = {};
    }
  };

  /* ---------------- varsayılan ayarlar ---------------- */
  var DEFAULTS = {
    lang: 'tr',
    uiScale: 100,          /* % */
    safeArea: 0,           /* % overscan payı */
    startupChannel: 'last',/* last | none */
    autoplayLast: false,
    aspect: 'contain',     /* contain | cover | fill */
    engine: 'auto',        /* auto | native | hlsjs | mpegts */
    lowLatency: false,
    bufferSec: 30,
    retryMax: 4,
    stallTimeout: 12,      /* sn - görüntü ilerlemezse yeniden bağlan */
    osdSeconds: 6,
    zapDelay: 2000,
    proxyUrl: '',          /* örnek: http://192.168.1.20:8080/proxy?url= */
    proxyAlways: false,
    epgUrl: '',
    epgAutoRefreshH: 12,
    epgWindowH: 30,
    hideEmptyGroups: true,
    sortChannels: 'playlist', /* playlist | name | number */
    lockedGroups: [],
    pin: '',
    lastChannelId: '',
    lastGroup: '',

    /* Küçük, özel bir kurulum için: listeyi tek yerden güncelle, bütün
       cihazlar oradan çeksin. Boş bırakılırsa güncelleme kontrolü yapılmaz. */
    updateUrl: 'https://raw.githubusercontent.com/kubilaysenoz/kubilaysenoz/main/iptv/version.json',
    lastUpdateCheck: 0,
    sharedListBase: 'https://raw.githubusercontent.com/kubilaysenoz/kubilaysenoz/main/iptv/playlists/'
  };

  var settings = null;

  var Settings = {
    all: function () {
      if (!settings) {
        settings = extend(extend({}, DEFAULTS), Store.get('settings', {}));
      }
      return settings;
    },
    get: function (k) { return Settings.all()[k]; },
    set: function (k, v) {
      Settings.all()[k] = v;
      return Store.set('settings', settings);
    },
    reset: function () { settings = extend({}, DEFAULTS); Store.set('settings', settings); },
    defaults: DEFAULTS
  };

  /* ---------------- kanal listeleri ---------------- */
  /* playlist: { id, name, type:'m3u'|'xtream', url, ua, referer,
                 host,user,pass,output,  epgUrl, enabled, addedAt } */
  var Playlists = {
    all: function () { return Store.get('playlists', []); },
    save: function (arr) { return Store.set('playlists', arr); },
    add: function (p) {
      var a = Playlists.all();
      p.id = p.id || ('pl' + Date.now() + Math.floor(Math.random() * 1000));
      p.addedAt = p.addedAt || Date.now();
      if (p.enabled == null) p.enabled = true;
      a.push(p);
      Playlists.save(a);
      return p;
    },
    update: function (id, patch) {
      var a = Playlists.all(), i;
      for (i = 0; i < a.length; i++) { if (a[i].id === id) { extend(a[i], patch); break; } }
      Playlists.save(a);
    },
    remove: function (id) {
      var a = Playlists.all(), out = [], i;
      for (i = 0; i < a.length; i++) { if (a[i].id !== id) out.push(a[i]); }
      Playlists.save(out);
      Store.del('cache.' + id);
    },
    byId: function (id) {
      var a = Playlists.all(), i;
      for (i = 0; i < a.length; i++) { if (a[i].id === id) return a[i]; }
      return null;
    },
    /* Xtream Codes panelinden M3U adresi üret */
    m3uUrl: function (p) {
      if (p.type !== 'xtream') return p.url;
      var host = String(p.host || '').replace(/\/+$/, '');
      if (!/^https?:\/\//i.test(host)) host = 'http://' + host;
      return host + '/get.php?username=' + encodeURIComponent(p.user) +
             '&password=' + encodeURIComponent(p.pass) +
             '&type=m3u_plus&output=' + (p.output || 'ts');
    },
    xmltvUrl: function (p) {
      if (p.type !== 'xtream') return p.epgUrl || '';
      var host = String(p.host || '').replace(/\/+$/, '');
      if (!/^https?:\/\//i.test(host)) host = 'http://' + host;
      return host + '/xmltv.php?username=' + encodeURIComponent(p.user) +
             '&password=' + encodeURIComponent(p.pass);
    }
  };

  /* ---------------- önbellek ----------------
     Büyük listeler localStorage kotasını aşabilir. Aşarsa sessizce vazgeçip
     açılışta yeniden indiriyoruz - uygulama yine çalışır, sadece daha yavas açılır. */
  var Cache = {
    read: function (id, maxAgeMs) {
      var c = Store.get('cache.' + id, null);
      if (!c || !c.t) return null;
      if (maxAgeMs && (Date.now() - c.t) > maxAgeMs) return null;
      return c.channels || null;
    },
    write: function (id, channels) {
      /* ~1.5 MB üzerini yazmayi denemiyoruz; TV'de kota hatası pahali */
      var payload = { t: Date.now(), channels: channels };
      var s;
      try { s = JSON.stringify(payload); } catch (e) { return false; }
      if (s.length > 1500000) return false;
      return Store.set('cache.' + id, payload);
    },
    drop: function (id) { Store.del('cache.' + id); }
  };

  /* ---------------- favoriler / son izlenenler ---------------- */
  var Fav = {
    ids: function () { return Store.get('favorites', []); },
    has: function (id) { return Fav.ids().indexOf(id) >= 0; },
    toggle: function (id) {
      var a = Fav.ids(), i = a.indexOf(id);
      if (i >= 0) a.splice(i, 1); else a.push(id);
      Store.set('favorites', a);
      return i < 0;
    },
    clear: function () { Store.set('favorites', []); }
  };

  var Recent = {
    ids: function () { return Store.get('recent', []); },
    push: function (id) {
      var a = Recent.ids(), i = a.indexOf(id);
      if (i >= 0) a.splice(i, 1);
      a.unshift(id);
      if (a.length > 40) a.length = 40;
      Store.set('recent', a);
    },
    clear: function () { Store.set('recent', []); }
  };

  /* Hangi yayın motorunun hangi sunucuda çalıştığını hatırla.
     Ikinci açılışta doğru motorla başladığı için kanal çok daha hızlı açılır. */
  var EngineMemo = {
    key: function (url) {
      var m = /^[a-z]+:\/\/([^\/?#]+)/i.exec(url || '');
      return m ? m[1] : 'other';
    },
    get: function (url) { return Store.get('engmemo', {})[EngineMemo.key(url)] || null; },
    set: function (url, eng) {
      var m = Store.get('engmemo', {});
      m[EngineMemo.key(url)] = eng;
      Store.set('engmemo', m);
    },
    clear: function () { Store.del('engmemo'); }
  };

  w.Store = Store;
  w.Settings = Settings;
  w.Playlists = Playlists;
  w.Cache = Cache;
  w.Fav = Fav;
  w.Recent = Recent;
  w.EngineMemo = EngineMemo;
}(window));
