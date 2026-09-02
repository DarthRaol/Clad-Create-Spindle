/**
 * LoopGridTransport — pure transport clock for LoopGrid. NO engine imports.
 *
 * Owns: musical time (beats/bars) accumulated from per-frame delta time, and
 * downbeat (loop-boundary) detection for quantized cell launches.
 * Must NOT: touch the scene, audio, or UI.
 *
 * HONEST TIMING NOTE (read before "improving" this):
 * The Specs Lens runtime has only a per-frame UpdateEvent (~30-60 fps) and
 * AudioComponent.play() is immediate — there is NO look-ahead scheduler and NO
 * sample-accurate clock available to scripts. This clock accumulates
 * getDeltaTime() and reports a downbeat on the FIRST FRAME AT OR AFTER the
 * loop boundary. Launch timing jitter is therefore bounded by one frame
 * (~16-33 ms) and cannot be eliminated at the script layer. The fractional
 * overshoot is carried over (acc -= loopBeats) so the CLOCK itself does not
 * drift — only the frame at which we observe each boundary jitters.
 *
 * The same limit applies MUCH harder to the 16th-note step crossings this
 * clock also reports (for user-authored drum patterns): at 105 BPM a 16th
 * note is ~143 ms, so the one-frame jitter is 11-23% OF A STEP on every
 * single hit. Custom-pattern playback in the Lens is therefore an
 * approximate sketch of the pattern, never tight — the exact rendition is
 * the MIDI export. Do not write code, comments, or UI copy claiming
 * otherwise.
 */
export class LoopGridTransport {
  /** Beats per loop cycle: 2 bars of 4/4. All 40 WAV loops are exactly this long. */
  readonly beatsPerCycle: number = 8

  readonly bpm: number

  private _running: boolean = false
  /** Beats elapsed inside the current cycle [0, beatsPerCycle). */
  private cycleBeats: number = 0
  /** Total beats elapsed since start(). */
  private _totalBeats: number = 0
  /** Completed cycles since start(). */
  private _cycleIndex: number = 0
  /** Last 16th-note index observed (floor(totalBeats*4)); -1 = none yet, so
   *  the first advance() after start() reports step 0. */
  private lastSixteenth: number = -1
  /** Step crossings (cycle-relative 16th indices, 0..31) since takeSteps(). */
  private crossedSteps: number[] = []

  constructor(bpm: number) {
    this.bpm = bpm
  }

  get running(): boolean {
    return this._running
  }

  /** Musical bar number, 1-based (4 beats per bar). */
  get barNumber(): number {
    return Math.floor(this._totalBeats / 4) + 1
  }

  /** Beat within the current bar, 1-based (1..4). */
  get beatInBar(): number {
    return Math.floor(this._totalBeats % 4) + 1
  }

  /** Completed loop cycles (each = 2 bars). */
  get cycleIndex(): number {
    return this._cycleIndex
  }

  /** 0..1 phase within the current cycle — used by the UI armed-cell pulse. */
  get cyclePhase(): number {
    return this.cycleBeats / this.beatsPerCycle
  }

  /** Start the clock at beat 0. The caller treats the start instant as a downbeat. */
  start(): void {
    this._running = true
    this.cycleBeats = 0
    this._totalBeats = 0
    this._cycleIndex = 0
    this.lastSixteenth = -1
    this.crossedSteps.length = 0
  }

  stop(): void {
    this._running = false
    this.crossedSteps.length = 0
  }

  /**
   * 16th-note crossings observed since the last call, as cycle-relative step
   * indices 0..31 (the cycle is 2 bars = 32 sixteenths; a 16-step 1-bar
   * pattern uses index % 16). Reported on the FIRST FRAME AT OR AFTER each
   * step boundary, so every hit carries the one-frame jitter quantified in
   * the header — 11-23% of a step at 105 BPM. Returns [] most frames.
   * Clears the queue: one consumer (the controller) owns this.
   */
  takeSteps(): number[] {
    if (this.crossedSteps.length === 0) return this.crossedSteps
    const out = this.crossedSteps.slice()
    this.crossedSteps.length = 0
    return out
  }

  /**
   * Advance by dt seconds. Returns true when a loop boundary (downbeat) was
   * crossed during this frame. The overshoot past the boundary is preserved so
   * boundary-to-boundary spacing averages exactly beatsPerCycle — jitter is
   * per-observation only (see the header note), it does not accumulate.
   */
  advance(dtSeconds: number): boolean {
    if (!this._running) return false
    const beats = dtSeconds * (this.bpm / 60)
    this.cycleBeats += beats
    this._totalBeats += beats
    // 16th-note crossings for custom-pattern playback. On a pathological
    // frame hitch only the most recent 2 steps are queued — replaying a
    // backlog of stale hits after a stall sounds worse than dropping them.
    const cur = Math.floor(this._totalBeats * 4)
    if (cur > this.lastSixteenth) {
      const first = Math.max(this.lastSixteenth + 1, cur - 1)
      for (let s = first; s <= cur; s++) {
        this.crossedSteps.push(s % (this.beatsPerCycle * 4))
      }
      this.lastSixteenth = cur
    }
    if (this.cycleBeats >= this.beatsPerCycle) {
      this.cycleBeats -= this.beatsPerCycle
      // A pathological frame hitch (> one full cycle) would still only report
      // one downbeat; clamp the remainder so we never report stale boundaries.
      if (this.cycleBeats >= this.beatsPerCycle) {
        this.cycleBeats = this.cycleBeats % this.beatsPerCycle
      }
      this._cycleIndex += 1
      return true
    }
    return false
  }
}
