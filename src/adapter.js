/* ------------------------------------------------------------------ */
/* Supabase adapter: loads the database into memory, runs the shared   */
/* logic, then writes back only what changed (nothing if it failed).   */
/* ------------------------------------------------------------------ */

var DB = {
  Events:     { table: 'events', pk: 'id', map: { start: 'start_date', end: 'end_date' } },
  Boats:      { table: 'boats', pk: 'id', map: { 'class': 'race_class' } },
  Entries:    { table: 'entries', pk: 'id' },
  People:     { table: 'people', pk: 'id' },
  Crew:       { table: 'crew', pk: 'id' },
  Signatures: { table: 'signatures', pk: 'id' },
  Signups:    { table: 'signups', pk: 'id' },
  Aliases:    { table: 'aliases', pk: 'key', conflict: 'key,boat_id' },
  Log:        { table: 'log', insertOnly: true },
  Fees:       { table: 'fees', pk: 'id', map: { 'class': 'fee_class' } },
  Payments:   { table: 'payments', pk: 'id' }
};
// parents before children, so links always point at something that exists
var FLUSH_ORDER = ['Events', 'Boats', 'People', 'Fees', 'Entries', 'Crew', 'Signatures', 'Signups', 'Aliases', 'Payments', 'Log'];

function colName(T, c) { var m = DB[T].map; return (m && m[c]) || c; }
function fromDb(T, row) {
  var o = {};
  SCHEMA[T].forEach(function (c) {
    var v = row[colName(T, c)];
    if (v == null) v = (BOOL_COLS[T] || []).indexOf(c) >= 0 ? false : '';
    o[c] = v;
  });
  return o;
}
function toDb(T, obj) {
  var o = {};
  SCHEMA[T].forEach(function (c) {
    if (!(c in obj)) return;
    var v = obj[c];
    if ((DATE_COLS[T] || []).indexOf(c) >= 0) v = isoDate(v) || null;
    else if ((BOOL_COLS[T] || []).indexOf(c) >= 0) v = truthy(v);
    else v = v == null ? '' : String(v);
    o[colName(T, c)] = v;
  });
  return o;
}
async function must(promise, what) {
  var r = await promise;
  if (r && r.error) throw new Error('Database problem (' + what + '): ' + r.error.message);
  return r;
}
async function fetchAll(sb, table) {
  var out = [], from = 0;
  for (;;) {
    var r = await must(sb.from(table).select('*').range(from, from + 999), 'reading ' + table);
    out = out.concat(r.data || []);
    if (!r.data || r.data.length < 1000) break;
    from += 1000;
  }
  return out;
}
async function inChunks(rows, size, fn) {
  for (var i = 0; i < rows.length; i += size) await fn(rows.slice(i, i + size));
}

async function openStore(sb, opts) {
  var names = ['Events', 'Boats', 'Entries', 'People', 'Crew', 'Signatures', 'Signups', 'Aliases', 'Fees', 'Payments'];
  var loaded = await Promise.all(names.map(function (n) { return fetchAll(sb, DB[n].table); })
    .concat([fetchAll(sb, 'settings'), fetchAll(sb, 'rules')]));
  var tables = {};
  names.forEach(function (n, i) { tables[n] = loaded[i].map(function (r) { return fromDb(n, r); }); });
  if (opts && opts.withLog) {
    // the History screen: the most recent 2000 changes
    var lg = await must(sb.from('log').select('*').order('n', { ascending: false }).limit(2000), 'reading history');
    tables.Log = (lg.data || []).map(function (r) { return fromDb('Log', r); });
  }
  var settings = {};
  loaded[names.length].forEach(function (r) { settings[r.key] = r.value == null ? '' : String(r.value); });
  var ruleRows = loaded[names.length + 1];
  var rules;
  if (ruleRows.length) {
    rules = {};
    ruleRows.forEach(function (r) { rules[r.role] = REQS.map(function (q) { return q.key; }).filter(function (k) { return r[k] === true; }); });
  }
  var mem = new MemoryStore({ tables: tables, settings: settings, rules: rules });
  var tz = settings.timezone || 'America/New_York';
  var dirty = {};
  var d = function (T) { return dirty[T] = dirty[T] || { ins: {}, upd: {}, del: {}, log: [] }; };
  var pkOf = function (T, row) { return T === 'Aliases' ? row.key + '|' + row.boat_id : row.id; };

  var settingChanges = {}, rulesChanged = null, aliasRemovals = [];
  var store = {
    all: mem.all, settings: mem.settings, rules: mem.rules, newId: mem.newId, random: Math.random,
    saveSettings: function (map) { mem.saveSettings(map); Object.assign(settingChanges, map); },
    saveRules: function (r) { mem.saveRules(r); rulesChanged = r; },
    removeAlias: function (key, boatId) { mem.removeAlias(key, boatId); aliasRemovals.push([key, boatId]); },
    now: function () { return new Date().toLocaleString('sv-SE', { timeZone: tz }).slice(0, 16); },
    insert: function (T, obj) {
      var row = mem.insert(T, obj);
      if (T === 'Log') d(T).log.push(row); else d(T).ins[pkOf(T, row)] = row;
      return row;
    },
    update: function (T, id, patch) {
      var row = mem.update(T, id, patch), D = d(T);
      if (D.ins[id]) D.ins[id] = row;
      else D.upd[id] = Object.assign(D.upd[id] || {}, patch);
      return row;
    },
    remove: function (T, id) {
      mem.remove(T, id);
      var D = d(T);
      if (D.ins[id]) delete D.ins[id]; else D.del[id] = 1;
      delete D.upd[id];
    }
  };

  async function flush() {
    var changed = false;
    for (var i = 0; i < FLUSH_ORDER.length; i++) {
      var T = FLUSH_ORDER[i], D = dirty[T], spec = DB[T];
      if (!D) continue;
      if (T === 'Log') {
        if (D.log.length) await inChunks(D.log.map(function (r) { return toDb(T, r); }), 500,
          function (rows) { return must(sb.from(spec.table).insert(rows), 'saving history'); });
        continue;
      }
      var ins = Object.keys(D.ins).map(function (k) { return toDb(T, D.ins[k]); });
      if (ins.length) {
        changed = true;
        await inChunks(ins, 500, function (rows) {
          return must(sb.from(spec.table).upsert(rows, { onConflict: spec.conflict || spec.pk }), 'saving ' + spec.table);
        });
      }
      var ids = Object.keys(D.upd);
      for (var j = 0; j < ids.length; j++) {
        changed = true;
        await must(sb.from(spec.table).update(toDb(T, D.upd[ids[j]])).eq(spec.pk, ids[j]), 'updating ' + spec.table);
      }
    }
    for (var k = FLUSH_ORDER.length - 1; k >= 0; k--) {
      var T2 = FLUSH_ORDER[k], D2 = dirty[T2];
      if (!D2) continue;
      var del = Object.keys(D2.del);
      if (del.length) { changed = true; await must(sb.from(DB[T2].table).delete().in(DB[T2].pk, del), 'removing from ' + DB[T2].table); }
    }
    var sk = Object.keys(settingChanges);
    if (sk.length) {
      changed = true;
      await must(sb.from('settings').upsert(sk.map(function (k) { return { key: k, value: settingChanges[k] }; }), { onConflict: 'key' }), 'saving settings');
    }
    if (rulesChanged) {
      changed = true;
      await must(sb.from('rules').upsert(ROLES.map(function (role, i) {
        var row = { role: role, sort: i + 1 };
        REQS.forEach(function (q) { row[q.key] = (rulesChanged[role] || []).indexOf(q.key) >= 0; });
        return row;
      }), { onConflict: 'role' }), 'saving rules');
    }
    for (var a = 0; a < aliasRemovals.length; a++) {
      changed = true;
      await must(sb.from('aliases').delete().eq('key', aliasRemovals[a][0]).eq('boat_id', aliasRemovals[a][1]), 'removing a spelling');
    }
    if (changed) await sb.from('pulse').update({ at: new Date().toISOString() }).eq('id', 1);
    return changed;
  }
  return { store: store, flush: flush, settings: settings };
}

var CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

function secretKey(env) {
  var s = env('SUPABASE_SECRET_KEYS');
  if (s) {
    try {
      var j = JSON.parse(s);
      if (typeof j === 'string') return j;
      return j['default'] || j[Object.keys(j)[0]];
    } catch (e) { return s; }
  }
  return env('RWO_SECRET_KEY') || env('SUPABASE_SERVICE_ROLE_KEY');
}

/* ---------------- Stripe ---------------- */

async function stripeCheckout(env, settings, pay, info) {
  var key = env('STRIPE_SECRET_KEY');
  if (!key) throw new Error('Online payments aren\u2019t switched on yet. Contact the RWO office to pay.');
  var back = String(info.return_url || settings.site_url || '').split('#')[0].split('?')[0];
  if (settings.site_url && back.indexOf(String(settings.site_url).split('?')[0]) !== 0) back = String(settings.site_url).split('?')[0];
  if (!/^https:\/\//.test(back)) throw new Error('Set site_url in Admin settings to your website address first.');
  var f = new URLSearchParams();
  f.append('mode', 'payment');
  f.append('success_url', back + '?paid=' + encodeURIComponent(pay.payment_id) + (info.hash ? '#' + info.hash : ''));
  f.append('cancel_url', back + '?canceled=1' + (info.hash ? '#' + info.hash : ''));
  f.append('client_reference_id', pay.payment_id);
  f.append('metadata[payment_id]', pay.payment_id);
  f.append('payment_intent_data[metadata][payment_id]', pay.payment_id);
  f.append('payment_intent_data[description]', (settings.org_name || 'RWO') + ' payment ' + pay.payment_id);
  if (info.email) f.append('customer_email', info.email);
  pay.items.forEach(function (it, i) {
    f.append('line_items[' + i + '][quantity]', String(it.qty));
    f.append('line_items[' + i + '][price_data][currency]', 'usd');
    f.append('line_items[' + i + '][price_data][unit_amount]', String(Math.round(Number(it.amount) * 100)));
    f.append('line_items[' + i + '][price_data][product_data][name]', it.name.slice(0, 250));
  });
  var r = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST', headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/x-www-form-urlencoded' }, body: f.toString()
  });
  var j = await r.json();
  if (!r.ok) throw new Error('Stripe couldn\u2019t start the payment: ' + ((j.error && j.error.message) || r.status));
  return j;
}

/** Checks the Stripe-Signature header (HMAC-SHA256 of "timestamp.body" with the webhook signing secret). */
async function verifyStripe(raw, header, secret) {
  if (!header || !secret) throw new Error('missing signature or secret');
  var parts = String(header).split(','), t = '', sigs = [];
  parts.forEach(function (x) { var i = x.indexOf('='); var k = x.slice(0, i).trim(), v = x.slice(i + 1).trim(); if (k === 't') t = v; if (k === 'v1') sigs.push(v); });
  if (!t || !sigs.length) throw new Error('bad signature header');
  if (Math.abs(Date.now() / 1000 - Number(t)) > 600) throw new Error('signature too old');
  var enc = new TextEncoder();
  var k = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  var mac = new Uint8Array(await crypto.subtle.sign('HMAC', k, enc.encode(t + '.' + raw)));
  var hex = Array.prototype.map.call(mac, function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
  if (sigs.indexOf(hex) < 0) throw new Error('signature mismatch');
}

/** The HTTP handler. makeClient = supabase createClient, env = (name) => value */
function makeHandler(makeClient, env) {
  return async function (req) {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
    var reply = function (o, status) {
      return new Response(JSON.stringify(o), { status: status || 200, headers: Object.assign({ 'Content-Type': 'application/json' }, CORS) });
    };
    var isHook = false;
    try {
      var url = new URL(req.url);
      if (url.searchParams.get('stripe') === 'webhook') {
        isHook = true;
        // Stripe tells us a payment finished. Only signed messages from Stripe are accepted.
        var raw = await req.text();
        await verifyStripe(raw, req.headers.get('stripe-signature'), env('STRIPE_WEBHOOK_SECRET'));
        var evt = JSON.parse(raw), obj = (evt.data && evt.data.object) || {};
        var pid = (obj.metadata && obj.metadata.payment_id) || obj.client_reference_id;
        if (pid) {
          var sbw = makeClient(env('SUPABASE_URL'), secretKey(env), { auth: { persistSession: false } });
          var dbw = await openStore(sbw);
          if ((evt.type === 'checkout.session.completed' || evt.type === 'checkout.session.async_payment_succeeded') && obj.payment_status === 'paid') {
            completePayment(dbw.store, pid, { session_id: obj.id, intent_id: obj.payment_intent || '', email: (obj.customer_details && obj.customer_details.email) || '' });
          } else if (evt.type === 'checkout.session.expired' || evt.type === 'checkout.session.async_payment_failed') {
            cancelPayment(dbw.store, pid, evt.type === 'checkout.session.expired' ? 'expired' : 'failed');
          }
          await dbw.flush();
        }
        return reply({ received: true });
      }
      var body = {};
      var type = req.headers.get('content-type') || '';
      if (type.indexOf('application/json') >= 0) { try { body = await req.json(); } catch (e) { body = {}; } }
      else if (type.indexOf('form') >= 0) { var fd = await req.formData(); fd.forEach(function (v, k) { body[k] = v; }); }
      var key = secretKey(env);
      if (!key) throw new Error('The server function has no database key. See the setup guide, step 3.');
      var sb = makeClient(env('SUPABASE_URL'), key, { auth: { persistSession: false } });
      var db = await openStore(sb, { withLog: body.action === 'history' });

      var data;
      if (url.searchParams.get('key')) {
        // website form webhook: ?key=<webhook_secret>, flat fields
        if (url.searchParams.get('key') !== db.settings.webhook_secret) throw new Error('bad key');
        var pick = function () { for (var i = 0; i < arguments.length; i++) if (body[arguments[i]]) return String(body[arguments[i]]); return ''; };
        var open = db.store.all('Events').filter(function (e) { return truthy(e.signup_open); }).map(function (e) { return e.id; });
        data = handle(db.store, null, 'submitSignup', {
          first: pick('first', 'First', 'first_name'), last: pick('last', 'Last', 'last_name'),
          email: pick('email', 'Email'), phone: pick('phone', 'Cell', 'cell'),
          typed_team: pick('team', 'Team Name', 'team_name'), typed_boat: pick('boat', 'Boat #', 'boat_number'),
          role: pick('role', 'Role', 'category'), event_ids: open
        });
      } else {
        data = handle(db.store, body.pin, body.action, body.payload || {});
      }
      await db.flush();
      if (data && data.checkout) {
        // payment row is saved as pending; now open a Stripe Checkout page for it
        var ck = data.checkout;
        var session = await stripeCheckout(env, db.settings, data, { return_url: ck.return_url, hash: (body.payload || {}).hash, email: ck.email });
        await must(sb.from('payments').update({ session_id: session.id }).eq('id', data.payment_id), 'saving payment');
        data = { payment_id: data.payment_id, total: data.total, url: session.url };
      }
      return reply({ ok: true, data: data });
    } catch (err) {
      // webhooks get a real error code so Stripe retries later
      return reply({ ok: false, error: String((err && err.message) || err) }, isHook ? 400 : 200);
    }
  };
}

if (typeof module !== 'undefined') module.exports = { openStore: openStore, makeHandler: makeHandler, toDb: toDb, fromDb: fromDb };
