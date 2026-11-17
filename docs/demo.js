/* Demo mode: runs the real logic in the browser with made-up teams and people. Nothing is saved. */
(function () {
  // repeatable made-up data, so demo links (like a team link) work in a new tab
  var seed = 20261117;
  var rng = function () { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
  var store = new MemoryStore({ rng: rng, demo: true });
  // fees from the website; the Key West extras get example prices in the demo only
  DEFAULT_FEES.forEach(function (f) {
    var row = Object.assign({}, f);
    if (row.kind === 'extra') { row.active = true; row.amount = { 'F-rv': '500', 'F-duval': '250', 'F-build': '100' }[row.id]; row.name += ' (example price)'; }
    store.insert('Fees', row);
  });
  var OFF = '1111';
  var api = function (a, p) { return handle(store, OFF, a, Object.assign({ who: 'RWO Office' }, p || {})); };
  var day = function (offset) { var d = new Date(); d.setDate(d.getDate() + offset); return isoDate(d); };

  if (window.DEMO_DATA) realDemo(window.DEMO_DATA);
  else fictionalDemo();

  /* Real teams and names (private demo only). Every status below is random. */
  function realDemo(D) {
    var pick = function (p) { return rng() < p; };
    api('saveEvent', { name: 'Key West World Championships', location: 'Key West, FL', start: day(-1), end: day(4), signup_open: true });
    api('saveEvent', { name: 'Atlantic City', location: 'Atlantic City, NJ', start: '2027-06-24', end: '2027-06-26', signup_open: false });
    api('saveEvent', { name: 'Michigan City', location: 'Michigan City, IN', start: '2027-08-05', end: '2027-08-07', signup_open: false });
    api('saveEvent', { name: 'Clearwater', location: 'Clearwater, FL', start: '2027-09-23', end: '2027-09-25', signup_open: false });
    var ev = store.all('Events')[0].id;
    var tRows = D.teams.map(function (t) {
      return { 'Boat #': t[0], Name: t[1], Category: t[2], 'Driver First': t[3], 'Driver Last': t[4], 'Throttle First': t[5], 'Throttle Last': t[6],
        'Reg/Pay': pick(0.93) ? 'checked' : '' };
    });
    var fakeEmail = function (f, l) { return (f + '.' + l).toLowerCase().replace(/[^a-z.]/g, '') + '@example.com'; };
    var dateMix = function () { var r = rng(); return r < 0.82 ? day(120 + Math.floor(rng() * 300)) : r < 0.9 ? day(1) : ''; };
    var mRows = D.crew.map(function (c) {
      return { 'Team Name': c[0], 'Boat #': c[1], First: c[2], Last: c[3], Role: c[4], Email: fakeEmail(c[2], c[3]),
        'RWO Member': pick(0.96) ? 'checked' : '', 'RWO Paid': pick(0.88) ? 'checked' : '',
        'APBA Member': pick(0.9) ? 'checked' : '', 'APBA Paid': pick(0.82) ? 'checked' : '',
        'Med Exp': dateMix(), 'Dunk Exp': dateMix() };
    });
    importRows(store, ev, tRows, mRows, 'demo setup');
    var c = loadCtx(store);
    c.entries.forEach(function (e) {
      var t = pick(0.72), sf = pick(0.66);
      store.update('Entries', e.id, { tech: t, tech_by: t ? 'Tech (demo)' : '', tech_at: t ? store.now() : '',
        safety: sf, safety_by: sf ? 'Safety (demo)' : '', safety_at: sf ? store.now() : '' });
    });
    c = loadCtx(store);
    var evRow = c.eventById[ev];
    c.people.forEach(function (p) {
      if (personStatus(c, p, evRow).state === 'ready' && pick(0.75)) {
        store.insert('Signatures', { id: store.newId('G'), person_id: p.id, event_id: ev, signed_at: store.now(), signed_by: 'Registration (demo)' });
      }
    });
    // the sign-ups typed after the 2026 list was cleaned, exactly as people typed them
    D.signups.forEach(function (s) {
      try {
        handle(store, null, 'submitSignup', { first: s[2], last: s[3], email: fakeEmail(s[2], s[3]), typed_team: s[0], typed_boat: s[1],
          role: mapRole(String(s[4] || '').split(',')), event_ids: [ev] });
      } catch (e) { /* skip incomplete rows */ }
    });
    window.DEMO_LABEL = D.label;
  }

  function fictionalDemo() {
  api('saveEvent', { name: 'Gulf Coast Grand Prix', location: 'Gulfport, FL', start: day(0), end: day(2), signup_open: true });
  api('saveEvent', { name: 'Harbor Shootout', location: 'Lake Harbor, MI', start: day(60), end: day(62), signup_open: true });
  var ev = store.all('Events')[0].id;

  var teams = [
    ['S-14', 'Blue Heron Racing', 'Super Stock', 'Dana', 'Whitlock', 'Marco', 'Reyes'],
    ['S-31', 'Tidewater Tile', 'Super Stock', 'Owen', 'Pratt', 'Gil', 'Ferraro'],
    ['S-9', 'Night Shift Offshore', 'Super Stock', 'Lena', 'Okafor', 'Ray', 'Lindqvist'],
    ['22', 'Coral Coast Marine', 'Class 2', 'Victor', 'Haines', 'Tess', 'Monroe'],
    ['08', 'Rip Current', 'Class 1', 'Jonah', 'Delacroix', 'Sam', 'Pike'],
    ['8', 'Pelican Point', 'Super Cat', 'Ruth', 'Carrow', 'Elias', 'Grant'],
    ['47', 'Low Tide Motorsports', 'Modified Vee', 'Hank', 'Mercer', 'Abby', 'Lund'],
    ['C-12', 'Shark Bait', 'Cat 300', 'Iris', 'Vance', 'Theo', 'Malik'],
    ['VL5', 'Second Wind', 'Vee Limited', 'Paul', 'Beckett', 'Nina', 'Hollis'],
    ['212', 'Saltwater Cowboys', 'Bracket Class 200', 'Cody', 'Rourke', 'Wes', 'Tanner'],
    ['418', 'Full Send Racing', 'Bracket Class 400', 'Maya', 'Steele', 'Jon', 'Albright'],
    ['533', 'Reef Runner', 'Bracket Class 500', 'Grace', 'Ito', 'Ben', 'Okoro'],
    ['707', 'Dockside Grill', 'Bracket Class 700', 'Frank', 'Duval', 'Lou', 'Barker'],
    ['66', 'Mangrove Express', 'Class 2', 'Rita', 'Kovac', 'Dom', 'Ellison']
  ];
  var crewFirst = ['Alex', 'Jamie', 'Chris', 'Pat', 'Morgan', 'Casey', 'Riley', 'Drew', 'Quinn', 'Jordan', 'Taylor', 'Reese', 'Skyler', 'Avery'];
  var crewLast = ['Brooks', 'Nolan', 'Ortega', 'Fisher', 'Lang', 'Shaw', 'Kemp', 'Price', 'Wolfe', 'Burke', 'Hale', 'Sutton', 'Yates', 'Moss'];

  var tRows = teams.map(function (t) {
    return { 'Boat #': t[0], Name: t[1], Category: t[2], 'Owner First': t[3], 'Owner Last': t[4], Email: t[4].toLowerCase() + '@example.com', 'Reg/Pay': t[0] !== '47' ? 'checked' : '' };
  });
  var mRows = [];
  teams.forEach(function (t, i) {
    var full = { 'RWO Member': 'checked', 'RWO Paid': 'checked', 'APBA Member': 'checked', 'APBA Paid': 'checked', 'Med Exp': day(300), 'Dunk Exp': day(200) };
    var drv = Object.assign({ 'Team Name': t[1], 'Boat #': t[0], First: t[3], Last: t[4], Role: 'Driver', Email: t[3].toLowerCase() + '.' + t[4].toLowerCase() + '@example.com' }, full);
    var thr = Object.assign({ 'Team Name': t[1], 'Boat #': t[0], First: t[5], Last: t[6], Role: 'Throttleman', Email: t[5].toLowerCase() + '.' + t[6].toLowerCase() + '@example.com' }, full);
    if (i === 3) thr['Med Exp'] = day(1);          // medical runs out mid-event
    if (i === 6) drv['APBA Paid'] = '';            // driver hasn't paid APBA
    if (i === 9) thr['Dunk Exp'] = '';             // no dunker on file
    mRows.push(drv, thr);
    for (var k = 0; k < 3; k++) {
      var f = crewFirst[(i * 3 + k) % crewFirst.length], l = crewLast[(i * 5 + k) % crewLast.length];
      mRows.push({ 'Team Name': t[1], 'Boat #': t[0], First: f, Last: l + (i ? '' : ''), Role: 'Crew', Email: (f + '.' + l + i + k).toLowerCase() + '@example.com',
        'RWO Member': 'checked', 'RWO Paid': (i + k) % 4 ? 'checked' : '', 'APBA Member': (i + k) % 5 ? 'checked' : '', 'APBA Paid': (i + k) % 5 ? 'checked' : '' });
    }
  });
  importRows(store, ev, tRows, mRows, 'demo setup');

  // most boats are partway through the day
  var c = loadCtx(store);
  c.entries.forEach(function (e, i) {
    store.update('Entries', e.id, { tech: i % 4 !== 1, tech_by: i % 4 !== 1 ? 'Tech (demo)' : '', tech_at: i % 4 !== 1 ? store.now() : '',
      safety: i % 3 !== 2, safety_by: i % 3 !== 2 ? 'Safety (demo)' : '', safety_at: i % 3 !== 2 ? store.now() : '' });
  });
  // sign in everyone who's ready on the first nine boats
  c = loadCtx(store);
  var evRow = c.eventById[ev];
  c.entries.slice(0, 9).forEach(function (e) {
    c.crew.filter(function (r) { return r.boat_id === e.boat_id; }).forEach(function (r) {
      var p = c.personById[r.person_id];
      if (personStatus(c, p, evRow).state === 'ready') store.insert('Signatures', { id: store.newId('G'), person_id: p.id, event_id: ev, signed_at: store.now(), signed_by: 'Registration (demo)' });
    });
  });

  // sign-ups the way people really type them
  [['Kyle', 'Dunn', 'blue heron', 'S14'], ['Mia', 'Castro', 'Night shift', '9'], ['Zane', 'Price', 'coral coast', '22'],
   ['Lucy', 'Hart', 'Rip Curent', '8'], ['Ned', 'Ross', 'Mangrove', '66 / 22'], ['Ivy', 'Lowe', 'Island Time', '19']].forEach(function (s) {
    handle(store, null, 'submitSignup', { first: s[0], last: s[1], email: (s[0] + '.' + s[1]).toLowerCase() + '@example.com', typed_team: s[2], typed_boat: s[3], role: 'Crew', event_ids: [ev] });
  });

  }

  window.DEMO_API = function (pin, action, payload) { return JSON.parse(JSON.stringify(handle(store, pin, action, payload))); };
})();
