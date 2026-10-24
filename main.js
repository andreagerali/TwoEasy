'use strict';
// Main process: window, menus, settings, file dialogs, printing and export.
const { app, BrowserWindow, Menu, dialog, ipcMain, shell, clipboard, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs/promises');

let win = null;
let pendingFile = null; // file passed on the command line (double-click on a .md)

// ---------- settings (userData/settings.json) ----------

const SETTINGS_FILE = () => path.join(app.getPath('userData'), 'settings.json');
const DEFAULTS = {
  theme: 'light', editorFontSize: 14, syncScroll: true, autosave: false, layout: 'split',
  outline: false, recent: [], lastFile: null, reopenLast: true,
};
let settings = { ...DEFAULTS };

async function loadSettings() {
  try { settings = { ...DEFAULTS, ...JSON.parse(await fs.readFile(SETTINGS_FILE(), 'utf8')) }; }
  catch (e) { settings = { ...DEFAULTS }; }
}
let saveTimer = null;
function saveSettings() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => fs.writeFile(SETTINGS_FILE(), JSON.stringify(settings, null, 2)).catch(() => {}), 200);
}
function setSetting(key, value) {
  settings[key] = value;
  saveSettings();
}
function addRecent(filePath) {
  settings.recent = [filePath, ...settings.recent.filter((p) => p !== filePath)].slice(0, 10);
  settings.lastFile = filePath;
  saveSettings();
  buildMenu();
}

// ---------- window ----------

// Extensions opened in the code editor (keep in step with LANGS/EXT_ALIASES in src/code-entry.js).
const CODE_EXTS = ['json', 'yaml', 'yml', 'py', 'pyw', 'js', 'mjs', 'cjs', 'jsx', 'ts', 'tsx', 'css', 'xml', 'svg', 'html', 'htm',
  'sql', 'sh', 'bash', 'zsh', 'ps1', 'psm1', 'psd1', 'toml', 'ini', 'env', 'properties', 'cfg', 'conf'];
const TEXT_EXTS = ['md', 'markdown', 'txt'];

// Any existing file passed on the command line is opened (unknown types as plain text).
function fileFromArgv(argv) {
  const candidates = argv.slice(app.isPackaged ? 1 : 2).filter((a) => !a.startsWith('-'));
  const f = candidates.find((a) => { try { return require('fs').statSync(a).isFile(); } catch { return false; } });
  return f ? path.resolve(f) : null;
}

function createWindow() {
  win = new BrowserWindow({
    width: 1300, height: 850, minWidth: 700, minHeight: 400,
    title: 'TwoEasy',
    backgroundColor: settings.theme === 'dark' ? '#1e1e1e' : '#fafafa',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, nodeIntegration: false, spellcheck: true,
    },
  });

  win.loadFile(path.join(__dirname, 'src', 'index.html'));

  win.webContents.on('did-finish-load', async () => {
    const toOpen = pendingFile || (settings.reopenLast && settings.lastFile && await exists(settings.lastFile) ? settings.lastFile : null);
    pendingFile = null;
    if (toOpen) openPath(toOpen);
    if (process.env.TWOEASY_SMOKE) {
      runSmokeTest(process.env.TWOEASY_SMOKE).catch((err) => { console.error('SMOKE FAILED', err); app.exit(1); });
    }
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  win.on('close', async (e) => {
    if (win.forceClose) return;
    e.preventDefault();
    const dirty = await win.webContents.executeJavaScript('window.__isDirty && window.__isDirty()');
    if (!dirty) { win.forceClose = true; win.close(); return; }
    const { response } = await dialog.showMessageBox(win, {
      type: 'question', buttons: ['Save', "Don't save", 'Cancel'], defaultId: 0, cancelId: 2,
      message: 'Save changes before closing?',
    });
    if (response === 2) return;
    if (response === 0) {
      const saved = await win.webContents.executeJavaScript('window.__saveForClose()');
      if (!saved) return;
    }
    win.forceClose = true;
    win.close();
  });

  win.on('closed', () => { win = null; });
}

async function exists(p) { try { await fs.access(p); return true; } catch (e) { return false; } }

function send(channel, ...args) { if (win) win.webContents.send(channel, ...args); }

async function openPath(filePath) {
  try {
    const buf = await fs.readFile(filePath);
    // Binary file (image, exe, docx...) = a NUL byte in the first 8 KB. Text that is not UTF-8
    // (old ANSI files) is read as Windows-1252 and saved back as UTF-8.
    let text = null;
    if (!buf.subarray(0, 8192).includes(0)) {
      try { text = new TextDecoder('utf-8', { fatal: true }).decode(buf); }
      catch (e) { text = new TextDecoder('windows-1252').decode(buf); }
    }
    if (text === null) {
      dialog.showMessageBox(win, { type: 'info', title: 'TwoEasy', message: 'File not supported',
        detail: `${path.basename(filePath)} is not a text file, so TwoEasy cannot show it.` });
      return;
    }
    send('file:opened', { path: filePath, text });
    addRecent(filePath);
  } catch (err) {
    dialog.showErrorBox('Cannot open file', `${filePath}\n\n${err.message}`);
    settings.recent = settings.recent.filter((p) => p !== filePath);
    if (settings.lastFile === filePath) settings.lastFile = null;
    saveSettings();
    buildMenu();
  }
}

async function openDialog() {
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    properties: ['openFile'],
    filters: [
      { name: 'Markdown and code files', extensions: [...TEXT_EXTS, ...CODE_EXTS] },
      { name: 'Markdown', extensions: TEXT_EXTS },
      { name: 'JSON', extensions: ['json'] },
      { name: 'YAML', extensions: ['yaml', 'yml'] },
      { name: 'Python', extensions: ['py', 'pyw'] },
      { name: 'JavaScript / TypeScript', extensions: ['js', 'mjs', 'cjs', 'jsx', 'ts', 'tsx'] },
      { name: 'HTML / CSS / XML', extensions: ['html', 'htm', 'css', 'xml', 'svg'] },
      { name: 'Scripts (shell, PowerShell, SQL)', extensions: ['sh', 'bash', 'zsh', 'ps1', 'psm1', 'sql'] },
      { name: 'Config (TOML, INI, env)', extensions: ['toml', 'ini', 'env', 'properties', 'cfg', 'conf'] },
      { name: 'All files', extensions: ['*'] },
    ],
  });
  if (!canceled && filePaths[0]) openPath(filePaths[0]);
}

const SAVE_FILTERS = {
  md: [{ name: 'Markdown', extensions: ['md'] }],
  json: [{ name: 'JSON', extensions: ['json'] }],
  yaml: [{ name: 'YAML', extensions: ['yaml', 'yml'] }],
};
const saveFiltersFor = (ext) => SAVE_FILTERS[ext] || (ext === 'txt' ? [{ name: 'Text', extensions: ['txt'] }] : null) || (CODE_EXTS.includes(ext) ? [{ name: ext.toUpperCase(), extensions: [ext] }] : SAVE_FILTERS.md);

// ---------- menu ----------

function buildMenu() {
  const cmd = (name, arg) => () => send('cmd', name, arg);
  const recentItems = settings.recent.length
    ? [...settings.recent.map((p) => ({ label: p, click: () => openPath(p) })),
       { type: 'separator' },
       { label: 'Clear list', click: () => { settings.recent = []; saveSettings(); buildMenu(); } }]
    : [{ label: '(empty)', enabled: false }];

  const template = [
    { label: '&File', submenu: [
      { label: 'New', accelerator: 'CmdOrCtrl+N', click: cmd('new') },
      { label: 'Open…', accelerator: 'CmdOrCtrl+O', click: openDialog },
      { label: 'Open Recent', submenu: recentItems },
      { type: 'separator' },
      { label: 'Save', accelerator: 'CmdOrCtrl+S', click: cmd('save') },
      { label: 'Save As…', accelerator: 'CmdOrCtrl+Shift+S', click: cmd('saveAs') },
      { label: 'Save automatically', type: 'checkbox', checked: settings.autosave, click: (i) => { setSetting('autosave', i.checked); send('setting', 'autosave', i.checked); } },
      { label: 'Reopen last file at start', type: 'checkbox', checked: settings.reopenLast, click: (i) => setSetting('reopenLast', i.checked) },
      { type: 'separator' },
      { label: 'Print…', accelerator: 'CmdOrCtrl+P', click: cmd('print') },
      { type: 'separator' },
      { label: 'Export as PDF…', accelerator: 'CmdOrCtrl+Shift+E', click: cmd('exportPdf') },
      { label: 'Export as Word…', click: cmd('exportDocx') },
      { label: 'Export as HTML…', click: cmd('exportHtml') },
      { label: 'Export as Image (PNG)…', click: cmd('exportPng') },
      { type: 'separator' },
      { role: 'quit', label: 'Exit' },
    ] },
    { label: '&Edit', submenu: [
      { role: 'undo' }, { role: 'redo' }, { type: 'separator' },
      { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' },
      { type: 'separator' },
      { label: 'Copy as HTML', accelerator: 'CmdOrCtrl+Shift+C', click: cmd('copyHtml') },
      { type: 'separator' },
      { label: 'Find…', accelerator: 'CmdOrCtrl+F', click: cmd('find') },
      { label: 'Find and Replace…', accelerator: 'CmdOrCtrl+H', click: cmd('replace') },
      { type: 'separator' },
      { label: 'Format JSON (pretty-print)', accelerator: 'CmdOrCtrl+Shift+F', click: cmd('formatJson') },
      { type: 'separator' },
      { label: 'Insert image from file…', click: cmd('insertImageFile') },
    ] },
    { label: 'F&ormat', submenu: [
      { label: 'Bold', accelerator: 'CmdOrCtrl+B', click: cmd('format', 'bold') },
      { label: 'Italic', accelerator: 'CmdOrCtrl+I', click: cmd('format', 'italic') },
      { label: 'Strikethrough', accelerator: 'CmdOrCtrl+Shift+X', click: cmd('format', 'strike') },
      { label: 'Inline code', accelerator: 'CmdOrCtrl+Shift+`', click: cmd('format', 'code') },
      { label: 'Link', accelerator: 'CmdOrCtrl+K', click: cmd('format', 'link') },
      { label: 'Inline formula', accelerator: 'CmdOrCtrl+M', click: cmd('format', 'math') },
    ] },
    { label: '&Paragraph', submenu: [
      ...[1, 2, 3, 4, 5, 6].map((n) => ({ label: `Heading ${n}`, accelerator: `CmdOrCtrl+${n}`, click: cmd('heading', n) })),
      { label: 'Paragraph', accelerator: 'CmdOrCtrl+0', click: cmd('heading', 0) },
      { type: 'separator' },
      { label: 'Bullet list', accelerator: 'CmdOrCtrl+Shift+]', click: cmd('prefix', 'bullet') },
      { label: 'Numbered list', accelerator: 'CmdOrCtrl+Shift+[', click: cmd('prefix', 'number') },
      { label: 'Task list', click: cmd('prefix', 'task') },
      { label: 'Quote', accelerator: 'CmdOrCtrl+Shift+Q', click: cmd('prefix', 'quote') },
      { type: 'separator' },
      { label: 'Table', accelerator: 'CmdOrCtrl+T', click: cmd('insert', 'table') },
      { label: 'Code block', accelerator: 'CmdOrCtrl+Shift+K', click: cmd('insert', 'code') },
      { label: 'Formula block', accelerator: 'CmdOrCtrl+Shift+M', click: cmd('insert', 'math') },
      { label: 'Horizontal line', click: cmd('insert', 'hr') },
      { label: 'Table of contents', click: cmd('insert', 'toc') },
    ] },
    { label: '&View', submenu: [
      { label: 'Editor only', accelerator: 'CmdOrCtrl+Alt+1', click: cmd('layout', 'editor') },
      { label: 'Split', accelerator: 'CmdOrCtrl+Alt+2', click: cmd('layout', 'split') },
      { label: 'Preview only', accelerator: 'CmdOrCtrl+Alt+3', click: cmd('layout', 'preview') },
      { type: 'separator' },
      { label: 'Edit the preview (WYSIWYG)', accelerator: 'CmdOrCtrl+E', click: cmd('wysiwyg') },
      { type: 'separator' },
      { label: 'Outline', type: 'checkbox', accelerator: 'CmdOrCtrl+Shift+O', checked: settings.outline, click: (i) => { setSetting('outline', i.checked); send('setting', 'outline', i.checked); } },
      { label: 'Focus mode', accelerator: 'F8', click: cmd('focus') },
      { label: 'Synchronised scrolling', type: 'checkbox', checked: settings.syncScroll, click: (i) => { setSetting('syncScroll', i.checked); send('setting', 'syncScroll', i.checked); } },
      { type: 'separator' },
      { label: 'Dark theme', type: 'checkbox', checked: settings.theme === 'dark', click: (i) => { setSetting('theme', i.checked ? 'dark' : 'light'); send('setting', 'theme', settings.theme); } },
      { label: 'Editor text larger', accelerator: 'CmdOrCtrl+Alt+=', click: cmd('editorFont', 1) },
      { label: 'Editor text smaller', accelerator: 'CmdOrCtrl+Alt+-', click: cmd('editorFont', -1) },
      { label: 'Word count…', click: cmd('counts') },
      { type: 'separator' },
      { role: 'zoomIn' }, { role: 'zoomOut' }, { role: 'resetZoom' },
      { type: 'separator' },
      { label: 'Always on top', type: 'checkbox', checked: !!(win && win.isAlwaysOnTop()), click: (i) => win && win.setAlwaysOnTop(i.checked) },
      { role: 'togglefullscreen' },
    ] },
    { label: '&Help', submenu: [
      { label: 'Markdown cheat sheet', click: cmd('cheatsheet') },
      { label: 'About TwoEasy', click: () => dialog.showMessageBox(win, {
          type: 'info', title: 'About TwoEasy', message: `TwoEasy ${app.getVersion()}`,
          detail: 'A minimal Markdown editor.\nSource on the left, preview on the right.\n\nCreated by Andrea Gerali, 2026.',
        }) },
    ] },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ---------- IPC: settings, files ----------

ipcMain.handle('settings:get', () => settings);
ipcMain.handle('settings:set', (_e, key, value) => { setSetting(key, value); if (key === 'layout' || key === 'outline') buildMenu(); });

ipcMain.handle('file:save', async (_e, { path: filePath, text, ext = 'md' }) => {
  let target = filePath;
  if (!target) {
    const { canceled, filePath: chosen } = await dialog.showSaveDialog(win, {
      defaultPath: `untitled.${ext}`, filters: saveFiltersFor(ext),
    });
    if (canceled || !chosen) return null;
    target = chosen;
  }
  await fs.writeFile(target, text, 'utf8');
  addRecent(target);
  return target;
});

ipcMain.handle('file:saveAs', async (_e, { path: filePath, text, ext = 'md' }) => {
  const { canceled, filePath: chosen } = await dialog.showSaveDialog(win, {
    defaultPath: filePath || `untitled.${ext}`, filters: saveFiltersFor(ext),
  });
  if (canceled || !chosen) return null;
  await fs.writeFile(chosen, text, 'utf8');
  addRecent(chosen);
  return chosen;
});

ipcMain.handle('dialog:open', openDialog);

// Saves image bytes (from the clipboard or a dropped file) next to the document, in <name>.assets/.
// Returns the relative path to put in the Markdown.
ipcMain.handle('image:save', async (_e, { docPath, bytes, sourcePath, ext }) => {
  if (!docPath) return null;
  const base = path.basename(docPath).replace(/\.[^.]+$/, '');
  const assetsDir = path.join(path.dirname(docPath), `${base}.assets`);
  await fs.mkdir(assetsDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '-');
  let name;
  if (sourcePath) {
    name = path.basename(sourcePath);
    if (await exists(path.join(assetsDir, name))) name = `${stamp}-${name}`;
    await fs.copyFile(sourcePath, path.join(assetsDir, name));
  } else {
    name = `image-${stamp}.${ext || 'png'}`;
    await fs.writeFile(path.join(assetsDir, name), Buffer.from(bytes));
  }
  return `${base}.assets/${name}`.replace(/ /g, '%20');
});

ipcMain.handle('image:pick', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    properties: ['openFile'],
    filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp'] }],
  });
  return canceled ? null : filePaths[0];
});

ipcMain.handle('clipboard:writeHtml', (_e, { html, text }) => clipboard.write({ html, text }));

// ---------- print and export ----------

function suggestedName(docPath, ext) {
  const base = docPath ? path.basename(docPath).replace(/\.[^.]+$/, '') : 'untitled';
  return path.join(docPath ? path.dirname(docPath) : app.getPath('documents'), `${base}.${ext}`);
}

async function askTarget(docPath, ext, label) {
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    defaultPath: suggestedName(docPath, ext), filters: [{ name: label, extensions: [ext] }],
  });
  return canceled ? null : filePath;
}

// Loads the rendered document into a hidden window (for printing, PDF or PNG). Caller destroys it.
async function loadPrintWindow(html, opts = {}) {
  // A data: URL could not load the KaTeX fonts from disk; a temp file on disk can.
  const tmpHtml = path.join(app.getPath('temp'), `twoeasy-print-${process.pid}-${Date.now()}.html`);
  await fs.writeFile(tmpHtml, html, 'utf8');
  const printWin = new BrowserWindow({ show: false, width: opts.width || 900, height: 800, webPreferences: { offscreen: !!opts.offscreen } });
  printWin.on('closed', () => fs.unlink(tmpHtml).catch(() => {}));
  await printWin.loadFile(tmpHtml);
  await new Promise((r) => setTimeout(r, 300)); // let fonts settle
  return printWin;
}

ipcMain.handle('print', async (_e, { html }) => {
  const printWin = await loadPrintWindow(html);
  return new Promise((resolve) => {
    printWin.webContents.print({ silent: false, printBackground: true }, (ok, reason) => {
      printWin.destroy();
      if (!ok && reason && !/cancel/i.test(reason)) dialog.showErrorBox('Print failed', reason);
      resolve(ok);
    });
  });
});

ipcMain.handle('export:pdf', async (_e, { html, docPath }) => {
  const target = await askTarget(docPath, 'pdf', 'PDF');
  return target ? writePdf(html, target) : null;
});

async function writePdf(html, filePath) {
  const printWin = await loadPrintWindow(html, { offscreen: true });
  try {
    const pdf = await printWin.webContents.printToPDF({
      printBackground: true, pageSize: 'A4', margins: { top: 0.7, bottom: 0.7, left: 0.7, right: 0.7 },
    });
    await fs.writeFile(filePath, pdf);
    return filePath;
  } finally { printWin.destroy(); }
}

ipcMain.handle('export:png', async (_e, { html, docPath }) => {
  const target = await askTarget(docPath, 'png', 'PNG image');
  return target ? writePng(html, target) : null;
});

async function writePng(html, filePath) {
  const printWin = await loadPrintWindow(html, { offscreen: true, width: 900 });
  try {
    const height = await printWin.webContents.executeJavaScript('document.documentElement.scrollHeight');
    printWin.setSize(900, Math.min(Math.max(height + 20, 200), 16000));
    await new Promise((r) => setTimeout(r, 200));
    const image = await printWin.webContents.capturePage();
    await fs.writeFile(filePath, image.toPNG());
    return filePath;
  } finally { printWin.destroy(); }
}

ipcMain.handle('export:html', async (_e, { html, docPath }) => {
  const target = await askTarget(docPath, 'html', 'Web page');
  if (!target) return null;
  await fs.writeFile(target, html, 'utf8');
  return target;
});

ipcMain.handle('export:docx', async (_e, { text, docPath }) => {
  const target = await askTarget(docPath, 'docx', 'Word document');
  if (!target) return null;
  try { return await writeDocx(text, docPath, target); }
  catch (err) { dialog.showErrorBox('Word export failed', err.message); return null; }
});

async function writeDocx(markdownText, docPath, filePath) {
  const { buildDocx } = require('./src/docx-export');
  const buffer = await buildDocx(markdownText, docPath ? path.dirname(docPath) : null);
  await fs.writeFile(filePath, buffer);
  return filePath;
}

// Developer smoke test: TWOEASY_SMOKE=<dir> opens the given file, writes screenshot.png,
// out.pdf, out.docx, out.html, out.png into <dir> and quits. No dialogs.
async function runSmokeTest(outDir) {
  await new Promise((r) => setTimeout(r, 1500));
  await fs.writeFile(path.join(outDir, 'screenshot-pre.png'), (await win.webContents.capturePage()).toPNG());
  const code = await win.webContents.executeJavaScript('window.__smokeCode ? window.__smokeCode() : null');
  if (code && code.mode === 'code') {
    await fs.writeFile(path.join(outDir, `screenshot-${code.language}.png`), (await win.webContents.capturePage()).toPNG());
    console.log('CODE', JSON.stringify(code));
    console.log('SMOKE OK');
    win.forceClose = true;
    app.quit();
    return;
  }
  await fs.writeFile(path.join(outDir, 'screenshot.png'), (await win.webContents.capturePage()).toPNG());
  const pdfHtml = await win.webContents.executeJavaScript('window.__exportHtml("print")');
  await writePdf(pdfHtml, path.join(outDir, 'out.pdf'));
  await writePng(pdfHtml, path.join(outDir, 'out.png'));
  const pageHtml = await win.webContents.executeJavaScript('window.__exportHtml("standalone")');
  await fs.writeFile(path.join(outDir, 'out.html'), pageHtml, 'utf8');
  const { text, docPath } = await win.webContents.executeJavaScript('window.__docState()');
  await writeDocx(text, docPath, path.join(outDir, 'out.docx'));
  const extra = await win.webContents.executeJavaScript('window.__smokeChecks ? window.__smokeChecks() : "no checks"');
  const edits = await win.webContents.executeJavaScript('window.__smokeEdits ? window.__smokeEdits() : null');
  console.log('EDITS', JSON.stringify(edits));
  await win.webContents.executeJavaScript('window.__smokeDark && window.__smokeDark()');
  await new Promise((r) => setTimeout(r, 400));
  await fs.writeFile(path.join(outDir, 'screenshot-dark.png'), (await win.webContents.capturePage()).toPNG());
  const wys = await win.webContents.executeJavaScript('window.__smokeWysiwyg ? window.__smokeWysiwyg() : null');
  await fs.writeFile(path.join(outDir, 'screenshot-wysiwyg.png'), (await win.webContents.capturePage()).toPNG());
  console.log('WYSIWYG', JSON.stringify(wys));
  console.log('SMOKE OK', JSON.stringify(extra));
  win.forceClose = true;
  app.quit();
}

ipcMain.handle('shell:showInFolder', (_e, p) => shell.showItemInFolder(p));
ipcMain.handle('shell:openExternal', (_e, url) => shell.openExternal(url));
ipcMain.handle('window:alwaysOnTop', (_e, on) => { if (win) win.setAlwaysOnTop(on); buildMenu(); });

// ---------- app lifecycle ----------

// No single-instance lock: every launch (double-click on a file, Open with) opens its own window,
// so several documents can be open side by side.
{
  app.whenReady().then(async () => {
    await loadSettings();
    pendingFile = fileFromArgv(process.argv);
    if (process.env.TWOEASY_SMOKE) settings.reopenLast = false;
    buildMenu();
    createWindow();
  });

  app.on('window-all-closed', () => app.quit());
}
