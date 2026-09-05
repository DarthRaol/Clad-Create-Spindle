/**
 * LoopGridExportPanelUI — the "Export to GarageBand" overlay panel.
 *
 * Plain exported class (NOT a @component — LoopGridMain owns the lifecycle).
 * UIKit BackPlate + FlexLayout column: title, the export code (multi-line,
 * wraps), a how-to caption, and a UIKit close button.
 *
 * Owns: showing/hiding itself and rendering the code string it is given.
 * Must NOT: compute the code (LoopGridExportEncoder does), or hold session state.
 *
 * Hidden = parked far behind the camera instead of enabled=false: FlexLayout
 * computes layout over update ticks, and disabling the subtree on the frame it
 * was built would freeze layout at the origin. Parking keeps layout live with
 * zero visible/interactable surface (colliders travel with the transform).
 *
 * build() MUST be called from inside an OnStartEvent handler (SIK
 * subscriptions bind during build).
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
import Event from "SpectaclesInteractionKit.lspkg/Utils/Event"

import { disableBackPlateInteractionPlane } from "./LoopGridUI"

const ICON_CLOSE = requireAsset("../Icons/close.png") as Texture

// ── Typography (same module-scope scale as LoopGridUI — self-contained file) ──
const FONT_SIZE_SCALE = 1.0

type TextRole =
  | "Title1" | "Title2" | "HeadlineXL" | "Headline1" | "Headline2"
  | "Subheadline" | "Button" | "Callout" | "Body" | "Caption" | "Code"

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
  // The export code is READ OFF THIS PANEL AND TYPED ON A PHONE, on camera.
  // Bigger and bolder than body copy on purpose: it is the one string in the
  // Lens a human has to reproduce character for character.
  Code: { size: 50, weight: 700 },
}

function roleSize(role: TextRole, distanceCm: number = 110): number {
  return TYPE_SCALE[role].size * FONT_SIZE_SCALE * (distanceCm / 110)
}

function applyTextRole(t: Text, role: TextRole, distanceCm: number = 110): void {
  t.size = roleSize(role, distanceCm)
  ;(t as Text & { weight?: number }).weight = TYPE_SCALE[role].weight
}

/** Companion tool, shown on the panel for the user to type on a phone.
 *  Written without the scheme so it stays short and thumb-typeable; browsers
 *  fill in https. Update here if the Pages site moves. */
const COMPANION_URL = "darthraol.github.io/Clad-Create-Spindle"

/** Max characters per displayed code line — tuned against the Code role size
 *  and the wrap width below so no line overflows the plate. */
const MAX_CODE_CHARS = 28

/**
 * Break the LG1 code into short lines a person can keep their place in while
 * typing. Splits on "|" boundaries and keeps each pipe at the END of its line
 * so the sequence stays unambiguous; a segment longer than one line is
 * hard-split. Reading the lines top to bottom reproduces the code EXACTLY —
 * this is presentation only and must never alter the string.
 */
function chunkCode(code: string): string {
  const parts = code.split("|")
  const segments: string[] = []
  for (let i = 0; i < parts.length; i++) {
    const seg = i < parts.length - 1 ? parts[i] + "|" : parts[i]
    if (seg.length === 0) continue
    if (seg.length <= MAX_CODE_CHARS) {
      segments.push(seg)
      continue
    }
    for (let j = 0; j < seg.length; j += MAX_CODE_CHARS) {
      segments.push(seg.substring(j, j + MAX_CODE_CHARS))
    }
  }
  const lines: string[] = []
  let line = ""
  for (const seg of segments) {
    if (line.length > 0 && line.length + seg.length > MAX_CODE_CHARS) {
      lines.push(line)
      line = ""
    }
    line += seg
  }
  if (line.length > 0) lines.push(line)
  return lines.join("\n")
}

const PANEL_W = 36
const PANEL_H = 20
const CONTENT_Z = 0.6
/** Local position when visible: centered, 4 cm nearer the camera than the grid. */
const SHOWN_POS = new vec3(0, 2, 4)
/** Parked far behind the camera when hidden. */
const HIDDEN_POS = new vec3(0, 2, -3000)

export class LoopGridExportPanelUI {
  readonly onClose = new Event<void>()

  private root: SceneObject | null = null
  private codeText: Text | null = null

  /** Build the panel under `host`. Call from an OnStartEvent handler. */
  build(host: SceneObject): void {
    const panel = this.obj(host, "ExportPanel", HIDDEN_POS)
    this.root = panel
    const plate = panel.createComponent(BackPlate.getTypeName()) as BackPlate
    plate.size = new vec2(PANEL_W, PANEL_H)
    disableBackPlateInteractionPlane(plate)

    const content = this.obj(panel, "Content", new vec3(0, 0, CONTENT_Z))
    const col = content.createComponent(FlexLayout.getTypeName()) as FlexLayout
    // Runtime-built UI registers children explicitly via addItems(); auto-discovery
    // must be off or addItems throws before the layout initializes.
    col.autoDiscoverItemsOnStart = false
    col.onInitialized.add(() => {
      col.width = PANEL_W
      col.height = PANEL_H
      col.direction = FlexDirection.Column
      col.alignItems = FlexAlign.Stretch
      col.justifyContent = FlexJustify.Start
      col.rowGap = 0.6
      col.paddingTop = 1.3
      col.paddingBottom = 1.1
      col.paddingLeft = 2.0
      col.paddingRight = 2.0
    })

    // Row budget is tuned to PANEL_H — the plate size is fixed, so the code
    // gets the space and everything else is trimmed to fit around it.
    this.addColumnText(content, "Export to GarageBand", "Callout", 1.8, false)
    this.codeText = this.addColumnText(content, "-", "Code", 7.8, true)
    this.addColumnText(content, "Type this code at", "Caption", 1.4, false)
    this.addColumnText(content, COMPANION_URL, "Subheadline", 2.0, false)

    // Close button — its own centered row
    const closeRow = this.obj(content, "CloseRow")
    const closeItem = closeRow.createComponent(FlexItem.getTypeName()) as FlexItem
    closeItem.alignSelf = FlexAlignSelf.Center
    closeItem.overrideWidth = 9
    closeItem.overrideHeight = 2.8
    const btn = closeRow.createComponent(Button.getTypeName()) as Button
    btn.onInitialized.add(() => {
      btn.size = new vec3(9, 2.8, 1)
    })
    const ec = closeRow.createComponent(ElementContent.getTypeName()) as ElementContent
    ec.leadingIcon = ICON_CLOSE
    ec.text = "Close"
    ec.textSize = roleSize("Button")
    btn.onTriggerUp.add(() => {
      this.hide()
      this.onClose.invoke()
    })
    const parentFlex = content.getComponent(FlexLayout.getTypeName()) as FlexLayout | null
    if (parentFlex) parentFlex.addItems([closeItem])
  }

  showExport(code: string): void {
    if (!this.root) return
    // Displayed in chunked lines for readability; the code itself is unchanged.
    if (this.codeText) this.codeText.text = chunkCode(code)
    this.root.getTransform().setLocalPosition(SHOWN_POS)
  }

  hide(): void {
    if (!this.root) return
    this.root.getTransform().setLocalPosition(HIDDEN_POS)
  }

  get visible(): boolean {
    if (!this.root) return false
    return this.root.getTransform().getLocalPosition().z > -1000
  }

  // ── helpers ───────────────────────────────────────────────────────────────

  private obj(parent: SceneObject, name: string, position?: vec3): SceneObject {
    const sceneObject = global.scene.createSceneObject(name)
    sceneObject.setParent(parent)
    if (position) sceneObject.getTransform().setLocalPosition(position)
    return sceneObject
  }

  /** Column-direction text row: 1x1 placeholder rect + alignSelf Stretch. */
  private addColumnText(
    parent: SceneObject,
    text: string,
    role: TextRole,
    rowH: number,
    wrap: boolean
  ): Text {
    const so = this.obj(parent, "TextRow")
    const t = so.createComponent("Component.Text") as Text
    t.text = text
    t.depthTest = true
    applyTextRole(t, role)
    t.horizontalAlignment = HorizontalAlignment.Center
    t.verticalAlignment = VerticalAlignment.Center // Center: wrap grows symmetrically, never up into the row above
    t.horizontalOverflow = wrap ? HorizontalOverflow.Wrap : HorizontalOverflow.Overflow
    t.verticalOverflow = VerticalOverflow.Overflow
    t.layoutRect = wrap
      ? Rect.create(-(PANEL_W - 5) / 2, (PANEL_W - 5) / 2, -rowH / 2, rowH / 2)
      : Rect.create(-0.5, 0.5, -0.5, 0.5)
    const item = so.createComponent(FlexItem.getTypeName()) as FlexItem
    item.alignSelf = FlexAlignSelf.Stretch
    item.overrideHeight = rowH
    const parentFlex = parent.getComponent(FlexLayout.getTypeName()) as FlexLayout | null
    if (parentFlex) parentFlex.addItems([item])
    return t
  }
}
