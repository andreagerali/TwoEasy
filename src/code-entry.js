// Code editor (CodeMirror 6) for JSON, YAML and common script/code files, wrapped in a small API for renderer.js.
// Bundled by esbuild into src/vendor/code.js; do not load it directly.
import { EditorState, Compartment } from '@codemirror/state';
import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter, drawSelection } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { syntaxHighlighting, defaultHighlightStyle, bracketMatching, foldGutter, indentOnInput, syntaxTree } from '@codemirror/language';
import { closeBrackets } from '@codemirror/autocomplete';
import { searchKeymap, highlightSelectionMatches, openSearchPanel } from '@codemirror/search';
import { linter, lintGutter } from '@codemirror/lint';
import { json } from '@codemirror/lang-json';
import { yaml } from '@codemirror/lang-yaml';
import { python } from '@codemirror/lang-python';
import { javascript } from '@codemirror/lang-javascript';
import { html } from '@codemirror/lang-html';
import { css } from '@codemirror/lang-css';
import { sql } from '@codemirror/lang-sql';
import { xml } from '@codemirror/lang-xml';
import { StreamLanguage } from '@codemirror/language';
import { shell } from '@codemirror/legacy-modes/mode/shell';
import { powerShell } from '@codemirror/legacy-modes/mode/powershell';
import { toml } from '@codemirror/legacy-modes/mode/toml';
import { properties } from '@codemirror/legacy-modes/mode/properties';
import { oneDark } from '@codemirror/theme-one-dark';

// key = canonical file extension. lint: parser errors are reliable enough to show (not for HTML/SQL/legacy modes).
const LANGS = {
  json: { label: 'JSON', lint: true, make: () => json() },
  yaml: { label: 'YAML', lint: true, make: () => yaml() },
  py: { label: 'Python', lint: true, make: () => python() },
  js: { label: 'JavaScript', lint: true, make: () => javascript({ jsx: true }) },
  ts: { label: 'TypeScript', lint: true, make: () => javascript({ typescript: true, jsx: true }) },
  css: { label: 'CSS', lint: true, make: () => css() },
  xml: { label: 'XML', lint: true, make: () => xml() },
  html: { label: 'HTML', lint: false, make: () => html() },
  sql: { label: 'SQL', lint: false, make: () => sql() },
  sh: { label: 'Shell', lint: false, make: () => StreamLanguage.define(shell) },
  ps1: { label: 'PowerShell', lint: false, make: () => StreamLanguage.define(powerShell) },
  toml: { label: 'TOML', lint: false, make: () => StreamLanguage.define(toml) },
  text: { label: 'Plain text', lint: false, make: () => [] },
  ini: { label: 'INI / env', lint: false, make: () => StreamLanguage.define(properties) },
};
const EXT_ALIASES = {
  yml: 'yaml', pyw: 'py', mjs: 'js', cjs: 'js', jsx: 'js', tsx: 'ts', htm: 'html', svg: 'xml', xsl: 'xml', xsd: 'xml',
  bash: 'sh', zsh: 'sh', psm1: 'ps1', psd1: 'ps1', env: 'ini', properties: 'ini', cfg: 'ini', conf: 'ini',
};
function languageForExt(ext) {
  ext = (ext || '').toLowerCase();
  const key = EXT_ALIASES[ext] || ext;
  return LANGS[key] ? key : null;
}

// Syntax errors from the parser, plus JSON.parse's own message for JSON.
function makeLinter(language, onStatus) {
  return linter((view) => {
    const diagnostics = [];
    const text = view.state.doc.toString();
    if (language === 'json') {
      if (text.trim()) {
        try { JSON.parse(text); }
        catch (e) {
          let from = 0;
          const m = /position (\d+)/.exec(e.message);
          const lc = /line (\d+) column (\d+)/.exec(e.message);
          if (m) from = Math.min(+m[1], text.length);
          else if (lc) from = Math.min(view.state.doc.line(+lc[1]).from + (+lc[2]) - 1, text.length);
          diagnostics.push({ from, to: Math.min(from + 1, text.length), severity: 'error', message: e.message });
        }
      }
    } else {
      syntaxTree(view.state).iterate({
        enter: (node) => {
          if (node.type.isError) diagnostics.push({ from: node.from, to: Math.max(node.to, node.from + 1), severity: 'error', message: 'Syntax error' });
        },
      });
    }
    onStatus(diagnostics.length ? { ok: false, line: view.state.doc.lineAt(diagnostics[0].from).number, message: diagnostics[0].message } : { ok: true });
    return diagnostics;
  }, { delay: 300 });
}

const baseTheme = EditorView.theme({
  '&': { height: '100%', fontSize: 'var(--editor-font-size, 14px)' },
  '.cm-scroller': { fontFamily: 'var(--font-mono)', lineHeight: '1.6', padding: '12px 0' },
  '.cm-content': { padding: '8px 0' },
});

function create({ root, text, language, dark, onChange, onStatus }) {
  if (!LANGS[language].lint) onStatus({ ok: true });
  const themeComp = new Compartment();
  const state = EditorState.create({
    doc: text,
    extensions: [
      lineNumbers(), highlightActiveLineGutter(), highlightActiveLine(), drawSelection(), foldGutter(),
      history(), bracketMatching(), closeBrackets(), indentOnInput(), highlightSelectionMatches(), lintGutter(),
      keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap, indentWithTab]),
      syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
      LANGS[language].make(),
      LANGS[language].lint ? makeLinter(language, onStatus) : [],
      baseTheme,
      themeComp.of(dark ? oneDark : []),
      EditorView.updateListener.of((u) => { if (u.docChanged) onChange(u.state.doc.toString()); }),
    ],
  });
  const view = new EditorView({ state, parent: root });

  return {
    getText: () => view.state.doc.toString(),
    setText: (t) => view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: t } }),
    setDark: (d) => view.dispatch({ effects: themeComp.reconfigure(d ? oneDark : []) }),
    focus: () => view.focus(),
    find: () => openSearchPanel(view),
    scrollToLine: (n) => {
      const line = view.state.doc.line(Math.min(Math.max(1, n), view.state.doc.lines));
      view.dispatch({ selection: { anchor: line.from }, effects: EditorView.scrollIntoView(line.from, { y: 'center' }) });
      view.focus();
    },
    // JSON only: pretty-print. Returns an error message, or null.
    format: () => {
      try {
        const pretty = JSON.stringify(JSON.parse(view.state.doc.toString()), null, 2) + '\n';
        view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: pretty } });
        return null;
      } catch (e) { return e.message; }
    },
    destroy: () => view.destroy(),
  };
}

// Content check for files with an unknown extension: whole file is valid JSON -> 'json'.
function sniff(text) {
  const t = (text || '').trim();
  if (!/^[{[]/.test(t)) return null;
  try { JSON.parse(t); return 'json'; } catch { return null; }
}

const extensions = [...Object.keys(LANGS), ...Object.keys(EXT_ALIASES)];
window.TwoEasyCode = { create, languageForExt, sniff, label: (k) => LANGS[k].label, lints: (k) => LANGS[k].lint, extensions };
