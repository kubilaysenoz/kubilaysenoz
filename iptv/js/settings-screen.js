/* settings-screen.js - ayarlar ekrani ve liste yönetimi.
   Alanlar bir semadan uretilir; böylece yeni ayar eklemek tek satır. */
(function (w) {
  'use strict';

  var SettingsScreen = {
    section: 0, panel: 0, fI: 0, offset: 0, fields: [],
    sections: [
      { id: 'lists', name: 'Kanal listeleri' },
      { id: 'epg', name: 'Yayın akışı (EPG)' },
      { id: 'play', name: 'Oynatma' },
      { id: 'view', name: 'Görüntü ve arayüz' },
      { id: 'net', name: 'Ağ ve vekil sunucu' },
      { id: 'lock', name: 'Ebeveyn kilidi' },
      { id: 'about', name: 'Hakkında ve tanı' }
    ],

    show: function (sectionId) {
      UI.screen('settings');
      if (sectionId) {
        for (var i = 0; i < SettingsScreen.sections.length; i++) {
          if (SettingsScreen.sections[i].id === sectionId) { SettingsScreen.section = i; break; }
        }
        SettingsScreen.panel = 1;
        SettingsScreen.fI = 0;
      }
      UI.hints('settings-hint', [['OK', 'Seç / değiştir'], ['◀ ▶', 'Değer'], ['Geri', 'Çık']]);
      SettingsScreen.paint();
      Nav.removeByName('settings');
      Nav.push({ name: 'settings', onKey: SettingsScreen.onKey });
    },

    paint: function () {
      var html = '', i;
      for (i = 0; i < SettingsScreen.sections.length; i++) {
        html += '<div class="snav' + (i === SettingsScreen.section ? ' is-current' : '') +
                (SettingsScreen.panel === 0 && i === SettingsScreen.section ? ' is-focused' : '') +
                '" data-i="' + i + '">' + esc(SettingsScreen.sections[i].name) + '</div>';
      }
      $('settings-nav').innerHTML = html;
      $('settings-nav').onclick = function (e) {
        var n = e.target;
        if (n && n.getAttribute && n.getAttribute('data-i') != null) {
          SettingsScreen.section = +n.getAttribute('data-i');
          SettingsScreen.fI = 0; SettingsScreen.offset = 0; SettingsScreen.panel = 1;
          SettingsScreen.paint();
        }
      };
      SettingsScreen.fields = SettingsScreen.build(SettingsScreen.sections[SettingsScreen.section].id);
      SettingsScreen.paintFields();
    },

    paintFields: function () {
      var f = SettingsScreen.fields, i, html = '';
      for (i = 0; i < f.length; i++) {
        if (f[i].type === 'sep') { html += '<div class="fld-sep">' + esc(f[i].name) + '</div>'; continue; }
        html += '<div class="fld' + (f[i].cls ? ' ' + f[i].cls : '') +
                (SettingsScreen.panel === 1 && i === SettingsScreen.fI ? ' is-focused' : '') +
                '" data-i="' + i + '"><div class="fld-l"><div class="fld-name">' + esc(f[i].name) + '</div>' +
                (f[i].desc ? '<div class="fld-desc">' + esc(f[i].desc) + '</div>' : '') +
                '</div><div class="fld-v">' + esc(SettingsScreen.valueText(f[i])) + '</div></div>';
      }
      $('settings-body').innerHTML =
        '<div class="settings-scroll"><div class="settings-track">' + html + '</div></div>';

      /* seçili alani görünür tut */
      var scroll = $('settings-body').getElementsByClassName('settings-scroll')[0];
      var track = $('settings-body').getElementsByClassName('settings-track')[0];
      var nodes = track.getElementsByClassName('fld');
      var target = null;
      for (i = 0; i < nodes.length; i++) {
        if (+nodes[i].getAttribute('data-i') === SettingsScreen.fI) { target = nodes[i]; break; }
      }
      if (target && SettingsScreen.panel === 1) {
        var top = target.offsetTop, h = target.offsetHeight, viewH = scroll.clientHeight;
        if (top < SettingsScreen.offset) SettingsScreen.offset = top;
        if (top + h > SettingsScreen.offset + viewH) SettingsScreen.offset = top + h - viewH;
        if (SettingsScreen.offset < 0) SettingsScreen.offset = 0;
      }
      setY(track, -SettingsScreen.offset);

      track.onclick = function (e) {
        var n = e.target;
        while (n && n !== track && (!n.getAttribute || n.getAttribute('data-i') == null)) n = n.parentNode;
        if (n && n.getAttribute && n.getAttribute('data-i') != null) {
          SettingsScreen.panel = 1;
          SettingsScreen.fI = +n.getAttribute('data-i');
          SettingsScreen.paintFields();
          SettingsScreen.activate();
        }
      };
    },

    valueText: function (f) {
      if (f.type === 'toggle') return Settings.get(f.key) ? 'Açık' : 'Kapalı';
      if (f.type === 'choice') {
        var v = Settings.get(f.key);
        for (var i = 0; i < f.opts.length; i++) { if (f.opts[i][0] === v) return f.opts[i][1]; }
        return String(v);
      }
      if (f.type === 'num') return Settings.get(f.key) + (f.unit || '');
      if (f.type === 'text') {
        var t = String(Settings.get(f.key) || '');
        if (f.password && t) return new Array(Math.min(t.length, 12) + 1).join('*');
        return t || '(boş)';
      }
      return f.value || '';
    },

    /* ---------------- sema ---------------- */
    build: function (id) {
      var f = [];
      var pls, i, p;

      if (id === 'lists') {
        pls = Playlists.all();
        f.push({ type: 'sep', name: 'Tanımlı listeler (' + pls.length + ')' });
        for (i = 0; i < pls.length; i++) {
          p = pls[i];
          var n = App.countFor(p.id);
          f.push({
            type: 'action', name: (p.enabled ? '' : '[kapalı] ') + p.name,
            desc: (p.type === 'xtream' ? 'Xtream: ' + p.host : p.url),
            value: n + ' kanal',
            fn: (function (pl) { return function () { SettingsScreen.editPlaylist(pl); }; }(p))
          });
        }
        if (!pls.length) f.push({ type: 'action', name: 'Henüz liste yok', desc: 'Aşağıdan ekleyebilirsin', value: '', fn: function () {} });
        f.push({ type: 'sep', name: 'İşlemler' });
        f.push({ type: 'action', cls: 'fld-btn', name: '+ M3U adresi ekle', desc: 'http(s):// ile başlayan .m3u / .m3u8 adresi', fn: function () { SettingsScreen.addM3U(); } });
        f.push({ type: 'action', cls: 'fld-btn', name: '+ Xtream Codes hesabı ekle', desc: 'Sunucu, kullanıcı adı ve şifre ile', fn: function () { SettingsScreen.addXtream(); } });
        f.push({ type: 'action', cls: 'fld-btn', name: 'Tüm listeleri yenile', desc: 'Önbelleği atlayıp yeniden indirir', fn: function () { App.refreshAll(true); } });

      } else if (id === 'epg') {
        f.push({ type: 'sep', name: 'Kaynak' });
        f.push({ type: 'text', key: 'epgUrl', name: 'XMLTV adresi', mode: 'url',
                 desc: 'Boş bırakırsan liste içindeki url-tvg adresi kullanılır' });
        f.push({ type: 'num', key: 'epgWindowH', name: 'Zaman penceresi', unit: ' saat', min: 6, max: 72, step: 6,
                 desc: 'Belleğe alınacak süre. TV yavaşlarsa düşür.' });
        f.push({ type: 'num', key: 'epgAutoRefreshH', name: 'Otomatik yenileme', unit: ' saat', min: 0, max: 48, step: 2,
                 desc: '0 = kapalı' });
        f.push({ type: 'sep', name: 'Durum' });
        f.push({ type: 'action', name: 'Yüklü program sayısı', value: String(App.epg.count),
                 desc: App.epg.loadedAt ? 'Son yükleme ' + UI.when(App.epg.loadedAt) : 'Henüz yüklenmedi', fn: function () {} });
        f.push({ type: 'action', cls: 'fld-btn', name: 'Şimdi yükle', desc: 'XMLTV dosyasını indirip çözümler', fn: function () { App.loadEpg(true); } });
        f.push({ type: 'action', cls: 'fld-btn', name: 'Bellekten temizle', fn: function () { App.epg.clear(); UI.toast('EPG temizlendi'); SettingsScreen.paint(); } });

      } else if (id === 'play') {
        f.push({ type: 'sep', name: 'Motor' });
        f.push({ type: 'choice', key: 'engine', name: 'Yayın motoru',
                 desc: 'Otomatik: TV çözücüsü -> hls.js -> mpegts.js sırasıyla dener',
                 opts: [['auto', 'Otomatik'], ['native', 'Sadece TV çözücüsü'], ['hlsjs', 'Sadece hls.js'], ['mpegts', 'Sadece mpegts.js']] });
        f.push({ type: 'toggle', key: 'lowLatency', name: 'Düşük gecikme',
                 desc: 'Canlı yayına daha yakin kalır; zayıf bağlantıda donmaya yol açabilir' });
        f.push({ type: 'num', key: 'bufferSec', name: 'Tampon', unit: ' sn', min: 4, max: 120, step: 2,
                 desc: 'Yüksek değer = daha az donma, daha yüksek gecikme' });
        f.push({ type: 'sep', name: 'Kurtarma' });
        f.push({ type: 'num', key: 'retryMax', name: 'Yeniden deneme', unit: ' kez', min: 0, max: 15, step: 1 });
        f.push({ type: 'num', key: 'stallTimeout', name: 'Donma zaman aşımı', unit: ' sn', min: 5, max: 60, step: 1,
                 desc: 'Görüntü bu süre ilerlemezse yeniden bağlanır' });
        f.push({ type: 'sep', name: 'Başlangıç' });
        f.push({ type: 'toggle', key: 'autoplayLast', name: 'Açılışta son kanalı başlat' });
        f.push({ type: 'action', cls: 'fld-btn', name: 'Motor hafızasını sıfırla',
                 desc: 'Hangi sunucuda hangi motorun çalıştığı unutulur',
                 fn: function () { EngineMemo.clear(); UI.toast('Motor hafızası sıfırlandı'); } });

      } else if (id === 'view') {
        f.push({ type: 'sep', name: 'Ekran' });
        f.push({ type: 'num', key: 'uiScale', name: 'Arayüz boyutu', unit: ' %', min: 70, max: 160, step: 5,
                 desc: 'Yazılar küçük geliyorsa arttır', after: function () { UI.applyScale(); } });
        f.push({ type: 'num', key: 'safeArea', name: 'Kenar payı (overscan)', unit: ' %', min: 0, max: 10, step: 1,
                 desc: 'Kenarlar ekran dışında kalıyorsa arttır',
                 after: function () { UI.applyScale(); UI.showSafeGuide(true); w.setTimeout(function () { UI.showSafeGuide(false); }, 1500); } });
        f.push({ type: 'choice', key: 'aspect', name: 'Görüntü oranı',
                 opts: [['contain', 'Sığdır (oranı koru)'], ['cover', 'Doldur (kirp)'], ['fill', 'Ger (oranı boz)']],
                 after: function () { Player.setAspect(Settings.get('aspect')); } });
        f.push({ type: 'sep', name: 'Listeler' });
        f.push({ type: 'choice', key: 'sortChannels', name: 'Kanal sıralaması',
                 opts: [['playlist', 'Liste sırası'], ['name', 'İsme göre'], ['number', 'Numaraya göre']] });
        f.push({ type: 'toggle', key: 'hideEmptyGroups', name: 'Boş grupları gizle' });
        f.push({ type: 'num', key: 'osdSeconds', name: 'Kanal bilgisi süresi', unit: ' sn', min: 2, max: 20, step: 1,
                 desc: 'Kanal değiştirince ustte kalma süresi' });

      } else if (id === 'net') {
        f.push({ type: 'sep', name: 'Vekil sunucu' });
        f.push({ type: 'text', key: 'proxyUrl', name: 'Vekil adresi', mode: 'url',
                 desc: 'Örnek: http://192.168.1.20:8080/proxy?url=   (tools/server.js)' });
        f.push({ type: 'toggle', key: 'proxyAlways', name: 'Her zaman vekil kullan',
                 desc: 'Kapalıyken sadece gerektiğinde (CORS / karışık içerik / özel başlık)' });
        f.push({ type: 'action', cls: 'fld-btn', name: 'Vekili test et', fn: function () { App.testProxy(); } });
        f.push({ type: 'sep', name: 'Neden gerekli olabilir?' });
        f.push({ type: 'action', name: 'Açıklamayı göster', fn: function () {
          UI.modal({
            title: 'Vekil sunucu ne ise yarar?',
            html: '<p>Üç sorunu aynı anda çözer:</p>' +
                  '<p style="margin-top:.6rem"><b>1. Karışık içerik.</b> Sayfa https:// ile açıksa tarayıcı http:// ' +
                  'yayınları engeller. Vekil, yayını sayfayla aynı protokole taşır.</p>' +
                  '<p style="margin-top:.6rem"><b>2. CORS.</b> hls.js ve mpegts.js yayını XHR ile çeker; sunucu ' +
                  'izin başlığı vermezse tarayıcı reddeder. Vekil bu başlığı ekler.</p>' +
                  '<p style="margin-top:.6rem"><b>3. Özel başlıklar.</b> Bazı kaynaklar belirli bir User-Agent ya da ' +
                  'Referer bekler. Tarayıcı bunlari değiştiremez, vekil değiştirebilir.</p>' +
                  '<p style="margin-top:.6rem" class="muted">Depodaki tools/server.js dosyasını bilgisayarında ya da ' +
                  'Raspberry Pi üzerinde çalıştırman yeterli.</p>',
            actions: [{ label: 'Kapat' }]
          });
        } });

      } else if (id === 'lock') {
        f.push({ type: 'sep', name: 'PIN' });
        f.push({ type: 'text', key: 'pin', name: 'PIN kodu', password: true,
                 desc: 'Boş bırakırsan kilit kapalıdır. Bu PIN cihazda düz metin saklanır; ' +
                       'güvenlik değil, kolay engel amaçlıdır.' });
        f.push({ type: 'sep', name: 'Kilitli gruplar' });
        var locked = Settings.get('lockedGroups') || [];
        var groups = M3U.groupsOf(App.channels, true);
        if (!groups.length) f.push({ type: 'action', name: 'Önce bir kanal listesi ekle', fn: function () {} });
        for (i = 0; i < groups.length && i < 200; i++) {
          f.push({
            type: 'action', name: groups[i].name,
            value: locked.indexOf(groups[i].name) >= 0 ? 'Kilitli' : 'Açık',
            fn: (function (name) {
              return function () {
                var L = Settings.get('lockedGroups') || [];
                var k = L.indexOf(name);
                if (k >= 0) L.splice(k, 1); else L.push(name);
                Settings.set('lockedGroups', L);
                SettingsScreen.paint();
              };
            }(groups[i].name))
          });
        }

      } else if (id === 'about') {
        var C = w.CAPS;
        f.push({ type: 'sep', name: 'Uygulama' });
        f.push({ type: 'action', name: 'TakIR TV', value: App.VERSION, desc: 'Kumanda ile kullanılan M3U/Xtream oynatıcı', fn: function () {} });
        f.push({ type: 'action', name: 'Toplam kanal', value: String(App.channels.length), fn: function () {} });
        f.push({ type: 'action', name: 'Depolama kullanımı', value: UI.bytes(Store.usage()), fn: function () {} });
        f.push({ type: 'sep', name: 'Bu TV neyi destekliyor?' });
        f.push({ type: 'action', name: 'MSE (hls.js / mpegts.js)', value: C.mse ? 'Var' : 'Yok', fn: function () {} });
        f.push({ type: 'action', name: 'Yerleşik HLS (.m3u8)', value: C.nativeHls ? 'Var' : 'Yok', fn: function () {} });
        f.push({ type: 'action', name: 'Yerleşik MPEG-TS', value: C.nativeTs ? 'Var' : 'Yok', fn: function () {} });
        f.push({ type: 'action', name: 'hls.js', value: C.hlsjs ? 'Hazır' : 'Kullanilamiyor', fn: function () {} });
        f.push({ type: 'action', name: 'mpegts.js', value: C.mpegtsjs ? 'Hazır' : 'Kullanilamiyor', fn: function () {} });
        f.push({ type: 'action', name: 'Kalıcı depolama', value: C.storage ? 'Var' : 'Yok (ayarlar kaydedilmez)', fn: function () {} });
        f.push({ type: 'action', name: 'Gzip açma (.gz EPG)', value: C.gunzip ? 'Var' : 'Yok', fn: function () {} });
        f.push({ type: 'action', name: 'Ekran', value: (w.innerWidth || 0) + 'x' + (w.innerHeight || 0), fn: function () {} });
        f.push({ type: 'action', name: 'Tarayıcı', value: (navigator.userAgent || '').substring(0, 40), fn: function () {} });
        f.push({ type: 'sep', name: 'Bakim' });
        f.push({ type: 'action', cls: 'fld-btn', name: 'Önbelleği temizle', desc: 'Listeler yeniden indirilir',
                 fn: function () { App.dropCaches(); UI.toast('Önbellek temizlendi'); } });
        f.push({ type: 'action', cls: 'fld-danger', name: 'Her şeyi sıfırla',
                 desc: 'Listeler, favoriler ve ayarlar silinir',
                 fn: function () {
                   UI.confirm('Emin misin?', 'Tüm listeler, favoriler ve ayarlar silinecek.',
                     function () { Store.clearAll(); w.location.reload(); }, { dangerous: true, yes: 'Sil' });
                 } });
      }
      return f;
    },

    /* ---------------- alan etkileşimi ---------------- */
    activate: function () {
      var f = SettingsScreen.fields[SettingsScreen.fI];
      if (!f) return;
      if (f.type === 'toggle') {
        Settings.set(f.key, !Settings.get(f.key));
        if (f.after) f.after();
        SettingsScreen.paintFields();
      } else if (f.type === 'choice') {
        SettingsScreen.step(1);
      } else if (f.type === 'text') {
        UI.input({
          title: f.name, value: String(Settings.get(f.key) || ''), mode: f.mode,
          password: f.password, desc: f.desc,
          onDone: function (v) {
            Settings.set(f.key, v.trim());
            if (f.after) f.after();
            SettingsScreen.paint();
            UI.toast('Kaydedildi');
          }
        });
      } else if (f.type === 'action' && f.fn) {
        f.fn();
      }
    },

    step: function (dir) {
      var f = SettingsScreen.fields[SettingsScreen.fI];
      if (!f) return false;
      if (f.type === 'num') {
        var v = (Settings.get(f.key) | 0) + dir * (f.step || 1);
        if (v < f.min) v = f.min;
        if (v > f.max) v = f.max;
        Settings.set(f.key, v);
        if (f.after) f.after();
        SettingsScreen.paintFields();
        return true;
      }
      if (f.type === 'choice') {
        var cur = Settings.get(f.key), i, k = 0;
        for (i = 0; i < f.opts.length; i++) { if (f.opts[i][0] === cur) { k = i; break; } }
        k = (k + dir + f.opts.length) % f.opts.length;
        Settings.set(f.key, f.opts[k][0]);
        if (f.after) f.after();
        SettingsScreen.paintFields();
        return true;
      }
      if (f.type === 'toggle') {
        Settings.set(f.key, dir > 0);
        if (f.after) f.after();
        SettingsScreen.paintFields();
        return true;
      }
      return false;
    },

    moveField: function (dir) {
      var f = SettingsScreen.fields, i = SettingsScreen.fI + dir;
      while (i >= 0 && i < f.length && f[i].type === 'sep') i += dir;
      if (i < 0 || i >= f.length) return;
      SettingsScreen.fI = i;
      SettingsScreen.paintFields();
    },

    onKey: function (key) {
      if (key === 'back') {
        if (SettingsScreen.panel === 1) { SettingsScreen.panel = 0; SettingsScreen.paint(); return true; }
        Nav.removeByName('settings');
        Main.show();
        App.refreshViews();
        return true;
      }
      if (SettingsScreen.panel === 0) {
        if (key === 'up') { SettingsScreen.section = (SettingsScreen.section + SettingsScreen.sections.length - 1) % SettingsScreen.sections.length; SettingsScreen.fI = 0; SettingsScreen.offset = 0; SettingsScreen.paint(); return true; }
        if (key === 'down') { SettingsScreen.section = (SettingsScreen.section + 1) % SettingsScreen.sections.length; SettingsScreen.fI = 0; SettingsScreen.offset = 0; SettingsScreen.paint(); return true; }
        if (key === 'right' || key === 'ok') {
          SettingsScreen.panel = 1;
          SettingsScreen.fI = 0;
          if (SettingsScreen.fields[0] && SettingsScreen.fields[0].type === 'sep') SettingsScreen.moveField(1);
          SettingsScreen.paintFields();
          return true;
        }
        return true;
      }
      if (key === 'up') { SettingsScreen.moveField(-1); return true; }
      if (key === 'down') { SettingsScreen.moveField(1); return true; }
      if (key === 'left') { if (!SettingsScreen.step(-1)) { SettingsScreen.panel = 0; SettingsScreen.paint(); } return true; }
      if (key === 'right') { SettingsScreen.step(1); return true; }
      if (key === 'ok') { SettingsScreen.activate(); return true; }
      return true;
    },

    /* ---------------- liste ekleme / duzenleme ---------------- */
    addM3U: function () {
      UI.input({
        title: 'Liste adı', value: '', desc: 'Örnek: Ana liste',
        onDone: function (name) {
          UI.input({
            title: 'M3U adresi', value: 'http://', mode: 'url',
            desc: '.m3u ya da .m3u8 uzantılı tam adres',
            onDone: function (url) {
              url = url.trim();
              if (!/^https?:\/\/.+/i.test(url)) { UI.toast('Adres http:// ya da https:// ile başlamalı'); return; }
              var p = Playlists.add({ name: name.trim() || 'Liste', type: 'm3u', url: url });
              UI.toast('Eklendi, indiriliyor...');
              App.loadPlaylist(p, true, function () { SettingsScreen.paint(); App.refreshViews(); });
            }
          });
        }
      });
    },

    addXtream: function () {
      UI.input({
        title: 'Sunucu adresi', value: 'http://', mode: 'url',
        desc: 'Örnek: http://örnek-sunucu.com:8080  (get.php kısmını yazma)',
        onDone: function (host) {
          UI.input({
            title: 'Kullanıcı adı', value: '',
            onDone: function (user) {
              UI.input({
                title: 'Şifre', value: '', password: false,
                desc: 'Şifre bu cihazda düz metin olarak saklanır',
                onDone: function (pass) {
                  var p = Playlists.add({
                    name: 'Xtream: ' + String(host).replace(/^https?:\/\//, '').split(':')[0],
                    type: 'xtream', host: host.trim(), user: user.trim(), pass: pass.trim(), output: 'ts'
                  });
                  UI.toast('Eklendi, indiriliyor...');
                  App.loadPlaylist(p, true, function () { SettingsScreen.paint(); App.refreshViews(); });
                }
              });
            }
          });
        }
      });
    },

    editPlaylist: function (p) {
      UI.modal({
        title: p.name,
        html: '<div class="fld-desc">Adres</div><div style="word-break:break-all;font-size:.85rem">' +
              esc(p.type === 'xtream' ? Playlists.m3uUrl(p).replace(/password=[^&]*/, 'password=***') : p.url) + '</div>' +
              '<div class="fld-desc" style="margin-top:.6rem">Kanal sayısı</div><div>' + App.countFor(p.id) + '</div>',
        actions: [
          { label: 'Yenile', fn: function () { App.loadPlaylist(p, true, function () { SettingsScreen.paint(); App.refreshViews(); }); } },
          { label: p.enabled ? 'Kapat' : 'Aç', fn: function () {
              Playlists.update(p.id, { enabled: !p.enabled });
              App.refreshAll(false);
              SettingsScreen.paint();
            } },
          { label: 'Yeniden adlandır', fn: function () {
              UI.input({ title: 'Liste adı', value: p.name, onDone: function (v) {
                Playlists.update(p.id, { name: v.trim() || p.name });
                SettingsScreen.paint();
              } });
            } },
          { label: 'Sil', cls: 'danger', fn: function () {
              UI.confirm('Liste silinsin mi?', p.name + ' ve içindeki kanallar kaldırılacak.',
                function () {
                  Playlists.remove(p.id);
                  App.refreshAll(false);
                  SettingsScreen.paint();
                  UI.toast('Silindi');
                }, { dangerous: true, yes: 'Sil' });
            } },
          { label: 'Kapat' }
        ]
      });
    }
  };

  w.SettingsScreen = SettingsScreen;
}(window));
