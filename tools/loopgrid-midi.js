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
//   node tools/loopgrid-midi.js "LG1|105|Am|0:D1,B1|END:8|PAT:-|<c>" out.mid
//   node tools/loopgrid-midi.js --stems "LG1|...|<c>" out.mid
//
// Custom patterns: cell digit 9 (D9/P9 only) plays the row's user-authored
// 16-step x 5-lane pattern, carried in the PAT segment as 20 hex chars per
// row (see unpackPattern). Rendered on channel 10 with GM notes
// Kick 36 / Snare 38 / Hat 42 / Clap 39 / Shaker 70 — the 1-bar pattern
// repeats every bar of its segment.
//
// Default (arrangement) output: format-1 SMF, 480 ticks/quarter.
//   Track 0: tempo + 4/4 + A-minor key signature.
//   Then one track per row that actually plays (Drums, Bass, Keys, Lead,
//   Perc) — rows with zero notes are omitted entirely.
//   Drums & Perc on channel 10 (index 9); Bass/Keys/Lead on channels 1-3.
//
// --stems output: one SINGLE-track format-0 file per playing row, named
//   <out>-Drums.mid, <out>-Bass.mid, ... (rows with zero notes are skipped).
//   GarageBand iOS turns every track of a multitrack import into a pitched
//   Keyboard track; only a single-track file dropped onto a Drums track lands
//   on a drum kit. Stems exist so the drum rows can be imported that way.
//
// BROWSER CONSTRAINT: tools/build-page.js splices this file VERBATIM into
// docs/index.html (with a Buffer shim). Everything except loadLoops() and
// main() must stay free of Node APIs beyond Buffer — no fs/path/process in
// the parse/arrange/write functions. tools/build-page.test.js enforces that
// the spliced page still produces byte-identical MIDI.
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

// User-authored custom patterns: column digit 9 on rows D and P. A pattern is
// 16 steps of 16ths x 5 lanes = exactly ONE bar; the transport cycle is 2
// bars, so it sounds twice per cycle — segments walk it bar by bar.
// Lane order is the cross-file contract (LoopGridCustomPattern.ts):
//   Kick / Snare / Hat / Clap / Shaker -> GM 36 / 38 / 42 / 39 / 70.
const CUSTOM_COL = 9;
const CUSTOM_LANES = 5;
const CUSTOM_STEPS = 16;
const CUSTOM_LANE_NOTES = [36, 38, 42, 39, 70];
const CUSTOM_LANE_VELS = [112, 105, 96, 104, 90]; // patterns carry no velocity
const CUSTOM_ROW_LETTERS = new Set(['D', 'P']);

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
 * Unpack a 20-hex-char custom pattern into [lane][step] booleans.
 * Mirror of LoopGridCustomPattern.pack() in Assets/Scripts — 4 hex digits per
 * lane, 16 bits each, step 0 is the MOST significant bit. Keep in lockstep.
 */
function unpackPattern(packed) {
  if (!/^[0-9A-F]{20}$/.test(packed)) {
    throw new Error('Bad custom pattern "' + packed + '" — expected 20 uppercase hex characters.');
  }
  const lanes = [];
  for (let l = 0; l < CUSTOM_LANES; l++) {
    const bits = parseInt(packed.substring(l * 4, l * 4 + 4), 16);
    const lane = [];
    for (let s = 0; s < CUSTOM_STEPS; s++) {
      lane.push((bits & (1 << (CUSTOM_STEPS - 1 - s))) !== 0);
    }
    lanes.push(lane);
  }
  return lanes;
}

/**
 * Parse and validate an LG1 code.
 * Returns { bpm, key, timeline: [{bar, changes: [{row, col}]}], endBar,
 * patterns: {D?, P?} (unpacked [lane][step] booleans) }.
 * `col` is 1..8, 9 for the row's CUSTOM pattern (D/P only), or 0 for "row
 * stops". Throws with a clear message on any malformed input — most
 * importantly on a checksum mismatch, so a mis-copied character can never
 * become a silently wrong arrangement.
 */
function parseLG1(code) {
  const trimmed = String(code).trim();
  const parts = trimmed.split('|');
  if (parts.length !== 7) {
    throw new Error(
      'Not an LG1 code: expected 7 "|" segments (LG1|bpm|key|timeline|END:n|PAT:...|checksum), got ' +
      parts.length + (parts.length === 6
        ? '. This looks like a code from an older LoopGrid build without the PAT segment — re-export from the current Lens.'
        : '')
    );
  }
  const body = parts.slice(0, 6).join('|');
  const expect = lg1Checksum(body);
  if (parts[6] !== expect) {
    throw new Error(
      'LG1 checksum mismatch: code ends with "' + parts[6] + '" but its content hashes to "' +
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

  const customUsed = new Set(); // row letters that launch col 9
  const timeline = [];
  if (parts[3] !== '-') {
    for (const entry of parts[3].split(';')) {
      const m = /^(\d+):([DBKLP][0-9](?:,[DBKLP][0-9])*)$/.exec(entry);
      if (!m) throw new Error('Bad timeline entry "' + entry + '"');
      const bar = Number(m[1]);
      if (bar > endBar) throw new Error('Timeline bar ' + bar + ' is past END:' + endBar);
      const changes = m[2].split(',').map((c) => {
        const col = Number(c[1]);
        if (col === CUSTOM_COL && !CUSTOM_ROW_LETTERS.has(c[0])) {
          throw new Error(
            'Bad cell code "' + c + '": only Drums (D9) and Perc (P9) have a custom pattern.'
          );
        }
        if (col === CUSTOM_COL) customUsed.add(c[0]);
        return { row: ROW_LETTERS.indexOf(c[0]), col };
      });
      timeline.push({ bar, changes });
    }
    timeline.sort((a, b) => a.bar - b.bar);
  }

  // PAT segment: "-" or comma-separated <letter>=<20 hex> entries. Strict
  // cross-check both ways — a D9 with no pattern (or vice versa) is a
  // malformed export, never something to guess around.
  const patMatch = /^PAT:(.*)$/.exec(parts[5]);
  if (!patMatch) throw new Error('Bad PAT segment "' + parts[5] + '"');
  const patterns = {};
  if (patMatch[1] !== '-') {
    for (const entry of patMatch[1].split(',')) {
      const pm = /^([DP])=([0-9A-F]{20})$/.exec(entry);
      if (!pm) throw new Error('Bad PAT entry "' + entry + '" — expected D=<20 hex> or P=<20 hex>.');
      if (patterns[pm[1]] !== undefined) throw new Error('Duplicate PAT entry for ' + pm[1]);
      patterns[pm[1]] = unpackPattern(pm[2]);
    }
  }
  for (const letter of customUsed) {
    if (!patterns[letter]) {
      throw new Error('Timeline launches ' + letter + '9 but the PAT segment has no ' + letter + ' pattern.');
    }
  }
  for (const letter of Object.keys(patterns)) {
    if (!customUsed.has(letter)) {
      throw new Error('PAT segment carries a ' + letter + ' pattern but ' + letter + '9 never appears in the timeline.');
    }
  }

  return { bpm, key, timeline, endBar, patterns };
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

/**
 * Distinct cells a parsed session launches, for the Live Loops rebuild list.
 * Loop cells (col 1..8) yield { row, name, col, file } where file is the
 * "Row-Col.wav" name used by docs/loops/ and GarageBandTest/reference-audio/
 * (1-based col, matching the LG1 code digit). Custom cells (D9/P9) have no
 * WAV and yield { row, name, custom: true } — their exact rendition is the
 * row's MIDI stem. Stops (col 0) are not cells. Sorted by row, then column.
 */
function cellWavList(parsed) {
  const seen = new Set();
  const out = [];
  for (const ev of parsed.timeline) {
    for (const ch of ev.changes) {
      if (ch.col === 0) continue;
      const key = ch.row + ':' + ch.col;
      if (seen.has(key)) continue;
      seen.add(key);
      if (ch.col === CUSTOM_COL) {
        out.push({ row: ch.row, name: ROW_NAMES[ch.row], custom: true });
      } else {
        out.push({
          row: ch.row,
          name: ROW_NAMES[ch.row],
          col: ch.col,
          file: ROW_NAMES[ch.row] + '-' + ch.col + '.wav',
        });
      }
    }
  }
  out.sort((a, b) => a.row - b.row || (a.col || CUSTOM_COL) - (b.col || CUSTOM_COL));
  return out;
}

/** Expand one CUSTOM segment (col 9) from an unpacked [lane][step] pattern.
 *  The 16-step pattern is exactly one bar, so it repeats EVERY bar of the
 *  segment (twice per 2-bar transport cycle). One 16th = TPQ/4 ticks. */
function notesForCustomSegment(pattern, seg) {
  const notes = [];
  const stepTicks = TICKS_PER_QUARTER / 4; // 120
  for (let bar = seg.startBar; bar < seg.endBar; bar += 1) {
    for (let lane = 0; lane < CUSTOM_LANES; lane++) {
      for (let s = 0; s < CUSTOM_STEPS; s++) {
        if (!pattern[lane][s]) continue;
        notes.push({
          tick: bar * BEATS_PER_BAR * TICKS_PER_QUARTER + s * stepTicks,
          durTicks: stepTicks,
          pitch: CUSTOM_LANE_NOTES[lane],
          velocity: CUSTOM_LANE_VELS[lane],
        });
      }
    }
  }
  return notes;
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

/** Tempo + 4/4 + A-minor bytes, shared by the meta track and every stem. */
function metaBytes(bpm) {
  const usPerQuarter = Math.round(60000000 / bpm); // 105 BPM -> 571429
  const b = [];
  b.push(0x00, 0xff, 0x51, 0x03,
    (usPerQuarter >> 16) & 0xff, (usPerQuarter >> 8) & 0xff, usPerQuarter & 0xff);
  b.push(0x00, 0xff, 0x58, 0x04, 0x04, 0x02, 0x18, 0x08); // 4/4
  b.push(0x00, 0xff, 0x59, 0x02, 0x00, 0x01); // 0 sharps/flats, minor -> A minor
  return b;
}

/** Track name + optional program + interleaved note on/off bytes. */
function noteBytes(name, channel, program, notes) {
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
  return b;
}

function smfHeader(format, ntrks) {
  const header = Buffer.alloc(14);
  header.write('MThd');
  header.writeUInt32BE(6, 4);
  header.writeUInt16BE(format, 8);
  header.writeUInt16BE(ntrks, 10);
  header.writeUInt16BE(TICKS_PER_QUARTER, 12);
  return header;
}

/** Parse + validate the code and expand it to per-row note lists.
 *  Returns { parsed, rowNotes } where rowNotes[r] is sorted, possibly []. */
function arrangeNotes(code, loopsJson) {
  const parsed = parseLG1(code);
  if (loopsJson.bpm !== parsed.bpm) {
    throw new Error(
      'Code bpm ' + parsed.bpm + ' does not match loops.json bpm ' + loopsJson.bpm +
      ' — code and loop table are from different builds.'
    );
  }
  const segments = buildArrangement(parsed.timeline, parsed.endBar);
  const rowNotes = [];
  for (let r = 0; r < 5; r++) {
    let notes = [];
    for (const seg of segments[r]) {
      if (seg.col === CUSTOM_COL) {
        // parseLG1 guarantees the pattern exists for every D9/P9 launch.
        notes = notes.concat(notesForCustomSegment(parsed.patterns[ROW_LETTERS[r]], seg));
      } else {
        notes = notes.concat(
          notesForSegment(loopsJson.loops[r][seg.col - 1], seg, DRUM_ROWS.has(r))
        );
      }
    }
    notes.sort((a, b) => a.tick - b.tick || a.pitch - b.pitch);
    rowNotes.push(notes);
  }
  return { parsed, rowNotes };
}

/** LG1 code + loops table -> combined-arrangement SMF bytes (Buffer).
 *  Format 1: meta track, then one track per row that has notes — rows with
 *  zero notes are omitted so GarageBand never creates empty Keyboard tracks. */
function codeToMidi(code, loopsJson) {
  const { parsed, rowNotes } = arrangeNotes(code, loopsJson);
  const chunks = [trackChunk(metaBytes(parsed.bpm))];
  for (let r = 0; r < 5; r++) {
    if (rowNotes[r].length === 0) continue;
    chunks.push(trackChunk(noteBytes(ROW_NAMES[r], ROW_CHANNELS[r], ROW_PROGRAMS[r], rowNotes[r])));
  }
  return Buffer.concat([smfHeader(1, chunks.length), ...chunks]);
}

/** LG1 code + loops table -> per-row single-track stems.
 *  Returns [{ row, name, midi }] for rows that have notes (others omitted).
 *  Each stem is a format-0 SMF whose ONE track carries tempo/4-4/Am plus the
 *  row's notes — single-track on purpose: GarageBand iOS only lands drums on
 *  a drum kit when a single-track file is dropped onto a Drums track. */
function codeToStems(code, loopsJson) {
  const { parsed, rowNotes } = arrangeNotes(code, loopsJson);
  const stems = [];
  for (let r = 0; r < 5; r++) {
    if (rowNotes[r].length === 0) continue;
    const track = trackChunk(
      metaBytes(parsed.bpm).concat(
        noteBytes(ROW_NAMES[r], ROW_CHANNELS[r], ROW_PROGRAMS[r], rowNotes[r])
      )
    );
    stems.push({ row: r, name: ROW_NAMES[r], midi: Buffer.concat([smfHeader(0, 1), track]) });
  }
  return stems;
}

function loadLoops() {
  return JSON.parse(fs.readFileSync(path.join(__dirname, 'loops.json'), 'utf8'));
}

// ── CLI ──────────────────────────────────────────────────────────────────────

function main() {
  const argv = process.argv.slice(2);
  const stemsMode = argv[0] === '--stems';
  const [code, outPath] = stemsMode ? argv.slice(1) : argv;
  if (!code || !outPath) {
    console.error('Usage: node tools/loopgrid-midi.js "<LG1 code from the export panel>" out.mid');
    console.error('       node tools/loopgrid-midi.js --stems "<LG1 code>" out.mid');
    console.error('  --stems writes one single-track file per playing row');
    console.error('  (out-Drums.mid, out-Bass.mid, ...) instead of one combined file.');
    process.exit(2);
  }
  try {
    const loops = loadLoops();
    if (stemsMode) {
      const stems = codeToStems(code, loops);
      if (stems.length === 0) {
        console.error('ERROR: this code contains no notes — nothing to write.');
        process.exit(1);
      }
      const base = outPath.replace(/\.midi?$/i, '');
      for (const s of stems) {
        const p = base + '-' + s.name + '.mid';
        fs.writeFileSync(p, s.midi);
        console.log('Wrote ' + p + ' (' + s.midi.length + ' bytes)');
      }
      console.log(stems.length + ' stem(s). In GarageBand, drop ' + base +
        '-Drums.mid (and -Perc) onto a Drums track so they land on a kit.');
    } else {
      const midi = codeToMidi(code, loops);
      fs.writeFileSync(outPath, midi);
      console.log('Wrote ' + outPath + ' (' + midi.length + ' bytes). Open it in GarageBand.');
    }
  } catch (e) {
    console.error('ERROR: ' + e.message);
    process.exit(1);
  }
}

module.exports = { lg1Checksum, parseLG1, unpackPattern, buildArrangement, notesForSegment, cellWavList, codeToMidi, codeToStems, loadLoops, ROW_NAMES };

if (require.main === module) main();
