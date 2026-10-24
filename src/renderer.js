'use strict';
// Page logic: editor, live preview, outline, find/replace, images, settings, export payloads.
/* global markdownit, katex, TwoEasyMath, TwoEasyText */

const $ = (id) => document.getElementById(id);
const editor = $('editor');
const preview = $('preview');
const previewPane = $('preview-pane');
const outlineList = $('outline-list');

const T = TwoEasyText;

// ---------- document state ----------
const doc = { path: null, savedText: '', eol: '\n' };
let settings = { theme: 'light', editorFontSize: 14, syncScroll: true, autosave: false, layout: 'split', outline: false };
let lastHeadings = [];

function isDirty() { return editor.value !== doc.savedText; }
window.__isDirty = isDirty;

function refreshStatus() {
  const name = doc.path ? doc.path.split(/[\\/]/).pop() : 'Untitled';
  $('status-file').textContent = doc.path || 'Untitled';
  $('status-dirty').textContent = isDirty() ? '● unsaved' : '';
  $('status-autosave').hidden = !settings.autosave;
  document.title = `${isDirty() ? '• ' : ''}${name} — TwoEasy`;
  const words = T.counts(editor.value).words;
  $('status-words').textContent = `${words} word${words === 1 ? '' : 's'}`;
}

// The textarea always holds \n. Files keep their own line ending (CRLF, CR): it is detected here and
// put back when saving, so opening a Windows file does not count as a change.
function detectEol(text) { return text.includes('\r\n') ? '\r\n' : text.includes('\r') ? '\r' : '\n'; }
function toDisk(text) { return doc.eol === '\n' ? text : text.replace(/\n/g, doc.eol); }

function loadDocument(path, text, eol) {
  doc.eol = eol || detectEol(text);
  text = text.replace(/\r\n?/g, '\n');
  doc.path = path;
  doc.savedText = text;
  editor.value = text;
  editor.setSelectionRange(0, 0);
  editor.scrollTop = 0;
  const lang = languageFor(path, text);
  if (lang) enterCode(lang, text); else exitCode();
  render();
  refreshStatus();
  if (code) code.focus();
  else if (wys) { wys.setMarkdown(TwoEasyMath.escapeLiteralDollars(text)); wys.focus(); }
  else editor.focus();
}

// ---------- code mode (JSON, YAML, scripts in CodeMirror, bundled in vendor/code.js) ----------
// The textarea stays the source of truth for saving and counts; CodeMirror mirrors into it.
let code = null;
let codeLanguage = null;
const statusLint = $('status-lint');

// Markdown/text files use the Markdown view; known extensions get their language; anything else
// (.gitignore, Dockerfile, .log...) opens as plain text, or JSON if the content parses as JSON.
const MARKDOWN_EXTS = new Set(['md', 'markdown', 'mdown', 'mkd', 'txt']);
function languageFor(path, text) {
  if (!path || !window.TwoEasyCode) return null;
  const base = path.split(/[\\/]/).pop();
  const ext = (base.split('.').pop() || '').toLowerCase();
  if (MARKDOWN_EXTS.has(ext)) return null;
  return window.TwoEasyCode.languageForExt(ext) || (text != null && window.TwoEasyCode.sniff(text)) || 'text';
}
function currentExt() { return codeLanguage === 'text' ? 'txt' : codeLanguage || 'md'; }

function enterCode(language, text) {
  if (code && codeLanguage === language) { code.setText(text); return; }
  exitCode();
  if (wys) exitWysiwyg();
  codeLanguage = language;
  document.body.dataset.mode = 'code';
  document.body.dataset.lang = language;
  $('code-editor').hidden = false;
  code = window.TwoEasyCode.create({
    root: $('code-editor'),
    text,
    language,
    dark: settings.theme === 'dark',
    onChange: (t) => { if (t !== editor.value) { editor.value = t; refreshStatus(); scheduleAutosave(); } },
    onStatus: (s) => {
      statusLint.className = s.ok ? (window.TwoEasyCode.lints(language) ? 'ok' : '') : 'error';
      const label = window.TwoEasyCode.label(language);
      statusLint.textContent = !s.ok ? `${label} error at line ${s.line}: ${s.message}`
        : window.TwoEasyCode.lints(language) ? `Valid ${label}` : label;
    },
  });
}

function exitCode() {
  if (!code) return;
  code.destroy();
  code = null;
  codeLanguage = null;
  $('code-editor').innerHTML = '';
  $('code-editor').hidden = true;
  statusLint.textContent = '';
  statusLint.className = '';
  delete document.body.dataset.mode;
  delete document.body.dataset.lang;
}

function formatJson() {
  if (!code || codeLanguage !== 'json') return flashStatus('Only for JSON files');
  const err = code.format();
  flashStatus(err ? 'Cannot format: ' + err : 'Formatted');
}

// ---------- WYSIWYG mode (Milkdown Crepe, bundled in vendor/wysiwyg.js) ----------
// The right pane becomes editable; the source pane follows but is read-only meanwhile.
let wys = null;
let wysStarting = false;
const altBySrc = new Map();

// Markdown coming back from the WYSIWYG editor, normalised to what the source pane expects.
function fromWysiwyg(md) {
  return TwoEasyMath.unescapeSafeDollars(md)
    .replace(/^\\\[TOC\]$/gm, '[TOC]')
    .replace(/!\[(\d+\.\d{2})?\]\(([^)\s]+)([^)]*)\)/g, (m, ratio, src, rest) => `![${altBySrc.get(src) || ''}](${src}${rest})`);
}

async function enterWysiwyg() {
  if (wys || wysStarting || !window.TwoEasyWysiwyg) return;
  wysStarting = true;
  try {
    document.body.classList.add('wysiwyg');
    preview.hidden = true;
    $('wysiwyg').hidden = false;
    editor.readOnly = true;
    // The WYSIWYG editor keeps an image's size ratio where the alt text was: remember the alt texts.
    altBySrc.clear();
    for (const m of editor.value.matchAll(/!\[([^\]]*)\]\(([^)\s]+)[^)]*\)/g)) altBySrc.set(m[2], m[1]);
    wys = await window.TwoEasyWysiwyg.create({
      root: $('wysiwyg'),
      markdown: TwoEasyMath.escapeLiteralDollars(editor.value),
      onChange: (md) => {
        const text = fromWysiwyg(md);
        if (text === editor.value) return;
        editor.value = text;
        refreshStatus();
        scheduleAutosave();
        lastHeadings = toHtml(text).headings;
        renderOutline();
      },
      onUpload: async (file) => {
        if (!(await ensureSavedForImages())) throw new Error('Document not saved');
        const ext = (file.type.split('/')[1] || 'png').replace('jpeg', 'jpg');
        const rel = await window.api.saveImage({ docPath: doc.path, bytes: await file.arrayBuffer(), ext });
        if (!rel) throw new Error('Could not save the image');
        return rel;
      },
      resolveUrl: (url) => {
        if (/^(https?:|data:|file:)/i.test(url)) return url;
        const base = docDirUrl();
        return base ? new URL(url, base).href : url;
      },
    });
    wys.focus();
  } catch (err) {
    console.error(err);
    await exitWysiwyg();
  } finally {
    wysStarting = false;
  }
}

async function exitWysiwyg() {
  document.body.classList.remove('wysiwyg');
  if (wys) { const w = wys; wys = null; await w.destroy(); }
  $('wysiwyg').innerHTML = '';
  $('wysiwyg').hidden = true;
  preview.hidden = false;
  editor.readOnly = false;
  render();
  editor.focus();
}

function toggleWysiwyg() { return wys ? exitWysiwyg() : enterWysiwyg(); }

async function newDocument() {
  if (isDirty() && !confirm('Discard unsaved changes?')) return;
  loadDocument(null, '');
}

async function save() {
  const saved = await window.api.save({ path: doc.path, text: toDisk(editor.value), ext: currentExt() });
  if (saved) { doc.path = saved; doc.savedText = editor.value; refreshStatus(); }
  return !!saved;
}
window.__saveForClose = save;

async function saveAs() {
  const saved = await window.api.saveAs({ path: doc.path, text: toDisk(editor.value), ext: currentExt() });
  if (saved) {
    doc.path = saved; doc.savedText = editor.value; refreshStatus();
    const lang = languageFor(saved, editor.value);
    if (lang !== codeLanguage) loadDocument(saved, editor.value, doc.eol); // extension changed: switch mode
  }
}

let autosaveTimer = null;
function scheduleAutosave() {
  clearTimeout(autosaveTimer);
  if (settings.autosave && doc.path && isDirty()) autosaveTimer = setTimeout(save, 2000);
}

// ---------- Markdown → HTML ----------
const md = markdownit({ html: false, linkify: true, typographer: true, breaks: false });

// task lists: "- [ ] item" / "- [x] item"
md.core.ruler.push('task_lists', (state) => {
  const tokens = state.tokens;
  for (let i = 2; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.type !== 'inline' || tokens[i - 1].type !== 'paragraph_open' || tokens[i - 2].type !== 'list_item_open') continue;
    const m = /^\[([ xX])\]\s+/.exec(t.content);
    if (!m) continue;
    t.content = t.content.slice(m[0].length);
    if (t.children && t.children[0] && t.children[0].type === 'text') t.children[0].content = t.children[0].content.slice(m[0].length);
    tokens[i - 2].attrJoin('class', 'task-item');
    const box = new state.Token('html_inline', '', 0);
    box.content = `<input type="checkbox" disabled${m[1] !== ' ' ? ' checked' : ''}> `;
    t.children.unshift(box);
  }
});

function escapeHtml(s) {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

// Pull formulas out before Markdown runs (so _ and * inside them survive), render them with KaTeX,
// put them back afterwards. mathOutput: 'html' (preview, PDF) or 'mathml' (standalone HTML, clipboard).
function toHtml(src, { mathOutput = 'html' } = {}) {
  const slots = [];
  const text = TwoEasyMath.replaceMath(src, (tex, display) => {
    let html;
    try { html = katex.renderToString(tex, { displayMode: display, throwOnError: false, output: mathOutput === 'mathml' ? 'mathml' : 'htmlAndMathml' }); }
    catch (e) { html = `<span class="math-error">${escapeHtml(tex)}</span>`; }
    slots.push(html);
    return `MATHSLOT${slots.length - 1}X`;
  });

  const tokens = md.parse(text, {});
  // heading ids + outline data
  const headings = [];
  const seen = new Map();
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].type !== 'heading_open') continue;
    const inline = tokens[i + 1];
    const plain = inline.children.filter((c) => c.type === 'text' || c.type === 'code_inline').map((c) => c.content).join('')
      .replace(/MATHSLOT(\d+)X/g, '');
    let id = T.slugify(plain);
    const n = seen.get(id) || 0; seen.set(id, n + 1);
    if (n) id += `-${n}`;
    tokens[i].attrSet('id', id);
    headings.push({ level: Number(tokens[i].tag.slice(1)), text: plain || '…', id, line: tokens[i].map ? tokens[i].map[0] : 0 });
  }
  let html = md.renderer.render(tokens, md.options, {});
  html = html.replace(/MATHSLOT(\d+)X/g, (_, i) => slots[+i]);
  // [TOC] on a line of its own
  html = html.replace(/<p>\[TOC\]<\/p>/gi, () => tocHtml(headings));
  return { html, headings };
}

function tocHtml(headings) {
  if (!headings.length) return '<nav class="toc"><em>No headings yet</em></nav>';
  const min = Math.min(...headings.map((h) => h.level));
  let out = '<nav class="toc">', depth = 0;
  for (const h of headings) {
    const d = h.level - min + 1;
    while (depth < d) { out += '<ul>'; depth++; }
    while (depth > d) { out += '</ul>'; depth--; }
    out += `<li><a href="#${h.id}">${escapeHtml(h.text)}</a></li>`;
  }
  while (depth > 0) { out += '</ul>'; depth--; }
  return out + '</nav>';
}

// ---------- preview ----------
function docDirUrl() {
  if (!doc.path) return null;
  const dir = doc.path.replace(/[\\/][^\\/]*$/, '');
  return 'file:///' + dir.replace(/\\/g, '/').replace(/^\/+/, '') + '/';
}

function fixImagePaths(root) {
  const base = docDirUrl();
  for (const img of root.querySelectorAll('img')) {
    const src = img.getAttribute('src') || '';
    if (/^(https?:|data:|file:)/i.test(src)) continue;
    if (/^[a-z]:[\\/]/i.test(src)) { img.src = 'file:///' + src.replace(/\\/g, '/'); continue; }
    if (base) img.src = new URL(src, base).href;
  }
}

let renderTimer = null;
function scheduleRender() {
  clearTimeout(renderTimer);
  renderTimer = setTimeout(render, 120);
}

function render() {
  if (code) { lastHeadings = []; outlineList.innerHTML = ''; return; }
  const { html, headings } = toHtml(editor.value);
  preview.innerHTML = html;
  fixImagePaths(preview);
  lastHeadings = headings;
  renderOutline();
}

// Links: external ones open in the system browser, #anchors scroll the preview.
preview.addEventListener('click', (e) => {
  const a = e.target.closest('a[href]');
  if (!a) return;
  e.preventDefault();
  const href = a.getAttribute('href');
  if (/^https?:/i.test(href)) window.api.openExternal(href);
  else if (href.startsWith('#')) {
    const el = preview.querySelector(`[id="${CSS.escape(href.slice(1))}"]`);
    if (el) el.scrollIntoView({ block: 'start' });
  }
});

// ---------- outline ----------
function renderOutline() {
  if (!settings.outline) return;
  outlineList.innerHTML = '';
  if (!lastHeadings.length) { outlineList.innerHTML = '<div class="outline-empty">No headings</div>'; return; }
  for (const h of lastHeadings) {
    const div = document.createElement('div');
    div.className = `outline-item l${h.level}`;
    div.textContent = h.text;
    div.title = h.text;
    div.addEventListener('click', () => jumpToHeading(h));
    outlineList.appendChild(div);
  }
}

function jumpToHeading(h) {
  const pos = T.offsetOfLine(editor.value, h.line);
  editor.focus();
  editor.setSelectionRange(pos, pos);
  scrollEditorTo(pos);
  const el = preview.querySelector(`[id="${CSS.escape(h.id)}"]`);
  if (el) { scrollLock = true; el.scrollIntoView({ block: 'start' }); requestAnimationFrame(() => { scrollLock = false; }); }
}

// Pixel offset of a text position inside the textarea, measured with a mirror element.
let mirror = null;
function editorOffsetTop(pos) {
  if (!mirror) {
    mirror = document.createElement('div');
    mirror.style.cssText = 'position:absolute;visibility:hidden;white-space:pre-wrap;word-wrap:break-word;top:0;left:-9999px;';
    document.body.appendChild(mirror);
  }
  const cs = getComputedStyle(editor);
  for (const p of ['fontFamily', 'fontSize', 'lineHeight', 'paddingTop', 'paddingLeft', 'paddingRight', 'letterSpacing', 'tabSize']) mirror.style[p] = cs[p];
  mirror.style.width = editor.clientWidth + 'px';
  mirror.style.boxSizing = 'border-box';
  mirror.textContent = editor.value.slice(0, pos);
  const marker = document.createElement('span');
  marker.textContent = '​';
  mirror.appendChild(marker);
  return marker.offsetTop;
}

function scrollEditorTo(pos) {
  const y = editorOffsetTop(pos);
  editor.scrollTop = Math.max(0, y - editor.clientHeight / 3);
}

// ---------- synchronised scrolling (by ratio) ----------
let scrollLock = false;
function syncFrom(source, target) {
  if (!settings.syncScroll || scrollLock) return;
  scrollLock = true;
  const ratio = source.scrollTop / Math.max(1, source.scrollHeight - source.clientHeight);
  target.scrollTop = ratio * (target.scrollHeight - target.clientHeight);
  requestAnimationFrame(() => { scrollLock = false; });
}
editor.addEventListener('scroll', () => syncFrom(editor, previewPane));
previewPane.addEventListener('scroll', () => syncFrom(previewPane, editor));

// ---------- editing helpers ----------
// Applies {text,start,end} from textops through the browser's own editing command,
// so that Ctrl+Z still works.
function applyEdit(result) {
  const old = editor.value;
  if (result.text !== old) {
    let a = 0;
    while (a < old.length && a < result.text.length && old[a] === result.text[a]) a++;
    let b = 0;
    while (b < old.length - a && b < result.text.length - a && old[old.length - 1 - b] === result.text[result.text.length - 1 - b]) b++;
    editor.focus();
    editor.setSelectionRange(a, old.length - b);
    const inserted = result.text.slice(a, result.text.length - b);
    if (!document.execCommand('insertText', false, inserted)) editor.setRangeText(inserted, a, old.length - b, 'end');
    if (editor.value !== result.text) editor.value = result.text; // fallback if the command misbehaved
  }
  editor.focus();
  editor.setSelectionRange(result.start, result.end);
  onInput();
}

function sel() { return [editor.value, editor.selectionStart, editor.selectionEnd]; }

const FORMATS = {
  bold: ['**', '**', 'bold text'],
  italic: ['*', '*', 'italic text'],
  strike: ['~~', '~~', 'text'],
  code: ['`', '`', 'code'],
  math: ['$', '$', 'x^2'],
};
function format(kind) {
  if (wys) return wys.command(kind);
  if (kind === 'link') {
    const [text, s, e] = sel();
    const selected = text.slice(s, e);
    if (/^https?:\/\//i.test(selected)) return applyEdit(T.insertInline(text, s, e, `[${T.CURSOR}](${selected})`));
    const r = T.insertInline(text, s, e, `[${selected || 'link text'}](${T.CURSOR}https://)`);
    return applyEdit(r);
  }
  const [before, after, ph] = FORMATS[kind];
  applyEdit(T.wrapSelection(...sel(), before, after, ph));
}

const C = T.CURSOR;
const BLOCKS = {
  table: `| Column 1 | Column 2 | Column 3 |\n|----------|----------|----------|\n| ${C} |  |  |\n|  |  |  |`,
  code: '```\n' + C + '\n```',
  math: '$$\n' + C + '\n$$',
  hr: '---',
  toc: '[TOC]',
};
function insertBlock(kind) {
  if (wys) return wys.command({ table: 'table', code: 'codeblock', hr: 'hr' }[kind] || '');
  applyEdit(T.insertBlock(...sel(), BLOCKS[kind]));
}

// ---------- images ----------
async function ensureSavedForImages() {
  if (doc.path) return true;
  if (!confirm('Images are stored next to the document. Save the document first?')) return false;
  return save();
}
async function insertImageRef(rel) {
  const [text, s, e] = sel();
  applyEdit(T.insertInline(text, s, e, `![${C}](${rel})`));
}
async function insertImageFromFile() {
  const file = await window.api.pickImage();
  if (!file) return;
  if (!(await ensureSavedForImages())) return;
  const rel = await window.api.saveImage({ docPath: doc.path, sourcePath: file });
  if (rel) insertImageRef(rel);
}
async function saveImageBlob(file) {
  if (!(await ensureSavedForImages())) return;
  const ext = (file.type.split('/')[1] || 'png').replace('jpeg', 'jpg');
  const bytes = await file.arrayBuffer();
  const rel = await window.api.saveImage({ docPath: doc.path, bytes, ext });
  if (rel) insertImageRef(rel);
}

editor.addEventListener('paste', (e) => {
  const file = [...(e.clipboardData.files || [])].find((f) => f.type.startsWith('image/'));
  if (!file) return;
  e.preventDefault();
  saveImageBlob(file);
});
editor.addEventListener('dragover', (e) => { e.preventDefault(); editor.classList.add('drop-target'); });
editor.addEventListener('dragleave', () => editor.classList.remove('drop-target'));
editor.addEventListener('drop', async (e) => {
  e.preventDefault();
  editor.classList.remove('drop-target');
  for (const file of e.dataTransfer.files) {
    const p = window.api.pathForFile(file);
    if (/\.(md|markdown|txt)$/i.test(p)) continue; // documents are opened via the menu
    if (!file.type.startsWith('image/')) continue;
    if (!(await ensureSavedForImages())) return;
    const rel = await window.api.saveImage({ docPath: doc.path, sourcePath: p });
    if (rel) insertImageRef(rel);
  }
});

// ---------- editor behaviour ----------
function onInput() { scheduleRender(); refreshStatus(); scheduleAutosave(); }
editor.addEventListener('input', onInput);

editor.addEventListener('keydown', (e) => {
  if (e.key === 'Tab') {
    e.preventDefault();
    const [text, s, en] = sel();
    if (s !== en && text.slice(s, en).includes('\n')) {
      applyEdit(mapIndent(text, s, en, e.shiftKey));
    } else if (e.shiftKey) {
      applyEdit(mapIndent(text, s, en, true));
    } else {
      document.execCommand('insertText', false, '  ');
    }
  }
});
function mapIndent(text, s, e, outdent) {
  const ls = text.lastIndexOf('\n', s - 1) + 1;
  let le = text.indexOf('\n', Math.max(e - (e > s ? 1 : 0), s)); if (le < 0) le = text.length;
  const block = text.slice(ls, le).split('\n').map((l) => (outdent ? l.replace(/^ {1,2}/, '') : '  ' + l)).join('\n');
  return { text: text.slice(0, ls) + block + text.slice(le), start: ls, end: ls + block.length };
}

// ---------- layout, theme, focus ----------
function setLayout(mode, persist = true) {
  document.body.dataset.layout = mode;
  for (const b of document.querySelectorAll('[data-layout]')) b.classList.toggle('active', b.dataset.layout === mode);
  if (persist) { settings.layout = mode; window.api.setSetting('layout', mode); }
}
for (const b of document.querySelectorAll('[data-layout]')) b.addEventListener('click', () => setLayout(b.dataset.layout));

function applyTheme(theme) {
  settings.theme = theme;
  document.body.dataset.theme = theme;
  $('wysiwyg-dark').disabled = theme !== 'dark';
  if (code) code.setDark(theme === 'dark');
}
function applyEditorFont(size) {
  settings.editorFontSize = size;
  document.documentElement.style.setProperty('--editor-font-size', size + 'px');
}
function setOutline(on) {
  settings.outline = on;
  $('outline-pane').hidden = !on;
  renderOutline();
}
function toggleFocus(force) {
  const on = document.body.classList.toggle('focus', force);
  if (on) editor.focus();
}

// draggable divider
(() => {
  const divider = $('divider');
  const editorPane = $('editor-pane');
  let dragging = false;
  divider.addEventListener('mousedown', () => { dragging = true; document.body.style.cursor = 'col-resize'; });
  window.addEventListener('mouseup', () => { dragging = false; document.body.style.cursor = ''; });
  window.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    const panes = $('panes').getBoundingClientRect();
    const outlineW = settings.outline ? $('outline-pane').getBoundingClientRect().width : 0;
    const frac = Math.min(0.85, Math.max(0.15, (e.clientX - panes.left - outlineW) / (panes.width - outlineW)));
    editorPane.style.flex = `0 0 ${frac * 100}%`;
  });
})();

// ---------- find and replace ----------
const findbar = $('findbar');
const findInput = $('find-input');
const replaceInput = $('replace-input');
const findStatus = $('find-status');

function showFind(withReplace) {
  findbar.hidden = false;
  const selected = editor.value.slice(editor.selectionStart, editor.selectionEnd);
  if (selected && !selected.includes('\n')) findInput.value = selected;
  (withReplace && findInput.value ? replaceInput : findInput).focus();
  findInput.select();
  updateFindStatus();
}
function hideFind() { findbar.hidden = true; findStatus.textContent = ''; editor.focus(); }

function allMatches() {
  const q = findInput.value;
  if (!q) return [];
  const hay = editor.value.toLowerCase(), needle = q.toLowerCase();
  const out = [];
  let i = 0;
  while ((i = hay.indexOf(needle, i)) >= 0) { out.push(i); i += needle.length; }
  return out;
}
function updateFindStatus(current) {
  const m = allMatches();
  if (!findInput.value) { findStatus.textContent = ''; return; }
  if (!m.length) { findStatus.textContent = 'Not found'; return; }
  const idx = current === undefined ? m.findIndex((p) => p >= editor.selectionStart) : current;
  findStatus.textContent = `${idx >= 0 ? idx + 1 : '–'} of ${m.length}`;
}
function findStep(dir) {
  const m = allMatches();
  if (!m.length) { updateFindStatus(); return false; }
  const q = findInput.value.length;
  let idx;
  if (dir > 0) { idx = m.findIndex((p) => p >= editor.selectionEnd); if (idx < 0) idx = 0; }
  else { idx = m.length - 1; for (let i = m.length - 1; i >= 0; i--) if (m[i] < editor.selectionStart) { idx = i; break; } }
  editor.setSelectionRange(m[idx], m[idx] + q);
  scrollEditorTo(m[idx]);
  updateFindStatus(idx);
  return true;
}
function replaceOne() {
  const q = findInput.value;
  if (!q) return;
  const [text, s, e] = sel();
  if (text.slice(s, e).toLowerCase() === q.toLowerCase()) {
    applyEdit(T.insertInline(text, s, e, replaceInput.value.replace(/⌶/g, '')));
    editor.setSelectionRange(s, s + replaceInput.value.length);
  }
  findStep(1);
  findInput.focus();
}
function replaceAll() {
  const q = findInput.value;
  if (!q) return;
  const re = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
  const n = (editor.value.match(re) || []).length;
  if (!n) { updateFindStatus(); return; }
  applyEdit({ text: editor.value.replace(re, () => replaceInput.value), start: 0, end: 0 });
  findStatus.textContent = `Replaced ${n}`;
  findInput.focus();
}
$('find-next').addEventListener('click', () => findStep(1));
$('find-prev').addEventListener('click', () => findStep(-1));
$('find-close').addEventListener('click', hideFind);
$('replace-one').addEventListener('click', replaceOne);
$('replace-all').addEventListener('click', replaceAll);
findInput.addEventListener('input', () => updateFindStatus());
findInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); findStep(e.shiftKey ? -1 : 1); findInput.focus(); }
  if (e.key === 'Escape') hideFind();
});
replaceInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); replaceOne(); replaceInput.focus(); }
  if (e.key === 'Escape') hideFind();
});

// ---------- export payloads ----------
function previewCss() {
  return [...document.styleSheets]
    .filter((s) => s.href && /preview\.css$/.test(s.href))
    .map((s) => [...s.cssRules].map((r) => r.cssText).join('\n')).join('\n');
}
function katexCssHref() {
  return [...document.querySelectorAll('link[rel=stylesheet]')].map((l) => l.href).find((h) => /katex/.test(h));
}
function docTitle() {
  return (lastHeadings[0] && lastHeadings[0].text) || (doc.path ? doc.path.split(/[\\/]/).pop().replace(/\.[^.]+$/, '') : 'Document');
}

// mode 'print': for PDF/PNG/printer, KaTeX HTML with its stylesheet on disk, light colours.
// mode 'standalone': self-contained web page, maths as MathML (no external files needed).
function exportHtml(mode = 'print') {
  const standalone = mode === 'standalone';
  const box = document.createElement('div');
  box.innerHTML = toHtml(editor.value, { mathOutput: standalone ? 'mathml' : 'html' }).html;
  fixImagePaths(box);
  const head = standalone
    ? `<style>${previewCss()}\nbody{margin:0;padding:32px 40px;max-width:860px;margin:0 auto;background:#fff}</style>`
    : `<link rel="stylesheet" href="${katexCssHref()}"><style>${previewCss()}\nbody{margin:0;background:#fff}</style>`;
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(docTitle())}</title>${head}</head>
<body><article class="markdown-body">${box.innerHTML}</article></body></html>`;
}
window.__exportHtml = exportHtml;
window.__docState = () => ({ text: editor.value, docPath: doc.path });

// Clipboard HTML for Word and Outlook: inline the styles they understand.
function clipboardHtml() {
  const box = document.createElement('div');
  box.innerHTML = toHtml(editor.value, { mathOutput: 'mathml' }).html;
  fixImagePaths(box);
  box.querySelectorAll('nav.toc').forEach((n) => n.remove());
  const inline = (selector, style) => box.querySelectorAll(selector).forEach((el) => el.setAttribute('style', style));
  inline('table', 'border-collapse:collapse;margin:0 0 12pt');
  inline('th', 'border:1px solid #999;padding:3pt 8pt;background:#eee;font-weight:bold;vertical-align:top');
  inline('td', 'border:1px solid #999;padding:3pt 8pt;vertical-align:top');
  inline('code', 'font-family:Consolas,monospace;font-size:10pt;background:#f3f3f3');
  inline('pre', 'font-family:Consolas,monospace;font-size:10pt;background:#f6f6f6;border:1px solid #ddd;padding:8pt');
  inline('blockquote', 'border-left:3pt solid #ccc;padding-left:10pt;color:#555;margin-left:0');
  return `<html><body style="font-family:Calibri,'Segoe UI',sans-serif;font-size:11pt">${box.innerHTML}</body></html>`;
}

async function withResult(promise) {
  const out = await promise;
  if (out) window.api.showInFolder(out);
}

// ---------- overlays: cheat sheet, word count ----------
const overlay = $('overlay');
function showOverlay(title, html) { $('overlay-title').textContent = title; $('overlay-body').innerHTML = html; overlay.hidden = false; }
$('overlay-close').addEventListener('click', () => { overlay.hidden = true; });
overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.hidden = true; });

const CHEATSHEET = `
# Heading 1
## Heading 2
### Heading 3

Plain paragraph. *Italic*, **bold**, ~~struck~~, \`inline code\`, [a link](https://example.com).

- Bullet list
- Another item
  - Nested item

1. Numbered list
2. Second item

- [ ] Task to do
- [x] Task done

> A quoted paragraph.

| Column A | Column B |
|----------|----------|
| cell     | cell     |

\`\`\`
A block of code, kept verbatim.
\`\`\`

Inline formula $E = mc^2$ and a displayed one:

$$\\int_0^1 x^2 \\, dx = \\tfrac{1}{3}$$

Prices stay text: $5, $10 and $2 billion. Force a literal dollar with \\$.

\`![caption](picture.png)\` shows an image saved next to the document; \`[TOC]\` on its own line inserts a table of contents.

---
A horizontal rule above. Two spaces at the end of a line
force a line break.
`;

function showCounts() {
  const c = T.counts(editor.value);
  showOverlay('Word count', `<table>
<tr><th>Words</th><td>${c.words}</td></tr>
<tr><th>Characters</th><td>${c.chars}</td></tr>
<tr><th>Characters (no spaces)</th><td>${c.charsNoSpaces}</td></tr>
<tr><th>Lines</th><td>${c.lines}</td></tr>
<tr><th>Headings</th><td>${lastHeadings.length}</td></tr>
<tr><th>Reading time</th><td>about ${c.minutes} min</td></tr>
</table>`);
}
$('status-words').addEventListener('click', showCounts);

// ---------- commands (toolbar + menu) ----------
const NOT_FOR_CODE = new Set(['print', 'exportPdf', 'exportPng', 'exportHtml', 'exportDocx', 'copyHtml', 'insertImageFile',
  'format', 'heading', 'prefix', 'insert', 'layout', 'wysiwyg', 'cheatsheet', 'replace']);

const commands = {
  new: newDocument,
  open: () => window.api.openDialog(),
  save,
  saveAs,
  formatJson,
  print: () => window.api.print({ html: exportHtml('print') }),
  exportPdf: () => withResult(window.api.exportPdf({ html: exportHtml('print'), docPath: doc.path })),
  exportPng: () => withResult(window.api.exportPng({ html: exportHtml('print'), docPath: doc.path })),
  exportHtml: () => withResult(window.api.exportHtml({ html: exportHtml('standalone'), docPath: doc.path })),
  exportDocx: () => withResult(window.api.exportDocx({ text: editor.value, docPath: doc.path })),
  copyHtml: async () => {
    await window.api.copyHtml({ html: clipboardHtml(), text: editor.value });
    findStatus.textContent = '';
    flashStatus('Copied as HTML');
  },
  find: () => (code ? code.find() : showFind(false)),
  replace: () => showFind(true),
  insertImageFile: insertImageFromFile,
  format,
  heading: (n) => (wys ? wys.command('heading', n) : applyEdit(T.setHeading(...sel(), Number(n)))),
  prefix: (kind) => (wys ? wys.command(kind) : applyEdit(T.toggleLinePrefix(...sel(), kind))),
  wysiwyg: toggleWysiwyg,
  insert: insertBlock,
  layout: setLayout,
  focus: () => toggleFocus(),
  editorFont: (delta) => { applyEditorFont(Math.min(32, Math.max(9, settings.editorFontSize + Number(delta)))); window.api.setSetting('editorFontSize', settings.editorFontSize); },
  counts: showCounts,
  cheatsheet: () => showOverlay('Markdown cheat sheet', toHtml(CHEATSHEET).html),
};
function flashStatus(msg) {
  const el = $('status-dirty');
  const prev = el.textContent;
  el.textContent = msg;
  setTimeout(() => { if (el.textContent === msg) el.textContent = prev; refreshStatus(); }, 1500);
}
function runCommand(name, arg) {
  if (!commands[name]) return;
  if (code && NOT_FOR_CODE.has(name)) return flashStatus('Not available for code files');
  commands[name](arg);
}
for (const b of document.querySelectorAll('[data-cmd]')) {
  b.addEventListener('mousedown', (e) => e.preventDefault()); // keep the editor selection
  b.addEventListener('click', () => runCommand(b.dataset.cmd, b.dataset.arg));
}
window.api.on('cmd', runCommand);

window.api.on('file:opened', ({ path, text }) => {
  if (isDirty() && !confirm('Discard unsaved changes?')) return;
  loadDocument(path, text);
});

window.api.on('setting', (key, value) => {
  settings[key] = value;
  if (key === 'theme') applyTheme(value);
  if (key === 'outline') setOutline(value);
  if (key === 'autosave') { refreshStatus(); scheduleAutosave(); }
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (!findbar.hidden) hideFind();
    else if (!overlay.hidden) overlay.hidden = true;
    else if (document.body.classList.contains('focus')) toggleFocus(false);
  }
});

// ---------- smoke-test hooks (used by main.js when TWOEASY_SMOKE is set) ----------
window.__smokeChecks = () => {
  const price = [...preview.querySelectorAll('p')].find((p) => p.textContent.startsWith('Prices'));
  return {
    toc: !!preview.querySelector('nav.toc'),
    headings: lastHeadings.length,
    tasks: preview.querySelectorAll('li.task-item').length,
    mathInPrices: price ? price.querySelectorAll('.katex').length : -1,
    priceText: price ? price.textContent : null,
    images: [...preview.querySelectorAll('img')].map((i) => i.src + ':' + (i.naturalWidth > 0)),
    outlineItems: outlineList.querySelectorAll('.outline-item').length,
    theme: document.body.dataset.theme,
    dirty: isDirty(),
  };
};

window.__smokeCode = () => {
  if (!code) return { mode: 'markdown' };
  const out = { mode: 'code', language: codeLanguage, lint: statusLint.textContent, chars: editor.value.length, cmPresent: !!document.querySelector('#code-editor .cm-editor'), cmHeight: $('code-editor').clientHeight, dirty: isDirty() };
  if (codeLanguage === 'json') { out.formatError = code.format(); out.formattedLines = editor.value.split('\n').length; }
  return out;
};
window.__smokeDark = () => { applyTheme('dark'); setOutline(true); showFind(true); };
window.__smokeWysiwyg = async () => {
  hideFind(); applyTheme('light');
  const original = editor.value;
  await enterWysiwyg();
  await new Promise((r) => setTimeout(r, 800));
  const out = { active: !!wys, hasEditor: !!document.querySelector('#wysiwyg .ProseMirror') };
  const md = wys ? fromWysiwyg(wys.getMarkdown()) : '';
  out.tocKept = md.includes('\n[TOC]\n');
  out.altKept = md.includes('![A test picture](sample.assets/pic.png)');
  out.pricesKept = /Prices: \$5 and \$10, between \$3\.50 and \$4, or \$100 million vs \$2 billion\./.test(md);
  out.escapedKept = md.includes('Escaped: \\$x\\$.');
  out.mathKept = md.includes('$e^{i\\pi} + 1 = 0$') && /\$\$\s*\\int_0\^1 x\^2 \\, dx = \\frac\{1\}\{3\}\s*\$\$/.test(md);
  out.tableKept = md.includes('| Japan');
  out.imageKept = md.includes('sample.assets/pic.png');
  out.sourceUnchanged = editor.value === original;
  out.changedChars = [...md].filter((c, i) => c !== original[i]).length;
  out.roundTrip = md;
  return out;
};
window.__smokeEdits = () => {
  const out = {};
  const original = editor.value;
  editor.setSelectionRange(2, 11); // "TwoEasy" in the title
  commands.format('bold'); out.bold = editor.value.startsWith('# **TwoEasy** test');
  commands.format('bold'); out.unbold = editor.value === original;
  editor.setSelectionRange(2, 2);
  commands.heading(3); out.h3 = editor.value.startsWith('### TwoEasy');
  document.execCommand('undo'); out.undo = editor.value === original;
  commands.prefix('bullet'); out.bullet = editor.value.startsWith('- # TwoEasy');
  document.execCommand('undo');
  editor.setSelectionRange(original.length, original.length);
  commands.insert('table'); out.table = /\| Column 1 \|/.test(editor.value);
  findInput.value = 'item'; replaceInput.value = 'thing'; replaceAll(); out.replaced = (editor.value.match(/thing/g) || []).length;
  loadDocument(doc.path, original, doc.eol);
  return out;
};

// ---------- start ----------
(async () => {
  settings = { ...settings, ...(await window.api.getSettings()) };
  applyTheme(settings.theme);
  applyEditorFont(settings.editorFontSize);
  setLayout(settings.layout, false);
  setOutline(settings.outline);
  // A file opened from the command line may already have arrived while settings were loading.
  if (!doc.path) loadDocument(null, editor.value, doc.eol); else { render(); refreshStatus(); }
})();
