/**
 * LoopGridCustomPattern — pure user-authored drum pattern state. NO engine
 * imports (matches LoopGridTransport / LoopGridModel / LoopGridExportEncoder).
 *
 * One pattern = 16 steps of 16th notes x 5 lanes = exactly ONE bar of 4/4.
 * The transport cycle is 2 bars, so a playing pattern sounds twice per cycle —
 * this preserves the even-bar invariant every loop and export bar count relies
 * on. Rows 0 (Drums) and 4 (Perc) each own one instance.
 *
 * Lane order is a cross-file contract (same order everywhere):
 *   0 Kick / 1 Snare / 2 Hat / 3 Clap / 4 Shaker
 * -> GM notes 36 / 38 / 42 / 39 / 70 in tools/loopgrid-midi.js, and
 * -> Hit_Kick..Hit_Shaker.wav from tempAssetGen/gen_drum_oneshots.js.
 *
 * pack()/unpack() is the wire format used inside LG1 export codes: 4 hex
 * digits per lane (16 steps = 16 bits, step 0 is the MOST significant bit so
 * the hex reads left-to-right like the editor), 5 lanes concatenated = 20
 * uppercase hex chars. Mirrored in tools/loopgrid-midi.js (unpackPattern) —
 * change both together or exports stop decoding.
 */

export const CUSTOM_STEPS = 16
export const CUSTOM_LANES = 5
export const CUSTOM_LANE_NAMES = ["Kick", "Snare", "Hat", "Clap", "Shaker"]

const HEX = "0123456789ABCDEF"

export class LoopGridCustomPattern {
  /** [lane][step] — true = hit. */
  private steps: boolean[][] = []

  constructor() {
    for (let l = 0; l < CUSTOM_LANES; l++) {
      const lane: boolean[] = []
      for (let s = 0; s < CUSTOM_STEPS; s++) lane.push(false)
      this.steps.push(lane)
    }
  }

  get(lane: number, step: number): boolean {
    return this.steps[lane][step]
  }

  /** Flip one step; returns the new value. */
  toggle(lane: number, step: number): boolean {
    this.steps[lane][step] = !this.steps[lane][step]
    return this.steps[lane][step]
  }

  clear(): void {
    for (let l = 0; l < CUSTOM_LANES; l++) {
      for (let s = 0; s < CUSTOM_STEPS; s++) this.steps[l][s] = false
    }
  }

  isEmpty(): boolean {
    for (let l = 0; l < CUSTOM_LANES; l++) {
      for (let s = 0; s < CUSTOM_STEPS; s++) {
        if (this.steps[l][s]) return false
      }
    }
    return true
  }

  /** Lanes that hit on `step` (0..15). Allocation-free callers should prefer
   *  get() in a loop; this is a convenience for tests. */
  lanesAt(step: number): number[] {
    const out: number[] = []
    for (let l = 0; l < CUSTOM_LANES; l++) {
      if (this.steps[l][step]) out.push(l)
    }
    return out
  }

  /** 20 uppercase hex chars: per lane, 16 bits with step 0 as the MSB. */
  pack(): string {
    let out = ""
    for (let l = 0; l < CUSTOM_LANES; l++) {
      let bits = 0
      for (let s = 0; s < CUSTOM_STEPS; s++) {
        if (this.steps[l][s]) bits |= 1 << (CUSTOM_STEPS - 1 - s)
      }
      out += HEX[(bits >> 12) & 0xf] + HEX[(bits >> 8) & 0xf] + HEX[(bits >> 4) & 0xf] + HEX[bits & 0xf]
    }
    return out
  }

  /** Load from a pack() string. Returns false (state unchanged) on malformed
   *  input; the caller decides how to surface that. */
  unpack(packed: string): boolean {
    if (typeof packed !== "string" || !/^[0-9A-F]{20}$/.test(packed)) return false
    for (let l = 0; l < CUSTOM_LANES; l++) {
      const bits = parseInt(packed.substring(l * 4, l * 4 + 4), 16)
      for (let s = 0; s < CUSTOM_STEPS; s++) {
        this.steps[l][s] = (bits & (1 << (CUSTOM_STEPS - 1 - s))) !== 0
      }
    }
    return true
  }
}
