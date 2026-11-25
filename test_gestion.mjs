// ABC classes follow cumulative share of units shipped; items with no outflow are always C.
import assert from 'node:assert/strict';
import {classify} from './web/inventory.js';
const out = classify([{product:'a',out:80},{product:'b',out:15},{product:'c',out:5},{product:'d',out:0}]);
assert.deepEqual(Object.fromEntries(out.map(p=>[p.product,p.abc])), {a:'A',b:'B',c:'C',d:'C'});
assert.equal(classify([{product:'x',out:0}])[0].abc, 'C');
assert.equal(classify([{product:'big',out:90},{product:'s',out:10}])[0].abc, 'A');
console.log('OK ABC: clases por participación acumulada y sin salidas en C.');
