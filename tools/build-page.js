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
// Second output: docs/loops/ — the loop WAVs the Lens actually plays, copied
// from Assets/GeneratedSFX/Loop_R<r>C<c>.wav and renamed <Row>-<col>.wav with
// a 1-BASED column so the filename matches the LG1 code digit (D3 ->
// Drums-3.wav), the same convention as GarageBandTest/reference-audio/. The
// page links to these so a session can be rebuilt cell-for-cell in a
// GarageBand Live Loops grid; they are linked, never embedded, so the MIDI
// path stays usable offline. One-shots (Hit_*) and UI SFX are not loops and
// are not copied.
//
// Run:   node tools/build-page.js
// Guard: node tools/build-page.test.js  (byte-compares page output vs the tool,
//        and checks docs/loops/ against Assets/GeneratedSFX/)
'use strict';
const fs = require('fs');
const path = require('path');

const TOOL_PATH = path.join(__dirname, 'loopgrid-midi.js');
const LOOPS_PATH = path.join(__dirname, 'loops.json');
const TEMPLATE_PATH = path.join(__dirname, 'page-template.html');
const OUT_PATH = path.join(__dirname, '..', 'docs', 'index.html');
const SFX_DIR = path.join(__dirname, '..', 'Assets', 'GeneratedSFX');
const LOOPS_DIR = path.join(__dirname, '..', 'docs', 'loops');

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

/**
 * Every loop the loop table references, as { src, dest, row, col } — src in
 * Assets/GeneratedSFX (0-based grid indices), dest in docs/loops (row name +
 * 1-based column, matching the LG1 digit). Throws if a referenced loop has no
 * WAV: a page offering a download that 404s is worse than a failed build.
 */
function loopFileMap() {
  const loops = JSON.parse(fs.readFileSync(LOOPS_PATH, 'utf8'));
  const files = [];
  const missing = [];
  for (let r = 0; r < loops.rows.length; r++) {
    for (let c = 0; c < loops.loops[r].length; c++) {
      const src = path.join(SFX_DIR, 'Loop_R' + r + 'C' + c + '.wav');
      if (!fs.existsSync(src)) missing.push(path.relative(path.join(__dirname, '..'), src));
      files.push({ src: src, dest: path.join(LOOPS_DIR, loops.rows[r] + '-' + (c + 1) + '.wav'), row: r, col: c + 1 });
    }
  }
  if (missing.length > 0) {
    throw new Error(
      'loops.json references ' + missing.length + ' loop WAV(s) that do not exist: ' +
      missing.join(', ') + '. Re-run tempAssetGen/gen_music_loopgrid.js.'
    );
  }
  return files;
}

/** Sync docs/loops/ with the referenced loop WAVs; returns {copied, removed}. */
function copyLoops() {
  const files = loopFileMap();
  fs.mkdirSync(LOOPS_DIR, { recursive: true });
  let copied = 0;
  for (const f of files) {
    const src = fs.readFileSync(f.src);
    const cur = fs.existsSync(f.dest) ? fs.readFileSync(f.dest) : null;
    if (cur === null || !cur.equals(src)) {
      fs.writeFileSync(f.dest, src);
      copied++;
    }
  }
  // Drop anything left over from an earlier naming scheme so the published
  // folder never carries files the page cannot reach.
  const keep = new Set(files.map((f) => path.basename(f.dest)));
  const removed = fs.readdirSync(LOOPS_DIR).filter((n) => !keep.has(n));
  for (const n of removed) fs.rmSync(path.join(LOOPS_DIR, n), { recursive: true, force: true });
  return { copied: copied, removed: removed, total: files.length };
}

function main() {
  const html = buildPage();
  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(OUT_PATH, html);
  console.log('Wrote ' + OUT_PATH + ' (' + html.length + ' bytes) from page-template.html + loopgrid-midi.js + loops.json');
  const r = copyLoops();
  console.log('Synced ' + LOOPS_DIR + ': ' + r.total + ' loop WAV(s), ' + r.copied +
    ' written' + (r.removed.length > 0 ? ', ' + r.removed.length + ' stale removed (' + r.removed.join(', ') + ')' : ''));
}

module.exports = { buildPage, stripShebang, loopFileMap, copyLoops, OUT_PATH, LOOPS_DIR };

if (require.main === module) main();
