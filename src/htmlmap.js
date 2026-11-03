'use strict';
// Maps text selected in the HTML preview back to the HTML source.
//   scan(src)                       text segments of the source (outside tags, comments, script, style)
//   align(domTexts, segs)           for each text node of the rendered page, the matching segment (or -1)
//   rangesFor(sel, domTexts, map, segs, src)   source ranges covered by a selection {s:{n,o}, e:{n,o}}
// Shared by the page (loaded with a <script> tag) and the unit tests (required from Node).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TwoEasyHtmlMap = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const RAW_TEXT = new Set(['script', 'style', 'title', 'textarea', 'noscript', 'template']);
  const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', laquo: '«', raquo: '»' };

  let scratch = null;
  function decodeEntity(m) {
    if (typeof document !== 'undefined') {
      scratch = scratch || document.createElement('textarea');
      scratch.innerHTML = m;
      return scratch.value;
    }
    if (m[1] === '#') return String.fromCodePoint(m[2] === 'x' || m[2] === 'X' ? parseInt(m.slice(3, -1), 16) : parseInt(m.slice(2, -1), 10));
    return NAMED[m.slice(1, -1)] || m;
  }

  // Text segments that contain something other than whitespace: [{start, end}] (source offsets).
  function scan(src) {
    const segs = [];
    const n = src.length;
    let lower = null;
    let i = 0;
    let textStart = 0;
    const flush = (end) => { if (end > textStart && /\S/.test(src.slice(textStart, end))) segs.push({ start: textStart, end }); };
    const skipTo = (token, from) => { const e = src.indexOf(token, from); return e < 0 ? n : e; };
    while (i < n) {
      if (src[i] !== '<') { i++; continue; }
      if (src.startsWith('<!--', i)) {
        flush(i);
        const e = src.indexOf('-->', i + 4);
        i = e < 0 ? n : e + 3;
        textStart = i;
        continue;
      }
      const open = /^<([a-zA-Z][^\s/>]*)/.exec(src.slice(i, i + 64));
      if (open) {
        flush(i);
        let j = i + open[0].length;
        let q = null;
        while (j < n) {
          const c = src[j];
          if (q) { if (c === q) q = null; } else if (c === '"' || c === "'") q = c; else if (c === '>') break;
          j++;
        }
        i = Math.min(j + 1, n);
        textStart = i;
        const name = open[1].toLowerCase();
        if (RAW_TEXT.has(name)) {
          lower = lower || src.toLowerCase();
          const e = lower.indexOf('</' + name, i);
          i = e < 0 ? n : e;
          textStart = i;
        }
        continue;
      }
      if (/^<(\/[a-zA-Z]|!|\?)/.test(src.slice(i, i + 3))) {
        flush(i);
        i = Math.min(skipTo('>', i) + 1, n);
        textStart = i;
        continue;
      }
      i++; // a lone "<" is text
    }
    flush(n);
    return segs;
  }

  // Decoded text of a segment, with the source offset of every decoded character.
  function decode(src, seg) {
    if (seg.text !== undefined) return seg;
    const raw = src.slice(seg.start, seg.end);
    const rs = [];
    const re = [];
    let text = '';
    let last = 0;
    const plain = (a, b) => { for (let k = a; k < b; k++) { text += raw[k]; rs.push(k); re.push(k + 1); } };
    const rx = /&(?:#\d+|#[xX][0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g;
    let m;
    while ((m = rx.exec(raw))) {
      plain(last, m.index);
      const end = m.index + m[0].length;
      const d = decodeEntity(m[0]);
      if (d === m[0]) plain(m.index, end);
      else for (const unit of d.split('')) { text += unit; rs.push(m.index); re.push(end); }
      last = end;
    }
    plain(last, raw.length);
    seg.text = text; seg.rs = rs; seg.re = re;
    return seg;
  }

  const norm = (s) => s.replace(/\s+/g, ' ').trim();

  // Rendered text nodes and source segments both appear in document order; nodes made by scripts
  // have no segment, and some segments (title...) have no node, so match them by content.
  function align(domTexts, segs, src) {
    const out = new Array(domTexts.length).fill(-1);
    const sn = segs.map((s) => norm(decode(src, s).text));
    let j = 0;
    for (let i = 0; i < domTexts.length; i++) {
      const t = norm(domTexts[i]);
      for (let k = j; k < segs.length; k++) {
        if (sn[k] === t) { out[i] = k; j = k + 1; break; }
      }
    }
    return out;
  }

  // Source ranges [{start, end}] (one per text segment touched, whitespace trimmed) or null.
  function rangesFor(sel, domTexts, map, segs, src) {
    if (!sel || !sel.s || !sel.e) return null;
    const a = sel.s.n;
    const b = sel.e.n;
    if (!(a >= 0 && b >= a && b < domTexts.length) || map[a] < 0 || map[b] < 0) return null;
    const shiftOf = (i) => decode(src, segs[map[i]]).text.indexOf(domTexts[i]);
    const sa = shiftOf(a);
    const sb = shiftOf(b);
    if (sa < 0 || sb < 0) return null;
    const pieces = [];
    const piece = (i, from, to) => { // decoded offsets from..to of node i
      const seg = decode(src, segs[map[i]]);
      if (!(to > from)) return;
      pieces.push({ start: seg.start + seg.rs[from], end: seg.start + seg.re[to - 1] });
    };
    const lenOf = (i) => decode(src, segs[map[i]]).text.length;
    const startDec = sel.s.o + sa;
    const endDec = sel.e.o + sb;
    if (a === b) piece(a, startDec, endDec);
    else {
      piece(a, startDec, sa + domTexts[a].length);
      for (let i = a + 1; i < b; i++) if (map[i] >= 0) piece(i, 0, lenOf(i));
      piece(b, sb, endDec);
    }
    const out = [];
    for (const p of pieces) {
      let { start, end } = p;
      while (start < end && /\s/.test(src[start])) start++;
      while (end > start && /\s/.test(src[end - 1])) end--;
      if (end > start) out.push({ start, end });
    }
    return out;
  }

  return { scan, decode, align, rangesFor };
});
