/**
 * LoopGridUI — the LoopGrid main surface: header bar, scene-launch buttons,
 * the 5x8 loop cell grid, and the Stop All / Export control row.
 *
 * Plain exported class (NOT a @component — the single controller LoopGridMain
 * owns the component lifecycle per the project architecture rule). Composes
 * SpectaclesUIKit primitives; the ONLY raw visuals are the 42 grid cells
 * (5x8 loops + 2 Custom) and the 80 pattern-editor step toggles, both under
 * the documented high-cardinality grid-cell carve-out.
 *
 * Owns: building the UI subtree under a host SceneObject, cell visual state,
 * and translating taps into typed events for the controller.
 * Must NOT: hold domain state (active/pending cells live in LoopGridModel),
 * make game decisions, or touch audio.
 *
 * build() MUST be called from inside an OnStartEvent handler — all SIK
 * subscriptions (Interactable events, Button.onTriggerUp) bind during build,
 * satisfying the "SIK subscriptions inside OnStartEvent" platform rule.
 */

import { FlexLayout } from "SpectaclesUIKit.lspkg/Scripts/Components/Layout2D/Flex/FlexLayout"
import { FlexItem } from "SpectaclesUIKit.lspkg/Scripts/Components/Layout2D/Flex/FlexItem"
import {
  FlexAlign,
  FlexAlignSelf,
  FlexDirection,
  FlexJustify,
} from "SpectaclesUIKit.lspkg/Scripts/Components/Layout2D/Flex/FlexTypes"
import { BackPlate } from "SpectaclesUIKit.lspkg/Scripts/BackPlate"
import { Button } from "SpectaclesUIKit.lspkg/Scripts/Components/Button/Button"
import { ElementContent } from "SpectaclesUIKit.lspkg/Scripts/Components/Content/ElementContent"
import { Interactable } from "SpectaclesInteractionKit.lspkg/Components/Interaction/Interactable/Interactable"
import { InteractorTriggerType, TargetingMode } from "SpectaclesInteractionKit.lspkg/Core/Interactor/Interactor"
import Event from "SpectaclesInteractionKit.lspkg/Utils/Event"

import { LOOPGRID_ROWS, LOOPGRID_COLS, CUSTOM_COL, CUSTOM_ROWS } from "./LoopGridModel"
import { CUSTOM_LANES, CUSTOM_STEPS, CUSTOM_LANE_NAMES } from "./LoopGridCustomPattern"

// ── Assets (fixed internal references — not Inspector-swappable) ─────────────
const ICON_MUSIC_NOTE = requireAsset("../Icons/music_note.png") as Texture
const ICON_PLAY = requireAsset("../Icons/play_arrow.png") as Texture
const ICON_STOP = requireAsset("../Icons/stop.png") as Texture
const ICON_EXPORT = requireAsset("../Icons/ios_share.png") as Texture
const ICON_CLOSE = requireAsset("../Icons/close.png") as Texture
const imageMaterial = requireAsset("../Materials/ImageMaterial.mat") as Material
const cellMaterial = requireAsset("../Materials/CellMaterial.mat") as Material

// ── Typography: the single source of truth for text size + weight ────────────
// Calibrated for the SnapOS system font at the z = -110 cm focal plane.
const FONT_SIZE_SCALE = 1.0

type TextRole =
  | "Title1" | "Title2" | "HeadlineXL" | "Headline1" | "Headline2"
  | "Subheadline" | "Button" | "Callout" | "Body" | "Caption"

const TYPE_SCALE: Record<TextRole, { size: number; weight: number }> = {
  Title1: { size: 105, weight: 700 },
  Title2: { size: 93, weight: 700 },
  HeadlineXL: { size: 62, weight: 700 },
  Headline1: { size: 54, weight: 700 },
  Headline2: { size: 48, weight: 700 },
  Subheadline: { size: 41, weight: 700 },
  Button: { size: 39, weight: 500 },
  Callout: { size: 39, weight: 700 },
  Body: { size: 39, weight: 500 },
  Caption: { size: 38, weight: 500 },
}

function roleSize(role: TextRole, distanceCm: number = 110): number {
  return TYPE_SCALE[role].size * FONT_SIZE_SCALE * (distanceCm / 110)
}

function applyTextRole(t: Text, role: TextRole, distanceCm: number = 110): void {
  t.size = roleSize(role, distanceCm)
  ;(t as Text & { weight?: number }).weight = TYPE_SCALE[role].weight
}

/**
 * BackPlate auto-creates a SIK InteractionPlane — a near-field targeting
 * volume ~21 cm deep centered on the panel. Verified in preview: that volume
 * captures pinch/tap targeting before it reaches the controls behind its
 * front face, leaving every cell and button on the panel untappable. The
 * plane is an optional precision aid (BackPlate's enableInteractionPlane
 * input defaults to true), so it is turned off for all LoopGrid panels;
 * cells and buttons carry their own colliders for direct SIK targeting.
 */
export function disableBackPlateInteractionPlane(plate: BackPlate): void {
  // onInitialized is a ReplayEvent — fires immediately if init already ran.
  plate.onInitialized.add(() => {
    const plane = plate.interactionPlane
    if (isNull(plane)) {
      return
    }
    plane.enabled = false
    // Disabling the component deregisters it from the InteractionManager but
    // leaves the collider object it spawned live, still blocking raycasts —
    // that object must be disabled as well.
    const panel = plane.getSceneObject()
    for (let i = 0; i < panel.getChildrenCount(); i++) {
      const child = panel.getChild(i)
      if (child.name === "InteractionPlaneColliderRoot") {
        child.enabled = false
      }
    }
  })
}

// ── Layout geometry (local cm, host sits at world z = -110) ──────────────────
const LAYOUT_Z_LIFT = 0.02
const CONTENT_Z = 0.6 // content in front of a BackPlate face
const BUTTON_LABEL_Z = 0.08 // label in front of a Button face

const CELL_W = 4.6
const CELL_H = 3.4
const GAP_X = 0.6
const GAP_Y = 0.7
// The grid block shares one coordinate system so the UIKit scene buttons align
// exactly over the carve-out cell columns (see gridCellX below).
const GRID_LEFT_X = -15.3 // center X of column 0
const GRID_TOP_Y = 8.4 // center Y of row 0
const SCENE_ROW_Y = GRID_TOP_Y + CELL_H + GAP_Y // scene buttons directly above row 0
const LABEL_X = -20.6 // row-label column center

const HEADER_Y = 21
const GRIDPANEL_Y = 2
const CONTROL_Y = -15.5

function gridCellX(col: number): number {
  return GRID_LEFT_X + col * (CELL_W + GAP_X)
}
function gridCellY(row: number): number {
  return GRID_TOP_Y - row * (CELL_H + GAP_Y)
}

// ── Cycle playhead ───────────────────────────────────────────────────────────
// A hairline that sweeps left to right once per 2-bar cycle, driven by
// LoopGridTransport.cyclePhase. It wraps to the left edge on the downbeat —
// the same frame armed cells fire — so the wrap IS the launch moment.
//
// Specs renders ADDITIVELY: the display emits light and black is transparent.
// A playhead must therefore be a BRIGHT thin line, never a dark one and never
// a filled overlay — a dark rule would simply be invisible, and a wide band
// would wash out the cells it crosses.
const PLAYHEAD_W = 0.18 // ~1.8 mm at the z = -110 cm focal plane
/** Sweep span: left edge of column 0 to right edge of the last loop column.
 *  The Custom column (rows 0/4 only) sits outside it on purpose — all five
 *  rows share this span, so the line never travels across bare plate where
 *  three of the rows have no cell. */
const PLAYHEAD_LEFT_X = gridCellX(0) - CELL_W / 2
const PLAYHEAD_RIGHT_X = gridCellX(LOOPGRID_COLS - 1) + CELL_W / 2
/** Spans the cell rows: top of row 0 down to the bottom of the last row. */
const PLAYHEAD_TOP_Y = gridCellY(0) + CELL_H / 2
const PLAYHEAD_BOTTOM_Y = gridCellY(LOOPGRID_ROWS - 1) - CELL_H / 2
const PLAYHEAD_H = PLAYHEAD_TOP_Y - PLAYHEAD_BOTTOM_Y
const PLAYHEAD_Y = (PLAYHEAD_TOP_Y + PLAYHEAD_BOTTOM_Y) / 2
/** In front of the cells (z = LAYOUT_Z_LIFT) and their labels (z = 0.08). */
const PLAYHEAD_Z = 0.12
/** Warm white — brighter than both cell states, and a hue neither uses, so it
 *  reads as a separate object rather than as a cell lighting up. */
const PLAYHEAD_COLOR = new vec4(1.0, 0.93, 0.72, 1)

export type CellState = "idle" | "armed" | "playing" | "stopArmed"

export interface LoopGridUIConfig {
  idleColor: vec4
  armedColor: vec4
  playingColor: vec4
  rowLabels: string[]
  /** Minimum hover-to-trigger gap (s) for a cell tap to count — see makeCell. */
  minAimSeconds: number
}

interface CellVisual {
  mat: Material
  state: CellState
  hovered: boolean
}

interface StepVisual {
  mat: Material
  on: boolean
  hovered: boolean
  /** Steps 0/4/8/12 (the beats) get a brighter off color for readability. */
  onBeat: boolean
}

// ── Pattern editor geometry (own overlay panel, parked when hidden) ──────────
const EDITOR_W = 56
const EDITOR_H = 22
const STEP_W = 2.6
const STEP_H = 2.2
const STEP_GAP_X = 0.35
const STEP_GAP_Y = 0.42
const STEP_LEFT_X = -20.4 // center X of step 0
const STEP_TOP_Y = 4.6 // center Y of lane 0
const EDITOR_LABEL_X = -24.6
const EDITOR_TITLE_Y = 8.2
const EDITOR_BTN_Y = -9.0
/** Visible: centered over the grid, nearer the camera than the grid panel and
 *  the export panel (z=4) never shows at the same time — export closes it. */
const EDITOR_SHOWN_POS = new vec3(0, 2, 5)
const EDITOR_HIDDEN_POS = new vec3(0, 2, -3000)
/** Parked z for the interactive grid surface while an overlay is open. Same
 *  -3000 convention as the overlay panels; only z moves, so x/y can never
 *  drift across a toggle and the surface returns exactly where build put it. */
const SURFACE_HIDDEN_Z = -3000

function stepX(step: number): number {
  return STEP_LEFT_X + step * (STEP_W + STEP_GAP_X)
}
function stepY(lane: number): number {
  return STEP_TOP_Y - lane * (STEP_H + STEP_GAP_Y)
}

export class LoopGridUI {
  // ── UI -> controller events ────────────────────────────────────────────────
  readonly onCellTap = new Event<{ row: number; col: number }>()
  readonly onSceneTap = new Event<number>()
  readonly onStopAll = new Event<void>()
  readonly onExport = new Event<void>()
  /** Pattern-editor step toggled. row = the row whose editor is open. */
  readonly onStepToggle = new Event<{ row: number; lane: number; step: number }>()
  readonly onPatternClear = new Event<number>()
  /** Editor closed — including from its OWN Close button, which the controller
   *  never sees otherwise. The controller needs it to re-evaluate whether any
   *  overlay is still open (see LoopGridMain.syncSurfaceVisibility). */
  readonly onEditorClosed = new Event<void>()

  private cells: CellVisual[][] = []
  private transportText: Text | null = null
  private pulseTime = 0
  private cfg!: LoopGridUIConfig
  /** Cycle playhead node; null before build(). Position is set every frame. */
  private playhead: SceneObject | null = null
  /**
   * The top-level containers carrying every collider in the grid surface —
   * the cell grid (with the scene/column buttons and row labels) and the
   * control row (Stop All, Export) — each paired with the local position its
   * own build gave it. Parked as a set while an overlay is open; see
   * setSurfaceVisible.
   *
   * The header bar is deliberately NOT here: it holds no Interactable, it
   * does not overlap the editor panel, and its bar/transport readout stays
   * useful while a pattern is being drawn.
   */
  private surfaceRoots: { so: SceneObject; shown: vec3 }[] = []

  // Pattern editor state
  private editorRoot: SceneObject | null = null
  private editorTitle: Text | null = null
  private editorSteps: StepVisual[][] = [] // [lane][step]
  private editorRow = -1

  /** Build the whole surface under `host`. Call from an OnStartEvent handler. */
  build(host: SceneObject, cfg: LoopGridUIConfig): void {
    this.cfg = cfg
    this.buildHeader(host)
    this.buildGridPanel(host)
    this.buildControlRow(host)
    this.buildPatternEditor(host)
  }

  // ── controller -> UI API ──────────────────────────────────────────────────
  setTransportText(s: string): void {
    if (this.transportText) this.transportText.text = s
  }

  setCellState(row: number, col: number, state: CellState): void {
    const cv = this.cells[row][col]
    cv.state = state
    this.applyCellColor(cv)
  }

  /**
   * Advance the armed-cell pulse and the cycle playhead. Called every frame.
   * `cyclePhase` / `running` come straight from LoopGridTransport. The two
   * animations are complementary and independent: the pulse says a change is
   * PENDING, the playhead says WHEN it lands.
   */
  tick(dt: number, cyclePhase: number, running: boolean): void {
    this.pulseTime += dt
    for (let r = 0; r < LOOPGRID_ROWS; r++) {
      // Custom rows carry one extra cell — iterate the actual row length.
      for (let c = 0; c < this.cells[r].length; c++) {
        const cv = this.cells[r][c]
        if (cv.state === "armed" || cv.state === "stopArmed") this.applyCellColor(cv)
      }
    }
    this.updatePlayhead(cyclePhase, running)
  }

  // ── internals ─────────────────────────────────────────────────────────────

  private applyCellColor(cv: CellVisual): void {
    let base: vec4
    switch (cv.state) {
      case "playing":
        base = this.cfg.playingColor
        break
      case "armed":
        base = this.cfg.armedColor
        break
      case "stopArmed":
        // stop pending on a playing cell: pulse between playing color and dim
        base = this.cfg.playingColor.uniformScale(0.55) as vec4
        break
      default:
        base = this.cfg.idleColor
    }
    let k = cv.hovered ? 1.3 : 1.0
    if (cv.state === "armed" || cv.state === "stopArmed") {
      // ~2 Hz brightness pulse so pending changes read as "waiting for the beat"
      k *= 0.75 + 0.35 * (0.5 + 0.5 * Math.sin(this.pulseTime * Math.PI * 4))
    }
    const c = new vec4(
      Math.min(1, base.x * k),
      Math.min(1, base.y * k),
      Math.min(1, base.z * k),
      1
    )
    cv.mat.mainPass.baseColor = c
  }

  private buildHeader(host: SceneObject): void {
    const panel = this.obj(host, "HeaderBar", new vec3(0, HEADER_Y, 0))
    const plate = panel.createComponent(BackPlate.getTypeName()) as BackPlate
    plate.size = new vec2(44, 5)
    disableBackPlateInteractionPlane(plate)

    const content = this.obj(panel, "Content", new vec3(0, 0, CONTENT_Z))
    const rowFlex = content.createComponent(FlexLayout.getTypeName()) as FlexLayout
    // Runtime-built UI registers children explicitly via addItems(); auto-discovery
    // must be off or addItems throws before the layout initializes.
    rowFlex.autoDiscoverItemsOnStart = false
    rowFlex.onInitialized.add(() => {
      rowFlex.width = 44
      rowFlex.height = 5
      rowFlex.direction = FlexDirection.Row
      rowFlex.alignItems = FlexAlign.Center
      rowFlex.justifyContent = FlexJustify.SpaceBetween
      rowFlex.paddingLeft = 2.0
      rowFlex.paddingRight = 2.0
    })

    // Left cluster: note icon + title
    this.flexChild(content, { w: 13, h: 3.6 }, (left) => {
      const leftFlex = left.createComponent(FlexLayout.getTypeName()) as FlexLayout
      leftFlex.autoDiscoverItemsOnStart = false
      leftFlex.onInitialized.add(() => {
        leftFlex.width = 13
        leftFlex.height = 3.6
        leftFlex.direction = FlexDirection.Row
        leftFlex.alignItems = FlexAlign.Center
        leftFlex.justifyContent = FlexJustify.Start
        leftFlex.columnGap = 0.8
      })
      this.addImageChild(left, ICON_MUSIC_NOTE, 2.6)
      this.addRowText(left, "LoopGrid", "HeadlineXL", 7.0)
    })

    // Right: live transport readout (dynamic)
    this.flexChild(content, { w: 15, h: 3 }, (right) => {
      this.transportText = this.addRowText(right, "Tap a cell to start", "Body", 14.5)
    })
  }

  private buildGridPanel(host: SceneObject): void {
    const panel = this.obj(host, "GridPanel", new vec3(0, GRIDPANEL_Y, 0))
    this.surfaceRoots.push({ so: panel, shown: new vec3(0, GRIDPANEL_Y, 0) })
    const plate = panel.createComponent(BackPlate.getTypeName()) as BackPlate
    // 58 wide (was 50): the 9th Custom column on rows 0/4 sits at
    // gridCellX(8) = 26.3, so the plate must reach past x = 28.6.
    plate.size = new vec2(58, 27)
    disableBackPlateInteractionPlane(plate)

    const content = this.obj(panel, "GridContent", new vec3(0, 0, CONTENT_Z))

    // NOTE on placement: everything inside this grid block (scene buttons, row
    // labels, cells) is positioned with the shared gridCellX/gridCellY math so
    // the UIKit scene buttons sit exactly over the carve-out cell columns. A
    // FlexLayout cannot guarantee that cross-container column alignment, which
    // is the documented reason for computed placement here. The tap affordances
    // themselves remain UIKit Buttons.

    // Scene-launch icon hint at the label column
    const playHint = this.obj(content, "SceneHint", new vec3(LABEL_X, SCENE_ROW_Y, 0))
    this.addImage(playHint, ICON_PLAY, 2.2)

    // 8 UIKit scene buttons, one per column
    for (let c = 0; c < LOOPGRID_COLS; c++) {
      const col = c
      const so = this.obj(content, "SceneBtn" + (c + 1), new vec3(gridCellX(c), SCENE_ROW_Y, 0))
      const btn = so.createComponent(Button.getTypeName()) as Button
      btn.onInitialized.add(() => {
        btn.size = new vec3(CELL_W, 2.8, 1)
      })
      this.addButtonLabel(so, String(c + 1), CELL_W - 0.5)
      this.guardButton(btn, so, "SceneBtn" + (c + 1), () => this.onSceneTap.invoke(col))
    }

    // Row labels (raw Text — computed placement, see NOTE above)
    for (let r = 0; r < LOOPGRID_ROWS; r++) {
      const so = this.obj(content, "RowLabel" + r, new vec3(LABEL_X, gridCellY(r), 0))
      this.addStandaloneText(so, this.cfg.rowLabels[r] || "?", "Caption", 6.5)
    }

    // The 40 loop cells + 2 Custom cells (rows 0 and 4, column CUSTOM_COL).
    // A Custom cell is per-row and belongs to NO scene column — there is no
    // 9th scene button, and armScene never reaches it (see LoopGridModel).
    const cellMesh = this.buildCellMesh()
    for (let r = 0; r < LOOPGRID_ROWS; r++) {
      const rowArr: CellVisual[] = []
      for (let c = 0; c < LOOPGRID_COLS; c++) {
        rowArr.push(this.makeCell(content, cellMesh, r, c))
      }
      if (CUSTOM_ROWS.indexOf(r) >= 0) {
        rowArr.push(this.makeCell(content, cellMesh, r, CUSTOM_COL, "Custom"))
      }
      this.cells.push(rowArr)
    }

    // Built LAST so it renders over the cells: hierarchy order is render order.
    this.buildPlayhead(content)
  }

  /** The cycle playhead. Purely visual — no collider, no Interactable, no
   *  guardedTap: it is an indicator, not a control, and nothing may target it. */
  private buildPlayhead(parent: SceneObject): void {
    const so = this.obj(parent, "CyclePlayhead", new vec3(PLAYHEAD_LEFT_X, PLAYHEAD_Y, PLAYHEAD_Z))
    const rmv = so.createComponent("Component.RenderMeshVisual") as RenderMeshVisual
    rmv.mesh = this.buildQuadMesh(PLAYHEAD_W, PLAYHEAD_H)
    const mat = cellMaterial.clone()
    mat.mainPass.baseColor = PLAYHEAD_COLOR
    rmv.clearMaterials()
    rmv.addMaterial(mat)
    // Hidden until the transport runs. Safe to disable here (unlike the
    // FlexLayout panels): a bare RenderMeshVisual has no layout to freeze.
    so.enabled = false
    this.playhead = so
  }

  /** Move the playhead to `phase` (0..1 through the cycle), or hide it when the
   *  transport is stopped. Called once per frame from tick(). */
  private updatePlayhead(phase: number, running: boolean): void {
    if (!this.playhead) return
    if (this.playhead.enabled !== running) this.playhead.enabled = running
    if (!running) return
    const p = Math.max(0, Math.min(1, phase))
    const x = PLAYHEAD_LEFT_X + (PLAYHEAD_RIGHT_X - PLAYHEAD_LEFT_X) * p
    this.playhead.getTransform().setLocalPosition(new vec3(x, PLAYHEAD_Y, PLAYHEAD_Z))
  }

  /**
   * Travel-guarded tap subscription. A hand moving across the grid to reach a
   * distant target crosses intervening colliders, and if it travels with the
   * pinch (or poke) gesture already active, every crossed control receives its
   * own hover + trigger pair and would fire — verified in preview, and a hand
   * crosses colliders the same way on real hardware. No time or velocity
   * threshold can separate that from a real tap (a slow pinched sweep beats
   * any timer; a real pinch commits ~25 ms after targeting settles, measured
   * in preview). SIK's interactor state can: a tap counts only when BOTH hold —
   *  1. the hover began with the gesture OPEN (hoverEnter saw currentTrigger
   *     None): a sweep arrives already pinched;
   *  2. the trigger ENDS while still hovering: a pass-through's trigger ends
   *     because the hand left the collider, a real tap's release happens on
   *     the control.
   * minAimSeconds (default 0) can add hover-to-pinch dwell on top.
   *
   * Guarded UIKit buttons additionally get Poke targeting removed (see
   * guardButton): with Poke on, a button's hover begins at collider contact
   * simultaneously with the poke trigger, so a deliberate press and a sweep
   * have identical event signatures and the guard would reject both. With
   * Direct|Indirect only, buttons behave like the cells — targeting (hover)
   * first, pinch second — which the clean-hover check accepts. Nothing is
   * lost on device: the whole panel floats at z = -110 cm, beyond arm's
   * reach, so real users press these buttons by far-field ray + pinch.
   *
   * Applied to the 40 cells AND the UIKit buttons on the grid surface: the
   * scene buttons sit directly above the cell columns and Stop All directly
   * below — all in a crossing hand's path, and a swept scene button launches
   * five loops at once (worse than any single swept cell).
   */
  private guardedTap(
    interactable: Interactable,
    label: string,
    onTap: () => void,
    onHoverChange?: (hovered: boolean) => void
  ): void {
    let cleanHoverAt = -1
    let hovered = false
    let deliberate = false
    interactable.onTriggerStart.add(() => {
      deliberate =
        cleanHoverAt >= 0 && getTime() - cleanHoverAt >= this.cfg.minAimSeconds
    })
    interactable.onTriggerEnd.add(() => {
      if (deliberate && hovered) onTap()
      deliberate = false
    })
    interactable.onHoverEnter.add((e) => {
      const open = e.interactor.currentTrigger === InteractorTriggerType.None
      cleanHoverAt = open ? getTime() : -1
      hovered = true
      if (onHoverChange) onHoverChange(true)
    })
    interactable.onHoverExit.add(() => {
      cleanHoverAt = -1
      hovered = false
      if (onHoverChange) onHoverChange(false)
    })
  }

  /**
   * Route a UIKit Button through the travel guard instead of its raw
   * onTriggerUp (which fires for a pinched hand swept across the button).
   * The Button's Interactable is created during its init, so the guard binds
   * from onInitialized (a ReplayEvent — fires immediately if init already ran).
   */
  private guardButton(btn: Button, so: SceneObject, label: string, onTap: () => void): void {
    btn.onInitialized.add(() => {
      const interactable = so.getComponent(Interactable.getTypeName()) as Interactable | null
      if (interactable && !isNull(interactable)) {
        // Poke off — see the guardedTap doc block. On a 110 cm-away panel the
        // press path is ray + pinch; Poke's contact-equals-trigger semantics
        // are indistinguishable from a hand sweeping through the collider.
        interactable.targetingMode = TargetingMode.Direct | TargetingMode.Indirect
        this.guardedTap(interactable, label, onTap)
      } else {
        // No interactable to guard (unexpected UIKit internals change) —
        // degrade to the unguarded tap rather than a dead button.
        btn.onTriggerUp.add(onTap)
      }
    })
  }

  // per-tile factory — Hard Rule 3 grid-cell carve-out (N = 42)
  // Raw RenderMeshVisual + collider + Interactable per cell: 42 UIKit Buttons
  // would be the instantiation bottleneck this carve-out exists for. The grid's
  // backing panel and every surrounding control stay UIKit.
  private makeCell(parent: SceneObject, mesh: RenderMesh, row: number, col: number, label?: string): CellVisual {
    const so = this.obj(parent, "Cell_R" + row + "C" + col, new vec3(gridCellX(col), gridCellY(row), LAYOUT_Z_LIFT))
    if (label !== undefined) {
      const labelSo = this.obj(so, "CellLabel", new vec3(0, 0, 0.08))
      this.addStandaloneText(labelSo, label, "Caption", CELL_W)
    }

    const rmv = so.createComponent("Component.RenderMeshVisual") as RenderMeshVisual
    rmv.mesh = mesh
    const mat = cellMaterial.clone()
    rmv.clearMaterials()
    rmv.addMaterial(mat)

    const collider = so.createComponent("Physics.ColliderComponent") as ColliderComponent
    const shape = Shape.createBoxShape()
    shape.size = new vec3(CELL_W, CELL_H, 1)
    collider.shape = shape
    collider.fitVisual = false

    const interactable = so.createComponent(Interactable.getTypeName()) as Interactable

    const cv: CellVisual = { mat, state: "idle", hovered: false }

    // build() runs inside OnStartEvent, so these SIK subscriptions satisfy the
    // bind-inside-OnStartEvent platform rule.
    this.guardedTap(interactable, "R" + row + "C" + col, () => this.onCellTap.invoke({ row, col }), (h) => {
      cv.hovered = h
      this.applyCellColor(cv)
    })

    this.applyCellColor(cv)
    return cv
  }

  /** One shared quad mesh at exact cell size — no scale on collider-bearing nodes. */
  private buildCellMesh(): RenderMesh {
    return this.buildQuadMesh(CELL_W, CELL_H)
  }

  /** Centered w x h quad in the XY plane, facing +Z. */
  private buildQuadMesh(w: number, h: number): RenderMesh {
    const mb = new MeshBuilder([
      { name: "position", components: 3 },
      { name: "normal", components: 3 },
      { name: "texture0", components: 2 },
    ])
    mb.topology = MeshTopology.Triangles
    mb.indexType = MeshIndexType.UInt16
    const hw = w / 2
    const hh = h / 2
    // CCW when viewed from +Z (toward the camera at the -110 focal plane)
    mb.appendVerticesInterleaved([
      -hw, -hh, 0, 0, 0, 1, 0, 0,
      hw, -hh, 0, 0, 0, 1, 1, 0,
      hw, hh, 0, 0, 0, 1, 1, 1,
      -hw, hh, 0, 0, 0, 1, 0, 1,
    ])
    mb.appendIndices([0, 1, 2, 0, 2, 3])
    mb.updateMesh()
    return mb.getMesh()
  }

  private buildControlRow(host: SceneObject): void {
    const rowHost = this.obj(host, "ControlRow", new vec3(0, CONTROL_Y, 0))
    this.surfaceRoots.push({ so: rowHost, shown: new vec3(0, CONTROL_Y, 0) })
    const rowFlex = rowHost.createComponent(FlexLayout.getTypeName()) as FlexLayout
    rowFlex.autoDiscoverItemsOnStart = false
    rowFlex.onInitialized.add(() => {
      rowFlex.width = 30
      rowFlex.height = 3.6
      rowFlex.direction = FlexDirection.Row
      rowFlex.alignItems = FlexAlign.Center
      rowFlex.justifyContent = FlexJustify.Center
      rowFlex.columnGap = 3
    })

    // Stop All destroys the arrangement if a traveling hand clips it — travel
    // guarded. Export only opens a read-only panel (harmless and reversible if
    // swept), so it stays on UIKit's plain onTriggerUp: over-guarding it would
    // risk eating real taps for no protective benefit.
    this.flexChild(rowHost, { w: 12, h: 3 }, (so) => {
      this.addContentButton(so, "Stop All", ICON_STOP, 12, 3, () => this.onStopAll.invoke(), true)
    })
    this.flexChild(rowHost, { w: 12, h: 3 }, (so) => {
      this.addContentButton(so, "Export", ICON_EXPORT, 12, 3, () => this.onExport.invoke(), false)
    })
  }

  // ── pattern editor (16 steps x 5 lanes) ───────────────────────────────────

  /**
   * The step editor overlay. Hidden = parked far behind the camera (same
   * rationale as LoopGridExportPanelUI: disabling a freshly-built FlexLayout
   * subtree freezes layout, and colliders travel with the transform, so a
   * parked panel has zero interactable surface). One editor is shared by the
   * two Custom cells; openPatternEditor targets it at a row.
   *
   * UI copy rule (from the transport's honest-timing header): playback in the
   * Lens is an approximate sketch — one-frame jitter is 11-23% of a 16th step
   * at 105 BPM — so the caption says "sketch" and points at the GarageBand
   * export for exact timing. Never word this panel as tight/quantized.
   */
  private buildPatternEditor(host: SceneObject): void {
    const panel = this.obj(host, "PatternEditor", EDITOR_HIDDEN_POS)
    this.editorRoot = panel
    const plate = panel.createComponent(BackPlate.getTypeName()) as BackPlate
    plate.size = new vec2(EDITOR_W, EDITOR_H)
    disableBackPlateInteractionPlane(plate)

    const content = this.obj(panel, "EditorContent", new vec3(0, 0, CONTENT_Z))

    // Title (set per-row on open) + the honest-timing caption
    const titleSo = this.obj(content, "EditorTitle", new vec3(0, EDITOR_TITLE_Y, 0))
    this.editorTitle = this.addStandaloneText(titleSo, "Custom Pattern", "Headline2", EDITOR_W - 6)
    const capSo = this.obj(content, "EditorCaption", new vec3(0, EDITOR_TITLE_Y - 1.9, 0))
    this.addStandaloneText(
      capSo,
      "Sketch — Lens playback timing is approximate. Export to GarageBand for exact timing.",
      "Caption",
      EDITOR_W - 6
    )

    // Lane labels (computed placement — aligned to the step rows)
    for (let l = 0; l < CUSTOM_LANES; l++) {
      const so = this.obj(content, "LaneLabel" + l, new vec3(EDITOR_LABEL_X, stepY(l), 0))
      this.addStandaloneText(so, CUSTOM_LANE_NAMES[l], "Caption", 7)
    }

    // per-toggle factory — Hard Rule 3 grid-cell carve-out (N = 80)
    // Raw RenderMeshVisual + collider + Interactable per step toggle: 80 UIKit
    // Buttons would be the instantiation bottleneck this carve-out exists for.
    // The editor's backing panel, title, and Clear/Close buttons stay UIKit.
    const stepMesh = this.buildStepMesh()
    for (let l = 0; l < CUSTOM_LANES; l++) {
      const laneArr: StepVisual[] = []
      for (let s = 0; s < CUSTOM_STEPS; s++) {
        laneArr.push(this.makeStepToggle(content, stepMesh, l, s))
      }
      this.editorSteps.push(laneArr)
    }

    // Clear rewrites the whole pattern — destructive, so travel-guarded (same
    // rule as Stop All). Close only parks the panel — harmless if swept, so
    // plain onTriggerUp (same rule as Export).
    const clearSo = this.obj(content, "EditorClear", new vec3(-5.5, EDITOR_BTN_Y, 0))
    this.addContentButton(clearSo, "Clear", ICON_STOP, 9, 2.8, () => {
      if (this.editorRow >= 0) this.onPatternClear.invoke(this.editorRow)
    }, true)
    const closeSo = this.obj(content, "EditorClose", new vec3(5.5, EDITOR_BTN_Y, 0))
    this.addContentButton(closeSo, "Close", ICON_CLOSE, 9, 2.8, () => this.closePatternEditor(), false)
  }

  /**
   * One step toggle. Same travel guard as the 42 cells (guardedTap), and the
   * SAME targeting restriction as the guarded UIKit buttons: Direct|Indirect,
   * Poke removed — without this, a hand swept across the 16x5 grid would
   * toggle every step it crosses (the exact bug already fixed for cells).
   * The visual flips INSTANTLY on the guarded tap (before the controller is
   * even notified) — the lit step is the feedback that sells the interaction;
   * audio (the audition hit) follows from the controller.
   */
  private makeStepToggle(parent: SceneObject, mesh: RenderMesh, lane: number, step: number): StepVisual {
    const so = this.obj(parent, "Step_L" + lane + "S" + step, new vec3(stepX(step), stepY(lane), LAYOUT_Z_LIFT))

    const rmv = so.createComponent("Component.RenderMeshVisual") as RenderMeshVisual
    rmv.mesh = mesh
    const mat = cellMaterial.clone()
    rmv.clearMaterials()
    rmv.addMaterial(mat)

    const collider = so.createComponent("Physics.ColliderComponent") as ColliderComponent
    const shape = Shape.createBoxShape()
    shape.size = new vec3(STEP_W, STEP_H, 1)
    collider.shape = shape
    collider.fitVisual = false

    const interactable = so.createComponent(Interactable.getTypeName()) as Interactable
    interactable.targetingMode = TargetingMode.Direct | TargetingMode.Indirect

    const sv: StepVisual = { mat, on: false, hovered: false, onBeat: step % 4 === 0 }

    this.guardedTap(interactable, "L" + lane + "S" + step, () => {
      // Optimistic flip: light the step NOW. The controller's model toggle
      // lands in this same synchronous call and re-confirms via
      // setEditorStep — same value, no flicker.
      sv.on = !sv.on
      this.applyStepColor(sv)
      if (this.editorRow >= 0) this.onStepToggle.invoke({ row: this.editorRow, lane, step })
    }, (h) => {
      sv.hovered = h
      this.applyStepColor(sv)
    })

    this.applyStepColor(sv)
    return sv
  }

  private applyStepColor(sv: StepVisual): void {
    // ON = the armed orange (distinct from the cyan a playing CELL uses);
    // OFF is the idle teal, with beat columns (steps 0/4/8/12) brightened so
    // the bar reads at a glance.
    const base = sv.on
      ? this.cfg.armedColor
      : (this.cfg.idleColor.uniformScale(sv.onBeat ? 1.5 : 0.85) as vec4)
    const k = sv.hovered ? 1.3 : 1.0
    sv.mat.mainPass.baseColor = new vec4(
      Math.min(1, base.x * k),
      Math.min(1, base.y * k),
      Math.min(1, base.z * k),
      1
    )
  }

  /** Shared step-toggle quad (STEP_W x STEP_H — smaller than the cell quad). */
  private buildStepMesh(): RenderMesh {
    return this.buildQuadMesh(STEP_W, STEP_H)
  }

  // ── controller -> editor API ──────────────────────────────────────────────

  /** Show the editor for `row`, painting steps from `get(lane, step)`. */
  openPatternEditor(row: number, get: (lane: number, step: number) => boolean): void {
    if (!this.editorRoot) return
    this.editorRow = row
    if (this.editorTitle) {
      this.editorTitle.text = row === 0 ? "Custom Drums" : "Custom Perc"
    }
    this.refreshEditorSteps(get)
    this.editorRoot.getTransform().setLocalPosition(EDITOR_SHOWN_POS)
  }

  closePatternEditor(): void {
    if (!this.editorRoot) return
    this.editorRoot.getTransform().setLocalPosition(EDITOR_HIDDEN_POS)
    this.editorRow = -1
    this.onEditorClosed.invoke()
  }

  /** Whether the step editor is currently open. Derived from editorRow, which
   *  openPatternEditor/closePatternEditor already maintain — no new state. */
  get patternEditorOpen(): boolean {
    return this.editorRow >= 0
  }

  /**
   * Park or restore the interactive grid surface as a set.
   *
   * Parking, not disabling: colliders travel with the transform, so a parked
   * surface is untouchable for free, whereas disabling the subtree would
   * freeze its FlexLayout (see the LoopGridExportPanelUI header). Only z
   * moves, so the surface returns to exactly the position build gave it.
   *
   * Purely a visibility/reach change. Audio lives on separate SceneObjects
   * and is not touched; the transport keeps running; cell visuals keep
   * updating off-screen and are already correct when the surface returns.
   */
  setSurfaceVisible(visible: boolean): void {
    for (const r of this.surfaceRoots) {
      const p = r.shown
      r.so.getTransform().setLocalPosition(visible ? p : new vec3(p.x, p.y, SURFACE_HIDDEN_Z))
    }
  }

  setEditorStep(lane: number, step: number, on: boolean): void {
    const sv = this.editorSteps[lane][step]
    sv.on = on
    this.applyStepColor(sv)
  }

  refreshEditorSteps(get: (lane: number, step: number) => boolean): void {
    for (let l = 0; l < CUSTOM_LANES; l++) {
      for (let s = 0; s < CUSTOM_STEPS; s++) {
        this.setEditorStep(l, s, get(l, s))
      }
    }
  }

  // ── shared composition helpers (from /specs-build-ui references/helpers.md) ──

  private obj(parent: SceneObject, name: string, position?: vec3): SceneObject {
    const sceneObject = global.scene.createSceneObject(name)
    sceneObject.setParent(parent)
    if (position) sceneObject.getTransform().setLocalPosition(position)
    return sceneObject
  }

  private flexChild(
    parent: SceneObject,
    size: { w?: number; h?: number; grow?: number },
    builder: (childObject: SceneObject) => void
  ): SceneObject {
    const child = this.obj(parent, "Item")
    const t = child.getTransform()
    const p = t.getLocalPosition()
    t.setLocalPosition(new vec3(p.x, p.y, p.z + LAYOUT_Z_LIFT))
    const flexItem = child.createComponent(FlexItem.getTypeName()) as FlexItem
    if (size.w !== undefined && size.w > 0) flexItem.overrideWidth = size.w
    if (size.h !== undefined && size.h > 0) flexItem.overrideHeight = size.h
    flexItem.flexGrow = size.grow ?? 0
    flexItem.flexShrink = 0

    builder(child)

    const parentFlexLayout = parent.getComponent(FlexLayout.getTypeName()) as FlexLayout | null
    if (parentFlexLayout) parentFlexLayout.addItems([flexItem])
    return child
  }

  /** Raw row text with a real layoutRect (R1/R2: never ElementContent in a multi-child row). */
  private addRowText(parent: SceneObject, text: string, role: TextRole, widthCM: number): Text {
    const so = this.obj(parent, "RowText")
    const t = so.createComponent("Component.Text") as Text
    t.text = text
    t.depthTest = true
    applyTextRole(t, role)
    t.horizontalAlignment = HorizontalAlignment.Center
    t.verticalAlignment = VerticalAlignment.Center
    t.horizontalOverflow = HorizontalOverflow.Overflow
    t.verticalOverflow = VerticalOverflow.Overflow
    t.layoutRect = Rect.create(-widthCM / 2, widthCM / 2, -1.2, 1.2)
    const item = so.createComponent(FlexItem.getTypeName()) as FlexItem
    const parentFlex = parent.getComponent(FlexLayout.getTypeName()) as FlexLayout | null
    if (parentFlex) parentFlex.addItems([item])
    return t
  }

  /** Raw text at a computed position (grid block only — see the NOTE in buildGridPanel). */
  private addStandaloneText(so: SceneObject, text: string, role: TextRole, widthCM: number): Text {
    const t = so.createComponent("Component.Text") as Text
    t.text = text
    t.depthTest = true
    applyTextRole(t, role)
    t.horizontalAlignment = HorizontalAlignment.Center
    t.verticalAlignment = VerticalAlignment.Center
    t.horizontalOverflow = HorizontalOverflow.Overflow
    t.verticalOverflow = VerticalOverflow.Overflow
    t.layoutRect = Rect.create(-widthCM / 2, widthCM / 2, -1.2, 1.2)
    return t
  }

  /** Label drawn ON a Button face — lifted +Z so its leading glyph isn't occluded. */
  private addButtonLabel(parent: SceneObject, text: string, widthCM: number): void {
    const so = this.obj(parent, "ButtonLabel", new vec3(0, 0, BUTTON_LABEL_Z))
    const t = so.createComponent("Component.Text") as Text
    t.text = text
    t.depthTest = true
    applyTextRole(t, "Button")
    t.horizontalAlignment = HorizontalAlignment.Center
    t.verticalAlignment = VerticalAlignment.Center
    t.horizontalOverflow = HorizontalOverflow.Overflow
    t.verticalOverflow = VerticalOverflow.Overflow
    t.layoutRect = Rect.create(-widthCM / 2, widthCM / 2, -1.2, 1.2)
  }

  /** Button whose face is a sole-child ElementContent (icon + label).
   *  `guarded` routes the tap through the travel guard — use for controls
   *  where an accidental fire changes the arrangement. */
  private addContentButton(
    so: SceneObject,
    label: string,
    icon: Texture,
    w: number,
    h: number,
    onClick: () => void,
    guarded: boolean
  ): void {
    const btn = so.createComponent(Button.getTypeName()) as Button
    btn.onInitialized.add(() => {
      btn.size = new vec3(w, h, 1)
    })
    const ec = so.createComponent(ElementContent.getTypeName()) as ElementContent
    ec.leadingIcon = icon
    ec.text = label
    ec.textSize = roleSize("Button")
    if (guarded) {
      this.guardButton(btn, so, label, onClick)
    } else {
      btn.onTriggerUp.add(onClick)
    }
  }

  /** Icon image inside a flex container (own FlexItem cell). */
  private addImageChild(parent: SceneObject, texture: Texture, sizeCM: number): void {
    const so = this.obj(parent, "Image")
    this.addImage(so, texture, sizeCM)
    const item = so.createComponent(FlexItem.getTypeName()) as FlexItem
    const parentFlex = parent.getComponent(FlexLayout.getTypeName()) as FlexLayout | null
    if (parentFlex) parentFlex.addItems([item])
  }

  /** Icon image on an existing SceneObject (computed-placement grid block). */
  private addImage(so: SceneObject, texture: Texture, sizeCM: number): void {
    const img = so.createComponent("Component.Image") as Image
    const mat = imageMaterial.clone()
    mat.mainPass.baseTex = texture
    mat.mainPass.depthTest = true
    mat.mainPass.depthWrite = false
    img.clearMaterials()
    img.addMaterial(mat)
    so.getTransform().setLocalScale(new vec3(sizeCM, sizeCM, 1))
  }
}
