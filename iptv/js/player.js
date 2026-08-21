/* player.js - yayın motoru.
   Üç yol var ve sırayla denenir:
     1) TV'nin kendi <video> çözücüsü  (en düşük gecikme, donanım hızlandırmalı)
     2) hls.js       (MSE üzerinden .m3u8)
     3) mpegts.js    (MSE üzerinden ham MPEG-TS - Xtream tarzi adresler)
   Hangi sunucuda hangi motorun çalıştığı hatırlanır; ikinci açılışta kanal
   doğrudan doğru motorla açılır. */
(function (w) {
  'use strict';

  var video = null;
  var hls = null;         /* Hls ornegi */
  var mts = null;         /* mpegts ornegi */
  var cur = null;         /* çalan kanal */
  var chain = [];         /* denenecek motor sırası */
  var chainAt = 0;
  var engine = '';        /* su anki motor */
  var state = 'idle';
  var attempts = 0;
  var startedAt = 0;
  var gotFrame = false;
  var usedProxy = false;
  var watchdog = null;
  var lastTime = -1;
  var lastProgress = 0;
  var cb = {};
  var switchTimer = null;

  function s() { return Settings.all(); }

  function emit(st, info) {
    state = st;
    if (cb.onState) cb.onState(st, info || {});
  }

  /* ---------- adres analizi ---------- */
  function kindOf(url) {
    var u = String(url || '').split('#')[0].split('?')[0].toLowerCase();
    if (u.indexOf('.m3u8') > 0) return 'hls';
    if (u.indexOf('.mpd') > 0) return 'dash';
    if (/\.(ts|m2ts|mts)$/.test(u)) return 'ts';
    if (/\.(mp4|m4v|mov|webm|ogv)$/.test(u)) return 'file';
    if (/\.(mkv|avi|flv|wmv)$/.test(u)) return 'file';
    /* Xtream canlı adresleri uzantisiz gelir: http://host:port/kullanıcı/şifre/123 */
    return 'unknown';
  }

  function needsProxy(ch) {
    if (!ch) return false;
    if (ch.ua || ch.referer) return true;                       /* özel başlıklar */
    if (w.location.protocol === 'https:' && /^http:\/\//i.test(ch.url)) return true; /* karışık içerik */
    return !!s().proxyAlways;
  }

  function proxyBase() { return String(s().proxyUrl || '').trim(); }

  function mediaUrl(ch, viaProxy) {
    if (!viaProxy || !proxyBase()) return ch.url;
    var p = proxyBase(), out;
    if (p.indexOf('{url}') >= 0) out = p.replace('{url}', encodeURIComponent(ch.url));
    else out = p + encodeURIComponent(ch.url);
    if (ch.ua) out += '&ua=' + encodeURIComponent(ch.ua);
    if (ch.referer) out += '&ref=' + encodeURIComponent(ch.referer);
    return out;
  }

  /* ---------- motor zinciri ---------- */
  function buildChain(ch) {
    var forced = s().engine;
    var C = w.CAPS;
    if (forced && forced !== 'auto') return [forced];

    var kind = kindOf(ch.url);
    var list = [];

    function add(e) { if (e && list.indexOf(e) < 0) list.push(e); }

    /* Kutuphanelerin kendi isSupported() cevabina guveniyoruz; kendi MSE
       tahminimize değil. Ikisi ayrisabiliyor (ornegin H.264 bulunmayan bir
       tarayicida hls.js "destekliyorum" derken bizim sinamamiz "hayir" der). */
    if (kind === 'hls') {
      if (C.nativeHls) add('native');
      if (C.hlsjs) add('hlsjs');
      if (!list.length) add('native');
    } else if (kind === 'ts') {
      if (C.mpegtsjs) add('mpegts');
      if (C.nativeTs) add('native');
      if (!list.length) add('native');
    } else if (kind === 'file') {
      add('native');
    } else if (kind === 'dash') {
      return [];   /* DASH/DRM desteklenmiyor */
    } else {
      /* uzantisiz: önce TS (Xtream varsayilani), sonra HLS, sonra doğrudan */
      if (C.mpegtsjs) add('mpegts');
      if (C.hlsjs) add('hlsjs');
      add('native');
    }

    /* daha önce bu sunucuda çalışan motoru başa al */
    var memo = EngineMemo.get(ch.url);
    if (memo && list.indexOf(memo) > 0) {
      list.splice(list.indexOf(memo), 1);
      list.unshift(memo);
    }
    return list;
  }

  /* ---------- temizlik ---------- */
  function teardown() {
    if (switchTimer) { w.clearTimeout(switchTimer); switchTimer = null; }
    if (hls) {
      try { hls.destroy(); } catch (e) {}
      hls = null;
    }
    if (mts) {
      try { mts.pause(); } catch (e2) {}
      try { mts.unload(); } catch (e3) {}
      try { mts.detachMediaElement(); } catch (e4) {}
      try { mts.destroy(); } catch (e5) {}
      mts = null;
    }
    if (video) {
      try { video.pause(); } catch (e6) {}
      try { video.removeAttribute('src'); video.load(); } catch (e7) {}
    }
    engine = '';
  }

  /* ---------- motorlar ---------- */
  function startNative(url) {
    engine = 'native';
    video.src = url;
    try { video.load(); } catch (e) {}
    play();
  }

  function startHlsJs(url) {
    engine = 'hlsjs';
    var cfg = {
      lowLatencyMode: !!s().lowLatency,
      enableWorker: (typeof w.Worker !== 'undefined'),
      backBufferLength: 30,
      maxBufferLength: Math.max(6, s().bufferSec | 0),
      maxMaxBufferLength: Math.max(12, (s().bufferSec | 0) * 2),
      manifestLoadingTimeOut: 15000,
      manifestLoadingMaxRetry: 2,
      levelLoadingTimeOut: 15000,
      fragLoadingTimeOut: 30000,
      fragLoadingMaxRetry: 4,
      liveSyncDurationCount: s().lowLatency ? 1 : 3,
      /* TV'lerde işlemci sınırlı: otomatik kalite biraz temkinli başlasın */
      startLevel: -1,
      abrEwmaDefaultEstimate: 800000
    };
    hls = new w.Hls(cfg);

    hls.on(w.Hls.Events.ERROR, function (evt, data) {
      if (!data) return;
      if (!data.fatal) {
        /* küçük hatalar: hls.js kendi toparlıyor, sadece kaydet */
        return;
      }
      switch (data.type) {
        case w.Hls.ErrorTypes.NETWORK_ERROR:
          if (!gotFrame) { nextEngineOrFail('Ağ hatası: ' + (data.details || '')); return; }
          try { hls.startLoad(); emit('loading', { note: 'Yeniden bağlanıyor' }); }
          catch (e) { softRecover(); }
          break;
        case w.Hls.ErrorTypes.MEDIA_ERROR:
          try { hls.recoverMediaError(); emit('loading', { note: 'Görüntü kurtarılıyor' }); }
          catch (e2) { softRecover(); }
          break;
        default:
          nextEngineOrFail('hls.js: ' + (data.details || data.type));
      }
    });

    hls.on(w.Hls.Events.MANIFEST_PARSED, function () {
      play();
      if (cb.onTracks) cb.onTracks();
    });
    hls.on(w.Hls.Events.LEVEL_SWITCHED, function () { if (cb.onTracks) cb.onTracks(); });
    hls.on(w.Hls.Events.AUDIO_TRACKS_UPDATED, function () { if (cb.onTracks) cb.onTracks(); });

    hls.loadSource(url);
    hls.attachMedia(video);
  }

  function startMpegts(url) {
    engine = 'mpegts';
    mts = w.mpegts.createPlayer({
      type: 'mpegts',
      isLive: true,
      url: url,
      cors: true
    }, {
      enableStashBuffer: !s().lowLatency,
      stashInitialSize: s().lowLatency ? 128 : 384,
      liveBufferLatencyChasing: true,
      liveBufferLatencyMaxLatency: Math.max(3, s().bufferSec | 0),
      liveBufferLatencyMinRemain: 0.5,
      lazyLoad: false,
      autoCleanupSourceBuffer: true
    });
    mts.on(w.mpegts.Events.ERROR, function (type, detail, info) {
      var msg = (type || '') + ' ' + (detail || '') + (info && info.msg ? ' - ' + info.msg : '');
      if (!gotFrame) { nextEngineOrFail('mpegts.js: ' + msg); return; }
      softRecover();
    });
    mts.attachMediaElement(video);
    try { mts.load(); } catch (e) { nextEngineOrFail('mpegts.js yüklenemedi: ' + e.message); return; }
    play();
  }

  function play() {
    try {
      var p = video.play();
      if (p && p['catch']) {
        p['catch'](function (err) {
          /* Otomatik oynatma engeli: TV tarayıcılarında nadiren olur ama
             olursa kullaniciya "OK'a bas" demek gerekiyor. */
          if (err && (err.name === 'NotAllowedError')) {
            emit('blocked', { message: 'Otomatik başlatma engellendi. OK tuşuna bas.' });
          }
        });
      }
    } catch (e) {}
  }

  /* ---------- hata / kurtarma ---------- */
  function nextEngineOrFail(reason) {
    if (switchTimer) { w.clearTimeout(switchTimer); switchTimer = null; }
    chainAt++;
    if (chainAt < chain.length) {
      var nxt = chain[chainAt];
      emit('loading', { note: 'Farklı motor deneniyor: ' + engName(nxt) });
      teardown();
      launch(nxt);
      return;
    }
    /* motorlar bitti: vekil sunucu ile bir kez daha dene */
    if (!usedProxy && proxyBase()) {
      usedProxy = true;
      chainAt = 0;
      emit('loading', { note: 'Vekil sunucu üzerinden deneniyor' });
      teardown();
      launch(chain[0]);
      return;
    }
    fail(reason);
  }

  function fail(reason) {
    stopWatchdog();
    emit('error', { message: reason || 'Yayın açılamadı', channel: cur, proxied: usedProxy });
  }

  function softRecover() {
    attempts++;
    if (attempts > (s().retryMax | 0)) { fail('Yayın sürekli kesiliyor (' + attempts + ' deneme).'); return; }
    var delay = Math.min(8000, 700 * Math.pow(2, attempts - 1));
    emit('loading', { note: 'Yeniden bağlanıyor (' + attempts + ')' });
    var ch = cur;
    w.setTimeout(function () {
      if (cur !== ch) return;       /* kullanıcı kanal değiştirdi */
      var url = mediaUrl(ch, usedProxy || needsProxy(ch));
      teardown();
      gotFrame = false;
      launchWith(chain[chainAt] || chain[0], url);
    }, delay);
  }

  function engName(e) {
    return e === 'native' ? 'TV çözücüsü' : (e === 'hlsjs' ? 'hls.js' : (e === 'mpegts' ? 'mpegts.js' : e));
  }

  /* ---------- bekçi: görüntü ilerlemiyorsa yeniden bagla ---------- */
  function startWatchdog() {
    stopWatchdog();
    lastTime = -1;
    lastProgress = Date.now();
    watchdog = w.setInterval(function () {
      if (!cur || !video) return;
      if (video.paused) { lastProgress = Date.now(); return; }
      var t = video.currentTime || 0;
      if (t > lastTime + 0.05) {
        lastTime = t;
        lastProgress = Date.now();
        if (state === 'stalled') emit('playing', { engine: engine });
        return;
      }
      var idle = (Date.now() - lastProgress) / 1000;
      if (idle > 2.5 && state === 'playing') emit('stalled', { engine: engine });
      if (idle > (s().stallTimeout | 0)) {
        lastProgress = Date.now();
        if (!gotFrame) nextEngineOrFail('Görüntü hiç başlamadı (zaman aşımı).');
        else softRecover();
      }
    }, 1000);
  }
  function stopWatchdog() { if (watchdog) { w.clearInterval(watchdog); watchdog = null; } }

  /* ---------- başlatma ---------- */
  function launch(eng) { launchWith(eng, mediaUrl(cur, usedProxy || needsProxy(cur))); }

  function launchWith(eng, url) {
    if (eng === 'hlsjs' && !(w.Hls && w.Hls.isSupported && w.Hls.isSupported())) { nextEngineOrFail('hls.js desteklenmiyor'); return; }
    if (eng === 'mpegts' && !(w.mpegts && w.mpegts.isSupported && w.mpegts.isSupported())) { nextEngineOrFail('mpegts.js desteklenmiyor'); return; }
    emit('loading', { note: engName(eng), engine: eng });

    /* Bu motor makul sürede görüntü vermezse siradakine geç */
    if (switchTimer) w.clearTimeout(switchTimer);
    switchTimer = w.setTimeout(function () {
      switchTimer = null;
      if (!gotFrame && cur) nextEngineOrFail(engName(eng) + ' yanit vermedi.');
    }, 11000);

    try {
      if (eng === 'hlsjs') startHlsJs(url);
      else if (eng === 'mpegts') startMpegts(url);
      else startNative(url);
    } catch (e) {
      nextEngineOrFail(engName(eng) + ' başlatılamadı: ' + e.message);
    }
  }

  /* ---------- disa açık API ---------- */
  var Player = {
    init: function (videoEl, callbacks) {
      video = videoEl;
      cb = callbacks || {};

      w.CAPS.hlsjs = !!(w.Hls && w.Hls.isSupported && w.Hls.isSupported());
      w.CAPS.mpegtsjs = !!(w.mpegts && w.mpegts.isSupported && w.mpegts.isSupported());

      video.addEventListener('playing', function () {
        if (switchTimer) { w.clearTimeout(switchTimer); switchTimer = null; }
        if (!gotFrame) {
          gotFrame = true;
          attempts = 0;
          if (cur) EngineMemo.set(cur.url, engine);
        }
        emit('playing', { engine: engine, ttfp: Date.now() - startedAt });
      }, false);
      video.addEventListener('waiting', function () {
        if (state === 'playing') emit('buffering', { engine: engine });
      }, false);
      video.addEventListener('pause', function () { if (cur) emit('paused', {}); }, false);
      video.addEventListener('ended', function () { if (cur) softRecover(); }, false);
      video.addEventListener('error', function () {
        var err = video.error;
        var code = err ? err.code : 0;
        var msg = ['bilinmeyen', 'iptal edildi', 'ağ hatası', 'çözümleme hatası', 'biçim desteklenmiyor'][code] || 'bilinmeyen';
        if (!gotFrame) nextEngineOrFail('TV çözücüsü: ' + msg);
        else softRecover();
      }, false);

      Player.setAspect(s().aspect);
    },

    play: function (ch) {
      if (!ch || !ch.url) return;
      teardown();
      stopWatchdog();
      cur = ch;
      attempts = 0;
      gotFrame = false;
      startedAt = Date.now();
      usedProxy = needsProxy(ch);
      chain = buildChain(ch);
      chainAt = 0;

      if (!chain.length) {
        fail(kindOf(ch.url) === 'dash'
          ? 'MPEG-DASH (.mpd) ve DRM korumalı yayınlar desteklenmiyor.'
          : 'Bu adres için uygun bir yayın motoru bulunamadı.');
        return;
      }
      if ((ch.ua || ch.referer) && !proxyBase()) {
        emit('warn', { message: 'Bu kanal özel User-Agent/Referer istiyor. ' +
                                'Ayarlar > Ağ bölümünden vekil sunucuyu tanımla.' });
      }
      startWatchdog();
      launch(chain[0]);
    },

    retry: function () {
      if (!cur) return;
      var ch = cur;
      Player.play(ch);
    },

    stop: function () {
      cur = null;
      teardown();
      stopWatchdog();
      emit('idle', {});
    },

    togglePause: function () {
      if (!video) return;
      if (video.paused) { play(); } else { try { video.pause(); } catch (e) {} }
    },

    /* canlı yayında en uca dön */
    goLive: function () {
      if (hls) { try { hls.startLoad(-1); } catch (e) {} }
      if (mts) { try { mts.currentTime = mts.buffered.end(mts.buffered.length - 1) - 0.5; } catch (e2) {} }
      if (video && video.buffered && video.buffered.length) {
        try { video.currentTime = video.buffered.end(video.buffered.length - 1) - 0.5; } catch (e3) {}
      }
      play();
    },

    setAspect: function (mode) {
      if (!video) return;
      video.className = 'fit-' + (mode || 'contain');
    },

    current: function () { return cur; },
    engine: function () { return engine; },
    state: function () { return state; },
    viaProxy: function () { return usedProxy; },

    stats: function () {
      var o = { engine: engName(engine), proxy: usedProxy, state: state };
      if (video) {
        o.res = (video.videoWidth || 0) + 'x' + (video.videoHeight || 0);
        var bl = 0;
        try {
          if (video.buffered && video.buffered.length) {
            bl = video.buffered.end(video.buffered.length - 1) - (video.currentTime || 0);
          }
        } catch (e) {}
        o.buffer = Math.max(0, Math.round(bl * 10) / 10);
      }
      if (hls) {
        try {
          var lv = hls.levels && hls.levels[hls.currentLevel];
          if (lv) { o.bitrate = Math.round(lv.bitrate / 1000); o.res = lv.width + 'x' + lv.height; }
        } catch (e2) {}
      }
      if (mts) {
        try {
          var mi = mts.mediaInfo;
          if (mi) { o.res = (mi.width || 0) + 'x' + (mi.height || 0); if (mi.videoDataRate) o.bitrate = Math.round(mi.videoDataRate); }
        } catch (e3) {}
      }
      return o;
    },

    /* --- ses / altyazı / kalite --- */
    audioTracks: function () {
      var out = [], i;
      if (hls && hls.audioTracks) {
        for (i = 0; i < hls.audioTracks.length; i++) {
          out.push({ id: i, name: hls.audioTracks[i].name || hls.audioTracks[i].lang || ('Ses ' + (i + 1)), active: i === hls.audioTrack });
        }
        return out;
      }
      if (video && video.audioTracks && video.audioTracks.length) {
        for (i = 0; i < video.audioTracks.length; i++) {
          out.push({ id: i, name: video.audioTracks[i].label || video.audioTracks[i].language || ('Ses ' + (i + 1)), active: !!video.audioTracks[i].enabled });
        }
      }
      return out;
    },
    setAudioTrack: function (i) {
      if (hls && hls.audioTracks && hls.audioTracks.length) { try { hls.audioTrack = i; return true; } catch (e) {} }
      if (video && video.audioTracks) {
        for (var k = 0; k < video.audioTracks.length; k++) video.audioTracks[k].enabled = (k === i);
        return true;
      }
      return false;
    },

    subtitleTracks: function () {
      var out = [], i;
      if (hls && hls.subtitleTracks && hls.subtitleTracks.length) {
        out.push({ id: -1, name: 'Kapalı', active: hls.subtitleTrack === -1 });
        for (i = 0; i < hls.subtitleTracks.length; i++) {
          out.push({ id: i, name: hls.subtitleTracks[i].name || hls.subtitleTracks[i].lang || ('Altyazı ' + (i + 1)), active: i === hls.subtitleTrack });
        }
        return out;
      }
      if (video && video.textTracks && video.textTracks.length) {
        out.push({ id: -1, name: 'Kapalı', active: true });
        for (i = 0; i < video.textTracks.length; i++) {
          if (video.textTracks[i].mode === 'showing') out[0].active = false;
          out.push({ id: i, name: video.textTracks[i].label || video.textTracks[i].language || ('Altyazı ' + (i + 1)), active: video.textTracks[i].mode === 'showing' });
        }
      }
      return out;
    },
    setSubtitleTrack: function (i) {
      if (hls && hls.subtitleTracks && hls.subtitleTracks.length) { try { hls.subtitleTrack = i; return true; } catch (e) {} }
      if (video && video.textTracks) {
        for (var k = 0; k < video.textTracks.length; k++) video.textTracks[k].mode = (k === i ? 'showing' : 'disabled');
        return true;
      }
      return false;
    },

    qualities: function () {
      var out = [], i;
      if (!hls || !hls.levels || hls.levels.length < 2) return out;
      out.push({ id: -1, name: 'Otomatik', active: hls.autoLevelEnabled });
      for (i = 0; i < hls.levels.length; i++) {
        out.push({
          id: i,
          name: (hls.levels[i].height ? hls.levels[i].height + 'p' : 'Seviye ' + (i + 1)) +
                (hls.levels[i].bitrate ? '  ' + Math.round(hls.levels[i].bitrate / 1000) + ' kbps' : ''),
          active: !hls.autoLevelEnabled && i === hls.currentLevel
        });
      }
      return out;
    },
    setQuality: function (i) {
      if (!hls) return false;
      try { hls.currentLevel = i; return true; } catch (e) { return false; }
    }
  };

  w.Player = Player;
}(window));
