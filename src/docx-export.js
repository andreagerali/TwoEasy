'use strict';
// Word export: Markdown source → .docx, built from the markdown-it token stream with the `docx` library.
// Formulas are written as their TeX source in a monospaced font (Word cannot render KaTeX).
const path = require('path');
const fs = require('fs');
const markdownit = require('markdown-it');
const katex = require('katex');
const {
  Document, Packer, Paragraph, TextRun, ImageRun, ExternalHyperlink, Table, TableRow, TableCell,
  HeadingLevel, AlignmentType, BorderStyle, WidthType, ShadingType, LevelFormat, ImportedXmlComponent,
} = require('docx');
const { replaceMath } = require('./math');

const MONO = 'Consolas';
const CODE_FILL = 'F2F2F2';
const MATH_SLOT = /MATHSLOT(\d+)X/g;

// TeX → MathML (KaTeX) → Office Math (mathml2omml). Returns raw <m:oMath> XML, or null if it fails.
let mml2omml = null;
async function loadMathConverter() {
  if (!mml2omml) mml2omml = (await import('mathml2omml')).mml2omml; // ESM-only package
}
function texToOmml(tex, display) {
  try {
    const html = katex.renderToString(tex, { output: 'mathml', displayMode: display, throwOnError: true });
    let mathml = html.match(/<math[\s\S]*<\/math>/)[0]
      .replace(/<annotation[\s\S]*?<\/annotation>/g, '')
      .replace(/<\/?semantics>/g, '');
    const omml = mml2omml(mathml);
    return omml.replace(/^<m:oMath[^>]*>/, '<m:oMath>').replace(/<\/m:oMath>$/, '</m:oMath>');
  } catch (e) {
    return null;
  }
}
// An <m:oMath> (or <m:oMathPara> for displayed formulas) is a direct child of the paragraph, never of a run.
// fromXmlString returns a nameless wrapper; its first child is the element itself.
function mathComponent(omml, display) {
  const inner = omml.replace(/^<m:oMath>/, '<m:oMath xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math">');
  const xml = display ? `<m:oMathPara xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math">${omml}</m:oMathPara>` : inner;
  return ImportedXmlComponent.fromXmlString(xml).root[0];
}

async function buildDocx(markdownSource, docDir) {
  await loadMathConverter();
  const mathSlots = [];
  const text = replaceMath(markdownSource, (tex, display) => {
    mathSlots.push({ tex, display, omml: texToOmml(tex, display) });
    return `MATHSLOT${mathSlots.length - 1}X`;
  });
  const md = markdownit({ html: false, linkify: true, typographer: true });
  const tokens = md.parse(text, {});
  const headings = [];
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].type === 'heading_open') {
      headings.push({ level: Number(tokens[i].tag.slice(1)), text: tokens[i + 1].content.replace(/MATHSLOT\d+X/g, '').replace(/[*_`~]/g, '') });
    }
  }
  const ctx = { docDir, mathSlots, headings, children: [], listStack: [], quoteDepth: 0 };
  walkBlocks(tokens, 0, tokens.length, ctx);

  const doc = new Document({
    creator: 'TwoEasy',
    styles: {
      default: { document: { run: { font: 'Calibri', size: 22 } } }, // 11 pt
      paragraphStyles: [
        { id: 'Code', name: 'Code', basedOn: 'Normal', run: { font: MONO, size: 19 },
          paragraph: { spacing: { before: 0, after: 0, line: 276 }, shading: { type: ShadingType.CLEAR, fill: CODE_FILL } } },
        { id: 'Quote', name: 'Quote', basedOn: 'Normal', run: { italics: true, color: '555555' },
          paragraph: { indent: { left: 567 }, border: { left: { style: BorderStyle.SINGLE, size: 18, color: 'CCCCCC', space: 8 } } } },
      ],
    },
    numbering: {
      config: [
        { reference: 'bullets', levels: [0, 1, 2, 3].map((lvl) => ({
          level: lvl, format: LevelFormat.BULLET, text: ['•', '◦', '▪', '•'][lvl], alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 720 * (lvl + 1), hanging: 360 } } },
        })) },
        { reference: 'numbers', levels: [0, 1, 2, 3].map((lvl) => ({
          level: lvl, format: [LevelFormat.DECIMAL, LevelFormat.LOWER_LETTER, LevelFormat.LOWER_ROMAN, LevelFormat.DECIMAL][lvl],
          text: `%${lvl + 1}.`, alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 720 * (lvl + 1), hanging: 360 } } },
        })) },
      ],
    },
    sections: [{
      properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 1134, right: 1134, bottom: 1134, left: 1134 } } },
      children: ctx.children,
    }],
  });
  return Packer.toBuffer(doc);
}

// ---------- block level ----------

function walkBlocks(tokens, start, end, ctx) {
  let i = start;
  while (i < end) {
    const t = tokens[i];
    switch (t.type) {
      case 'heading_open': {
        const level = Number(t.tag.slice(1));
        ctx.children.push(new Paragraph({
          heading: [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3,
            HeadingLevel.HEADING_4, HeadingLevel.HEADING_5, HeadingLevel.HEADING_6][level - 1],
          children: inlineRuns(tokens[i + 1], ctx),
        }));
        i += 3; break;
      }
      case 'paragraph_open': {
        const inline = tokens[i + 1];
        const list = ctx.listStack[ctx.listStack.length - 1];
        if (!list && /^\[TOC\]$/i.test(inline.content.trim())) {
          const min = Math.min(...ctx.headings.map((h) => h.level), 6);
          for (const h of ctx.headings) {
            ctx.children.push(new Paragraph({ children: [new TextRun(h.text)], indent: { left: 360 * (h.level - min) }, spacing: { after: 40 } }));
          }
          ctx.children.push(new Paragraph({ spacing: { after: 120 } }));
          i += 3; break;
        }
        // task list item: "[ ] text" / "[x] text"
        if (list && inline.children && inline.children[0] && inline.children[0].type === 'text') {
          const m = /^\[([ xX])\]\s+/.exec(inline.children[0].content);
          if (m) inline.children[0].content = (m[1] === ' ' ? '☐ ' : '☑ ') + inline.children[0].content.slice(m[0].length);
        }
        const opts = { children: inlineRuns(inline, ctx), spacing: { after: list ? 60 : 160 } };
        if (list) opts.numbering = { reference: list.ordered ? 'numbers' : 'bullets', level: Math.min(3, ctx.listStack.length - 1), instance: list.instance };
        else if (ctx.quoteDepth) opts.style = 'Quote';
        ctx.children.push(new Paragraph(opts));
        i += 3; break;
      }
      case 'bullet_list_open':
      case 'ordered_list_open': {
        ctx.listStack.push({ ordered: t.type === 'ordered_list_open', instance: ++listInstance });
        const close = findClose(tokens, i, t.type.replace('_open', '_close'));
        walkBlocks(tokens, i + 1, close, ctx);
        ctx.listStack.pop();
        i = close + 1; break;
      }
      case 'list_item_open': {
        const close = findClose(tokens, i, 'list_item_close');
        walkBlocks(tokens, i + 1, close, ctx);
        i = close + 1; break;
      }
      case 'blockquote_open': {
        const close = findClose(tokens, i, 'blockquote_close');
        ctx.quoteDepth++;
        walkBlocks(tokens, i + 1, close, ctx);
        ctx.quoteDepth--;
        i = close + 1; break;
      }
      case 'fence':
      case 'code_block': {
        const lines = t.content.replace(/\n$/, '').split('\n');
        lines.forEach((line, k) => ctx.children.push(new Paragraph({
          style: 'Code',
          spacing: { before: k === 0 ? 120 : 0, after: k === lines.length - 1 ? 160 : 0 },
          children: [new TextRun({ text: line || ' ', font: MONO })],
        })));
        i += 1; break;
      }
      case 'table_open': {
        const close = findClose(tokens, i, 'table_close');
        ctx.children.push(buildTable(tokens, i, close, ctx));
        ctx.children.push(new Paragraph({ spacing: { after: 0 } }));
        i = close + 1; break;
      }
      case 'hr':
        ctx.children.push(new Paragraph({ border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: 'BBBBBB', space: 1 } }, spacing: { after: 240 } }));
        i += 1; break;
      case 'html_block':
        ctx.children.push(new Paragraph({ children: [new TextRun({ text: t.content, font: MONO })] }));
        i += 1; break;
      default:
        i += 1;
    }
  }
}
let listInstance = 0;

function findClose(tokens, openIdx, closeType) {
  let depth = 0;
  for (let j = openIdx; j < tokens.length; j++) {
    if (tokens[j].type === tokens[openIdx].type) depth++;
    else if (tokens[j].type === closeType && --depth === 0) return j;
  }
  return tokens.length - 1;
}

function buildTable(tokens, start, end, ctx) {
  const rows = [];
  let cells = null, isHeader = false, align = [];
  for (let j = start; j < end; j++) {
    const t = tokens[j];
    if (t.type === 'thead_open') isHeader = true;
    if (t.type === 'tbody_open') isHeader = false;
    if (t.type === 'tr_open') cells = [];
    if (t.type === 'th_open' || t.type === 'td_open') {
      const style = t.attrGet('style') || '';
      align.push(/right/.test(style) ? AlignmentType.RIGHT : /center/.test(style) ? AlignmentType.CENTER : AlignmentType.LEFT);
      const inline = tokens[j + 1];
      cells.push(new TableCell({
        shading: isHeader ? { type: ShadingType.CLEAR, fill: 'EDEDED' } : undefined,
        children: [new Paragraph({
          alignment: align[align.length - 1],
          children: inlineRuns(inline, ctx, { bold: isHeader }),
          spacing: { after: 0 },
        })],
      }));
    }
    if (t.type === 'tr_close') { rows.push(new TableRow({ children: cells, tableHeader: isHeader })); cells = null; align = []; }
  }
  return new Table({ rows, width: { size: 100, type: WidthType.PERCENTAGE } });
}

// ---------- inline level ----------

function inlineRuns(inlineToken, ctx, base = {}) {
  const runs = [];
  if (!inlineToken || !inlineToken.children) return runs;
  const state = { bold: !!base.bold, italics: false, strike: false, link: null };
  const pushRun = (run) => { if (state.link) state.link.children.push(run); else runs.push(run); };
  const pushText = (text, extra = {}) => {
    if (!text) return;
    pushRun(new TextRun({ text, bold: state.bold, italics: state.italics, strike: state.strike, ...(state.link ? { style: 'Hyperlink' } : {}), ...extra }));
  };
  const pushMathAware = (text) => {
    let last = 0;
    for (const m of text.matchAll(MATH_SLOT)) {
      pushText(text.slice(last, m.index));
      const slot = ctx.mathSlots[+m[1]];
      if (slot.omml) pushRun(mathComponent(slot.omml, slot.display));
      else pushText(slot.tex, { font: MONO, shading: { type: ShadingType.CLEAR, fill: CODE_FILL } }); // fallback: TeX source
      last = m.index + m[0].length;
    }
    pushText(text.slice(last));
  };

  for (const c of inlineToken.children) {
    switch (c.type) {
      case 'text': pushMathAware(c.content); break;
      case 'softbreak': pushText(' '); break;
      case 'hardbreak': runs.push(new TextRun({ break: 1 })); break;
      case 'strong_open': state.bold = true; break;
      case 'strong_close': state.bold = !!base.bold; break;
      case 'em_open': state.italics = true; break;
      case 'em_close': state.italics = false; break;
      case 's_open': state.strike = true; break;
      case 's_close': state.strike = false; break;
      case 'code_inline': pushText(c.content, { font: MONO, shading: { type: ShadingType.CLEAR, fill: CODE_FILL } }); break;
      case 'link_open': {
        const href = c.attrGet('href') || '';
        state.link = { href, children: [] };
        break;
      }
      case 'link_close': {
        if (state.link) {
          const children = state.link.children.length ? state.link.children : [new TextRun({ text: state.link.href, style: 'Hyperlink' })];
          runs.push(new ExternalHyperlink({ link: state.link.href, children }));
        }
        state.link = null;
        break;
      }
      case 'image': {
        const img = imageRun(c.attrGet('src') || '', ctx.docDir);
        if (img) runs.push(img); else pushText(`[image: ${c.attrGet('src')}]`, { italics: true, color: '888888' });
        break;
      }
      default:
        if (c.content) pushMathAware(c.content);
    }
  }
  return runs;
}

// ---------- images ----------

function imageRun(src, docDir) {
  if (!src || /^(https?:|data:)/i.test(src)) return null;
  let file = src.replace(/^file:\/\/\/?/i, '');
  try { file = decodeURIComponent(file); } catch (e) { /* keep as is */ }
  if (!path.isAbsolute(file)) {
    if (!docDir) return null;
    file = path.join(docDir, file);
  }
  let data;
  try { data = fs.readFileSync(file); } catch (e) { return null; }
  const dims = imageSize(data);
  if (!dims) return null;
  const maxWidthPx = 600; // ≈ 16 cm at 96 dpi
  const scale = Math.min(1, maxWidthPx / dims.width);
  return new ImageRun({
    type: dims.type, data,
    transformation: { width: Math.round(dims.width * scale), height: Math.round(dims.height * scale) },
  });
}

// Minimal PNG / JPEG / GIF header reader: enough to size an image without a dependency.
function imageSize(buf) {
  if (buf.length > 24 && buf.readUInt32BE(0) === 0x89504e47) {
    return { type: 'png', width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  }
  if (buf.length > 10 && buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) {
    return { type: 'gif', width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) };
  }
  if (buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    let off = 2;
    while (off < buf.length) {
      if (buf[off] !== 0xff) return null;
      const marker = buf[off + 1];
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { type: 'jpg', height: buf.readUInt16BE(off + 5), width: buf.readUInt16BE(off + 7) };
      }
      off += 2 + buf.readUInt16BE(off + 2);
    }
  }
  return null;
}

module.exports = { buildDocx };
