import { computed, nextTick, ref, type ComputedRef, type Ref } from 'vue'
import type { Id, ObjectSummary, ObjectType, PropertyDef, RelationPropertyDef } from '@vasta/core'
import { api } from '../../lib/api.ts'
import { clone } from '../../lib/clone.ts'
import { displayTitle } from '../../lib/format.ts'
import { cachedSummary, notice, primeFromObject, replaceType, summaryOf, typesById } from '../../lib/state.ts'
import { newId } from './ids.ts'
import {
  anchorTargetId,
  distToPolyline,
  getAnchorPoint,
  getConnectorGeometry,
  isLine,
  orientationForSide,
  rotatePoint,
  shapeHit,
  stickyStyle,
  type ConnectorGeometry,
  type SnapTarget,
} from './shapes.ts'
import type {
  AnchorTargetKind,
  CardContentMode,
  InkStroke,
  LineCurvature,
  LineTermination,
  ObjectCardElement,
  Point,
  Shape2DType,
  ShapeElement,
  ShapeFill,
  StickyElement,
  StickyFontSize,
  StrokeStyle,
} from './types.ts'
import type { ConnectorSettings, Shape2DSettings } from './useToolSettings.ts'

export interface Box {
  x: number
  y: number
  w: number
  h: number
}

export type Kind = 'stroke' | 'shape' | 'card' | 'sticky'

export type CanvasItem =
  | { key: string; kind: 'stroke'; zIndex: number; item: InkStroke; pathD: string; center?: Point }
  | {
      key: string
      kind: 'shape'
      zIndex: number
      item: ShapeElement
      isLine: boolean
      connectorGeo?: ConnectorGeometry
      relationInfo?: ConnectorRelationBadgeInfo | null
    }
  | { key: string; kind: 'card'; zIndex: number; item: ObjectCardElement }
  | {
      key: string
      kind: 'sticky'
      zIndex: number
      item: StickyElement
      palette: { bg: string; border: string; text: string }
    }

export type ResizeHandleId = 'se' | 'nw' | 'ne' | 'sw' | 'top' | 'br' | 'bl' | 'start' | 'end' | 'mid'

export interface Handle {
  id: ResizeHandleId
  x: number
  y: number
}

export interface SelectedGeometry {
  isSingle: boolean
  isLine: boolean
  isTriangle: boolean
  box: Box
  center: Point
  rotation: number
  shapeType?: string
  handles: Handle[]
  rotateHandle: Point | null
}

export interface ConnectorRelationOption {
  key: string
  direction: 'forward' | 'inverse' | 'two-way'
  prop: RelationPropertyDef
  ownerCard: ObjectCardElement
  targetCard: ObjectCardElement
  ownerObjectId: Id
  targetObjectId: Id
  ownerTitle: string
  targetTitle: string
  ownerTypeName: string
  targetTypeName: string
  displayName: string
  twoWayDisplayName?: string
  reverseName?: string
  subtitle: string
  isAssignedToConnector: boolean
  alreadyInVasta: boolean
  isTwoWayCapable?: boolean
}

export interface ConnectorRelationBadgeInfo {
  propertyId: Id
  propertyName: string
  targetSideName?: string
  displayLabel: string
  ownerObjectId: Id
  targetObjectId: Id
  ownerTitle: string
  targetTitle: string
  direction: 'forward' | 'inverse' | 'two-way'
  twoWay?: boolean
  shownOnOwnerCard: boolean
  shownOnTargetCard?: boolean
  ownerCardId?: string
  targetCardId?: string
  syncedInVasta: boolean
}

export const keyOf = (kind: Kind, id: string) => `${kind}:${id}`

export function parseKey(key: string): { kind: Kind; id: string } {
  const i = key.indexOf(':')
  return { kind: key.slice(0, i) as Kind, id: key.slice(i + 1) }
}

export function pointsBox(points: Point[], pad = 0): Box {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const p of points) {
    minX = Math.min(minX, p.x)
    minY = Math.min(minY, p.y)
    maxX = Math.max(maxX, p.x)
    maxY = Math.max(maxY, p.y)
  }
  return { x: minX - pad, y: minY - pad, w: maxX - minX + pad * 2, h: maxY - minY + pad * 2 }
}

export const intersects = (a: Box, b: Box) =>
  a.x <= b.x + b.w && a.x + a.w >= b.x && a.y <= b.y + b.h && a.y + a.h >= b.y

export function getStrokeCenter(s: InkStroke): Point {
  const b = pointsBox(s.points)
  return { x: b.x + b.w / 2, y: b.y + b.h / 2 }
}

export interface UseWhiteboardSelectionOptions {
  containerRef: Ref<HTMLElement | null>
  pan: Ref<{ x: number; y: number }>
  zoom: Ref<number>
  strokes: Ref<InkStroke[]>
  shapes: Ref<ShapeElement[]>
  cards: Ref<ObjectCardElement[]>
  stickies: Ref<StickyElement[]>
  editingId: Ref<string | null>
  currentShape2D: Ref<Shape2DType>
  shapeFillTab: Ref<'outline' | 'fill'>
  shape2DSettings: Ref<Record<Shape2DType, Shape2DSettings>>
  saveShapeSettings: () => void
  connectorSettings: Ref<ConnectorSettings>
  saveConnectorSettings: () => void
  currentStickyColor: Ref<string>
  currentStickyTextColor: Ref<string>
  currentStickyFontSize: Ref<StickyFontSize>
  dockShape2DFill: ComputedRef<string>
  pushHistory: () => void
  notifyChange: () => void
}

export function useWhiteboardSelection(opts: UseWhiteboardSelectionOptions) {
  const {
    containerRef,
    pan,
    zoom,
    strokes,
    shapes,
    cards,
    stickies,
    editingId,
    currentShape2D,
    shapeFillTab,
    shape2DSettings,
    saveShapeSettings,
    connectorSettings,
    saveConnectorSettings,
    currentStickyColor,
    currentStickyTextColor,
    currentStickyFontSize,
    dockShape2DFill,
    pushHistory,
    notifyChange,
  } = opts

  const selected = ref<string[]>([])
  const isSelected = (kind: Kind, id: string) => selected.value.includes(keyOf(kind, id))

  function findItem(key: string): { kind: Kind; item: InkStroke | ShapeElement | ObjectCardElement | StickyElement } | undefined {
    const { kind, id } = parseKey(key)
    const list =
      kind === 'stroke'
        ? strokes.value
        : kind === 'shape'
          ? shapes.value
          : kind === 'card'
            ? cards.value
            : stickies.value
    const item = (list as { id: string }[]).find((i) => i.id === id)
    return item ? { kind, item: item as InkStroke | ShapeElement | ObjectCardElement | StickyElement } : undefined
  }

  /**
   * Returns all connectible canvas objects (Cards, Stickies, and 2D Shapes) sorted by zIndex.
   */
  function getSnapTargets(excludeIds?: Set<string>): SnapTarget[] {
    const targets: (SnapTarget & { z: number })[] = []
    for (const c of cards.value) {
      if (excludeIds?.has(c.id)) continue
      targets.push({ id: c.id, kind: 'card', x: c.x, y: c.y, width: c.width, height: c.height, rotation: c.rotation, z: c.zIndex ?? 1 })
    }
    for (const st of stickies.value) {
      if (excludeIds?.has(st.id)) continue
      targets.push({ id: st.id, kind: 'sticky', x: st.x, y: st.y, width: st.width, height: st.height, rotation: st.rotation, z: st.zIndex ?? 1 })
    }
    for (const sh of shapes.value) {
      if (isLine(sh) || excludeIds?.has(sh.id)) continue
      targets.push({ id: sh.id, kind: 'shape', shapeType: sh.type, x: sh.x, y: sh.y, width: sh.width, height: sh.height, rotation: sh.rotation, z: sh.zIndex ?? 1 })
    }
    targets.sort((a, b) => a.z - b.z)
    return targets
  }

  function findSnapTarget(id: string, kind?: AnchorTargetKind): SnapTarget | undefined {
    if (!kind || kind === 'card') {
      const c = cards.value.find((x) => x.id === id)
      if (c) return { id: c.id, kind: 'card', x: c.x, y: c.y, width: c.width, height: c.height, rotation: c.rotation }
    }
    if (!kind || kind === 'sticky') {
      const st = stickies.value.find((x) => x.id === id)
      if (st) return { id: st.id, kind: 'sticky', x: st.x, y: st.y, width: st.width, height: st.height, rotation: st.rotation }
    }
    if (!kind || kind === 'shape') {
      const sh = shapes.value.find((x) => x.id === id && !isLine(x))
      if (sh) return { id: sh.id, kind: 'shape', shapeType: sh.type, x: sh.x, y: sh.y, width: sh.width, height: sh.height, rotation: sh.rotation }
    }
    return undefined
  }

  /**
   * Synchronizes all connectors that have `startAnchor` or `endAnchor` so their endpoints
   * stay locked to the target object's side and `controlPoint` / `midOffset` scale cleanly.
   */
  function syncAnchoredConnectors() {
    for (const s of shapes.value) {
      if (!isLine(s)) continue
      const startId = anchorTargetId(s.startAnchor)
      const endId = anchorTargetId(s.endAnchor)
      if (!startId && !endId) continue

      const oldStart = { x: s.x, y: s.y }
      const oldEnd = { x: s.x + s.width, y: s.y + s.height }
      const oldMid = { x: (oldStart.x + oldEnd.x) / 2, y: (oldStart.y + oldEnd.y) / 2 }
      const oldDx = s.width
      const oldDy = s.height

      let nextStart = { ...oldStart }
      let nextEnd = { ...oldEnd }

      if (startId && s.startAnchor?.side) {
        const t = findSnapTarget(startId, s.startAnchor.targetKind)
        if (t) {
          nextStart = getAnchorPoint(t, s.startAnchor.side)
          s.startOrientation = orientationForSide(s.startAnchor.side)
        }
      }
      if (endId && s.endAnchor?.side) {
        const t = findSnapTarget(endId, s.endAnchor.targetKind)
        if (t) {
          nextEnd = getAnchorPoint(t, s.endAnchor.side)
          s.endOrientation = orientationForSide(s.endAnchor.side)
        }
      }

      const newDx = nextEnd.x - nextStart.x
      const newDy = nextEnd.y - nextStart.y

      // Keep curved controlPoint relative to the line's midpoint so moving cards never warps the curve
      if (s.curvature === 'curved' && s.controlPoint) {
        const newMid = { x: (nextStart.x + nextEnd.x) / 2, y: (nextStart.y + nextEnd.y) / 2 }
        const shiftX = newMid.x - oldMid.x
        const shiftY = newMid.y - oldMid.y
        s.controlPoint = {
          x: s.controlPoint.x + shiftX,
          y: s.controlPoint.y + shiftY,
        }
      }

      // Update orthogonal midOffset: for same-side U-shapes, maintain the user-set distance from the boxes.
      // For general / S-shape connectors, scale proportionally with distance changes.
      if (s.curvature === 'orthogonal') {
        const isSameSide = s.startAnchor?.side && s.startAnchor.side === s.endAnchor?.side
        if (isSameSide) {
          const side = s.startAnchor!.side!
          if (side === 'top') {
            if (s.midOffset !== undefined) {
              const oldMidY = oldStart.y + s.midOffset
              const userDist = Math.max(16, Math.min(oldStart.y, oldEnd.y) - oldMidY)
              const newMidY = Math.min(nextStart.y, nextEnd.y) - userDist
              s.midOffset = newMidY - nextStart.y
            }
          } else if (side === 'bottom') {
            if (s.midOffset !== undefined) {
              const oldMidY = oldStart.y + s.midOffset
              const userDist = Math.max(16, oldMidY - Math.max(oldStart.y, oldEnd.y))
              const newMidY = Math.max(nextStart.y, nextEnd.y) + userDist
              s.midOffset = newMidY - nextStart.y
            }
          } else if (side === 'left') {
            if (s.midOffset !== undefined) {
              const oldMidX = oldStart.x + s.midOffset
              const userDist = Math.max(16, Math.min(oldStart.x, oldEnd.x) - oldMidX)
              const newMidX = Math.min(nextStart.x, nextEnd.x) - userDist
              s.midOffset = newMidX - nextStart.x
            }
          } else if (side === 'right') {
            if (s.midOffset !== undefined) {
              const oldMidX = oldStart.x + s.midOffset
              const userDist = Math.max(16, oldMidX - Math.max(oldStart.x, oldEnd.x))
              const newMidX = Math.max(nextStart.x, nextEnd.x) + userDist
              s.midOffset = newMidX - nextStart.x
            }
          }
        } else if (s.midOffset !== undefined) {
          const startOri = s.startOrientation ?? (Math.abs(newDx) >= Math.abs(newDy) ? 'horizontal' : 'vertical')
          const endOri = s.endOrientation ?? startOri
          if (startOri === 'horizontal' && endOri === 'horizontal') {
            if (Math.abs(oldDx) > 10 && Math.sign(newDx) === Math.sign(oldDx)) {
              const ratio = Math.max(0.15, Math.min(0.85, s.midOffset / oldDx))
              s.midOffset = newDx * ratio
            } else {
              s.midOffset = undefined
            }
          } else if (startOri === 'vertical' && endOri === 'vertical') {
            if (Math.abs(oldDy) > 10 && Math.sign(newDy) === Math.sign(oldDy)) {
              const ratio = Math.max(0.15, Math.min(0.85, s.midOffset / oldDy))
              s.midOffset = newDy * ratio
            } else {
              s.midOffset = undefined
            }
          }
        }
      }

      s.x = nextStart.x
      s.y = nextStart.y
      s.width = newDx
      s.height = newDy
    }
  }

  /**
   * Clears `startAnchor` / `endAnchor` on any connector pointing to a deleted object ID.
   * If the connector was bound to a Vasta relation, unlinks the relation cleanly.
   */
  function detachAnchorsTo(deletedIds: Set<string>) {
    if (!deletedIds.size) return
    for (const s of shapes.value) {
      if (!isLine(s)) continue
      let detached = false
      const sId = anchorTargetId(s.startAnchor)
      if (sId && deletedIds.has(sId)) {
        delete s.startAnchor
        detached = true
      }
      const eId = anchorTargetId(s.endAnchor)
      if (eId && deletedIds.has(eId)) {
        delete s.endAnchor
        detached = true
      }
      if (detached && s.relation) {
        const rel = s.relation
        delete s.relation
        void removeRelationValueInVasta(rel.ownerObjectId, rel.propertyId, rel.targetObjectId)
      }
    }
  }

  function boundsOfKey(key: string): Box | undefined {
    const found = findItem(key)
    if (!found) return undefined
    if (found.kind === 'stroke') {
      const s = found.item as InkStroke
      if (!s.points.length) return undefined
      const b = pointsBox(s.points, s.width / 2)
      if (!s.rotation) return b
      const center = { x: b.x + b.w / 2, y: b.y + b.h / 2 }
      const corners = [
        rotatePoint({ x: b.x, y: b.y }, center, s.rotation),
        rotatePoint({ x: b.x + b.w, y: b.y }, center, s.rotation),
        rotatePoint({ x: b.x + b.w, y: b.y + b.h }, center, s.rotation),
        rotatePoint({ x: b.x, y: b.y + b.h }, center, s.rotation),
      ]
      return pointsBox(corners)
    }
    if (found.kind === 'shape') {
      const s = found.item as ShapeElement
      const b = {
        x: Math.min(s.x, s.x + s.width),
        y: Math.min(s.y, s.y + s.height),
        w: Math.abs(s.width),
        h: Math.abs(s.height),
      }
      if (isLine(s) || !s.rotation) return b
      const center = { x: b.x + b.w / 2, y: b.y + b.h / 2 }
      const corners = [
        rotatePoint({ x: b.x, y: b.y }, center, s.rotation),
        rotatePoint({ x: b.x + b.w, y: b.y }, center, s.rotation),
        rotatePoint({ x: b.x + b.w, y: b.y + b.h }, center, s.rotation),
        rotatePoint({ x: b.x, y: b.y + b.h }, center, s.rotation),
      ]
      return pointsBox(corners)
    }
    const i = found.item as ObjectCardElement | StickyElement
    const b = { x: i.x, y: i.y, w: i.width, h: i.height }
    if (!i.rotation) return b
    const center = { x: b.x + b.w / 2, y: b.y + b.h / 2 }
    const corners = [
      rotatePoint({ x: b.x, y: b.y }, center, i.rotation),
      rotatePoint({ x: b.x + b.w, y: b.y }, center, i.rotation),
      rotatePoint({ x: b.x + b.w, y: b.y + b.h }, center, i.rotation),
      rotatePoint({ x: b.x, y: b.y + b.h }, center, i.rotation),
    ]
    return pointsBox(corners)
  }

  const allKeys = () => [
    ...strokes.value.map((s) => keyOf('stroke', s.id)),
    ...shapes.value.map((s) => keyOf('shape', s.id)),
    ...cards.value.map((c) => keyOf('card', c.id)),
    ...stickies.value.map((s) => keyOf('sticky', s.id)),
  ]

  function getAllRawItems(): { key: string; kind: Kind; item: InkStroke | ShapeElement | ObjectCardElement | StickyElement }[] {
    return [
      ...strokes.value.map((s) => ({ key: keyOf('stroke', s.id), kind: 'stroke' as const, item: s })),
      ...shapes.value.map((s) => ({ key: keyOf('shape', s.id), kind: 'shape' as const, item: s })),
      ...cards.value.map((c) => ({ key: keyOf('card', c.id), kind: 'card' as const, item: c })),
      ...stickies.value.map((st) => ({ key: keyOf('sticky', st.id), kind: 'sticky' as const, item: st })),
    ]
  }

  function ensureZIndices() {
    let z = 1
    const raw = getAllRawItems()
    for (const entry of raw) {
      if (entry.kind === 'shape' && isLine(entry.item as ShapeElement)) {
        if (entry.item.zIndex === undefined) entry.item.zIndex = z++
      }
    }
    z = 100
    for (const entry of raw) {
      if (entry.kind !== 'shape' || !isLine(entry.item as ShapeElement)) {
        if (entry.item.zIndex === undefined) entry.item.zIndex = z++
      }
    }
  }
  ensureZIndices()

  function renormalizeZIndices() {
    const raw = getAllRawItems()
    const lines = raw.filter((e) => e.kind === 'shape' && isLine(e.item as ShapeElement)).sort((a, b) => (a.item.zIndex ?? 0) - (b.item.zIndex ?? 0))
    const nonLines = raw.filter((e) => e.kind !== 'shape' || !isLine(e.item as ShapeElement)).sort((a, b) => (a.item.zIndex ?? 0) - (b.item.zIndex ?? 0))
    lines.forEach((entry, idx) => {
      entry.item.zIndex = idx + 1
    })
    nonLines.forEach((entry, idx) => {
      entry.item.zIndex = 100 + idx
    })
  }
  renormalizeZIndices()

  function getMaxZIndex(): number {
    let max = 100
    const raw = getAllRawItems()
    for (const entry of raw) {
      if ((entry.item.zIndex ?? 0) > max) max = entry.item.zIndex!
    }
    return max
  }

  const allCanvasItems = computed<CanvasItem[]>(() => {
    const raw = getAllRawItems()
    const list: CanvasItem[] = raw.map((entry): CanvasItem => {
      if (entry.kind === 'stroke') {
        const s = entry.item as InkStroke
        return {
          key: entry.key,
          kind: 'stroke',
          zIndex: Math.max(s.zIndex ?? 100, 100),
          item: s,
          pathD: s.points.map((p, i) => `${i ? 'L' : 'M'} ${p.x} ${p.y}`).join(' '),
          center: s.rotation ? getStrokeCenter(s) : undefined,
        }
      }
      if (entry.kind === 'shape') {
        const s = entry.item as ShapeElement
        const line = isLine(s)
        return {
          key: entry.key,
          kind: 'shape',
          zIndex: line ? Math.min(s.zIndex ?? 1, 99) : Math.max(s.zIndex ?? 100, 100),
          item: s,
          isLine: line,
          connectorGeo: line ? getConnectorGeometry(s) : undefined,
          relationInfo: line ? getConnectorRelationInfo(s) : null,
        }
      }
      if (entry.kind === 'sticky') {
        const st = entry.item as StickyElement
        return {
          key: entry.key,
          kind: 'sticky',
          zIndex: Math.max(st.zIndex ?? 100, 100),
          item: st,
          palette: stickyStyle(st.color),
        }
      }
      const c = entry.item as ObjectCardElement
      return {
        key: entry.key,
        kind: 'card',
        zIndex: Math.max(c.zIndex ?? 100, 100),
        item: c,
      }
    })
    return list.sort((a, b) => a.zIndex - b.zIndex)
  })

  const selectionBox = computed<Box | null>(() => {
    const boxes = selected.value.map(boundsOfKey).filter((b): b is Box => !!b)
    if (!boxes.length) return null
    const pad = 5 / zoom.value
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    for (const b of boxes) {
      if (b.x < minX) minX = b.x
      if (b.y < minY) minY = b.y
      if (b.x + b.w > maxX) maxX = b.x + b.w
      if (b.y + b.h > maxY) maxY = b.y + b.h
    }
    const x = minX - pad
    const y = minY - pad
    return { x, y, w: maxX + pad - x, h: maxY + pad - y }
  })

  const isOnlySelectedLine = computed(() => {
    if (selected.value.length !== 1) return false
    const key = selected.value[0]!
    if (!key.startsWith('shape:')) return false
    const s = shapes.value.find((x) => x.id === parseKey(key).id)
    return !!(s && isLine(s))
  })

  const selectedGeometry = computed<SelectedGeometry | null>(() => {
    if (selected.value.length === 0) return null
    if (selected.value.length === 1) {
      const key = selected.value[0]!
      const found = findItem(key)
      if (!found) return null

      if (found.kind === 'shape' && isLine(found.item as ShapeElement)) {
        const s = found.item as ShapeElement
        const geo = getConnectorGeometry(s)
        const handles: Handle[] = [
          { id: 'start', x: s.x, y: s.y },
          { id: 'end', x: s.x + s.width, y: s.y + s.height },
        ]

        if (geo.midPoint) {
          handles.push({ id: 'mid', x: geo.midPoint.x, y: geo.midPoint.y })
        }

        return {
          isSingle: true,
          isLine: true,
          isTriangle: false,
          box: { x: s.x, y: s.y, w: s.width, h: s.height },
          center: { x: s.x + s.width / 2, y: s.y + s.height / 2 },
          rotation: 0,
          shapeType: s.type,
          handles,
          rotateHandle: null,
        }
      }

      if (found.kind === 'shape') {
        const s = found.item as ShapeElement
        const box: Box = { x: s.x, y: s.y, w: s.width, h: s.height }
        const center: Point = { x: s.x + s.width / 2, y: s.y + s.height / 2 }
        const rot = s.rotation || 0

        const nw = { id: 'nw' as ResizeHandleId, x: box.x, y: box.y }
        const ne = { id: 'ne' as ResizeHandleId, x: box.x + box.w, y: box.y }
        const se = { id: 'se' as ResizeHandleId, x: box.x + box.w, y: box.y + box.h }
        const sw = { id: 'sw' as ResizeHandleId, x: box.x, y: box.y + box.h }
        const rh = { x: center.x, y: box.y - 28 / zoom.value }
        return {
          isSingle: true,
          isLine: false,
          isTriangle: false,
          box,
          center,
          rotation: rot,
          shapeType: s.type,
          handles: [
            { id: 'nw', ...(rot ? rotatePoint(nw, center, rot) : nw) },
            { id: 'ne', ...(rot ? rotatePoint(ne, center, rot) : ne) },
            { id: 'se', ...(rot ? rotatePoint(se, center, rot) : se) },
            { id: 'sw', ...(rot ? rotatePoint(sw, center, rot) : sw) },
          ],
          rotateHandle: rot ? rotatePoint(rh, center, rot) : rh,
        }
      }

      if (found.kind === 'stroke') {
        const s = found.item as InkStroke
        const box = pointsBox(s.points)
        const center: Point = { x: box.x + box.w / 2, y: box.y + box.h / 2 }
        const rot = s.rotation || 0
        const nw = { id: 'nw' as ResizeHandleId, x: box.x, y: box.y }
        const ne = { id: 'ne' as ResizeHandleId, x: box.x + box.w, y: box.y }
        const se = { id: 'se' as ResizeHandleId, x: box.x + box.w, y: box.y + box.h }
        const sw = { id: 'sw' as ResizeHandleId, x: box.x, y: box.y + box.h }
        const rh = { x: center.x, y: box.y - 28 / zoom.value }
        return {
          isSingle: true,
          isLine: false,
          isTriangle: false,
          box,
          center,
          rotation: rot,
          handles: [
            { id: 'nw', ...(rot ? rotatePoint(nw, center, rot) : nw) },
            { id: 'ne', ...(rot ? rotatePoint(ne, center, rot) : ne) },
            { id: 'se', ...(rot ? rotatePoint(se, center, rot) : se) },
            { id: 'sw', ...(rot ? rotatePoint(sw, center, rot) : sw) },
          ],
          rotateHandle: rot ? rotatePoint(rh, center, rot) : rh,
        }
      }

      const i = found.item as ObjectCardElement | StickyElement
      const box: Box = { x: i.x, y: i.y, w: i.width, h: i.height }
      const center: Point = { x: i.x + i.width / 2, y: i.y + i.height / 2 }
      const rot = i.rotation || 0
      const nw = { id: 'nw' as ResizeHandleId, x: box.x, y: box.y }
      const ne = { id: 'ne' as ResizeHandleId, x: box.x + box.w, y: box.y }
      const se = { id: 'se' as ResizeHandleId, x: box.x + box.w, y: box.y + box.h }
      const sw = { id: 'sw' as ResizeHandleId, x: box.x, y: box.y + box.h }
      const rh = { x: center.x, y: box.y - 28 / zoom.value }
      return {
        isSingle: true,
        isLine: false,
        isTriangle: false,
        box,
        center,
        rotation: rot,
        handles: [
          { id: 'nw', ...(rot ? rotatePoint(nw, center, rot) : nw) },
          { id: 'ne', ...(rot ? rotatePoint(ne, center, rot) : ne) },
          { id: 'se', ...(rot ? rotatePoint(se, center, rot) : se) },
          { id: 'sw', ...(rot ? rotatePoint(sw, center, rot) : sw) },
        ],
        rotateHandle: rot ? rotatePoint(rh, center, rot) : rh,
      }
    }

    const b = selectionBox.value
    if (!b) return null
    const center: Point = { x: b.x + b.w / 2, y: b.y + b.h / 2 }
    const nw = { id: 'nw' as ResizeHandleId, x: b.x, y: b.y }
    const ne = { id: 'ne' as ResizeHandleId, x: b.x + b.w, y: b.y }
    const se = { id: 'se' as ResizeHandleId, x: b.x + b.w, y: b.y + b.h }
    const sw = { id: 'sw' as ResizeHandleId, x: b.x, y: b.y + b.h }
    const rh = { x: center.x, y: b.y - 28 / zoom.value }
    return {
      isSingle: false,
      isLine: false,
      isTriangle: false,
      box: b,
      center,
      rotation: 0,
      handles: [nw, ne, se, sw],
      rotateHandle: rh,
    }
  })

  function hitRotateHandle(pt: Point, kind: 'pen' | 'touch' | 'mouse'): boolean {
    if (!selectedGeometry.value || !selectedGeometry.value.rotateHandle) return false
    const tol = (kind === 'mouse' ? 14 : 26) / zoom.value
    return Math.hypot(pt.x - selectedGeometry.value.rotateHandle.x, pt.y - selectedGeometry.value.rotateHandle.y) <= tol
  }

  const handles = computed<Handle[]>(() => selectedGeometry.value?.handles || [])

  const selectedStickyIds = computed(() => selected.value.filter((k) => k.startsWith('sticky:')).map((k) => parseKey(k).id))
  const selectedShapeIds = computed(() => selected.value.filter((k) => k.startsWith('shape:')).map((k) => parseKey(k).id))
  const selectedStrokeIds = computed(() => selected.value.filter((k) => k.startsWith('stroke:')).map((k) => parseKey(k).id))
  const selectedCardIds = computed(() => selected.value.filter((k) => k.startsWith('card:')).map((k) => parseKey(k).id))
  const hasSelectedLines = computed(() =>
    selectedShapeIds.value.some((id) => {
      const s = shapes.value.find((x) => x.id === id)
      return s && isLine(s)
    }),
  )
  const hasSelected2DShapes = computed(() =>
    selectedShapeIds.value.some((id) => {
      const s = shapes.value.find((x) => x.id === id)
      return s && !isLine(s)
    }),
  )
  const hasSelectedItems = computed(() => selected.value.length > 0)

  const selectionStartAnchored = computed(() =>
    selectedShapeIds.value.some((id) => {
      const s = shapes.value.find((x) => x.id === id)
      return !!(s && isLine(s) && anchorTargetId(s.startAnchor))
    }),
  )
  const selectionEndAnchored = computed(() =>
    selectedShapeIds.value.some((id) => {
      const s = shapes.value.find((x) => x.id === id)
      return !!(s && isLine(s) && anchorTargetId(s.endAnchor))
    }),
  )

  function hitTest(pt: Point, only?: string[]): string | undefined {
    const tol = 12 / zoom.value
    const allowed = (key: string) => !only || only.includes(key)
    const items = allCanvasItems.value
    for (let idx = items.length - 1; idx >= 0; idx--) {
      const entry = items[idx]!
      if (!allowed(entry.key)) continue
      if (entry.kind === 'sticky') {
        const s = entry.item as StickyElement
        const cx = s.x + s.width / 2
        const cy = s.y + s.height / 2
        const testPt = s.rotation ? rotatePoint(pt, { x: cx, y: cy }, -s.rotation) : pt
        if (testPt.x >= s.x && testPt.x <= s.x + s.width && testPt.y >= s.y && testPt.y <= s.y + s.height) return entry.key
      } else if (entry.kind === 'card') {
        const c = entry.item as ObjectCardElement
        const cx = c.x + c.width / 2
        const cy = c.y + c.height / 2
        const testPt = c.rotation ? rotatePoint(pt, { x: cx, y: cy }, -c.rotation) : pt
        if (testPt.x >= c.x && testPt.x <= c.x + c.width && testPt.y >= c.y && testPt.y <= c.y + c.height) return entry.key
      } else if (entry.kind === 'shape') {
        const s = entry.item as ShapeElement
        if (shapeHit(s, pt, tol)) return entry.key
      } else if (entry.kind === 'stroke') {
        const s = entry.item as InkStroke
        const center = getStrokeCenter(s)
        const testPt = s.rotation ? rotatePoint(pt, center, -s.rotation) : pt
        if (distToPolyline(testPt, s.points) <= tol + s.width / 2) return entry.key
      }
    }
    return undefined
  }

  function hitHandle(pt: Point, kind: 'pen' | 'touch' | 'mouse'): Handle | undefined {
    const tol = (kind === 'mouse' ? 12 : 24) / zoom.value
    return handles.value.find((h) => Math.hypot(h.x - pt.x, h.y - pt.y) <= tol)
  }

  function deleteSelected() {
    if (!selected.value.length) return
    const gone = new Set(selected.value)
    const deletedObjectIds = new Set(selected.value.map((k) => parseKey(k).id))
    for (const s of shapes.value) {
      if (gone.has(keyOf('shape', s.id)) && isLine(s) && s.relation) {
        const rel = s.relation
        const info = getConnectorRelationInfo(s)
        void removeRelationValueInVasta(rel.ownerObjectId, rel.propertyId, rel.targetObjectId).then(() => {
          notice.value = {
            message: `Unlinked ${info?.propertyName || 'relation'} (${info?.ownerTitle || 'Object'} → ${info?.targetTitle || 'Object'})`,
            action: {
              label: 'Undo',
              run: async () => {
                await addRelationValueInVasta(rel.ownerObjectId, rel.propertyId, rel.targetObjectId, true)
              },
            },
          }
        })
      }
    }
    strokes.value = strokes.value.filter((s) => !gone.has(keyOf('stroke', s.id)))
    shapes.value = shapes.value.filter((s) => !gone.has(keyOf('shape', s.id)))
    cards.value = cards.value.filter((c) => !gone.has(keyOf('card', c.id)))
    stickies.value = stickies.value.filter((s) => !gone.has(keyOf('sticky', s.id)))
    detachAnchorsTo(deletedObjectIds)
    selected.value = []
    editingId.value = null
    pushHistory()
  }

  function duplicateSelected() {
    const offset = 28
    const next: string[] = []
    for (const key of selected.value) {
      const found = findItem(key)
      if (!found) continue
      const copy = clone(found.item) as InkStroke & ShapeElement & ObjectCardElement & StickyElement
      copy.id = newId()
      copy.zIndex = found.kind === 'shape' && isLine(copy) ? 1 : getMaxZIndex() + 1
      if (found.kind === 'stroke') copy.points = copy.points.map((p) => ({ ...p, x: p.x + offset, y: p.y + offset }))
      else {
        copy.x += offset
        copy.y += offset
        if (found.kind === 'shape' && isLine(copy)) {
          delete copy.startAnchor
          delete copy.endAnchor
          delete copy.relation
          if (copy.controlPoint) {
            copy.controlPoint = { x: copy.controlPoint.x + offset, y: copy.controlPoint.y + offset }
          }
        }
      }
      if (found.kind === 'stroke') strokes.value.push(copy)
      else if (found.kind === 'shape') shapes.value.push(copy)
      else if (found.kind === 'card') cards.value.push(copy)
      else stickies.value.push(copy)
      next.push(keyOf(found.kind, copy.id))
    }
    selected.value = next
    pushHistory()
  }

  function setSelectionColor(color: string) {
    let changed = false
    for (const key of selected.value) {
      const found = findItem(key)
      if (found && (found.kind === 'stroke' || found.kind === 'shape')) {
        ;(found.item as InkStroke | ShapeElement).color = color
        if (found.kind === 'shape') {
          const s = found.item as ShapeElement
          if (!isLine(s)) {
            shape2DSettings.value[s.type as Shape2DType].color = color
            saveShapeSettings()
          } else {
            connectorSettings.value.color = color
            saveConnectorSettings()
          }
        }
        changed = true
      }
    }
    if (changed) pushHistory()
  }

  function setSelectionStrokeWidth(w: number) {
    let changed = false
    for (const key of selected.value) {
      const found = findItem(key)
      if (found) {
        if (found.kind === 'stroke') {
          ;(found.item as InkStroke).width = w
          changed = true
        } else if (found.kind === 'shape') {
          const s = found.item as ShapeElement
          s.strokeWidth = w
          if (!isLine(s)) {
            shape2DSettings.value[s.type as Shape2DType].strokeWidth = w
            saveShapeSettings()
          } else {
            connectorSettings.value.strokeWidth = w
            saveConnectorSettings()
          }
          changed = true
        }
      }
    }
    if (changed) pushHistory()
  }

  function setSelectionStrokeStyle(style: StrokeStyle) {
    let changed = false
    for (const key of selected.value) {
      const found = findItem(key)
      if (found) {
        if (found.kind === 'stroke') {
          ;(found.item as InkStroke).style = style
          changed = true
        } else if (found.kind === 'shape') {
          const s = found.item as ShapeElement
          s.strokeStyle = style
          if (!isLine(s)) {
            shape2DSettings.value[s.type as Shape2DType].strokeStyle = style
            saveShapeSettings()
          } else {
            connectorSettings.value.strokeStyle = style
            saveConnectorSettings()
          }
          changed = true
        }
      }
    }
    if (changed) pushHistory()
  }

  function setSelectionFill(fill: ShapeFill) {
    let changed = false
    for (const id of selectedShapeIds.value) {
      const s = shapes.value.find((x) => x.id === id)
      if (s && !isLine(s)) {
        s.fill = fill
        shape2DSettings.value[s.type as Shape2DType].fill = fill
        saveShapeSettings()
        changed = true
      }
    }
    if (changed) pushHistory()
  }

  function setSelectionFillColor(color: string) {
    let changed = false
    for (const id of selectedShapeIds.value) {
      const s = shapes.value.find((x) => x.id === id)
      if (s && !isLine(s)) {
        s.fillColor = color
        if (s.fill === 'none') s.fill = 'solid'
        shape2DSettings.value[s.type as Shape2DType].fillColor = color
        shape2DSettings.value[s.type as Shape2DType].fill = s.fill as ShapeFill
        saveShapeSettings()
        changed = true
      }
    }
    if (changed) pushHistory()
  }

  function setSelectionCurvature(curvature: LineCurvature) {
    let changed = false
    for (const id of selectedShapeIds.value) {
      const s = shapes.value.find((x) => x.id === id)
      if (s && isLine(s)) {
        s.curvature = curvature
        s.controlPoint = undefined
        s.midOffset = undefined
        connectorSettings.value.curvature = curvature
        saveConnectorSettings()
        changed = true
      }
    }
    if (changed) pushHistory()
  }

  function setSelectionStartOrientation(ori: 'horizontal' | 'vertical') {
    let changed = false
    for (const id of selectedShapeIds.value) {
      const s = shapes.value.find((x) => x.id === id)
      if (s && isLine(s) && !anchorTargetId(s.startAnchor)) {
        s.startOrientation = ori
        s.midOffset = undefined
        changed = true
      }
    }
    if (changed) pushHistory()
  }

  function setSelectionEndOrientation(ori: 'horizontal' | 'vertical') {
    let changed = false
    for (const id of selectedShapeIds.value) {
      const s = shapes.value.find((x) => x.id === id)
      if (s && isLine(s) && !anchorTargetId(s.endAnchor)) {
        s.endOrientation = ori
        s.midOffset = undefined
        changed = true
      }
    }
    if (changed) pushHistory()
  }

  function setSelectionStartTermination(term: LineTermination) {
    let changed = false
    for (const id of selectedShapeIds.value) {
      const s = shapes.value.find((x) => x.id === id)
      if (s && isLine(s)) {
        s.startHead = term
        connectorSettings.value.startHead = term
        saveConnectorSettings()
        changed = true
      }
    }
    if (changed) pushHistory()
  }

  function setSelectionEndTermination(term: LineTermination) {
    let changed = false
    for (const id of selectedShapeIds.value) {
      const s = shapes.value.find((x) => x.id === id)
      if (s && isLine(s)) {
        s.endHead = term
        connectorSettings.value.endHead = term
        saveConnectorSettings()
        changed = true
      }
    }
    if (changed) pushHistory()
  }

  function setSelectionStickyColor(name: string) {
    currentStickyColor.value = name
    for (const id of selectedStickyIds.value) {
      const s = stickies.value.find((x) => x.id === id)
      if (s) s.color = name
    }
    pushHistory()
  }

  function setSelectionStickyTextColor(color: string) {
    currentStickyTextColor.value = color
    for (const id of selectedStickyIds.value) {
      const s = stickies.value.find((x) => x.id === id)
      if (s) s.textColor = color
    }
    pushHistory()
  }

  function setSelectionStickyFontSize(size: StickyFontSize) {
    currentStickyFontSize.value = size
    for (const id of selectedStickyIds.value) {
      const s = stickies.value.find((x) => x.id === id)
      if (s) s.fontSize = size
    }
    pushHistory()
  }

  function bringToFront() {
    if (!selected.value.length) return
    renormalizeZIndices()
    const raw = getAllRawItems()
    const nonSelected = raw.filter((e) => !selected.value.includes(e.key)).sort((a, b) => (a.item.zIndex ?? 0) - (b.item.zIndex ?? 0))
    const sel = raw.filter((e) => selected.value.includes(e.key)).sort((a, b) => (a.item.zIndex ?? 0) - (b.item.zIndex ?? 0))
    const combined = [...nonSelected, ...sel]
    combined.forEach((entry, idx) => {
      entry.item.zIndex = idx + 1
    })
    pushHistory()
  }

  function sendToBack() {
    if (!selected.value.length) return
    renormalizeZIndices()
    const raw = getAllRawItems()
    const sel = raw.filter((e) => selected.value.includes(e.key)).sort((a, b) => (a.item.zIndex ?? 0) - (b.item.zIndex ?? 0))
    const nonSelected = raw.filter((e) => !selected.value.includes(e.key)).sort((a, b) => (a.item.zIndex ?? 0) - (b.item.zIndex ?? 0))
    const combined = [...sel, ...nonSelected]
    combined.forEach((entry, idx) => {
      entry.item.zIndex = idx + 1
    })
    pushHistory()
  }

  function bringForward() {
    if (!selected.value.length) return
    renormalizeZIndices()
    const raw = getAllRawItems()
    raw.sort((a, b) => (a.item.zIndex ?? 0) - (b.item.zIndex ?? 0))
    let changed = false
    for (let i = raw.length - 2; i >= 0; i--) {
      if (selected.value.includes(raw[i]!.key) && !selected.value.includes(raw[i + 1]!.key)) {
        const temp = raw[i]!
        raw[i] = raw[i + 1]!
        raw[i + 1] = temp
        changed = true
      }
    }
    if (changed) {
      raw.forEach((entry, idx) => {
        entry.item.zIndex = idx + 1
      })
      pushHistory()
    }
  }

  function sendBackward() {
    if (!selected.value.length) return
    renormalizeZIndices()
    const raw = getAllRawItems()
    raw.sort((a, b) => (a.item.zIndex ?? 0) - (b.item.zIndex ?? 0))
    let changed = false
    for (let i = 1; i < raw.length; i++) {
      if (selected.value.includes(raw[i]!.key) && !selected.value.includes(raw[i - 1]!.key)) {
        const temp = raw[i]!
        raw[i] = raw[i - 1]!
        raw[i - 1] = temp
        changed = true
      }
    }
    if (changed) {
      raw.forEach((entry, idx) => {
        entry.item.zIndex = idx + 1
      })
      pushHistory()
    }
  }

  const selectionPrimaryColor = computed(() => {
    for (const key of selected.value) {
      const found = findItem(key)
      if (found) {
        if (found.kind === 'stroke') return (found.item as InkStroke).color
        if (found.kind === 'shape') {
          const s = found.item as ShapeElement
          return shapeFillTab.value === 'fill' ? s.fillColor || s.color : s.color
        }
        if (found.kind === 'sticky')
          return (found.item as StickyElement).textColor || stickyStyle((found.item as StickyElement).color).bg
      }
    }
    return shape2DSettings.value[currentShape2D.value].color
  })

  const selectionShapeFill = computed(() => {
    for (const id of selectedShapeIds.value) {
      const s = shapes.value.find((x) => x.id === id)
      if (s && !isLine(s)) return (s.fill as ShapeFill) || 'none'
    }
    return shape2DSettings.value[currentShape2D.value].fill
  })

  const selectionShapeFillColor = computed(() => {
    for (const id of selectedShapeIds.value) {
      const s = shapes.value.find((x) => x.id === id)
      if (s && !isLine(s)) return s.fillColor || s.color
    }
    return shape2DSettings.value[currentShape2D.value].fillColor || shape2DSettings.value[currentShape2D.value].color
  })

  const selectionStickyTextColor = computed(() => {
    for (const id of selectedStickyIds.value) {
      const s = stickies.value.find((x) => x.id === id)
      if (s && s.textColor) return s.textColor
    }
    return currentStickyTextColor.value
  })

  const selectionCurvature = computed<LineCurvature>(() => {
    for (const id of selectedShapeIds.value) {
      const s = shapes.value.find((x) => x.id === id)
      if (s && isLine(s) && s.curvature) return s.curvature
    }
    return connectorSettings.value.curvature
  })

  const selectionStartOrientation = computed<'horizontal' | 'vertical'>(() => {
    for (const id of selectedShapeIds.value) {
      const s = shapes.value.find((x) => x.id === id)
      if (s && isLine(s)) {
        const locked = orientationForSide(s.startAnchor?.side)
        if (locked) return locked
        if (s.startOrientation) return s.startOrientation
        if (s.orientation) return s.orientation
      }
    }
    return 'horizontal'
  })

  const selectionEndOrientation = computed<'horizontal' | 'vertical'>(() => {
    for (const id of selectedShapeIds.value) {
      const s = shapes.value.find((x) => x.id === id)
      if (s && isLine(s)) {
        const locked = orientationForSide(s.endAnchor?.side)
        if (locked) return locked
        if (s.endOrientation) return s.endOrientation
        if (s.orientation) return s.orientation
      }
    }
    return 'horizontal'
  })

  const selectionStrokeWidth = computed(() => {
    for (const key of selected.value) {
      const found = findItem(key)
      if (found) {
        if (found.kind === 'stroke') return (found.item as InkStroke).width
        if (found.kind === 'shape') return (found.item as ShapeElement).strokeWidth || 3
      }
    }
    return 3
  })

  const selectionStrokeStyle = computed<StrokeStyle>(() => {
    for (const key of selected.value) {
      const found = findItem(key)
      if (found) {
        if (found.kind === 'stroke') return (found.item as InkStroke).style || 'solid'
        if (found.kind === 'shape') return (found.item as ShapeElement).strokeStyle || 'solid'
      }
    }
    return 'solid'
  })

  const selectionStartTermination = computed<LineTermination>(() => {
    for (const id of selectedShapeIds.value) {
      const s = shapes.value.find((x) => x.id === id)
      if (s && isLine(s)) {
        if (s.startHead) return s.startHead
        if (s.arrowHead === 'double') return 'arrow'
        if (s.arrowHead === 'dot') return 'dot'
        return 'none'
      }
    }
    return connectorSettings.value.startHead
  })

  const selectionEndTermination = computed<LineTermination>(() => {
    for (const id of selectedShapeIds.value) {
      const s = shapes.value.find((x) => x.id === id)
      if (s && isLine(s)) {
        if (s.endHead) return s.endHead
        if (s.arrowHead === 'single' || s.arrowHead === 'double') return 'arrow'
        if (s.arrowHead === 'dot') return 'dot'
        return s.type === 'arrow' ? 'arrow' : 'none'
      }
    }
    return connectorSettings.value.endHead
  })

  const selectionOutlineColor = computed(() => {
    for (const id of selectedShapeIds.value) {
      const s = shapes.value.find((x) => x.id === id)
      if (s && !isLine(s)) return s.color
    }
    return shape2DSettings.value[currentShape2D.value].color
  })

  const selectionFillPreviewBg = computed(() => {
    for (const id of selectedShapeIds.value) {
      const s = shapes.value.find((x) => x.id === id)
      if (s && !isLine(s)) {
        if (s.fill === 'none') return 'transparent'
        if (s.fill === 'white') return '#ffffff'
        const base = s.fillColor || s.color
        if (s.fill === 'tint') return `${base}40`
        return base
      }
    }
    return dockShape2DFill.value
  })

  const selectionScreenBox = computed(() => {
    if (!selectionBox.value) return null
    const b = selectionBox.value
    const x = b.x * zoom.value + pan.value.x
    const y = b.y * zoom.value + pan.value.y
    const w = b.w * zoom.value
    const h = b.h * zoom.value
    return { x, y, w, h }
  })

  const floatingMenuStyle = computed(() => {
    if (!selectionScreenBox.value || !containerRef.value) return {}
    const sb = selectionScreenBox.value
    const cRect = containerRef.value.getBoundingClientRect()
    const centerX = sb.x + sb.w / 2
    const left = Math.max(150, Math.min(centerX, cRect.width - 150))
    const rawTop = sb.y > 90 ? sb.y - 76 : sb.y + sb.h + 24
    const top = Math.max(12, Math.min(rawTop, cRect.height - 60))
    return {
      left: `${left}px`,
      top: `${top}px`,
      transform: 'translateX(-50%)',
    }
  })

  const floatingPopoverStyle = computed(() => {
    if (!selectionScreenBox.value || !containerRef.value) return {}
    const sb = selectionScreenBox.value
    const cRect = containerRef.value.getBoundingClientRect()
    const centerX = sb.x + sb.w / 2
    const left = Math.max(170, Math.min(centerX, cRect.width - 170))
    const popoverEstH = 340
    let top: number
    if (sb.y > popoverEstH + 40) {
      top = sb.y - popoverEstH - 12
    } else if (cRect.height - (sb.y + sb.h) > popoverEstH + 40) {
      top = sb.y + sb.h + 48
    } else {
      top = Math.max(12, (cRect.height - popoverEstH) / 2)
    }
    top = Math.max(12, Math.min(top, Math.max(12, cRect.height - 200)))
    return {
      left: `${left}px`,
      top: `${top}px`,
      transform: 'translateX(-50%)',
    }
  })

  function selectAll() {
    selected.value = allKeys()
  }

  // Object Card helper functions
  function getCardTitle(card: ObjectCardElement): string {
    const s = cachedSummary(card.objectId)
    if (s) {
      const type = typesById.value.get(s.typeId)
      return s.title || displayTitle(s, type)
    }
    return card.title || 'Untitled'
  }

  function getCardTypeName(card: ObjectCardElement): string {
    const s = cachedSummary(card.objectId)
    const typeId = s?.typeId || card.typeId
    const type = typesById.value.get(typeId)
    return type?.name || card.typeName || 'Page'
  }

  function getCardTypeIcon(card: ObjectCardElement): string {
    const s = cachedSummary(card.objectId)
    const typeId = s?.typeId || card.typeId
    const type = typesById.value.get(typeId)
    return type?.icon?.value || card.typeIcon || 'ph:cube'
  }

  function getCardTypeColor(card: ObjectCardElement): string | undefined {
    const s = cachedSummary(card.objectId)
    const typeId = s?.typeId || card.typeId
    const type = typesById.value.get(typeId)
    return type?.color || card.typeColor
  }

  function getCardSummary(card: ObjectCardElement): ObjectSummary | undefined {
    return cachedSummary(card.objectId)
  }

  function getCardPreview(card: ObjectCardElement): string {
    const summary = cachedSummary(card.objectId)
    return summary?.preview || ''
  }

  function getCardShownProperties(card: ObjectCardElement): PropertyDef[] {
    if (!card.showProperties || !card.showProperties.length) return []
    const summary = cachedSummary(card.objectId)
    const typeId = summary?.typeId || card.typeId
    const type = typesById.value.get(typeId)
    if (!type?.properties) return []
    return type.properties.filter((p) => card.showProperties!.includes(p.id))
  }

  function getCardPropertyValue(card: ObjectCardElement, propId: string) {
    const summary = cachedSummary(card.objectId)
    return summary?.props?.[propId]
  }

  const selectedCard = computed(() => {
    if (selectedCardIds.value.length !== 1) return null
    return cards.value.find((c) => c.id === selectedCardIds.value[0]) || null
  })

  const selectedCardIsQuery = computed(() => {
    if (!selectedCard.value) return false
    const summary = cachedSummary(selectedCard.value.objectId)
    const type = typesById.value.get(summary?.typeId || selectedCard.value.typeId)
    return !!summary?.query || type?.system === 'query'
  })

  const selectedCardContentMode = computed<CardContentMode>(() => {
    const c = selectedCard.value
    if (!c) return 'none'
    if (c.contentMode) return c.contentMode
    return c.showContent ? 'preview' : 'none'
  })

  const selectedCardAvailableProperties = computed<PropertyDef[]>(() => {
    if (!selectedCard.value) return []
    const summary = cachedSummary(selectedCard.value.objectId)
    const typeId = summary?.typeId || selectedCard.value.typeId
    const type = typesById.value.get(typeId)
    return (type?.properties || []).filter((p) => p.kind !== 'rich-text')
  })

  function isCardPropertyShown(propId: string): boolean {
    return !!selectedCard.value?.showProperties?.includes(propId)
  }

  function setCardContentMode(mode: CardContentMode) {
    if (!selectedCard.value) return
    selectedCard.value.contentMode = mode
    selectedCard.value.showContent = mode !== 'none'
    if (mode === 'preview' && selectedCard.value.height < 160) {
      selectedCard.value.height = 170
    } else if (mode === 'full') {
      if (selectedCard.value.height < 260) selectedCard.value.height = 280
      if (selectedCard.value.width < 300) selectedCard.value.width = 320
    }
    syncAnchoredConnectors()
    void nextTick(() => syncAnchoredConnectors())
    pushHistory()
    notifyChange()
  }

  function toggleCardShowContent() {
    setCardContentMode(selectedCardContentMode.value === 'none' ? 'preview' : 'none')
  }

  function toggleCardProperty(propId: string) {
    if (!selectedCard.value) return
    const current = selectedCard.value.showProperties ? [...selectedCard.value.showProperties] : []
    const idx = current.indexOf(propId)
    if (idx >= 0) {
      current.splice(idx, 1)
    } else {
      current.push(propId)
    }
    selectedCard.value.showProperties = current
    if (current.length > 0 && selectedCard.value.height < 140) {
      selectedCard.value.height = Math.max(selectedCard.value.height, 120 + current.length * 22)
    }
    syncAnchoredConnectors()
    void nextTick(() => syncAnchoredConnectors())
    pushHistory()
    notifyChange()
  }

  // ---------------------------------------------------------------------------
  // Connector-as-Relation (Binding Whiteboard Connectors to Vasta Relations)
  // ---------------------------------------------------------------------------

  const selectedConnector = computed<ShapeElement | null>(() => {
    if (!isOnlySelectedLine.value) return null
    const id = parseKey(selected.value[0]!).id
    const s = shapes.value.find((x) => x.id === id)
    return s && isLine(s) ? s : null
  })

  const connectorCardPair = computed<{
    connector: ShapeElement
    fromCard: ObjectCardElement
    toCard: ObjectCardElement
    fromSummary?: ObjectSummary
    toSummary?: ObjectSummary
    fromType?: ObjectType
    toType?: ObjectType
  } | null>(() => {
    const s = selectedConnector.value
    if (!s) return null
    const startId = anchorTargetId(s.startAnchor)
    const endId = anchorTargetId(s.endAnchor)
    if (!startId || !endId || startId === endId) return null
    const fromCard = cards.value.find((c) => c.id === startId)
    const toCard = cards.value.find((c) => c.id === endId)
    if (!fromCard || !toCard || fromCard.objectId === toCard.objectId) return null
    const fromSummary = summaryOf(fromCard.objectId)
    const toSummary = summaryOf(toCard.objectId)
    const fromType = typesById.value.get(fromSummary?.typeId || fromCard.typeId)
    const toType = typesById.value.get(toSummary?.typeId || toCard.typeId)
    return { connector: s, fromCard, toCard, fromSummary, toSummary, fromType, toType }
  })

  const connectorRelationOptions = computed<ConnectorRelationOption[]>(() => {
    const pair = connectorCardPair.value
    if (!pair) return []
    const { connector, fromCard, toCard, fromSummary, toSummary, fromType, toType } = pair
    const fromTitle = getCardTitle(fromCard)
    const toTitle = getCardTitle(toCard)
    const fromTypeName = getCardTypeName(fromCard)
    const toTypeName = getCardTypeName(toCard)
    const out: ConnectorRelationOption[] = []

    // 1. Forward relations: properties on `fromType` that can point to `toType`
    for (const p of fromType?.properties || []) {
      if (p.kind !== 'relation') continue
      if (p.targetTypeIds.length > 0 && (!toType || !p.targetTypeIds.includes(toType.id))) continue
      const existingVal = fromSummary?.props?.[p.id]
      const alreadyInVasta = !!(existingVal && existingVal.kind === 'relation' && existingVal.value.includes(toCard.objectId))
      const isAssignedToConnector =
        connector.relation?.propertyId === p.id &&
        connector.relation?.ownerObjectId === fromCard.objectId &&
        connector.relation?.targetObjectId === toCard.objectId

      const reverseLabel = p.reverseName?.trim()
      const twoWayLabel =
        reverseLabel && reverseLabel.toLowerCase() !== p.name.toLowerCase()
          ? `${p.name} ⇄ ${reverseLabel}`
          : `${p.name} ⇄`

      out.push({
        key: `forward:${p.id}`,
        direction: 'forward',
        prop: p,
        ownerCard: fromCard,
        targetCard: toCard,
        ownerObjectId: fromCard.objectId,
        targetObjectId: toCard.objectId,
        ownerTitle: fromTitle,
        targetTitle: toTitle,
        ownerTypeName: fromTypeName,
        targetTypeName: toTypeName,
        displayName: p.name,
        twoWayDisplayName: twoWayLabel,
        reverseName: reverseLabel,
        subtitle: `${fromTitle} · ${p.name} → ${toTitle}`,
        isAssignedToConnector,
        alreadyInVasta,
      })
    }

    // 2. Inverse relations: properties on `toType` that can point back to `fromType`
    for (const p of toType?.properties || []) {
      if (p.kind !== 'relation') continue
      if (p.targetTypeIds.length > 0 && (!fromType || !p.targetTypeIds.includes(fromType.id))) continue
      const existingVal = toSummary?.props?.[p.id]
      const alreadyInVasta = !!(existingVal && existingVal.kind === 'relation' && existingVal.value.includes(fromCard.objectId))
      const isAssignedToConnector =
        connector.relation?.propertyId === p.id &&
        connector.relation?.ownerObjectId === toCard.objectId &&
        connector.relation?.targetObjectId === fromCard.objectId

      // For same-type pairs without a reverseName, only include the inverse if it's already linked or assigned in that direction
      if (fromType && toType && fromType.id === toType.id && !p.reverseName && !alreadyInVasta && !isAssignedToConnector) {
        continue
      }

      const reverseLabel = p.reverseName?.trim()
      const twoWayLabel =
        reverseLabel && reverseLabel.toLowerCase() !== p.name.toLowerCase()
          ? `${reverseLabel} ⇄ ${p.name}`
          : `${p.name} ⇄`

      out.push({
        key: `inverse:${p.id}`,
        direction: 'inverse',
        prop: p,
        ownerCard: toCard,
        targetCard: fromCard,
        ownerObjectId: toCard.objectId,
        targetObjectId: fromCard.objectId,
        ownerTitle: toTitle,
        targetTitle: fromTitle,
        ownerTypeName: toTypeName,
        targetTypeName: fromTypeName,
        displayName: p.reverseName ? `${p.reverseName} (${p.name})` : `${p.name} (on ${toTypeName})`,
        twoWayDisplayName: twoWayLabel,
        reverseName: reverseLabel,
        subtitle: `${toTitle} · ${p.name} → ${fromTitle}`,
        isAssignedToConnector,
        alreadyInVasta,
      })
    }

    return out
  })

  function getConnectorRelationInfo(s: ShapeElement): ConnectorRelationBadgeInfo | null {
    if (!isLine(s) || !s.relation) return null
    const { propertyId, ownerObjectId, targetObjectId } = s.relation
    const ownerSummary = summaryOf(ownerObjectId)
    const targetSummary = summaryOf(targetObjectId)
    const startCard = cards.value.find((c) => c.id === anchorTargetId(s.startAnchor))
    const endCard = cards.value.find((c) => c.id === anchorTargetId(s.endAnchor))
    const ownerCard =
      startCard?.objectId === ownerObjectId
        ? startCard
        : endCard?.objectId === ownerObjectId
          ? endCard
          : cards.value.find((c) => c.objectId === ownerObjectId)
    const targetCard =
      endCard?.objectId === targetObjectId
        ? endCard
        : startCard?.objectId === targetObjectId
          ? startCard
          : cards.value.find((c) => c.objectId === targetObjectId)
    const ownerType = typesById.value.get(ownerSummary?.typeId || ownerCard?.typeId || '')
    const prop = ownerType?.properties.find((p): p is RelationPropertyDef => p.id === propertyId && p.kind === 'relation')

    const isTwoWay = !!s.relation.twoWay
    const direction: 'forward' | 'inverse' | 'two-way' = isTwoWay
      ? 'two-way'
      : startCard?.objectId === ownerObjectId
        ? 'forward'
        : 'inverse'
    const propertyName = prop?.name || 'Relation'
    const targetSideName =
      prop?.reverseName ||
      (ownerCard?.typeId === targetCard?.typeId ? propertyName : undefined) ||
      propertyName

    let displayLabel: string
    if (isTwoWay) {
      if (targetSideName && targetSideName.toLowerCase() !== propertyName.toLowerCase()) {
        displayLabel = `${propertyName} ⇄ ${targetSideName}`
      } else {
        displayLabel = `${propertyName} ⇄`
      }
    } else {
      displayLabel = direction === 'inverse' && prop?.reverseName ? prop.reverseName : propertyName
    }

    const ownerTitle = ownerCard ? getCardTitle(ownerCard) : ownerSummary?.title || 'Object'
    const targetTitle = targetCard ? getCardTitle(targetCard) : targetSummary?.title || 'Object'
    const shownOnOwnerCard = !!ownerCard?.showProperties?.includes(propertyId)
    const shownOnTargetCard = !!targetCard?.showProperties?.includes(propertyId)
    const relVal = ownerSummary?.props?.[propertyId]
    const syncedInVasta = !!(relVal && relVal.kind === 'relation' && relVal.value.includes(targetObjectId))

    return {
      propertyId,
      propertyName,
      targetSideName,
      displayLabel,
      ownerObjectId,
      targetObjectId,
      ownerTitle,
      targetTitle,
      direction,
      twoWay: isTwoWay,
      shownOnOwnerCard,
      shownOnTargetCard,
      ...(ownerCard ? { ownerCardId: ownerCard.id } : {}),
      ...(targetCard ? { targetCardId: targetCard.id } : {}),
      syncedInVasta,
    }
  }

  const selectedConnectorRelationInfo = computed<ConnectorRelationBadgeInfo | null>(() => {
    const s = selectedConnector.value
    return s ? getConnectorRelationInfo(s) : null
  })

  const preferredRelationMode = ref<'forward' | 'inverse' | 'two-way'>('forward')

  const relationDirectionMode = computed<'forward' | 'inverse' | 'two-way'>({
    get() {
      const s = selectedConnector.value
      if (!s) return preferredRelationMode.value
      if (s.relation?.twoWay) return 'two-way'
      if (s.relation) {
        const info = getConnectorRelationInfo(s)
        return info?.direction || preferredRelationMode.value
      }
      return preferredRelationMode.value
    },
    set(val) {
      preferredRelationMode.value = val
    },
  })

  async function addRelationValueInVasta(ownerObjectId: Id, propertyId: Id, targetObjectId: Id, multiple: boolean) {
    try {
      const record = await api.object(ownerObjectId)
      const base = clone(record)
      const existing = record.props[propertyId]
      const currentIds = existing && existing.kind === 'relation' ? [...existing.value] : []
      if (!currentIds.includes(targetObjectId)) {
        record.props[propertyId] = {
          kind: 'relation',
          value: multiple ? [...currentIds, targetObjectId] : [targetObjectId],
        }
        const saved = await api.saveObject(record, base)
        primeFromObject(saved)
      } else {
        primeFromObject(record)
      }
    } catch {
      // ignore offline/missing object errors
    }
  }

  async function removeRelationValueInVasta(ownerObjectId: Id, propertyId: Id, targetObjectId: Id) {
    try {
      const record = await api.object(ownerObjectId)
      const base = clone(record)
      const existing = record.props[propertyId]
      if (!existing || existing.kind !== 'relation' || !existing.value.includes(targetObjectId)) return
      const nextIds = existing.value.filter((id) => id !== targetObjectId)
      if (nextIds.length) {
        record.props[propertyId] = { kind: 'relation', value: nextIds }
      } else {
        delete record.props[propertyId]
      }
      const saved = await api.saveObject(record, base)
      primeFromObject(saved)
    } catch {
      // ignore offline/missing object errors
    }
  }

  async function assignConnectorRelation(
    propertyId: Id,
    direction: 'forward' | 'inverse' | 'two-way' = 'forward',
  ) {
    const pair = connectorCardPair.value
    if (!pair) return
    const isTwoWay = direction === 'two-way'
    const ownerCard = direction === 'inverse' ? pair.toCard : pair.fromCard
    const targetCard = direction === 'inverse' ? pair.fromCard : pair.toCard
    const ownerType = direction === 'inverse' ? pair.toType : pair.fromType
    const prop = ownerType?.properties.find((p): p is RelationPropertyDef => p.id === propertyId && p.kind === 'relation')
    if (!prop) return

    // If switching from an older relation on this same connector, clean up first
    const prevRel = pair.connector.relation
    if (prevRel) {
      if (
        prevRel.propertyId !== prop.id ||
        prevRel.ownerObjectId !== ownerCard.objectId ||
        prevRel.targetObjectId !== targetCard.objectId ||
        prevRel.twoWay !== isTwoWay
      ) {
        await removeRelationValueInVasta(prevRel.ownerObjectId, prevRel.propertyId, prevRel.targetObjectId)
      }
    }

    pair.connector.relation = {
      propertyId: prop.id,
      ownerObjectId: ownerCard.objectId,
      targetObjectId: targetCard.objectId,
      ...(isTwoWay ? { twoWay: true } : {}),
    }

    // Automatically surface the relation property on card(s) so the user sees it immediately
    const shown = ownerCard.showProperties ? [...ownerCard.showProperties] : []
    if (!shown.includes(prop.id)) {
      shown.push(prop.id)
      ownerCard.showProperties = shown
      if (ownerCard.height < 140) {
        ownerCard.height = Math.max(ownerCard.height, 120 + shown.length * 22)
      }
    }

    if (isTwoWay) {
      const targetShown = targetCard.showProperties ? [...targetCard.showProperties] : []
      if (!targetShown.includes(prop.id)) {
        targetShown.push(prop.id)
        targetCard.showProperties = targetShown
        if (targetCard.height < 140) {
          targetCard.height = Math.max(targetCard.height, 120 + targetShown.length * 22)
        }
      }
    }

    syncAnchoredConnectors()
    void nextTick(() => syncAnchoredConnectors())
    pushHistory()
    notifyChange()

    await addRelationValueInVasta(ownerCard.objectId, prop.id, targetCard.objectId, prop.multiple)

    const targetLabel = prop.reverseName || prop.name
    notice.value = {
      message: isTwoWay
        ? targetLabel.toLowerCase() !== prop.name.toLowerCase()
          ? `Linked 2-way: ${getCardTitle(ownerCard)} (${prop.name}) ⇄ ${getCardTitle(targetCard)} (${targetLabel})`
          : `Linked 2-way: ${getCardTitle(ownerCard)} ⇄ ${prop.name} ⇄ ${getCardTitle(targetCard)}`
        : `Linked ${getCardTitle(ownerCard)} · ${prop.name} → ${getCardTitle(targetCard)}`,
    }
  }

  async function setRelationDirectionMode(mode: 'forward' | 'inverse' | 'two-way') {
    preferredRelationMode.value = mode
    const s = selectedConnector.value
    if (!s || !isLine(s)) return
    const pair = connectorCardPair.value

    if (mode === 'two-way') {
      if (s.relation && pair) {
        s.relation.twoWay = true
        const targetCard = cards.value.find((c) => c.objectId === s.relation!.targetObjectId)
        if (targetCard) {
          const shown = targetCard.showProperties ? [...targetCard.showProperties] : []
          if (!shown.includes(s.relation.propertyId)) {
            shown.push(s.relation.propertyId)
            targetCard.showProperties = shown
          }
        }
      }
    } else if (mode === 'forward') {
      if (s.relation?.twoWay) {
        s.relation.twoWay = false
        const targetCard = cards.value.find((c) => c.objectId === s.relation!.targetObjectId)
        if (targetCard && targetCard.showProperties) {
          targetCard.showProperties = targetCard.showProperties.filter((id) => id !== s.relation!.propertyId)
        }
      }
    } else if (mode === 'inverse') {
      if (s.relation) {
        s.relation.twoWay = false
      }
    }
    syncAnchoredConnectors()
    void nextTick(() => syncAnchoredConnectors())
    pushHistory()
    notifyChange()
  }

  async function unlinkConnectorRelation(connectorId?: string, removeFromObject = true) {
    const s = connectorId ? shapes.value.find((x) => x.id === connectorId) : selectedConnector.value
    if (!s || !s.relation) return
    const prevRelation = { ...s.relation }
    const info = getConnectorRelationInfo(s)
    delete s.relation
    pushHistory()
    notifyChange()

    if (removeFromObject) {
      await removeRelationValueInVasta(prevRelation.ownerObjectId, prevRelation.propertyId, prevRelation.targetObjectId)
      notice.value = {
        message: `Unlinked ${info?.propertyName || 'relation'} (${info?.ownerTitle || 'Object'} → ${info?.targetTitle || 'Object'})`,
        action: {
          label: 'Undo',
          run: async () => {
            const targetShape = shapes.value.find((x) => x.id === s.id)
            if (targetShape) {
              targetShape.relation = prevRelation
              notifyChange()
            }
            await addRelationValueInVasta(prevRelation.ownerObjectId, prevRelation.propertyId, prevRelation.targetObjectId, true)
          },
        },
      }
    }
  }

  async function createAndAssignConnectorRelation(input: {
    name: string
    restrictToTargetType: boolean
    multiple: boolean
    reverseName?: string
    direction?: 'forward' | 'inverse' | 'two-way'
  }) {
    const pair = connectorCardPair.value
    if (!pair || !pair.fromType) return
    const name = input.name.trim()
    if (!name) return

    const direction = input.direction ?? relationDirectionMode.value ?? 'forward'
    const ownerType = clone(direction === 'inverse' && pair.toType ? pair.toType : pair.fromType)
    const targetType = direction === 'inverse' ? pair.fromType : pair.toType
    const reverseName = input.reverseName?.trim() || undefined

    const existing = ownerType.properties.find(
      (p): p is RelationPropertyDef => p.kind === 'relation' && p.name.toLowerCase() === name.toLowerCase(),
    )

    if (existing) {
      let changed = false
      if (reverseName && existing.reverseName !== reverseName) {
        existing.reverseName = reverseName
        changed = true
      }
      if (targetType && existing.targetTypeIds.length > 0 && !existing.targetTypeIds.includes(targetType.id)) {
        existing.targetTypeIds.push(targetType.id)
        changed = true
      }
      if (changed) {
        const savedType = await api.saveType(ownerType)
        replaceType(savedType)
      }
      await assignConnectorRelation(existing.id, direction)
      return
    }

    const newProp: RelationPropertyDef = {
      id: newId(),
      name,
      kind: 'relation',
      targetTypeIds: input.restrictToTargetType && targetType ? [targetType.id] : [],
      multiple: input.multiple,
      ...(reverseName ? { reverseName } : {}),
    }
    ownerType.properties.push(newProp)
    const savedType = await api.saveType(ownerType)
    replaceType(savedType)
    await assignConnectorRelation(newProp.id, direction)
  }

  function flipSelectedConnectorDirection() {
    const s = selectedConnector.value
    if (!s) return
    const oldEndX = s.x + s.width
    const oldEndY = s.y + s.height
    s.x = oldEndX
    s.y = oldEndY
    s.width = -s.width
    s.height = -s.height
    const tmpAnchor = s.startAnchor
    s.startAnchor = s.endAnchor
    s.endAnchor = tmpAnchor
    const tmpOri = s.startOrientation
    s.startOrientation = s.endOrientation
    s.endOrientation = tmpOri
    if (s.midOffset !== undefined) {
      const ori = s.startOrientation ?? 'horizontal'
      s.midOffset = ori === 'horizontal' ? s.midOffset - s.width : s.midOffset - s.height
    }
    syncAnchoredConnectors()
    pushHistory()
    notifyChange()
  }

  function toggleRelationPropertyOnCard(connector?: ShapeElement) {
    const s = connector || selectedConnector.value
    if (!s?.relation) return
    const info = getConnectorRelationInfo(s)
    if (!info?.ownerCardId) return
    const card = cards.value.find((c) => c.id === info.ownerCardId)
    if (!card) return
    const current = card.showProperties ? [...card.showProperties] : []
    const idx = current.indexOf(s.relation.propertyId)
    const willShow = idx < 0
    if (willShow) {
      current.push(s.relation.propertyId)
      if (card.height < 140) {
        card.height = Math.max(card.height, 120 + current.length * 22)
      }
    } else {
      current.splice(idx, 1)
    }
    card.showProperties = current

    if (s.relation.twoWay && info.targetCardId) {
      const targetCard = cards.value.find((c) => c.id === info.targetCardId)
      if (targetCard) {
        const tCurrent = targetCard.showProperties ? [...targetCard.showProperties] : []
        const tIdx = tCurrent.indexOf(s.relation.propertyId)
        if (willShow && tIdx < 0) {
          tCurrent.push(s.relation.propertyId)
          if (targetCard.height < 140) {
            targetCard.height = Math.max(targetCard.height, 120 + tCurrent.length * 22)
          }
        } else if (!willShow && tIdx >= 0) {
          tCurrent.splice(tIdx, 1)
        }
        targetCard.showProperties = tCurrent
      }
    }

    syncAnchoredConnectors()
    void nextTick(() => syncAnchoredConnectors())
    pushHistory()
    notifyChange()
  }

  function reconcileConnectorRelationAfterResize(s: ShapeElement) {
    if (!isLine(s) || !s.relation) return
    const startCard = cards.value.find((c) => c.id === anchorTargetId(s.startAnchor))
    const endCard = cards.value.find((c) => c.id === anchorTargetId(s.endAnchor))
    if (!startCard || !endCard) {
      void unlinkConnectorRelation(s.id, true)
      return
    }
    const pairObjects = new Set([startCard.objectId, endCard.objectId])
    if (!pairObjects.has(s.relation.ownerObjectId) || !pairObjects.has(s.relation.targetObjectId)) {
      void unlinkConnectorRelation(s.id, true)
    }
  }

  return {
    selected,
    isSelected,
    findItem,
    getSnapTargets,
    findSnapTarget,
    syncAnchoredConnectors,
    detachAnchorsTo,
    boundsOfKey,
    allKeys,
    getAllRawItems,
    ensureZIndices,
    renormalizeZIndices,
    getMaxZIndex,
    allCanvasItems,
    selectionBox,
    isOnlySelectedLine,
    selectedGeometry,
    hitRotateHandle,
    handles,
    selectedStickyIds,
    selectedShapeIds,
    selectedStrokeIds,
    selectedCardIds,
    hasSelectedLines,
    hasSelected2DShapes,
    hasSelectedItems,
    selectionStartAnchored,
    selectionEndAnchored,
    hitTest,
    hitHandle,
    deleteSelected,
    duplicateSelected,
    setSelectionColor,
    setSelectionStrokeWidth,
    setSelectionStrokeStyle,
    setSelectionFill,
    setSelectionFillColor,
    setSelectionCurvature,
    setSelectionStartOrientation,
    setSelectionEndOrientation,
    setSelectionStartTermination,
    setSelectionEndTermination,
    setSelectionStickyColor,
    setSelectionStickyTextColor,
    setSelectionStickyFontSize,
    bringToFront,
    sendToBack,
    bringForward,
    sendBackward,
    selectionPrimaryColor,
    selectionShapeFill,
    selectionShapeFillColor,
    selectionStickyTextColor,
    selectionCurvature,
    selectionStartOrientation,
    selectionEndOrientation,
    selectionStrokeWidth,
    selectionStrokeStyle,
    selectionStartTermination,
    selectionEndTermination,
    selectionOutlineColor,
    selectionFillPreviewBg,
    selectionScreenBox,
    floatingMenuStyle,
    floatingPopoverStyle,
    selectAll,
    getCardTitle,
    getCardTypeName,
    getCardTypeIcon,
    getCardTypeColor,
    getCardSummary,
    getCardPreview,
    getCardShownProperties,
    getCardPropertyValue,
    selectedCard,
    selectedCardIsQuery,
    selectedCardContentMode,
    selectedCardAvailableProperties,
    isCardPropertyShown,
    setCardContentMode,
    toggleCardShowContent,
    toggleCardProperty,
    selectedConnector,
    connectorCardPair,
    connectorRelationOptions,
    getConnectorRelationInfo,
    selectedConnectorRelationInfo,
    relationDirectionMode,
    setRelationDirectionMode,
    assignConnectorRelation,
    unlinkConnectorRelation,
    createAndAssignConnectorRelation,
    flipSelectedConnectorDirection,
    toggleRelationPropertyOnCard,
    reconcileConnectorRelationAfterResize,
  }
}
