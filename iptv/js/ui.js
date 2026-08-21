/* ui.js - ortak arayüz parçaları: ekran yönetimi, bildirim, pencere,
   ekran klavyesi ve satır çizicileri. */
(function (w) {
  'use strict';

  var curScreen = '';
  var toastTimer = null;

  var UI = {

    /* ---------- ekranlar ---------- */
    screen: function (name) {
      var all = document.getElementsByClassName('screen'), i;
      for (i = 0; i < all.length; i++) {
        all[i].className = all[i].className.replace(/\s*is-active/g, '');
      }
      var t = $('screen-' + name);
      if (t) t.className += ' is-active';
      curScreen = name;
      return t;
    },
    current: function () { return curScreen; },

    /* ---------- ölçek ve güvenli alan (overscan) ---------- */
    applyScale: function () {
      var s = Settings.all();
      var wpx = w.innerWidth || document.documentElement.clientWidth || 1280;
      var base = (wpx / 1280) * 16;
      var fs = base * ((s.uiScale || 100) / 100);
      if (fs < 9) fs = 9;
      if (fs > 40) fs = 40;
      document.documentElement.style.fontSize = fs + 'px';

      /* Güvenli alan payı. 1rem = fs piksel oldugu için rem değerleri
         doğrudan fs ile carpilir. */
      var pad = Math.max(0, Math.min(10, s.safeArea || 0));
      var px = (wpx * pad / 100);
      var hpx = (w.innerHeight || document.documentElement.clientHeight || 720) * pad / 100;
      var padTop = 1.5 * fs + hpx;
      var padSide = 2 * fs + px;
      var scr = document.getElementsByClassName('screen'), i;
      for (i = 0; i < scr.length; i++) {
        if (scr[i].id === 'screen-player') continue;
        scr[i].style.padding = padTop + 'px ' + padSide + 'px';
      }
      /* mutlak konumlu bölgeler ekranin kenarına değil, aynı paya hizalanir */
      var abs = ['columns', 'guide', 'search', 'settings'];
      for (i = 0; i < abs.length; i++) {
        var e = document.getElementsByClassName(abs[i]);
        for (var j = 0; j < e.length; j++) {
          e[j].style.left = padSide + 'px';
          e[j].style.right = padSide + 'px';
          e[j].style.top = (padTop + 3.6 * fs) + 'px';     /* ust cubugun altindan başla */
          e[j].style.bottom = (padTop + 2.2 * fs) + 'px';  /* ipucu cubuguna yer birak */
        }
      }
      var hb = document.getElementsByClassName('hintbar');
      for (i = 0; i < hb.length; i++) {
        hb[i].style.left = padSide + 'px';
        hb[i].style.right = padSide + 'px';
        hb[i].style.bottom = padTop + 'px';
      }
    },

    showSafeGuide: function (on) {
      var g = $('safe-guide');
      g.className = 'safe-guide' + (on ? ' is-on' : '');
    },

    /* ---------- bildirim ---------- */
    toast: function (msg, ms) {
      var t = $('toast');
      t.innerHTML = '';
      t.appendChild(document.createTextNode(msg));
      t.className = 'toast is-on';
      if (toastTimer) w.clearTimeout(toastTimer);
      toastTimer = w.setTimeout(function () { t.className = 'toast'; }, ms || 2600);
    },

    /* ---------- ipucu çubuğu ---------- */
    hints: function (elId, list) {
      var bar = $(elId);
      if (!bar) return;
      var html = '', i;
      for (i = 0; i < list.length; i++) {
        html += '<span class="hint ' + (list[i][2] || '') + '"><b>' + esc(list[i][0]) + '</b>' + esc(list[i][1]) + '</span>';
      }
      bar.innerHTML = html;
    },

    /* ---------- pencere (modal) ----------
       actions: [{label, cls, fn}]  - Geri her zaman kapatir. */
    modal: function (opt) {
      var box = $('modal');
      $('modal-title').innerHTML = esc(opt.title || '');
      var body = $('modal-body');
      body.innerHTML = '';
      if (opt.html) body.innerHTML = opt.html;
      else if (opt.text) body.appendChild(document.createTextNode(opt.text));
      if (opt.node) body.appendChild(opt.node);

      var acts = opt.actions || [{ label: 'Tamam' }];
      var wrap = $('modal-actions');
      wrap.innerHTML = '';
      var btns = [], i;
      for (i = 0; i < acts.length; i++) {
        var b = el('div', 'btn ' + (acts[i].cls || ''), acts[i].label);
        b.__i = i;
        wrap.appendChild(b);
        btns.push(b);
      }
      var sel = opt.defaultAction || 0;
      function paint() {
        for (var k = 0; k < btns.length; k++) {
          btns[k].className = 'btn ' + (acts[k].cls || '') + (k === sel ? ' is-focused' : '');
        }
      }
      paint();
      box.className = 'modal is-on';

      function close() {
        box.className = 'modal';
        Nav.removeByName('modal');
      }

      var ctx = {
        name: 'modal',
        onKey: function (key) {
          if (key === 'left') { sel = (sel + acts.length - 1) % acts.length; paint(); return true; }
          if (key === 'right') { sel = (sel + 1) % acts.length; paint(); return true; }
          if (key === 'up' || key === 'down') return true;
          if (key === 'ok') {
            var a = acts[sel];
            close();
            if (a && a.fn) a.fn();
            return true;
          }
          if (key === 'back') {
            close();
            if (opt.onCancel) opt.onCancel();
            return true;
          }
          return true;
        }
      };
      Nav.push(ctx);

      for (i = 0; i < btns.length; i++) {
        (function (b) {
          b.onclick = function () { sel = b.__i; paint(); ctx.onKey('ok'); };
        }(btns[i]));
      }
      return { close: close };
    },

    confirm: function (title, text, onYes, opt) {
      opt = opt || {};
      return UI.modal({
        title: title,
        text: text,
        defaultAction: opt.dangerous ? 1 : 0,
        actions: [
          { label: opt.yes || 'Evet', cls: opt.dangerous ? 'danger' : '', fn: onYes },
          { label: opt.no || 'Vazgeç' }
        ]
      });
    },

    /* ---------- ekran klavyesi ----------
       TV kumandasiyla adres yazmak zor; düzen büyük tuslu ve kisayolludur.
       Fiziksel klavye / telefon uygulaması bağlılarsa harfler doğrudan geçer. */
    input: function (opt) {
      var value = opt.value || '';
      var mode = 'abc';   /* abc | ABC | 123 */
      var urlMode = opt.mode === 'url';

      var node = el('div');
      var boxEl = el('div', 'search-box');
      var qEl = el('span', 'search-q');
      boxEl.appendChild(qEl);
      boxEl.appendChild(el('i', 'caret'));
      var kbdEl = el('div', 'kbd');
      node.appendChild(boxEl);
      node.appendChild(kbdEl);
      if (opt.desc) {
        var d = el('div', 'fld-desc', opt.desc);
        d.style.marginTop = '.6rem';
        node.appendChild(d);
      }

      var rows = [];
      function layout() {
        var LOW = ['abcdefgh', 'ijklmnop', 'qrstuvwx', 'yz0123456789'];
        var UPP = ['ABCDEFGH', 'IJKLMNOP', 'QRSTUVWX', 'YZ0123456789'];
        var SYM = ['.:/-_~%', '?&=#@+*', '!$(),;\'', '"[]{}|\\^'];
        var src = mode === 'ABC' ? UPP : (mode === '123' ? SYM : LOW);
        rows = [];
        for (var i = 0; i < src.length; i++) {
          var r = [], j;
          for (j = 0; j < src[i].length; j++) r.push({ t: src[i].charAt(j), v: src[i].charAt(j) });
          rows.push(r);
        }
        var extra = [
          { t: 'Sil', a: 'bk', wide: 1 },
          { t: 'Boşluk', a: 'sp', wide: 1 },
          { t: mode === 'abc' ? 'ABC' : (mode === 'ABC' ? '123' : 'abc'), a: 'mode', wide: 1 },
          { t: 'Temizle', a: 'clr', wide: 1 }
        ];
        rows.push(extra);
        if (urlMode) {
          rows.push([
            { t: 'http://', a: 'ins', v: 'http://', wide: 1 },
            { t: 'https://', a: 'ins', v: 'https://', wide: 1 },
            { t: '.com', a: 'ins', v: '.com', wide: 1 },
            { t: '.m3u8', a: 'ins', v: '.m3u8', wide: 1 }
          ]);
        }
        rows.push([{ t: 'Bitti', a: 'done', wide: 1 }, { t: 'Vazgeç', a: 'cancel', wide: 1 }]);
      }

      var rI = 0, cI = 0;

      function paint() {
        qEl.innerHTML = '';
        qEl.appendChild(document.createTextNode(
          opt.password ? new Array(value.length + 1).join('*') : value));
        var html = '', i, j, k;
        for (i = 0; i < rows.length; i++) {
          for (j = 0; j < rows[i].length; j++) {
            k = rows[i][j];
            html += '<div class="key' + (k.wide ? ' wide' : '') +
                    (i === rI && j === cI ? ' is-focused' : '') +
                    '" data-r="' + i + '" data-c="' + j + '">' + esc(k.t) + '</div>';
          }
          html += '<div style="width:100%;height:0"></div>';
        }
        kbdEl.innerHTML = html;
      }

      function act(k) {
        if (!k) return;
        if (k.a === 'bk') { value = value.substring(0, value.length - 1); }
        else if (k.a === 'sp') { value += ' '; }
        else if (k.a === 'clr') { value = ''; }
        else if (k.a === 'mode') { mode = (mode === 'abc' ? 'ABC' : (mode === 'ABC' ? '123' : 'abc')); layout(); }
        else if (k.a === 'ins') { value += k.v; }
        else if (k.a === 'done') { finish(true); return; }
        else if (k.a === 'cancel') { finish(false); return; }
        else if (k.v != null) { value += k.v; }
        paint();
        if (opt.onChange) opt.onChange(value);
      }

      var closed = false;
      var m;
      function finish(okFlag) {
        if (closed) return;
        closed = true;
        if (m) m.close();
        Nav.removeByName('osk');
        if (okFlag && opt.onDone) opt.onDone(value);
        if (!okFlag && opt.onCancel) opt.onCancel();
      }

      layout();
      paint();

      m = UI.modal({
        title: opt.title || 'Yaz',
        node: node,
        actions: [],
        onCancel: function () { finish(false); }
      });
      Nav.removeByName('modal');   /* tuşları klavye baglami yonetsin */

      kbdEl.onclick = function (e) {
        var n = e.target;
        if (!n || !n.getAttribute) return;
        var r = n.getAttribute('data-r');
        if (r == null) return;
        rI = +r; cI = +n.getAttribute('data-c');
        paint();
        act(rows[rI][cI]);
      };

      Nav.push({
        name: 'osk',
        onKey: function (key) {
          if (key === 'back') { finish(false); return true; }
          if (key === 'up') { rI = (rI + rows.length - 1) % rows.length; if (cI >= rows[rI].length) cI = rows[rI].length - 1; paint(); return true; }
          if (key === 'down') { rI = (rI + 1) % rows.length; if (cI >= rows[rI].length) cI = rows[rI].length - 1; paint(); return true; }
          if (key === 'left') { cI = (cI + rows[rI].length - 1) % rows[rI].length; paint(); return true; }
          if (key === 'right') { cI = (cI + 1) % rows[rI].length; paint(); return true; }
          if (key === 'ok') { act(rows[rI][cI]); return true; }
          if (key === 'red') { act({ a: 'bk' }); return true; }
          if (key === 'green') { act({ a: 'sp' }); return true; }
          if (key === 'yellow') { act({ a: 'mode' }); return true; }
          if (key === 'blue') { finish(true); return true; }
          if (key.indexOf('d') === 0 && key.length === 2) { value += key.charAt(1); paint(); return true; }
          if (key.indexOf('char:') === 0) { value += key.substring(5); paint(); return true; }
          return true;
        }
      });
    },

    /* ---------- satır çizicileri ---------- */
    channelRow: function (ch, inner, epg) {
      var now = null;
      if (epg) { var r = epg.at(ch); now = r && r.now; }
      var favMark = Fav.has(ch.id) ? '<div class="row-tag">&#9733;</div>' : '';
      /* logosu olmayan kanalda boş kutu cizmiyoruz, ama hizalama bozulmasin
         diye aynı genislikte seffaf bir boşluk birakiyoruz */
      var logo = ch.logo
        ? '<div class="row-logo"><img src="' + esc(ch.logo) + '" onerror="this.style.display=\'none\'"></div>'
        : '<div class="row-logo is-empty"></div>';
      inner.innerHTML =
        '<div class="row-num">' + ch.num + '</div>' + logo +
        '<div class="row-text"><div class="row-title">' + esc(ch.name) + '</div>' +
        (now ? '<div class="row-sub">' + esc(now.t) + '</div>' : '') +
        '</div>' + favMark;
    },

    groupRow: function (g, inner) {
      inner.innerHTML =
        '<div class="row-text"><div class="row-title">' + esc(g.name) + '</div></div>' +
        '<div class="row-count">' + (g.channels ? g.channels.length : 0) + '</div>';
    },

    simpleRow: function (item, inner) {
      inner.innerHTML =
        '<div class="row-text"><div class="row-title">' + esc(item.name) + '</div>' +
        (item.sub ? '<div class="row-sub">' + esc(item.sub) + '</div>' : '') + '</div>' +
        (item.active ? '<div class="row-tag">&#10003;</div>' : '');
    },

    /* ---------- yardımcılar ---------- */
    bytes: function (n) {
      if (n < 0) return 'yok';
      if (n < 1024) return n + ' B';
      if (n < 1048576) return Math.round(n / 1024) + ' KB';
      return (Math.round(n / 104857.6) / 10) + ' MB';
    },

    when: function (ms) {
      var d = new Date(ms);
      var today = new Date();
      var same = d.getFullYear() === today.getFullYear() && d.getMonth() === today.getMonth() && d.getDate() === today.getDate();
      return (same ? '' : pad2(d.getDate()) + '.' + pad2(d.getMonth() + 1) + ' ') + hhmm(d);
    }
  };

  w.UI = UI;
}(window));
