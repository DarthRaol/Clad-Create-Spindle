/**
 * LoopGridExportEncoder — pure session -> text encoding. NO engine imports.
 *
 * The Lens has NO filesystem and NO local network access, so "export" is a
 * compact human-readable code shown on a panel. A companion tool (which ships
 * with the same 40 loop definitions: key Am, 105 BPM, 2-bar loops, shared
 * Am-F-C-G progression) parses this code and writes a MIDI arrangement the
 * user opens in GarageBand on iOS.
 *
 * Format (pipe-separated header, semicolon-separated timeline):
 *   LG1|<bpm>|<key>|<bar>:<codes>[,<codes>...];...|END:<lastBar>|<checksum>
 * Cell code = row letter + column digit; column 0 = row stop.
 *   Rows: D=Drums B=Bass K=Keys L=Lead P=Perc. Columns 1..8.
 * The final segment is ONE base-36 character: FNV-1a 32-bit over everything
 * before its "|" separator, mod 36. The companion tool refuses a code whose
 * checksum does not match, so a mis-copied character errors out instead of
 * decoding into a silently wrong arrangement. tools/loopgrid-midi.js holds
 * the mirror implementation — keep the two in lockstep.
 * Example:
 *   LG1|105|Am|0:D1,B1;4:K3,L5;8:D4;12:D0,B0|END:16|Q
 *   -> bar 0: drums col1 + bass col1; bar 4: keys col3 + lead col5;
 *      bar 8: drums switch to col4; bar 12: drums+bass stop; session 16 bars.
 */

import { TimelineEvent } from "./LoopGridModel"

const BASE36 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ"

/** FNV-1a 32-bit of `body`, folded to one base-36 character. Mirrored in
 *  tools/loopgrid-midi.js (lg1Checksum) — change both together or exports
 *  stop validating. */
function lg1Checksum(body: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < body.length; i++) {
    h ^= body.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return BASE36[(h >>> 0) % 36]
}

export class LoopGridExportEncoder {
  encode(timeline: TimelineEvent[], bpm: number, key: string, lastBar: number): string {
    let body: string
    if (timeline.length === 0) {
      body = "LG1|" + bpm + "|" + key + "|-|END:0"
    } else {
      const parts: string[] = []
      for (const ev of timeline) {
        parts.push(ev.bar + ":" + ev.codes.join(","))
      }
      body = "LG1|" + bpm + "|" + key + "|" + parts.join(";") + "|END:" + lastBar
    }
    return body + "|" + lg1Checksum(body)
  }
}
