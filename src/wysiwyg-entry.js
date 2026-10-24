// WYSIWYG editor (Milkdown Crepe) wrapped in a small API for renderer.js.
// This file is bundled by esbuild into src/vendor/wysiwyg.js (+ wysiwyg.css); do not load it directly.
import { Crepe, CrepeFeature } from '@milkdown/crepe';
import '@milkdown/crepe/theme/common/style.css';
import '@milkdown/crepe/theme/classic.css';
import { remarkStringifyOptionsCtx, editorViewCtx } from '@milkdown/kit/core';
import { replaceAll, callCommand } from '@milkdown/kit/utils';
import {
  toggleStrongCommand, toggleEmphasisCommand, toggleInlineCodeCommand, toggleLinkCommand,
  wrapInHeadingCommand, turnIntoTextCommand, wrapInBulletListCommand, wrapInOrderedListCommand,
  wrapInBlockquoteCommand, createCodeBlockCommand, insertHrCommand,
} from '@milkdown/kit/preset/commonmark';
import { toggleStrikethroughCommand, insertTableCommand } from '@milkdown/kit/preset/gfm';

// Keep the generated Markdown close to what people write by hand.
const STRINGIFY = { bullet: '-', emphasis: '*', strong: '*', fences: true, listItemIndent: 'one', rule: '-', incrementListMarker: true };

async function create({ root, markdown, onChange, onUpload, resolveUrl }) {
  const crepe = new Crepe({
    root,
    defaultValue: markdown,
    features: { [CrepeFeature.AI]: false, [CrepeFeature.TopBar]: false },
    featureConfigs: {
      [CrepeFeature.ImageBlock]: {
        onUpload: (file) => onUpload(file),
        inlineOnUpload: (file) => onUpload(file),
        blockOnUpload: (file) => onUpload(file),
        proxyDomURL: (url) => resolveUrl(url),
      },
      [CrepeFeature.Placeholder]: { text: 'Type here, or press / for blocks' },
    },
  });

  let muted = false; // true while we push text in from the source pane
  crepe.editor.config((ctx) => ctx.update(remarkStringifyOptionsCtx, (o) => ({ ...o, ...STRINGIFY })));
  crepe.on((listener) => {
    listener.markdownUpdated((_ctx, md, prev) => { if (!muted && md !== prev) onChange(md); });
  });
  await crepe.create();

  const COMMANDS = {
    bold: () => callCommand(toggleStrongCommand.key),
    italic: () => callCommand(toggleEmphasisCommand.key),
    strike: () => callCommand(toggleStrikethroughCommand.key),
    code: () => callCommand(toggleInlineCodeCommand.key),
    link: () => callCommand(toggleLinkCommand.key, { href: 'https://' }),
    heading: (n) => (Number(n) ? callCommand(wrapInHeadingCommand.key, Number(n)) : callCommand(turnIntoTextCommand.key)),
    bullet: () => callCommand(wrapInBulletListCommand.key),
    number: () => callCommand(wrapInOrderedListCommand.key),
    quote: () => callCommand(wrapInBlockquoteCommand.key),
    table: () => callCommand(insertTableCommand.key, { row: 3, col: 3 }),
    codeblock: () => callCommand(createCodeBlockCommand.key),
    hr: () => callCommand(insertHrCommand.key),
  };

  return {
    getMarkdown: () => crepe.getMarkdown(),
    setMarkdown: (md) => { muted = true; try { crepe.editor.action(replaceAll(md)); } finally { muted = false; } },
    command: (name, arg) => { const c = COMMANDS[name]; if (c) crepe.editor.action(c(arg)); return !!c; },
    focus: () => crepe.editor.action((ctx) => ctx.get(editorViewCtx).focus()),
    setReadonly: (v) => crepe.setReadonly(v),
    destroy: () => crepe.destroy(),
  };
}

window.TwoEasyWysiwyg = { create };
