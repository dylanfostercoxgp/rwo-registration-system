/* In-memory store with the same interface as the Google Sheets store.
   Used by the test suite and by the clickable demo. */
function MemoryStore(seed) {
  var self = this;
  var t = {};
  Object.keys(SCHEMA).forEach(function (k) { t[k] = []; });
  var settings = Object.assign({}, DEFAULT_SETTINGS);
  var rules = defaultRules();
  var n = 0;
  var rng = (seed && seed.rng) || Math.random;
  this.random = rng;
  if (seed) {
    Object.keys(seed.tables || {}).forEach(function (k) { t[k] = seed.tables[k].map(function (r) { return Object.assign({}, r); }); });
    Object.assign(settings, seed.settings || {});
    if (seed.rules) rules = seed.rules;
  }
  this.all = function (table) { return t[table].slice(); };
  this.insert = function (table, obj) {
    var row = {};
    SCHEMA[table].forEach(function (col) { row[col] = obj[col] == null ? '' : obj[col]; });
    t[table].push(row);
    return row;
  };
  this.update = function (table, id, patch) {
    var key = table === 'Aliases' ? 'key' : 'id';
    for (var i = 0; i < t[table].length; i++) {
      if (t[table][i][key] === id) {
        var row = Object.assign({}, t[table][i]);
        Object.keys(patch).forEach(function (k) { if (SCHEMA[table].indexOf(k) >= 0) row[k] = patch[k]; });
        t[table][i] = row;
        return row;
      }
    }
    throw new Error('Not found: ' + table + ' ' + id);
  };
  this.remove = function (table, id) { t[table] = t[table].filter(function (r) { return r.id !== id; }); };
  this.settings = function () { return Object.assign({}, settings); };
  this.rules = function () { return JSON.parse(JSON.stringify(rules)); };
  this.setSetting = function (k, v) { settings[k] = v; };
  this.saveSettings = function (map) { Object.keys(map).forEach(function (k) { settings[k] = map[k]; }); };
  this.saveRules = function (r) { rules = JSON.parse(JSON.stringify(r)); };
  this.removeAlias = function (key, boatId) { t.Aliases = t.Aliases.filter(function (a) { return !(a.key === key && a.boat_id === boatId); }); };
  if (seed && seed.demo) this.isDemo = true;
  this.newId = function (prefix) { n++; return prefix + ('00000' + n).slice(-5) + rng().toString(36).slice(2, 5); };
  this.now = function () { return new Date().toISOString().replace('T', ' ').slice(0, 16); };
  this.dump = function () { return { tables: t, settings: settings, rules: rules }; };
}
if (typeof module !== 'undefined') module.exports = MemoryStore;
