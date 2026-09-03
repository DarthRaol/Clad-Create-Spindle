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
 *   LG1|<bpm>|<key>|<bar>:<codes>[,<codes>...];...|END:<lastBar>|PAT:<pats>|<checksum>
 * Cell code = row letter + column digit; column 0 = row stop.
 *   Rows: D=Drums B=Bass K=Keys L=Lead P=Perc. Columns 1..8 are the loop
 *   grid; digit 9 (D9/P9 only) is the row's user-authored CUSTOM pattern.
 * PAT segment: "-" when no custom cell was launched; otherwise
 * comma-separated <letter>=<20 hex chars> entries (D and/or P), each the
 * LoopGridCustomPattern.pack() of that row's 16-step x 5-lane pattern —
 * 4 hex digits per lane (step 0 = MSB), lanes Kick,Snare,Hat,Clap,Shaker.
 * The pattern is captured AT EXPORT TIME: if the user edited it after
 * launching, the export carries the edited version for every D9/P9 launch
 * (live-edit semantics — the Lens also plays edits immediately). The D9/P9
 * timeline bar is the downbeat after the FIRST STEP WAS DRAWN (drawing into
 * an empty pattern is what arms the cell — opening the editor is not an
 * arm), so an export never contains a launch of pure silence.
 * The final segment is ONE base-36 character: FNV-1a 32-bit over everything
 * before its "|" separator, mod 36. The companion tool refuses a code whose
 * checksum does not match, so a mis-copied character errors out instead of
 * decoding into a silently wrong arrangement. tools/loopgrid-midi.js holds
 * the mirror implementation — keep the two in lockstep.
 * Example:
 *   LG1|105|Am|0:D9,B1;4:K3;8:D0|END:12|PAT:D=8888008820AA00008000|D
 *   -> bar 0: custom drum pattern + bass col1; bar 4: keys col3; bar 8 drums
 *      stop; 12 bars total; the D pattern rides in the PAT segment.
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

/** Packed custom patterns by row letter (only D and P can occur). */
export interface CustomPatternExports {
  D?: string
  P?: string
}

export class LoopGridExportEncoder {
  encode(
    timeline: TimelineEvent[],
    bpm: number,
    key: string,
    lastBar: number,
    patterns?: CustomPatternExports
  ): string {
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
    body += "|" + this.patSegment(timeline, patterns)
    return body + "|" + lg1Checksum(body)
  }

  /** PAT segment: pattern entries for exactly the letters whose custom cell
   *  (letter+9) appears in the timeline; "-" when none do. Emitting only
   *  referenced patterns keeps codes short and keeps the companion tool's
   *  strict cross-check (every D9/P9 must have a pattern, every pattern a
   *  D9/P9) satisfiable. */
  private patSegment(timeline: TimelineEvent[], patterns?: CustomPatternExports): string {
    const entries: string[] = []
    for (const letter of ["D", "P"]) {
      const used = timeline.some((ev) => ev.codes.indexOf(letter + "9") >= 0)
      if (!used) continue
      const packed = patterns ? (patterns as Record<string, string | undefined>)[letter] : undefined
      // A used custom cell with no pattern would make the code undecodable —
      // encode an explicitly empty pattern rather than emit a broken segment.
      entries.push(letter + "=" + (packed !== undefined ? packed : "00000000000000000000"))
    }
    return "PAT:" + (entries.length > 0 ? entries.join(",") : "-")
  }
}
