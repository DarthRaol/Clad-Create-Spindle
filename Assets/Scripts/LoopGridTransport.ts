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
  }

  stop(): void {
    this._running = false
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
