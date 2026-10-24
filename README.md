# TwoEasy

A minimal Markdown editor for Windows: source on the left, live preview on the right.
Built with Electron. No accounts, no licence, no cloud.

## Install

Download **`TwoEasy-Setup-<version>.exe`** from the [latest release](https://github.com/andreagerali/TwoEasy/releases/latest) and run it.
Windows SmartScreen warns because the installer is not code-signed: click *More info*, then *Run anyway*.
Per-user install, no admin rights needed. To update, run the newer installer over the old one.

From PowerShell (also for scripts and agents; installs or updates to the latest release):

```
irm https://raw.githubusercontent.com/andreagerali/TwoEasy/main/install.ps1 | iex
```

Downloaded as a file, `.\install.ps1 -Silent` skips the installer wizard.

## Features

**Writing**
- Split view (editor / preview / both), draggable divider, synchronised scrolling
- Formatting shortcuts: Ctrl+B bold, Ctrl+I italic, Ctrl+K link, Ctrl+Shift+X strike, Ctrl+Shift+` code, Ctrl+M inline formula
- Paragraph menu: headings Ctrl+1…6 (Ctrl+0 plain), bullet / numbered / task lists, quote, table (Ctrl+T), code block, formula block, rule, `[TOC]`
- Find (Ctrl+F) and Find & Replace (Ctrl+H)
- Images: paste from the clipboard, drag a file in, or Edit → Insert image. Files are copied to `<document>.assets/` next to the document
- Tab / Shift+Tab indent the selected lines; spell-check underline

**Document**
- Open, Save, Save As, Open Recent (last 10), reopen last file at start (File menu, switchable)
- Save automatically (File menu): saves 2 s after the last change
- Outline panel (Ctrl+Shift+O): click a heading to jump there
- Word count: click the counter in the status bar

**Output**
- Print… (Ctrl+P) sends the preview to any Windows printer, including PDF printers
- Export as PDF (A4), Word (`.docx`, with real Office Math equations), HTML (self-contained page), PNG
- Copy as HTML (Ctrl+Shift+C): paste into Outlook or Word keeping headings, lists and tables

**Rendering**
- Tables, task lists, fenced code, links (open in the system browser)
- Maths with `$…$` and `$$…$$` (KaTeX in the preview and PDF; Office Math in Word).
  Dollar amounts stay text: `$5 and $10`, `$3.50`, `$2 billion`. Rules in `src/math.js`; `\$` forces a literal dollar
- `[TOC]` on its own line becomes a table of contents (preview, PDF, HTML, Word)

**WYSIWYG**
- View → Edit the preview (Ctrl+E, or the "Edit preview" button): the right pane becomes a rich-text
  editor (Milkdown Crepe) with its own toolbar, slash menu (`/`) for blocks, tables, images and formulas.
  The source pane follows every change but is read-only meanwhile; press Ctrl+E again to go back.
  With layout "Preview only" this is a pure WYSIWYG editor.
- The Markdown is regenerated from the editor, so hand formatting is normalised (`-` bullets, `*` emphasis,
  aligned tables). Known limit: a deliberately escaped `\$x\$` comes back as `$x$`.

**JSON, YAML and code files**
- Opening a `.json`, `.yaml` or `.yml` file switches to a code editor (CodeMirror): line numbers, syntax colours,
  bracket matching, folding, search (Ctrl+F), errors marked in the gutter and in the status bar.
- Same editor for Python, JavaScript/TypeScript, HTML, CSS, XML, SQL, shell, PowerShell, TOML, INI/env.
  Syntax errors are flagged for JSON, YAML, Python, JavaScript/TypeScript, CSS and XML.
- Any other text file (`.gitignore`, `Dockerfile`, `.log`...) opens as plain text; if it is valid JSON it is shown as JSON.
  Binary files (images, `.exe`, `.docx`) are refused with "File not supported".
- Edit → Format JSON (Ctrl+Shift+F) pretty-prints a JSON file. Save As with another extension switches mode.
- No preview, export or Markdown tools in this mode.

**View**
- Light / dark theme, editor text size (Ctrl+Alt+= / Ctrl+Alt+-), focus mode (F8), always on top, zoom, full screen

Each double-click or "Open with" opens a new window, so several documents can be open at once.

Settings live in `%APPDATA%\TwoEasy\settings.json`.

## Develop

```
npm install
npm start                     # run from source
npm start -- path\to\file.md  # open a file at launch
```

Smoke test without dialogs (writes screenshots, `out.pdf`, `out.docx`, `out.html`, `out.png` into the folder
and prints the result of a few editing commands):

```
$env:TWOEASY_SMOKE = "$PWD\test\out"; npm start -- test\sample.md
```

Pure text helpers have Node tests: see `src/textops.js` (run the asserts in the README history or write your own).

Unit tests for the pure modules: `node test\unit.js`.

## Build the installer

```
python build\make-icon.py   # only if build\icon.ico is missing
npm run build:ui            # bundles the WYSIWYG editor into src\vendor (also run by `npm run dist`)
npm run dist
```

Output: `dist\TwoEasy Setup <version>.exe` (NSIS, per-user install, no admin needed).

Release: bump `version` in `package.json`, build, then publish a release tagged `v<version>` with the installer
renamed to `TwoEasy-Setup-<version>.exe` (`install.ps1` looks for that name):

```
gh release create v<version> "dist\TwoEasy Setup <version>.exe#TwoEasy-Setup-<version>.exe" --title "TwoEasy <version>" --notes "..."
```
The installer is not code-signed: Windows SmartScreen will show a warning on first run.

## Layout

| File | Role |
|---|---|
| `main.js` | main process: window, menus, settings, dialogs, print, PDF/PNG/HTML/Word export |
| `preload.js` | the small bridge the page uses to talk to the main process |
| `src/index.html`, `src/style.css` | application shell (light and dark variables) |
| `src/preview.css` | styles of the rendered document (also embedded in exports) |
| `src/renderer.js` | editor, Markdown + maths rendering, outline, find/replace, images, export payloads |
| `src/math.js` | which `$` are maths (shared by preview and Word export) |
| `src/textops.js` | pure text helpers: wrap, headings, prefixes, insert, counts |
| `src/docx-export.js` | Markdown → Word via the `docx` library; TeX → MathML → Office Math |
| `src/wysiwyg-entry.js` | wrapper around Milkdown Crepe, bundled by esbuild into `src/vendor/` |
| `src/code-entry.js` | CodeMirror setup for JSON, YAML and code files, bundled by esbuild into `src/vendor/` |

`node_modules/` and `dist/` are marked as ignored for Dropbox. `src/vendor/` is generated by `npm run build:ui` and is not in git.
