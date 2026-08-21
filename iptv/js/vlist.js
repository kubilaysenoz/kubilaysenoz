/* vlist.js - sanal (pencereli) liste.
   10.000 kanallı bir listede tüm satırları DOM'a basmak TV'yi kilitler.
   Burada yalnızca ekrana sigan ~20 satır oluşturulur, kaydırırken bu satırlar
   yeniden kullanılır. Odak DOM odagi değil, "seçili indis" ile yönetilir. */
(function (w) {
  'use strict';

  function VList(container, opt) {
    opt = opt || {};
    this.el = container;
    this.inner = container.getElementsByClassName('vlist-inner')[0];
    if (!this.inner) {
      this.inner = el('div', 'vlist-inner');
      container.appendChild(this.inner);
    }
    this.rowRem = opt.rowRem || 2.9;
    this.render = opt.render || function () {};
    this.onSelect = opt.onSelect || function () {};
    this.onChange = opt.onChange || function () {};
    this.emptyText = opt.empty || 'Boş';
    this.items = [];
    this.index = 0;
    this.offset = 0;
    this.currentId = null;
    this.pool = [];
    this.start = -1;
    this.count = 0;
    this.focused = false;
    this.emptyEl = null;
    this._measure();

    var self = this;
    if (container.addEventListener) {
      container.addEventListener('click', function (e) {
        var n = e.target;
        while (n && n !== container && !n.__vi) n = n.parentNode;
        if (n && n.__vi != null) {
          var i = n.__vi;
          if (i === self.index) self.onSelect(self.items[i], i);
          else { self.setIndex(i); self.onChange(self.items[i], i); }
        }
      }, false);
    }
  }

  VList.prototype._measure = function () {
    var fs = parseFloat(w.getComputedStyle
      ? w.getComputedStyle(document.documentElement).fontSize
      : '16') || 16;
    this.rowH = Math.max(20, Math.round(this.rowRem * fs));
    this.viewH = this.el.clientHeight || 400;
    this.visible = Math.ceil(this.viewH / this.rowH) + 2;
  };

  VList.prototype.relayout = function () {
    this._measure();
    this.pool = [];
    this.inner.innerHTML = '';
    this.start = -1;
    this._clampOffset();
    this.draw(true);
  };

  VList.prototype.setItems = function (items, keepIndex) {
    this.items = items || [];
    if (!keepIndex) { this.index = 0; this.offset = 0; }
    if (this.index >= this.items.length) this.index = Math.max(0, this.items.length - 1);
    this._clampOffset();
    this.ensureVisible(true);
    this.draw(true);
  };

  VList.prototype.setCurrentId = function (id) {
    this.currentId = id;
    this.draw(true);
  };

  VList.prototype.focus = function (on) {
    this.focused = !!on;
    if (on) this.el.className = this.el.className.replace(/\s*is-focused/g, '') + ' is-focused';
    else this.el.className = this.el.className.replace(/\s*is-focused/g, '');
    this.draw(true);
  };

  VList.prototype.current = function () { return this.items[this.index] || null; };

  VList.prototype._clampOffset = function () {
    var maxOff = Math.max(0, this.items.length * this.rowH - this.viewH);
    if (this.offset > maxOff) this.offset = maxOff;
    if (this.offset < 0) this.offset = 0;
  };

  /* Seçili satırı görünür tut; kenara 2 satır pay birak (TV'de goz takibi kolay olsun) */
  VList.prototype.ensureVisible = function (center) {
    if (!this.items.length) { this.offset = 0; return; }
    var pad = this.rowH * 2;
    var top = this.index * this.rowH;
    var bot = top + this.rowH;
    if (center) {
      this.offset = top - (this.viewH - this.rowH) / 2;
    } else if (top - pad < this.offset) {
      this.offset = top - pad;
    } else if (bot + pad > this.offset + this.viewH) {
      this.offset = bot + pad - this.viewH;
    }
    this._clampOffset();
  };

  VList.prototype.setIndex = function (i, opt) {
    if (!this.items.length) { this.index = 0; return; }
    if (i < 0) i = 0;
    if (i >= this.items.length) i = this.items.length - 1;
    var changed = i !== this.index;
    this.index = i;
    this.ensureVisible(opt && opt.center);
    this.draw();
    return changed;
  };

  VList.prototype.move = function (delta, wrap) {
    if (!this.items.length) return false;
    var i = this.index + delta;
    if (i < 0) i = wrap ? this.items.length - 1 : 0;
    if (i >= this.items.length) i = wrap ? 0 : this.items.length - 1;
    if (i === this.index) return false;
    this.setIndex(i);
    this.onChange(this.items[i], i);
    return true;
  };

  VList.prototype.indexOfId = function (id) {
    for (var i = 0; i < this.items.length; i++) {
      if (this.items[i] && this.items[i].id === id) return i;
    }
    return -1;
  };

  VList.prototype.draw = function (force) {
    var i, row, idx;
    if (!this.items.length) {
      this.inner.innerHTML = '';
      this.pool = [];
      this.start = -1;
      if (!this.emptyEl) {
        this.emptyEl = el('div', 'vlist-empty', this.emptyText);
        this.el.appendChild(this.emptyEl);
      }
      this.emptyEl.firstChild.nodeValue = this.emptyText;
      this.emptyEl.style.display = 'block';
      return;
    }
    if (this.emptyEl) this.emptyEl.style.display = 'none';

    setY(this.inner, -Math.round(this.offset));

    var start = Math.max(0, Math.floor(this.offset / this.rowH) - 1);
    var count = Math.min(this.visible, this.items.length - start);

    /* havuzu büyüt */
    while (this.pool.length < count) {
      row = el('div', 'row');
      row.style.height = this.rowH + 'px';
      var inner = el('div', 'row-in');
      row.appendChild(inner);
      this.inner.appendChild(row);
      this.pool.push(row);
    }
    /* fazlasini gizle */
    for (i = count; i < this.pool.length; i++) this.pool[i].style.display = 'none';

    var rerender = force || start !== this.start || count !== this.count;
    this.start = start;
    this.count = count;

    for (i = 0; i < count; i++) {
      idx = start + i;
      row = this.pool[i];
      row.style.display = '';
      if (rerender || row.__vi !== idx) {
        row.style.top = (idx * this.rowH) + 'px';
        row.style.height = this.rowH + 'px';
        row.__vi = idx;
        this.render(this.items[idx], row.firstChild, idx);
      }
      var cls = 'row';
      if (idx === this.index) cls += ' is-sel';
      if (this.currentId != null && this.items[idx] && this.items[idx].id === this.currentId) cls += ' is-cur';
      if (row.className !== cls) row.className = cls;
    }
  };

  /* ortak kumanda tuşları; ekran kendi isini yapmadan önce bunu çağırabilir */
  VList.prototype.handleKey = function (key) {
    switch (key) {
      case 'up':     return this.move(-1);
      case 'down':   return this.move(1);
      case 'chup':   return this.move(-10);
      case 'chdown': return this.move(10);
      case 'home':   this.setIndex(0, { center: true }); this.onChange(this.current(), this.index); return true;
      case 'end':    this.setIndex(this.items.length - 1, { center: true }); this.onChange(this.current(), this.index); return true;
      case 'ok':     if (this.items.length) this.onSelect(this.current(), this.index); return true;
    }
    return false;
  };

  w.VList = VList;
}(window));
