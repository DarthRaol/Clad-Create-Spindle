#!/usr/bin/env node
// loopgrid-midi.js — LoopGrid companion tool: LG1 export code -> Standard MIDI
// File for GarageBand. Dependency-free (Node builtins only).
//
// The Lens shows the LG1 code on its export panel (see
// Assets/Scripts/LoopGridExportEncoder.ts — the format is defined there and
// mirrored here, checksum included). Note content comes from tools/loops.json,
// which is emitted by the SAME generator run that renders the loop WAVs
// (tempAssetGen/gen_music_loopgrid.js), so this MIDI can never drift from the
// audio the user actually heard.
//
// Usage:
//   node tools/loopgrid-midi.js "LG1|105|Am|0:D1,B1|END:8|<c>" out.mid
//
// Output: format-1 SMF, 480 ticks/quarter.
//   Track 0: tempo + 4/4 + A-minor key signature.
//   Tracks 1-5: Drums, Bass, Keys, Lead, Perc.
//   Drums & Perc on channel 10 (index 9); Bass/Keys/Lead on channels 1-3.
'use strict';
const fs = require('fs');
const path = require('path');

const TICKS_PER_QUARTER = 480;
const BEATS_PER_BAR = 4;
const LOOP_BARS = 2; // every LoopGrid loop is exactly 2 bars (8 beats)
const ROW_LETTERS = ['D', 'B', 'K', 'L', 'P'];
const ROW_NAMES = ['Drums', 'Bass', 'Keys', 'Lead', 'Perc'];
// 0-based MIDI channels per row. GM percussion is channel 10 = index 9.
const ROW_CHANNELS = [9, 0, 1, 2, 9];
// GM programs (0-based) for the melodic rows; drum channels ignore program.
const ROW_PROGRAMS = { 1: 33, 2: 4, 3: 11 }; // El.Bass(finger), E.Piano 1, Vibraphone

// The generator's DRUM_MAP (build-music rhythm.js) is not GM-clean: `oh` is
// rendered at MIDI 60 (so the hat voice picks its open variant) and `ride` at
// 62. On a GM drum channel those are Hi Bongo / Mute Hi Conga — GarageBand
// would play the wrong percussion. Remap to GM Open Hi-Hat (46) and Ride
// Cymbal 1 (51). Every other drum pitch the generator uses
// (36/37/38/39/41/42/45/49/50/70) is already GM-correct.
const GM_DRUM_REMAP = { 60: 46, 62: 51 };
const DRUM_ROWS = new Set([0, 4]); // Drums, Perc

const BASE36 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/** FNV-1a 32-bit of `body`, folded to one base-36 character. Mirror of
 *  lg1Checksum in Assets/Scripts/LoopGridExportEncoder.ts — keep in lockstep. */
function lg1Checksum(body) {
  let h = 0x811c9dc5;
  for (let i = 0; i < body.length; i++) {
    h ^= body.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return BASE36[(h >>> 0) % 36];
}

/**
 * Parse and validate an LG1 code.
 * Returns { bpm, key, timeline: [{bar, changes: [{row, col}]}], endBar }.
 * `col` is 1..8, or 0 for "row stops". Throws with a clear message on any
 * malformed input — most importantly on a checksum mismatch, so a mis-copied
 * character can never become a silently wrong arrangement.
 */
function parseLG1(code) {
  const trimmed = String(code).trim();
  const parts = trimmed.split('|');
  if (parts.length !== 6) {
    throw new Error(
      'Not an LG1 code: expected 6 "|" segments (LG1|bpm|key|timeline|END:n|checksum), got ' +
      parts.length
    );
  }
  const body = parts.slice(0, 5).join('|');
  const expect = lg1Checksum(body);
  if (parts[5] !== expect) {
    throw new Error(
      'LG1 checksum mismatch: code ends with "' + parts[5] + '" but its content hashes to "' +
      expect + '". The code was mis-copied or corrupted — re-read it from the export panel.'
    );
  }
  if (parts[0] !== 'LG1') throw new Error('Unknown format tag "' + parts[0] + '" (expected LG1)');
  const bpm = Number(parts[1]);
  if (!Number.isInteger(bpm) || bpm <= 0) throw new Error('Bad bpm segment "' + parts[1] + '"');
  const key = parts[2];
  const endMatch = /^END:(\d+)$/.exec(parts[4]);
  if (!endMatch) throw new Error('Bad END segment "' + parts[4] + '"');
  const endBar = Number(endMatch[1]);

  const timeline = [];
  if (parts[3] !== '-') {
    for (const entry of parts[3].split(';')) {
      const m = /^(\d+):([DBKLP][0-8](?:,[DBKLP][0-8])*)$/.exec(entry);
      if (!m) throw new Error('Bad timeline entry "' + entry + '"');
      const bar = Number(m[1]);
      if (bar > endBar) throw new Error('Timeline bar ' + bar + ' is past END:' + endBar);
      const changes = m[2].split(',').map((c) => ({
        row: ROW_LETTERS.indexOf(c[0]),
        col: Number(c[1]),
      }));
      timeline.push({ bar, changes });
    }
    timeline.sort((a, b) => a.bar - b.bar);
  }
  return { bpm, key, timeline, endBar };
}

/**
 * Walk the timeline into per-row segments: for each row, the list of
 * { startBar, endBar, col } stretches where one loop (col 1..8) is playing.
 * A row's loop repeats every LOOP_BARS from its startBar until the row's next
 * change, out to the END bar.
 */
function buildArrangement(timeline, endBar) {
  const segments = [[], [], [], [], []];
  const activeCol = [0, 0, 0, 0, 0]; // 0 = silent
  const activeSince = [0, 0, 0, 0, 0];
  for (const ev of timeline) {
    for (const ch of ev.changes) {
      const r = ch.row;
      if (activeCol[r] > 0) {
        segments[r].push({ startBar: activeSince[r], endBar: ev.bar, col: activeCol[r] });
      }
      activeCol[r] = ch.col;
      activeSince[r] = ev.bar;
    }
  }
  for (let r = 0; r < 5; r++) {
    if (activeCol[r] > 0 && endBar > activeSince[r]) {
      segments[r].push({ startBar: activeSince[r], endBar: endBar, col: activeCol[r] });
    }
  }
  return segments;
}

/** Expand one segment into absolute-tick notes from the row's loop table. */
function notesForSegment(loopEvents, seg, isDrumRow) {
  const notes = [];
  const segEndBeat = seg.endBar * BEATS_PER_BAR;
  for (let bar = seg.startBar; bar < seg.endBar; bar += LOOP_BARS) {
    for (const ev of loopEvents) {
      const startBeat = bar * BEATS_PER_BAR + ev[0];
      if (startBeat >= segEndBeat - 1e-9) continue; // clip odd-length segments
      let pitch = ev[2];
      if (isDrumRow && GM_DRUM_REMAP[pitch] !== undefined) pitch = GM_DRUM_REMAP[pitch];
      notes.push({
        tick: Math.round(startBeat * TICKS_PER_QUARTER),
        durTicks: Math.max(1, Math.round(ev[1] * TICKS_PER_QUARTER)),
        pitch: pitch,
        velocity: Math.max(1, Math.min(127, ev[3])),
      });
    }
  }
  return notes;
}

// ── SMF writing ──────────────────────────────────────────────────────────────

function vlq(value) {
  const bytes = [value & 0x7f];
  let v = value >> 7;
  while (v > 0) {
    bytes.unshift((v & 0x7f) | 0x80);
    v >>= 7;
  }
  return bytes;
}

function trackChunk(eventBytes) {
  const withEot = eventBytes.concat([0x00, 0xff, 0x2f, 0x00]);
  const header = Buffer.from('MTrk');
  const len = Buffer.alloc(4);
  len.writeUInt32BE(withEot.length);
  return Buffer.concat([header, len, Buffer.from(withEot)]);
}

function metaTrack(bpm) {
  const usPerQuarter = Math.round(60000000 / bpm); // 105 BPM -> 571429
  const b = [];
  b.push(0x00, 0xff, 0x51, 0x03,
    (usPerQuarter >> 16) & 0xff, (usPerQuarter >> 8) & 0xff, usPerQuarter & 0xff);
  b.push(0x00, 0xff, 0x58, 0x04, 0x04, 0x02, 0x18, 0x08); // 4/4
  b.push(0x00, 0xff, 0x59, 0x02, 0x00, 0x01); // 0 sharps/flats, minor -> A minor
  return trackChunk(b);
}

function noteTrack(name, channel, program, notes) {
  const b = [];
  const nameBytes = Array.from(Buffer.from(name, 'ascii'));
  b.push(0x00, 0xff, 0x03, nameBytes.length, ...nameBytes);
  if (program !== undefined) b.push(0x00, 0xc0 | channel, program);

  // Interleave on/off events; at equal ticks, offs first so a repeated pitch
  // re-strikes instead of being cut by the previous note's off.
  const evs = [];
  for (const n of notes) {
    evs.push({ tick: n.tick, kind: 1, pitch: n.pitch, vel: n.velocity });
    evs.push({ tick: n.tick + n.durTicks, kind: 0, pitch: n.pitch, vel: 0 });
  }
  evs.sort((a, b2) => a.tick - b2.tick || a.kind - b2.kind);
  let lastTick = 0;
  for (const e of evs) {
    b.push(...vlq(e.tick - lastTick));
    lastTick = e.tick;
    b.push((e.kind === 1 ? 0x90 : 0x80) | channel, e.pitch, e.vel);
  }
  return trackChunk(b);
}

/** LG1 code + loops table -> SMF bytes (Buffer). */
function codeToMidi(code, loopsJson) {
  const parsed = parseLG1(code);
  if (loopsJson.bpm !== parsed.bpm) {
    throw new Error(
      'Code bpm ' + parsed.bpm + ' does not match loops.json bpm ' + loopsJson.bpm +
      ' — code and loop table are from different builds.'
    );
  }
  const segments = buildArrangement(parsed.timeline, parsed.endBar);

  const chunks = [metaTrack(parsed.bpm)];
  for (let r = 0; r < 5; r++) {
    let notes = [];
    for (const seg of segments[r]) {
      notes = notes.concat(
        notesForSegment(loopsJson.loops[r][seg.col - 1], seg, DRUM_ROWS.has(r))
      );
    }
    notes.sort((a, b) => a.tick - b.tick || a.pitch - b.pitch);
    chunks.push(noteTrack(ROW_NAMES[r], ROW_CHANNELS[r], ROW_PROGRAMS[r], notes));
  }

  const header = Buffer.alloc(14);
  header.write('MThd');
  header.writeUInt32BE(6, 4);
  header.writeUInt16BE(1, 8); // format 1
  header.writeUInt16BE(chunks.length, 10);
  header.writeUInt16BE(TICKS_PER_QUARTER, 12);
  return Buffer.concat([header, ...chunks]);
}

function loadLoops() {
  return JSON.parse(fs.readFileSync(path.join(__dirname, 'loops.json'), 'utf8'));
}

// ── CLI ──────────────────────────────────────────────────────────────────────

function main() {
  const [code, outPath] = process.argv.slice(2);
  if (!code || !outPath) {
    console.error('Usage: node tools/loopgrid-midi.js "<LG1 code from the export panel>" out.mid');
    process.exit(2);
  }
  let midi;
  try {
    midi = codeToMidi(code, loadLoops());
  } catch (e) {
    console.error('ERROR: ' + e.message);
    process.exit(1);
  }
  fs.writeFileSync(outPath, midi);
  console.log('Wrote ' + outPath + ' (' + midi.length + ' bytes). Open it in GarageBand.');
}

module.exports = { lg1Checksum, parseLG1, buildArrangement, notesForSegment, codeToMidi, loadLoops };

if (require.main === module) main();
