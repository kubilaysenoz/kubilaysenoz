/* screens.js - ana liste, rehber, arama, ayarlar ve ilk kurulum ekranlari. */
(function (w) {
  'use strict';

  /* =======================================================================
     ANA EKRAN
     ======================================================================= */
  var Main = {
    panel: 1,            /* 0 sekmeler, 1 gruplar, 2 kanallar */
    tab: 0,
    tabs: [
      { id: 'channels', name: 'Kanallar' },
      { id: 'guide', name: 'Rehber' },
      { id: 'search', name: 'Ara' },
      { id: 'settings', name: 'Ayarlar' }
    ],
    vG: null, vC: null,
    view: null,          /* seçili grup/görünüm */

    build: function () {
      Main.vG = new VList($('list-groups'), {
        rowRem: 2.7,
        empty: 'Grup yok',
        render: function (g, inner) { UI.groupRow(g, inner); },
        onChange: function (g) { Main.selectView(g); },
        onSelect: function (g) { Main.selectView(g); Main.focus(2); }
      });
      Main.vC = new VList($('list-channels'), {
        rowRem: 2.9,
        empty: 'Kanal yok',
        render: function (ch, inner) { UI.channelRow(ch, inner, App.epg); },
        onChange: function () { Main.paintDetail(); },
        onSelect: function (ch) { if (ch) App.openChannel(ch); }
      });
      Main.paintTabs();
    },

    paintTabs: function () {
      var html = '', i;
      for (i = 0; i < Main.tabs.length; i++) {
        html += '<div class="tab' + (i === 0 ? ' is-current' : '') +
                (Main.panel === 0 && i === Main.tab ? ' is-focused' : '') + '" data-i="' + i + '">' +
                esc(Main.tabs[i].name) + '</div>';
      }
      $('tabs').innerHTML = html;
      $('tabs').onclick = function (e) {
        var n = e.target;
        if (n && n.getAttribute && n.getAttribute('data-i') != null) {
          Main.tab = +n.getAttribute('data-i');
          Main.openTab();
        }
      };
    },

    openTab: function () {
      var id = Main.tabs[Main.tab].id;
      if (id === 'guide') Guide.show();
      else if (id === 'search') Search.show();
      else if (id === 'settings') SettingsScreen.show();
      else Main.focus(1);
    },

    setViews: function () {
      var views = [];
      var favIds = Fav.ids();
      if (favIds.length) {
        views.push({ name: '★ Favoriler', special: 'fav', channels: App.byIds(favIds) });
      }
      var rec = Recent.ids();
      if (rec.length) {
        views.push({ name: '↺ Son izlenenler', special: 'recent', channels: App.byIds(rec) });
      }
      views.push({ name: 'Tüm kanallar', special: 'all', channels: App.channels });
      var real = M3U.groupsOf(App.channels, Settings.get('hideEmptyGroups'));
      for (var i = 0; i < real.length; i++) views.push(real[i]);

      Main.vG.setItems(views, true);

      /* önceki grubu geri getir */
      var want = Settings.get('lastGroup');
      var idx = 0;
      if (want) {
        for (i = 0; i < views.length; i++) { if (views[i].name === want) { idx = i; break; } }
      }
      Main.vG.setIndex(idx, { center: true });
      Main.selectView(views[idx]);
    },

    selectView: function (g) {
      if (!g) return;
      Main.view = g;
      Settings.set('lastGroup', g.name);
      var list = g.channels || [];
      list = App.sorted(list);
      Main.vC.setItems(list);
      $('channels-head').innerHTML = esc(g.name);
      $('channels-foot').innerHTML = list.length + ' kanal';
      Main.paintDetail();
    },

    paintDetail: function () {
      var ch = Main.vC.current();
      var d = $('detail');
      if (!ch) { d.innerHTML = '<div class="muted">Kanal seçili değil</div>'; return; }
      var html = '';
      html += '<div class="detail-logo">' +
              (ch.logo ? '<img src="' + esc(ch.logo) + '" onerror="this.parentNode.innerHTML=\'<span class=&quot;ph&quot;>' + esc(ch.num) + '</span>\'">'
                       : '<span class="ph">' + esc(ch.num) + '</span>') + '</div>';
      html += '<div class="detail-name">' + esc(ch.name) + '</div>';
      html += '<div class="detail-group">' + esc(ch.group) + (Fav.has(ch.id) ? '  ★' : '') + '</div>';

      var r = App.epg.at(ch);
      if (r && r.now) {
        var pct = Math.max(0, Math.min(100, ((Date.now() - r.now.s) / (r.now.e - r.now.s)) * 100));
        html += '<div class="detail-now"><b>' + hhmm(new Date(r.now.s)) + '</b> ' + esc(r.now.t) + '</div>';
        html += '<div class="bar"><i style="width:' + pct.toFixed(1) + '%"></i></div>';
        if (r.next) html += '<div class="detail-next">Sonra ' + hhmm(new Date(r.next.s)) + ' ' + esc(r.next.t) + '</div>';
        if (r.now.d) html += '<div class="detail-desc">' + esc(r.now.d) + '</div>';
      } else if (App.epg.count) {
        html += '<div class="detail-next">Bu kanal için yayın akışı yok</div>';
      }
      html += '<div class="detail-spacer"></div>';
      html += '<div class="detail-url">' + esc(ch.url) + '</div>';
      d.innerHTML = html;
    },

    focus: function (p) {
      Main.panel = p;
      Main.vG.focus(p === 1);
      Main.vC.focus(p === 2);
      Main.paintTabs();
      Main.paintHints();
    },

    paintHints: function () {
      UI.hints('hintbar', [
        ['OK', 'İzle'],
        ['◀ ▶', 'Bölüm'],
        ['Kırmızı', 'Favori', 'red'],
        ['Yeşil', 'Listeyi yenile', 'green'],
        ['Sarı', 'Sıralama', 'yellow'],
        ['Mavi', 'Kanal bilgisi', 'blue'],
        ['0-9', 'Kanal no']
      ]);
    },

    show: function () {
      UI.screen('main');
      Main.paintHints();
      Main.focus(Main.panel === 0 ? 1 : Main.panel);
      Nav.removeByName('main');
      Nav.push({ name: 'main', onKey: Main.onKey });
      Main.vG.relayout();
      Main.vC.relayout();
      Main.paintDetail();
    },

    onKey: function (key) {
      /* sekmeler */
      if (Main.panel === 0) {
        if (key === 'left') { Main.tab = (Main.tab + Main.tabs.length - 1) % Main.tabs.length; Main.paintTabs(); return true; }
        if (key === 'right') { Main.tab = (Main.tab + 1) % Main.tabs.length; Main.paintTabs(); return true; }
        if (key === 'down') { Main.focus(1); return true; }
        if (key === 'ok') { Main.openTab(); return true; }
        if (key === 'back') { Main.focus(1); return true; }
      } else {
        var v = Main.panel === 1 ? Main.vG : Main.vC;
        if (key === 'up' && v.index === 0) { Main.panel = 0; Main.tab = 0; Main.focus(0); return true; }
        if (v.handleKey(key)) return true;
        if (key === 'left') {
          if (Main.panel === 2) { Main.focus(1); return true; }
          return true;
        }
        if (key === 'right') {
          if (Main.panel === 1) { Main.focus(2); return true; }
          return true;
        }
        if (key === 'back') {
          if (Main.panel === 2) { Main.focus(1); return true; }
          App.confirmExit();
          return true;
        }
      }

      /* her yerde geçerli kisayollar */
      if (key === 'red') { Main.toggleFav(); return true; }
      if (key === 'green') { App.refreshAll(true); return true; }
      if (key === 'yellow') { Main.cycleSort(); return true; }
      if (key === 'blue') { Main.channelInfo(); return true; }
      if (key === 'guide') { Guide.show(); return true; }
      if (key === 'info') { Main.channelInfo(); return true; }
      if (key.length === 2 && key.charAt(0) === 'd') { App.zapStart(key.charAt(1), Main.gotoNumber); return true; }
      return true;
    },

    gotoNumber: function (n) {
      var ch = App.byNumber(n);
      if (!ch) { UI.toast(n + ' numaralı kanal yok'); return; }
      App.openChannel(ch);
    },

    toggleFav: function () {
      var ch = Main.panel === 2 ? Main.vC.current() : null;
      if (!ch) { UI.toast('Önce bir kanal seç'); return; }
      var added = Fav.toggle(ch.id);
      UI.toast(added ? ch.name + ' favorilere eklendi' : ch.name + ' favorilerden çıkarıldı');
      Main.vC.draw(true);
      Main.paintDetail();
    },

    cycleSort: function () {
      var order = ['playlist', 'name', 'number'];
      var names = { playlist: 'liste sırası', name: 'isme göre', number: 'numaraya göre' };
      var cur = Settings.get('sortChannels');
      var i = order.indexOf(cur);
      var next = order[(i + 1) % order.length];
      Settings.set('sortChannels', next);
      UI.toast('Sıralama: ' + names[next]);
      Main.selectView(Main.view);
    },

    channelInfo: function () {
      var ch = Main.vC.current();
      if (!ch) return;
      var pl = Playlists.byId(ch.plId);
      var memo = EngineMemo.get(ch.url);
      var html =
        '<div class="fld-desc">Kanal</div><div>' + esc(ch.name) + '  (no ' + ch.num + ')</div>' +
        '<div class="fld-desc" style="margin-top:.6rem">Grup</div><div>' + esc(ch.group) + '</div>' +
        '<div class="fld-desc" style="margin-top:.6rem">Liste</div><div>' + esc(pl ? pl.name : ch.plId) + '</div>' +
        '<div class="fld-desc" style="margin-top:.6rem">Adres</div><div style="word-break:break-all;font-size:.8rem">' + esc(ch.url) + '</div>' +
        (ch.tvgId ? '<div class="fld-desc" style="margin-top:.6rem">EPG kimliği</div><div>' + esc(ch.tvgId) + '</div>' : '') +
        (ch.ua ? '<div class="fld-desc" style="margin-top:.6rem">User-Agent</div><div style="font-size:.8rem">' + esc(ch.ua) + '</div>' : '') +
        (ch.drm ? '<div class="fld-desc" style="margin-top:.6rem">DRM</div><div style="color:#ff9b9b">Bu kanal DRM korumalı olabilir</div>' : '') +
        (memo ? '<div class="fld-desc" style="margin-top:.6rem">Bilinen motor</div><div>' + esc(memo) + '</div>' : '');
      UI.modal({ title: 'Kanal bilgisi', html: html, actions: [{ label: 'Kapat' }] });
    }
  };

  /* =======================================================================
     REHBER (EPG)
     ======================================================================= */
  var Guide = {
    rows: [], chIdx: 0, prIdx: 0, offset: 0,
    from: 0, span: 9000000,     /* 2.5 saat */
    rowH: 46, pool: [],

    show: function () {
      if (!App.epg.count) {
        UI.confirm('Yayın akışı yok',
          'Önce bir XMLTV (EPG) adresi tanımlamalısın. Ayarlara gidilsin mi?',
          function () { SettingsScreen.show('epg'); });
        return;
      }
      UI.screen('guide');
      Guide.rows = App.sorted((Main.view && Main.view.channels) || App.channels);
      if (Guide.rows.length > 600) Guide.rows = Guide.rows.slice(0, 600);
      Guide.from = Math.floor(Date.now() / 1800000) * 1800000;
      Guide.chIdx = 0;
      Guide.offset = 0;
      var curCh = Player.current();
      if (curCh) {
        for (var i = 0; i < Guide.rows.length; i++) { if (Guide.rows[i].id === curCh.id) { Guide.chIdx = i; break; } }
      }
      Guide.prIdx = 0;
      UI.hints('guide-hint', [['OK', 'İzle'], ['◀ ▶', 'Saat'], ['Kırmızı', 'Şimdi', 'red'], ['Geri', 'Çık']]);
      Guide.draw();
      Nav.removeByName('guide');
      Nav.push({ name: 'guide', onKey: Guide.onKey });
    },

    draw: function () {
      var host = $('guide-rows');
      var fs = parseFloat(w.getComputedStyle ? w.getComputedStyle(document.documentElement).fontSize : '16') || 16;
      Guide.rowH = Math.round(2.9 * fs);
      var viewH = host.clientHeight || 400;
      var visible = Math.ceil(viewH / Guide.rowH) + 1;

      /* seçili satırı görünür tut */
      var top = Guide.chIdx * Guide.rowH;
      if (top < Guide.offset) Guide.offset = top;
      if (top + Guide.rowH > Guide.offset + viewH) Guide.offset = top + Guide.rowH - viewH;
      if (Guide.offset < 0) Guide.offset = 0;

      var start = Math.floor(Guide.offset / Guide.rowH);
      var end = Math.min(Guide.rows.length, start + visible);
      var to = Guide.from + Guide.span;
      var chW = 12 * fs;
      var totalW = (host.clientWidth || 800) - chW;

      /* zaman çubuğu */
      var tb = '', t;
      for (t = Guide.from; t < to; t += 1800000) {
        var leftPct = ((t - Guide.from) / Guide.span) * 100;
        tb += '<div class="guide-time" style="left:' + leftPct.toFixed(2) + '%">' + hhmm(new Date(t)) + '</div>';
      }
      $('guide-timebar').innerHTML = tb;
      $('guide-timebar').style.marginLeft = chW + 'px';

      var html = '', i, ch, progs, j, p, l, wpct;
      for (i = start; i < end; i++) {
        ch = Guide.rows[i];
        progs = App.epg.range(ch, Guide.from, to);
        html += '<div class="guide-row' + (i === Guide.chIdx ? ' is-cur' : '') +
                '" style="top:' + (i * Guide.rowH - Guide.offset) + 'px;height:' + Guide.rowH + 'px">' +
                '<div class="guide-ch"><div class="guide-ch-in">' +
                '<span class="guide-ch-num">' + ch.num + '</span>' +
                '<span class="guide-ch-name">' + esc(ch.name) + '</span></div></div>' +
                '<div class="guide-progs">';
        if (!progs.length) {
          html += '<div class="guide-prog" style="left:0;width:100%"><span class="muted">Bilgi yok</span></div>';
        }
        for (j = 0; j < progs.length; j++) {
          p = progs[j];
          /* Pencerenin disina tasan programi kirp: pencereden once baslayan bir
             program tam genisligiyle cizilirse komsusunun uzerine biner. */
          var visS = Math.max(p.s, Guide.from);
          var visE = Math.min(p.e, to);
          l = ((visS - Guide.from) / Guide.span) * 100;
          wpct = ((visE - visS) / Guide.span) * 100;
          if (wpct <= 0) continue;
          /* cok kisa programlar da secilebilir olmali: en az bir serit birak.
             (atlarsak prIdx ile cizilen kutular kayardi) */
          if (wpct < 0.8) wpct = 0.8;
          if (l + wpct > 100) wpct = 100 - l;
          html += '<div class="guide-prog' +
                  (i === Guide.chIdx && j === Guide.prIdx ? ' is-sel' : '') +
                  (p.s <= Date.now() && p.e > Date.now() ? ' is-live' : '') +
                  '" style="left:' + l.toFixed(2) + '%;width:' + wpct.toFixed(2) + '%"><span>' + esc(p.t) + '</span></div>';
        }
        html += '</div></div>';
      }

      /* "şimdi" cizgisi */
      var nowPct = ((Date.now() - Guide.from) / Guide.span);
      if (nowPct >= 0 && nowPct <= 1) {
        html += '<div class="guide-now" style="left:' + (chW + totalW * nowPct) + 'px"></div>';
      }
      host.innerHTML = html;
      Guide.paintInfo();
      $('guide-clock').innerHTML = hhmm(new Date());
    },

    selected: function () {
      var ch = Guide.rows[Guide.chIdx];
      if (!ch) return null;
      var progs = App.epg.range(ch, Guide.from, Guide.from + Guide.span);
      return { ch: ch, p: progs[Guide.prIdx] || null, progs: progs };
    },

    paintInfo: function () {
      var s = Guide.selected();
      var box = $('guide-info');
      if (!s || !s.p) { box.innerHTML = '<h4>' + esc(s && s.ch ? s.ch.name : '') + '</h4><p class="muted">Program bilgisi yok</p>'; return; }
      box.innerHTML = '<h4>' + esc(s.p.t) + '  <span class="muted" style="font-size:.8rem">' +
        hhmm(new Date(s.p.s)) + ' - ' + hhmm(new Date(s.p.e)) + (s.p.c ? '  ' + esc(s.p.c) : '') + '</span></h4>' +
        '<p>' + esc(s.p.d || '') + '</p>';
    },

    onKey: function (key) {
      var s;
      if (key === 'up') { if (Guide.chIdx > 0) { Guide.chIdx--; Guide.prIdx = Guide.nearest(); Guide.draw(); } return true; }
      if (key === 'down') { if (Guide.chIdx < Guide.rows.length - 1) { Guide.chIdx++; Guide.prIdx = Guide.nearest(); Guide.draw(); } return true; }
      if (key === 'chup') { Guide.chIdx = Math.max(0, Guide.chIdx - 8); Guide.prIdx = Guide.nearest(); Guide.draw(); return true; }
      if (key === 'chdown') { Guide.chIdx = Math.min(Guide.rows.length - 1, Guide.chIdx + 8); Guide.prIdx = Guide.nearest(); Guide.draw(); return true; }
      if (key === 'left') {
        if (Guide.prIdx > 0) { Guide.prIdx--; Guide.draw(); }
        else { Guide.from -= Guide.span / 2; Guide.prIdx = 0; Guide.draw(); }
        return true;
      }
      if (key === 'right') {
        s = Guide.selected();
        if (s && Guide.prIdx < s.progs.length - 1) { Guide.prIdx++; Guide.draw(); }
        else { Guide.from += Guide.span / 2; Guide.prIdx = 0; Guide.draw(); }
        return true;
      }
      if (key === 'red') {
        Guide.from = Math.floor(Date.now() / 1800000) * 1800000;
        Guide.prIdx = Guide.nearest();
        Guide.draw();
        return true;
      }
      if (key === 'ok') {
        s = Guide.selected();
        if (s && s.ch) App.openChannel(s.ch);
        return true;
      }
      if (key === 'back' || key === 'guide') { Main.show(); Nav.removeByName('guide'); return true; }
      return true;
    },

    nearest: function () {
      var ch = Guide.rows[Guide.chIdx];
      if (!ch) return 0;
      var progs = App.epg.range(ch, Guide.from, Guide.from + Guide.span);
      var now = Date.now(), i;
      for (i = 0; i < progs.length; i++) { if (progs[i].e > now) return i; }
      return 0;
    }
  };

  /* =======================================================================
     Arama
     ======================================================================= */
  var Search = {
    q: '', rows: [], rI: 0, cI: 0, panel: 0, vR: null,
    KEYS: ['abcdefg', 'hijklmn', 'opqrstu', 'vwxyz0123456789'],

    show: function () {
      UI.screen('search');
      if (!Search.vR) {
        Search.vR = new VList($('list-search'), {
          rowRem: 2.9,
          empty: 'Yazmaya başla',
          render: function (ch, inner) { UI.channelRow(ch, inner, App.epg); },
          onSelect: function (ch) { if (ch) App.openChannel(ch); }
        });
      }
      Search.panel = 0;
      Search.paint();
      Search.run();
      UI.hints('search-hint', [['OK', 'Seç'], ['Kırmızı', 'Sil', 'red'], ['Yeşil', 'Boşluk', 'green'], ['Mavi', 'Sonuçlara geç', 'blue'], ['Geri', 'Çık']]);
      Nav.removeByName('search');
      Nav.push({ name: 'search', onKey: Search.onKey });
      Search.vR.relayout();
    },

    paint: function () {
      $('search-q').innerHTML = esc(Search.q);
      var rows = [], i, j, r;
      for (i = 0; i < Search.KEYS.length; i++) {
        r = [];
        for (j = 0; j < Search.KEYS[i].length; j++) r.push({ t: Search.KEYS[i].charAt(j), v: Search.KEYS[i].charAt(j) });
        rows.push(r);
      }
      rows.push([{ t: 'Sil', a: 'bk', wide: 1 }, { t: 'Boşluk', a: 'sp', wide: 1 }, { t: 'Temizle', a: 'clr', wide: 1 }]);
      Search.rows = rows;
      var html = '';
      for (i = 0; i < rows.length; i++) {
        for (j = 0; j < rows[i].length; j++) {
          html += '<div class="key' + (rows[i][j].wide ? ' wide' : '') +
                  (Search.panel === 0 && i === Search.rI && j === Search.cI ? ' is-focused' : '') +
                  '" data-r="' + i + '" data-c="' + j + '">' + esc(rows[i][j].t) + '</div>';
        }
        html += '<div style="width:100%;height:0"></div>';
      }
      $('kbd').innerHTML = html;
      $('kbd').onclick = function (e) {
        var n = e.target;
        if (!n || !n.getAttribute || n.getAttribute('data-r') == null) return;
        Search.rI = +n.getAttribute('data-r');
        Search.cI = +n.getAttribute('data-c');
        Search.press(Search.rows[Search.rI][Search.cI]);
      };
      if (Search.vR) Search.vR.focus(Search.panel === 1);
    },

    press: function (k) {
      if (!k) return;
      if (k.a === 'bk') Search.q = Search.q.substring(0, Search.q.length - 1);
      else if (k.a === 'sp') Search.q += ' ';
      else if (k.a === 'clr') Search.q = '';
      else if (k.v) Search.q += k.v;
      Search.paint();
      Search.run();
    },

    run: function () {
      var q = norm(Search.q).trim();
      if (!q) { Search.vR.setItems([]); Search.vR.emptyText = 'Yazmaya başla'; Search.vR.draw(true); return; }
      var out = [], i, c;
      for (i = 0; i < App.channels.length; i++) {
        c = App.channels[i];
        if (c.key.indexOf(q) >= 0) { out.push(c); if (out.length >= 400) break; }
      }
      Search.vR.emptyText = 'Sonuç yok';
      Search.vR.setItems(out);
    },

    onKey: function (key) {
      if (key === 'back') {
        if (Search.panel === 1) { Search.panel = 0; Search.paint(); return true; }
        Main.show(); Nav.removeByName('search'); return true;
      }
      if (key === 'blue') { Search.panel = 1; Search.paint(); return true; }
      if (key.indexOf('char:') === 0) { Search.q += key.substring(5); Search.paint(); Search.run(); return true; }
      if (key.length === 2 && key.charAt(0) === 'd') { Search.q += key.charAt(1); Search.paint(); Search.run(); return true; }

      if (Search.panel === 1) {
        if (key === 'left') { Search.panel = 0; Search.paint(); return true; }
        if (Search.vR.handleKey(key)) return true;
        return true;
      }
      if (key === 'up') { Search.rI = (Search.rI + Search.rows.length - 1) % Search.rows.length; if (Search.cI >= Search.rows[Search.rI].length) Search.cI = Search.rows[Search.rI].length - 1; Search.paint(); return true; }
      if (key === 'down') { Search.rI = (Search.rI + 1) % Search.rows.length; if (Search.cI >= Search.rows[Search.rI].length) Search.cI = Search.rows[Search.rI].length - 1; Search.paint(); return true; }
      if (key === 'left') { Search.cI = (Search.cI + Search.rows[Search.rI].length - 1) % Search.rows[Search.rI].length; Search.paint(); return true; }
      if (key === 'right') {
        if (Search.cI >= Search.rows[Search.rI].length - 1) { Search.panel = 1; Search.paint(); return true; }
        Search.cI++; Search.paint(); return true;
      }
      if (key === 'ok') { Search.press(Search.rows[Search.rI][Search.cI]); return true; }
      if (key === 'red') { Search.press({ a: 'bk' }); return true; }
      if (key === 'green') { Search.press({ a: 'sp' }); return true; }
      return true;
    }
  };

  w.Main = Main;
  w.Guide = Guide;
  w.Search = Search;
}(window));
