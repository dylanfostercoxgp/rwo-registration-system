/* RWO Registration: the screens. Plain JavaScript, no build step. */
(function () {
  'use strict';
  var CFG = window.RWO_CONFIG || {};
  var qs = new URLSearchParams(location.search);
  var DEMO = !CFG.url || qs.get('demo') === '1';
  var S = {
    boot: null, pin: ss('get', 'rwo_pin') || '', who: ls('get', 'rwo_who') || '', event: ss('get', 'rwo_event') || '',
    inboxCount: 0, boardFilter: 'not', boardQ: '', inspectFilter: 'todo', inspectQ: '', deskQ: '', busy: 0, lastRender: 0
  };
  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };

  function ss(op, k, v) { try { return op === 'get' ? sessionStorage.getItem(k) : op === 'set' ? sessionStorage.setItem(k, v) : sessionStorage.removeItem(k); } catch (e) { return null; } }
  function ls(op, k, v) { try { return op === 'get' ? localStorage.getItem(k) : op === 'set' ? localStorage.setItem(k, v) : localStorage.removeItem(k); } catch (e) { return null; } }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function n(s) { return String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9]/g, ''); }
  function can(perm) { return !!(S.boot && S.boot.perms && S.boot.perms.indexOf(perm) >= 0); }
  function fmtDate(d) {
    if (!d) return '';
    var p = String(d).slice(0, 10).split('-');
    if (p.length < 3) return d;
    var m = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][+p[1] - 1];
    return m + ' ' + (+p[2]) + ', ' + p[0];
  }
  function plural(k, word) { return k + ' ' + word + (k === 1 ? '' : 's'); }
  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  /** "2026-11-17 14:31" -> "Nov 17, 2:31 PM" */
  function fmtWhen(at) {
    var m = String(at || '').match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/);
    if (!m) return at || '';
    var h = +m[4], ap = h >= 12 ? 'PM' : 'AM';
    h = h % 12 || 12;
    return MONTHS[+m[2] - 1].slice(0, 3) + ' ' + (+m[3]) + ', ' + h + ':' + m[5] + ' ' + ap;
  }
  /** "by Jess (Registration), Nov 17, 2:31 PM" for one field's last change */
  function stampText(stamps, key, verbOn, verbOff) {
    var st = stamps && stamps[key];
    if (!st) return '';
    var verb = st.v === false || st.v === '' ? (verbOff || 'Cleared') : (verbOn || 'Set');
    return '<div class="stamp">' + esc(verb) + ' by ' + esc(st.by || 'unknown') + ', ' + esc(fmtWhen(st.at)) + '</div>';
  }
  /** Accepts 11/1/2027, 11-1-27, 2027-11-01, 110127, 11012027. Returns "YYYY-MM-DD", "" for blank, or null if it isn't a real date. */
  function parseDate(txt) {
    var t = String(txt || '').trim();
    if (!t) return '';
    var y, mo, d, m;
    var ys;
    if ((m = t.match(/^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})$/))) { ys = m[1]; mo = +m[2]; d = +m[3]; }
    else if ((m = t.match(/^(\d{1,2})[-\/. ](\d{1,2})[-\/. ](\d{2}|\d{4})$/))) { mo = +m[1]; d = +m[2]; ys = m[3]; }
    else if ((m = t.match(/^(\d{2})(\d{2})(\d{2}|\d{4})$/))) { mo = +m[1]; d = +m[2]; ys = m[3]; }
    else return null;
    y = ys.length === 2 ? 2000 + (+ys) : +ys; // "27" means 2027; "0020" is not a real year
    if (y < 2000 || y > 2100 || mo < 1 || mo > 12 || d < 1) return null;
    var dt = new Date(y, mo - 1, d);
    if (dt.getMonth() !== mo - 1 || dt.getDate() !== d) return null;
    return y + '-' + ('0' + mo).slice(-2) + '-' + ('0' + d).slice(-2);
  }
  function showDate(iso) { var m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? m[2] + '/' + m[3] + '/' + m[1] : ''; }

  /**
   * A date box you can type into (saved only once it's a complete, real date)
   * with a button that opens a scrolling month / day / year picker.
   * opts: { value: 'YYYY-MM-DD', label, disabled, onSave(iso) }   returns { get() }
   */
  function dateField(el, opts) {
    var iso = opts.value || '';
    el.innerHTML = '<div class="datef"><input type="text" inputmode="numeric" placeholder="MM/DD/YYYY" aria-label="' + esc(opts.label || 'Date') + '" value="' + esc(showDate(iso)) + '"' + (opts.disabled ? ' disabled' : '') + '>' +
      (opts.disabled ? '' : '<button type="button" class="calbtn" aria-label="Pick ' + esc(opts.label || 'a date') + ' from a list">' +
        '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M3 10h18M8 3v4M16 3v4" stroke="currentColor" stroke-width="2"/></svg></button>') +
      '</div><div class="daterr hide" role="alert">Type a date like 11/01/2027, or use the calendar button.</div>';
    var input = $('input', el), err = $('.daterr', el);
    var commit = function () {
      var v = parseDate(input.value);
      if (v === null) { err.classList.remove('hide'); input.classList.add('bad'); return; }
      err.classList.add('hide'); input.classList.remove('bad');
      input.value = showDate(v);
      if (v !== iso) { iso = v; if (opts.onSave) opts.onSave(v); }
    };
    input.addEventListener('blur', commit);
    input.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); commit(); } });
    input.addEventListener('input', function () { if (parseDate(input.value) !== null) { err.classList.add('hide'); input.classList.remove('bad'); } });
    var btn = $('.calbtn', el);
    if (btn) btn.onclick = function () {
      pickDate(parseDate(input.value) || iso, opts.label).then(function (v) {
        if (v === undefined) return;
        input.value = showDate(v); commit();
      });
    };
    return { get: function () { var v = parseDate(input.value); return v === null ? null : v; } };
  }
  /** Scrolling month / day / year picker. Resolves "YYYY-MM-DD", "" (cleared) or undefined (cancelled). */
  function pickDate(start, label) {
    return new Promise(function (resolve) {
      var now = new Date(), base = String(start || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
      var sel = base ? { y: +base[1], m: +base[2], d: +base[3] } : { y: now.getFullYear() + 1, m: now.getMonth() + 1, d: now.getDate() };
      var years = []; for (var y = now.getFullYear() - 3; y <= now.getFullYear() + 8; y++) years.push(y);
      if (years.indexOf(sel.y) < 0) years.push(sel.y), years.sort();
      var back = document.createElement('div');
      back.className = 'dialog-back';
      var col = function (name, items, cur) {
        return '<div class="wheel" role="listbox" aria-label="' + name + '" data-col="' + name + '">' + items.map(function (it) {
          return '<button type="button" role="option" data-v="' + it[0] + '" aria-selected="' + (it[0] === cur) + '" class="' + (it[0] === cur ? 'on' : '') + '">' + it[1] + '</button>';
        }).join('') + '</div>';
      };
      var days = function () { return new Date(sel.y, sel.m, 0).getDate(); };
      var draw = function () {
        if (sel.d > days()) sel.d = days();
        back.innerHTML = '<div class="dialog datepick" role="dialog" aria-modal="true" aria-label="' + esc(label || 'Pick a date') + '"><h3>' + esc(label || 'Pick a date') + '</h3>' +
          '<div class="wheels">' + col('Month', MONTHS.map(function (n, i) { return [i + 1, n]; }), sel.m) +
          col('Day', Array.apply(null, Array(days())).map(function (_, i) { return [i + 1, i + 1]; }), sel.d) +
          col('Year', years.map(function (y) { return [y, y]; }), sel.y) + '</div>' +
          '<p class="datepreview">' + MONTHS[sel.m - 1] + ' ' + sel.d + ', ' + sel.y + '</p>' +
          '<div class="row"><button type="button" class="btn ghost sm" data-a="clear">Clear date</button><span class="grow"></span>' +
          '<button type="button" class="btn ghost" data-a="cancel">Cancel</button><button type="button" class="btn go" data-a="ok">Use this date</button></div></div>';
        $$('.wheel', back).forEach(function (w) {
          var on = $('.on', w);
          if (on) w.scrollTop = on.offsetTop - w.clientHeight / 2 + on.clientHeight / 2;
        });
      };
      var close = function (v) { back.remove(); resolve(v); };
      back.addEventListener('click', function (e) {
        var o = e.target.closest('.wheel button');
        if (o) {
          var c = o.closest('.wheel').dataset.col;
          sel[c === 'Month' ? 'm' : c === 'Day' ? 'd' : 'y'] = +o.dataset.v;
          var keep = {}; $$('.wheel', back).forEach(function (w) { keep[w.dataset.col] = w.scrollTop; });
          draw();
          $$('.wheel', back).forEach(function (w) { w.scrollTop = keep[w.dataset.col]; });
          var f = $('.wheel[data-col="' + c + '"] .on', back); if (f) f.focus();
          return;
        }
        var a = e.target.closest('[data-a]');
        if (a) close(a.dataset.a === 'ok' ? sel.y + '-' + ('0' + sel.m).slice(-2) + '-' + ('0' + sel.d).slice(-2) : a.dataset.a === 'clear' ? '' : undefined);
        else if (e.target === back) close(undefined);
      });
      back.addEventListener('keydown', function (e) { if (e.key === 'Escape') close(undefined); });
      document.body.appendChild(back);
      draw();
      var f = $('.wheel .on', back); if (f) f.focus();
    });
  }

  /* ---------------- server ---------------- */
  function api(action, payload) {
    payload = Object.assign({}, payload || {});
    if (S.who && !payload.who) payload.who = S.who;
    if (!payload.event_id && S.event) payload.event_id = S.event;
    busy(1);
    var done = function () { busy(-1); };
    if (DEMO) {
      return new Promise(function (res, rej) {
        setTimeout(function () { try { res(window.DEMO_API(S.pin, action, payload)); } catch (e) { rej(e); } }, 90);
      }).then(function (r) { done(); return r; }, function (e) { done(); throw e; });
    }
    return fetch(CFG.url.replace(/\/$/, '') + '/functions/v1/' + (CFG.fn || 'race-api'), {
      method: 'POST', headers: { 'Content-Type': 'application/json', apikey: CFG.key },
      body: JSON.stringify({ action: action, payload: payload, pin: S.pin })
    }).then(function (r) {
      return r.json().catch(function () { throw new Error('The server answered with an error (' + r.status + '). Try again in a moment.'); });
    }, function () {
      throw new Error('Can’t reach the server. Check the Wi-Fi or cell signal and try again.');
    }).then(function (j) {
      done();
      if (!j.ok) throw new Error(j.error || 'Something went wrong.');
      return j.data;
    }, function (e) { done(); throw e; });
  }
  function busy(d) {
    S.busy += d;
    var bar = $('#loading');
    if (bar) bar.classList.toggle('hide', S.busy <= 0);
  }
  function toast(msg, isErr) {
    var t = document.createElement('div');
    t.className = 'toast' + (isErr ? ' err' : '');
    t.setAttribute('role', isErr ? 'alert' : 'status');
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(function () { t.remove(); }, isErr ? 6000 : 2800);
  }
  function fail(e) { toast(e.message || String(e), true); }
  /** In-page yes/no question (browser pop-ups are blocked in some places this runs). */
  function ask(question, yesLabel) {
    return new Promise(function (resolve) {
      var back = document.createElement('div');
      back.className = 'dialog-back';
      back.innerHTML = '<div class="dialog" role="alertdialog" aria-modal="true" aria-labelledby="dq_t"><p id="dq_t">' + esc(question) + '</p>' +
        '<div class="row" style="justify-content:flex-end"><button type="button" class="btn ghost" data-a="0">Cancel</button><button type="button" class="btn stop" data-a="1">' + esc(yesLabel) + '</button></div></div>';
      document.body.appendChild(back);
      var close = function (v) { back.remove(); resolve(v); };
      back.addEventListener('click', function (e) { var b = e.target.closest('[data-a]'); if (b) close(b.dataset.a === '1'); else if (e.target === back) close(false); });
      back.addEventListener('keydown', function (e) { if (e.key === 'Escape') close(false); });
      $('[data-a="0"]', back).focus();
    });
  }

  /* ---------------- routing ---------------- */
  function route() {
    var h = decodeURIComponent(location.hash.replace(/^#\/?/, '') || '');
    var m = h.match(/^([a-z]+)(?:[-\/](.+))?$/);
    return m ? [m[1], m[2] || ''] : [''];
  }
  function go(path) {
    var h = '#' + path.replace('/', '-');
    if (location.hash === h) render(); else location.hash = h;
  }
  window.addEventListener('hashchange', function () { render(); });

  function homeFor() {
    if (!S.boot.dept) return S.boot.public_board ? 'board' : 'signup';
    return { admin: 'inbox', office: 'inbox', registration: 'desk', tech: 'tech', safety: 'safety' }[S.boot.dept] || 'board';
  }

  /* ---------------- layout ---------------- */
  function shell(kiosk) {
    var b = S.boot;
    var events = b.events.map(function (e) {
      return '<option value="' + esc(e.id) + '"' + (e.id === S.event ? ' selected' : '') + '>' + esc(e.name) + '</option>';
    }).join('');
    var r = route()[0];
    var tabs = [];
    if (b.dept || b.public_board) tabs.push(['board', 'Boats']);
    if (can('people') || can('sign')) tabs.push(['desk', 'Registration']);
    if (can('tech')) tabs.push(['tech', 'Tech']);
    if (can('safety')) tabs.push(['safety', 'Safety']);
    if (can('inbox')) tabs.push(['inbox', 'Office inbox' + (S.inboxCount ? ' <span class="n">' + S.inboxCount + '</span>' : '')]);
    if (can('setup')) tabs.push(['setup', 'Events & boats']);
    if (can('inbox')) tabs.push(['history', 'History']);
    if (can('admin')) tabs.push(['admin', 'Admin']);
    if (!b.dept) { tabs.push(['register', 'Boat registration']); tabs.push(['signup', 'Crew sign-up']); }
    var active = { boat: 'board', person: 'desk', teamboat: 'board' }[r] || r;
    return '<div id="loading" class="loading hide"></div>' +
      '<header class="top"><div class="wrap">' +
      '<div class="brand">' + esc(b.org) + '<small>Registration' + (DEMO ? ' (' + (window.DEMO_LABEL || 'demo with made-up data') + ')' : '') + '</small></div>' +
      (kiosk ? '' :
        (b.events.length ? '<label class="sr" for="ev">Event</label><select id="ev" aria-label="Event">' + events + '</select>' : '') +
        '<div class="who">' + (b.dept
          ? '<b>' + esc(b.dept_label) + '</b>' + (S.who ? '<span>' + esc(S.who) + '</span>' : '<span>(no name: sign out and in)</span>') + '<button class="linkbtn" id="logout">Sign out</button>'
          : '<button class="linkbtn" id="login">Staff sign in</button>') + '</div>') +
      '</div></header>' +
      (kiosk ? '' : '<nav class="tabs" aria-label="Sections"><div class="wrap">' + tabs.map(function (t) {
        return '<a href="#' + t[0] + '"' + (active === t[0] ? ' class="on" aria-current="page"' : '') + '>' + t[1] + '</a>';
      }).join('') + '</div></nav>') +
      '<main><div class="wrap" id="view"></div></main>';
  }
  function bindShell() {
    var ev = $('#ev');
    if (ev) ev.onchange = function () { S.event = ev.value; ss('set', 'rwo_event', S.event); render(); };
    var lo = $('#logout');
    if (lo) lo.onclick = function () { S.pin = ''; ss('del', 'rwo_pin'); boot().then(function () { go(homeFor()); }); };
    var li = $('#login');
    if (li) li.onclick = function () { go('login'); };
  }
  function view(html) { var v = $('#view'); if (v) v.innerHTML = html; return v; }

  /* ---------------- shared bits ---------------- */
  function pill(st) { return '<span class="pill ' + esc(st.state) + '">' + esc(st.text) + '</span>'; }
  function ticks(checks) {
    return '<div class="ticks">' + checks.map(function (k) { return '<span class="tick ' + (k.ok ? 'y' : 'n') + '">' + esc(k.label) + '</span>'; }).join('') + '</div>';
  }
  function plate(no, xl) { return '<span class="plate' + (xl ? ' xl' : '') + '">' + esc(no || '?') + '</span>'; }
  function eventName() {
    var e = S.boot.events.filter(function (x) { return x.id === S.event; })[0];
    return e ? e.name : 'this event';
  }
  function noEvent() {
    return '<div class="empty"><h2>No events yet</h2><p>' + (can('setup') ? 'Add your first race under <a href="#setup">Events &amp; boats</a>.' : 'The RWO office hasn’t set up an event yet.') + '</p></div>';
  }
  function debounce(fn, ms) { var t; return function () { var a = arguments; clearTimeout(t); t = setTimeout(function () { fn.apply(null, a); }, ms); }; }
  function copy(text, input) {
    var done = function () { toast('Link copied'); };
    if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(text).then(done, function () { input && input.select(); });
    else if (input) { input.select(); try { document.execCommand('copy'); done(); } catch (e) { } }
  }

  /* ---------------- boat picker (typeahead) ---------------- */
  function boatPicker(el, opts) {
    // opts: { source: fn(q) -> Promise<[{id,label}]>, onPick(boat), placeholder }
    el.innerHTML = '<div class="picker"><input type="search" autocomplete="off" placeholder="' + esc(opts.placeholder || 'Type a boat number or team name') + '" aria-label="Find a boat"><div class="menu hide" role="listbox"></div></div>';
    var input = $('input', el), menu = $('.menu', el), items = [];
    var show = function (list) {
      items = list;
      menu.innerHTML = list.length ? list.map(function (b, i) { return '<button type="button" role="option" data-i="' + i + '">' + esc(b.label) + '</button>'; }).join('')
        : '<div class="small muted" style="padding:10px 12px">No boats match.</div>';
      menu.classList.toggle('hide', !input.value.trim());
    };
    var search = debounce(function () {
      var q = input.value.trim();
      if (!q) { menu.classList.add('hide'); return; }
      Promise.resolve(opts.source(q)).then(show, fail);
    }, 180);
    input.addEventListener('input', search);
    input.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown') { var f = $('button', menu); if (f) { e.preventDefault(); f.focus(); } }
      if (e.key === 'Enter' && items.length === 1) { e.preventDefault(); pick(0); }
    });
    menu.addEventListener('keydown', function (e) {
      var b = document.activeElement;
      if (e.key === 'ArrowDown' && b.nextElementSibling) { e.preventDefault(); b.nextElementSibling.focus(); }
      if (e.key === 'ArrowUp') { e.preventDefault(); (b.previousElementSibling || input).focus(); }
      if (e.key === 'Escape') { menu.classList.add('hide'); input.focus(); }
    });
    var pick = function (i) { opts.onPick(items[i]); input.value = ''; menu.classList.add('hide'); input.focus(); };
    menu.addEventListener('click', function (e) { var b = e.target.closest('button[data-i]'); if (b) pick(+b.dataset.i); });
    document.addEventListener('click', function (e) { if (!el.contains(e.target)) menu.classList.add('hide'); });
    return input;
  }
  function localBoatSearch(boats) {
    return function (q) {
      var k = n(q), d = q.replace(/\D/g, '');
      return boats.filter(function (b) {
        return n(b.boat_no).indexOf(k) === 0 || n(b.team).indexOf(k) >= 0 || n(b.label).indexOf(k) >= 0 || (d && b.boat_no && b.boat_no.replace(/\D/g, '') === d);
      }).slice(0, 25);
    };
  }

  /* =========================================================== */
  /* Boats board                                                  */
  /* =========================================================== */
  function viewBoard(quiet) {
    if (!S.event) { view(noEvent()); return; }
    return api('board').then(function (d) {
      var all = d.entries;
      var q = n(S.boardQ);
      var list = all.filter(function (e) {
        if (S.boardFilter === 'not' && e.cleared) return false;
        if (S.boardFilter === 'cleared' && !e.cleared) return false;
        return !q || n(e.boat_no).indexOf(q) === 0 || n(e.team).indexOf(q) >= 0 || n(e['class']).indexOf(q) >= 0;
      });
      var cleared = all.filter(function (e) { return e.cleared; }).length;
      var tech = all.filter(function (e) { return !e.tech; }).length;
      var safety = all.filter(function (e) { return !e.safety; }).length;
      var crewOut = all.reduce(function (s, e) { return s + (e.crew_outstanding || 0); }, 0);
      var groups = {};
      list.forEach(function (e) { (groups[e['class'] || 'No class'] = groups[e['class'] || 'No class'] || []).push(e); });
      var staff = !!S.boot.dept;
      var html = '<div class="row"><h1 class="grow">' + esc(d.event ? d.event.name : '') + '</h1>' +
        '<span class="muted small">' + (d.event ? fmtDate(d.event.start) + ' to ' + fmtDate(d.event.end) : '') + '</span></div>' +
        '<div class="counts">' +
        '<div class="count"><b>' + cleared + ' / ' + all.length + '</b><span>cleared to race</span></div>' +
        '<div class="count"><b>' + tech + '</b><span>waiting on tech</span></div>' +
        '<div class="count"><b>' + safety + '</b><span>waiting on safety</span></div>' +
        (staff ? '<div class="count"><b>' + crewOut + '</b><span>people not cleared yet</span></div>' : '') +
        '</div>' +
        '<div class="row" style="margin-bottom:6px"><div class="seg" role="group" aria-label="Show">' +
        [['not', 'Not cleared'], ['cleared', 'Cleared'], ['all', 'All']].map(function (f) {
          return '<button type="button" data-f="' + f[0] + '" class="' + (S.boardFilter === f[0] ? 'on' : '') + '" aria-pressed="' + (S.boardFilter === f[0]) + '">' + f[1] + '</button>';
        }).join('') + '</div>' +
        '<input type="search" id="bq" class="grow" style="max-width:340px" placeholder="' + (staff ? 'Boat, team, class or a person\u2019s name' : 'Find a boat number, team or class') + '" value="' + esc(S.boardQ) + '" aria-label="Find a boat"></div>';
      if (!all.length) html += '<div class="empty"><h2>No boats entered yet</h2><p>' + (can('setup') ? 'Enter boats under <a href="#setup">Events &amp; boats</a>.' : 'Boats appear here once the office enters them.') + '</p></div>';
      else if (!list.length) html += '<div class="empty">' + (S.boardFilter === 'not' ? 'Every boat is cleared to race.' : 'No boats match.') + '</div>';
      Object.keys(groups).sort().forEach(function (g) {
        html += '<div class="classhead">' + esc(g) + '</div><div class="boats">' + groups[g].map(function (e) {
          var tag = staff ? 'button type="button" data-e="' + esc(e.entry_id) + '"' : 'button type="button" data-tb="' + esc(e.boat_id) + '"';
          return '<' + tag + ' class="boat' + (e.cleared ? ' cleared' : '') + '">' + plate(e.boat_no) +
            '<div><div class="team">' + esc(e.team) + '</div><div class="cls">' + esc(e['class']) + '</div></div>' +
            '<div class="st">' + esc(e.text) + '</div>' + ticks(e.checks) + '</button>';
        }).join('') + '</div>';
      });
      if (staff) html = html.replace('<div class="classhead">', '<div id="bpeople"></div><div class="classhead">');
      var y = window.scrollY;
      var v = view(html);
      if (quiet) window.scrollTo(0, y);
      // staff typing a person's name here: show matching people above the boats
      var slot = $('#bpeople', v) || (staff && $('.empty', v) ? (function () { var d = document.createElement('div'); d.id = 'bpeople'; $('.empty', v).before(d); return d; })() : null);
      if (slot && S.boardQ.trim().length >= 2) {
        api('searchPeople', { q: S.boardQ, names_only: true }).then(function (people) {
          if (!people.length) return;
          slot.innerHTML = '<div class="classhead">People named \u201c' + esc(S.boardQ.trim()) + '\u201d</div>' + people.slice(0, 8).map(function (pp) {
            return '<button type="button" class="person" data-p="' + esc(pp.id) + '"><span><span class="nm">' + esc(pp.name) + '</span><br><span class="small muted">' +
              esc(pp.boats.map(function (b) { return b.role + ', ' + b.boat; }).join(' \u2022 ') || 'Not on a boat yet') + '</span></span>' + pill(pp.status) + '</button>';
          }).join('');
          $$('[data-p]', slot).forEach(function (x) { x.onclick = function () { go('person/' + x.dataset.p); }; });
        }, function () { });
      }
      $$('[data-f]', v).forEach(function (b) { b.onclick = function () { S.boardFilter = b.dataset.f; viewBoard(true); }; });
      var bq = $('#bq', v);
      bq.oninput = debounce(function () { S.boardQ = bq.value; viewBoard(true).then(function () { var x = $('#bq'); x.focus(); x.setSelectionRange(x.value.length, x.value.length); }); }, 250);
      $$('[data-e]', v).forEach(function (b) { b.onclick = function () { go('boat/' + b.dataset.e); }; });
      $$('[data-tb]', v).forEach(function (b) { b.onclick = function () { go('teamboat/' + b.dataset.tb); }; });
    }, fail);
  }

  /* =========================================================== */
  /* One boat                                                     */
  /* =========================================================== */
  function viewBoat(id) {
    return api('boat', { entry_id: id }).then(function (b) {
      var state = b.cleared ? 'cleared' : 'needs';
      var html = '<button class="back" type="button" onclick="history.back()">Back</button>' +
        '<div class="hero">' + plate(b.boat_no, true) + '<div><h1>' + esc(b.team) + '</h1><div class="muted">' + esc(b['class']) + ' at ' + esc(b.event ? b.event.name : '') + '</div></div></div>' +
        '<div class="banner ' + state + '">' + esc(b.text) + '</div>' +
        '<div class="two"><section class="panel"><h2>Checklist</h2><ul class="list">' + b.checks.map(function (k) {
          return '<li><span class="mark' + (k.ok ? ' y' : '') + '" aria-hidden="true">' + (k.ok ? '✓' : '✕') + '</span><div class="grow"><b>' + esc(k.label) + '</b>' +
            (k.detail ? '<div class="small muted">' + esc(k.detail) + '</div>' : '') +
            (k.key === 'entry' ? stampText(b.stamps, 'entry_paid', 'Marked paid', 'Marked unpaid') : '') +
            (k.key === 'tech' ? stampText(b.stamps, 'tech', 'Passed', 'Un-passed') || (b.tech_by ? '<div class="stamp">Passed by ' + esc(b.tech_by) + ', ' + esc(fmtWhen(b.tech_at)) + '</div>' : '') : '') +
            (k.key === 'safety' ? stampText(b.stamps, 'safety', 'Passed', 'Un-passed') || (b.safety_by ? '<div class="stamp">Passed by ' + esc(b.safety_by) + ', ' + esc(fmtWhen(b.safety_at)) + '</div>' : '') : '') +
            '</div>' + controlFor(k.key, b) + '</li>';
        }).join('') + '</ul>' +
        (can('tech') ? notesBox('tech_notes', 'Tech notes', b.tech_notes) : '') +
        (can('safety') ? notesBox('safety_notes', 'Safety notes', b.safety_notes) : '') +
        (can('entry') ? notesBox('notes', 'Office notes', b.notes) : '') +
        '</section><section class="panel"><div class="row"><h2 class="grow">People on this boat</h2><span class="muted small">' + (b.crew_total === 1 ? '1 person' : b.crew_total + ' people') + ', ' + b.crew_outstanding + ' not cleared</span></div>' +
        (b.crew.length ? b.crew.map(function (m) {
          return '<button type="button" class="person" data-p="' + esc(m.person_id) + '"><span><span class="nm">' + esc(m.name) + '</span> <span class="muted small">' + esc(m.role) + '</span></span>' + pill(m.status) + '</button>';
        }).join('') : '<p class="muted">Nobody is linked to this boat yet.</p>') +
        (can('people') ? '<details style="margin-top:14px"><summary class="btn ghost sm" style="display:inline-block">Add someone to this boat</summary><div id="addp" class="stack" style="margin-top:10px"></div></details>' : '') +
        (S.boot.dept === 'office' ? teamLinkBox(b) : '') +
        '</section></div>';
      var v = view(html);
      $$('[data-p]', v).forEach(function (x) { x.onclick = function () { go('person/' + x.dataset.p); }; });
      $$('[data-toggle]', v).forEach(function (x) {
        x.onclick = function () {
          api('setEntry', { entry_id: id, field: x.dataset.toggle, value: x.getAttribute('aria-pressed') !== 'true' })
            .then(function () { toast(x.getAttribute('aria-pressed') === 'true' ? 'Unmarked' : 'Marked passed'); viewBoat(id); }, fail);
        };
      });
      bindNotes(v, id);
      bindTeamLink(v, b);
      var ap = $('#addp', v);
      if (ap) addPersonForm(ap, b.boat_id, function () { viewBoat(id); });
    }, fail);
  }
  function controlFor(key, b) {
    var t = function (field, on, label) {
      return '<button type="button" class="bigcheck' + (on ? ' on' : '') + '" data-toggle="' + field + '" aria-pressed="' + on + '" aria-label="' + label + '">' + '✓' + '</button>';
    };
    if (key === 'tech' && can('tech')) return t('tech', b.tech, 'Tech passed');
    if (key === 'safety' && can('safety')) return t('safety', b.safety, 'Safety passed');
    if (key === 'entry' && can('entry')) return t('entry_paid', b.entry_paid, 'Entry paid');
    return '';
  }
  function notesBox(field, label, val) {
    return '<label class="f" style="margin-top:12px"><span>' + label + '</span><textarea rows="2" data-notes="' + field + '">' + esc(val) + '</textarea></label>';
  }
  function bindNotes(v, entryId) {
    $$('[data-notes]', v).forEach(function (t) {
      var orig = t.value;
      t.onblur = function () {
        if (t.value === orig) return;
        api('setEntry', { entry_id: entryId, field: t.dataset.notes, value: t.value }).then(function () { orig = t.value; toast('Notes saved'); }, fail);
      };
    });
  }
  function teamLinkBox() {
    return '<div class="note" style="margin-top:16px"><b>Team status link</b><div class="small">Send this to the owner. Anyone with it can see this boat’s status and what each person still needs, but not contact details.</div>' +
      '<div class="row" style="margin-top:8px"><input type="text" id="tl" readonly class="grow" aria-label="Team link"><button class="btn sm" type="button" id="tlc">Copy link</button></div></div>';
  }
  function bindTeamLink(v, b) {
    var box = $('#tl', v);
    if (!box) return;
    var set = function (tok) { box.value = location.href.split('#')[0].split('?')[0] + '?team=' + tok; };
    if (b.token) set(b.token);
    else api('teamToken', { boat_id: b.boat_id }).then(function (r) { set(r.token); }, fail);
    $('#tlc', v).onclick = function () { copy(box.value, box); };
  }
  function addPersonForm(el, boatId, after) {
    el.innerHTML = '<div class="grid2"><label class="f"><span>First name</span><input type="text" id="ap_f"></label><label class="f"><span>Last name</span><input type="text" id="ap_l"></label>' +
      '<label class="f"><span>Email</span><input type="email" id="ap_e"></label><label class="f"><span>Role on this boat</span><select id="ap_r">' + S.boot.roles.map(function (r) { return '<option' + (r === 'Crew' ? ' selected' : '') + '>' + esc(r) + '</option>'; }).join('') + '</select></label></div>' +
      '<p class="small muted">If this person already exists (same email, or same name with no email), they’re linked rather than duplicated.</p>' +
      '<button class="btn" type="button" id="ap_go">Add to boat</button>';
    $('#ap_go', el).onclick = function () {
      var first = $('#ap_f', el).value.trim(), last = $('#ap_l', el).value.trim();
      if (!first || !last) { toast('Enter a first and last name.', true); return; }
      api('addCrew', { boat_id: boatId, role: $('#ap_r', el).value, person: { first: first, last: last, email: $('#ap_e', el).value.trim() } })
        .then(function () { toast('Added ' + first + ' ' + last); after(); }, fail);
    };
  }

  /* =========================================================== */
  /* Registration desk                                            */
  /* =========================================================== */
  function viewDesk() {
    if (!S.event) { view(noEvent()); return; }
    var v = view('<h1>Registration</h1><p class="muted">Signing people in for <b>' + esc(eventName()) + '</b>.</p>' +
      '<input type="search" id="dq" class="search" placeholder="Name, boat number or team" aria-label="Search people" value="' + esc(S.deskQ) + '" autofocus>' +
      '<div id="dres" style="margin-top:14px"></div>');
    var input = $('#dq', v), res = $('#dres', v);
    var run = function () {
      S.deskQ = input.value;
      if (input.value.trim().length < 2) { res.innerHTML = '<div class="empty">Search a first or last name (or both), a boat number or a team. Searching a boat lists everyone on it.</div>'; return; }
      api('searchPeople', { q: input.value }).then(function (list) {
        res.innerHTML = list.length ? list.map(function (p) {
          return '<button type="button" class="person" data-p="' + esc(p.id) + '"><span><span class="nm">' + esc(p.name) + '</span><br><span class="small muted">' +
            esc(p.boats.map(function (b) { return b.role + ', ' + b.boat; }).join(' • ') || 'Not on a boat yet') + '</span></span>' + pill(p.status) + '</button>';
        }).join('') : '<div class="empty">Nobody found. Check the spelling, or search by boat number.' + (can('people') ? ' Walk-up crew can be added from their boat’s page.' : '') + '</div>';
        $$('[data-p]', res).forEach(function (x) { x.onclick = function () { go('person/' + x.dataset.p); }; });
      }, fail);
    };
    input.oninput = debounce(run, 250);
    run();
    input.focus();
  }

  function viewPerson(id) {
    return api('person', { id: id }).then(function (p) {
      var st = p.status, f = p.fields, edit = can('people');
      var signBtn = '';
      if (can('sign')) {
        if (st.signed) signBtn = '<button class="btn ghost sm" type="button" id="unsign">Undo signature</button>';
        else if (st.state === 'ready') signBtn = '<button class="btn go big" type="button" id="sign">Mark signed for ' + esc(eventName()) + '</button>';
        else signBtn = '<button class="btn big" type="button" disabled>Can’t sign yet</button>' +
          (S.boot.dept === 'office' ? ' <button class="btn stop sm" type="button" id="force">Sign anyway (office)</button>' : '');
      }
      var reqRow = function (key, label) {
        var on = !!f[key];
        return '<div>' + (edit ? '<label class="toggle' + (on ? ' on' : '') + '"><input type="checkbox" data-k="' + key + '"' + (on ? ' checked' : '') + '>' + label + '</label>'
          : '<div class="toggle' + (on ? ' on' : '') + '">' + (on ? '✓ ' : '✕ ') + label + '</div>') +
          stampText(p.stamps, key, 'Checked', 'Unchecked') + '</div>';
      };
      var expOf = { medical: f.medical_exp, dunker: f.dunker_exp };
      var html = '<button class="back" type="button" onclick="history.back()">Back</button>' +
        '<div class="hero"><div><h1>' + esc(p.name) + '</h1><div class="muted">' + esc([f.email, f.phone].filter(Boolean).join(' • ')) + '</div></div></div>' +
        '<div class="banner ' + st.state + '">' + esc(st.text) + '</div>' +
        '<div class="two"><section class="panel stack"><h2>' + esc(eventName()) + '</h2>' +
        '<p class="small muted">Checked as: ' + esc(st.roles.join(', ')) + '. Medical and dunker must be valid through the last day of the event.</p>' +
        '<ul class="list">' + st.checks.map(function (k) {
          var key = k.key === 'medical' ? 'medical_exp' : k.key === 'dunker' ? 'dunker_exp' : k.key;
          var extra = k.key in expOf ? (expOf[k.key] ? ' <span class="muted small">expires ' + esc(fmtDate(expOf[k.key])) + '</span>' : ' <span class="muted small">no date on file</span>') : '';
          return '<li><span class="mark' + (k.ok ? ' y' : '') + '" aria-hidden="true">' + (k.ok ? '✓' : '✕') + '</span><div><b>' + esc(k.label) + '</b>' + extra +
            stampText(p.stamps, key, k.key in expOf ? 'Date entered' : 'Checked', k.key in expOf ? 'Date cleared' : 'Unchecked') + '</div></li>';
        }).join('') + '<li><span class="mark' + (st.signed ? ' y' : '') + '" aria-hidden="true">' + (st.signed ? '✓' : '✕') + '</span><div><b>Signed at registration</b>' +
          (st.signed ? '<div class="stamp">Signed with ' + esc(st.signed_by || 'unknown') + ', ' + esc(fmtWhen(st.signed_at)) + '</div>' + (st.sign_note ? '<div class="stamp warn">' + esc(st.sign_note) + '</div>' : '') : '') +
          '</div></li></ul>' +
        signBtn + '</section>' +
        '<section class="panel stack"><h2>Memberships and certificates</h2><div class="grid2">' +
        reqRow('rwo_member', 'RWO member') + reqRow('rwo_paid', 'RWO paid') + reqRow('apba_member', 'APBA member') + reqRow('apba_paid', 'APBA paid') + '</div>' +
        '<div class="grid2"><div><label class="f"><span>APBA number</span><input type="text" data-v="apba_no" value="' + esc(f.apba_no) + '"' + (edit ? '' : ' disabled') + '></label>' + stampText(p.stamps, 'apba_no', 'Entered', 'Cleared') + '</div>' +
        '<div><div class="f"><span style="display:block;margin-bottom:4px">Medical expires</span></div><div id="d_med"></div>' + stampText(p.stamps, 'medical_exp', 'Entered', 'Cleared') + '</div>' +
        '<div><div class="f"><span style="display:block;margin-bottom:4px">Dunker / swim expires</span></div><div id="d_dunk"></div>' + stampText(p.stamps, 'dunker_exp', 'Entered', 'Cleared') + '</div></div>' +
        '<h3>Boats</h3>' + (p.crew.length ? '<table class="table"><tr><th>Boat</th><th>Role</th>' + (edit ? '<th></th>' : '') + '</tr>' + p.crew.map(function (c) {
          return '<tr><td>' + esc(c.boat) + (c.events.length ? '<div class="small muted">Only: ' + esc(c.events.join(', ')) + '</div>' : '') + '</td><td>' +
            (edit ? '<select data-crew="' + esc(c.crew_id) + '" aria-label="Role">' + S.boot.roles.map(function (r) { return '<option' + (r === c.role ? ' selected' : '') + '>' + esc(r) + '</option>'; }).join('') + '</select>' : esc(c.role)) + '</td>' +
            (edit ? '<td><button class="btn stop sm" type="button" data-rm="' + esc(c.crew_id) + '">Remove</button></td>' : '') + '</tr>';
        }).join('') + '</table>' : '<p class="muted">Not on a boat yet.</p>') +
        (edit ? '<div><label class="f"><span>Add to another boat</span></label><div id="addboat"></div></div>' : '') +
        '</section></div>';
      var v = view(html);
      var save = function (patch) { return api('updatePerson', { id: id, patch: patch }).then(function () { toast('Saved'); viewPerson(id); }, fail); };
      $$('[data-k]', v).forEach(function (c) { c.onchange = function () { var o = {}; o[c.dataset.k] = c.checked; save(o); }; });
      $$('[data-v]', v).forEach(function (c) { var orig = c.value; c.onchange = function () { if (c.value !== orig) { var o = {}; o[c.dataset.v] = c.value; save(o); } }; });
      dateField($('#d_med', v), { value: f.medical_exp, label: 'Medical expires', disabled: !edit, onSave: function (d) { save({ medical_exp: d }); } });
      dateField($('#d_dunk', v), { value: f.dunker_exp, label: 'Dunker / swim expires', disabled: !edit, onSave: function (d) { save({ dunker_exp: d }); } });
      $$('[data-crew]', v).forEach(function (s) { s.onchange = function () { api('updateCrew', { crew_id: s.dataset.crew, role: s.value }).then(function () { toast('Role changed'); viewPerson(id); }, fail); }; });
      $$('[data-rm]', v).forEach(function (b) {
        b.onclick = function () {
          ask('Remove ' + p.name + ' from this boat?', 'Remove').then(function (yes) {
            if (yes) api('updateCrew', { crew_id: b.dataset.rm, remove: true }).then(function () { toast('Removed'); viewPerson(id); }, fail);
          });
        };
      });
      var sign = $('#sign', v); if (sign) sign.onclick = function () { api('sign', { person_id: id }).then(function () { toast(p.name + ' signed'); viewPerson(id); }, fail); };
      var force = $('#force', v); if (force) force.onclick = function () {
        ask(p.name + ' is missing: ' + st.missing.join(', ') + '. Sign anyway? This is recorded in the history.', 'Sign anyway').then(function (yes) {
          if (yes) api('sign', { person_id: id, override: true }).then(function () { toast(p.name + ' signed'); viewPerson(id); }, fail);
        });
      };
      var un = $('#unsign', v); if (un) un.onclick = function () { api('unsign', { person_id: id }).then(function () { toast('Signature removed'); viewPerson(id); }, fail); };
      var ab = $('#addboat', v);
      if (ab) boatPicker(ab, {
        source: function (q) { return api('searchBoats', { q: q }); },
        onPick: function (b) { api('addCrew', { person_id: id, boat_id: b.id, role: 'Crew' }).then(function () { toast('Added to ' + b.label); viewPerson(id); }, fail); }
      });
    }, fail);
  }

  /* =========================================================== */
  /* Tech and safety                                              */
  /* =========================================================== */
  function viewInspect(field, quiet) {
    if (!S.event) { view(noEvent()); return; }
    var label = field === 'tech' ? 'Tech' : 'Safety';
    return api('board').then(function (d) {
      var all = d.entries, q = n(S.inspectQ);
      var list = all.filter(function (e) {
        if (S.inspectFilter === 'todo' && e[field]) return false;
        if (S.inspectFilter === 'done' && !e[field]) return false;
        return !q || n(e.boat_no).indexOf(q) === 0 || n(e.team).indexOf(q) >= 0;
      });
      var done = all.filter(function (e) { return e[field]; }).length;
      var html = '<div class="row"><h1 class="grow">' + label + ' inspection</h1><span class="muted"><b>' + done + '</b> of ' + all.length + ' passed</span></div>' +
        '<div class="row" style="margin:14px 0"><div class="seg" role="group" aria-label="Show">' + [['todo', 'To do'], ['done', 'Passed'], ['all', 'All']].map(function (f) {
          return '<button type="button" data-f="' + f[0] + '" class="' + (S.inspectFilter === f[0] ? 'on' : '') + '" aria-pressed="' + (S.inspectFilter === f[0]) + '">' + f[1] + '</button>';
        }).join('') + '</div><input type="search" id="iq" class="grow" style="max-width:300px" placeholder="Boat number or team" value="' + esc(S.inspectQ) + '" aria-label="Find a boat"></div>' +
        (list.length ? list.map(function (e) {
          var on = !!e[field];
          return '<div class="inspect' + (on ? ' done' : '') + '">' + plate(e.boat_no) +
            '<div><div class="team" style="font:700 19px/1.1 var(--cond)">' + esc(e.team) + '</div><div class="small muted">' + esc(e['class']) +
            (on && e[field + '_by'] ? ' • passed by ' + esc(e[field + '_by']) + ' ' + esc(e[field + '_at']) : '') + '</div>' +
            '<input type="text" data-notes="' + field + '_notes" data-e="' + esc(e.entry_id) + '" value="' + esc(e[field + '_notes']) + '" placeholder="Notes" aria-label="Notes for ' + esc(e.boat_no) + '" style="margin-top:6px;min-height:38px;padding:6px 10px"></div>' +
            '<button type="button" class="bigcheck' + (on ? ' on' : '') + '" data-t="' + esc(e.entry_id) + '" aria-pressed="' + on + '" aria-label="' + label + ' passed for boat ' + esc(e.boat_no) + '">' + '✓' + '</button></div>';
        }).join('') : '<div class="empty">' + (S.inspectFilter === 'todo' ? 'Every boat has passed ' + label.toLowerCase() + '.' : 'No boats match.') + '</div>');
      var y = window.scrollY;
      var v = view(html);
      if (quiet) window.scrollTo(0, y);
      $$('[data-f]', v).forEach(function (b) { b.onclick = function () { S.inspectFilter = b.dataset.f; viewInspect(field, true); }; });
      var iq = $('#iq', v);
      iq.oninput = debounce(function () { S.inspectQ = iq.value; viewInspect(field, true).then(function () { var x = $('#iq'); x.focus(); x.setSelectionRange(x.value.length, x.value.length); }); }, 250);
      $$('[data-t]', v).forEach(function (b) {
        b.onclick = function () {
          var val = b.getAttribute('aria-pressed') !== 'true';
          b.disabled = true;
          api('setEntry', { entry_id: b.dataset.t, field: field, value: val }).then(function () {
            toast(val ? label + ' passed' : label + ' unmarked'); viewInspect(field, true);
          }, function (e) { b.disabled = false; fail(e); });
        };
      });
      $$('[data-notes]', v).forEach(function (t) {
        var orig = t.value;
        t.onchange = function () { api('setEntry', { entry_id: t.dataset.e, field: t.dataset.notes, value: t.value }).then(function () { orig = t.value; toast('Notes saved'); }, fail); };
      });
    }, fail);
  }

  /* =========================================================== */
  /* Office inbox: sign-ups the system wasn't sure about          */
  /* =========================================================== */
  function viewInbox() {
    return api('inbox').then(function (list) {
      var nDecide = list.filter(function (s) { return s.status !== 'No match yet'; }).length;
      S.inboxCount = nDecide;
      var tab = $('.tabs a[href="#inbox"]');
      if (tab) tab.innerHTML = 'Office inbox' + (nDecide ? ' <span class="n">' + nDecide + '</span>' : '');
      var card = function (s) {
          return '<section class="panel" style="margin-top:12px" data-s="' + esc(s.id) + '"><div class="row"><h3 class="grow">' + esc(s.name) + '</h3><span class="muted small">' + esc(s.role) + ' \u2022 ' + esc(fmtWhen(s.created)) + '</span></div>' +
            '<div class="small muted">' + esc([s.email, s.phone].filter(Boolean).join(' \u2022 ')) + '</div>' +
            (s.note ? '<p class="small" style="margin:8px 0 0"><b>' + esc(s.note) + '</b></p>' : '') +
            '<p style="margin:10px 0 0">They typed team <b>\u201c' + esc(s.typed_team || '(blank)') + '\u201d</b> and boat <b>\u201c' + esc(s.typed_boat || '(blank)') + '\u201d</b></p>' +
            (s.suggestions.length ? '<div class="suggest">' + s.suggestions.map(function (b) {
              return '<button type="button" class="btn go sm" data-link="' + esc(b.id) + '">Put on ' + esc(b.label) + '</button>';
            }).join('') + '</div>' : '') +
            '<div class="row" style="margin-top:10px"><div class="grow picker-slot"></div></div>' +
            '<div class="row" style="margin-top:10px"><label class="small"><input type="checkbox" class="rem" checked> Remember this spelling</label>' +
            '<span class="grow"></span><button type="button" class="btn ghost sm" data-ignore>Not a race sign-up</button></div></section>';
      };
      var decide = list.filter(function (s) { return s.status !== 'No match yet'; });
      var waiting = list.filter(function (s) { return s.status === 'No match yet'; });
      var html = '<h1>Office inbox</h1>' +
        '<h2 style="margin-top:18px">Needs a decision <span class="muted small" style="font-family:var(--body);font-weight:400">' + decide.length + '</span></h2>' +
        (decide.length ? '<p class="muted small">Two boats fit equally well. Pick one; the spelling is remembered so it won\u2019t be asked again.</p>' + decide.map(card).join('')
          : '<p class="muted">Nothing to decide. Everyone who could be matched was placed automatically.</p>') +
        '<h2 style="margin-top:26px">Waiting for their boat to register <span class="muted small" style="font-family:var(--body);font-weight:400">' + waiting.length + '</span></h2>' +
        (waiting.length ? '<p class="muted small">These people signed up before their boat did. They\u2019re placed automatically as soon as their boat registers, and you can find them by name under Registration. Nothing to do unless you know their boat.</p>' + waiting.map(card).join('')
          : '<p class="muted">Nobody waiting.</p>');
      var v = view(html);
      $$('[data-s]', v).forEach(function (card) {
        var id = card.dataset.s;
        var resolve = function (boatId, label) {
          api('resolveSignup', { id: id, boat_ids: [boatId], remember: $('.rem', card).checked }).then(function () { toast('Linked to ' + label); viewInbox(); }, fail);
        };
        $$('[data-link]', card).forEach(function (b) { b.onclick = function () { resolve(b.dataset.link, b.textContent.replace(/^Put on /, '')); }; });
        boatPicker($('.picker-slot', card), {
          placeholder: 'Or find the right boat',
          source: function (q) { return api('searchBoats', { q: q }); },
          onPick: function (b) { resolve(b.id, b.label); }
        });
        $('[data-ignore]', card).onclick = function () { api('resolveSignup', { id: id, ignore: true }).then(function () { toast('Removed from inbox'); viewInbox(); }, fail); };
      });
    }, fail);
  }

  /* =========================================================== */
  /* Events & boats (office setup)                                */
  /* =========================================================== */
  function viewSetup() {
    return api('setup').then(function (d) {
      var ev = S.event;
      var evName = eventName();
      var html = '<h1>Events &amp; boats</h1>' +
        '<section class="panel" style="margin-top:14px"><h2>Events</h2>' +
        (d.events.length ? '<table class="table"><tr><th>Event</th><th>Dates</th><th>Sign-up open</th><th></th></tr>' + d.events.map(function (e) {
          return '<tr><td><b>' + esc(e.name) + '</b>' + (e.current ? ' <span class="pill cleared">Current</span>' : '') + '<div class="small muted">' + esc(e.location) + '</div></td>' +
            '<td class="small">' + fmtDate(e.start) + ' to ' + fmtDate(e.end) + '</td><td>' + (e.signup_open ? 'Yes' : 'No') + '</td>' +
            '<td class="row">' + (e.current ? '' : '<button class="btn ghost sm" type="button" data-cur="' + esc(e.id) + '">Make current</button>') +
            '<button class="btn ghost sm" type="button" data-edit-ev="' + esc(e.id) + '">Edit</button></td></tr>';
        }).join('') + '</table>' : '<p class="muted">No events yet. Add the first race below.</p>') +
        '<details style="margin-top:12px" id="evform"' + (d.events.length ? '' : ' open') + '><summary class="btn sm" style="display:inline-block">Add an event</summary>' +
        '<div class="grid2" style="margin-top:12px"><input type="hidden" id="e_id">' +
        '<label class="f"><span>Name</span><input type="text" id="e_name" placeholder="Key West Worlds 2027"></label>' +
        '<label class="f"><span>Location</span><input type="text" id="e_loc"></label>' +
        '<div><div class="f"><span style="display:block;margin-bottom:4px">First day</span></div><div id="e_start"></div></div>' +
        '<div><div class="f"><span style="display:block;margin-bottom:4px">Last day</span></div><div id="e_end"></div></div></div>' +
        '<label class="toggle" style="margin-top:10px;display:inline-flex"><input type="checkbox" id="e_open" checked> Crew can sign up for this event</label>' +
        '<p class="small muted">Medical and dunker dates are checked against the last day.</p><button class="btn" type="button" id="e_save">Save event</button></details></section>' +

        '<section class="panel" style="margin-top:16px"><div class="row"><h2 class="grow">Boats</h2>' +
        (ev ? '<span class="muted small">Tick a boat to enter it in <b>' + esc(evName) + '</b></span>' : '') + '</div>' +
        '<input type="search" id="bsq" placeholder="Find a boat" aria-label="Find a boat" style="margin-bottom:10px">' +
        '<div style="overflow-x:auto"><table class="table" id="btable"><tr><th>Entered</th><th>Boat</th><th>Team</th><th>Class</th><th>Owner</th><th></th></tr>' +
        d.boats.map(function (b) {
          var inEv = ev && b.events.indexOf(ev) >= 0;
          return '<tr data-row="' + esc(n(b.boat_no + ' ' + b.team + ' ' + b['class'])) + '"><td>' + (ev ? '<input type="checkbox" data-enter="' + esc(b.id) + '"' + (inEv ? ' checked' : '') + ' aria-label="Entered in ' + esc(evName) + '" style="width:24px;height:24px">' : '') + '</td>' +
            '<td>' + plate(b.boat_no) + '</td><td><b>' + esc(b.team) + '</b>' + (b.active ? '' : ' <span class="muted small">(inactive)</span>') + '</td><td>' + esc(b['class']) + '</td>' +
            '<td class="small">' + esc([b.owner_first, b.owner_last].join(' ').trim()) + '<div class="muted">' + esc(b.owner_email) + '</div></td>' +
            '<td><button class="btn ghost sm" type="button" data-edit-b="' + esc(b.id) + '">Edit</button></td></tr>';
        }).join('') + '</table></div>' +
        '<details style="margin-top:12px" id="bform"><summary class="btn sm" style="display:inline-block">Add a boat</summary>' +
        '<div class="grid2" style="margin-top:12px"><input type="hidden" id="b_id">' +
        '<label class="f"><span>Boat number</span><input type="text" id="b_no" placeholder="S-21"></label>' +
        '<label class="f"><span>Team name</span><input type="text" id="b_team"></label>' +
        '<label class="f"><span>Class</span><input type="text" id="b_class" list="classes"></label>' +
        '<label class="f"><span>Owner first name</span><input type="text" id="b_of"></label>' +
        '<label class="f"><span>Owner last name</span><input type="text" id="b_ol"></label>' +
        '<label class="f"><span>Owner email</span><input type="email" id="b_oe"></label>' +
        '<label class="f"><span>Owner phone</span><input type="tel" id="b_op"></label></div>' +
        '<datalist id="classes">' + uniq(d.boats.map(function (b) { return b['class']; })).map(function (c) { return '<option value="' + esc(c) + '">'; }).join('') + '</datalist>' +
        '<label class="toggle" style="margin-top:10px;display:inline-flex"><input type="checkbox" id="b_active" checked> Active this season</label> ' +
        '<button class="btn" type="button" id="b_save" style="margin-top:10px">Save boat</button></details></section>' +

        '<section class="panel" style="margin-top:16px"><h2>Import from Airtable</h2>' +
        '<p class="small">Export your Airtable <b>Teams</b> view and <b>Memberships</b> view as CSV files and choose them here. Boats are entered into <b>' + esc(evName) + '</b>. ' +
        'Everyone goes through the same matching as a new sign-up, and anyone it isn’t sure about lands in the Office inbox. Running it twice won’t create duplicates.</p>' +
        '<div class="grid2"><label class="f"><span>Teams CSV</span><input type="file" id="imp_t" accept=".csv,text/csv"></label>' +
        '<label class="f"><span>Memberships CSV</span><input type="file" id="imp_m" accept=".csv,text/csv"></label></div>' +
        '<button class="btn" type="button" id="imp_go" style="margin-top:10px"' + (ev ? '' : ' disabled') + '>Import</button><div id="imp_res" class="small" style="margin-top:8px"></div></section>';
      var v = view(html);
      var dStart = dateField($('#e_start', v), { label: 'First day' }), dEnd = dateField($('#e_end', v), { label: 'Last day' });

      $$('[data-cur]', v).forEach(function (b) {
        b.onclick = function () {
          api('setCurrentEvent', { id: b.dataset.cur }).then(function () { S.event = b.dataset.cur; ss('set', 'rwo_event', S.event); return boot(); }).then(function () { toast('Current event changed'); render(); }, fail);
        };
      });
      $$('[data-edit-ev]', v).forEach(function (b) {
        b.onclick = function () {
          var e = d.events.filter(function (x) { return x.id === b.dataset.editEv; })[0];
          $('#e_id').value = e.id; $('#e_name').value = e.name; $('#e_loc').value = e.location; dStart = dateField($('#e_start'), { label: 'First day', value: e.start }); dEnd = dateField($('#e_end'), { label: 'Last day', value: e.end }); $('#e_open').checked = e.signup_open;
          $('#evform').open = true; $('#e_name').focus();
        };
      });
      $('#e_save', v).onclick = function () {
        var ds = dStart.get(), de = dEnd.get();
        if (!$('#e_name').value.trim() || !de) { toast('Give the event a name and a last day.', true); return; }
        if (ds === null) { toast('The first day isn\u2019t a real date.', true); return; }
        api('saveEvent', { id: $('#e_id').value, name: $('#e_name').value.trim(), location: $('#e_loc').value.trim(), start: ds, end: de, signup_open: $('#e_open').checked })
          .then(function () { return boot(); }).then(function () { if (!S.event && S.boot.current_event_id) S.event = S.boot.current_event_id; toast('Event saved'); render(); }, fail);
      };
      $$('[data-enter]', v).forEach(function (c) {
        c.onchange = function () {
          api('enterBoat', { event_id: ev, boat_id: c.dataset.enter, remove: !c.checked }).then(function () { toast(c.checked ? 'Entered in ' + evName : 'Removed from ' + evName); }, function (e) { c.checked = !c.checked; fail(e); });
        };
      });
      $$('[data-edit-b]', v).forEach(function (b) {
        b.onclick = function () {
          var x = d.boats.filter(function (y) { return y.id === b.dataset.editB; })[0];
          $('#b_id').value = x.id; $('#b_no').value = x.boat_no; $('#b_team').value = x.team; $('#b_class').value = x['class'];
          $('#b_of').value = x.owner_first; $('#b_ol').value = x.owner_last; $('#b_oe').value = x.owner_email; $('#b_op').value = x.owner_phone; $('#b_active').checked = x.active;
          $('#bform').open = true; $('#b_no').focus();
        };
      });
      $('#b_save', v).onclick = function () {
        if (!$('#b_team').value.trim()) { toast('Team name is required.', true); return; }
        api('saveBoat', { id: $('#b_id').value, boat_no: $('#b_no').value, team: $('#b_team').value, 'class': $('#b_class').value, owner_first: $('#b_of').value,
          owner_last: $('#b_ol').value, owner_email: $('#b_oe').value, owner_phone: $('#b_op').value, active: $('#b_active').checked })
          .then(function () { toast('Boat saved'); viewSetup(); }, fail);
      };
      var bsq = $('#bsq', v);
      bsq.oninput = function () { var q = n(bsq.value); $$('#btable tr[data-row]').forEach(function (tr) { tr.classList.toggle('hide', q && tr.dataset.row.indexOf(q) < 0); }); };
      $('#imp_go', v).onclick = function () {
        var ft = $('#imp_t').files[0], fm = $('#imp_m').files[0];
        if (!ft && !fm) { toast('Choose at least one CSV file.', true); return; }
        Promise.all([readCsv(ft), readCsv(fm)]).then(function (r) {
          $('#imp_res').textContent = 'Importing ' + r[0].length + ' boats and ' + r[1].length + ' people…';
          return api('import', { teams: r[0], members: r[1] });
        }).then(function (res) {
          $('#imp_res').innerHTML = '<b>Done.</b> ' + res.boats + ' new boats, ' + res.entries + ' entered in ' + esc(res.event) + ', ' + res.people + ' new people, ' +
            res.linked + ' placed on boats automatically, ' + res.review + ' waiting in the <a href="#inbox">Office inbox</a>.';
        }, function (e) { $('#imp_res').textContent = ''; fail(e); });
      };
    }, fail);
  }
  function uniq(a) { var o = {}; a.forEach(function (x) { if (x) o[x] = 1; }); return Object.keys(o).sort(); }
  function readCsv(file) {
    if (!file) return Promise.resolve([]);
    return file.text().then(function (txt) {
      var rows = parseCsv(txt.replace(/^﻿/, ''));
      var head = rows.shift() || [];
      return rows.filter(function (r) { return r.some(function (x) { return x !== ''; }); }).map(function (r) {
        var o = {}; head.forEach(function (h, i) { o[h.trim()] = r[i] == null ? '' : r[i]; }); return o;
      });
    });
  }
  function parseCsv(t) {
    var rows = [], row = [], f = '', q = false;
    for (var i = 0; i < t.length; i++) {
      var c = t[i];
      if (q) { if (c === '"' && t[i + 1] === '"') { f += '"'; i++; } else if (c === '"') q = false; else f += c; }
      else if (c === '"') q = true;
      else if (c === ',') { row.push(f); f = ''; }
      else if (c === '\n' || c === '\r') { if (c === '\r' && t[i + 1] === '\n') i++; row.push(f); rows.push(row); row = []; f = ''; }
      else f += c;
    }
    if (f !== '' || row.length) { row.push(f); rows.push(row); }
    return rows;
  }

  /* =========================================================== */
  /* History: who did what, when                                  */
  /* =========================================================== */
  function viewHistory() {
    var v = view('<h1>History</h1><p class="muted">Every check and change, newest first, with who made it. Search a person, boat, team or staff name.</p>' +
      '<input type="search" id="hq" class="search" placeholder="e.g. Smith, S-21, Jess, Tech passed" aria-label="Search history">' +
      '<div id="hres" style="margin-top:14px"></div>');
    var input = $('#hq', v), res = $('#hres', v);
    var run = function () {
      api('history', { q: input.value }).then(function (rows) {
        res.innerHTML = rows.length ? '<div style="overflow-x:auto"><table class="table"><tr><th>When</th><th>Who</th><th>What</th></tr>' + rows.map(function (r) {
          return '<tr><td class="small" style="white-space:nowrap">' + esc(fmtWhen(r.at)) + '<div class="muted">' + esc(String(r.at).slice(0, 10)) + '</div></td><td class="small"><b>' + esc(r.who) + '</b></td><td>' + esc(r.detail) + '</td></tr>';
        }).join('') + '</table></div>' + (rows.length >= 300 ? '<p class="small muted">Showing the newest 300. Search to narrow it down.</p>' : '')
          : '<div class="empty">' + (input.value ? 'Nothing matches.' : 'No changes yet.') + '</div>';
      }, fail);
    };
    input.oninput = debounce(run, 300);
    run();
  }

  /* =========================================================== */
  /* Team page (private link for an owner)                        */
  /* =========================================================== */
  function viewTeam(token, byBoat) {
    var call = byBoat ? api('teamBoat', { boat_id: token }) : api('team', { token: token });
    return call.then(function (t) {
      var open = {};
      $$('details.pdetail[open]').forEach(function (d) { open[d.dataset.k] = 1; });
      var dateLine = function (label, iso, ok, needed) {
        if (!needed) return '';
        return '<li><span class="mark' + (ok ? ' y' : '') + '" aria-hidden="true">' + (ok ? '\u2713' : '\u2715') + '</span><div><b>' + label + '</b> ' +
          (iso ? '<span class="' + (ok ? 'muted' : 'bad-date') + '">' + (ok ? 'expires ' : 'expired or expires during the race: ') + esc(fmtDate(iso)) + '</span>' : '<span class="bad-date">no date on file</span>') + '</div></li>';
      };
      var html = (byBoat ? '<button class="back" type="button" onclick="history.back()">Back to all boats</button>' : '') +
        '<div class="hero">' + plate(t.boat.boat_no, true) + '<div><h1>' + esc(t.boat.team) + '</h1><div class="muted">' + esc(t.boat['class']) + '</div></div></div>' +
        (t.entries.length ? t.entries.map(function (e) {
          return '<section class="panel" style="margin-bottom:16px"><div class="row"><h2 class="grow">' + esc(e.event.name) + '</h2><span class="muted small">' + fmtDate(e.event.start) + ' to ' + fmtDate(e.event.end) + '</span></div>' +
            '<div class="banner ' + (e.cleared ? 'cleared' : 'needs') + '">' + esc(e.text) + '</div>' +
            '<ul class="list">' + e.checks.map(function (k) {
              return '<li><span class="mark' + (k.ok ? ' y' : '') + '" aria-hidden="true">' + (k.ok ? '\u2713' : '\u2715') + '</span><div><b>' + esc(k.label) + '</b>' +
                (k.detail ? '<div class="small muted">' + esc(k.detail) + '</div>' : '') + '</div></li>';
            }).join('') + '</ul>' +
            '<h3 style="margin:18px 0 8px">People <span class="muted small" style="font-family:var(--body);font-weight:400">tap a name to see what they still need</span></h3>' +
            (e.crew.length ? e.crew.map(function (m) {
              var st = m.status, key = e.entry_id + m.person_id;
              var need = function (k) { return st.checks.some(function (x) { return x.key === k; }); };
              var ok = function (k) { return st.checks.some(function (x) { return x.key === k && x.ok; }); };
              return '<details class="pdetail" data-k="' + esc(key) + '"' + (open[key] ? ' open' : '') + '><summary class="person"><span><span class="nm">' + esc(m.name) + '</span> <span class="muted small">' + esc(m.role) + '</span></span>' + pill(st) + '</summary>' +
                '<ul class="list pd">' + st.checks.filter(function (x) { return x.key !== 'medical' && x.key !== 'dunker'; }).map(function (x) {
                  return '<li><span class="mark' + (x.ok ? ' y' : '') + '" aria-hidden="true">' + (x.ok ? '\u2713' : '\u2715') + '</span><div><b>' + esc(x.label) + '</b>' + (x.ok ? '' : ' <span class="bad-date">missing</span>') + '</div></li>';
                }).join('') +
                dateLine('Medical', m.medical_exp, ok('medical'), need('medical')) +
                dateLine('Dunker / swim', m.dunker_exp, ok('dunker'), need('dunker')) +
                '<li><span class="mark' + (st.signed ? ' y' : '') + '" aria-hidden="true">' + (st.signed ? '\u2713' : '\u2715') + '</span><div><b>Signed at registration</b> ' +
                (st.signed ? '<span class="muted">' + esc(fmtWhen(st.signed_at)) + '</span>' : '<span class="muted">' + (st.state === 'ready' ? 'ready: come to registration' : 'after everything above is done') + '</span>') + '</div></li>' +
                '</ul></details>';
            }).join('') : '<p class="muted">Nobody is linked to this boat yet. Have your crew sign up and pick this boat.</p>') + payPanel(e, e.crew) + '</section>';
        }).join('') : '<div class="empty">This boat isn\u2019t entered in an event yet.</div>') +
        '<p class="small muted">This page updates on its own. Medical and dunker must be valid through the last day of the race. Something wrong or missing? Contact the ' + esc(t.org) + ' office.</p>';
      var tv = view(html);
      bindPayPanels(tv, function () { S.payTouched = false; viewTeam(token, byBoat); });
    }, function (e) { view('<div class="empty"><h2>' + (byBoat ? 'Team page not available' : 'Link not recognized') + '</h2><p>' + esc(e.message) + '</p></div>'); });
  }

  /* =========================================================== */
  /* Crew sign-up (public)                                        */
  /* =========================================================== */
  function viewSignup() {
    return api('signupOptions').then(function (o) {
      if (!o.events.length) { view('<div class="center empty"><h1>Sign-up is closed</h1><p>Crew sign-up opens a few weeks before each race.</p></div>'); return; }
      var picked = [];
      var html = '<div class="center"><h1>Crew sign-up</h1><p>One form per person. Everyone who rides in a boat or works in the restricted area needs to sign up.</p>' +
        '<div class="panel stack">' +
        '<div class="grid2"><label class="f"><span>First name</span><input type="text" id="s_f" autocomplete="given-name"></label><label class="f"><span>Last name</span><input type="text" id="s_l" autocomplete="family-name"></label></div>' +
        '<label class="f"><span>Email (your own; each person needs a different one)</span><input type="email" id="s_e" autocomplete="email"></label>' +
        '<label class="f"><span>Cell phone</span><input type="tel" id="s_p" autocomplete="tel"></label>' +
        '<label class="f"><span>Your role</span><select id="s_r">' + o.roles.map(function (r) { return '<option' + (r === 'Crew' ? ' selected' : '') + '>' + esc(r) + '</option>'; }).join('') + '</select></label>' +
        '<div><div class="f"><span style="display:block;font-weight:600;font-size:14px;margin-bottom:4px">Which boat are you on?</span></div><div id="s_pick"></div><div id="s_chips" class="suggest"></div>' +
        '<button type="button" class="linkbtn" id="s_notlisted" style="color:var(--ink-2);padding-left:0">My boat/team is not listed</button>' +
        '<div id="s_typed" class="grid2 hide"><label class="f"><span>Team name</span><input type="text" id="s_tt"></label><label class="f"><span>Boat number</span><input type="text" id="s_tb"></label></div></div>' +
        '<button class="btn big go" type="button" id="s_go">Sign up</button></div>' +
        (o.note ? '<p class="note" style="margin-top:14px">' + esc(o.note) + '</p>' : '') + '</div>';
      var v = view(html);
      var chips = $('#s_chips', v);
      var drawChips = function () {
        chips.innerHTML = picked.map(function (b, i) { return '<span class="chip">' + esc(b.label) + '<button type="button" data-x="' + i + '" aria-label="Remove ' + esc(b.label) + '">✕</button></span>'; }).join('');
        $$('[data-x]', chips).forEach(function (x) { x.onclick = function () { picked.splice(+x.dataset.x, 1); drawChips(); }; });
      };
      boatPicker($('#s_pick', v), {
        source: localBoatSearch(o.boats),
        onPick: function (b) { if (!picked.some(function (p) { return p.id === b.id; })) picked.push(b); drawChips(); }
      });
      $('#s_notlisted', v).onclick = function () { $('#s_typed').classList.toggle('hide'); $('#s_tt').focus(); };
      $('#s_go', v).onclick = function () {
        var btn = this;
        btn.disabled = true;
        api('submitSignup', {
          first: $('#s_f').value, last: $('#s_l').value, email: $('#s_e').value, phone: $('#s_p').value, role: $('#s_r').value,
          picked_boat_ids: picked.map(function (p) { return p.id; }), typed_team: $('#s_tt').value, typed_boat: $('#s_tb').value,
          event_ids: [] // blank = races every event with this boat
        }).then(function (r) {
          view('<div class="center"><div class="banner ' + (r.status === 'Linked' ? 'cleared' : 'ready') + '">' + (r.status === 'Linked' ? 'You’re signed up' : 'Sign-up received') + '</div>' +
            '<p style="font-size:18px">' + esc(r.message) + '</p>' + (o.note ? '<p class="note">' + esc(o.note) + '</p>' : '') +
            (!r.rwo_paid && o.membership_fee ? '<section class="panel stack"><h2>RWO membership</h2><p>' + money(o.membership_fee) + ', good for every RWO race this season. ' +
              'Pay now, or your team owner can pay for you from the team page.</p><button class="btn go big" type="button" id="paymem">Pay ' + money(o.membership_fee) + ' now</button></section>' : '') +
            '<p style="margin-top:16px"><button class="btn ghost" type="button" id="again">Sign up another person</button></p></div>');
          $('#again').onclick = function () { viewSignup(); };
          var pm = $('#paymem'); if (pm) pm.onclick = function () { pay({ kind: 'membership', person_ids: [r.person_id] }, function () { pm.closest('section').innerHTML = '<div class="banner cleared">Membership paid. Thank you.</div>'; }); };
          window.scrollTo(0, 0);
        }, function (e) { btn.disabled = false; fail(e); });
      };
    }, fail);
  }

  /* =========================================================== */
  /* Staff sign-in                                                */
  /* =========================================================== */
  function viewLogin() {
    var v = view('<div class="center"><h1>Staff sign in</h1><p class="muted">Enter your department PIN. The office sets PINs.</p><div class="panel stack">' +
      '<label class="f"><span>Your name</span><input type="text" id="l_who" value="' + esc(S.who) + '" autocomplete="name" required></label>' +
      '<p class="small muted" style="margin-top:-4px">Every check you make is saved with your name and the time.</p>' +
      '<label class="f"><span>Department PIN</span><input type="password" id="l_pin" inputmode="numeric" autocomplete="off"></label>' +
      '<button class="btn big" type="button" id="l_go">Sign in</button>' +
      (DEMO ? '<p class="note small">Demo PINs: Office 1111, Registration 2222, Tech 3333, Safety 4444.</p>' : '') + '</div></div>');
    var goBtn = $('#l_go', v), pinI = $('#l_pin', v);
    var doIt = function () {
      if (!$('#l_who').value.trim()) { toast('Enter your name first.', true); $('#l_who').focus(); return; }
      var pin = pinI.value.trim();
      S.pin = pin;
      S.who = $('#l_who').value.trim();
      api('login').then(function () {
        ss('set', 'rwo_pin', pin);
        S.who = $('#l_who').value.trim(); ls('set', 'rwo_who', S.who);
        return boot();
      }).then(function () { go(homeFor()); }, function (e) { S.pin = ''; fail(e); pinI.select(); });
    };
    goBtn.onclick = doIt;
    pinI.onkeydown = function (e) { if (e.key === 'Enter') doIt(); };
    ($('#l_who', v).value ? pinI : $('#l_who', v)).focus();
  }

  /* =========================================================== */
  /* Payments (Stripe; simulated in the demo)                     */
  /* =========================================================== */
  function money(n) { var v = Number(n) || 0; return '$' + v.toLocaleString('en-US', { minimumFractionDigits: v % 1 ? 2 : 0, maximumFractionDigits: 2 }); }
  function pay(payload, after) {
    payload.return_url = location.href.split('#')[0].split('?')[0];
    payload.hash = location.hash.replace(/^#/, '');
    return api('checkout', payload).then(function (r) {
      if (DEMO) {
        return ask('Demo: in the live system this opens Stripe’s secure payment page for ' + money(r.total) + '. Nothing is charged here. Mark it paid?', 'Mark paid')
          .then(function (yes) {
            if (!yes) return;
            return api('demoPay', { payment_id: r.payment_id }).then(function () { toast('Payment received: ' + money(r.total)); if (after) after(); });
          });
      }
      toast('Opening secure payment page…');
      location.href = r.url;
    }, fail);
  }
  function payPanel(e, crew) {
    var pp = e.pay || {};
    var h = '<div class="paybox" data-entry="' + esc(e.entry_id) + '" data-memfee="' + (pp.membership_fee || 0) + '"><h3>Payments</h3>';
    // race entry
    h += '<div class="payrow"><div class="grow"><b>Race entry</b><div class="small muted">' + (pp.entry_fee ? esc(pp.entry_fee.name) : 'No fee set for this class yet') + '</div></div>';
    if (pp.entry_paid) h += '<span class="pill cleared">Paid</span>';
    else if (pp.entry_fee) h += '<button type="button" class="btn go" data-pay-entry>Pay ' + money(pp.entry_fee.amount) + '</button>';
    else h += '<span class="small muted">Contact the office</span>';
    h += '</div>';
    // memberships
    var unpaid = (crew || []).filter(function (m) { return !m.rwo_paid; });
    h += '<div class="payrow col"><div><b>RWO memberships</b> <span class="small muted">' + (pp.membership_fee ? money(pp.membership_fee) + ' each, good for the season' : '') + '</span></div>';
    if (!crew || !crew.length) h += '<div class="small muted">Nobody is on this boat yet.</div>';
    else if (!unpaid.length) h += '<div class="small">Everyone on this boat has paid.</div>';
    else if (pp.membership_fee) {
      h += '<div class="small muted">Tick who you’re paying for. Each person can also pay their own.</div><div class="paypeople">' + unpaid.map(function (m) {
        return '<label class="toggle"><input type="checkbox" data-mem="' + esc(m.person_id) + '" checked>' + esc(m.name) + ' <span class="muted small">' + esc(m.role) + '</span></label>';
      }).join('') + '</div><button type="button" class="btn go" data-pay-mem>Pay for <span data-memn>' + unpaid.length + '</span> (<span data-memt>' + money(unpaid.length * pp.membership_fee) + '</span>)</button>';
    }
    h += '</div>';
    // extras
    if ((pp.extras || []).length || (pp.extras_paid || []).length) {
      h += '<div class="payrow col"><div><b>Extras for this race</b></div>';
      (pp.extras_paid || []).forEach(function (x) { h += '<div class="small">✓ ' + esc(x.name) + (x.qty > 1 ? ' x' + x.qty : '') + ' <span class="muted">paid ' + esc(fmtWhen(x.paid_at)) + '</span></div>'; });
      if ((pp.extras || []).length) {
        h += (pp.extras || []).map(function (x) {
          return '<label class="extra"><span class="grow">' + esc(x.name) + ' <span class="muted small">' + money(x.amount) + ' each</span></span><input type="number" min="0" max="20" value="0" data-extra="' + esc(x.id) + '" data-price="' + x.amount + '" aria-label="How many: ' + esc(x.name) + '"></label>';
        }).join('') + '<button type="button" class="btn go" data-pay-extras disabled>Pay for extras</button>';
      }
      h += '</div>';
    }
    return h + '</div>';
  }
  function bindPayPanels(root, rerender) {
    $$('.paybox', root).forEach(function (box) {
      var entryId = box.dataset.entry;
      var pe = $('[data-pay-entry]', box);
      if (pe) pe.onclick = function () { pay({ kind: 'entry', entry_id: entryId }, rerender); };
      var count = function () {
        var n = $$('[data-mem]', box).filter(function (c) { return c.checked; }).length;
        var price = (box.dataset.memfee && Number(box.dataset.memfee)) || 0;
        if ($('[data-memn]', box)) { $('[data-memn]', box).textContent = n; $('[data-memt]', box).textContent = money(n * price); }
        if ($('[data-pay-mem]', box)) $('[data-pay-mem]', box).disabled = n === 0;
        return n;
      };
      $$('[data-mem]', box).forEach(function (c) { c.onchange = function () { S.payTouched = true; c.closest('.toggle').classList.toggle('on', c.checked); count(); }; });
      $$('[data-mem]', box).forEach(function (c) { c.closest('.toggle').classList.add('on'); });
      var pm = $('[data-pay-mem]', box);
      if (pm) pm.onclick = function () {
        pay({ kind: 'membership', person_ids: $$('[data-mem]', box).filter(function (c) { return c.checked; }).map(function (c) { return c.dataset.mem; }) }, rerender);
      };
      var px = $('[data-pay-extras]', box);
      $$('[data-extra]', box).forEach(function (inp) {
        inp.oninput = function () {
          S.payTouched = true;
          var t = $$('[data-extra]', box).reduce(function (s, x) { return s + (Number(x.value) || 0) * Number(x.dataset.price); }, 0);
          px.disabled = t <= 0; px.textContent = t > 0 ? 'Pay ' + money(t) + ' for extras' : 'Pay for extras';
        };
      });
      if (px) px.onclick = function () {
        pay({ kind: 'extras', entry_id: entryId, items: $$('[data-extra]', box).map(function (x) { return { fee_id: x.dataset.extra, qty: Number(x.value) || 0 }; }).filter(function (x) { return x.qty > 0; }) }, rerender);
      };
    });
  }

  /* =========================================================== */
  /* Boat registration (public)                                   */
  /* =========================================================== */
  function viewRegister() {
    return api('registerOptions').then(function (o) {
      if (!o.events.length) { view('<div class="center empty"><h1>Registration is closed</h1><p>Boat registration opens a few weeks before each race.</p></div>'); return; }
      var st = { returning: null, boat: null, profile: null, crewChanged: null, hullChanged: null };
      var field = function (key, label, val, req, type) {
        return '<label class="f"><span>' + esc(label) + (req ? '' : ' <span class="muted">(optional)</span>') + '</span><input type="' + (type || 'text') + '" data-b="' + key + '" value="' + esc(val || '') + '"' + (req ? ' required' : '') + '></label>';
      };
      var yesNo = function (name, q) {
        return '<div class="q"><p class="qtext">' + q + '</p><div class="seg" role="group" aria-label="' + esc(q) + '"><button type="button" data-yn="' + name + '" data-v="1">Yes</button><button type="button" data-yn="' + name + '" data-v="0">No</button></div></div>';
      };
      var crewSection = function (hint) {
        return '<section class="panel stack"><h2>Riding crew</h2>' + (hint ? '<p class="small muted">' + hint + '</p>' : '') + o.riding_roles.map(function (role) {
          var req = role === 'Driver';
          return '<fieldset class="crewset"><legend>' + role + (role === 'Navigator' ? ' <span class="muted small">(only if your boat has one)</span>' : role === 'Throttleman' ? '' : '') + '</legend><div class="grid2">' +
            '<label class="f"><span>First name</span><input type="text" data-c="' + role + '.first"' + (req ? ' required' : '') + '></label>' +
            '<label class="f"><span>Last name</span><input type="text" data-c="' + role + '.last"' + (req ? ' required' : '') + '></label>' +
            '</div></fieldset>';
        }).join('') + '</section>';
      };
      var hullSection = function (prev, withClass) {
        prev = prev || {};
        return '<section class="panel stack"><h2>Hull, engines and drives</h2><div class="grid2">' +
          (withClass ? classField(prev['class']) : '') +
          o.hull_fields.map(function (f) { return field(f[0], f[1], (prev.hull || {})[f[0]], false); }).join('') + '</div></section>';
      };
      var classField = function (val) {
        return '<label class="f"><span>Class</span><input type="text" data-b="class" list="rclasses" value="' + esc(val || '') + '" required></label>' +
          '<datalist id="rclasses">' + o.classes.map(function (c) { return '<option value="' + esc(c) + '">'; }).join('') + '</datalist>';
      };

      var draw = function () {
        var html = '<div class="center wide"><h1>Boat registration</h1><p>Register your boat for a race. You can pay now or later from your team page.</p>' +
          '<section class="panel stack"><h2>Which race?</h2>' + o.events.map(function (e, i) {
            return '<label class="toggle"><input type="radio" name="rev" value="' + esc(e.id) + '"' + (o.events.length === 1 || i === 0 ? ' checked' : '') + '>' + esc(e.name) +
              ' <span class="muted small">' + esc(fmtDate(e.start)) + (e.location ? ', ' + esc(e.location) : '') + '</span></label>';
          }).join('') + '</section>' +
          '<section class="panel stack">' + yesNo('returning', 'Have you registered this boat with RWO before?') +
          (st.returning === true ? '<div><p class="qtext">Find your boat</p><div id="rpick"></div>' + (st.boat ? '<p class="note"><b>' + esc(st.boat.label) + '</b> <button type="button" class="linkbtn" id="rchange" style="color:var(--ink-2)">Pick a different boat</button></p>' : '') + '</div>' : '') +
          (st.returning === true && st.profile ? yesNo('crew', 'Has your riding crew changed?') + yesNo('hull', 'Has your hull or boat info changed?') : '') +
          '</section>';
        if (st.returning === false) {
          html += '<section class="panel stack"><h2>Boat and team</h2><div class="grid2">' + field('boat_no', 'Boat number', '', true) + field('team', 'Team name', '', true) + classField('') + '</div></section>' +
            '<section class="panel stack"><h2>Owner</h2><div class="grid2">' + o.owner_fields.map(function (f) { return field(f[0], f[1], '', !!f[2], /email/.test(f[0]) ? 'email' : /phone/.test(f[0]) ? 'tel' : 'text'); }).join('') + '</div></section>' +
            crewSection('') + hullSection(null, false);
        }
        if (st.returning === true && st.profile) {
          var riders = st.profile.riders || {};
          var last = Object.keys(riders).map(function (r) { return r + ': ' + riders[r]; }).join(', ');
          if (st.crewChanged === true) html += crewSection('Last time: ' + esc(last || 'none on file') + '. Enter your riding crew for this race.');
          if (st.hullChanged === true) html += hullSection(st.profile, true);
        }
        var ready = st.returning === false || (st.returning === true && st.profile && st.crewChanged !== null && st.hullChanged !== null);
        html += ready ? '<button class="btn big go" type="button" id="rgo">Register boat</button>' +
          (st.returning === true && !st.crewChanged && !st.hullChanged ? '<p class="small muted">Everything else carries over from your last registration.</p>' : '') : '';
        html += '</div>';
        var keep = {};
        $$('[data-b],[data-c]').forEach(function (x) { keep[x.dataset.b || x.dataset.c] = x.value; });
        var checkedEv = ($('input[name="rev"]:checked') || {}).value;
        var v = view(html);
        $$('[data-b],[data-c]', v).forEach(function (x) { var k = x.dataset.b || x.dataset.c; if (keep[k] != null && keep[k] !== '') x.value = keep[k]; });
        if (checkedEv) { var r0 = $('input[name="rev"][value="' + checkedEv + '"]', v); if (r0) r0.checked = true; }
        $$('[data-yn]', v).forEach(function (b) {
          var cur = b.dataset.yn === 'returning' ? st.returning : b.dataset.yn === 'crew' ? st.crewChanged : st.hullChanged;
          var on = cur !== null && cur === (b.dataset.v === '1');
          b.classList.toggle('on', on); b.setAttribute('aria-pressed', on);
          b.onclick = function () {
            var val = b.dataset.v === '1';
            if (b.dataset.yn === 'returning') { st.returning = val; }
            if (b.dataset.yn === 'crew') st.crewChanged = val;
            if (b.dataset.yn === 'hull') st.hullChanged = val;
            draw();
          };
        });
        $$('input[type=radio]', v).forEach(function (r) { r.onchange = function () { $$('input[name=rev]', v).forEach(function (x) { x.closest('.toggle').classList.toggle('on', x.checked); }); }; r.onchange(); });
        var rp = $('#rpick', v);
        if (rp && !st.boat) boatPicker(rp, {
          placeholder: 'Type your boat number or team name',
          source: localBoatSearch(o.boats),
          onPick: function (b) {
            st.boat = b;
            api('boatProfile', { boat_id: b.id }).then(function (pr) { st.profile = pr; draw(); }, fail);
          }
        });
        var ch = $('#rchange', v); if (ch) ch.onclick = function () { st.boat = null; st.profile = null; st.crewChanged = null; st.hullChanged = null; draw(); };
        var go2 = $('#rgo', v);
        if (go2) go2.onclick = function () { submit(go2); };
      };
      var submit = function (btn) {
        var b = {}, crew = {};
        $$('[data-b]').forEach(function (x) { b[x.dataset.b] = x.value.trim(); });
        $$('[data-c]').forEach(function (x) { var k = x.dataset.c.split('.'); (crew[k[0]] = crew[k[0]] || {})[k[1]] = x.value.trim(); });
        var missing = $$('[required]').filter(function (x) { return !x.value.trim(); });
        if (missing.length) { missing[0].focus(); toast('Fill in the required fields (the ones not marked optional).', true); return; }
        btn.disabled = true;
        api('registerBoat', {
          returning: st.returning, boat_id: st.boat && st.boat.id, event_ids: [($('input[name="rev"]:checked') || {}).value],
          crew_changed: st.crewChanged, hull_changed: st.hullChanged, boat: b, crew: crew
        }).then(function (r) {
          var link = location.href.split('#')[0].split('?')[0] + '?team=' + r.token;
          var v2 = view('<div class="center wide"><div class="banner cleared">' + esc(r.message) + '</div>' +
            '<section class="panel stack"><h2>Your team page</h2><p>See your boat’s status, what each person still needs, and pay anything left, any time.</p>' +
            '<div class="row"><input type="text" readonly id="rlink" class="grow" value="' + esc(link) + '" aria-label="Team page link"><button class="btn sm" type="button" id="rcopy">Copy link</button></div>' +
            '<p class="small muted">Save this link. Your crew sign up on the Crew sign-up page and pick your boat.</p></section>' +
            r.entries.map(function (en) { return '<section class="panel" style="margin-top:12px"><h2>' + esc(en.event) + '</h2>' + payPanel({ entry_id: en.entry_id, pay: en.pay }, []) + '</section>'; }).join('') +
            '<p><a class="btn ghost" href="#team-' + esc(r.token) + '">Open team page</a></p></div>');
          $('#rcopy', v2).onclick = function () { copy(link, $('#rlink', v2)); };
          bindPayPanels(v2, function () { go('team/' + r.token); });
          window.scrollTo(0, 0);
        }, function (e) { btn.disabled = false; fail(e); });
      };
      draw();
    }, fail);
  }

  /* =========================================================== */
  /* Admin: every setting, in plain form fields                   */
  /* =========================================================== */
  function viewAdmin() {
    return api('adminGet').then(function (a) {
      var s = a.settings;
      var yn = function (key, label, help) {
        var on = /^(y|yes|true|1)$/i.test(String(s[key] || ''));
        return '<label class="toggle' + (on ? ' on' : '') + '"><input type="checkbox" data-yn-set="' + key + '"' + (on ? ' checked' : '') + '><span><b>' + esc(label) + '</b><br><span class="small muted">' + esc(help) + '</span></span></label>';
      };
      var txt = function (key, label, help, type) {
        return '<label class="f"><span>' + esc(label) + '</span><input type="' + (type || 'text') + '" data-set="' + key + '" value="' + esc(s[key] || '') + '">' + (help ? '<span class="small muted" style="font-weight:400">' + esc(help) + '</span>' : '') + '</label>';
      };
      var strict = Number(s.auto_link_score || 70) >= 85 ? 'strict' : 'normal';
      var html = '<h1>Admin settings</h1><p class="muted">Changes apply right away for everyone. Every change is recorded in History.</p>' +
        '<nav class="admnav">' + [['a-gen', 'General'], ['a-pins', 'PINs'], ['a-rules', 'Clearance rules'], ['a-fees', 'Fees & prices'], ['a-spell', 'Remembered spellings']].map(function (x) {
          return '<a href="#' + x[0] + '" data-jump="' + x[0] + '">' + x[1] + '</a>';
        }).join('') + '</nav>' +

        '<section class="panel stack" id="a-gen"><h2>General</h2><div class="grid2">' +
        txt('org_name', 'Organization name', 'Shown at the top of every page') +
        txt('site_url', 'Website address of this app', 'Where Stripe sends people back after paying, e.g. https://yourname.github.io/rwo-registration/') + '</div>' +
        yn('public_board', 'Anyone can see the boat board', 'Off: only signed-in staff see it') +
        yn('public_team_pages', 'Tapping a boat opens its team page', 'Shows each person’s missing items and medical/dunker dates (never emails or phones). Off: only owners with their private link') +
        yn('must_be_ready_to_sign', 'People can only sign once everything is done', 'Off: registration can sign anyone; their missing items still show') +
        yn('crew_blocks_boat', 'Every person on a boat must be cleared before the boat is', 'Off: only the riding crew holds the boat back') +
        yn('navigator_required_if_listed', 'If a boat lists a navigator, they must be cleared too', '') +
        '<div class="grid2">' + txt('required_roles', 'Who a boat must have, cleared', 'Groups split by ; and choices by |. Default: Driver|Alt Driver; Throttleman|Alt Throttle') +
        '<label class="f"><span>Automatic matching</span><select data-strict><option value="normal"' + (strict === 'normal' ? ' selected' : '') + '>Normal: place people whenever it’s clear (recommended)</option><option value="strict"' + (strict === 'strict' ? ' selected' : '') + '>Careful: send more close calls to the office</option></select></label>' +
        txt('signup_note', 'Message after crew sign up', 'Optional') + txt('timezone', 'Time zone', 'Used for every timestamp, e.g. America/New_York') + '</div>' +
        '<p class="small muted">Website form connection key (only if you connect your old website form): <code>' + esc(s.webhook_secret || '') + '</code></p>' +
        '<button class="btn" type="button" data-save="gen">Save general settings</button></section>' +

        '<section class="panel stack" id="a-pins"><h2>Department PINs</h2><p class="small muted">4 to 10 digits, each different. Anyone already signed in keeps working until they sign out.</p><div class="grid2">' +
        [['pin_admin', 'Admin (this page)'], ['pin_office', 'Office'], ['pin_registration', 'Registration'], ['pin_tech', 'Tech'], ['pin_safety', 'Safety']].map(function (x) {
          return '<label class="f"><span>' + x[1] + '</span><input type="text" inputmode="numeric" data-pin="' + x[0] + '" value="' + esc(s[x[0]] || '') + '"></label>';
        }).join('') + '</div><button class="btn" type="button" data-save="pins">Save PINs</button></section>' +

        '<section class="panel stack" id="a-rules"><h2>Clearance rules</h2><p class="small muted">Tick what each role needs before they can sign. Medical and dunker must be valid through the last day of the race.</p>' +
        '<div style="overflow-x:auto"><table class="table rules"><tr><th>Role</th>' + a.reqs.map(function (q) { return '<th>' + esc(q.label) + '</th>'; }).join('') + '</tr>' +
        a.roles.map(function (role) {
          return '<tr><td><b>' + esc(role) + '</b></td>' + a.reqs.map(function (q) {
            var on = (a.rules[role] || []).indexOf(q.key) >= 0;
            return '<td><input type="checkbox" data-rule="' + esc(role) + '|' + q.key + '"' + (on ? ' checked' : '') + ' aria-label="' + esc(role + ' needs ' + q.label) + '"></td>';
          }).join('') + '</tr>';
        }).join('') + '</table></div><button class="btn" type="button" data-save="rules">Save clearance rules</button></section>' +

        '<section class="panel stack" id="a-fees"><h2>Fees and prices</h2><p class="small muted">Race entry is matched by class (a class that starts with the fee’s class counts, so “Bracket Class” covers Bracket Class 200 to 700). ' +
        'If “Only at events named” is filled in, that price is used at those events instead of the general one. A fee set to $0 or switched off isn’t offered.</p>' +
        '<div style="overflow-x:auto"><table class="table fees"><tr><th>Type</th><th>Name shown to people</th><th>Class</th><th>Only at events named</th><th>Amount ($)</th><th>On</th><th></th></tr>' +
        a.fees.map(function (f) { return feeRow(f); }).join('') + feeRow({ id: '', kind: 'extra', name: '', 'class': '', event_match: '', amount: '', active: true, sort: 99 }, true) +
        '</table></div></section>' +

        '<section class="panel stack" id="a-spell"><h2>Remembered spellings</h2><p class="small muted">When the office places someone by hand, the way they typed their team is remembered, so the next person who types it the same way is placed automatically. Remove any that are wrong.</p>' +
        (a.aliases.length ? '<table class="table"><tr><th>They typed</th><th>Goes to</th><th>Added by</th><th></th></tr>' + a.aliases.map(function (al, i) {
          return '<tr><td>' + esc(al.typed) + '</td><td>' + esc(al.boat) + '</td><td class="small">' + esc(al.added_by) + '<div class="muted">' + esc(fmtWhen(al.added_at)) + '</div></td><td><button class="btn stop sm" type="button" data-alias="' + i + '">Forget</button></td></tr>';
        }).join('') + '</table>' : '<p class="muted">None yet.</p>') + '</section>';
      var v = view(html);
      $$('[data-jump]', v).forEach(function (x) { x.onclick = function (e) { e.preventDefault(); $('#' + x.dataset.jump).scrollIntoView({ behavior: 'smooth', block: 'start' }); }; });
      $$('[data-yn-set]', v).forEach(function (c) { c.onchange = function () { c.closest('.toggle').classList.toggle('on', c.checked); }; });
      $('[data-save="gen"]', v).onclick = function () {
        var out = {};
        $$('[data-set]', v).forEach(function (x) { out[x.dataset.set] = x.value.trim(); });
        $$('[data-yn-set]', v).forEach(function (x) { out[x.dataset.ynSet] = x.checked ? 'Y' : 'N'; });
        var strictNow = $('[data-strict]', v).value === 'strict';
        out.auto_link_score = strictNow ? '90' : '70'; out.auto_link_gap = strictNow ? '20' : '12';
        api('adminSaveSettings', { settings: out }).then(function (r) { toast(r.saved ? 'Saved ' + plural(r.saved, 'change') : 'Nothing changed'); return boot(); }).then(function () { render(); }, fail);
      };
      $('[data-save="pins"]', v).onclick = function () {
        var out = {};
        $$('[data-pin]', v).forEach(function (x) { out[x.dataset.pin] = x.value.trim(); });
        api('adminSaveSettings', { settings: out }).then(function (r) {
          if (out.pin_admin && out.pin_admin !== S.pin) { S.pin = out.pin_admin; ss('set', 'rwo_pin', S.pin); }
          toast(r.saved ? 'PINs saved' : 'Nothing changed');
        }, fail);
      };
      $('[data-save="rules"]', v).onclick = function () {
        var rules = {};
        a.roles.forEach(function (r) { rules[r] = []; });
        $$('[data-rule]', v).forEach(function (c) { if (c.checked) { var k = c.dataset.rule.split('|'); rules[k[0]].push(k[1]); } });
        api('adminSaveRules', { rules: rules }).then(function () { toast('Clearance rules saved. Everyone’s status is updated.'); }, fail);
      };
      $$('tr[data-fee]', v).forEach(function (tr) {
        var read = function () {
          return { id: tr.dataset.fee, kind: $('[data-f=kind]', tr).value, name: $('[data-f=name]', tr).value, 'class': $('[data-f=class]', tr).value,
            event_match: $('[data-f=event_match]', tr).value, amount: $('[data-f=amount]', tr).value, active: $('[data-f=active]', tr).checked, sort: tr.dataset.sort };
        };
        $('[data-fsave]', tr).onclick = function () { api('adminSaveFee', { fee: read() }).then(function () { toast('Fee saved'); viewAdmin(); }, fail); };
        var rm = $('[data-fdel]', tr);
        if (rm) rm.onclick = function () {
          ask('Remove the fee “' + read().name + '”?', 'Remove').then(function (yes) {
            if (yes) api('adminSaveFee', { fee: Object.assign(read(), { remove: true }) }).then(function () { toast('Fee removed'); viewAdmin(); }, fail);
          });
        };
      });
      $$('[data-alias]', v).forEach(function (b) {
        b.onclick = function () {
          var al = a.aliases[+b.dataset.alias];
          api('adminDeleteAlias', al).then(function () { toast('Forgotten'); viewAdmin(); }, fail);
        };
      });
    }, fail);
  }
  function feeRow(f, isNew) {
    var kinds = [['entry', 'Race entry'], ['membership', 'Membership'], ['extra', 'Extra']];
    return '<tr data-fee="' + esc(f.id) + '" data-sort="' + esc(f.sort) + '"' + (isNew ? ' class="newrow"' : '') + '>' +
      '<td><select data-f="kind" aria-label="Type">' + kinds.map(function (k) { return '<option value="' + k[0] + '"' + (f.kind === k[0] ? ' selected' : '') + '>' + k[1] + '</option>'; }).join('') + '</select></td>' +
      '<td><input type="text" data-f="name" value="' + esc(f.name) + '" placeholder="' + (isNew ? 'New fee name' : '') + '" aria-label="Name"></td>' +
      '<td><input type="text" data-f="class" value="' + esc(f['class']) + '" aria-label="Class" style="min-width:120px"></td>' +
      '<td><input type="text" data-f="event_match" value="' + esc(f.event_match) + '" aria-label="Only at events named" style="min-width:110px"></td>' +
      '<td><input type="text" inputmode="decimal" data-f="amount" value="' + esc(f.amount) + '" aria-label="Amount" style="width:100px"></td>' +
      '<td><input type="checkbox" data-f="active"' + (f.active === true || f.active === 'true' ? ' checked' : '') + ' aria-label="On" style="width:22px;height:22px"></td>' +
      '<td class="row" style="flex-wrap:nowrap"><button class="btn sm" type="button" data-fsave>' + (isNew ? 'Add' : 'Save') + '</button>' + (isNew ? '' : '<button class="btn stop sm" type="button" data-fdel>Remove</button>') + '</td></tr>';
  }

  /* =========================================================== */
  /* Start-up, render, live refresh                               */
  /* =========================================================== */
  function boot() {
    return api('bootstrap').then(function (b) {
      S.boot = b;
      if (!b.dept && S.pin) { S.pin = ''; ss('del', 'rwo_pin'); }
      if (!S.event || !b.events.some(function (e) { return e.id === S.event; })) S.event = b.current_event_id || '';
      return b;
    });
  }

  function render(quiet) {
    if (!S.boot) return;
    var r = route(), page = r[0];
    var kiosk = page === 'team' || ((page === 'signup' || page === 'register') && !S.boot.dept && qs.get('page') === page);
    if (!quiet) S.payTouched = false;
    if (!quiet || !$('#view')) { document.body.innerHTML = shell(kiosk); bindShell(); }
    S.lastRender = Date.now();
    var staffOnly = { desk: 1, person: 1, tech: 1, safety: 1, inbox: 1, setup: 1, boat: 1, history: 1, admin: 1 };
    if (staffOnly[page] && !S.boot.dept) { go('login'); return; }
    if (!page) { go(homeFor()); return; }
    if (can('inbox') && page !== 'inbox' && !quiet) api('inbox').then(function (l) {
      var nd = l.filter(function (s) { return s.status !== 'No match yet'; }).length;
      S.inboxCount = nd; var tab = $('.tabs a[href="#inbox"]');
      if (tab) tab.innerHTML = 'Office inbox' + (nd ? ' <span class="n">' + nd + '</span>' : '');
    }, function () { });
    switch (page) {
      case 'board': return viewBoard(quiet);
      case 'boat': return viewBoat(r[1]);
      case 'desk': return quiet ? null : viewDesk();
      case 'person': return quiet ? null : viewPerson(r[1]);
      case 'tech': return viewInspect('tech', quiet);
      case 'safety': return viewInspect('safety', quiet);
      case 'inbox': return quiet ? null : viewInbox();
      case 'setup': return quiet ? null : viewSetup();
      case 'history': return quiet ? null : viewHistory();
      case 'team': return viewTeam(r[1]);
      case 'teamboat': return viewTeam(r[1], true);
      case 'signup': return quiet ? null : viewSignup();
      case 'login': return viewLogin();
      case 'register': return quiet ? null : viewRegister();
      case 'admin': return quiet ? null : viewAdmin();
      default: go(homeFor());
    }
  }

  // live updates: refresh lists when anything changes, unless someone is typing
  function refreshSoon() {
    var a = document.activeElement;
    if (a && /INPUT|TEXTAREA|SELECT/.test(a.tagName) && a.type !== 'checkbox') return;
    if ($('details[open]')) return;
    if (Date.now() - S.lastRender < 1500) return;
    if (document.hidden) return;
    var page = route()[0];
    if (S.payTouched && (page === 'team' || page === 'teamboat')) return; // don't wipe ticks someone is choosing
    if (['board', 'tech', 'safety', 'team', 'teamboat', 'boat'].indexOf(page) >= 0) render(true);
  }
  function startLive() {
    setInterval(refreshSoon, DEMO ? 15000 : 30000);
    document.addEventListener('visibilitychange', function () { if (!document.hidden) refreshSoon(); });
    if (DEMO || !window.supabase || !CFG.url) return;
    try {
      var client = window.supabase.createClient(CFG.url, CFG.key);
      client.channel('pulse').on('postgres_changes', { event: '*', schema: 'public', table: 'pulse' }, function () { setTimeout(refreshSoon, 400); }).subscribe();
    } catch (e) { /* polling still works */ }
  }

  function start() {
    if (qs.get('team') && !location.hash) location.replace('#team-' + qs.get('team'));
    else if ((qs.get('page') === 'signup' || qs.get('page') === 'register') && !location.hash) location.replace('#' + qs.get('page'));
    if (qs.get('paid')) setTimeout(function () { toast('Payment received. Thank you! It can take a few seconds to show here.'); }, 900);
    if (qs.get('canceled')) setTimeout(function () { toast('Payment canceled. Nothing was charged.', true); }, 900);
    document.body.innerHTML = '<div class="empty" style="padding-top:80px">Loading…</div>';
    boot().then(function () { render(); startLive(); }, function (e) {
      document.body.innerHTML = '<div class="center empty"><h1>Can’t load RWO Registration</h1><p>' + esc(e.message) + '</p><button class="btn" onclick="location.reload()">Try again</button></div>';
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
