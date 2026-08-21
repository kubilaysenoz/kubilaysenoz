/* nav.js - kumanda tuşlarını anlamlı isimlere çevirir ve ekranlar arasi
   odak yiginini yönetir. Philips (Saphi / NetTV / Android TV), webOS, Tizen ve
   masaüstü klavye kodlarinin hepsi aynı tabloda; fazlasi zarar vermiyor. */
(function (w) {
  'use strict';

  var CODE = {
    37: 'left', 38: 'up', 39: 'right', 40: 'down',
    13: 'ok', 32: 'playpause',
    8: 'back', 27: 'back', 166: 'back', 461: 'back', 10009: 'back', 10182: 'exit',
    403: 'red', 404: 'green', 405: 'yellow', 406: 'blue',
    33: 'chup', 34: 'chdown', 427: 'chup', 428: 'chdown',
    415: 'play', 19: 'pause', 413: 'stop', 417: 'ffwd', 412: 'rew',
    179: 'playpause', 178: 'stop', 176: 'next', 177: 'prev',
    457: 'info', 458: 'guide', 462: 'guide',
    36: 'home', 35: 'end',
    9: 'tab', 46: 'del', 45: 'ins', 93: 'menu'
  };

  var KEYNAME = {
    ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
    Up: 'up', Down: 'down', Left: 'left', Right: 'right',
    Enter: 'ok', Select: 'ok', ' ': 'playpause', Spacebar: 'playpause',
    Backspace: 'back', Escape: 'back', Esc: 'back', GoBack: 'back', BrowserBack: 'back',
    ColorF0Red: 'red', ColorF1Green: 'green', ColorF2Yellow: 'yellow', ColorF3Blue: 'blue',
    Red: 'red', Green: 'green', Yellow: 'yellow', Blue: 'blue',
    ChannelUp: 'chup', ChannelDown: 'chdown', PageUp: 'chup', PageDown: 'chdown',
    MediaPlay: 'play', MediaPause: 'pause', MediaStop: 'stop',
    MediaPlayPause: 'playpause', Pause: 'pause', Play: 'play',
    MediaFastForward: 'ffwd', MediaRewind: 'rew',
    MediaTrackNext: 'next', MediaTrackPrevious: 'prev',
    Info: 'info', Guide: 'guide', ContextMenu: 'menu',
    Home: 'home', End: 'end', Tab: 'tab', Delete: 'del'
  };

  function keyOf(e) {
    var k = e.key;
    if (k) {
      if (KEYNAME[k]) return KEYNAME[k];
      if (k.length === 1 && k >= '0' && k <= '9') return 'd' + k;
      if (k.length === 1) return 'char:' + k;
    }
    var c = e.keyCode || e.which || 0;
    if (c >= 48 && c <= 57) return 'd' + (c - 48);
    if (c >= 96 && c <= 105) return 'd' + (c - 96);
    if (CODE[c]) return CODE[c];
    if (c >= 65 && c <= 90) return 'char:' + String.fromCharCode(e.shiftKey ? c : c + 32);
    return 'code:' + c;
  }

  var stack = [];     /* [{ name, onKey(key, e) }] */

  var Nav = {
    push: function (ctx) { stack.push(ctx); return ctx; },
    pop: function () { return stack.pop(); },
    replaceTop: function (ctx) { stack[stack.length - 1] = ctx; return ctx; },
    top: function () { return stack.length ? stack[stack.length - 1] : null; },
    removeByName: function (name) {
      for (var i = stack.length - 1; i >= 0; i--) {
        if (stack[i].name === name) { stack.splice(i, 1); return true; }
      }
      return false;
    },
    depth: function () { return stack.length; },
    keyOf: keyOf,

    /* kumanda tuslarinin tarayıcı varsayılanını (geri gitme, kaydirma) engelle */
    swallow: function (e) {
      if (e.preventDefault) e.preventDefault();
      if (e.stopPropagation) e.stopPropagation();
      e.returnValue = false;
      return false;
    },

    init: function () {
      function handler(e) {
        var key = keyOf(e);
        /* ses ve guc tuşları TV'nin kendi isi - dokunma */
        if (key === 'code:174' || key === 'code:175' || key === 'code:173') return;
        var top = stack[stack.length - 1];
        if (!top) return;
        var consumed = false;
        try { consumed = top.onKey(key, e) !== false; }
        catch (err) { console.error('nav handler', err); consumed = true; }
        if (consumed) Nav.swallow(e);
      }
      if (w.addEventListener) {
        w.addEventListener('keydown', handler, true);
        /* Bazı TV tarayıcıları VK_BACK'i yalnızca keyup ile bildiriyor */
        w.addEventListener('keyup', function (e) {
          var k = keyOf(e);
          if (k === 'back' || k === 'exit') Nav.swallow(e);
        }, true);
      } else if (document.attachEvent) {
        document.attachEvent('onkeydown', function () { handler(w.event); });
      }

      /* Philips işaretçi kumandalari ve fare için: sagdaki boş alana tıklama = geri */
      if (w.addEventListener) {
        w.addEventListener('contextmenu', function (e) {
          var top = stack[stack.length - 1];
          if (top) { top.onKey('back', e); Nav.swallow(e); }
        }, false);
      }
    }
  };

  w.Nav = Nav;
}(window));
