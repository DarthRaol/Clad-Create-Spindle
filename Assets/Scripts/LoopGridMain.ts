/**
 * LoopGridMain — THE single @component of the LoopGrid experience.
 *
 * A GarageBand-style Live Loops grid for Specs: 5 instrument rows x 8 scene
 * columns of pre-rendered loops (one key: A minor, one tempo: 105 BPM, all
 * exactly 2 bars = 201600 samples at 44.1 kHz, so every combination is
 * harmonically and rhythmically compatible).
 *
 * Owns: lifecycle, the 12 AudioComponents (5 rows x 2 pooled loop slots +
 * 2 tap SFX — see the pool comment at rowSlots), the
 * per-frame transport tick, and orchestration between the pure-logic modules
 * (LoopGridTransport / LoopGridModel / LoopGridExportEncoder) and the UI
 * modules (LoopGridUI / LoopGridExportPanelUI).
 * Must NOT: contain layout code (UI modules own that) or musical state
 * transitions (the model owns those).
 *
 * Architecture rule honored here: onAwake ONLY calls createEvent(); every
 * property write and every subscription happens in the OnStartEvent handler.
 *
 * SYNC DESIGN (honest about platform limits — no sample accuracy possible):
 * - Every loop WAV is exactly the transport cycle length, so loops launched
 *   together stay aligned by construction (same audio clock, same length).
 * - A tapped cell is ARMED and fires on the first frame at/after the next
 *   downbeat — launch jitter is bounded by one frame (~16-33 ms), the best
 *   the per-frame UpdateEvent allows (no look-ahead scheduling exists).
 * - On every downbeat that applies changes, ALL active loops are restarted in
 *   the same frame, so the entire mix shares a single launch instant and any
 *   transport-vs-audio-clock drift accumulated since the last change is
 *   cancelled. Between changes, loops free-run seamlessly (no restarts, no
 *   recurring stutter).
 * - NO runtime synthesis, NO DSP: AudioComponent exposes volume only; every
 *   sound here is a pre-rendered WAV asset.
 */

import { LoopGridTransport } from "./LoopGridTransport"
import { LoopGridModel, LOOPGRID_ROWS, LOOPGRID_COLS } from "./LoopGridModel"
import { LoopGridExportEncoder } from "./LoopGridExportEncoder"
import { LoopGridUI, CellState } from "./LoopGridUI"
import { LoopGridExportPanelUI } from "./LoopGridExportPanelUI"

// ── Loop assets: [row][col], rows = Drums, Bass, Keys, Lead, Perc ────────────
// requireAsset takes string literals only, hence the explicit 40-entry table.
const LOOP_TRACKS: AudioTrackAsset[][] = [
  [
    requireAsset("../GeneratedSFX/Loop_R0C0.wav") as AudioTrackAsset,
    requireAsset("../GeneratedSFX/Loop_R0C1.wav") as AudioTrackAsset,
    requireAsset("../GeneratedSFX/Loop_R0C2.wav") as AudioTrackAsset,
    requireAsset("../GeneratedSFX/Loop_R0C3.wav") as AudioTrackAsset,
    requireAsset("../GeneratedSFX/Loop_R0C4.wav") as AudioTrackAsset,
    requireAsset("../GeneratedSFX/Loop_R0C5.wav") as AudioTrackAsset,
    requireAsset("../GeneratedSFX/Loop_R0C6.wav") as AudioTrackAsset,
    requireAsset("../GeneratedSFX/Loop_R0C7.wav") as AudioTrackAsset,
  ],
  [
    requireAsset("../GeneratedSFX/Loop_R1C0.wav") as AudioTrackAsset,
    requireAsset("../GeneratedSFX/Loop_R1C1.wav") as AudioTrackAsset,
    requireAsset("../GeneratedSFX/Loop_R1C2.wav") as AudioTrackAsset,
    requireAsset("../GeneratedSFX/Loop_R1C3.wav") as AudioTrackAsset,
    requireAsset("../GeneratedSFX/Loop_R1C4.wav") as AudioTrackAsset,
    requireAsset("../GeneratedSFX/Loop_R1C5.wav") as AudioTrackAsset,
    requireAsset("../GeneratedSFX/Loop_R1C6.wav") as AudioTrackAsset,
    requireAsset("../GeneratedSFX/Loop_R1C7.wav") as AudioTrackAsset,
  ],
  [
    requireAsset("../GeneratedSFX/Loop_R2C0.wav") as AudioTrackAsset,
    requireAsset("../GeneratedSFX/Loop_R2C1.wav") as AudioTrackAsset,
    requireAsset("../GeneratedSFX/Loop_R2C2.wav") as AudioTrackAsset,
    requireAsset("../GeneratedSFX/Loop_R2C3.wav") as AudioTrackAsset,
    requireAsset("../GeneratedSFX/Loop_R2C4.wav") as AudioTrackAsset,
    requireAsset("../GeneratedSFX/Loop_R2C5.wav") as AudioTrackAsset,
    requireAsset("../GeneratedSFX/Loop_R2C6.wav") as AudioTrackAsset,
    requireAsset("../GeneratedSFX/Loop_R2C7.wav") as AudioTrackAsset,
  ],
  [
    requireAsset("../GeneratedSFX/Loop_R3C0.wav") as AudioTrackAsset,
    requireAsset("../GeneratedSFX/Loop_R3C1.wav") as AudioTrackAsset,
    requireAsset("../GeneratedSFX/Loop_R3C2.wav") as AudioTrackAsset,
    requireAsset("../GeneratedSFX/Loop_R3C3.wav") as AudioTrackAsset,
    requireAsset("../GeneratedSFX/Loop_R3C4.wav") as AudioTrackAsset,
    requireAsset("../GeneratedSFX/Loop_R3C5.wav") as AudioTrackAsset,
    requireAsset("../GeneratedSFX/Loop_R3C6.wav") as AudioTrackAsset,
    requireAsset("../GeneratedSFX/Loop_R3C7.wav") as AudioTrackAsset,
  ],
  [
    requireAsset("../GeneratedSFX/Loop_R4C0.wav") as AudioTrackAsset,
    requireAsset("../GeneratedSFX/Loop_R4C1.wav") as AudioTrackAsset,
    requireAsset("../GeneratedSFX/Loop_R4C2.wav") as AudioTrackAsset,
    requireAsset("../GeneratedSFX/Loop_R4C3.wav") as AudioTrackAsset,
    requireAsset("../GeneratedSFX/Loop_R4C4.wav") as AudioTrackAsset,
    requireAsset("../GeneratedSFX/Loop_R4C5.wav") as AudioTrackAsset,
    requireAsset("../GeneratedSFX/Loop_R4C6.wav") as AudioTrackAsset,
    requireAsset("../GeneratedSFX/Loop_R4C7.wav") as AudioTrackAsset,
  ],
]
const SFX_ARM = requireAsset("../GeneratedSFX/CellArm.wav") as AudioTrackAsset
const SFX_STOP = requireAsset("../GeneratedSFX/CellStop.wav") as AudioTrackAsset

/** Everything is rendered in this key/tempo — display + export metadata. */
const BPM = 105
const KEY_NAME = "Am"
/**
 * Per-row mix trim (Drums, Bass, Keys, Lead, Perc), multiplied by masterVolume.
 * Baked (not @input) to keep the Inspector at the ~6-knob cap; masterVolume is
 * the exposed volume control.
 */
const ROW_VOLUMES = [0.95, 0.95, 0.75, 0.7, 0.65]
const ROW_LABELS = ["Drums", "Bass", "Keys", "Lead", "Perc"]

@component
export class LoopGridMain extends BaseScriptComponent {
  @ui.label('<span style="color: #60A5FA;">LoopGridMain – Live Loops grid controller</span>')
  @ui.separator
  @ui.label('<span style="color: #60A5FA;">Settings</span>')
  @ui.group_start("Settings")
  @input
  @hint("Overall playback volume for all loops (per-row mix trims are applied on top)")
  @widget(new SliderWidget(0, 1, 0.05))
  masterVolume: number = 0.85

  @input("vec4", "{0.10,0.22,0.25,1}")
  @hint("Cell color when the cell is idle (not playing, not armed)")
  @widget(new ColorWidget())
  idleCellColor: vec4

  @input("vec4", "{0.95,0.65,0.15,1}")
  @hint("Cell color while armed and waiting for the next downbeat (pulses)")
  @widget(new ColorWidget())
  armedCellColor: vec4

  @input("vec4", "{0.20,0.90,1.00,1}")
  @hint("Cell color while its loop is playing")
  @widget(new ColorWidget())
  playingCellColor: vec4

  @input
  @hint("Play a short click when a cell is armed or stopped")
  tapSfxEnabled: boolean = true

  @input
  @hint("Extra strictness on top of the built-in travel guard: require the cell to be hovered (targeted, hand open) this many seconds before the pinch starts. 0 = gesture-state guard only, which already rejects cells a pinched hand sweeps through.")
  @widget(new SliderWidget(0, 0.5, 0.01))
  cellMinAimSeconds: number = 0
  @ui.group_end

  // ── internals ─────────────────────────────────────────────────────────────
  private transport = new LoopGridTransport(BPM)
  private model = new LoopGridModel()
  private encoder = new LoopGridExportEncoder()
  private gridUI = new LoopGridUI()
  private exportUI = new LoopGridExportPanelUI()

  /**
   * Pooled loop players: 2 per row instead of 1 per cell (12 AudioComponents
   * total instead of 42). Only one loop per row ever sounds, so a row needs at
   * most a playing slot and a standby slot. audioTrack is assigned to the
   * standby slot when a cell is ARMED — up to a full 2-bar cycle before the
   * downbeat — so the LowLatency preload happens well before play(). The
   * assign-at-downbeat path exists only as a fallback and is instrumented.
   * Rationale: 42 always-loaded LowLatency players against 25 MB of PCM made
   * every preview rebuild open 42 decoder streams, which is what was crashing
   * the editor across repeated resets.
   */
  private rowSlots: AudioComponent[][] = []
  private slotCols: number[][] = []
  private playingSlotIdx: number[] = []
  private playingAudio: (AudioComponent | null)[] = []
  private armAudio: AudioComponent | null = null
  private stopAudio: AudioComponent | null = null
  private lastTransportText = ""

  onAwake(): void {
    // onAwake calls createEvent() ONLY — all property writes and subscriptions
    // happen in the OnStartEvent handler (platform rule: SIK subscriptions and
    // AudioComponent.playbackMode writes bound in onAwake silently misbehave).
    this.createEvent("OnStartEvent").bind(() => this.onStart())
    this.createEvent("UpdateEvent").bind(() => this.onUpdate())
  }

  private onStart(): void {
    // Canvas at the root: hierarchy order IS render order for the whole UI.
    this.sceneObject.createComponent("Component.Canvas")

    this.buildAudio()

    this.gridUI.build(this.sceneObject, {
      idleColor: this.idleCellColor,
      armedColor: this.armedCellColor,
      playingColor: this.playingCellColor,
      rowLabels: ROW_LABELS,
      minAimSeconds: this.cellMinAimSeconds,
    })
    this.exportUI.build(this.sceneObject)

    this.gridUI.onCellTap.add(({ row, col }) => this.handleCellTap(row, col))
    this.gridUI.onSceneTap.add((col) => this.handleSceneTap(col))
    this.gridUI.onStopAll.add(() => this.handleStopAll())
    this.gridUI.onExport.add(() => this.handleExport())

    this.updateTransportText()
  }

  /** Create the 12 AudioComponents (5 rows x 2 pooled slots + 2 tap SFX).
   *  playbackMode is script-only and defaults to LowPower on Specs (tens of ms
   *  latency) — it MUST be LowLatency here and MUST be set inside this
   *  OnStartEvent handler, never in onAwake. Loop slots start with NO
   *  audioTrack; tracks are assigned at arm time (see prepPendingTracks). */
  private buildAudio(): void {
    for (let r = 0; r < LOOPGRID_ROWS; r++) {
      const slots: AudioComponent[] = []
      for (let s = 0; s < 2; s++) {
        const so = global.scene.createSceneObject("Audio_R" + r + "S" + s)
        so.setParent(this.sceneObject)
        const audio = so.createComponent("Component.AudioComponent") as AudioComponent
        audio.playbackMode = Audio.PlaybackMode.LowLatency
        audio.volume = ROW_VOLUMES[r] * this.masterVolume
        slots.push(audio)
      }
      this.rowSlots.push(slots)
      this.slotCols.push([-1, -1])
      this.playingSlotIdx.push(-1)
      this.playingAudio.push(null)
    }
    const mk = (name: string, track: AudioTrackAsset): AudioComponent => {
      const so = global.scene.createSceneObject(name)
      so.setParent(this.sceneObject)
      const audio = so.createComponent("Component.AudioComponent") as AudioComponent
      audio.audioTrack = track
      audio.playbackMode = Audio.PlaybackMode.LowLatency
      audio.volume = 0.5 * this.masterVolume
      return audio
    }
    this.armAudio = mk("Audio_SfxArm", SFX_ARM)
    this.stopAudio = mk("Audio_SfxStop", SFX_STOP)
  }

  private onUpdate(): void {
    const dt = getDeltaTime()
    if (this.transport.running) {
      if (this.transport.advance(dt)) {
        this.onDownbeat()
      }
    }
    this.gridUI.tick(dt)
    this.updateTransportText()
  }

  /** A loop boundary was crossed (or the very first launch happened). */
  private onDownbeat(): void {
    const bar = this.transport.cycleIndex * 2 // 2 bars per cycle
    const result = this.model.commit(bar)
    if (result.changed) {
      // Stop rows that went silent; resolve the pooled slot for new launches.
      for (const r of result.changedRows) {
        const prev = this.playingAudio[r]
        if (prev) prev.stop(false)
        const col = this.model.active[r]
        if (col < 0) {
          this.playingAudio[r] = null
          this.playingSlotIdx[r] = -1
        } else {
          let s = this.slotCols[r].indexOf(col)
          if (s < 0) {
            // Fallback only — arm-time prep should always have run. The
            // LowLatency preload lands on the downbeat frame here, which is
            // exactly the hitch the pool must avoid, so it is instrumented.
            s = this.playingSlotIdx[r] === 0 ? 1 : 0
            const lateT0 = getTime()
            this.rowSlots[r][s].audioTrack = LOOP_TRACKS[r][col]
            this.slotCols[r][s] = col
            print("[PERF] LATE track assign R" + r + "C" + col + " took=" + ((getTime() - lateT0) * 1000).toFixed(2) + "ms")
          }
          this.playingAudio[r] = this.rowSlots[r][s]
          this.playingSlotIdx[r] = s
        }
      }
      // Restart EVERY active loop in this same frame so the whole mix shares
      // one launch instant (phase-aligns new cells with running ones and
      // cancels accumulated clock drift). Between changes loops free-run.
      // Measured (see pool comment above): play() on a prepped LowLatency slot
      // costs <0.01 ms and no frame-time spike vs the pre-pool baseline.
      for (let r = 0; r < LOOPGRID_ROWS; r++) {
        const a = this.playingAudio[r]
        if (a) a.play(-1)
      }
      this.refreshCellVisuals()
    }
    // Nothing sounding and nothing queued: halt the clock so the next tap
    // launches instantly instead of waiting out a silent cycle.
    if (!this.model.hasAnyActive() && !this.model.hasAnyPending()) {
      this.transport.stop()
    }
  }

  /**
   * Assign every pending cell's track to its row's standby slot NOW (arm
   * time), so the LowLatency preload runs during the armed window (up to a
   * full 2-bar cycle) instead of on the downbeat frame. Measured in preview:
   * the assignment itself costs <0.01 ms of script time and the decoder open
   * completes at assignment, so launches show no frame-time spike vs the old
   * one-component-per-cell design.
   */
  private prepPendingTracks(): void {
    for (let r = 0; r < LOOPGRID_ROWS; r++) {
      for (let c = 0; c < LOOPGRID_COLS; c++) {
        if (!this.model.isPendingLaunch(r, c)) continue
        if (this.slotCols[r].indexOf(c) < 0) {
          const s = this.playingSlotIdx[r] === 0 ? 1 : 0
          this.rowSlots[r][s].audioTrack = LOOP_TRACKS[r][c]
          this.slotCols[r][s] = c
        }
        break // one pending launch per row at most
      }
    }
  }

  private handleCellTap(row: number, col: number): void {
    const action = this.model.tapCell(row, col)
    this.playTapSfx(action)
    this.prepPendingTracks()
    this.ensureStarted()
    this.refreshCellVisuals()
  }

  private handleSceneTap(col: number): void {
    this.model.armScene(col)
    this.playTapSfx("armed")
    this.prepPendingTracks()
    this.ensureStarted()
    this.refreshCellVisuals()
  }

  private handleStopAll(): void {
    this.model.armStopAll()
    this.playTapSfx("stopArmed")
    this.refreshCellVisuals()
  }

  private handleExport(): void {
    const lastBar = this.transport.cycleIndex * 2 + (this.transport.running ? 2 : 0)
    const code = this.encoder.encode(this.model.timeline, BPM, KEY_NAME, lastBar)
    this.exportUI.showExport(code)
  }

  /** First interaction while silent: start the clock and fire the downbeat NOW
   *  (GarageBand behavior — the first launch is immediate, later ones quantize). */
  private ensureStarted(): void {
    if (!this.transport.running && this.model.hasAnyPending()) {
      this.transport.start()
      this.onDownbeat()
    }
  }

  private playTapSfx(action: "armed" | "stopArmed" | "canceled"): void {
    if (!this.tapSfxEnabled) return
    const a = action === "armed" ? this.armAudio : this.stopAudio
    if (a) a.play(1)
  }

  private refreshCellVisuals(): void {
    for (let r = 0; r < LOOPGRID_ROWS; r++) {
      for (let c = 0; c < LOOPGRID_COLS; c++) {
        let state: CellState = "idle"
        if (this.model.isPendingLaunch(r, c)) {
          state = "armed"
        } else if (this.model.active[r] === c) {
          state = this.model.isPendingStop(r) ? "stopArmed" : "playing"
        }
        this.gridUI.setCellState(r, c, state)
      }
    }
  }

  private updateTransportText(): void {
    const s = this.transport.running
      ? "Bar " + this.transport.barNumber + "." + this.transport.beatInBar + " · " + BPM + " BPM · " + KEY_NAME
      : "Tap a cell to start · " + BPM + " BPM · " + KEY_NAME
    if (s !== this.lastTransportText) {
      this.lastTransportText = s
      this.gridUI.setTransportText(s)
    }
  }
}
