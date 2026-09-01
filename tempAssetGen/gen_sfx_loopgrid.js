// LoopGrid UI SFX: CellArm (soft rising tick) + CellStop (soft falling click)
'use strict';
const fs = require('fs');
const path = require('path');
const ENGINE = 'C:/Users/Raol/.claude/plugins/cache/ls-extensions/ls-clad/1.0.0/skills/build-sfx/tools';
const audio = require(ENGINE);
const PROJECT_ASSETS_SFX = 'C:/Users/Raol/Documents/SPECS/Spindle/Assets/GeneratedSFX';
fs.mkdirSync(PROJECT_ASSETS_SFX, { recursive: true });

function peak(b) {
  const chans = b.left ? [b.left, b.right] : [b];
  let p = 0; for (const c of chans) for (let i = 0; i < c.length; i++) { const a = Math.abs(c[i]); if (a > p) p = a; }
  return p;
}
function writeOne(name, buf) {
  audio.mix_bus.masterChain(buf, { normalize: 'peak' });
  audio.WavBuilder.write(buf, path.join(PROJECT_ASSETS_SFX, name + '.wav'));
  console.log(name, 'peak', peak(buf).toFixed(3));
}

writeOne('CellArm', audio.sfx_presets.uiClick({ character: 'soft', pitch: 3 }));
writeOne('CellStop', audio.sfx_presets.uiClick({ character: 'soft', pitch: -4 }));
console.log('DONE');
