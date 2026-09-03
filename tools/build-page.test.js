#!/usr/bin/env node
// Drift guard for docs/index.html.
//
// Regenerates the page via tools/build-page.js, extracts the spliced library
// and loop table back OUT of the generated HTML, executes the library exactly
// as a browser would (Buffer shim and all), and byte-compares its MIDI output
// — combined AND stems — against tools/loopgrid-midi.js running natively in
// Node. Any divergence between the page and the tool fails here instead of
// failing on a phone. Also fails if the committed docs/index.html is stale
// relative to the current tool/template/loops.json, or if docs/loops/ does not
// match the loop WAVs in Assets/GeneratedSFX (missing, stale, or orphaned) —
// a broken Live Loops download would otherwise only show up as a 404.
//
// Run: node tools/build-page.test.js
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { buildPage, stripShebang, loopFileMap, OUT_PATH, LOOPS_DIR } = require('./build-page.js');
const tool = require('./loopgrid-midi.js');

const html = buildPage();

// ── extract the spliced pieces back out of the generated page ────────────────
function extract(re, label) {
  const m = re.exec(html);
  assert.ok(m, 'could not find ' + label + ' block in generated page');
  return m[1];
}
const libSrc = extract(
  /\/\* BEGIN LOOPGRID LIB[^*]*\*\/\n([\s\S]*?)\n\/\* END LOOPGRID LIB \*\//,
  'LOOPGRID LIB'
);
const loopsSrc = extract(
  /\/\* BEGIN LOOPS[^*]*\*\/\nconst LOOPS = ([\s\S]*?);\n\/\* END LOOPS \*\//,
  'LOOPS'
);

// The lib block must contain the tool source VERBATIM — not a port of it.
// (The shebang comment-out is the single sanctioned transform.)
const toolSource = fs.readFileSync(require.resolve('./loopgrid-midi.js'), 'utf8');
assert.ok(libSrc.includes(stripShebang(toolSource)), 'page does not embed tools/loopgrid-midi.js verbatim');
console.log('PASS verbatim: page embeds the actual tools/loopgrid-midi.js source (shebang commented)');

// The embedded loop table must be the actual tools/loops.json.
assert.deepStrictEqual(JSON.parse(loopsSrc), tool.loadLoops(),
  'embedded LOOPS differs from tools/loops.json');
console.log('PASS loops: embedded table deep-equals tools/loops.json');

// ── run the page's library the way a browser would ───────────────────────────
// new Function gives it a scope with no Node require/Buffer visible except
// what the wrapper itself defines — same conditions as the browser.
const pageLib = new Function(libSrc + '\nreturn LoopGridMidi;')();
for (const fn of ['parseLG1', 'codeToMidi', 'codeToStems', 'buildArrangement', 'lg1Checksum']) {
  assert.strictEqual(typeof pageLib[fn], 'function', 'page lib missing ' + fn);
}

// ── byte-for-byte comparison, both modes, several shapes ─────────────────────
const loops = tool.loadLoops();
const bodies = [
  'LG1|105|Am|0:D1,B1;4:K3;8:L5,P2;16:D4,B4;24:K6,L0;28:D0,B0,K0,P0|END:28|PAT:-', // all 5 rows, switches, stop
  'LG1|105|Am|0:D1,B1|END:8|PAT:-',                                                // empty-row omission
  'LG1|105|Am|0:D5;4:D3|END:8|PAT:-',                                              // drums only (GM remap path)
  'LG1|105|Am|0:D9,P9,B1;8:D0|END:12|PAT:D=88880000222200000000,P=00000000000000000101', // custom patterns
];
for (const body of bodies) {
  const code = body + '|' + tool.lg1Checksum(body);
  assert.strictEqual(pageLib.lg1Checksum(body), tool.lg1Checksum(body), 'checksum drift for ' + body);

  const pageCombined = Buffer.from(pageLib.codeToMidi(code, loops));
  const toolCombined = tool.codeToMidi(code, loops);
  assert.ok(pageCombined.equals(toolCombined),
    'combined MIDI drift for ' + body + ' (page ' + pageCombined.length + 'B vs tool ' + toolCombined.length + 'B)');

  const pageStems = pageLib.codeToStems(code, loops);
  const toolStems = tool.codeToStems(code, loops);
  assert.strictEqual(pageStems.length, toolStems.length, 'stem count drift for ' + body);
  for (let i = 0; i < toolStems.length; i++) {
    assert.strictEqual(pageStems[i].name, toolStems[i].name, 'stem name drift for ' + body);
    assert.strictEqual(pageStems[i].row, toolStems[i].row, 'stem row drift for ' + body);
    assert.ok(Buffer.from(pageStems[i].midi).equals(toolStems[i].midi),
      'stem ' + toolStems[i].name + ' MIDI drift for ' + body);
  }
  // The Live Loops cell list is shared source too — and every WAV it names
  // must be a file the build actually published.
  const pageCells = pageLib.cellWavList(pageLib.parseLG1(code));
  assert.deepStrictEqual(pageCells, tool.cellWavList(tool.parseLG1(code)),
    'cellWavList drift for ' + body);
  for (const c of pageCells) {
    if (c.custom) continue;
    assert.ok(fs.existsSync(path.join(LOOPS_DIR, c.file)),
      'page links loops/' + c.file + ' but that file is not in docs/loops/');
  }
  console.log('PASS bytes: combined + ' + toolStems.length + ' stem(s) identical, ' +
    pageCells.length + ' cell(s) resolvable, for ' + body);
}

// Error paths must also come from the shared source, not diverge silently.
assert.throws(() => pageLib.parseLG1('LG1|105|Am|0:D1|END:8|0'), /checksum/i,
  'page lib must reject a bad checksum');
console.log('PASS errors: page lib rejects a corrupted code via the shared checksum path');

// ── the committed page must be up to date with tool + template + loops ───────
const onDisk = fs.existsSync(OUT_PATH) ? fs.readFileSync(OUT_PATH, 'utf8') : null;
assert.strictEqual(onDisk, html,
  'docs/index.html is stale — regenerate it with: node tools/build-page.js');
console.log('PASS freshness: committed docs/index.html matches a fresh build');

// The page must not embed audio — the WAVs are linked so the MIDI path works
// offline and the HTML stays small.
assert.ok(!/data:audio\//i.test(html), 'page embeds audio as a data: URI — WAVs must be linked, not embedded');
assert.ok(html.includes('href="loops/'), 'page does not link into docs/loops/');
console.log('PASS linkage: WAVs are linked from loops/, not embedded');

// ── docs/loops/ must match Assets/GeneratedSFX byte for byte ─────────────────
const expected = loopFileMap();
assert.ok(fs.existsSync(LOOPS_DIR), 'docs/loops/ is missing — run: node tools/build-page.js');
for (const f of expected) {
  const name = path.basename(f.dest);
  assert.ok(fs.existsSync(f.dest),
    'docs/loops/' + name + ' is missing — run: node tools/build-page.js');
  assert.ok(fs.readFileSync(f.dest).equals(fs.readFileSync(f.src)),
    'docs/loops/' + name + ' is stale vs ' + path.basename(f.src) + ' — run: node tools/build-page.js');
}
const keep = new Set(expected.map((f) => path.basename(f.dest)));
const orphans = fs.readdirSync(LOOPS_DIR).filter((n) => !keep.has(n));
assert.deepStrictEqual(orphans, [],
  'docs/loops/ contains files no loop maps to: ' + orphans.join(', '));
console.log('PASS loop WAVs: ' + expected.length + ' file(s) in docs/loops/ match Assets/GeneratedSFX, no orphans');

console.log('ALL BUILD-PAGE TESTS PASSED');
