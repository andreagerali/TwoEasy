'use strict';
// Unit tests for the pure modules. Run: node test/unit.js
const assert = require('assert');
const M = require('../src/math');
const T = require('../src/textops');

// ---- math: which $ are formulas ----
const seen = (s) => M.replaceMath(s, (tex, d) => `«${d ? 'D' : 'I'}:${tex}»`);
assert.equal(seen('costs $5 and $10 total'), 'costs $5 and $10 total');
assert.equal(seen('between $3.50 and $4'), 'between $3.50 and $4');
assert.equal(seen('$100 million vs $2 billion'), '$100 million vs $2 billion');
assert.equal(seen('math $x^2$ here'), 'math «I:x^2» here');
assert.equal(seen('vars $a_1 * b_2$ ok'), 'vars «I:a_1 * b_2» ok');
assert.equal(seen('$$\nE=mc^2\n$$'), '«D:E=mc^2»');
assert.equal(seen('literal \\$x\\$ here'), 'literal $x$ here');
assert.equal(seen('code `$x$` stays'), 'code `$x$` stays');

// ---- math: WYSIWYG round trip ----
const src = 'Prices: $5 and $10, $2 billion. Escaped: \\$x\\$. Math $x^2$ and $$a_1$$ and `$5` code';
const esc = M.escapeLiteralDollars(src);
assert.equal(esc, 'Prices: \\$5 and \\$10, \\$2 billion. Escaped: \\$x\\$. Math $x^2$ and $$a_1$$ and `$5` code');
const back = M.unescapeSafeDollars(esc);
assert.equal(back, src);

// ---- textops ----
let r = T.wrapSelection('hello world', 0, 5, '**');
assert.equal(r.text, '**hello** world');
r = T.wrapSelection(r.text, r.start, r.end, '**');
assert.equal(r.text, 'hello world');
r = T.setHeading('one\ntwo\nthree', 4, 6, 2);
assert.equal(r.text, 'one\n## two\nthree');
r = T.toggleLinePrefix('a\nb\nc', 0, 5, 'number');
assert.equal(r.text, '1. a\n2. b\n3. c');
r = T.insertBlock('para', 4, 4, '| a | b |\n|---|---|\n| | |');
assert.equal(r.text, 'para\n\n| a | b |\n|---|---|\n| | |\n');
assert.deepEqual(T.headings('# A\n```\n# not\n```\n## B *x*').map((h) => h.text + h.level + h.line), ['A10', 'B x24']);
assert.equal(T.counts('a b\nc').lines, 2);

console.log('unit tests OK');
