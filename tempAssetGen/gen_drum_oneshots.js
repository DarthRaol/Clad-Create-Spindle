// LoopGrid custom-pattern one-shots: 5 short drum hits for the 16-step editor.
// Kick / Snare / Hat / Clap / Shaker — the same build-music voices the loop
// rows use, so a custom pattern sits in the same sonic family as the
// pre-rendered loops. Mono (hits carry no meaningful stereo), trimmed to
// content, peak-normalized per hit. These are HITS, not loops: the editor
// triggers them via AudioComponent.play(1) on step crossings.
//
// GM note identity (must match tools/loopgrid-midi.js CUSTOM_LANE_NOTES and
// the lane order in LoopGridCustomPattern.ts):
//   lane 0 Kick   -> GM 36
//   lane 1 Snare  -> GM 38
//   lane 2 Hat    -> GM 42 (closed)
//   lane 3 Clap   -> GM 39
//   lane 4 Shaker -> GM 70
'use strict';
const fs = require('fs');
const path = require('path');
const ENGINE = 'C:/Users/Raol/.claude/plugins/cache/ls-extensions/ls-clad/1.0.0/skills/build-music/tools';
const m = require(ENGINE);
const PROJECT_ASSETS_SFX = 'C:/Users/Raol/Documents/SPECS/Spindle/Assets/GeneratedSFX';
fs.mkdirSync(PROJECT_ASSETS_SFX, { recursive: true });

const BPM = 105;
const SR = 44100;
const MAX_SECONDS = 0.6; // hard cap — one-shots stay short

// [name, DRUM_MAP key, fx, velocity]
const LANES = [
  ['Hit_Kick',   'kick',   { lpf: 5000, gain: 0.9 }, 112],
  ['Hit_Snare',  'snare',  { hpf: 150, gain: 0.85 }, 105],
  ['Hit_Hat',    'hh',     { hpf: 2500, gain: 0.7 }, 96],
  ['Hit_Clap',   'clap',   { hpf: 500, gain: 0.8 }, 104],
  ['Hit_Shaker', 'shaker', { hpf: 1800, gain: 0.7 }, 90],
];

function trimMono(out) {
  const L = out.left || out;
  const R = out.right || L;
  const cap = Math.min(L.length, Math.round(MAX_SECONDS * SR));
  // last sample above -60 dBFS, then a 5 ms fade so the cut is click-free
  let last = 0;
  for (let i = 0; i < cap; i++) {
    if (Math.abs(L[i]) > 0.001 || Math.abs(R[i]) > 0.001) last = i;
  }
  const n = Math.min(cap, last + 1 + Math.round(0.005 * SR));
  const mono = new Float32Array(n);
  for (let i = 0; i < n; i++) mono[i] = 0.5 * (L[i] + R[i]);
  const fade = Math.round(0.005 * SR);
  for (let i = 0; i < fade && i < n; i++) mono[n - 1 - i] *= i / fade;
  return mono;
}

for (const [name, key, fx, velocity] of LANES) {
  const e = m.DRUM_MAP[key];
  if (!e) throw new Error('DRUM_MAP missing ' + key);
  // quantize strict + pinned seed: the hit renders identically on every run
  const track = m.track(name, e.voice,
    [{ time: 0, beats: 0.25, value: e.midi, velocity }],
    { fx, quantize: 'strict', seed: 1 });
  const out = m.render([track], { bpm: BPM, master: { normalize: 'peak' } });
  const mono = trimMono(out);
  m.WavBuilder.write(mono, path.join(PROJECT_ASSETS_SFX, name + '.wav'));
  let peak = 0;
  for (let i = 0; i < mono.length; i++) peak = Math.max(peak, Math.abs(mono[i]));
  console.log(name, (mono.length / SR).toFixed(3) + 's', 'peak', peak.toFixed(3), peak < 0.1 ? 'WARN_QUIET' : 'ok');
}
console.log('DONE');
