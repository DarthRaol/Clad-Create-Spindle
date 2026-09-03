/**
 * LoopGridStore — session persistence for LoopGrid via PersistentStorageSystem.
 *
 * Saves what the user MADE (the two custom drum patterns and which cell each
 * row was playing) so reopening the Lens brings the groove back. Deliberately
 * does NOT save transport position, timeline, or anything about playback: a
 * restored session is armed, never sounding (see LoopGridMain.restoreSession),
 * and starts a FRESH timeline at bar 0, so the LG1 export format and its
 * semantics are untouched by this feature.
 *
 * Engine-coupled by necessity (`global.persistentStorageSystem`), so it lives
 * beside the controller rather than with the pure logic modules. Access must
 * happen inside the OnStartEvent handler or later, never onAwake.
 *
 * TRUST NOTHING ON READ. The blob outlives the code that wrote it: a user can
 * carry a save across a Lens update that changed the grid shape, the pattern
 * format, or the meaning of a column. Every load is therefore version-gated
 * and then fully re-validated field by field, and ANY problem — wrong version,
 * malformed JSON, out-of-range column, bad pattern string — discards the whole
 * blob and starts fresh. Half-restoring is the one outcome worse than losing
 * the save, and no read path may throw into the Lens.
 */

import { LOOPGRID_ROWS, LOOPGRID_COLS, CUSTOM_COL, CUSTOM_ROWS } from "./LoopGridModel"

/**
 * Schema version of the stored blob. BUMP THIS whenever the saved shape or the
 * meaning of its contents changes (grid dimensions, pattern pack format, cell
 * numbering). Old saves are then discarded instead of misread.
 */
const STORE_VERSION = 1

const KEY_VERSION = "loopgrid.version"
const KEY_SESSION = "loopgrid.session"

/** 20 uppercase hex chars — the LoopGridCustomPattern.pack() format. */
const PACKED_PATTERN = /^[0-9A-F]{20}$/

/** Packed custom patterns by row letter, same shape the encoder takes. */
export interface StoredPatterns {
  D?: string
  P?: string
}

export interface SavedSession {
  /** Active column per row, length LOOPGRID_ROWS; -1 = the row was silent. */
  cells: number[]
  patterns: StoredPatterns
}

export class LoopGridStore {
  /**
   * The saved session, or null when there is nothing usable — no save yet, a
   * different schema version, or anything that fails validation. Never throws.
   */
  load(): SavedSession | null {
    try {
      const store = global.persistentStorageSystem.store
      // Version first, so a blob from another schema is never even parsed.
      if (!store.has(KEY_VERSION) || store.getInt(KEY_VERSION) !== STORE_VERSION) {
        this.clear()
        return null
      }
      if (!store.has(KEY_SESSION)) {
        this.clear()
        return null
      }
      const session = this.validate(JSON.parse(store.getString(KEY_SESSION)))
      if (!session) {
        this.clear()
        return null
      }
      return session
    } catch (e) {
      // Malformed JSON, a key stored as the wrong type, storage unavailable —
      // a bad save must cost the user their groove, never their Lens.
      this.clear()
      return null
    }
  }

  /** Persist the current groove. Call on meaningful change only. Never throws. */
  save(cells: number[], patterns: StoredPatterns): void {
    try {
      const store = global.persistentStorageSystem.store
      // Invalidate, write, then re-stamp the version, so "version present"
      // always implies "payload complete" even if a write is interrupted.
      store.remove(KEY_VERSION)
      store.putString(KEY_SESSION, JSON.stringify({ cells: cells, patterns: patterns }))
      store.putInt(KEY_VERSION, STORE_VERSION)
    } catch (e) {
      // Persistence is a convenience; failing to save must not affect playback.
    }
  }

  /** Drop the saved blob. Used on any rejected read and by an explicit reset. */
  clear(): void {
    try {
      const store = global.persistentStorageSystem.store
      store.remove(KEY_VERSION)
      store.remove(KEY_SESSION)
    } catch (e) {
      // Nothing to do — the next load re-validates and rejects anyway.
    }
  }

  /**
   * Re-derive a SavedSession from untrusted parsed JSON, or null if anything
   * is off. Checks shape AND range: a column number that is legal for one row
   * (the Custom column exists only on CUSTOM_ROWS) is illegal for another.
   */
  private validate(raw: unknown): SavedSession | null {
    if (!raw || typeof raw !== "object") return null
    const obj = raw as Record<string, unknown>

    const rawCells = obj.cells
    if (!Array.isArray(rawCells) || rawCells.length !== LOOPGRID_ROWS) return null
    const cells: number[] = []
    for (let r = 0; r < LOOPGRID_ROWS; r++) {
      const c = rawCells[r]
      if (typeof c !== "number" || !Number.isInteger(c)) return null
      if (c === -1) {
        cells.push(-1)
        continue
      }
      const legalLoopCell = c >= 0 && c < LOOPGRID_COLS
      const legalCustomCell = c === CUSTOM_COL && CUSTOM_ROWS.indexOf(r) >= 0
      if (!legalLoopCell && !legalCustomCell) return null
      cells.push(c)
    }

    const patterns: StoredPatterns = {}
    const rawPatterns = obj.patterns
    if (rawPatterns !== undefined && rawPatterns !== null) {
      if (typeof rawPatterns !== "object") return null
      const pobj = rawPatterns as Record<string, unknown>
      const out = patterns as Record<string, string>
      for (const letter of ["D", "P"]) {
        const v = pobj[letter]
        if (v === undefined || v === null) continue
        if (typeof v !== "string" || !PACKED_PATTERN.test(v)) return null
        out[letter] = v
      }
    }

    return { cells: cells, patterns: patterns }
  }
}
