/**
 * LoopGridIntroUI — the one-screen intro shown before the music UI.
 *
 * Plain exported class (NOT a @component — LoopGridMain owns the lifecycle),
 * built exactly like LoopGridExportPanelUI: a UIKit BackPlate carrying a
 * FlexLayout column whose children are registered explicitly via addItems().
 *
 * Owns: its own layout and the Start tap. Must NOT: know anything about the
 * grid, the transport, or audio — it raises onStartTapped and the controller
 * decides what that means.
 *
 * Hidden = parked far behind the camera instead of enabled=false, the same
 * trap LoopGridExportPanelUI documents: FlexLayout computes its layout over
 * update ticks, so disabling the subtree on the frame it was built freezes
 * that layout at the origin permanently. Parking keeps layout live with zero
 * visible or interactable surface (colliders travel with the transform).
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

const ICON_PLAY = requireAsset("../Icons/play_arrow.png") as Texture

// ── Typography (same module-scope scale as LoopGridUI — self-contained file) ──
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

const PANEL_W = 52
const PANEL_H = 27
const CONTENT_Z = 0.6
/** Local position when visible: the plane the export panel uses, so the intro
 *  sits in front of where the grid will appear. */
const SHOWN_POS = new vec3(0, 2, 4)
/** Parked far behind the camera when hidden. */
const HIDDEN_POS = new vec3(0, 2, -3000)

/** What the Lens is, in one line the user can read while looking up. */
const TAGLINE = "A Live Loops grid you play in the air, then finish in GarageBand"

/** The three things worth knowing before the first tap, in the order the user
 *  will need them: launch one cell, launch a whole scene, take it away. */
const HINTS = [
  "Tap a cell to launch it on the beat",
  "Tap a column to switch the whole scene",
  "Tap Export to send your session to GarageBand",
]

export class LoopGridIntroUI {
  /** Raised once, when Start is tapped. The intro parks itself first. */
  readonly onStartTapped = new Event<void>()

  private root: SceneObject | null = null

  /** Build the panel under `host`, VISIBLE. Call from an OnStartEvent handler. */
  build(host: SceneObject): void {
    const panel = this.obj(host, "IntroPanel", SHOWN_POS)
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
      col.rowGap = 0.5
      col.paddingTop = 1.8
      col.paddingBottom = 1.6
      col.paddingLeft = 2.0
      col.paddingRight = 2.0
    })

    // Row budget sums to PANEL_H with the gaps and padding above. The panel is
    // wide enough that each hint stays on ONE line — this is read in a few
    // seconds on camera, and a wrapped hint reads as a paragraph, not a rule.
    this.addColumnText(content, "LoopGrid", "Title2", 5.6, false)
    this.addColumnText(content, TAGLINE, "Body", 4.2, true)
    for (const hint of HINTS) {
      this.addColumnText(content, hint, "Caption", 2.4, true)
    }

    // Start button — its own centered row.
    const startRow = this.obj(content, "StartRow")
    const item = startRow.createComponent(FlexItem.getTypeName()) as FlexItem
    item.alignSelf = FlexAlignSelf.Center
    item.overrideWidth = 14
    item.overrideHeight = 3.6
    const btn = startRow.createComponent(Button.getTypeName()) as Button
    btn.onInitialized.add(() => {
      btn.size = new vec3(14, 3.6, 1)
    })
    const ec = startRow.createComponent(ElementContent.getTypeName()) as ElementContent
    ec.leadingIcon = ICON_PLAY
    ec.text = "Start"
    ec.textSize = roleSize("Button")
    // Plain UIKit onTriggerUp, NOT guardedTap — the same call Export and Close
    // make. The travel guard exists because a hand sweeping across 42 packed
    // grid cells will cross cells it never aimed at, and firing one of those
    // changes what the user hears. Neither pressure exists here: this is one
    // large button on an otherwise empty panel, and an accidental Start only
    // reveals the grid the user was already heading for — nothing plays until
    // they tap a cell. Guarding it would trade a harmless mis-fire for the
    // much worse failure of rejecting a real tap on the single button between
    // the user and the whole experience.
    btn.onTriggerUp.add(() => {
      this.hide()
      this.onStartTapped.invoke()
    })
    const parentFlex = content.getComponent(FlexLayout.getTypeName()) as FlexLayout | null
    if (parentFlex) parentFlex.addItems([item])
  }

  /** Park the panel. Nothing brings it back — the intro is once per session. */
  hide(): void {
    if (!this.root) return
    this.root.getTransform().setLocalPosition(HIDDEN_POS)
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
