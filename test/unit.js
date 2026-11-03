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

// ---- htmlmap ----
const H = require('../src/htmlmap');
{
  const src = '<title>T</title><style>p{}</style><p class="a>b">Hello <b>big</b> &laquo;world&raquo;</p><!-- x --><script>var a="<p>z</p>";</script><ul><li>one</li>\n<li>two</li></ul>';
  const segs = H.scan(src);
  assert.deepEqual(segs.map((g) => src.slice(g.start, g.end)), ['Hello ', 'big', ' &laquo;world&raquo;', 'one', 'two']);
  const dom = ['Hello ', 'big', ' «world»', 'generated', 'one', 'two'];
  const map = H.align(dom, segs, src);
  assert.deepEqual(map, [0, 1, 2, -1, 3, 4]);
  const wrap = (sel) => {
    const out = H.rangesFor(sel, dom, map, segs, src);
    let t = src;
    for (const p of out.slice().reverse()) t = t.slice(0, p.end) + '</u>' + t.slice(p.end), t = t.slice(0, p.start) + '<u>' + t.slice(p.start);
    return t;
  };
  assert.ok(wrap({ s: { n: 0, o: 1 }, e: { n: 0, o: 4 } }).includes('H<u>ell</u>o'));
  assert.ok(wrap({ s: { n: 2, o: 1 }, e: { n: 2, o: 8 } }).includes('<u>&laquo;world&raquo;</u>'));
  const multi = wrap({ s: { n: 1, o: 1 }, e: { n: 5, o: 2 } });
  assert.ok(multi.includes('b<u>ig</u>') && multi.includes('<u>&laquo;world&raquo;</u>') && multi.includes('<u>one</u>') && multi.includes('<u>tw</u>o'));
  assert.equal(H.rangesFor({ s: { n: 3, o: 0 }, e: { n: 3, o: 3 } }, dom, map, segs, src), null);
}

console.log('unit tests OK');
