/* app.js - uygulama durumu, oynatıcı arayuzu ve açılış. */
(function (w) {
  'use strict';

  var App = {
    VERSION: '1.0.1',
    channels: [],
    byId: {},
    counts: {},
    epg: new XMLTV.Epg(),
    playList: [],       /* oynaticida yukari/asagi ile gezilen liste */
    loading: 0,
    epgTimer: null,

    /* ---------------- listeler ---------------- */
    loadPlaylist: function (p, force, cb) {
      if (!p || !p.enabled) { if (cb) cb(); return; }
      var url = Playlists.m3uUrl(p);
      if (!url) { if (cb) cb(); return; }

      if (!force) {
        var cached = Cache.read(p.id, 12 * 3600000);
        if (cached) {
          App.mergeChannels(p.id, cached);
          if (cb) cb(null, cached.length);
          /* önbellekten actik; arka planda tazele */
          w.setTimeout(function () { App.loadPlaylist(p, true); }, 4000);
          return;
        }
      }

      App.loading++;
      App.bootMsg('"' + p.name + '" indiriliyor...');
      Http.text(url, { timeout: 60000 }, function (err, txt) {
        App.loading--;
        if (err) {
          UI.toast(p.name + ': ' + err.message, 5000);
          if (cb) cb(err);
          return;
        }
        var res = M3U.parse(txt, p);
        if (res.warnings.length && !res.channels.length) {
          UI.toast(p.name + ': ' + res.warnings[0], 6000);
        }
        App.mergeChannels(p.id, res.channels);
        Cache.write(p.id, res.channels);
        if (res.epgUrl && !Settings.get('epgUrl')) {
          Settings.set('epgUrl', res.epgUrl);
        }
        if (cb) cb(null, res.channels.length);
      });
    },

    mergeChannels: function (plId, list) {
      /* aynı listeden gelen eski kayitlari çıkar, yenilerini ekle */
      var out = [], i;
      for (i = 0; i < App.channels.length; i++) {
        if (App.channels[i].plId !== plId) out.push(App.channels[i]);
      }
      for (i = 0; i < list.length; i++) out.push(list[i]);
      App.channels = out;
      App.counts[plId] = list.length;
      App.reindex();
    },

    reindex: function () {
      App.byId = {};
      for (var i = 0; i < App.channels.length; i++) App.byId[App.channels[i].id] = App.channels[i];
    },

    countFor: function (plId) { return App.counts[plId] || 0; },

    refreshAll: function (force) {
      var pls = Playlists.all(), i, pending = 0, any = false;

      /* Silinen ya da kapatilan listelerin kanallarini once temizle; yoksa
         liste kaldirildiktan sonra da kanallari gorunmeye devam ediyor. */
      var live = {};
      for (i = 0; i < pls.length; i++) { if (pls[i].enabled) live[pls[i].id] = 1; }
      var kept = [];
      for (i = 0; i < App.channels.length; i++) {
        if (live[App.channels[i].plId]) kept.push(App.channels[i]);
      }
      if (kept.length !== App.channels.length) {
        App.channels = kept;
        App.reindex();
      }
      for (i = 0; i < pls.length; i++) { if (!live[pls[i].id]) App.counts[pls[i].id] = 0; }

      if (!pls.length) { App.refreshViews(); return; }
      if (force) UI.toast('Listeler yenileniyor...');
      for (i = 0; i < pls.length; i++) {
        if (!pls[i].enabled) { continue; }
        any = true;
        pending++;
        App.loadPlaylist(pls[i], force, function () {
          pending--;
          App.refreshViews();
          if (pending === 0 && force) UI.toast(App.channels.length + ' kanal hazır');
        });
      }
      if (!any) { App.channels = []; App.reindex(); App.refreshViews(); }
    },

    refreshViews: function () {
      if (Main.vG) Main.setViews();
      if (UI.current() === 'main') Main.paintDetail();
    },

    dropCaches: function () {
      var pls = Playlists.all();
      for (var i = 0; i < pls.length; i++) Cache.drop(pls[i].id);
    },

    /* ---------------- yardımcılar ---------------- */
    byIds: function (ids) {
      var out = [], i;
      for (i = 0; i < ids.length; i++) { if (App.byId[ids[i]]) out.push(App.byId[ids[i]]); }
      return out;
    },

    byNumber: function (n) {
      n = parseInt(n, 10);
      for (var i = 0; i < App.channels.length; i++) { if (App.channels[i].num === n) return App.channels[i]; }
      return null;
    },

    sorted: function (list) {
      var mode = Settings.get('sortChannels');
      if (mode === 'playlist') return list;
      var copy = list.slice(0);
      if (mode === 'name') copy.sort(function (a, b) { return a.key < b.key ? -1 : (a.key > b.key ? 1 : 0); });
      else copy.sort(function (a, b) { return a.num - b.num; });
      return copy;
    },

    isLocked: function (ch) {
      var pin = String(Settings.get('pin') || '');
      if (!pin) return false;
      var L = Settings.get('lockedGroups') || [];
      return L.indexOf(ch.group) >= 0;
    },

    askPin: function (onOk) {
      UI.input({
        title: 'PIN kodu', value: '', password: true,
        desc: 'Bu grup kilitli',
        onDone: function (v) {
          if (v === String(Settings.get('pin'))) onOk();
          else UI.toast('PIN hatalı');
        }
      });
    },

    /* ---------------- EPG ---------------- */
    loadEpg: function (force) {
      var url = String(Settings.get('epgUrl') || '').trim();
      if (!url) {
        /* Xtream hesaplarinda EPG adresi otomatik uretilebilir */
        var pls = Playlists.all();
        for (var i = 0; i < pls.length; i++) {
          if (pls[i].enabled && pls[i].type === 'xtream') { url = Playlists.xmltvUrl(pls[i]); break; }
        }
      }
      if (!url) { if (force) UI.toast('Önce bir XMLTV adresi tanımla'); return; }
      if (!force && App.epg.loadedAt && (Date.now() - App.epg.loadedAt) < 3600000) return;

      if (force) UI.toast('Yayın akışı indiriliyor...');
      var opt = { timeout: 120000 };
      if (/\.gz(\?|$)/i.test(url) && w.CAPS.gunzip) opt.responseType = 'arraybuffer';

      Http.text(url, opt, function (err, data) {
        if (err) { UI.toast('EPG: ' + err.message, 6000); return; }
        function done(txt) {
          var ids = {}, i, k;
          for (i = 0; i < App.channels.length; i++) {
            if (App.channels[i].tvgId) ids[App.channels[i].tvgId] = 1;
          }
          var useIds = null;
          for (k in ids) { if (Object.prototype.hasOwnProperty.call(ids, k)) { useIds = ids; break; } }
          var win = (Settings.get('epgWindowH') | 0) || 30;
          var res = XMLTV.parse(txt, {
            ids: useIds,
            from: Date.now() - 6 * 3600000,
            to: Date.now() + win * 3600000
          });
          App.epg.load(res);
          UI.toast(res.count + ' program yüklendi');
          if (UI.current() === 'main') { Main.vC.draw(true); Main.paintDetail(); }
        }
        if (opt.responseType) Http.maybeGunzip(data, function (e2, txt) {
          if (e2) { UI.toast(e2.message, 7000); return; }
          done(txt);
        });
        else done(data);
      });
    },

    scheduleEpg: function () {
      if (App.epgTimer) w.clearInterval(App.epgTimer);
      var h = Settings.get('epgAutoRefreshH') | 0;
      if (!h) return;
      App.epgTimer = w.setInterval(function () { App.loadEpg(true); }, h * 3600000);
    },

    /* ---------------- sürüm kontrolü ----------------
       Beş on cihazlı özel bir kurulumda asıl dert güncelleme: her TV'yi elle
       gezmek istemezsin. Uygulama depodaki version.json'a bakıp yeni sürüm
       olduğunda haber veriyor; APK bağlantısını da oradan alıyor. */
    updateInfo: null,

    checkUpdate: function (force, cb) {
      var url = String(Settings.get('updateUrl') || '').trim();
      if (!url) { if (cb) cb(new Error('Güncelleme adresi tanımlı değil')); return; }
      if (!force) {
        var last = Settings.get('lastUpdateCheck') || 0;
        if ((Date.now() - last) < 24 * 3600000) { if (cb) cb(null, App.updateInfo); return; }
      }
      Http.text(url, { timeout: 15000 }, function (err, txt) {
        Settings.set('lastUpdateCheck', Date.now());
        if (err) { if (cb) cb(err); return; }
        var info;
        try { info = JSON.parse(txt); } catch (e) { if (cb) cb(new Error('Sürüm dosyası okunamadı')); return; }
        info.newer = App.newerThan(info.version, App.VERSION);
        App.updateInfo = info;
        if (info.newer && force !== 'quiet') {
          UI.toast('Yeni sürüm var: ' + info.version, 5000);
        }
        if (cb) cb(null, info);
      });
    },

    /* "1.2.10" > "1.2.9" doğru çıksın diye parça parça sayısal karşılaştırma */
    newerThan: function (a, b) {
      var x = String(a || '').split('.'), y = String(b || '').split('.'), i, n, m;
      for (i = 0; i < Math.max(x.length, y.length); i++) {
        n = parseInt(x[i], 10) || 0;
        m = parseInt(y[i], 10) || 0;
        if (n > m) return true;
        if (n < m) return false;
      }
      return false;
    },

    testProxy: function () {
      var p = String(Settings.get('proxyUrl') || '').trim();
      if (!p) { UI.toast('Önce vekil adresini yaz'); return; }
      UI.toast('Vekil test ediliyor...');
      Http.text('http://example.com/', { forceProxy: true, timeout: 12000 }, function (err, txt) {
        if (err) {
          UI.modal({
            title: 'Vekil çalışmıyor', text: err.message + '\n\nAdresi ve sunucunun açık oldugunu kontrol et.',
            actions: [{ label: 'Kapat' }]
          });
        } else {
          UI.toast('Vekil çalışıyor (' + (txt || '').length + ' bayt)');
        }
      });
    },

    confirmExit: function () {
      UI.confirm('Çıkılsın mi?', 'NOMADS INDUSTRY IPTV kapatılacak.', function () {
        try { w.close(); } catch (e) {}
        try { if (w.tizen) w.tizen.application.getCurrentApplication().exit(); } catch (e2) {}
        UI.toast('Kumandadaki Çıkış/Home tuşunu kullan');
      });
    },

    /* ---------------- kanal numarasi ile geçiş ---------------- */
    zapBuf: '', zapTimer: null,
    zapStart: function (digit, cb) {
      App.zapBuf += digit;
      if (App.zapBuf.length > 4) App.zapBuf = digit;
      $('zapper-digits').innerHTML = esc(App.zapBuf);
      $('zapper').className = 'zapper is-on';
      if (App.zapTimer) w.clearTimeout(App.zapTimer);
      App.zapTimer = w.setTimeout(function () {
        var n = App.zapBuf;
        App.zapBuf = '';
        $('zapper').className = 'zapper';
        cb(n);
      }, Settings.get('zapDelay') || 2000);
    },
    zapCancel: function () {
      if (App.zapTimer) w.clearTimeout(App.zapTimer);
      App.zapBuf = '';
      $('zapper').className = 'zapper';
    },

    /* ---------------- kanal ac ---------------- */
    openChannel: function (ch, listOverride) {
      if (!ch) return;
      /* __unlocked: PIN bu acilis icin dogru girildi. Bayragi kontrol etmezsek
         askPin geri cagirimi tekrar kilitli kanala girer ve dongu olusur. */
      if (!ch.__unlocked && App.isLocked(ch)) {
        App.askPin(function () {
          var copy = extend({}, ch);
          copy.__unlocked = 1;
          App.openChannel(copy, listOverride);
        });
        return;
      }
      var list = listOverride;
      if (!list) {
        if (UI.current() === 'main' && Main.vC.items.length) list = Main.vC.items;
        else if (UI.current() === 'search' && Search.vR && Search.vR.items.length) list = Search.vR.items;
        else list = App.channels;
      }
      App.playList = list;
      var real = App.byId[ch.id] || ch;
      Recent.push(real.id);
      Settings.set('lastChannelId', real.id);
      PlayerUI.open(real);
    },

    bootMsg: function (m) {
      var e = $('boot-msg');
      if (e) e.innerHTML = esc(m);
    }
  };

  /* =======================================================================
     Oynatıcı ARAYUZU
     ======================================================================= */
  var PlayerUI = {
    ch: null, osdTimer: null, statTimer: null, menuOpen: false,
    menu: null, menuList: null, showStats: false,

    open: function (ch) {
      PlayerUI.ch = ch;
      UI.screen('player');
      PlayerUI.hideError();
      $('player-spinner').className = 'player-spinner is-on';
      PlayerUI.paintOsd();
      PlayerUI.showOsd();
      Player.play(ch);
      Nav.removeByName('player');
      Nav.push({ name: 'player', onKey: PlayerUI.onKey });
      if (!PlayerUI.statTimer) {
        PlayerUI.statTimer = w.setInterval(function () {
          if (UI.current() === 'player') PlayerUI.paintState();
        }, 1000);
      }
    },

    close: function () {
      Player.stop();
      PlayerUI.ch = null;
      PlayerUI.closeMenu();
      Nav.removeByName('player');
      if (PlayerUI.statTimer) { w.clearInterval(PlayerUI.statTimer); PlayerUI.statTimer = null; }
      Main.show();
      if (Main.vC) {
        Main.vC.setCurrentId(null);
      }
    },

    /* --- OSD --- */
    paintOsd: function () {
      var ch = PlayerUI.ch;
      if (!ch) return;
      $('osd-num').innerHTML = esc(ch.num);
      $('osd-name').innerHTML = esc(ch.name);
      $('osd-group').innerHTML = esc(ch.group) + (Fav.has(ch.id) ? '   ★ favori' : '');
      var img = $('osd-logo');
      if (ch.logo) { img.src = ch.logo; img.style.display = ''; }
      else { img.removeAttribute('src'); img.style.display = 'none'; }

      var r = App.epg.at(ch);
      if (r && r.now) {
        $('osd-prog').innerHTML = hhmm(new Date(r.now.s)) + ' - ' + hhmm(new Date(r.now.e)) + '  ' + esc(r.now.t) +
          (r.next ? '<span class="muted">   sonra: ' + esc(r.next.t) + '</span>' : '');
        var pct = Math.max(0, Math.min(100, ((Date.now() - r.now.s) / (r.now.e - r.now.s)) * 100));
        $('osd-progress-fill').style.width = pct.toFixed(1) + '%';
      } else {
        $('osd-prog').innerHTML = '';
        $('osd-progress-fill').style.width = '0';
      }
      PlayerUI.paintState();
    },

    paintState: function () {
      var st = Player.stats();
      var lines = [];
      lines.push(st.state === 'playing' ? 'Canlı' : (st.state === 'loading' ? 'Bağlanıyor' :
                 (st.state === 'buffering' ? 'Tampon' : (st.state === 'stalled' ? 'Donuyor' :
                 (st.state === 'paused' ? 'Duraklatildi' : st.state)))));
      if (PlayerUI.showStats) {
        lines.push(st.engine + (st.proxy ? ' + vekil' : ''));
        if (st.res && st.res !== '0x0') lines.push(st.res);
        if (st.bitrate) lines.push(st.bitrate + ' kbps');
        lines.push('tampon ' + st.buffer + ' sn');
      }
      $('osd-state').innerHTML = lines.join('<br>');
    },

    showOsd: function (ms) {
      $('osd').className = 'osd is-on';
      if (PlayerUI.osdTimer) w.clearTimeout(PlayerUI.osdTimer);
      PlayerUI.osdTimer = w.setTimeout(function () {
        $('osd').className = 'osd';
      }, ms || (Settings.get('osdSeconds') | 0) * 1000 || 6000);
    },
    hideOsd: function () {
      if (PlayerUI.osdTimer) w.clearTimeout(PlayerUI.osdTimer);
      $('osd').className = 'osd';
    },

    /* --- hata --- */
    showError: function (msg, hint) {
      $('player-spinner').className = 'player-spinner';
      $('pe-msg').innerHTML = esc(msg);
      $('pe-hint').innerHTML = hint || '';
      $('player-error').className = 'player-error is-on';
    },
    hideError: function () { $('player-error').className = 'player-error'; },

    errorHint: function () {
      var tips = [];
      var ch = PlayerUI.ch;
      var httpsPage = w.location.protocol === 'https:';
      if (httpsPage && ch && /^http:\/\//i.test(ch.url)) {
        tips.push('Sayfa https:// ile açık, yayın ise http://. Tarayıcı bunu engelliyor. ' +
                  'Uygulamayı http:// üzerinden ac (tools/server.js) ya da vekil sunucu tanımla.');
      }
      if (ch && (ch.ua || ch.referer)) {
        tips.push('Bu kanal özel User-Agent/Referer istiyor; bunu ancak vekil sunucu sağlayabilir.');
      }
      if (!w.CAPS.mse) {
        tips.push('Bu TV tarayıcısında MSE yok; sadece TV\'nin kendi çözücüsü kullanılabiliyor. ' +
                  'HLS (.m3u8) yayınları denemelisin.');
      }
      if (ch && ch.drm) tips.push('Kanal DRM korumalı görünüyor; desteklenmiyor.');
      tips.push('Kırmızı: yeniden dene   ·   Mavi: kanal bilgisi   ·   Geri: listeye dön');
      return tips.join('<br><br>');
    },

    /* --- oynatıcı menusu --- */
    openMenu: function () {
      var items = [];
      var a = Player.audioTracks(), s = Player.subtitleTracks(), q = Player.qualities(), i;
      if (q.length) {
        items.push({ name: '— Kalite —', sep: 1 });
        for (i = 0; i < q.length; i++) items.push({ name: q[i].name, active: q[i].active, act: 'q', v: q[i].id });
      }
      if (a.length > 1) {
        items.push({ name: '— Ses —', sep: 1 });
        for (i = 0; i < a.length; i++) items.push({ name: a[i].name, active: a[i].active, act: 'a', v: a[i].id });
      }
      if (s.length) {
        items.push({ name: '— Altyazı —', sep: 1 });
        for (i = 0; i < s.length; i++) items.push({ name: s[i].name, active: s[i].active, act: 's', v: s[i].id });
      }
      items.push({ name: '— Görüntü —', sep: 1 });
      items.push({ name: 'Sığdır', active: Settings.get('aspect') === 'contain', act: 'fit', v: 'contain' });
      items.push({ name: 'Doldur (kirp)', active: Settings.get('aspect') === 'cover', act: 'fit', v: 'cover' });
      items.push({ name: 'Ger', active: Settings.get('aspect') === 'fill', act: 'fit', v: 'fill' });
      items.push({ name: '— Yayın —', sep: 1 });
      items.push({ name: 'Canlıya dön', act: 'live' });
      items.push({ name: 'Yeniden bağlan', act: 'retry' });
      items.push({ name: (PlayerUI.showStats ? 'Teknik bilgiyi gizle' : 'Teknik bilgiyi göster'), act: 'stats' });

      $('pm-title').innerHTML = 'Yayın seçenekleri';
      if (!PlayerUI.menuList) {
        PlayerUI.menuList = new VList($('pm-list'), {
          rowRem: 2.6,
          render: function (it, inner) { UI.simpleRow(it, inner); },
          onSelect: function (it) { PlayerUI.menuAct(it); }
        });
      }
      PlayerUI.menuList.setItems(items);
      /* ilk secilebilir satira in */
      var k = 0;
      while (k < items.length && items[k].sep) k++;
      PlayerUI.menuList.setIndex(k);
      PlayerUI.menuList.focus(true);
      $('player-menu').className = 'player-menu is-on';
      PlayerUI.menuOpen = true;
    },

    closeMenu: function () {
      $('player-menu').className = 'player-menu';
      PlayerUI.menuOpen = false;
    },

    menuAct: function (it) {
      if (!it || it.sep) return;
      if (it.act === 'q') Player.setQuality(it.v);
      else if (it.act === 'a') Player.setAudioTrack(it.v);
      else if (it.act === 's') Player.setSubtitleTrack(it.v);
      else if (it.act === 'fit') { Settings.set('aspect', it.v); Player.setAspect(it.v); }
      else if (it.act === 'live') Player.goLive();
      else if (it.act === 'retry') { PlayerUI.hideError(); Player.retry(); }
      else if (it.act === 'stats') { PlayerUI.showStats = !PlayerUI.showStats; PlayerUI.showOsd(); }
      PlayerUI.closeMenu();
      PlayerUI.showOsd();
    },

    /* --- kanal değiştirme --- */
    step: function (d) {
      var list = App.playList && App.playList.length ? App.playList : App.channels;
      if (!list.length || !PlayerUI.ch) return;
      var i = -1, k;
      for (k = 0; k < list.length; k++) { if (list[k].id === PlayerUI.ch.id) { i = k; break; } }
      if (i < 0) i = 0;
      i = (i + d + list.length) % list.length;
      App.openChannel(list[i], list);
    },

    onKey: function (key) {
      if (PlayerUI.menuOpen) {
        if (key === 'back' || key === 'menu' || key === 'yellow') { PlayerUI.closeMenu(); return true; }
        if (key === 'up' || key === 'down' || key === 'ok' || key === 'chup' || key === 'chdown') {
          /* ayirici satırları atla */
          var L = PlayerUI.menuList;
          if (key === 'up' || key === 'down') {
            var d = key === 'up' ? -1 : 1, i = L.index + d;
            while (i >= 0 && i < L.items.length && L.items[i].sep) i += d;
            if (i >= 0 && i < L.items.length) L.setIndex(i);
            return true;
          }
          L.handleKey(key);
          return true;
        }
        return true;
      }

      switch (key) {
        case 'back':
          PlayerUI.close();
          return true;
        case 'ok':
          if (Player.state() === 'blocked') { Player.togglePause(); return true; }
          if ($('osd').className.indexOf('is-on') >= 0) PlayerUI.hideOsd();
          else { PlayerUI.paintOsd(); PlayerUI.showOsd(); }
          return true;
        case 'info':
          PlayerUI.paintOsd(); PlayerUI.showOsd(12000); return true;
        case 'up': case 'chup':
          PlayerUI.step(-1); return true;
        case 'down': case 'chdown':
          PlayerUI.step(1); return true;
        case 'left':
          PlayerUI.seek(-30); return true;
        case 'right':
          PlayerUI.seek(30); return true;
        case 'rew':
          PlayerUI.seek(-300); return true;
        case 'ffwd':
          PlayerUI.seek(300); return true;
        case 'playpause': case 'play': case 'pause':
          Player.togglePause(); PlayerUI.showOsd(); return true;
        case 'stop':
          PlayerUI.close(); return true;
        case 'red':
          if (Player.state() === 'error') { PlayerUI.hideError(); Player.retry(); return true; }
          if (PlayerUI.ch) {
            var added = Fav.toggle(PlayerUI.ch.id);
            UI.toast(added ? 'Favorilere eklendi' : 'Favorilerden çıkarıldı');
            PlayerUI.paintOsd(); PlayerUI.showOsd();
          }
          return true;
        case 'green':
          var order = ['contain', 'cover', 'fill'];
          var names = { contain: 'Sığdır', cover: 'Doldur', fill: 'Ger' };
          var cur = Settings.get('aspect');
          var nx = order[(order.indexOf(cur) + 1) % order.length];
          Settings.set('aspect', nx);
          Player.setAspect(nx);
          UI.toast('Görüntü: ' + names[nx]);
          return true;
        case 'yellow': case 'menu':
          PlayerUI.openMenu(); return true;
        case 'blue':
          PlayerUI.showStats = !PlayerUI.showStats;
          PlayerUI.paintOsd(); PlayerUI.showOsd();
          return true;
        case 'guide':
          Player.stop(); Nav.removeByName('player'); Main.show(); Guide.show(); return true;
      }
      if (key.length === 2 && key.charAt(0) === 'd') {
        App.zapStart(key.charAt(1), function (n) {
          var ch = App.byNumber(n);
          if (ch) App.openChannel(ch);
          else UI.toast(n + ' numaralı kanal yok');
        });
        return true;
      }
      return true;
    },

    seek: function (sec) {
      var v = $('video');
      if (!v) return;
      var seekable = false;
      try { seekable = v.seekable && v.seekable.length && (v.seekable.end(0) - v.seekable.start(0)) > 60; } catch (e) {}
      if (!seekable) {
        /* canlı yayında ileri/geri yok: bilgi cubugunu göster */
        PlayerUI.paintOsd();
        PlayerUI.showOsd();
        return;
      }
      try { v.currentTime = Math.max(0, (v.currentTime || 0) + sec); } catch (e2) {}
      PlayerUI.showOsd();
    },

    onState: function (st, info) {
      var sp = $('player-spinner');
      if (st === 'loading' || st === 'buffering' || st === 'stalled') sp.className = 'player-spinner is-on';
      else sp.className = 'player-spinner';

      if (st === 'playing') {
        PlayerUI.hideError();
        if (Main.vC) Main.vC.setCurrentId(PlayerUI.ch ? PlayerUI.ch.id : null);
      }
      if (st === 'error') {
        PlayerUI.showError(info.message || 'Bilinmeyen hata', PlayerUI.errorHint());
      }
      if (st === 'blocked') {
        PlayerUI.showError(info.message, 'OK tuşuna basarak başlatabilirsin.');
      }
      if (st === 'warn') { UI.toast(info.message, 6000); return; }
      PlayerUI.paintState();
    }
  };

  /* =======================================================================
     ILK Kurulum
     ======================================================================= */
  var Setup = {
    sel: 0,
    items: [
      { name: 'Türkiye paketini kur', desc: 'Hemen başla — 208 kanal, açık katalogdan derlendi' },
      { name: 'Dünya paketini kur', desc: '175 ülke, 10.476 kanal' },
      { name: 'M3U adresi ekle', desc: 'Sağlayıcından ya da kendi sunucundan aldığın .m3u / .m3u8 bağlantısı' },
      { name: 'Xtream Codes hesabı ekle', desc: 'Sunucu adresi + kullanıcı adı + şifre' },
      { name: 'Bu kanallar nereden geliyor?', desc: 'Kısa açıklama' }
    ],

    show: function () {
      UI.screen('setup');
      Setup.paint();
      Nav.removeByName('setup');
      Nav.push({ name: 'setup', onKey: Setup.onKey });
    },

    paint: function () {
      var html = '', i;
      for (i = 0; i < Setup.items.length; i++) {
        html += '<div class="fld' + (i === Setup.sel ? ' is-focused' : '') + '" data-i="' + i + '">' +
                '<div class="fld-l"><div class="fld-name">' + esc(Setup.items[i].name) + '</div>' +
                '<div class="fld-desc">' + esc(Setup.items[i].desc) + '</div></div></div>';
      }
      $('setup-form').innerHTML = html;
      $('setup-form').onclick = function (e) {
        var n = e.target;
        while (n && (!n.getAttribute || n.getAttribute('data-i') == null)) n = n.parentNode;
        if (n) { Setup.sel = +n.getAttribute('data-i'); Setup.paint(); Setup.go(); }
      };
    },

    go: function () {
      if (Setup.sel === 0) { SettingsScreen.addBundled('turkiye'); Setup.afterAdd(); }
      else if (Setup.sel === 1) { SettingsScreen.addBundled('dunya'); Setup.afterAdd(); }
      else if (Setup.sel === 2) SettingsScreen.addM3U();
      else if (Setup.sel === 3) SettingsScreen.addXtream();
      else {
        UI.modal({
          title: 'Yasal kanal listesi nereden gelir?',
          html:
            '<p><b>1. Kendi medya sunucun.</b> Jellyfin, Plex, TVHeadend ya da bir DVB-T2/uydu kartıyla ' +
            'kurduğun sunucu M3U çıktısı verir. En temiz yol budur.</p>' +
            '<p style="margin-top:.7rem"><b>2. Yayıncıların resmi ücretsiz akışları.</b> Birçok kanal kendi ' +
            'sitesinde herkese açık HLS yayını sunar; bu adresleri kendi M3U dosyanda toplayabilirsin.</p>' +
            '<p style="margin-top:.7rem"><b>3. Açık dizinler.</b> iptv-org gibi projeler herkese açık yayınları ' +
            'listeler. Kullanmadan önce kendi ülkendeki durumunu kontrol et.</p>' +
            '<p style="margin-top:.7rem"><b>4. Ödediğin abonelik.</b> Sağlayıcın sana bir M3U bağlantısı ya da ' +
            'Xtream bilgileri verir; ikisini de bu uygulama destekler.</p>' +
            '<p style="margin-top:.9rem" class="muted">Uygulamayla gelen Türkiye ve Dünya paketleri ' +
            'iptv-org açık kataloğundan derlenmiştir: yayıncıların herkese açık akışları. Şifreli/ücretli ' +
            'kanalların korsan bağlantılarını içermez ve içeremez.</p>',
          actions: [{ label: 'Anladim' }]
        });
      }
    },

    /* paket kurulunca kurulum ekranından ana ekrana geç */
    afterAdd: function () {
      var tries = 0;
      var t = w.setInterval(function () {
        tries++;
        if (App.channels.length) {
          w.clearInterval(t);
          Nav.removeByName('setup');
          Main.setViews();
          Main.show();
        } else if (tries > 60) {
          w.clearInterval(t);
        }
      }, 500);
    },

    onKey: function (key) {
      if (key === 'up') { Setup.sel = (Setup.sel + Setup.items.length - 1) % Setup.items.length; Setup.paint(); return true; }
      if (key === 'down') { Setup.sel = (Setup.sel + 1) % Setup.items.length; Setup.paint(); return true; }
      if (key === 'ok') { Setup.go(); return true; }
      if (key === 'back') { if (Playlists.all().length) { Main.show(); Nav.removeByName('setup'); } return true; }
      return true;
    }
  };

  /* =======================================================================
     Açılış
     ======================================================================= */
  function tickClock() {
    var t = hhmm(new Date());
    var c = $('clock'); if (c) c.innerHTML = t;
    var g = $('guide-clock'); if (g) g.innerHTML = t;
    if (UI.current() === 'main') Main.paintDetail();
    if (UI.current() === 'player' && $('osd').className.indexOf('is-on') >= 0) PlayerUI.paintOsd();
  }

  function boot() {
    var fill = $('boot-bar-fill');
    function prog(p, msg) {
      if (fill) fill.style.width = p + '%';
      App.bootMsg(msg);
    }

    prog(10, 'Arayüz hazırlanıyor...');
    UI.applyScale();
    Nav.init();

    /* hiçbir ekran tuşu yutulmasin diye en altta bir "yakalayici" baglam */
    Nav.push({ name: 'root', onKey: function () { return true; } });

    prog(25, 'Yayın motorları yükleniyor...');
    Player.init($('video'), { onState: PlayerUI.onState, onTracks: function () {} });

    prog(45, 'Ekranlar kuruluyor...');
    Main.build();

    prog(60, 'Listeler okunuyor...');
    var pls = Playlists.all();
    if (!pls.length) {
      prog(100, 'Hazır');
      w.setTimeout(function () { Setup.show(); }, 200);
    } else {
      var pending = pls.length;
      var finished = false;
      function ready() {
        if (finished) return;
        finished = true;
        prog(100, 'Hazır');
        Main.setViews();
        Main.show();
        if (Settings.get('autoplayLast')) {
          var id = Settings.get('lastChannelId');
          if (id && App.byId[id]) w.setTimeout(function () { App.openChannel(App.byId[id]); }, 400);
        }
        App.loadEpg(false);
        App.scheduleEpg();
        w.setTimeout(function () { App.checkUpdate(false); }, 6000);
      }
      for (var i = 0; i < pls.length; i++) {
        App.loadPlaylist(pls[i], false, function () {
          pending--;
          prog(60 + (pls.length - pending) * (35 / pls.length), 'Kanallar hazırlanıyor...');
          if (pending <= 0) ready();
        });
      }
      /* ağ çok yavassa da uygulamayı acmis olalim */
      w.setTimeout(ready, 20000);
    }

    w.setInterval(tickClock, 15000);
    tickClock();

    if (w.addEventListener) {
      var rt = null;
      w.addEventListener('resize', function () {
        if (rt) w.clearTimeout(rt);
        rt = w.setTimeout(function () {
          UI.applyScale();
          if (Main.vG) { Main.vG.relayout(); Main.vC.relayout(); }
          if (UI.current() === 'guide') Guide.draw();
        }, 250);
      }, false);
      w.addEventListener('online', function () { $('net-pill').setAttribute('hidden', 'hidden'); }, false);
      w.addEventListener('offline', function () { $('net-pill').removeAttribute('hidden'); }, false);
    }

    /* servis çalışanı: uygulama dosyalari önbelleğe alinsin, açılış hizlansin */
    if (navigator.serviceWorker && w.location.protocol.indexOf('http') === 0) {
      try { navigator.serviceWorker.register('sw.js'); } catch (e) {}
    }
  }

  w.App = App;
  w.PlayerUI = PlayerUI;
  w.Setup = Setup;

  if (document.readyState === 'complete' || document.readyState === 'interactive') w.setTimeout(boot, 0);
  else if (w.addEventListener) w.addEventListener('DOMContentLoaded', boot, false);
  else w.onload = boot;
}(window));
