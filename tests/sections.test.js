/* Every lab must sit in a valid section of a valid area, and every section must hold at least one lab. */
const fs = require('fs'), path = require('path');
let pass = 0, fail = 0;
const eq = (n, a, b) => { if (JSON.stringify(a) === JSON.stringify(b)) pass++; else { fail++; console.log('FAIL ' + n + '\n  got ' + JSON.stringify(a) + '\n  exp ' + JSON.stringify(b)); } };
global.window = global; global.OSViz = {};
require('../js/core/labs.js');
const L = OSViz.labs;
const dir = path.join(__dirname, '../js/labs');
fs.readdirSync(dir).filter((f) => f.endsWith('.js')).forEach((f) => { try { require(path.join(dir, f)); } catch (e) { console.log('load ' + f + ': ' + e.message); } });
eq('all 43 labs registered', L.LABS.length, 43);
L.LABS.forEach((l) => eq(l.id + ' has valid area+section', L.validate(l), []));
L.AREAS.forEach((a) => a.sections.forEach((s) => eq(a.id + '/' + s.id + ' has labs', L.LABS.filter((l) => l.area === a.id && l.section === s.id).length > 0, true)));
eq('sectionTitle', L.sectionTitle('memory', 'translation'), 'Paging & address translation');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
