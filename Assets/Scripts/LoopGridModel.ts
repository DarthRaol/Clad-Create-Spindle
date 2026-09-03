/**
 * LoopGridModel — pure grid/session state for LoopGrid. NO engine imports.
 *
 * Owns: which cell is active per row, which cell (or stop) is pending for the
 * next downbeat, and the launch timeline used by the export encoder.
 * Must NOT: touch audio, UI, or the scene. The controller reads commit results
 * and drives AudioComponents/UI from them.
 *
 * Grid shape: ROWS instrument rows x COLS scene columns. Per row at most one
 * cell plays at a time (GarageBand Live Loops semantics).
 *
 * CUSTOM cells: rows 0 (Drums) and 4 (Perc) each have a 9th cell at column
 * index CUSTOM_COL (8) holding the user-authored 16-step pattern. It is a
 * normal cell to this model — tapCell arms/stop-arms/cancels it exactly like
 * columns 0..7 and commit() emits its code as letter+9 ("D9"/"P9") — but it
 * is the CONTROLLER that decides when to call tapCell for it: opening the
 * step editor is not an arm; an empty pattern first arms when a step is
 * drawn (see LoopGridMain.handleCellTap / handleStepToggle). It also
 * belongs to NO scene column: armScene(col) only ever arms col 0..7, so a
 * scene launch replaces a playing custom pattern (correct Live Loops
 * semantics) yet can never arm the custom cell itself.
 */

export const LOOPGRID_ROWS = 5
export const LOOPGRID_COLS = 8
/** Column index of the per-row Custom cell (export code digit 9). */
export const CUSTOM_COL = 8
/** Rows that have a Custom cell: 0 = Drums, 4 = Perc. */
export const CUSTOM_ROWS = [0, 4]

/** Row letters used by the export encoding: Drums Bass Keys Lead Perc. */
export const ROW_LETTERS = ["D", "B", "K", "L", "P"]

/** Pending sentinel values (per row). */
const PENDING_NONE = -2
const PENDING_STOP = -1

export interface TimelineEvent {
  /** Musical bar (0-based) at which the change took effect. */
  bar: number
  /** Cell codes applied at this bar, e.g. "D3" (launch col 3 of Drums) or "D0" (stop Drums). */
  codes: string[]
}

export interface CommitResult {
  changed: boolean
  /** Rows whose active cell changed this commit (launches and stops). */
  changedRows: number[]
}

export class LoopGridModel {
  /** Active column per row, -1 = silent. */
  readonly active: number[] = []
  /** Pending column per row: PENDING_NONE, PENDING_STOP, or 0..COLS-1. */
  private pending: number[] = []
  /** Recorded launch/stop history for export. */
  readonly timeline: TimelineEvent[] = []

  constructor() {
    for (let r = 0; r < LOOPGRID_ROWS; r++) {
      this.active.push(-1)
      this.pending.push(PENDING_NONE)
    }
  }

  hasAnyActive(): boolean {
    return this.active.some((c) => c >= 0)
  }

  hasAnyPending(): boolean {
    return this.pending.some((p) => p !== PENDING_NONE)
  }

  isPendingLaunch(row: number, col: number): boolean {
    return this.pending[row] === col
  }

  isPendingStop(row: number): boolean {
    return this.pending[row] === PENDING_STOP
  }

  /**
   * User tapped a cell. Semantics:
   * - Tap the cell already pending -> cancel that pending change (toggle off).
   * - Tap the active cell          -> arm a stop for this row.
   * - Tap any other cell           -> arm it as the row's next loop.
   * Returns "armed" | "stopArmed" | "canceled" for SFX/UI feedback.
   */
  tapCell(row: number, col: number): "armed" | "stopArmed" | "canceled" {
    if (this.pending[row] === col) {
      this.pending[row] = PENDING_NONE
      return "canceled"
    }
    if (this.active[row] === col && this.pending[row] === PENDING_NONE) {
      this.pending[row] = PENDING_STOP
      return "stopArmed"
    }
    if (this.active[row] === col && this.pending[row] === PENDING_STOP) {
      this.pending[row] = PENDING_NONE
      return "canceled"
    }
    this.pending[row] = col
    return "armed"
  }

  /** Column header tapped: arm the whole scene (every row launches that column).
   *  `col` is always 0..7 — scene columns never include CUSTOM_COL, so this
   *  can replace a playing custom pattern but never arm one. */
  armScene(col: number): void {
    for (let r = 0; r < LOOPGRID_ROWS; r++) {
      // Re-arming the already-active column retriggers it on the downbeat —
      // matches GarageBand scene-relaunch behavior.
      this.pending[r] = col
    }
  }

  /** Stop-all: arm a stop on every sounding row; cancel pending launches. */
  armStopAll(): void {
    for (let r = 0; r < LOOPGRID_ROWS; r++) {
      this.pending[r] = this.active[r] >= 0 ? PENDING_STOP : PENDING_NONE
    }
  }

  /**
   * Apply all pending changes (called by the controller on a downbeat).
   * Records the change set into the timeline at `bar`.
   */
  commit(bar: number): CommitResult {
    const changedRows: number[] = []
    const codes: string[] = []
    for (let r = 0; r < LOOPGRID_ROWS; r++) {
      const p = this.pending[r]
      if (p === PENDING_NONE) continue
      if (p === PENDING_STOP) {
        if (this.active[r] >= 0) {
          this.active[r] = -1
          changedRows.push(r)
          codes.push(ROW_LETTERS[r] + "0")
        }
      } else {
        // Launch (or retrigger) column p. Retrigger of the same column still
        // counts as changed so the controller restarts its audio on the beat.
        this.active[r] = p
        changedRows.push(r)
        codes.push(ROW_LETTERS[r] + String(p + 1))
      }
      this.pending[r] = PENDING_NONE
    }
    if (codes.length > 0) {
      this.timeline.push({ bar, codes })
    }
    return { changed: changedRows.length > 0, changedRows }
  }
}
