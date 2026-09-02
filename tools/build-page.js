#!/usr/bin/env node
// build-page.js — generates docs/index.html from tools/page-template.html by
// splicing in the VERBATIM source of tools/loopgrid-midi.js (wrapped for the
// browser) and the actual tools/loops.json.
//
// The page carries no independently-maintained LG1/SMF logic: the only
// browser-specific code added here is a minimal Buffer shim (the sole Node
// API the tool's pure functions use) and a require() stub so the tool's
// loadLoops()/CLI sections — which the page never calls — parse harmlessly.
//
// Run:   node tools/build-page.js
// Guard: node tools/build-page.test.js  (byte-compares page output vs the tool)
'use strict';
const fs = require('fs');
const path = require('path');

const TOOL_PATH = path.join(__dirname, 'loopgrid-midi.js');
const LOOPS_PATH = path.join(__dirname, 'loops.json');
const TEMPLATE_PATH = path.join(__dirname, 'page-template.html');
const OUT_PATH = path.join(__dirname, '..', 'docs', 'index.html');

// Minimal Buffer-on-Uint8Array shim covering exactly what the tool's pure
// functions use: alloc, from(string|array), concat, write, writeUInt32BE,
// writeUInt16BE. Extending Uint8Array keeps results Blob- and set()-friendly.
const BUFFER_SHIM = [
  'class Buffer extends Uint8Array {',
  '  static alloc(n) { return new Buffer(n); }',
  '  static from(src) {',
  '    if (typeof src === "string") {',
  '      const b = new Buffer(src.length);',
  '      for (let i = 0; i < src.length; i++) b[i] = src.charCodeAt(i) & 0xff;',
  '      return b;',
  '    }',
  '    const b = new Buffer(src.length); b.set(src); return b;',
  '  }',
  '  static concat(list) {',
  '    const out = new Buffer(list.reduce((s, c) => s + c.length, 0));',
  '    let o = 0;',
  '    for (const c of list) { out.set(c, o); o += c.length; }',
  '    return out;',
  '  }',
  '  write(s, off) { off = off || 0; for (let i = 0; i < s.length; i++) this[off + i] = s.charCodeAt(i) & 0xff; }',
  '  writeUInt32BE(v, off) { off = off || 0; this[off] = (v >>> 24) & 0xff; this[off + 1] = (v >>> 16) & 0xff; this[off + 2] = (v >>> 8) & 0xff; this[off + 3] = v & 0xff; }',
  '  writeUInt16BE(v, off) { off = off || 0; this[off] = (v >>> 8) & 0xff; this[off + 1] = v & 0xff; }',
  '}',
].join('\n');

/** The ONLY transform applied to the tool source: the shebang line is a
 *  syntax error outside Node's module loader (browsers included), so it is
 *  turned into a comment. Everything else is verbatim. */
function stripShebang(source) {
  return source.replace(/^#!.*/, '// (shebang stripped for the browser by build-page.js)');
}

/** Wrap the tool source into a browser-safe IIFE exposing module.exports. */
function wrapToolSource(source) {
  return [
    'const LoopGridMidi = (function () {',
    BUFFER_SHIM,
    '// require() stub: fs/path are only touched by loadLoops()/main(), which',
    '// the page never calls; require.main is undefined so main() never runs.',
    'const require = function () { return {}; };',
    'const module = { exports: {} };',
    'const process = undefined;',
    '/* ---- tools/loopgrid-midi.js, verbatim (shebang commented) ---- */',
    stripShebang(source),
    '/* ---- end verbatim source ---- */',
    'return module.exports;',
    '})();',
  ].join('\n');
}

function splice(template, placeholder, content, label) {
  if (content.includes('</script')) {
    throw new Error(label + ' contains "</script" — cannot be inlined into HTML safely.');
  }
  if (!template.includes(placeholder)) {
    throw new Error('Template is missing placeholder ' + placeholder);
  }
  return template.replace(placeholder, () => content); // fn form: no $-pattern expansion
}

/** Build the page and return it as a string (does not write). */
function buildPage() {
  const toolSource = fs.readFileSync(TOOL_PATH, 'utf8');
  const loopsJson = fs.readFileSync(LOOPS_PATH, 'utf8').trim();
  const template = fs.readFileSync(TEMPLATE_PATH, 'utf8');

  let html = splice(template, '__LOOPGRID_MIDI_LIB__', wrapToolSource(toolSource), 'tool source');
  html = splice(html, '__LOOPS_JSON__', loopsJson, 'loops.json');
  if (/__LOOPGRID_MIDI_LIB__|__LOOPS_JSON__/.test(html)) {
    throw new Error('Unfilled placeholder remains after splicing.');
  }
  return html;
}

function main() {
  const html = buildPage();
  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(OUT_PATH, html);
  console.log('Wrote ' + OUT_PATH + ' (' + html.length + ' bytes) from page-template.html + loopgrid-midi.js + loops.json');
}

module.exports = { buildPage, stripShebang, OUT_PATH };

if (require.main === module) main();
