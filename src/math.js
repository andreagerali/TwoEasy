'use strict';
// Finds $…$ and $$…$$ formulas in Markdown source, skipping code.
// Shared by the preview (loaded with a <script> tag) and the Word export (required from Node).
//
// Rules for inline $…$ (close to Pandoc's), so that prices such as "$5" or "$10 and $20" stay text:
//   - the opening $ is not preceded by a letter, digit, \ or $, and is not followed by a space;
//   - the closing $ is not preceded by a space or \, and is not followed by a letter or digit;
//   - the content does not start with a number followed by a space ("5 per unit");
//   - \$ is always a literal dollar sign.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TwoEasyMath = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const CODE_SPLIT = /(```[\s\S]*?```|~~~[\s\S]*?~~~|`[^`\n]*`)/;
  const DISPLAY = /\$\$([\s\S]+?)\$\$/g;
  const INLINE = /(^|[^\\$\w])\$([^\s$][^$\n]*?[^\s$\\]|[^\s$\\])\$(?!\w)/g;
  const LOOKS_LIKE_PRICE = /^\d[\d.,]*\s/;
  const ESCAPED_DOLLAR = /\\\$/g;
  const DOLLAR_SLOT = 'ESCDOLLARSLOT';

  // Calls `onMath(tex, isDisplay, raw)` for each formula and replaces it with what the callback
  // returns; `raw` is the formula exactly as written, dollars included. Escaped \$ become plain $.
  function replaceMath(src, onMath) {
    const chunks = src.split(CODE_SPLIT);
    return chunks.map((chunk, i) => {
      if (i % 2 === 1) return chunk; // code: untouched
      return chunk
        .replace(ESCAPED_DOLLAR, DOLLAR_SLOT)
        .replace(DISPLAY, (m, tex) => onMath(tex.trim(), true, m))
        .replace(INLINE, (m, pre, tex) => (LOOKS_LIKE_PRICE.test(tex) ? m : pre + onMath(tex, false, m.slice(pre.length))))
        .split(DOLLAR_SLOT).join('$');
    }).join('');
  }

  // Number of formulas our rules find (used to check that un-escaping a $ does not create one).
  function countMath(src) { let n = 0; replaceMath(src, () => { n++; return ''; }); return n; }

  // For the WYSIWYG editor, whose Markdown parser treats every $…$ as maths: escape the dollars
  // that our rules consider literal, leaving real formulas untouched.
  function escapeLiteralDollars(src) {
    const slots = [];
    const withTokens = replaceMath(src, (tex, display, raw) => {
      slots.push(raw);
      return `MATHKEEP${slots.length - 1}X`;
    });
    const escaped = withTokens.split(CODE_SPLIT).map((chunk, i) => (i % 2 === 1 ? chunk : chunk.replace(/\$/g, '\\$'))).join('');
    return escaped.replace(/MATHKEEP(\d+)X/g, (_, i) => slots[+i]);
  }

  // The way back: turn "\$" into "$" wherever that does not create a formula by our rules.
  function unescapeSafeDollars(src) {
    const base = countMath(src);
    let out = src, from = 0;
    while (true) {
      const i = out.indexOf('\\$', from);
      if (i < 0) break;
      const single = out.slice(0, i) + '$' + out.slice(i + 2);
      // "\$x\$" must stay escaped as a pair, or it would become a formula: also try unescaping
      // the neighbouring \$ before and after this one.
      const j = single.indexOf('\\$', i + 1);
      const withNext = j < 0 ? single : single.slice(0, j) + '$' + single.slice(j + 2);
      const k = single.lastIndexOf('\\$', i - 1);
      const withPrev = k < 0 ? single : single.slice(0, k) + '$' + single.slice(k + 2);
      const safe = [single, withNext, withPrev].every((c) => countMath(c) === base);
      if (safe) { out = single; from = i + 1; } else { from = i + 2; }
    }
    return out;
  }

  return { replaceMath, escapeLiteralDollars, unescapeSafeDollars };
});
