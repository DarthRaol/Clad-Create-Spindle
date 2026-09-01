#!/usr/bin/env node
// Golden test for tools/loopgrid-midi.js.
//
// A fixed LG1 code goes through the writer; the emitted bytes are parsed back
// by an INDEPENDENT minimal SMF reader in this file, and note counts, pitches
// and tick times are asserted against expectations computed here directly from
// loops.json with its own bar arithmetic. If the tool's arrangement walk is
// off by even one bar, every tick in the affected stretch differs by 1920 and
// the multiset comparison fails loudly. Also asserts that a single-character
// corruption of the code is rejected by the checksum, never decoded.
//
// Run: node tools/loopgrid-midi.test.js
'use strict';
const assert = require('assert');
const { lg1Checksum, parseLG1, codeToMidi, loadLoops } = require('./loopgrid-midi.js');

const TPQ = 480;
const BEATS_PER_BAR = 4;
const GM_DRUM_REMAP = { 60: 46, 62: 51 }; // re-stated on purpose: tests must not share the tool's table

// ── minimal SMF reader (independent of the writer) ───────────────────────────
function readMidi(buf) {
  assert.strictEqual(buf.toString('ascii', 0, 4), 'MThd', 'missing MThd');
  const format = buf.readUInt16BE(8);
  const ntrks = buf.readUInt16BE(10);
  const division = buf.readUInt16BE(12);
  const tracks = [];
  let off = 14;
  for (let t = 0; t < ntrks; t++) {
    assert.strictEqual(buf.toString('ascii', off, off + 4), 'MTrk', 'missing MTrk at ' + off);
    const len = buf.readUInt32BE(off + 4);
    let p = off + 8;
    const end = p + len;
    let tick = 0;
    let running = 0;
    const notes = [];
    const metas = [];
    while (p < end) {
      let delta = 0;
      let b;
      do { b = buf[p++]; delta = (delta << 7) | (b & 0x7f); } while (b & 0x80);
      tick += delta;
      let status = buf[p];
      if (status & 0x80) { p++; running = status; } else { status = running; }
      if (status === 0xff) {
        const type = buf[p++];
        let mlen = 0;
        do { b = buf[p++]; mlen = (mlen << 7) | (b & 0x7f); } while (b & 0x80);
        metas.push({ tick, type, data: buf.subarray(p, p + mlen) });
        p += mlen;
      } else {
        const hi = status & 0xf0;
        if (hi === 0x90 || hi === 0x80) {
          const pitch = buf[p++], vel = buf[p++];
          if (hi === 0x90 && vel > 0) notes.push({ tick, pitch, vel, ch: status & 0x0f });
        } else if (hi === 0xc0 || hi === 0xd0) {
          p += 1;
        } else {
          p += 2;
        }
      }
    }
    tracks.push({ notes, metas });
    off = end;
  }
  return { format, division, tracks };
}

// ── expected-notes builder (independent bar math) ────────────────────────────
function expectedNotes(loops, row, colIdx, repBars, drum) {
  const out = [];
  for (const bar of repBars) {
    for (const ev of loops.loops[row][colIdx]) {
      let pitch = ev[2];
      if (drum && GM_DRUM_REMAP[pitch] !== undefined) pitch = GM_DRUM_REMAP[pitch];
      out.push([Math.round((bar * BEATS_PER_BAR + ev[0]) * TPQ), pitch]);
    }
  }
  return out.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
}
function actualNotes(track) {
  return track.notes.map((n) => [n.tick, n.pitch]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
}

// ── the golden code ──────────────────────────────────────────────────────────
// bar 0: drums col5 (house — contains `oh`, exercising the GM remap) + bass col2
// bar 4: drums switch to col3
// bar 8: both stop; session runs to END:12 with 4 empty bars.
const body = 'LG1|105|Am|0:D5,B2;4:D3;8:D0,B0|END:12';
const code = body + '|' + lg1Checksum(body);

const loops = loadLoops();
const midi = readMidi(codeToMidi(code, loops));

// Structure
assert.strictEqual(midi.format, 1, 'format 1 expected');
assert.strictEqual(midi.division, 480, '480 ticks/quarter expected');
assert.strictEqual(midi.tracks.length, 6, '6 tracks expected (meta + 5 rows)');

// Track 0: tempo 571429 us/quarter, 4/4, A minor
const tempoMeta = midi.tracks[0].metas.find((m) => m.type === 0x51);
assert.ok(tempoMeta, 'tempo meta missing');
const usq = (tempoMeta.data[0] << 16) | (tempoMeta.data[1] << 8) | tempoMeta.data[2];
assert.strictEqual(usq, 571429, '105 BPM must encode as 571429 us/quarter, got ' + usq);
const keyMeta = midi.tracks[0].metas.find((m) => m.type === 0x59);
assert.ok(keyMeta && keyMeta.data[0] === 0 && keyMeta.data[1] === 1, 'A-minor key signature missing');
console.log('PASS structure: format 1, 480 tpq, 6 tracks, tempo 571429, 4/4, Am');

// Drums (track 1, channel 10): col5 at bars 0+2, col3 at bars 4+6, remapped.
const expDrums = expectedNotes(loops, 0, 4, [0, 2], true)
  .concat(expectedNotes(loops, 0, 2, [4, 6], true))
  .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
const gotDrums = actualNotes(midi.tracks[1]);
assert.strictEqual(gotDrums.length, expDrums.length,
  'Drums note count: expected ' + expDrums.length + ', got ' + gotDrums.length);
assert.deepStrictEqual(gotDrums, expDrums,
  'Drums [tick,pitch] mismatch — arrangement walk or remap is wrong');
assert.ok(midi.tracks[1].notes.every((n) => n.ch === 9), 'Drums must be on channel 10');
assert.ok(loops.loops[0][4].some((ev) => ev[2] === 60), 'test premise: D5 source must contain oh=60');
assert.ok(gotDrums.some(([, p]) => p === 46), 'GM remap: expected open hi-hat 46 in output');
assert.ok(!gotDrums.some(([, p]) => p === 60 || p === 62), 'GM remap: raw 60/62 must not reach a drum track');
console.log('PASS drums: ' + gotDrums.length + ' notes, ticks+pitches match loops.json, oh->46 remapped, ch10');

// Bass (track 2, channel 1): col2 at bars 0,2,4,6 — no remap on melodic rows.
const expBass = expectedNotes(loops, 1, 1, [0, 2, 4, 6], false);
const gotBass = actualNotes(midi.tracks[2]);
assert.deepStrictEqual(gotBass, expBass, 'Bass [tick,pitch] mismatch');
assert.ok(midi.tracks[2].notes.every((n) => n.ch === 0), 'Bass must be on channel 1');
console.log('PASS bass: ' + gotBass.length + ' notes at exact ticks, ch1');

// Keys/Lead/Perc tracks must be empty (never launched) and nothing past bar 8.
assert.strictEqual(midi.tracks[3].notes.length, 0, 'Keys should be empty');
assert.strictEqual(midi.tracks[4].notes.length, 0, 'Lead should be empty');
assert.strictEqual(midi.tracks[5].notes.length, 0, 'Perc should be empty');
const stopTick = 8 * BEATS_PER_BAR * TPQ;
assert.ok(gotDrums.every(([t]) => t < stopTick), 'notes after the bar-8 stop');
assert.ok(gotBass.every(([t]) => t < stopTick), 'notes after the bar-8 stop');
console.log('PASS silence: unused rows empty, nothing sounds after the stop at bar 8');

// Off-by-one-bar canary: shifting the whole expectation by one bar must NOT match.
const shifted = expectedNotes(loops, 1, 1, [1, 3, 5, 7], false);
assert.notDeepStrictEqual(gotBass, shifted, 'canary: a one-bar shift must be distinguishable');
console.log('PASS canary: a one-bar arrangement shift is detectable by this test');

// Checksum: a single-character corruption must be rejected, loudly.
const corrupted = code.replace('0:D5', '0:D6'); // one character changed
assert.notStrictEqual(corrupted, code);
assert.throws(() => parseLG1(corrupted), /checksum/i, 'corrupted code must throw a checksum error');
// And the error path must not be reachable as a "valid but different" arrangement.
assert.throws(() => codeToMidi(corrupted, loops), /checksum/i);
console.log('PASS checksum: single-character corruption rejected, never decoded');

console.log('ALL TESTS PASSED');
