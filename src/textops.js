'use strict';
// Pure text helpers for the source editor: wrapping, prefixes, insertion, headings, counts.
// No DOM access, so they can be tested from Node. Shared with the page like math.js.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TwoEasyText = factory();
})(typeof self !== 'undefined' ? self : this, function () {

  // Wraps the selection with `before`/`after`; with no selection inserts a placeholder and selects it.
  // If the selection is already wrapped, unwraps it (toggle).
  function wrapSelection(text, start, end, before, after, placeholder) {
    after = after === undefined ? before : after;
    const sel = text.slice(start, end);
    const outerStart = start - before.length, outerEnd = end + after.length;
    if (outerStart >= 0 && text.slice(outerStart, start) === before && text.slice(end, outerEnd) === after) {
      return { text: text.slice(0, outerStart) + sel + text.slice(outerEnd), start: outerStart, end: outerStart + sel.length };
    }
    if (sel.startsWith(before) && sel.endsWith(after) && sel.length >= before.length + after.length) {
      const inner = sel.slice(before.length, sel.length - after.length);
      return { text: text.slice(0, start) + inner + text.slice(end), start, end: start + inner.length };
    }
    const body = sel || placeholder || '';
    const out = text.slice(0, start) + before + body + after + text.slice(end);
    return { text: out, start: start + before.length, end: start + before.length + body.length };
  }

  // Makes the selected lines a heading of `level` (0 = plain paragraph).
  function setHeading(text, start, end, level) {
    return mapLines(text, start, end, (line) => {
      const stripped = line.replace(/^#{1,6}\s+/, '');
      return level ? '#'.repeat(level) + ' ' + stripped : stripped;
    });
  }

  // Toggles a line prefix ("- ", "> ", "1. ") on the selected lines.
  function toggleLinePrefix(text, start, end, kind) {
    const lines = selectedLines(text, start, end);
    const prefixRe = { bullet: /^(\s*)[-*+]\s+/, number: /^(\s*)\d+[.)]\s+/, quote: /^(\s*)>\s?/, task: /^(\s*)[-*+]\s+\[[ xX]\]\s+/ }[kind];
    const allHave = lines.every((l) => prefixRe.test(l) || !l.trim());
    let n = 0;
    return mapLines(text, start, end, (line) => {
      if (allHave) return line.replace(prefixRe, '$1');
      if (!line.trim()) return line;
      const clean = line.replace(/^(\s*)([-*+]|\d+[.)]|>)\s+(\[[ xX]\]\s+)?/, '$1');
      n++;
      const prefix = { bullet: '- ', number: `${n}. `, quote: '> ', task: '- [ ] ' }[kind];
      return clean.replace(/^(\s*)/, '$1' + prefix);
    });
  }

  function selectedLines(text, start, end) {
    const ls = text.lastIndexOf('\n', start - 1) + 1;
    let le = text.indexOf('\n', Math.max(end - (end > start ? 1 : 0), start));
    if (le < 0) le = text.length;
    return text.slice(ls, le).split('\n');
  }

  function mapLines(text, start, end, fn) {
    const ls = text.lastIndexOf('\n', start - 1) + 1;
    let le = text.indexOf('\n', Math.max(end - (end > start ? 1 : 0), start));
    if (le < 0) le = text.length;
    const replaced = text.slice(ls, le).split('\n').map(fn).join('\n');
    return { text: text.slice(0, ls) + replaced + text.slice(le), start: ls, end: ls + replaced.length };
  }

  const CURSOR = '⌶'; // marks the cursor position inside a snippet (never appears in normal text)

  // Inserts a block snippet on its own paragraph.
  function insertBlock(text, start, end, snippet) {
    const before = text.slice(0, start), after = text.slice(end);
    const pad1 = before.length === 0 ? '' : before.endsWith('\n\n') ? '' : before.endsWith('\n') ? '\n' : '\n\n';
    const pad2 = after.length === 0 ? '\n' : after.startsWith('\n\n') ? '' : after.startsWith('\n') ? '\n' : '\n\n';
    let cursor = snippet.indexOf(CURSOR);
    const clean = cursor >= 0 ? snippet.slice(0, cursor) + snippet.slice(cursor + 1) : snippet;
    if (cursor < 0) cursor = clean.length;
    const pos = before.length + pad1.length + cursor;
    return { text: before + pad1 + clean + pad2 + after, start: pos, end: pos };
  }

  // Inserts inline text at the cursor, replacing the selection. Cursor goes after it (or at CURSOR).
  function insertInline(text, start, end, snippet) {
    let cursor = snippet.indexOf(CURSOR);
    const clean = cursor >= 0 ? snippet.slice(0, cursor) + snippet.slice(cursor + 1) : snippet;
    if (cursor < 0) cursor = clean.length;
    return { text: text.slice(0, start) + clean + text.slice(end), start: start + cursor, end: start + cursor };
  }

  // ATX headings outside fenced code: [{ level, text, line }]
  function headings(text) {
    const out = [];
    let inFence = false;
    text.split('\n').forEach((line, i) => {
      if (/^\s*(```|~~~)/.test(line)) { inFence = !inFence; return; }
      if (inFence) return;
      const m = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
      if (m) out.push({ level: m[1].length, text: m[2].replace(/[*_`~]/g, ''), line: i });
    });
    return out;
  }

  function slugify(s) {
    return s.toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, '').trim().replace(/\s+/g, '-') || 'section';
  }

  function counts(text) {
    const words = (text.match(/\S+/g) || []).length;
    return {
      words,
      chars: text.length,
      charsNoSpaces: text.replace(/\s/g, '').length,
      lines: text ? text.split('\n').length : 0,
      minutes: Math.max(1, Math.round(words / 200)),
    };
  }

  function lineOf(text, pos) { return text.slice(0, pos).split('\n').length - 1; }
  function offsetOfLine(text, line) {
    let pos = 0;
    for (let i = 0; i < line; i++) { pos = text.indexOf('\n', pos) + 1; if (pos <= 0) return text.length; }
    return pos;
  }

  return { CURSOR, wrapSelection, setHeading, toggleLinePrefix, insertBlock, insertInline, headings, slugify, counts, lineOf, offsetOfLine };
});
