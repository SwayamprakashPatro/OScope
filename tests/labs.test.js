// Lab registry and search tests. Loads every lab description file the same way the browser does.
const fs = require('fs');
const path = require('path');
const L = require('../js/core/labs.js');
fs.readdirSync(path.join(__dirname, '../js/labs')).sort().forEach((f) => require('../js/labs/' + f));
let pass = 0, fail = 0;
const eq = (n, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); ok ? pass++ : fail++; console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok ? '' : ' got=' + JSON.stringify(got) + ' want=' + JSON.stringify(want))); };
const top = (q, o) => (L.search(q, o)[0] || {}).lab;
const topId = (q, o) => (top(q, o) || {}).id;

// ---- registry integrity
const LAB_COUNT = L.LABS.length; // grows with each tier, so assert a floor and the known ids rather than a fixed number
eq('at least the first nine labs are registered', LAB_COUNT >= 9, true);
eq('ids are unique', new Set(L.LABS.map((l) => l.id)).size, L.LABS.length);
eq('every lab passes validate()', L.LABS.map((l) => L.validate(l)).filter((b) => b.length), []);
eq('every area has at least one lab', L.AREAS.filter((a) => !L.LABS.some((l) => l.area === a.id)).map((a) => a.id), []);
eq('lab files match their ids', fs.readdirSync(path.join(__dirname, '../js/labs')).sort(), L.LABS.map((l) => l.id + '.js').sort());
// every view key must have a view file loaded by index.html
const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
eq('index.html loads every lab file', L.LABS.filter((l) => !html.includes('js/labs/' + l.id + '.js')).map((l) => l.id), []);
// validate() really catches problems
eq('validate: empty lab', L.validate({}).length > 0, true);
eq('validate: unknown area', L.validate(Object.assign({}, L.LABS[0], { area: 'nope' })).some((m) => /area/.test(m)), true);
eq('validate: bad level', L.validate(Object.assign({}, L.LABS[0], { level: 'hard' })).some((m) => /level/.test(m)), true);
eq('validate: duplicate id', L.validate(L.LABS[0], L.LABS).some((m) => /duplicate/.test(m)), true);
eq('validate: empty mistakes list', L.validate(Object.assign({}, L.LABS[0], { learn: Object.assign({}, L.LABS[0].learn, { mistakes: [] }) })).some((m) => /mistakes/.test(m)), true);
let threw = false; try { L.register({ id: 'x' }); } catch (e) { threw = true; }
eq('register throws on a bad lab', threw, true);
eq('failed register adds nothing', L.LABS.length, LAB_COUNT);

// ---- search ranking
eq('empty query returns nothing', L.search('').length + L.search('   ').length + L.search('--').length, 0);
eq('lru -> page replacement', topId('lru'), 'paging');
eq('LRU is case-insensitive', topId('LrU'), 'paging');
eq('banker -> banker', topId('banker'), 'bankers');
eq('elevator -> disk', topId('elevator'), 'disk');
eq('c-scan -> disk', topId('c-scan'), 'disk');
eq('cscan (no hyphen) -> disk', topId('cscan'), 'disk');
eq('"c scan" (space) -> disk', topId('c scan'), 'disk');
eq('best fit -> allocation', topId('best fit'), 'allocation');
eq('best-fit -> allocation', topId('best-fit'), 'allocation');
eq('tlb -> translation', topId('tlb'), 'translation');
eq('semaphore -> sync', topId('semaphore'), 'sync');
eq('philosophers -> sync', topId('philosophers'), 'sync');
eq('belady -> paging', topId('belady'), 'paging');
eq('pcb -> states', topId('pcb'), 'states');
eq('round robin -> scheduling', topId('round robin'), 'scheduling');
eq('title match beats keyword: "deadlock g"', topId('deadlock g'), 'rag');
eq('fcfs appears in both scheduling and disk', L.search('fcfs').map((r) => r.lab.id).sort(), ['disk', 'scheduling']);
eq('deadlock: graphs lab first, Banker also found', [topId('deadlock'), L.search('deadlock').some((r) => r.lab.id === 'bankers')], ['rag', true]);
eq('multi-word fallback: "priority preemptive"', topId('priority preemptive'), 'scheduling');
eq('multi-word fallback needs every word to match', L.search('priority zzzzzz').length, 0);
eq('result reports the matched keyword', (L.search('elevator')[0] || {}).hit, 'elevator algorithm');
eq('title match reports hit=null', (L.search('page replacement')[0] || {}).hit, null);
eq('unknown term -> no results', L.search('zzqqunknown').length, 0);
eq('peterson / dekker / bakery -> sync', ['peterson', 'dekker', 'bakery algorithm', 'condition variable', 'mesa', 'hoare'].map((q) => topId(q)), ['sync', 'sync', 'sync', 'sync', 'sync', 'sync']);
eq('short noise query does not match inside words ("rr" only as prefix)', L.search('rr').map((r) => r.lab.id), ['scheduling']);
eq('limit is respected', L.search('a', { limit: 3 }).length <= 3, true);
// advanced filter: register an advanced lab on a copy and confirm includeAdvanced=false hides it
L.register({ id: 'tmpadv', area: 'system', section: 'kernel', title: 'Temp advanced', view: 'scheduling', level: 'advanced', summary: 'temporary test lab', keywords: ['zzzunique'], learn: { idea: 'i', hook: 'h', deep: ['d'], mistakes: ['m'] } });
eq('advanced lab found by default', topId('zzzunique'), 'tmpadv');
eq('advanced lab hidden when excluded', L.search('zzzunique', { includeAdvanced: false }).length, 0);
L.LABS.pop();

// ---- coverage: every algorithm in the engines can be found, and leads to the right lab
const covers = [
  ['../js/engines/scheduling.js', 'scheduling', (m) => m.ALGOS], ['../js/engines/paging.js', 'paging', (m) => m.ALGOS],
  ['../js/engines/disk.js', 'disk', (m) => m.ALGOS], ['../js/engines/allocation.js', 'allocation', (m) => m.ALGOS]
];
covers.forEach(([file, lab, get]) => {
  get(require(file)).forEach((a) => {
    const ids = L.search(a.short).map((r) => r.lab.id);
    eq('engine algorithm "' + a.short + '" is searchable and reaches ' + lab, ids.includes(lab), true);
  });
});

console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
