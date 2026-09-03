/**
 * LoopGridMain — THE single @component of the LoopGrid experience.
 *
 * A GarageBand-style Live Loops grid for Specs: 5 instrument rows x 8 scene
 * columns of pre-rendered loops (one key: A minor, one tempo: 105 BPM, all
 * exactly 2 bars = 201600 samples at 44.1 kHz, so every combination is
 * harmonically and rhythmically compatible).
 *
 * Owns: lifecycle, the 22 AudioComponents (5 rows x 2 pooled loop slots +
 * 5 custom-pattern lanes x 2 round-robin one-shot slots + 2 tap SFX — see the
 * pool comments at rowSlots / laneSlots), the per-frame transport tick, and
 * orchestration between the pure-logic modules (LoopGridTransport /
 * LoopGridModel / LoopGridCustomPattern / LoopGridExportEncoder) and the UI
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
 * - Custom-pattern hits fire on per-frame 16th-step crossings and carry that
 *   same one-frame jitter, which at 105 BPM is 11-23% OF A STEP per hit
 *   (see the LoopGridTransport header). In-Lens custom playback is an
 *   approximate sketch; the exact rendition is the MIDI export.
 * - On every downbeat that applies changes, ALL active loops are restarted in
 *   the same frame, so the entire mix shares a single launch instant and any
 *   transport-vs-audio-clock drift accumulated since the last change is
 *   cancelled. Between changes, loops free-run seamlessly (no restarts, no
 *   recurring stutter).
 * - NO runtime synthesis, NO DSP: AudioComponent exposes volume only; every
 *   sound here is a pre-rendered WAV asset.
 */

import { LoopGridTransport } from "./LoopGridTransport"
import { LoopGridModel, LOOPGRID_ROWS, LOOPGRID_COLS, CUSTOM_COL, CUSTOM_ROWS } from "./LoopGridModel"
import { LoopGridExportEncoder, CustomPatternExports } from "./LoopGridExportEncoder"
import { LoopGridCustomPattern, CUSTOM_LANES, CUSTOM_STEPS } from "./LoopGridCustomPattern"
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

// Custom-pattern one-shots, lane order Kick/Snare/Hat/Clap/Shaker (the
// cross-file lane contract — see LoopGridCustomPattern.ts).
const HIT_TRACKS: AudioTrackAsset[] = [
  requireAsset("../GeneratedSFX/Hit_Kick.wav") as AudioTrackAsset,
  requireAsset("../GeneratedSFX/Hit_Snare.wav") as AudioTrackAsset,
  requireAsset("../GeneratedSFX/Hit_Hat.wav") as AudioTrackAsset,
  requireAsset("../GeneratedSFX/Hit_Clap.wav") as AudioTrackAsset,
  requireAsset("../GeneratedSFX/Hit_Shaker.wav") as AudioTrackAsset,
]
/** Everything is rendered in this key/tempo — display + export metadata. */
const BPM = 105
const KEY_NAME = "Am"
const ROW_LABELS = ["Drums", "Bass", "Keys", "Lead", "Perc"]

@component
export class LoopGridMain extends BaseScriptComponent {
  @ui.label('<span style="color: #60A5FA;">LoopGridMain – Live Loops grid controller</span>')
  @ui.separator
  // Inspector surface: 16 inputs across three groups — 6 here, plus the two
  // 5-slider mix groups below. The mix trims are exposed because they are the
  // only knobs with an audible musical result: they set how the rows and the
  // custom-pattern lanes balance against each other, and the right values are
  // a listening judgement, not something to recompile for. Everything else
  // stays baked on purpose — geometry, panel sizes, labels, step counts and
  // the lane contract are structural, and a slider on any of them would only
  // let the Inspector desync the scene from the export format.
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

  // Per-row mix trim, multiplied by masterVolume when the row's pooled players
  // are created. Defaults are the mix the loops were rendered against: the
  // melodic rows sit under the rhythm section so a full five-row launch does
  // not turn to mud.
  @ui.label('<span style="color: #60A5FA;">Row mix</span>')
  @ui.group_start("Row mix")
  @input
  @hint("Drums row level, multiplied by Master Volume")
  @widget(new SliderWidget(0, 1, 0.05))
  drumsVolume: number = 0.95

  @input
  @hint("Bass row level, multiplied by Master Volume")
  @widget(new SliderWidget(0, 1, 0.05))
  bassVolume: number = 0.95

  @input
  @hint("Keys row level, multiplied by Master Volume")
  @widget(new SliderWidget(0, 1, 0.05))
  keysVolume: number = 0.75

  @input
  @hint("Lead row level, multiplied by Master Volume")
  @widget(new SliderWidget(0, 1, 0.05))
  leadVolume: number = 0.7

  @input
  @hint("Perc row level, multiplied by Master Volume")
  @widget(new SliderWidget(0, 1, 0.05))
  percVolume: number = 0.65
  @ui.group_end

  // Per-lane trim for the custom-pattern one-shots (x masterVolume), so a
  // hand-drawn sketch sits with the pre-mixed loops. Lane order is the
  // cross-file contract in LoopGridCustomPattern.ts — these sliders set level
  // only and never change which lane is which.
  @ui.label('<span style="color: #60A5FA;">Custom pattern lane mix</span>')
  @ui.group_start("Custom pattern lane mix")
  @input
  @hint("Kick lane level for custom patterns, multiplied by Master Volume")
  @widget(new SliderWidget(0, 1, 0.05))
  kickVolume: number = 0.9

  @input
  @hint("Snare lane level for custom patterns, multiplied by Master Volume")
  @widget(new SliderWidget(0, 1, 0.05))
  snareVolume: number = 0.85

  @input
  @hint("Hat lane level for custom patterns, multiplied by Master Volume")
  @widget(new SliderWidget(0, 1, 0.05))
  hatVolume: number = 0.7

  @input
  @hint("Clap lane level for custom patterns, multiplied by Master Volume")
  @widget(new SliderWidget(0, 1, 0.05))
  clapVolume: number = 0.8

  @input
  @hint("Shaker lane level for custom patterns, multiplied by Master Volume")
  @widget(new SliderWidget(0, 1, 0.05))
  shakerVolume: number = 0.6
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

  /**
   * Custom-pattern one-shot players: 2 per lane, round-robin (10 total), so a
   * hit can ring out while the next hit on the same lane starts — a 16th-note
   * hat line would otherwise cut its own tails. Tracks are assigned at build
   * (all 5 one-shots total ~65 KB of PCM — nothing like the 24 MB loop set
   * that forced the loop pool's assign-at-arm discipline). Deliberately NOT
   * one component per step or per cell: that per-cell design is what crashed
   * the editor.
   */
  private laneSlots: AudioComponent[][] = []
  private laneToggle: number[] = []
  /**
   * Mix trims gathered from the Inspector sliders, indexed by row / lane in
   * the canonical order (Drums..Perc, Kick..Shaker). Collected ONCE inside the
   * OnStartEvent handler — the sliders are read there and nowhere else, so no
   * property read can drift into onAwake, and the arrays keep the rest of the
   * file's indexed access unchanged.
   */
  private rowVolumes: number[] = []
  private laneVolumes: number[] = []
  /** Custom pattern per row; null for rows without a Custom cell. */
  private customPatterns: (LoopGridCustomPattern | null)[] = []

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

    for (let r = 0; r < LOOPGRID_ROWS; r++) {
      this.customPatterns.push(CUSTOM_ROWS.indexOf(r) >= 0 ? new LoopGridCustomPattern() : null)
    }

    // The only place the mix sliders are read. Order matches ROW_LABELS and
    // the CUSTOM_LANE_NAMES lane contract.
    this.rowVolumes = [this.drumsVolume, this.bassVolume, this.keysVolume, this.leadVolume, this.percVolume]
    this.laneVolumes = [this.kickVolume, this.snareVolume, this.hatVolume, this.clapVolume, this.shakerVolume]

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
    this.gridUI.onStepToggle.add(({ row, lane, step }) => this.handleStepToggle(row, lane, step))
    this.gridUI.onPatternClear.add((row) => this.handlePatternClear(row))

    this.updateTransportText()
  }

  /** Create the 22 AudioComponents (5 rows x 2 pooled loop slots + 5 lanes x
   *  2 one-shot slots + 2 tap SFX).
   *  playbackMode is script-only and defaults to LowPower on Specs (tens of ms
   *  latency) — it MUST be LowLatency here and MUST be set inside this
   *  OnStartEvent handler, never in onAwake. Loop slots start with NO
   *  audioTrack; tracks are assigned at arm time (see prepPendingTracks).
   *  One-shot lane slots DO get their track here — see the laneSlots comment. */
  private buildAudio(): void {
    for (let r = 0; r < LOOPGRID_ROWS; r++) {
      const slots: AudioComponent[] = []
      for (let s = 0; s < 2; s++) {
        const so = global.scene.createSceneObject("Audio_R" + r + "S" + s)
        so.setParent(this.sceneObject)
        const audio = so.createComponent("Component.AudioComponent") as AudioComponent
        audio.playbackMode = Audio.PlaybackMode.LowLatency
        audio.volume = this.rowVolumes[r] * this.masterVolume
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

    // Custom-pattern lanes: 2 round-robin slots per lane (see laneSlots).
    for (let l = 0; l < CUSTOM_LANES; l++) {
      const slots: AudioComponent[] = []
      for (let s = 0; s < 2; s++) {
        const so = global.scene.createSceneObject("Audio_Lane" + l + "S" + s)
        so.setParent(this.sceneObject)
        const audio = so.createComponent("Component.AudioComponent") as AudioComponent
        audio.audioTrack = HIT_TRACKS[l]
        audio.playbackMode = Audio.PlaybackMode.LowLatency
        audio.volume = this.laneVolumes[l] * this.masterVolume
        slots.push(audio)
      }
      this.laneSlots.push(slots)
      this.laneToggle.push(0)
    }
  }

  private onUpdate(): void {
    const dt = getDeltaTime()
    if (this.transport.running) {
      if (this.transport.advance(dt)) {
        this.onDownbeat()
      }
      // Drain step crossings EVERY frame (takeSteps clears the queue) and
      // trigger custom-pattern hits. Timing honesty: each hit lands on the
      // first frame at/after its 16th boundary — 11-23% of a step late at
      // 105 BPM (see LoopGridTransport header). The sketch is approximate by
      // platform design; the MIDI export is the exact rendition.
      const steps = this.transport.takeSteps()
      if (steps.length > 0) this.playPatternSteps(steps)
    }
    this.gridUI.tick(dt)
    this.updateTransportText()
  }

  /** Fire one-shots for every crossed 16th step. The 16-step pattern is ONE
   *  bar; the cycle is 2 bars, so cycle step index mod 16 plays it twice per
   *  cycle. When Drums AND Perc custom patterns are both live, a lane both
   *  hit on the same step triggers ONCE (union) — two identical one-shots in
   *  the same frame would only comb-filter, not add. */
  private playPatternSteps(cycleSteps: number[]): void {
    for (const si of cycleSteps) {
      const step = si % CUSTOM_STEPS
      for (let lane = 0; lane < CUSTOM_LANES; lane++) {
        let hit = false
        for (const r of CUSTOM_ROWS) {
          const p = this.customPatterns[r]
          if (p && this.model.active[r] === CUSTOM_COL && p.get(lane, step)) {
            hit = true
            break
          }
        }
        if (hit) this.hitLane(lane)
      }
    }
  }

  /** Round-robin between the lane's two slots so back-to-back hits overlap
   *  instead of cutting each other's tails. */
  private hitLane(lane: number): void {
    const s = this.laneToggle[lane]
    this.laneToggle[lane] = 1 - s
    this.laneSlots[lane][s].play(1)
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
        } else if (col === CUSTOM_COL) {
          // Custom pattern: no loop WAV — hits fire from step crossings in
          // playPatternSteps. The row holds no loop slot while custom plays.
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
      // A pending CUSTOM cell needs no loop-slot prep (one-shot lane slots
      // hold their tracks permanently), so only columns 0..7 are scanned.
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
    if (col === CUSTOM_COL) {
      // Tapping Custom always opens (or retargets) the row's step editor —
      // but it must NOT arm an EMPTY idle pattern: that would replace the
      // row's playing loop with silence on the next downbeat while the user
      // is still drawing. An empty pattern arms itself the first time a step
      // is toggled ON instead (handleStepToggle). Once the cell is armed,
      // playing, or holds a drawn pattern, the tap falls through to normal
      // cell semantics (arm / cancel pending / arm stop) with the editor
      // staying open until Close or export.
      const p = this.customPatterns[row]
      if (!p) return
      this.gridUI.openPatternEditor(row, (lane, step) => p.get(lane, step))
      const idle = this.model.active[row] !== CUSTOM_COL && !this.model.isPendingLaunch(row, CUSTOM_COL)
      if (idle && p.isEmpty()) return
    }
    const action = this.model.tapCell(row, col)
    this.playTapSfx(action)
    this.prepPendingTracks()
    this.ensureStarted()
    this.refreshCellVisuals()
  }

  /** Editor step toggled. Visual FIRST (the step must light the instant it is
   *  toggled — that is what sells the interaction on camera), audition after:
   *  a newly-ON step plays its lane's one-shot as immediate feedback.
   *  Drawing the FIRST step into an empty, un-armed pattern arms the Custom
   *  cell (opening the editor deliberately does not — see handleCellTap), so
   *  the pattern takes over the row on the next downbeat only once there is
   *  something to hear. Clearing back to empty while playing does NOT
   *  auto-stop — the row predictably plays silence until the user stops it,
   *  draws again, or launches a loop. */
  private handleStepToggle(row: number, lane: number, step: number): void {
    const p = this.customPatterns[row]
    if (!p) return
    const wasEmpty = p.isEmpty()
    const on = p.toggle(lane, step)
    this.gridUI.setEditorStep(lane, step, on)
    if (on) this.hitLane(lane)
    if (on && wasEmpty && this.model.active[row] !== CUSTOM_COL && !this.model.isPendingLaunch(row, CUSTOM_COL)) {
      // Self-arm. Guards above keep this from stop-arming a playing pattern
      // (clear-then-redraw) or cancelling an already-armed one.
      this.model.tapCell(row, CUSTOM_COL)
      this.playTapSfx("armed")
      this.ensureStarted()
      this.refreshCellVisuals()
    }
  }

  private handlePatternClear(row: number): void {
    const p = this.customPatterns[row]
    if (!p) return
    p.clear()
    this.gridUI.refreshEditorSteps((lane, step) => p.get(lane, step))
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
    // Patterns are captured at export time (live-edit semantics — see the
    // encoder's format doc). The encoder only emits letters whose D9/P9
    // actually appears in the timeline.
    const patterns: CustomPatternExports = {}
    const dp = this.customPatterns[0]
    if (dp) patterns.D = dp.pack()
    const pp = this.customPatterns[4]
    if (pp) patterns.P = pp.pack()
    const code = this.encoder.encode(this.model.timeline, BPM, KEY_NAME, lastBar, patterns)
    this.gridUI.closePatternEditor()
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
      // Custom rows have one extra cell at CUSTOM_COL — same state logic.
      const cols = CUSTOM_ROWS.indexOf(r) >= 0 ? LOOPGRID_COLS + 1 : LOOPGRID_COLS
      for (let c = 0; c < cols; c++) {
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
