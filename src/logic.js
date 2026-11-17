/**
 * RWO Registration: shared logic.
 *
 * This file has no Google-specific code, so the exact same rules run in
 * Apps Script (Server.gs), in the browser demo, and in the test suite.
 * Data access goes through a "store" object:
 *   store.all(table)               -> array of row objects
 *   store.insert(table, obj)       -> inserted obj (id filled in)
 *   store.update(table, id, patch) -> updated obj
 *   store.remove(table, id)
 *   store.settings()               -> { key: value }
 *   store.rules()                  -> { role: [requirementKey, ...] }
 *   store.newId(prefix), store.now()
 */

var SCHEMA = {
  Events:     ['id', 'name', 'location', 'start', 'end', 'current', 'signup_open'],
  Boats:      ['id', 'boat_no', 'team', 'class', 'owner_first', 'owner_last', 'owner_email', 'owner_phone', 'token', 'active',
               'details', 'registered_at'],
  Entries:    ['id', 'event_id', 'boat_id', 'entry_paid', 'tech', 'tech_by', 'tech_at', 'tech_notes',
               'safety', 'safety_by', 'safety_at', 'safety_notes', 'notes', 'stamps'],
  People:     ['id', 'first', 'last', 'email', 'phone', 'rwo_member', 'rwo_paid', 'apba_member', 'apba_paid',
               'apba_no', 'medical_exp', 'dunker_exp', 'notes', 'created', 'stamps'],
  Crew:       ['id', 'person_id', 'boat_id', 'role', 'event_ids', 'added_by', 'added_at'],
  Signatures: ['id', 'person_id', 'event_id', 'signed_at', 'signed_by', 'note'],
  Signups:    ['id', 'created', 'first', 'last', 'email', 'phone', 'typed_team', 'typed_boat', 'picked_boat_ids',
               'role', 'event_ids', 'status', 'suggestions', 'person_id', 'resolved_by', 'resolved_at', 'note'],
  Aliases:    ['key', 'typed', 'boat_id', 'added_by', 'added_at'],
  Log:        ['at', 'who', 'action', 'detail', 'ref'],
  Fees:       ['id', 'kind', 'name', 'class', 'event_match', 'amount', 'active', 'sort'],
  Payments:   ['id', 'created', 'kind', 'event_id', 'boat_id', 'person_ids', 'items', 'total', 'status', 'session_id',
               'intent_id', 'paid_at', 'payer_name', 'payer_email', 'note']
};
var BOOL_COLS = {
  Events: ['current', 'signup_open'],
  Boats: ['active'],
  Fees: ['active'],
  Entries: ['entry_paid', 'tech', 'safety'],
  People: ['rwo_member', 'rwo_paid', 'apba_member', 'apba_paid']
};
var DATE_COLS = { Events: ['start', 'end'], People: ['medical_exp', 'dunker_exp'] };

var ROLES = ['Driver', 'Throttleman', 'Navigator', 'Alt Driver', 'Alt Throttle', 'Crew', 'Owner',
             'Team Family', 'Team Sponsor', 'Other'];
var RACING_ROLES = ['Driver', 'Throttleman', 'Navigator', 'Alt Driver', 'Alt Throttle'];

var REQS = [
  { key: 'rwo_member',  label: 'RWO member' },
  { key: 'rwo_paid',    label: 'RWO payment' },
  { key: 'apba_member', label: 'APBA member' },
  { key: 'apba_paid',   label: 'APBA payment' },
  { key: 'medical',     label: 'Medical' },
  { key: 'dunker',      label: 'Dunker / swim' }
];

function defaultRules() {
  var all = REQS.map(function (r) { return r.key; });
  var basic = ['rwo_member', 'rwo_paid', 'apba_member', 'apba_paid'];
  var out = {};
  ROLES.forEach(function (role) { out[role] = RACING_ROLES.indexOf(role) >= 0 ? all.slice() : basic.slice(); });
  return out;
}

var DEFAULT_SETTINGS = {
  org_name: 'Race World Offshore',
  pin_admin: '9999',
  pin_office: '1111',
  pin_registration: '2222',
  pin_tech: '3333',
  pin_safety: '4444',
  required_roles: 'Driver|Alt Driver; Throttleman|Alt Throttle',
  navigator_required_if_listed: 'Y',
  crew_blocks_boat: 'N',
  must_be_ready_to_sign: 'Y',
  public_board: 'Y',
  public_team_pages: 'Y',
  auto_link_score: '70',
  auto_link_gap: '12',
  signup_note: '',
  site_url: '',
  timezone: 'America/New_York'
};

var PERMS = {
  admin:        ['view', 'people', 'sign', 'tech', 'safety', 'entry', 'setup', 'inbox', 'admin'],
  office:       ['view', 'people', 'sign', 'tech', 'safety', 'entry', 'setup', 'inbox'],
  registration: ['view', 'people', 'sign'],
  tech:         ['view', 'tech'],
  safety:       ['view', 'safety']
};
var DEPT_LABELS = { admin: 'Admin', office: 'Office', registration: 'Registration', tech: 'Tech', safety: 'Safety' };

/* ------------------------------------------------------------------ */
/* Text helpers: the part that ends "letter for letter" matching       */
/* ------------------------------------------------------------------ */

function norm(s) {
  return String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9]/g, '');
}
function digitsOf(s) { return String(s == null ? '' : s).replace(/\D/g, ''); }
var FILLER = { racing: 1, team: 1, offshore: 1, the: 1, motorsports: 1, motorsport: 1, race: 1, com: 1, inc: 1, llc: 1 };
function wordsOf(s) {
  var m = String(s == null ? '' : s).toLowerCase().replace(/[’']/g, '').match(/[a-z0-9]+/g) || [];
  var out = {};
  m.forEach(function (w) { if (!FILLER[w]) out[w] = 1; });
  return out;
}
/** 0..1 similarity of two strings (letter pairs), ignoring case and punctuation. */
function closeness(a, b) {
  a = norm(a); b = norm(b);
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;
  var pairs = function (s) {
    var m = {};
    for (var i = 0; i < s.length - 1; i++) { var p = s.substr(i, 2); m[p] = (m[p] || 0) + 1; }
    return m;
  };
  var A = pairs(a), B = pairs(b), hit = 0;
  Object.keys(A).forEach(function (p) { hit += Math.min(A[p], B[p] || 0); });
  return (2 * hit) / (a.length - 1 + b.length - 1);
}
/** "609 / 441", "42/742", "21 & S-21" -> separate boats */
function splitBoats(s) {
  var parts = String(s == null ? '' : s).split(/\/|,|&|\band\b|\+/i)
    .map(function (x) { return x.trim(); }).filter(Boolean);
  return parts.length ? parts : [''];
}
function aliasKey(team, boat) { return norm(team) + '|' + norm(boat); }
function truthy(v) {
  if (v === true) return true;
  var s = String(v == null ? '' : v).trim().toLowerCase();
  return s === 'true' || s === 'y' || s === 'yes' || s === '1' || s === 'x' || s === 'checked';
}
function isoDate(v) {
  if (!v) return '';
  if (Object.prototype.toString.call(v) === '[object Date]') {
    if (isNaN(v.getTime())) return '';
    var m = v.getMonth() + 1, d = v.getDate();
    return v.getFullYear() + '-' + (m < 10 ? '0' : '') + m + '-' + (d < 10 ? '0' : '') + d;
  }
  var s = String(v).trim();
  var iso = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) return iso[1] + '-' + ('0' + iso[2]).slice(-2) + '-' + ('0' + iso[3]).slice(-2);
  var us = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (us) {
    var y = us[3].length === 2 ? '20' + us[3] : us[3];
    return y + '-' + ('0' + us[1]).slice(-2) + '-' + ('0' + us[2]).slice(-2);
  }
  return s;
}
function listOf(s) {
  return String(s == null ? '' : s).split(',').map(function (x) { return x.trim(); }).filter(Boolean);
}
function fullName(p) { return ((p.first || '') + ' ' + (p.last || '')).trim(); }
function boatLabel(b) {
  if (!b) return '(unknown boat)';
  return (b.boat_no ? b.boat_no + ' ' : '') + (b.team || '') + (b.class ? ' (' + b.class + ')' : '');
}

/* ------------------------------------------------------------------ */
/* Context: everything loaded once per request, with lookups           */
/* ------------------------------------------------------------------ */

function loadCtx(store) {
  var c = {
    store: store,
    settings: store.settings(),
    rules: store.rules(),
    events: store.all('Events'),
    boats: store.all('Boats'),
    entries: store.all('Entries'),
    people: store.all('People'),
    crew: store.all('Crew'),
    sigs: store.all('Signatures'),
    fees: store.all('Fees'),
    payments: store.all('Payments')
  };
  c.eventById = indexBy(c.events, 'id');
  c.boatById = indexBy(c.boats, 'id');
  c.personById = indexBy(c.people, 'id');
  c.entryById = indexBy(c.entries, 'id');
  c.signed = {};
  c.sigs.forEach(function (s) { c.signed[s.event_id + '|' + s.person_id] = s; });
  return c;
}
function indexBy(rows, key) {
  var m = {};
  rows.forEach(function (r) { m[r[key]] = r; });
  return m;
}
function currentEvent(c) {
  return c.events.filter(function (e) { return truthy(e.current); })[0] || c.events[c.events.length - 1] || null;
}
function eventOrCurrent(c, eventId) { return (eventId && c.eventById[eventId]) || currentEvent(c); }

/** Crew rows racing with a boat at an event (blank event_ids = every event). */
function crewAt(c, boatId, eventId) {
  return c.crew.filter(function (r) {
    if (r.boat_id !== boatId) return false;
    var ev = listOf(r.event_ids);
    return ev.length === 0 || ev.indexOf(eventId) >= 0;
  });
}
function boatsEnteredAt(c, eventId) {
  var ids = {};
  c.entries.forEach(function (e) { if (e.event_id === eventId) ids[e.boat_id] = 1; });
  return ids;
}
/** All roles a person holds at this event (across every boat they're on). */
function rolesAt(c, personId, eventId) {
  var entered = boatsEnteredAt(c, eventId), roles = {};
  c.crew.forEach(function (r) {
    if (r.person_id !== personId || !entered[r.boat_id]) return;
    var ev = listOf(r.event_ids);
    if (ev.length && ev.indexOf(eventId) < 0) return;
    roles[r.role || 'Crew'] = 1;
  });
  return Object.keys(roles);
}

/* ------------------------------------------------------------------ */
/* Clearance                                                           */
/* ------------------------------------------------------------------ */

function reqMet(p, key, ev) {
  var end = (ev && isoDate(ev.end)) || isoDate(new Date());
  if (key === 'medical') return !!isoDate(p.medical_exp) && isoDate(p.medical_exp) >= end;
  if (key === 'dunker') return !!isoDate(p.dunker_exp) && isoDate(p.dunker_exp) >= end;
  return truthy(p[key]);
}

/**
 * Status of one person at one event.
 * state: 'cleared' | 'ready' (everything done, needs to sign) | 'needs'
 */
function personStatus(c, p, ev, rolesOverride) {
  var roles = rolesOverride || rolesAt(c, p.id, ev && ev.id);
  if (!roles.length) roles = ['Crew'];
  var need = {};
  roles.forEach(function (role) { (c.rules[role] || c.rules.Crew || []).forEach(function (k) { need[k] = 1; }); });
  var checks = REQS.filter(function (r) { return need[r.key]; }).map(function (r) {
    return { key: r.key, label: r.label, ok: reqMet(p, r.key, ev) };
  });
  var missing = checks.filter(function (x) { return !x.ok; }).map(function (x) { return x.label; });
  var sig = ev ? c.signed[ev.id + '|' + p.id] : null;
  var state = missing.length ? 'needs' : (sig ? 'cleared' : 'ready');
  return {
    state: state,
    text: state === 'cleared' ? 'Cleared' : state === 'ready' ? 'Ready to sign' : 'Needs: ' + missing.join(', '),
    missing: missing,
    checks: checks,
    roles: roles,
    signed: !!sig,
    signed_at: sig ? sig.signed_at : '',
    signed_by: sig ? sig.signed_by : '',
    sign_note: sig ? sig.note || '' : ''
  };
}

/** Status of one boat entry: the thing tech, safety and registration care about. */
function entryStatus(c, entry, withPeople) {
  var ev = c.eventById[entry.event_id], boat = c.boatById[entry.boat_id] || {};
  var s = c.settings;
  var rows = crewAt(c, entry.boat_id, entry.event_id);
  var crew = rows.map(function (r) {
    var p = c.personById[r.person_id];
    if (!p) return null;
    var st = personStatus(c, p, ev);
    return { crew_id: r.id, person_id: p.id, name: fullName(p), role: r.role || 'Crew', status: st };
  }).filter(Boolean);
  var order = function (role) { var i = ROLES.indexOf(role); return i < 0 ? 99 : i; };
  crew.sort(function (a, b) { return order(a.role) - order(b.role) || a.name.localeCompare(b.name); });

  var checks = [];
  checks.push({ key: 'entry', label: 'Entry paid', ok: truthy(entry.entry_paid) });
  String(s.required_roles || '').split(';').map(function (g) { return g.trim(); }).filter(Boolean).forEach(function (group) {
    var roles = group.split('|').map(function (x) { return x.trim(); });
    var listed = crew.filter(function (m) { return roles.indexOf(m.role) >= 0; });
    var ok = listed.filter(function (m) { return m.status.state === 'cleared'; });
    checks.push({
      key: 'role:' + roles[0], label: roles[0], ok: ok.length > 0,
      detail: ok.length ? ok.map(function (m) { return m.name; }).join(', ')
        : listed.length ? listed.map(function (m) { return m.name + ': ' + m.status.text; }).join('; ') : 'None listed'
    });
  });
  if (truthy(s.navigator_required_if_listed)) {
    var navs = crew.filter(function (m) { return m.role === 'Navigator'; });
    if (navs.length) {
      var navOk = navs.filter(function (m) { return m.status.state === 'cleared'; });
      checks.push({ key: 'role:Navigator', label: 'Navigator', ok: navOk.length > 0,
        detail: navOk.length ? navOk.map(function (m) { return m.name; }).join(', ')
          : navs.map(function (m) { return m.name + ': ' + m.status.text; }).join('; ') });
    }
  }
  var outstanding = crew.filter(function (m) { return m.status.state !== 'cleared'; });
  if (truthy(s.crew_blocks_boat)) {
    checks.push({ key: 'crew', label: 'All crew', ok: outstanding.length === 0,
      detail: outstanding.length ? outstanding.length + ' not cleared' : '' });
  }
  checks.push({ key: 'tech', label: 'Tech', ok: truthy(entry.tech), detail: entry.tech_notes || '' });
  checks.push({ key: 'safety', label: 'Safety', ok: truthy(entry.safety), detail: entry.safety_notes || '' });

  var missing = checks.filter(function (x) { return !x.ok; }).map(function (x) { return x.label; });
  var out = {
    entry_id: entry.id,
    event_id: entry.event_id,
    boat_id: boat.id,
    boat_no: boat.boat_no || '',
    team: boat.team || '',
    class: boat.class || '',
    label: boatLabel(boat),
    cleared: missing.length === 0,
    text: missing.length === 0 ? 'CLEARED TO RACE' : 'Needs: ' + missing.join(', '),
    checks: checks,
    crew_total: crew.length,
    crew_outstanding: outstanding.length,
    tech: truthy(entry.tech), tech_notes: entry.tech_notes || '', tech_by: entry.tech_by || '', tech_at: entry.tech_at || '',
    safety: truthy(entry.safety), safety_notes: entry.safety_notes || '', safety_by: entry.safety_by || '', safety_at: entry.safety_at || '',
    entry_paid: truthy(entry.entry_paid),
    notes: entry.notes || ''
  };
  if (withPeople) out.crew = crew;
  return out;
}

/* ------------------------------------------------------------------ */
/* Matching a sign-up to a boat                                        */
/* ------------------------------------------------------------------ */

function aliasMap(store) {
  var m = {};
  store.all('Aliases').forEach(function (a) { (m[a.key] = m[a.key] || []).push(a.boat_id); });
  return m;
}

/** How well a typed team name matches a boat's team name, 0..1. Small typos still count ("Rip Curent" = "Rip Current"). */
function nameMatch(typed, team) {
  if (!norm(typed) || !norm(team)) return 0;
  if (norm(typed) === norm(team)) return 1;
  var A = Object.keys(wordsOf(typed)), B = Object.keys(wordsOf(team));
  if (!A.length || !B.length) return closeness(typed, team);
  var hit = function (w, list) {
    return list.some(function (x) { return x === w || (w.length >= 4 && x.length >= 4 && closeness(w, x) >= 0.8) || (w.length >= 3 && x.indexOf(w) === 0); });
  };
  var aCov = A.filter(function (w) { return hit(w, B); }).length / A.length;   // how much of what they typed is in the team name
  var bCov = B.filter(function (w) { return hit(w, A); }).length / B.length;   // how much of the team name they typed
  var words = aCov === 0 ? 0 : 0.75 * aCov + 0.25 * bCov;
  var whole = closeness(typed, team);
  var inside = norm(team).indexOf(norm(typed)) >= 0 && norm(typed).length >= 4 ? 0.85 : 0;
  return Math.max(words, whole, inside);
}
/** How well a typed boat number matches, 0..1: "S17" = "S-17", "8" ~ "08", "12" ~ "S-12". */
function boatMatch(typed, boatNo) {
  var a = norm(typed), b = norm(boatNo);
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.replace(/^0+/, '') === b.replace(/^0+/, '')) return 0.9;
  var da = digitsOf(typed).replace(/^0+/, ''), db = digitsOf(boatNo).replace(/^0+/, '');
  if (da && da === db) return 0.7;
  return 0;
}

/** Scores every active boat for one typed boat number. Returns [{boat, score, name, num, why}] best first. */
function scoreBoats(c, signup, typedBoat, aliases, preferEventIds) {
  var team = signup.typed_team || '';
  var me = norm(fullName(signup));
  var email = String(signup.email || '').trim().toLowerCase();
  var preferred = {};
  (preferEventIds && preferEventIds.length ? preferEventIds : c.events.filter(function (e) { return truthy(e.signup_open); }).map(function (e) { return e.id; }))
    .forEach(function (eid) { Object.keys(boatsEnteredAt(c, eid)).forEach(function (b) { preferred[b] = 1; }); });
  var aliasHit = aliases[aliasKey(team, typedBoat)] || [];
  var teamOnlyHit = aliases[aliasKey(team, '')] || [];
  var mine = {};
  if (email) {
    var person = c.people.filter(function (p) { return String(p.email || '').toLowerCase() === email; })[0];
    if (person) c.crew.forEach(function (r) { if (r.person_id === person.id) mine[r.boat_id] = 1; });
  }
  return c.boats.filter(function (b) { return b.active === '' || b.active == null || truthy(b.active); }).map(function (b) {
    var why = [];
    var nm = nameMatch(team, b.team), bn = boatMatch(typedBoat, b.boat_no);
    var s = 60 * nm + 40 * bn;
    if (nm >= 0.6) why.push('team name');
    if (bn) why.push('boat #');
    if (aliasHit.indexOf(b.id) >= 0) { s += 200; why.push('remembered spelling'); }
    else if (teamOnlyHit.indexOf(b.id) >= 0) { s += 60; why.push('remembered team spelling'); }
    if (me && me === norm((b.owner_first || '') + (b.owner_last || ''))) { s += 40; why.push('owner name'); }
    if (email && email === String(b.owner_email || '').trim().toLowerCase()) { s += 40; why.push('owner email'); }
    if (mine[b.id]) { s += 30; why.push('already on this boat'); }
    if (preferred[b.id]) s += 5;
    return { boat: b, score: Math.round(s), name: nm, num: bn, why: why };
  }).sort(function (x, y) { return y.score - x.score; });
}

/**
 * Decide which boats a sign-up belongs to, without asking whenever the evidence is clear:
 *  - a remembered spelling, or
 *  - the team name clearly points at one team (boat numbers repeat between teams, names rarely do), or
 *  - the boat number is exact and only one boat uses it, with no other team name pointing elsewhere, or
 *  - one boat simply scores well clear of the rest.
 * Only real 50/50 calls are left for the office.
 */
function matchSignup(c, signup, aliases) {
  var auto = Number(c.settings.auto_link_score || 70), gap = Number(c.settings.auto_link_gap || 12);
  var linked = [], suggested = [], ignored = [];
  var typed = splitBoats(signup.typed_boat);
  var sameBoat = function (a, b) { return norm(a.boat_no) === norm(b.boat_no) && norm(a.team) === norm(b.team); };
  var teamTyped = norm(signup.typed_team).length >= 2;
  // the team name decides first: which teams does it clearly mean?
  var nameTeams = {};
  if (teamTyped) c.boats.forEach(function (b) { if (nameMatch(signup.typed_team, b.team) >= 0.8) nameTeams[norm(b.team)] = 1; });
  var oneTeam = Object.keys(nameTeams).length === 1 ? Object.keys(nameTeams)[0] : null;

  typed.forEach(function (tb) {
    var ranked = scoreBoats(c, signup, tb, aliases, listOf(signup.event_ids));
    if (!ranked.length) return;
    var best = ranked[0];
    var pick = null;
    if (best.why.indexOf('remembered spelling') >= 0) pick = best;
    else if (oneTeam) {
      // the name points at exactly one team: use that team's boat that best fits the number
      var ofTeam = ranked.filter(function (r) { return norm(r.boat.team) === oneTeam; });
      var withNum = ofTeam.filter(function (r) { return r.num >= 0.7; });
      if (withNum.length) pick = withNum[0];
      else if (ofTeam.length && (typed.length === 1 || !tb)) pick = ofTeam[0];
      else if (ofTeam.length) { ignored.push(tb); return; } // e.g. "Mangrove 66 / 22": 22 isn't a Mangrove boat
    } else if (Object.keys(nameTeams).length > 1) {
      // the name fits more than one team (e.g. "Legend 504" and "Team Legend 504"): the boat number decides
      var both = ranked.filter(function (r) { return r.name >= 0.8 && r.num >= 0.9; });
      var firstB = both[0];
      if (firstB && both.every(function (r) { return sameBoat(r.boat, firstB.boat); })) pick = firstB;
    } else if (!teamTyped || best.name < 0.5) {
      var exact = ranked.filter(function (r) { return r.num === 1; });
      var nearly = ranked.filter(function (r) { return r.num >= 0.9; });
      if (exact.length === 1 && Object.keys(nameTeams).length === 0) pick = exact[0];
      else if (!exact.length && nearly.length === 1 && Object.keys(nameTeams).length === 0) pick = nearly[0];
    }
    if (!pick) {
      var runner = ranked.filter(function (r) { return !sameBoat(r.boat, best.boat); })[0];
      if (best.score >= auto && best.score - (runner ? runner.score : 0) >= gap) pick = best;
    }
    if (pick) {
      ranked.filter(function (r) { return r.score === pick.score && sameBoat(r.boat, pick.boat); }).forEach(function (r) {
        if (linked.indexOf(r.boat.id) < 0) linked.push(r.boat.id);
      });
      if (linked.indexOf(pick.boat.id) < 0) linked.push(pick.boat.id);
    } else {
      ranked.slice(0, 3).forEach(function (r) { if ((r.name >= 0.7 || r.num >= 0.9) && suggested.indexOf(r.boat.id) < 0) suggested.push(r.boat.id); });
    }
  });
  return { linked: linked, suggested: suggested.filter(function (id) { return linked.indexOf(id) < 0; }), ignored: ignored,
    open: typed.length - ignored.length > 0 && !linked.length ? true : typed.some(function (tb) { return false; }) };
}

/* ------------------------------------------------------------------ */
/* Writes                                                              */
/* ------------------------------------------------------------------ */

function log(store, who, action, detail, ref) {
  store.insert('Log', { at: store.now(), who: who || '', action: action,
    detail: typeof detail === 'string' ? detail : JSON.stringify(detail), ref: ref || '' });
}

/* Who last changed each checkbox or date, and when: { field: { by, at, v } } */
var FIELD_LABELS = { rwo_member: 'RWO member', rwo_paid: 'RWO paid', apba_member: 'APBA member', apba_paid: 'APBA paid',
  apba_no: 'APBA number', medical_exp: 'Medical expires', dunker_exp: 'Dunker / swim expires', entry_paid: 'Entry paid',
  tech: 'Tech', safety: 'Safety', first: 'First name', last: 'Last name', email: 'Email', phone: 'Phone', notes: 'Notes',
  tech_notes: 'Tech notes', safety_notes: 'Safety notes' };
var STAMPED = ['rwo_member', 'rwo_paid', 'apba_member', 'apba_paid', 'apba_no', 'medical_exp', 'dunker_exp', 'entry_paid', 'tech', 'safety'];
function readStamps(row) {
  try { var o = JSON.parse(row && row.stamps || '{}'); return o && typeof o === 'object' ? o : {}; } catch (e) { return {}; }
}
function addStamps(store, row, patch, who) {
  var st = readStamps(row), now = store.now(), any = false;
  Object.keys(patch).forEach(function (k) {
    if (STAMPED.indexOf(k) < 0) return;
    st[k] = { by: who || '', at: now, v: patch[k] };
    any = true;
  });
  return any ? JSON.stringify(st) : null;
}
/** "RWO paid: yes", "Medical expires: 2027-05-09" */
function describe(patch) {
  return Object.keys(patch).filter(function (k) { return k !== 'stamps'; }).map(function (k) {
    var v = patch[k], label = FIELD_LABELS[k] || k;
    if (typeof v === 'boolean') return label + ': ' + (v ? 'yes' : 'no');
    return label + ': ' + (v === '' || v == null ? '(cleared)' : v);
  }).join(', ');
}

function findPerson(c, data) {
  var email = String(data.email || '').trim().toLowerCase();
  if (email) {
    var byEmail = c.people.filter(function (p) { return String(p.email || '').trim().toLowerCase() === email; })[0];
    if (byEmail) return byEmail;
  }
  var key = norm(data.first) + '|' + norm(data.last);
  if (key === '|') return null;
  var byName = c.people.filter(function (p) { return norm(p.first) + '|' + norm(p.last) === key; });
  // only trust a name match when it is unique and doesn't contradict a different email
  if (byName.length === 1 && (!email || !byName[0].email)) return byName[0];
  return null;
}

function upsertPerson(c, data, who) {
  var store = c.store;
  var p = findPerson(c, data);
  if (p) {
    var patch = {};
    ['email', 'phone'].forEach(function (k) { if (data[k] && !p[k]) patch[k] = data[k]; });
    if (Object.keys(patch).length) { p = store.update('People', p.id, patch); c.personById[p.id] = p; }
    return p;
  }
  p = store.insert('People', {
    id: store.newId('P'), first: String(data.first || '').trim(), last: String(data.last || '').trim(),
    email: String(data.email || '').trim(), phone: String(data.phone || '').trim(),
    rwo_member: !!data.rwo_member, rwo_paid: !!data.rwo_paid, apba_member: !!data.apba_member, apba_paid: !!data.apba_paid,
    apba_no: data.apba_no || '', medical_exp: isoDate(data.medical_exp), dunker_exp: isoDate(data.dunker_exp),
    notes: '', created: store.now(), stamps: ''
  });
  var initial = {};
  STAMPED.forEach(function (k) { if (p[k] === true || (typeof p[k] === 'string' && p[k])) initial[k] = p[k]; });
  var st0 = addStamps(store, p, initial, who);
  if (st0) { p = store.update('People', p.id, { stamps: st0 }); }
  c.people.push(p); c.personById[p.id] = p;
  log(store, who, 'person.create', 'Added ' + fullName(p) + (p.email ? ' (' + p.email + ')' : ''), p.id);
  return p;
}

function upsertCrew(c, personId, boatId, role, eventIds, who) {
  var store = c.store;
  var row = c.crew.filter(function (r) { return r.person_id === personId && r.boat_id === boatId; })[0];
  role = role || 'Crew';
  if (row) {
    var patch = {};
    if (role && role !== row.role && (row.role === 'Crew' || !row.role)) patch.role = role;
    var ev = listOf(row.event_ids);
    if (ev.length) {
      var add = listOf(eventIds);
      if (!add.length) {
        patch.event_ids = ''; // now racing every event
      } else {
        add.forEach(function (e) { if (ev.indexOf(e) < 0) ev.push(e); });
        if (ev.join(',') !== row.event_ids) patch.event_ids = ev.join(',');
      }
    }
    if (Object.keys(patch).length) {
      row = store.update('Crew', row.id, patch);
      c.crew = c.crew.map(function (r) { return r.id === row.id ? row : r; });
    }
    return row;
  }
  row = store.insert('Crew', { id: store.newId('C'), person_id: personId, boat_id: boatId, role: role,
    event_ids: listOf(eventIds).join(','), added_by: who || '', added_at: store.now() });
  c.crew.push(row);
  return row;
}

function linkSignup(c, signup, boatIds, who, remember) {
  var store = c.store;
  var p = upsertPerson(c, signup, who);
  boatIds.forEach(function (bid) { upsertCrew(c, p.id, bid, signup.role || 'Crew', signup.event_ids, who); });
  if (remember && boatIds.length && (signup.typed_team || signup.typed_boat)) {
    var boats = splitBoats(signup.typed_boat);
    var aliases = store.all('Aliases');
    var keys = boats.length === boatIds.length
      ? boats.map(function (tb, i) { return { key: aliasKey(signup.typed_team, tb), boat: boatIds[i], typed: signup.typed_team + ' / ' + tb }; })
      : boatIds.length === 1 ? [{ key: aliasKey(signup.typed_team, signup.typed_boat), boat: boatIds[0], typed: signup.typed_team + ' / ' + signup.typed_boat }] : [];
    keys.forEach(function (k) {
      var exists = aliases.some(function (a) { return a.key === k.key && a.boat_id === k.boat; });
      if (!exists && k.key !== '|') store.insert('Aliases', { key: k.key, typed: k.typed, boat_id: k.boat, added_by: who || '', added_at: store.now() });
    });
  }
  return p;
}

/* ------------------------------------------------------------------ */
/* API: every screen talks to this one function                        */
/* ------------------------------------------------------------------ */

function handle(store, pin, action, p) {
  p = p || {};
  var c = loadCtx(store);
  var dept = deptForPin(c.settings, pin);
  var who = dept ? (p.who ? p.who + ' (' + DEPT_LABELS[dept] + ')' : DEPT_LABELS[dept]) : 'public';
  var can = function (perm) {
    if (!dept || PERMS[dept].indexOf(perm) < 0) throw new Error('Your department can’t do that. Sign in with the right PIN.');
  };
  var ev = eventOrCurrent(c, p.event_id);
  var READS = ['login', 'bootstrap', 'board', 'signupOptions', 'submitSignup', 'team', 'boat', 'searchPeople', 'person',
    'searchBoats', 'inbox', 'setup', 'history', 'teamBoat', 'registerOptions', 'boatProfile', 'registerBoat', 'checkout',
    'demoPay', 'adminGet'];
  if (dept && READS.indexOf(action) < 0 && !String(p.who || '').trim()) {
    throw new Error('Sign out and sign back in with your name, so changes show who made them.');
  }

  switch (action) {
    /* ----- open to everyone ----- */
    case 'login':
      if (!dept) throw new Error('That PIN didn’t match a department.');
      return { dept: dept, label: DEPT_LABELS[dept], perms: PERMS[dept] };

    case 'bootstrap':
      return {
        org: c.settings.org_name || 'Registration',
        public_board: truthy(c.settings.public_board),
        current_event_id: (currentEvent(c) || {}).id || '',
        events: c.events.map(function (e) {
          return { id: e.id, name: e.name, location: e.location, start: isoDate(e.start), end: isoDate(e.end),
            current: truthy(e.current), signup_open: truthy(e.signup_open) };
        }),
        roles: ROLES,
        dept: dept, dept_label: dept ? DEPT_LABELS[dept] : '', perms: dept ? PERMS[dept] : []
      };

    case 'board': {
      if (!dept && !truthy(c.settings.public_board)) throw new Error('The status board is not public.');
      if (!ev) return { event: null, entries: [] };
      var list = c.entries.filter(function (e) { return e.event_id === ev.id; }).map(function (e) {
        var st = entryStatus(c, e, false);
        if (!dept) { delete st.tech_notes; delete st.safety_notes; delete st.notes; st.checks.forEach(function (k) { delete k.detail; }); }
        return st;
      });
      list.sort(sortBoats);
      return { event: ev, entries: list };
    }

    case 'signupOptions': {
      var open = c.events.filter(function (e) { return truthy(e.signup_open); });
      var ids = {};
      open.forEach(function (e) { Object.keys(boatsEnteredAt(c, e.id)).forEach(function (b) { ids[b] = 1; }); });
      var boats = c.boats.filter(function (b) { return ids[b.id] || (b.active !== '' && truthy(b.active)); })
        .map(function (b) { return { id: b.id, label: boatLabel(b), boat_no: b.boat_no, team: b.team }; })
        .sort(function (a, b) { return a.label.localeCompare(b.label, undefined, { numeric: true }); });
      return { events: open.map(function (e) { return { id: e.id, name: e.name, start: isoDate(e.start) }; }),
        boats: boats, roles: ROLES, note: c.settings.signup_note || '', membership_fee: Number((membershipFee(c) || {}).amount || 0) };
    }

    case 'submitSignup': {
      if (!String(p.first || '').trim() || !String(p.last || '').trim()) throw new Error('Please enter your first and last name.');
      if (!/^\S+@\S+\.\S+$/.test(String(p.email || '').trim())) throw new Error('Please enter a valid email address.');
      var picked = (p.picked_boat_ids || []).filter(function (id) { return c.boatById[id]; });
      if (!picked.length && !String(p.typed_team || '').trim() && !String(p.typed_boat || '').trim()) {
        throw new Error('Pick your boat from the list, or type your team name and boat number.');
      }
      var su = store.insert('Signups', {
        id: store.newId('S'), created: store.now(),
        first: String(p.first).trim(), last: String(p.last).trim(), email: String(p.email).trim(), phone: String(p.phone || '').trim(),
        typed_team: String(p.typed_team || '').trim(), typed_boat: String(p.typed_boat || '').trim(),
        picked_boat_ids: picked.join(','), role: ROLES.indexOf(p.role) >= 0 ? p.role : 'Crew',
        event_ids: (p.event_ids || []).join(','), status: 'New', suggestions: '', person_id: '', resolved_by: '', resolved_at: '', note: ''
      });
      return processSignup(c, su, 'sign-up form');
    }

    case 'team': {
      var boat = c.boats.filter(function (b) { return b.token && b.token === p.token; })[0];
      if (!boat) throw new Error('This team link isn\u2019t valid. Ask the RWO office for a new one.');
      return teamView(c, boat);
    }

    case 'teamBoat': {
      if (!dept && !truthy(c.settings.public_team_pages)) throw new Error('Team pages are private. Ask the RWO office for your team link.');
      var tb = c.boatById[p.boat_id];
      if (!tb) throw new Error('Boat not found.');
      return teamView(c, tb);
    }

    /* ----- staff ----- */
    case 'boat': {
      can('view');
      var en = c.entryById[p.entry_id];
      if (!en) throw new Error('Boat entry not found.');
      var st2 = entryStatus(c, en, true);
      st2.event = c.eventById[en.event_id];
      st2.token = dept === 'office' ? (c.boatById[en.boat_id] || {}).token || '' : '';
      st2.stamps = readStamps(en);
      return st2;
    }

    case 'searchPeople': {
      can('view');
      var q = norm(p.q);
      if (q.length < 2) return [];
      var hits = rankPeople(c, p.q).map(function (h) { return h.person; });
      // searching a boat number or team also lists its crew
      if (!p.names_only) c.boats.forEach(function (b) {
        if (norm(b.boat_no) === q || (q.length >= 3 && norm(b.team).indexOf(q) >= 0)) {
          crewAt(c, b.id, ev && ev.id).forEach(function (r) { var per = c.personById[r.person_id]; if (per && hits.indexOf(per) < 0) hits.push(per); });
        }
      });
      return hits.slice(0, 40).map(function (per) { return personSummary(c, per, ev); });
    }

    case 'person': {
      can('view');
      var per2 = c.personById[p.id];
      if (!per2) throw new Error('Person not found.');
      var sum = personSummary(c, per2, ev);
      sum.fields = { first: per2.first, last: per2.last, email: per2.email, phone: per2.phone,
        rwo_member: truthy(per2.rwo_member), rwo_paid: truthy(per2.rwo_paid), apba_member: truthy(per2.apba_member),
        apba_paid: truthy(per2.apba_paid), apba_no: per2.apba_no || '', medical_exp: isoDate(per2.medical_exp),
        dunker_exp: isoDate(per2.dunker_exp), notes: per2.notes || '' };
      sum.stamps = readStamps(per2);
      sum.crew = c.crew.filter(function (r) { return r.person_id === per2.id; }).map(function (r) {
        return { crew_id: r.id, boat_id: r.boat_id, boat: boatLabel(c.boatById[r.boat_id]), role: r.role,
          events: listOf(r.event_ids).map(function (id) { return (c.eventById[id] || {}).name || id; }) };
      });
      return sum;
    }

    case 'updatePerson': {
      can('people');
      var allowed = ['first', 'last', 'email', 'phone', 'rwo_member', 'rwo_paid', 'apba_member', 'apba_paid', 'apba_no', 'medical_exp', 'dunker_exp', 'notes'];
      var patch = {};
      Object.keys(p.patch || {}).forEach(function (k) {
        if (allowed.indexOf(k) < 0) return;
        var v = p.patch[k];
        if (/_exp$/.test(k)) {
          v = isoDate(v);
          if (v && !/^20\d\d-\d\d-\d\d$/.test(v)) throw new Error('That date doesn\u2019t look right. Use a date like 11/01/2027.');
        }
        patch[k] = v;
      });
      var cur = c.personById[p.id];
      if (!cur) throw new Error('Person not found.');
      Object.keys(patch).forEach(function (k) {
        var was = typeof patch[k] === 'boolean' ? truthy(cur[k]) : String(cur[k] == null ? '' : cur[k]);
        if (was === patch[k]) delete patch[k];
      });
      if (!Object.keys(patch).length) return handle(store, pin, 'person', { id: p.id, event_id: ev && ev.id });
      var stp = addStamps(store, cur, patch, who);
      var full = Object.assign({}, patch);
      if (stp) full.stamps = stp;
      store.update('People', p.id, full);
      log(store, who, 'person.update', fullName(cur) + ': ' + describe(patch), p.id);
      return handle(store, pin, 'person', { id: p.id, event_id: ev && ev.id });
    }

    case 'sign': {
      can('sign');
      var per3 = c.personById[p.person_id];
      if (!per3 || !ev) throw new Error('Person or event not found.');
      var st3 = personStatus(c, per3, ev);
      if (st3.signed) return handle(store, pin, 'person', { id: per3.id, event_id: ev.id });
      if (p.override && dept !== 'office' && dept !== 'admin') throw new Error('Only the office can let someone sign before they’re ready.');
      if (st3.state !== 'ready' && truthy(c.settings.must_be_ready_to_sign) && !p.override) {
        throw new Error(fullName(per3) + ' can’t sign yet. ' + st3.text);
      }
      var ovr = st3.state !== 'ready' ? 'Signed while missing: ' + st3.missing.join(', ') : '';
      store.insert('Signatures', { id: store.newId('G'), person_id: per3.id, event_id: ev.id, signed_at: store.now(), signed_by: who, note: ovr });
      log(store, who, 'sign', 'Signed ' + fullName(per3) + ' in for ' + ev.name + (ovr ? ' (' + ovr + ')' : ''), per3.id);
      return handle(store, pin, 'person', { id: per3.id, event_id: ev.id });
    }

    case 'unsign': {
      can('sign');
      var sig = c.signed[(ev && ev.id) + '|' + p.person_id];
      if (sig) {
        store.remove('Signatures', sig.id);
        log(store, who, 'unsign', 'Removed signature of ' + fullName(c.personById[p.person_id] || {}) + ' for ' + ev.name +
          ' (had been signed ' + sig.signed_at + ' by ' + sig.signed_by + ')', p.person_id);
      }
      return handle(store, pin, 'person', { id: p.person_id, event_id: ev && ev.id });
    }

    case 'setEntry': {
      var en2 = c.entryById[p.entry_id];
      if (!en2) throw new Error('Boat entry not found.');
      var f = p.field, upd = {};
      if (f === 'tech' || f === 'tech_notes') {
        can('tech');
        if (f === 'tech') { upd.tech = !!p.value; upd.tech_by = p.value ? who : ''; upd.tech_at = p.value ? store.now() : ''; }
        else upd.tech_notes = String(p.value || '');
      } else if (f === 'safety' || f === 'safety_notes') {
        can('safety');
        if (f === 'safety') { upd.safety = !!p.value; upd.safety_by = p.value ? who : ''; upd.safety_at = p.value ? store.now() : ''; }
        else upd.safety_notes = String(p.value || '');
      } else if (f === 'entry_paid' || f === 'notes') {
        can('entry');
        upd[f] = f === 'entry_paid' ? !!p.value : String(p.value || '');
      } else throw new Error('Unknown field.');
      var stE = addStamps(store, en2, upd, who);
      if (stE) upd.stamps = stE;
      store.update('Entries', en2.id, upd);
      var evN = (c.eventById[en2.event_id] || {}).name || '';
      var what = f === 'tech' || f === 'safety' ? (FIELD_LABELS[f] + (p.value ? ' passed' : ' un-passed'))
        : f === 'entry_paid' ? ('Entry paid: ' + (p.value ? 'yes' : 'no')) : (FIELD_LABELS[f] + ': ' + (p.value || '(cleared)'));
      log(store, who, 'boat.' + f, boatLabel(c.boatById[en2.boat_id]) + ' at ' + evN + ': ' + what, en2.id);
      return handle(store, pin, 'boat', { entry_id: en2.id });
    }

    case 'addCrew': {
      can('people');
      if (!c.boatById[p.boat_id]) throw new Error('Pick a boat.');
      var per4 = p.person_id ? c.personById[p.person_id] : upsertPerson(c, p.person || {}, who);
      if (!per4) throw new Error('Person not found.');
      upsertCrew(c, per4.id, p.boat_id, p.role || 'Crew', p.event_ids || '', who);
      log(store, who, 'crew.add', 'Put ' + fullName(per4) + ' on ' + boatLabel(c.boatById[p.boat_id]) + ' as ' + (p.role || 'Crew'), per4.id);
      return handle(store, pin, 'person', { id: per4.id, event_id: ev && ev.id });
    }

    case 'updateCrew': {
      can('people');
      var row = c.crew.filter(function (r) { return r.id === p.crew_id; })[0];
      if (!row) throw new Error('Crew link not found.');
      var crewWho = fullName(c.personById[row.person_id] || {}), crewBoat = boatLabel(c.boatById[row.boat_id]);
      if (p.remove) { store.remove('Crew', row.id); log(store, who, 'crew.remove', 'Took ' + crewWho + ' off ' + crewBoat, row.person_id); }
      else {
        var cp = {};
        if (p.role) cp.role = p.role;
        if (p.event_ids != null) cp.event_ids = listOf(p.event_ids).join(',');
        store.update('Crew', row.id, cp);
        log(store, who, 'crew.update', crewWho + ' on ' + crewBoat + ': ' + (cp.role ? 'role ' + cp.role : '') + (cp.event_ids != null ? ' races ' + (cp.event_ids || 'all events') : ''), row.person_id);
      }
      return handle(store, pin, 'person', { id: row.person_id, event_id: ev && ev.id });
    }

    case 'searchBoats': {
      can('view');
      var bq = norm(p.q);
      return c.boats.filter(function (b) {
        return !bq || norm(b.boat_no).indexOf(bq) === 0 || norm(b.team).indexOf(bq) >= 0 || digitsOf(b.boat_no) === digitsOf(p.q);
      }).slice(0, 30).map(function (b) { return { id: b.id, label: boatLabel(b) }; });
    }

    case 'inbox': {
      can('inbox');
      var open2 = store.all('Signups').filter(function (s) { return s.status === 'Needs review' || s.status === 'No match yet' || s.status === 'New'; });
      open2.sort(function (a, b) { return (a.status === 'No match yet') - (b.status === 'No match yet') || String(b.created).localeCompare(String(a.created)); });
      return open2.map(function (s) {
        return { id: s.id, created: s.created, name: fullName(s), email: s.email, phone: s.phone, role: s.role,
          typed_team: s.typed_team, typed_boat: s.typed_boat, status: s.status, note: s.note === 'imported' ? 'From the Airtable import' : s.note,
          events: listOf(s.event_ids).map(function (id) { return (c.eventById[id] || {}).name || id; }),
          suggestions: listOf(s.suggestions).map(function (id) { return { id: id, label: boatLabel(c.boatById[id]) }; })
            .filter(function (x) { return c.boatById[x.id]; }) };
      });
    }

    case 'resolveSignup': {
      can('inbox');
      var s2 = store.all('Signups').filter(function (s) { return s.id === p.id; })[0];
      if (!s2) throw new Error('Sign-up not found.');
      if (p.ignore) {
        store.update('Signups', s2.id, { status: 'Ignored', resolved_by: who, resolved_at: store.now(), note: p.note || '' });
        log(store, who, 'signup.ignore', 'Removed sign-up from ' + fullName(s2) + ' from the inbox', s2.id);
        return { ok: true };
      }
      var ids2 = (p.boat_ids || []).filter(function (id) { return c.boatById[id]; });
      if (!ids2.length) throw new Error('Pick at least one boat.');
      var per5 = linkSignup(c, s2, ids2, who, p.remember !== false);
      store.update('Signups', s2.id, { status: 'Linked', person_id: per5.id, resolved_by: who, resolved_at: store.now() });
      log(store, who, 'signup.link', 'Put ' + fullName(s2) + ' on ' + ids2.map(function (id) { return boatLabel(c.boatById[id]); }).join(', ') +
        ' (they typed "' + s2.typed_team + ' / ' + s2.typed_boat + '")', per5.id);
      // a newly remembered spelling may settle other waiting sign-ups
      rematchWaiting(store);
      return { ok: true };
    }

    case 'rematch': {
      can('inbox');
      return { linked: rematchWaiting(store) };
    }

    /* ----- setup (office) ----- */
    case 'setup': {
      can('setup');
      return {
        events: c.events.map(function (e) { return { id: e.id, name: e.name, location: e.location, start: isoDate(e.start), end: isoDate(e.end), current: truthy(e.current), signup_open: truthy(e.signup_open) }; }),
        boats: c.boats.map(function (b) {
          return { id: b.id, boat_no: b.boat_no, team: b.team, class: b.class, owner_first: b.owner_first, owner_last: b.owner_last,
            owner_email: b.owner_email, owner_phone: b.owner_phone, token: b.token, active: b.active === '' || b.active == null ? true : truthy(b.active),
            events: c.entries.filter(function (e) { return e.boat_id === b.id; }).map(function (e) { return e.event_id; }) };
        }).sort(function (a, b) { return String(a.boat_no).localeCompare(String(b.boat_no), undefined, { numeric: true }); })
      };
    }

    case 'saveEvent': {
      can('setup');
      var evData = { name: p.name, location: p.location || '', start: isoDate(p.start), end: isoDate(p.end), signup_open: !!p.signup_open };
      [evData.start, evData.end].forEach(function (d) { if (d && !/^20\d\d-\d\d-\d\d$/.test(d)) throw new Error('One of the event dates doesn\u2019t look right.'); });
      if (!evData.name) throw new Error('Give the event a name.');
      if (p.id) store.update('Events', p.id, evData);
      else store.insert('Events', Object.assign({ id: store.newId('E'), current: c.events.length === 0 }, evData));
      log(store, who, 'event.save', evData.name);
      return handle(store, pin, 'setup', {});
    }

    case 'setCurrentEvent': {
      can('setup');
      c.events.forEach(function (e) { store.update('Events', e.id, { current: e.id === p.id }); });
      log(store, who, 'event.current', (c.eventById[p.id] || {}).name);
      return handle(store, pin, 'setup', {});
    }

    case 'saveBoat': {
      can('setup');
      var bd = { boat_no: String(p.boat_no || '').trim(), team: String(p.team || '').trim(), class: String(p.class || '').trim(),
        owner_first: p.owner_first || '', owner_last: p.owner_last || '', owner_email: p.owner_email || '', owner_phone: p.owner_phone || '',
        active: p.active !== false };
      if (!bd.team) throw new Error('Team name is required.');
      var bid;
      if (p.id) { store.update('Boats', p.id, bd); bid = p.id; }
      else { bid = store.newId('B'); store.insert('Boats', Object.assign({ id: bid, token: makeToken(store) }, bd)); }
      log(store, who, 'boat.save', boatLabel(bd));
      if (!p.id) rematchWaiting(store);
      return handle(store, pin, 'setup', {});
    }

    case 'enterBoat': {
      can('setup');
      var exists = c.entries.some(function (e) { return e.event_id === p.event_id && e.boat_id === p.boat_id; });
      if (p.remove) {
        c.entries.filter(function (e) { return e.event_id === p.event_id && e.boat_id === p.boat_id; })
          .forEach(function (e) { store.remove('Entries', e.id); });
        log(store, who, 'entry.remove', boatLabel(c.boatById[p.boat_id]) + ' @ ' + (c.eventById[p.event_id] || {}).name);
      } else if (!exists) {
        store.insert('Entries', { id: store.newId('N'), event_id: p.event_id, boat_id: p.boat_id, entry_paid: !!p.entry_paid,
          tech: false, tech_by: '', tech_at: '', tech_notes: '', safety: false, safety_by: '', safety_at: '', safety_notes: '', notes: '' });
        log(store, who, 'entry.add', boatLabel(c.boatById[p.boat_id]) + ' @ ' + (c.eventById[p.event_id] || {}).name);
      }
      return handle(store, pin, 'setup', {});
    }

    case 'history': {
      can('inbox');
      var hq = norm(p.q);
      var rows = store.all('Log').filter(function (l) {
        return !hq || norm(l.who + ' ' + l.detail + ' ' + l.action).indexOf(hq) >= 0;
      });
      rows.sort(function (a, b) { return String(b.at).localeCompare(String(a.at)); });
      return rows.slice(0, 300).map(function (l) { return { at: l.at, who: l.who, action: l.action, detail: l.detail }; });
    }

    /* ----- boat registration and payments (public) ----- */
    case 'registerOptions': {
      var openEv = c.events.filter(function (e) { return truthy(e.signup_open); });
      var classes = {};
      c.boats.forEach(function (b) { if (b['class']) classes[b['class']] = 1; });
      (c.fees || []).forEach(function (f) { if (f.kind === 'entry' && f['class'] && f['class'] !== 'Bracket Class') classes[f['class']] = 1; });
      return {
        events: openEv.map(function (e) { return { id: e.id, name: e.name, start: isoDate(e.start), end: isoDate(e.end), location: e.location }; }),
        boats: c.boats.filter(function (b) { return b.active === '' || b.active == null || truthy(b.active); })
          .map(function (b) { return { id: b.id, label: boatLabel(b), boat_no: b.boat_no, team: b.team }; })
          .sort(function (a, b) { return a.label.localeCompare(b.label, undefined, { numeric: true }); }),
        classes: Object.keys(classes).sort(), owner_fields: OWNER_FIELDS, hull_fields: HULL_FIELDS, riding_roles: RIDING_ROLES
      };
    }

    case 'boatProfile': {
      var bp = c.boatById[p.boat_id];
      if (!bp) throw new Error('Boat not found.');
      return boatProfile(c, bp);
    }

    case 'registerBoat':
      return registerBoat(c, p, dept ? who : 'Boat registration form');

    case 'checkout':
      return startCheckout(c, p, dept ? who : 'public');

    case 'demoPay': {
      if (!store.isDemo) throw new Error('Not available.');
      return completePayment(store, p.payment_id, { who: 'Demo payment (no real charge)' });
    }

    /* ----- admin settings ----- */
    case 'adminGet': {
      can('admin');
      var rr = c.rules;
      return {
        settings: c.settings, roles: ROLES, reqs: REQS, rules: rr,
        fees: (c.fees || []).slice().sort(function (a, b) { return Number(a.sort) - Number(b.sort); }),
        aliases: store.all('Aliases').map(function (a) { return { key: a.key, typed: a.typed, boat_id: a.boat_id, boat: boatLabel(c.boatById[a.boat_id]), added_by: a.added_by, added_at: a.added_at }; }),
        defaults: DEFAULT_SETTINGS
      };
    }

    case 'adminSaveSettings': {
      can('admin');
      var changes = {};
      Object.keys(p.settings || {}).forEach(function (k) {
        if (!/^[a-z_]+$/.test(k)) return;
        var val = String(p.settings[k] == null ? '' : p.settings[k]).trim();
        if (/^pin_/.test(k) && val && !/^\d{4,10}$/.test(val)) throw new Error('PINs must be 4 to 10 digits.');
        if (String(c.settings[k] == null ? '' : c.settings[k]) !== val) changes[k] = val;
      });
      var pins = ['pin_admin', 'pin_office', 'pin_registration', 'pin_tech', 'pin_safety'].map(function (k) { return k in changes ? changes[k] : c.settings[k]; }).filter(Boolean);
      if (pins.length !== Object.keys(pins.reduce(function (o, x) { o[x] = 1; return o; }, {})).length) throw new Error('Each department needs a different PIN.');
      if ('pin_admin' in changes && !changes.pin_admin) throw new Error('The admin PIN can\u2019t be blank.');
      if (Object.keys(changes).length) {
        store.saveSettings(changes);
        log(store, who, 'admin.settings', 'Changed settings: ' + Object.keys(changes).map(function (k) { return /^pin_/.test(k) ? k + ' (new PIN)' : k + ' = ' + changes[k]; }).join(', '));
      }
      return { saved: Object.keys(changes).length };
    }

    case 'adminSaveRules': {
      can('admin');
      var nr = {};
      ROLES.forEach(function (role) {
        nr[role] = REQS.map(function (q) { return q.key; }).filter(function (k) { return p.rules && p.rules[role] && p.rules[role].indexOf(k) >= 0; });
      });
      store.saveRules(nr);
      log(store, who, 'admin.rules', 'Changed clearance rules: ' + ROLES.map(function (r) { return r + ' = ' + (nr[r].map(function (k) { return REQS.filter(function (q) { return q.key === k; })[0].label; }).join(', ') || 'nothing'); }).join('; '));
      return { saved: true };
    }

    case 'adminSaveFee': {
      can('admin');
      var fd = p.fee || {};
      var amount = String(fd.amount == null ? '' : fd.amount).replace(/[$,\s]/g, '');
      if (amount && !/^\d+(\.\d{1,2})?$/.test(amount)) throw new Error('Enter the amount as a number, like 2300 or 2300.00');
      if (!String(fd.name || '').trim()) throw new Error('Give the fee a name.');
      if (['entry', 'membership', 'extra'].indexOf(fd.kind) < 0) throw new Error('Pick a fee type.');
      var row2 = { kind: fd.kind, name: String(fd.name).trim(), 'class': String(fd['class'] || '').trim(), event_match: String(fd.event_match || '').trim(),
        amount: amount || '0', active: !!fd.active, sort: String(fd.sort || 99) };
      if (fd.remove && fd.id) { store.remove('Fees', fd.id); log(store, who, 'admin.fee', 'Removed fee ' + row2.name); return { saved: true }; }
      var exists = (c.fees || []).some(function (f) { return f.id === fd.id; });
      if (exists) store.update('Fees', fd.id, row2); else store.insert('Fees', Object.assign({ id: store.newId('F') }, row2));
      log(store, who, 'admin.fee', (exists ? 'Changed' : 'Added') + ' fee ' + row2.name + ': ' + money(row2.amount) + (row2.active ? '' : ' (off)'));
      return { saved: true };
    }

    case 'adminDeleteAlias': {
      can('admin');
      store.removeAlias(p.key, p.boat_id);
      log(store, who, 'admin.alias', 'Forgot spelling "' + p.typed + '" for ' + boatLabel(c.boatById[p.boat_id]));
      return { saved: true };
    }

    case 'import': {
      can('setup');
      if (!ev) throw new Error('Add an event and make it current before importing.');
      var res = importRows(store, ev.id, p.teams || [], p.members || [], who);
      res.event = ev.name;
      return res;
    }

    case 'teamToken': {
      can('setup');
      var b2 = c.boatById[p.boat_id];
      if (!b2) throw new Error('Boat not found.');
      var tok = b2.token;
      if (!tok || p.renew) { tok = makeToken(store); store.update('Boats', b2.id, { token: tok }); log(store, who, 'boat.token', boatLabel(b2)); }
      return { token: tok };
    }

    default:
      throw new Error('Unknown action: ' + action);
  }
}

/**
 * Find people by name the way staff actually type it: first name, last name, both
 * (either order), the start of a name, or a small typo ("Skylar" finds Skyler).
 */
function rankPeople(c, query) {
  var words = (String(query || '').toLowerCase().replace(/[’']/g, '').match(/[a-z0-9@.]+/g) || []).map(norm).filter(Boolean);
  if (!words.length) return [];
  var out = [];
  c.people.forEach(function (per) {
    var f = norm(per.first), l = norm(per.last), full = f + l, email = String(per.email || '').toLowerCase();
    var score = 0, ok = words.every(function (w) {
      if (f === w || l === w) { score += 10; return true; }
      if (f.indexOf(w) === 0 || l.indexOf(w) === 0) { score += 6; return true; }
      if (w.length >= 3 && (full.indexOf(w) >= 0 || (l + f).indexOf(w) >= 0)) { score += 4; return true; }
      if (w.length >= 4 && email.indexOf(w) === 0) { score += 4; return true; }
      if (w.length >= 4 && (closeness(w, f) >= 0.7 || closeness(w, l) >= 0.7)) { score += 2; return true; }
      return false;
    });
    if (ok) out.push({ person: per, score: score });
  });
  out.sort(function (a, b) { return b.score - a.score || fullName(a.person).localeCompare(fullName(b.person)); });
  return out;
}

/** What a team sees: every event the boat is in, what the boat needs, and each person's checklist with dates. No contact details. */
function teamView(c, boat) {
  var entries = c.entries.filter(function (e) { return e.boat_id === boat.id; }).map(function (e) {
    var st = entryStatus(c, e, true);
    st.event = c.eventById[e.event_id] || {};
    delete st.notes; delete st.tech_notes; delete st.safety_notes;
    st.crew.forEach(function (m) {
      var per = c.personById[m.person_id] || {};
      m.medical_exp = isoDate(per.medical_exp);
      m.dunker_exp = isoDate(per.dunker_exp);
      delete m.status.signed_by;
      delete m.status.sign_note;
      delete m.crew_id;
      m.rwo_paid = truthy(per.rwo_paid);
    });
    st.pay = paymentPanel(c, e);
    return st;
  }).sort(function (a, b) { return String(isoDate(a.event.start)).localeCompare(String(isoDate(b.event.start))); });
  return { boat: { boat_no: boat.boat_no, team: boat.team, 'class': boat['class'], label: boatLabel(boat) }, entries: entries, org: c.settings.org_name };
}

function deptForPin(settings, pin) {
  if (!pin) return null;
  var p = String(pin).trim();
  var hit = null;
  Object.keys(PERMS).forEach(function (d) { if (!hit && settings['pin_' + d] && String(settings['pin_' + d]).trim() === p) hit = d; });
  return hit;
}

function makeToken(store) {
  var a = 'abcdefghjkmnpqrstuvwxyz23456789', s = '';
  var rnd = store.random || Math.random;
  for (var i = 0; i < 12; i++) s += a.charAt(Math.floor(rnd() * a.length));
  return s;
}

function sortBoats(a, b) {
  return String(a.class).localeCompare(String(b.class)) ||
    String(a.boat_no).localeCompare(String(b.boat_no), undefined, { numeric: true });
}

function personSummary(c, per, ev) {
  var st = personStatus(c, per, ev);
  var boats = c.crew.filter(function (r) { return r.person_id === per.id; }).map(function (r) {
    var entered = ev ? c.entries.some(function (e) { return e.event_id === ev.id && e.boat_id === r.boat_id; }) : false;
    return { boat: boatLabel(c.boatById[r.boat_id]), role: r.role, at_event: entered,
      entry_id: ev ? (c.entries.filter(function (e) { return e.event_id === ev.id && e.boat_id === r.boat_id; })[0] || {}).id || '' : '' };
  });
  return { id: per.id, name: fullName(per), email: per.email || '', phone: per.phone || '', status: st, boats: boats,
    event_id: ev ? ev.id : '', event_name: ev ? ev.name : '' };
}

/**
 * Match a sign-up and link it whenever the evidence is clear. The person record is created right away,
 * so they can be found by name even before their boat has registered.
 */
function processSignup(c, su, who) {
  var store = c.store;
  var per = upsertPerson(c, su, who);
  if (!truthy(per.rwo_member) && su.note !== 'imported') {
    var mp = { rwo_member: true };
    mp.stamps = addStamps(store, per, mp, 'Sign-up form') || per.stamps;
    per = store.update('People', per.id, mp); c.personById[per.id] = per;
  }
  var done = function (ids, by, extra) {
    linkSignup(c, su, ids, by, false);
    store.update('Signups', su.id, Object.assign({ status: 'Linked', person_id: per.id, resolved_by: by, resolved_at: store.now(), suggestions: '' }, extra || {}));
    return { status: 'Linked', person_id: per.id, rwo_paid: truthy(per.rwo_paid), message: 'You’re on ' + ids.map(function (id) { return boatLabel(c.boatById[id]); }).join(' and ') + '.' };
  };
  var picked = listOf(su.picked_boat_ids);
  if (picked.length) return done(picked, 'picked from list');
  var m = matchSignup(c, su, aliasMap(store));
  if (m.linked.length) {
    var r = done(m.linked, 'auto-match', m.ignored.length ? { note: 'Also typed boat ' + m.ignored.join(', ') + ', which isn’t this team’s; ignored' } : null);
    return r;
  }
  // nothing clear: either their boat hasn't registered yet, or it's a genuine 50/50
  var waiting = !m.suggested.length;
  store.update('Signups', su.id, { status: waiting ? 'No match yet' : 'Needs review', suggestions: m.suggested.join(','), person_id: per.id });
  return { status: 'Received', person_id: per.id, rwo_paid: truthy(per.rwo_paid), message: waiting
    ? 'Got it. Your boat hasn’t registered yet. You’ll be added to it automatically as soon as it does.'
    : 'Got it. The RWO office will confirm your boat shortly.' };
}

/** Re-run matching for sign-ups still waiting (after a new boat or a remembered spelling). */
function rematchWaiting(store) {
  var linked = 0;
  store.all('Signups').forEach(function (s) {
    if (s.status !== 'Needs review' && s.status !== 'No match yet' && s.status !== 'New') return;
    var c = loadCtx(store);
    var r = processSignup(c, s, 'auto-match');
    if (r.status === 'Linked') linked++;
  });
  return linked;
}

/* ------------------------------------------------------------------ */
/* Import (from an Airtable CSV export or any spreadsheet)             */
/* ------------------------------------------------------------------ */

/**
 * teamsRows: objects with Airtable "Teams" headers (Boat #, Name, Category, Driver First, ...)
 * memberRows: objects with "Memberships" headers (Team Name, Boat #, First, Last, Role, Email, ...)
 * Every member goes through the same matcher; anything unsure lands in the Inbox.
 */
function importRows(store, eventId, teamsRows, memberRows, who) {
  who = who || 'import';
  var c = loadCtx(store);
  var made = { boats: 0, entries: 0, people: 0, linked: 0, review: 0 };
  var g = function (r, k) { return r[k] == null ? '' : String(r[k]).trim(); };
  (teamsRows || []).forEach(function (r) {
    var team = g(r, 'Name') || g(r, 'Team Name');
    if (!team) return;
    var no = g(r, 'Boat #');
    var b = c.boats.filter(function (x) { return norm(x.boat_no) === norm(no) && norm(x.team) === norm(team); })[0];
    if (!b) {
      b = store.insert('Boats', { id: store.newId('B'), boat_no: no, team: team, class: g(r, 'Category') || g(r, 'Class'),
        owner_first: g(r, 'Owner First'), owner_last: g(r, 'Owner Last'), owner_email: g(r, 'Email'), owner_phone: g(r, 'Cell#'),
        token: makeToken(store), active: true });
      c.boats.push(b); c.boatById[b.id] = b; made.boats++;
    }
    if (eventId && !c.entries.some(function (e) { return e.event_id === eventId && e.boat_id === b.id; })) {
      var en = store.insert('Entries', { id: store.newId('N'), event_id: eventId, boat_id: b.id, entry_paid: truthy(r['Reg/Pay']),
        tech: false, tech_by: '', tech_at: '', tech_notes: '', safety: false, safety_by: '', safety_at: '', safety_notes: '', notes: '' });
      c.entries.push(en); made.entries++;
    }
    // driver and throttleman named on the race entry become crew straight away
    [['Driver', 'Driver First', 'Driver Last'], ['Throttleman', 'Throttle First', 'Throttle Last']].forEach(function (t) {
      if (!g(r, t[1]) && !g(r, t[2])) return;
      var per = findPerson(c, { first: g(r, t[1]), last: g(r, t[2]) });
      if (per) upsertCrew(c, per.id, b.id, t[0], '', who);
    });
  });
  var aliases = aliasMap(store);
  (memberRows || []).forEach(function (r) {
    var first = g(r, 'First'), last = g(r, 'Last');
    if (!first && !last) return;
    var roles = g(r, 'Role').split(',').map(function (x) { return x.trim(); });
    if (roles.indexOf('Team') >= 0) return; // Airtable "Team" placeholder rows
    var role = mapRole(roles);
    var before = c.people.length;
    var per = upsertPerson(c, {
      first: first, last: last, email: g(r, 'Email'), phone: g(r, 'Cell'),
      rwo_member: truthy(r['RWO Member']), rwo_paid: truthy(r['RWO Paid']), apba_member: truthy(r['APBA Member']),
      apba_paid: truthy(r['APBA Paid']), apba_no: g(r, 'APBA #'), medical_exp: g(r, 'Med Exp'), dunker_exp: g(r, 'Dunk Exp')
    }, who);
    if (c.people.length > before) made.people++;
    var su = { first: first, last: last, email: g(r, 'Email'), phone: g(r, 'Cell'), typed_team: g(r, 'Team Name'),
      typed_boat: g(r, 'Boat #'), role: role, event_ids: '' };
    var m = matchSignup(c, su, aliases);
    if (m.linked.length) {
      m.linked.forEach(function (bid) { upsertCrew(c, per.id, bid, role, '', who); });
      made.linked++;
    } else {
      store.insert('Signups', Object.assign({ id: store.newId('S'), created: store.now(), picked_boat_ids: '',
        status: m.suggested.length ? 'Needs review' : 'No match yet', suggestions: m.suggested.join(','),
        person_id: per.id, resolved_by: '', resolved_at: '', note: 'imported' }, su));
      made.review++;
    }
  });
  log(store, who, 'import', made);
  return made;
}

function mapRole(roles) {
  var r = roles.map(function (x) { return x.toLowerCase(); });
  if (r.indexOf('driver') >= 0) return 'Driver';
  if (r.indexOf('throttleman') >= 0) return 'Throttleman';
  if (r.indexOf('navigator') >= 0) return 'Navigator';
  if (r.indexOf('alt d') >= 0) return 'Alt Driver';
  if (r.indexOf('alt t') >= 0) return 'Alt Throttle';
  if (r.indexOf('owner') >= 0) return 'Owner';
  if (r.indexOf('team family') >= 0) return 'Team Family';
  if (r.indexOf('team sponsor') >= 0) return 'Team Sponsor';
  if (r.indexOf('other') >= 0) return 'Other';
  return 'Crew';
}

/* ------------------------------------------------------------------ */
/* Boat registration and payments                                      */
/* ------------------------------------------------------------------ */

var OWNER_FIELDS = [
  ['owner_first', 'Owner first name', 1], ['owner_last', 'Owner last name', 1], ['owner_email', 'Owner email', 1], ['owner_phone', 'Owner cell phone', 1],
  ['address', 'Street address'], ['city', 'City'], ['state', 'State'], ['zip', 'ZIP'], ['country', 'Country']
];
var HULL_FIELDS = [
  ['boat_title', 'Boat name on title'], ['origin_port', 'Home port'], ['cat_or_vee', 'Cat or Vee'],
  ['hull_mfg', 'Hull manufacturer'], ['hull_year', 'Hull year'], ['hull_id', 'Hull ID (HIN)'], ['hull_color', 'Hull color'],
  ['length', 'Length'], ['beam', 'Beam'], ['weight', 'Weight'], ['rigged_by', 'Rigged by'],
  ['engine_mfg', 'Engine manufacturer'], ['num_engines', 'Number of engines'], ['hp_each', 'Horsepower each'],
  ['outdrive_mfg', 'Outdrive manufacturer'], ['drive_model', 'Drive model'], ['modifications', 'Modifications']
];
var RIDING_ROLES = ['Driver', 'Throttleman', 'Navigator'];

/* Starting fees, from raceworldoffshore.com. The office edits them in the fees table. */
var DEFAULT_FEES = (function () {
  var rows = [{ id: 'F-member', kind: 'membership', name: 'RWO membership (season)', 'class': '', event_match: '', amount: '200', active: true, sort: 1 }];
  [['Super Cat', 2300, 5000], ['Class 1', 2300, 7000], ['Class 2', 2300, 5000], ['Super Stock', 1300, 3200], ['Super Vee', 2300, 5000],
   ['Modified Vee', 1100, 3000], ['Bracket Class', 400, 900], ['Cat 300', 400, 900], ['Vee Limited', 400, 900]].forEach(function (f, i) {
    var k = f[0].replace(/\W+/g, '');
    rows.push({ id: 'F-' + k, kind: 'entry', name: f[0] + ' race entry', 'class': f[0], event_match: '', amount: String(f[1]), active: true, sort: 10 + i });
    rows.push({ id: 'F-' + k + '-KW', kind: 'entry', name: f[0] + ' race entry (Key West, 3 races)', 'class': f[0], event_match: 'Key West', amount: String(f[2]), active: true, sort: 30 + i });
  });
  [['F-rv', 'RV / equipment footprint'], ['F-duval', 'Duval Street boat entry'], ['F-build', 'Boat build contest']].forEach(function (x, i) {
    rows.push({ id: x[0], kind: 'extra', name: x[1], 'class': '', event_match: 'Key West', amount: '0', active: false, sort: 60 + i });
  });
  return rows;
})();

function readJson(s, dflt) { try { var o = JSON.parse(s || ''); return o == null ? dflt : o; } catch (e) { return dflt; } }
function money(n) { var v = Number(n) || 0; return '$' + v.toLocaleString('en-US', { minimumFractionDigits: v % 1 ? 2 : 0, maximumFractionDigits: 2 }); }
function feeApplies(f, ev) { return !f.event_match || (ev && norm(ev.name).indexOf(norm(f.event_match)) >= 0); }
function liveFee(f) { return truthy(f.active) && Number(f.amount) > 0; }

/** The entry fee for a class at an event: event-specific beats general; exact class beats a class prefix. */
function entryFee(c, cls, ev) {
  var k = norm(cls);
  var list = (c.fees || []).filter(function (f) {
    return f.kind === 'entry' && liveFee(f) && feeApplies(f, ev) && k && (norm(f['class']) === k || k.indexOf(norm(f['class'])) === 0);
  });
  list.sort(function (a, b) {
    return (b.event_match ? 1 : 0) - (a.event_match ? 1 : 0) || (norm(b['class']) === k) - (norm(a['class']) === k) || norm(b['class']).length - norm(a['class']).length;
  });
  return list[0] || null;
}
function membershipFee(c) {
  return (c.fees || []).filter(function (f) { return f.kind === 'membership' && liveFee(f); }).sort(function (a, b) { return Number(a.sort) - Number(b.sort); })[0] || null;
}
function extrasFor(c, ev) {
  return (c.fees || []).filter(function (f) { return f.kind === 'extra' && liveFee(f) && feeApplies(f, ev); })
    .sort(function (a, b) { return Number(a.sort) - Number(b.sort); });
}

/** Payment info shown on a team's page for one event. */
function paymentPanel(c, entry) {
  var ev = c.eventById[entry.event_id], boat = c.boatById[entry.boat_id] || {};
  var fee = entryFee(c, boat['class'], ev);
  var paidExtras = [];
  (c.payments || []).forEach(function (pm) {
    if (pm.kind === 'extras' && pm.status === 'paid' && pm.event_id === entry.event_id && pm.boat_id === entry.boat_id) {
      readJson(pm.items, []).forEach(function (it) { paidExtras.push({ name: it.name, qty: it.qty, amount: it.amount, paid_at: pm.paid_at }); });
    }
  });
  var mf = membershipFee(c);
  return {
    entry_fee: fee ? { name: fee.name, amount: Number(fee.amount) } : null,
    entry_paid: truthy(entry.entry_paid),
    membership_fee: mf ? Number(mf.amount) : 0,
    extras: extrasFor(c, ev).map(function (f) { return { id: f.id, name: f.name, amount: Number(f.amount) }; }),
    extras_paid: paidExtras
  };
}

/** Builds a pending payment from fees on the server (prices never come from the browser). */
function startCheckout(c, p, who) {
  var store = c.store, items = [], kind = p.kind, ev = null, boat = null, personIds = [];
  if (kind === 'entry' || kind === 'extras') {
    var en = c.entryById[p.entry_id];
    if (!en) throw new Error('That race entry wasn’t found.');
    ev = c.eventById[en.event_id]; boat = c.boatById[en.boat_id];
    if (kind === 'entry') {
      if (truthy(en.entry_paid)) throw new Error('The entry fee for ' + boatLabel(boat) + ' at ' + ev.name + ' is already paid.');
      var fee = entryFee(c, boat['class'], ev);
      if (!fee) throw new Error('There’s no entry fee set for ' + (boat['class'] || 'this class') + ' at ' + ev.name + '. Contact the RWO office.');
      items.push({ fee_id: fee.id, name: fee.name + ': ' + boatLabel(boat) + ', ' + ev.name, qty: 1, amount: Number(fee.amount) });
    } else {
      var avail = extrasFor(c, ev);
      (p.items || []).forEach(function (it) {
        var f = avail.filter(function (x) { return x.id === it.fee_id; })[0];
        var q = Math.floor(Number(it.qty) || 0);
        if (f && q > 0) items.push({ fee_id: f.id, name: f.name + ': ' + boatLabel(boat) + ', ' + ev.name, qty: Math.min(q, 20), amount: Number(f.amount) });
      });
      if (!items.length) throw new Error('Choose at least one extra.');
    }
  } else if (kind === 'membership') {
    var mf = membershipFee(c);
    if (!mf) throw new Error('Membership payments aren’t set up yet. Contact the RWO office.');
    (p.person_ids || []).forEach(function (id) {
      var per = c.personById[id];
      if (per && !truthy(per.rwo_paid) && personIds.indexOf(id) < 0) {
        personIds.push(id);
        items.push({ fee_id: mf.id, name: mf.name + ': ' + fullName(per), qty: 1, amount: Number(mf.amount), person_id: id });
      }
    });
    if (!items.length) throw new Error('Everyone you picked has already paid their RWO membership.');
    if (p.boat_id && c.boatById[p.boat_id]) boat = c.boatById[p.boat_id];
  } else throw new Error('Unknown payment type.');

  var total = items.reduce(function (s, it) { return s + it.amount * it.qty; }, 0);
  var pay = store.insert('Payments', {
    id: store.newId('Y'), created: store.now(), kind: kind, event_id: ev ? ev.id : '', boat_id: boat ? boat.id : '',
    person_ids: personIds.join(','), items: JSON.stringify(items), total: String(total), status: 'pending',
    session_id: '', intent_id: '', paid_at: '', payer_name: String(p.payer_name || '').trim(), payer_email: String(p.payer_email || '').trim(), note: ''
  });
  log(store, who, 'payment.start', 'Checkout started: ' + money(total) + ' for ' + items.map(function (i) { return i.name + (i.qty > 1 ? ' x' + i.qty : ''); }).join('; '), pay.id);
  return {
    payment_id: pay.id, total: total, items: items,
    checkout: { items: items, email: pay.payer_email, return_url: String(p.return_url || '') }
  };
}

/** Called when Stripe confirms payment (or the demo simulates it). Safe to call twice. */
function completePayment(store, paymentId, info) {
  var c = loadCtx(store);
  var pay = (c.payments || []).filter(function (x) { return x.id === paymentId; })[0];
  if (!pay) throw new Error('Payment ' + paymentId + ' not found.');
  if (pay.status === 'paid') return { already: true };
  var who = info && info.who || 'Stripe payment';
  store.update('Payments', pay.id, { status: 'paid', paid_at: store.now(), session_id: info && info.session_id || pay.session_id,
    intent_id: info && info.intent_id || pay.intent_id, payer_email: pay.payer_email || (info && info.email) || '' });
  var items = readJson(pay.items, []);
  if (pay.kind === 'entry') {
    c.entries.filter(function (e) { return e.event_id === pay.event_id && e.boat_id === pay.boat_id; }).forEach(function (e) {
      var patch = { entry_paid: true };
      patch.stamps = addStamps(store, e, patch, who) || e.stamps;
      store.update('Entries', e.id, patch);
    });
  } else if (pay.kind === 'membership') {
    listOf(pay.person_ids).forEach(function (id) {
      var per = c.personById[id];
      if (!per) return;
      var patch = { rwo_paid: true, rwo_member: true };
      patch.stamps = addStamps(store, per, patch, who) || per.stamps;
      store.update('People', id, patch);
    });
  }
  log(store, who, 'payment.paid', 'Paid ' + money(pay.total) + ': ' + items.map(function (i) { return i.name + (i.qty > 1 ? ' x' + i.qty : ''); }).join('; ') +
    (info && info.email ? ' (' + info.email + ')' : ''), pay.id);
  return { paid: true };
}

function cancelPayment(store, paymentId, why) {
  var pay = store.all('Payments').filter(function (x) { return x.id === paymentId; })[0];
  if (pay && pay.status === 'pending') store.update('Payments', pay.id, { status: why || 'expired' });
}

/** What a returning owner sees about their boat (no contact details). */
function boatProfile(c, boat) {
  var d = readJson(boat.details, {});
  var hull = {};
  HULL_FIELDS.forEach(function (f) { hull[f[0]] = d[f[0]] || ''; });
  var riders = {};
  c.crew.filter(function (r) { return r.boat_id === boat.id && RIDING_ROLES.indexOf(r.role) >= 0; }).forEach(function (r) {
    var per = c.personById[r.person_id];
    if (per && !riders[r.role]) riders[r.role] = fullName(per);
  });
  return { id: boat.id, label: boatLabel(boat), boat_no: boat.boat_no, team: boat.team, 'class': boat['class'], hull: hull, riders: riders,
    entered: c.entries.filter(function (e) { return e.boat_id === boat.id; }).map(function (e) { return e.event_id; }) };
}

/**
 * Boat registration. New boats send everything. Returning boats send only what changed:
 * riding crew (if crew_changed) and hull/boat info (if hull_changed). The rest carries over.
 */
function registerBoat(c, p, who) {
  var store = c.store;
  var open = c.events.filter(function (e) { return truthy(e.signup_open); }).map(function (e) { return e.id; });
  var evIds = (p.event_ids || []).filter(function (id) { return open.indexOf(id) >= 0; });
  if (!evIds.length) throw new Error('Pick the race you’re registering for.');
  var b = p.boat || {}, boat;
  var clean = function (v) { return String(v == null ? '' : v).trim(); };
  if (p.returning) {
    boat = c.boatById[p.boat_id];
    if (!boat) throw new Error('Pick your boat from the list, or answer “No” to register it as new.');
  } else {
    if (!clean(b.boat_no) || !clean(b.team) || !clean(b['class'])) throw new Error('Boat number, team name and class are required.');
    OWNER_FIELDS.forEach(function (f) { if (f[2] && !clean(b[f[0]])) throw new Error(f[1] + ' is required.'); });
    if (!/^\S+@\S+\.\S+$/.test(clean(b.owner_email))) throw new Error('Enter a valid owner email.');
    boat = c.boats.filter(function (x) { return norm(x.boat_no) === norm(b.boat_no) && norm(x.team) === norm(b.team); })[0];
  }
  var details = readJson(boat && boat.details, {});
  var patch = {};
  if (!p.returning) {
    OWNER_FIELDS.forEach(function (f) { if (f[0].indexOf('owner_') === 0) patch[f[0]] = clean(b[f[0]]); else details[f[0]] = clean(b[f[0]]); });
    patch.boat_no = clean(b.boat_no); patch.team = clean(b.team);
  }
  if (!p.returning || p.hull_changed) {
    if (p.returning && clean(b['class'])) patch['class'] = clean(b['class']);
    if (!p.returning) patch['class'] = clean(b['class']);
    HULL_FIELDS.forEach(function (f) { details[f[0]] = clean(b[f[0]]); });
  }
  patch.details = JSON.stringify(details);
  patch.registered_at = store.now();
  if (boat) {
    boat = store.update('Boats', boat.id, patch);
  } else {
    boat = store.insert('Boats', Object.assign({ id: store.newId('B'), token: makeToken(store), active: true }, patch));
    c.boats.push(boat);
  }
  c.boatById[boat.id] = boat;

  // entries for the chosen races
  var entered = [];
  evIds.forEach(function (eid) {
    var en = c.entries.filter(function (e) { return e.event_id === eid && e.boat_id === boat.id; })[0];
    if (!en) {
      en = store.insert('Entries', { id: store.newId('N'), event_id: eid, boat_id: boat.id, entry_paid: false, tech: false, tech_by: '', tech_at: '',
        tech_notes: '', safety: false, safety_by: '', safety_at: '', safety_notes: '', notes: '', stamps: '' });
      c.entries.push(en); c.entryById[en.id] = en;
    }
    entered.push(en);
  });

  // riding crew
  var crewMsg = '';
  if (!p.returning || p.crew_changed) {
    var riders = p.crew || {};
    if (!riders.Driver || !clean(riders.Driver.first) || !clean(riders.Driver.last)) throw new Error('Enter the driver’s name.');
    var newIds = {};
    RIDING_ROLES.forEach(function (role) {
      var r = riders[role];
      if (!r || !clean(r.first) || !clean(r.last)) return;
      var per = upsertPerson(c, { first: clean(r.first), last: clean(r.last), email: clean(r.email), phone: clean(r.phone) }, who);
      var row = c.crew.filter(function (x) { return x.person_id === per.id && x.boat_id === boat.id; })[0];
      if (row && row.role !== role) { row = store.update('Crew', row.id, { role: role }); c.crew = c.crew.map(function (x) { return x.id === row.id ? row : x; }); }
      else upsertCrew(c, per.id, boat.id, role, '', who);
      newIds[per.id] = 1;
    });
    // anyone who used to ride but isn't listed now stops counting for these races (kept for earlier ones)
    c.crew.filter(function (x) { return x.boat_id === boat.id && RIDING_ROLES.indexOf(x.role) >= 0 && !newIds[x.person_id]; }).forEach(function (x) {
      var others = c.entries.filter(function (e) { return e.boat_id === boat.id && evIds.indexOf(e.event_id) < 0; }).map(function (e) { return e.event_id; });
      var keep = listOf(x.event_ids).length ? listOf(x.event_ids).filter(function (id) { return evIds.indexOf(id) < 0; }) : others;
      if (keep.length) store.update('Crew', x.id, { event_ids: keep.join(',') });
      else store.remove('Crew', x.id);
      crewMsg = ' Riding crew updated.';
    });
  }
  log(store, who, 'boat.register', (p.returning ? 'Re-registered ' : 'Registered ') + boatLabel(boat) + ' for ' +
    evIds.map(function (id) { return (c.eventById[id] || {}).name; }).join(', ') +
    (p.returning ? ' (crew changed: ' + (p.crew_changed ? 'yes' : 'no') + ', hull changed: ' + (p.hull_changed ? 'yes' : 'no') + ')' : ''), boat.id);
  if (!p.returning) rematchWaiting(store);
  var c2 = loadCtx(store);
  return {
    boat_id: boat.id, token: boat.token, label: boatLabel(boat), message: 'Registered ' + boatLabel(boat) + '.' + crewMsg,
    entries: entered.map(function (en) {
      var e2 = c2.entryById[en.id];
      return { entry_id: en.id, event: (c2.eventById[en.event_id] || {}).name, pay: paymentPanel(c2, e2) };
    })
  };
}

/* Node / browser export */
if (typeof module !== 'undefined') {
  module.exports = { SCHEMA: SCHEMA, BOOL_COLS: BOOL_COLS, DATE_COLS: DATE_COLS, ROLES: ROLES, REQS: REQS, PERMS: PERMS,
    DEFAULT_SETTINGS: DEFAULT_SETTINGS, defaultRules: defaultRules, handle: handle, importRows: importRows,
    loadCtx: loadCtx, entryStatus: entryStatus, personStatus: personStatus, matchSignup: matchSignup, aliasMap: aliasMap,
    norm: norm, isoDate: isoDate, truthy: truthy };
}
