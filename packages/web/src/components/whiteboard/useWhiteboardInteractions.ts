import { nextTick, onMounted, onUnmounted, ref, type Ref } from 'vue'
import { newId } from './ids.ts'
import {
  anchorTargetId,
  distToPolyline,
  findNearestSnapAnchor,
  getConnectorGeometry,
  isLine,
  orientationForSide,
  polygonIntersectsPolygon,
  polylineIntersectsPolygon,
  rotatePoint,
  shapeHit,
  shapePolygon,
  simplifyStrokePoints,
  type SnapCandidate,
} from './shapes.ts'
import type {
  DrawMode,
  InkStroke,
  ObjectCardElement,
  Point,
  ShapeElement,
  StickyElement,
} from './types.ts'
import { usePencilGestures } from './usePencilGestures.ts'
import type { useToolSettings } from './useToolSettings.ts'
import {
  getStrokeCenter,
  intersects,
  keyOf,
  parseKey,
  pointsBox,
  type Box,
  type Handle,
  type useWhiteboardSelection,
} from './useWhiteboardSelection.ts'

export type InteractionMode = 'stroke' | 'shape' | 'sticky' | 'erase' | 'move' | 'resize' | 'rotate' | 'marquee' | 'lasso'
type InputKind = 'pen' | 'touch' | 'mouse'

export function useWhiteboardInteractions(opts: {
  containerRef: Ref<HTMLElement | null>
  getDrawMode: () => DrawMode
  pan: Ref<Point>
  zoom: Ref<number>
  strokes: Ref<InkStroke[]>
  shapes: Ref<ShapeElement[]>
  cards: Ref<ObjectCardElement[]>
  stickies: Ref<StickyElement[]>
  editingId: Ref<string | null>
  isSceneDrawing: Ref<boolean>
  toolSettings: ReturnType<typeof useToolSettings>
  selectionState: ReturnType<typeof useWhiteboardSelection>
  pushHistory: () => void
  undo: () => void
  redo: () => void
  notifyChange: () => void
  refreshObjectSummaries: () => void
  onPenDetected: (present: boolean) => void
}) {
  const {
    containerRef,
    getDrawMode,
    pan,
    zoom,
    strokes,
    shapes,
    stickies,
    editingId,
    isSceneDrawing,
    toolSettings,
    selectionState,
    pushHistory,
    undo,
    redo,
    notifyChange,
    refreshObjectSummaries,
    onPenDetected,
  } = opts

  const {
    penPresets,
    activePresetIndex,
    initialPreset,
    currentTool,
    selectMode,
    currentShape2D,
    eraserMode,
    eraserSize,
    currentStickyColor,
    currentStickyTextColor,
    currentStickyFontSize,
    shape2DSettings,
    connectorSettings,
    closeAllPopovers,
    onSelectMainTool,
    eraserCursor,
    penSeen,
    setPen,
    pencilOnly,
  } = toolSettings

  const {
    selected,
    findItem,
    getSnapTargets,
    syncAnchoredConnectors,
    detachAnchorsTo,
    boundsOfKey,
    allKeys,
    getMaxZIndex,
    selectedGeometry,
    hitRotateHandle,
    hitTest,
    hitHandle,
    deleteSelected,
    duplicateSelected,
    selectAll,
  } = selectionState

  // Sticky Text Editing -----------------------------------------------------
  let editStartText = ''

  function startEditing(id: string) {
    editingId.value = id
    nextTick(() => document.getElementById(`wb-sticky-${id}`)?.focus())
  }

  function onStickyFocus(sticky: StickyElement) {
    editStartText = sticky.text
  }

  function onStickyBlur(sticky: StickyElement) {
    editingId.value = null
    if (sticky.text !== editStartText) pushHistory()
  }

  // Erasing -----------------------------------------------------------------
  let erased = false

  function densify(points: Point[], step: number): Point[] {
    const out: Point[] = []
    points.forEach((p, i) => {
      out.push(p)
      const n = points[i + 1]
      if (!n) return
      const k = Math.floor(Math.hypot(n.x - p.x, n.y - p.y) / step)
      for (let j = 1; j <= k; j++) {
        const t = j / (k + 1)
        out.push({
          x: p.x + (n.x - p.x) * t,
          y: p.y + (n.y - p.y) * t,
          ...(p.pressure === undefined ? {} : { pressure: p.pressure }),
        })
      }
    })
    return out
  }

  function pixelEraseAt(pt: Point) {
    const r = eraserSize.value / 2 / zoom.value
    const next: InkStroke[] = []
    let changed = false
    for (const s of strokes.value) {
      if (distToPolyline(pt, s.points) > r + s.width / 2) {
        next.push(s)
        continue
      }
      changed = true
      let run: Point[] = []
      const flush = () => {
        if (run.length >= 2) next.push({ ...s, id: newId(), points: run })
        run = []
      }
      for (const p of densify(s.points, Math.max(r / 3, 0.5))) {
        if (Math.hypot(p.x - pt.x, p.y - pt.y) <= r) flush()
        else run.push(p)
      }
      flush()
    }
    if (changed) {
      strokes.value = next
      erased = true
    }
  }

  function objectEraseAt(pt: Point) {
    const tol = 12 / zoom.value
    const before = strokes.value.length + shapes.value.length
    strokes.value = strokes.value.filter((s) => distToPolyline(pt, s.points) > tol + s.width / 2)
    const erasedShapeIds = new Set<string>()
    shapes.value = shapes.value.filter((s) => {
      const hit = shapeHit(s, pt, tol)
      if (hit && !isLine(s)) erasedShapeIds.add(s.id)
      return !hit
    })
    if (erasedShapeIds.size > 0) detachAnchorsTo(erasedShapeIds)
    if (strokes.value.length + shapes.value.length !== before) erased = true
  }

  function eraseAt(pt: Point) {
    if (eraserMode.value === 'pixel') pixelEraseAt(pt)
    else objectEraseAt(pt)
  }

  function eraseAlong(from: Point, to: Point) {
    const step = 6 / zoom.value
    const n = Math.max(1, Math.ceil(Math.hypot(to.x - from.x, to.y - from.y) / step))
    for (let i = 1; i <= n; i++) {
      eraseAt({ x: from.x + ((to.x - from.x) * i) / n, y: from.y + ((to.y - from.y) * i) / n })
    }
  }

  // Interaction Engine ------------------------------------------------------
  const currentStroke = ref<InkStroke | null>(null)
  const currentShape = ref<ShapeElement | null>(null)
  const currentDraftSticky = ref<StickyElement | null>(null)
  const marquee = ref<Box | null>(null)
  const lasso = ref<Point[] | null>(null)
  const hoveredSnapAnchor = ref<SnapCandidate | null>(null)

  const activeMode = ref<InteractionMode | null>(null)
  let mode: InteractionMode | null = null
  function setMode(m: InteractionMode | null) {
    mode = m
    activeMode.value = m
  }
  let startPt: Point = { x: 0, y: 0 }
  let lastPt: Point = { x: 0, y: 0 }
  let shiftHeld = false
  let moved = false
  let moveOrigins = new Map<
    string,
    { x: number; y: number; width?: number; height?: number; controlPoint?: Point; points?: Point[] }
  >()
  let tapSticky: string | undefined
  let resizeHandle: Handle['id'] | null = null
  let resizeKey = ''
  let resizeOriginBox: Box = { x: 0, y: 0, w: 0, h: 0 }
  let resizeOriginPoints: Point[] = []
  let resizeCenter: Point = { x: 0, y: 0 }
  let resizeRotation = 0

  let rotateCenter: Point = { x: 0, y: 0 }
  let rotateStartAngle = 0
  let rotateInitialMap = new Map<string, number>()

  function getSnapRadius(): number {
    return 24 / zoom.value
  }

  function beginMove(pt: Point) {
    setMode('move')
    moved = false
    moveOrigins = new Map()
    for (const key of selected.value) {
      const found = findItem(key)
      if (!found) continue
      if (found.kind === 'stroke') {
        moveOrigins.set(key, { x: 0, y: 0, points: (found.item as InkStroke).points.map((p) => ({ ...p })) })
      } else {
        const item = found.item as ShapeElement
        moveOrigins.set(key, {
          x: item.x,
          y: item.y,
          width: item.width,
          height: item.height,
          ...(item.controlPoint ? { controlPoint: { ...item.controlPoint } } : {}),
        })
      }
    }
    startPt = pt
  }

  function applyMove(pt: Point) {
    const dx = pt.x - startPt.x
    const dy = pt.y - startPt.y
    if (!moved && Math.hypot(dx, dy) * zoom.value < 3) return
    moved = true
    for (const [key, origin] of moveOrigins) {
      const found = findItem(key)
      if (!found) continue
      if (found.kind === 'stroke') {
        ;(found.item as InkStroke).points = (origin.points ?? []).map((p) => ({ ...p, x: p.x + dx, y: p.y + dy }))
      } else if (found.kind === 'shape' && isLine(found.item as ShapeElement)) {
        const line = found.item as ShapeElement
        const hasStart = !!anchorTargetId(line.startAnchor)
        const hasEnd = !!anchorTargetId(line.endAnchor)
        if (hasStart && hasEnd) {
          // Both ends anchored: endpoints are driven by syncAnchoredConnectors()
          continue
        }
        if (!hasStart && !hasEnd) {
          line.x = origin.x + dx
          line.y = origin.y + dy
          if (origin.controlPoint) {
            line.controlPoint = { x: origin.controlPoint.x + dx, y: origin.controlPoint.y + dy }
          }
        } else if (hasStart && !hasEnd) {
          // Only start is anchored: move the free end if its target isn't in the selection
          const startTargetKey = `${line.startAnchor?.targetKind || 'card'}:${anchorTargetId(line.startAnchor)}`
          if (!moveOrigins.has(startTargetKey)) continue
          line.width = (origin.width ?? line.width) + dx
          line.height = (origin.height ?? line.height) + dy
        } else if (!hasStart && hasEnd) {
          const endTargetKey = `${line.endAnchor?.targetKind || 'card'}:${anchorTargetId(line.endAnchor)}`
          if (!moveOrigins.has(endTargetKey)) continue
          line.x = origin.x + dx
          line.y = origin.y + dy
        }
      } else {
        const item = found.item as ShapeElement
        item.x = origin.x + dx
        item.y = origin.y + dy
      }
    }
    syncAnchoredConnectors()
  }

  function startResizeForHandle(handle: Handle) {
    setMode('resize')
    resizeHandle = handle.id
    resizeKey = selected.value[0]!
    const found = findItem(resizeKey)
    if (!found) return
    if (found.kind === 'stroke') {
      const s = found.item as InkStroke
      resizeOriginBox = pointsBox(s.points)
      resizeOriginPoints = s.points.map((p) => ({ ...p }))
      resizeCenter = { x: resizeOriginBox.x + resizeOriginBox.w / 2, y: resizeOriginBox.y + resizeOriginBox.h / 2 }
      resizeRotation = s.rotation || 0
    } else if (found.kind === 'shape') {
      const s = found.item as ShapeElement
      resizeOriginBox = { x: s.x, y: s.y, w: s.width, h: s.height }
      resizeCenter = { x: s.x + s.width / 2, y: s.y + s.height / 2 }
      resizeRotation = s.rotation || 0
    } else {
      const i = found.item as ObjectCardElement | StickyElement
      resizeOriginBox = { x: i.x, y: i.y, w: i.width, h: i.height }
      resizeCenter = { x: i.x + i.width / 2, y: i.y + i.height / 2 }
      resizeRotation = i.rotation || 0
    }
  }

  function applyResize(pt: Point) {
    const found = findItem(resizeKey)
    if (!found) return
    if (found.kind === 'stroke') {
      const s = found.item as InkStroke
      if (!resizeOriginPoints.length) return
      const newW = Math.max(10, pt.x - resizeOriginBox.x)
      const newH = Math.max(10, pt.y - resizeOriginBox.y)
      const scaleX = newW / (resizeOriginBox.w || 1)
      const scaleY = newH / (resizeOriginBox.h || 1)
      s.points = resizeOriginPoints.map((p) => ({
        ...p,
        x: resizeOriginBox.x + (p.x - resizeOriginBox.x) * scaleX,
        y: resizeOriginBox.y + (p.y - resizeOriginBox.y) * scaleY,
      }))
      return
    }

    if (found.kind === 'shape' && isLine(found.item as ShapeElement)) {
      const s = found.item as ShapeElement
      if (resizeHandle === 'start') {
        const ex = s.x + s.width
        const ey = s.y + s.height
        const otherEndId = anchorTargetId(s.endAnchor)
        const snap = findNearestSnapAnchor(pt, getSnapTargets(), getSnapRadius(), { x: ex, y: ey }, otherEndId)
        hoveredSnapAnchor.value = snap
        const targetPt = snap ? snap.point : pt
        s.x = targetPt.x
        s.y = targetPt.y
        s.width = ex - targetPt.x
        s.height = ey - targetPt.y
        if (snap) {
          s.startAnchor = {
            targetId: snap.targetId,
            targetKind: snap.targetKind,
            ...(snap.targetKind === 'card' ? { cardId: snap.targetId } : {}),
            side: snap.side,
          }
          s.startOrientation = orientationForSide(snap.side)
        } else {
          delete s.startAnchor
        }
      } else if (resizeHandle === 'end') {
        const startId = anchorTargetId(s.startAnchor)
        const snap = findNearestSnapAnchor(pt, getSnapTargets(), getSnapRadius(), { x: s.x, y: s.y }, startId)
        hoveredSnapAnchor.value = snap
        const targetPt = snap ? snap.point : pt
        s.width = targetPt.x - s.x
        s.height = targetPt.y - s.y
        if (snap) {
          s.endAnchor = {
            targetId: snap.targetId,
            targetKind: snap.targetKind,
            ...(snap.targetKind === 'card' ? { cardId: snap.targetId } : {}),
            side: snap.side,
          }
          s.endOrientation = orientationForSide(snap.side)
        } else {
          delete s.endAnchor
        }
      } else if (resizeHandle === 'mid') {
        if (s.curvature === 'curved') {
          const geo = getConnectorGeometry(s)
          const p0 = geo.shaftStart
          const p2 = geo.shaftEnd
          s.controlPoint = {
            x: 2 * pt.x - 0.5 * p0.x - 0.5 * p2.x,
            y: 2 * pt.y - 0.5 * p0.y - 0.5 * p2.y,
          }
        } else if (s.curvature === 'orthogonal') {
          const lockedStartOri = orientationForSide(s.startAnchor?.side)
          const lockedEndOri = orientationForSide(s.endAnchor?.side)
          const defStartOri = s.orientation ?? (Math.abs(s.width) >= Math.abs(s.height) ? 'horizontal' : 'vertical')
          const startOri = lockedStartOri ?? s.startOrientation ?? defStartOri
          const endOri =
            lockedEndOri ??
            s.endOrientation ??
            (s.startOrientation || lockedStartOri ? (startOri === 'horizontal' ? 'horizontal' : 'vertical') : defStartOri)

          if (startOri === 'vertical' && endOri === 'vertical') {
            const isTopTop = s.startAnchor?.side === 'top' && s.endAnchor?.side === 'top'
            const isBottomBottom = s.startAnchor?.side === 'bottom' && s.endAnchor?.side === 'bottom'
            let midY = pt.y
            if (isTopTop) {
              const minY = Math.min(s.y, s.y + s.height)
              midY = Math.min(pt.y, minY - 16)
            } else if (isBottomBottom) {
              const maxY = Math.max(s.y, s.y + s.height)
              midY = Math.max(pt.y, maxY + 16)
            }
            s.midOffset = midY - s.y
          } else if (startOri === 'horizontal' && endOri === 'horizontal') {
            const isLeftLeft = s.startAnchor?.side === 'left' && s.endAnchor?.side === 'left'
            const isRightRight = s.startAnchor?.side === 'right' && s.endAnchor?.side === 'right'
            let midX = pt.x
            if (isLeftLeft) {
              const minX = Math.min(s.x, s.x + s.width)
              midX = Math.min(pt.x, minX - 16)
            } else if (isRightRight) {
              const maxX = Math.max(s.x, s.x + s.width)
              midX = Math.max(pt.x, maxX + 16)
            }
            s.midOffset = midX - s.x
          }
        }
      }
      return
    }

    const item = found.item as ShapeElement | ObjectCardElement | StickyElement
    const ob = resizeOriginBox
    const rot = resizeRotation
    const minW = found.kind === 'card' ? 170 : found.kind === 'sticky' ? 100 : 16
    const minH = found.kind === 'card' ? 80 : found.kind === 'sticky' ? 80 : 16

    const localPt = rot ? rotatePoint(pt, resizeCenter, -rot) : pt

    let newX = ob.x
    let newY = ob.y
    let newW = ob.w
    let newH = ob.h
    let anchorLocal = { x: ob.x, y: ob.y }

    if (resizeHandle === 'se' || resizeHandle === 'br') {
      newW = Math.max(minW, localPt.x - ob.x)
      newH = Math.max(minH, localPt.y - ob.y)
      anchorLocal = { x: ob.x, y: ob.y }
    } else if (resizeHandle === 'nw') {
      newX = Math.min(localPt.x, ob.x + ob.w - minW)
      newY = Math.min(localPt.y, ob.y + ob.h - minH)
      newW = ob.x + ob.w - newX
      newH = ob.y + ob.h - newY
      anchorLocal = { x: ob.x + ob.w, y: ob.y + ob.h }
    } else if (resizeHandle === 'ne') {
      newY = Math.min(localPt.y, ob.y + ob.h - minH)
      newW = Math.max(minW, localPt.x - ob.x)
      newH = ob.y + ob.h - newY
      anchorLocal = { x: ob.x, y: ob.y + ob.h }
    } else if (resizeHandle === 'sw' || resizeHandle === 'bl') {
      newX = Math.min(localPt.x, ob.x + ob.w - minW)
      newW = ob.x + ob.w - newX
      newH = Math.max(minH, localPt.y - ob.y)
      anchorLocal = { x: ob.x + ob.w, y: ob.y }
    } else if (resizeHandle === 'top') {
      newY = Math.min(localPt.y, ob.y + ob.h - minH)
      newH = ob.y + ob.h - newY
      anchorLocal = { x: ob.x + ob.w / 2, y: ob.y + ob.h }
    }

    if (rot === 0) {
      item.x = newX
      item.y = newY
      if ('width' in item) item.width = newW
      if ('height' in item) item.height = newH
    } else {
      const worldAnchor = rotatePoint(anchorLocal, resizeCenter, rot)
      const newLocalCenter = { x: newX + newW / 2, y: newY + newH / 2 }
      const newWorldAnchor = rotatePoint(anchorLocal, newLocalCenter, rot)
      const shiftX = worldAnchor.x - newWorldAnchor.x
      const shiftY = worldAnchor.y - newWorldAnchor.y
      item.x = newX + shiftX
      item.y = newY + shiftY
      if ('width' in item) item.width = newW
      if ('height' in item) item.height = newH
    }
    syncAnchoredConnectors()
  }

  let lastTapKey: string | undefined
  let lastTapTime = 0
  function checkStickyDoubleTap(pt: Point): boolean {
    const key = hitTest(pt)
    const now = performance.now()
    const isDouble = !!key && key === lastTapKey && now - lastTapTime < 400
    lastTapKey = key
    lastTapTime = now
    if (isDouble && key) {
      const { kind, id } = parseKey(key)
      if (kind === 'sticky') {
        selected.value = [key]
        lastTapKey = undefined
        startEditing(id)
        return true
      }
    }
    return false
  }

  function tapAt(pt: Point): boolean {
    if (editingId.value) {
      const activeEl = document.activeElement as HTMLElement | null
      if (activeEl) activeEl.blur()
      editingId.value = null
    }
    const key = hitTest(pt)
    if (key) {
      const { kind, id } = parseKey(key)
      if (kind === 'sticky' && selected.value.length === 1 && selected.value[0] === key) {
        startEditing(id)
      } else {
        selected.value = [key]
      }
      return true
    }
    if (selected.value.length) {
      selected.value = []
      return true
    }
    return false
  }

  function addStickyAt(pt: Point, customWidth?: number, customHeight?: number, customX?: number, customY?: number) {
    const width = customWidth ?? 190
    const height = customHeight ?? 150
    const x = customX !== undefined ? customX : pt.x - width / 2
    const y = customY !== undefined ? customY : pt.y - height / 2
    const sticky: StickyElement = {
      id: newId(),
      text: '',
      color: currentStickyColor.value,
      textColor: currentStickyTextColor.value,
      fontSize: currentStickyFontSize.value,
      x,
      y,
      width,
      height,
      zIndex: getMaxZIndex() + 1,
    }
    stickies.value.push(sticky)
    pushHistory()
    currentTool.value = 'select'
    selected.value = [keyOf('sticky', sticky.id)]
    startEditing(sticky.id)
  }

  function startRotateAt(pt: Point) {
    setMode('rotate')
    rotateCenter = selectedGeometry.value ? selectedGeometry.value.center : { x: 0, y: 0 }
    rotateStartAngle = Math.atan2(pt.y - rotateCenter.y, pt.x - rotateCenter.x)
    rotateInitialMap = new Map()
    for (const key of selected.value) {
      const found = findItem(key)
      if (found) rotateInitialMap.set(key, (found.item as { rotation?: number }).rotation || 0)
    }
  }

  function beginInteraction(pt: Point, kind: InputKind) {
    if (editingId.value) {
      const activeEl = document.activeElement as HTMLElement | null
      if (activeEl) activeEl.blur()
      editingId.value = null
    }
    startPt = pt
    lastPt = pt
    moved = false
    hoveredSnapAnchor.value = null
    const tool = currentTool.value
    const selecting = tool === 'select'

    closeAllPopovers()

    if (selecting) {
      if (hitRotateHandle(pt, kind)) {
        startRotateAt(pt)
        return
      }
      const handle = hitHandle(pt, kind)
      if (handle) {
        startResizeForHandle(handle)
        return
      }
      const hit = hitTest(pt)
      if (hit) {
        const was = selected.value.includes(hit)
        if (shiftHeld) {
          selected.value = was ? selected.value.filter((k) => k !== hit) : [...selected.value, hit]
          return
        }
        if (!was) {
          selected.value = [hit]
        }
        tapSticky = was && selected.value.length === 1 && parseKey(hit).kind === 'sticky' ? parseKey(hit).id : undefined
        beginMove(pt)
        return
      }
      if (!shiftHeld) selected.value = []
      if (selectMode.value === 'lasso') {
        setMode('lasso')
        lasso.value = [pt]
      } else {
        setMode('marquee')
        marquee.value = { x: pt.x, y: pt.y, w: 0, h: 0 }
      }
      return
    }

    if (tool === 'pen') {
      setMode('stroke')
      const p = penPresets.value[activePresetIndex.value] || initialPreset
      currentStroke.value = {
        id: newId(),
        color: p.color,
        width: p.width,
        style: p.style || (p.type === 'highlighter' ? 'marker' : 'solid'),
        penType: p.type,
        points: [{ ...pt }],
        zIndex: getMaxZIndex() + 1,
      }
    } else if (tool === 'eraser') {
      setMode('erase')
      eraseAt(pt)
    } else if (tool === 'connector') {
      setMode('shape')
      selected.value = []
      const s = connectorSettings.value
      const startSnap = findNearestSnapAnchor(pt, getSnapTargets(), getSnapRadius())
      hoveredSnapAnchor.value = startSnap
      const originPt = startSnap ? startSnap.point : pt
      startPt = originPt
      currentShape.value = {
        id: newId(),
        type: 'arrow',
        x: originPt.x,
        y: originPt.y,
        width: 0,
        height: 0,
        color: s.color,
        strokeWidth: s.strokeWidth,
        strokeStyle: s.strokeStyle,
        curvature: s.curvature,
        startHead: s.startHead,
        endHead: s.endHead,
        startOrientation: startSnap ? orientationForSide(startSnap.side) : s.startOrientation,
        endOrientation: s.endOrientation,
        ...(startSnap
          ? {
              startAnchor: {
                targetId: startSnap.targetId,
                targetKind: startSnap.targetKind,
                ...(startSnap.targetKind === 'card' ? { cardId: startSnap.targetId } : {}),
                side: startSnap.side,
              },
            }
          : {}),
        zIndex: getMaxZIndex() + 1,
      }
    } else if (tool === 'shape2d') {
      setMode('shape')
      selected.value = []
      const s = shape2DSettings.value[currentShape2D.value]
      currentShape.value = {
        id: newId(),
        type: currentShape2D.value,
        x: pt.x,
        y: pt.y,
        width: 0,
        height: 0,
        color: s.color,
        fill: s.fill,
        fillColor: s.fillColor,
        strokeWidth: s.strokeWidth,
        strokeStyle: s.strokeStyle,
        zIndex: getMaxZIndex() + 1,
      }
    } else if (tool === 'sticky') {
      setMode('sticky')
      selected.value = []
      startPt = pt
      currentDraftSticky.value = {
        id: newId(),
        text: '',
        color: currentStickyColor.value,
        textColor: currentStickyTextColor.value,
        fontSize: currentStickyFontSize.value,
        x: pt.x,
        y: pt.y,
        width: 0,
        height: 0,
        zIndex: getMaxZIndex() + 1,
      }
    }
  }

  function moveInteraction(pt: Point) {
    switch (mode) {
      case 'stroke':
        currentStroke.value?.points.push({ ...pt })
        break
      case 'sticky': {
        const st = currentDraftSticky.value
        if (!st) break
        st.x = Math.min(startPt.x, pt.x)
        st.y = Math.min(startPt.y, pt.y)
        st.width = Math.abs(pt.x - startPt.x)
        st.height = Math.abs(pt.y - startPt.y)
        break
      }
      case 'shape': {
        const s = currentShape.value
        if (!s) break
        if (isLine(s)) {
          const startTargetId = anchorTargetId(s.startAnchor)
          // Update startAnchor side dynamically if the user started inside an object and drags toward another direction
          if (startTargetId) {
            const startTarget = getSnapTargets().find((t) => t.id === startTargetId)
            if (startTarget && Math.hypot(pt.x - startPt.x, pt.y - startPt.y) > 20 / zoom.value) {
              const startSnap = findNearestSnapAnchor(startPt, [startTarget], getSnapRadius() * 2, pt)
              if (startSnap) {
                s.startAnchor = {
                  targetId: startSnap.targetId,
                  targetKind: startSnap.targetKind,
                  ...(startSnap.targetKind === 'card' ? { cardId: startSnap.targetId } : {}),
                  side: startSnap.side,
                }
                s.startOrientation = orientationForSide(startSnap.side)
                s.x = startSnap.point.x
                s.y = startSnap.point.y
              }
            }
          }
          const endSnap = findNearestSnapAnchor(
            pt,
            getSnapTargets(),
            getSnapRadius(),
            { x: s.x, y: s.y },
            startTargetId,
          )
          hoveredSnapAnchor.value = endSnap
          const endPt = endSnap ? endSnap.point : pt
          s.width = endPt.x - s.x
          s.height = endPt.y - s.y
          if (endSnap) {
            s.endAnchor = {
              targetId: endSnap.targetId,
              targetKind: endSnap.targetKind,
              ...(endSnap.targetKind === 'card' ? { cardId: endSnap.targetId } : {}),
              side: endSnap.side,
            }
            s.endOrientation = orientationForSide(endSnap.side)
          } else {
            delete s.endAnchor
            s.endOrientation = connectorSettings.value.endOrientation
          }
        } else {
          s.x = Math.min(startPt.x, pt.x)
          s.y = Math.min(startPt.y, pt.y)
          s.width = Math.abs(pt.x - startPt.x)
          s.height = Math.abs(pt.y - startPt.y)
        }
        break
      }
      case 'erase':
        eraseAlong(lastPt, pt)
        break
      case 'move':
        applyMove(pt)
        break
      case 'resize':
        applyResize(pt)
        break
      case 'rotate': {
        const currentAngle = Math.atan2(pt.y - rotateCenter.y, pt.x - rotateCenter.x)
        let deltaDeg = Math.round(((currentAngle - rotateStartAngle) * 180) / Math.PI)
        if (shiftHeld) deltaDeg = Math.round(deltaDeg / 15) * 15
        for (const [key, initRot] of rotateInitialMap) {
          const found = findItem(key)
          if (found) {
            ;(found.item as { rotation?: number }).rotation = Math.round((((initRot + deltaDeg) % 360) + 360) % 360)
          }
        }
        syncAnchoredConnectors()
        break
      }
      case 'marquee':
        marquee.value = {
          x: Math.min(startPt.x, pt.x),
          y: Math.min(startPt.y, pt.y),
          w: Math.abs(pt.x - startPt.x),
          h: Math.abs(pt.y - startPt.y),
        }
        break
      case 'lasso':
        lasso.value?.push(pt)
        break
    }
    lastPt = pt
  }

  function isItemCaughtBySelectArea(
    key: string,
    area: { type: 'box'; box: Box } | { type: 'lasso'; poly: Point[] },
  ): boolean {
    const found = findItem(key)
    if (!found) return false

    const itemBounds = boundsOfKey(key)
    if (!itemBounds) return false

    const areaBounds: Box =
      area.type === 'box'
        ? {
            x: Math.min(area.box.x, area.box.x + area.box.w),
            y: Math.min(area.box.y, area.box.y + area.box.h),
            w: Math.abs(area.box.w),
            h: Math.abs(area.box.h),
          }
        : pointsBox(area.poly)

    if (!intersects(areaBounds, itemBounds)) return false

    const selectPoly: Point[] =
      area.type === 'box'
        ? [
            { x: areaBounds.x, y: areaBounds.y },
            { x: areaBounds.x + areaBounds.w, y: areaBounds.y },
            { x: areaBounds.x + areaBounds.w, y: areaBounds.y + areaBounds.h },
            { x: areaBounds.x, y: areaBounds.y + areaBounds.h },
          ]
        : area.poly

    if (found.kind === 'stroke') {
      const s = found.item as InkStroke
      if (!s.points.length) return false
      let pts = s.points
      if (s.rotation) {
        const center = getStrokeCenter(s)
        pts = s.points.map((p) => rotatePoint(p, center, s.rotation!))
      }
      return polylineIntersectsPolygon(pts, selectPoly)
    }

    if (found.kind === 'shape') {
      const s = found.item as ShapeElement
      if (isLine(s)) {
        const geo = getConnectorGeometry(s)
        const pts = geo.hitPoints.length
          ? geo.hitPoints
          : [{ x: s.x, y: s.y }, { x: s.x + s.width, y: s.y + s.height }]
        return polylineIntersectsPolygon(pts, selectPoly)
      }
      const poly = shapePolygon(s)
      return polygonIntersectsPolygon(poly, selectPoly)
    }

    // Sticky or Card
    const it = found.item as ObjectCardElement | StickyElement
    const corners: Point[] = [
      { x: it.x, y: it.y },
      { x: it.x + it.width, y: it.y },
      { x: it.x + it.width, y: it.y + it.height },
      { x: it.x, y: it.y + it.height },
    ]
    const poly = it.rotation
      ? corners.map((p) => rotatePoint(p, { x: it.x + it.width / 2, y: it.y + it.height / 2 }, it.rotation!))
      : corners
    return polygonIntersectsPolygon(poly, selectPoly)
  }

  function cancelInteraction() {
    setMode(null)
    currentStroke.value = null
    currentShape.value = null
    currentDraftSticky.value = null
    marquee.value = null
    lasso.value = null
    hoveredSnapAnchor.value = null
  }

  function endInteraction() {
    const finished = mode
    setMode(null)
    hoveredSnapAnchor.value = null
    switch (finished) {
      case 'stroke': {
        const stroke = currentStroke.value
        currentStroke.value = null
        if (!stroke) break
        stroke.points = simplifyStrokePoints(stroke.points, 0.5 / zoom.value)
        if (stroke.points.length === 1) {
          stroke.points.push({ ...stroke.points[0]! })
        }
        if (currentTool.value === 'select') {
          const box = pointsBox(stroke.points)
          const tiny = Math.max(box.w, box.h) * zoom.value < 6
          if (tiny && tapAt(stroke.points[0]!)) break
        }
        strokes.value.push(stroke)
        pushHistory()
        break
      }
      case 'shape': {
        const shape = currentShape.value
        currentShape.value = null
        if (shape && Math.max(Math.abs(shape.width), Math.abs(shape.height)) * zoom.value >= 6) {
          shapes.value.push(shape)
          selected.value = [keyOf('shape', shape.id)]
          pushHistory()
        }
        break
      }
      case 'sticky': {
        const draft = currentDraftSticky.value
        currentDraftSticky.value = null
        if (!draft) break
        const draggedDist = Math.max(draft.width, draft.height) * zoom.value
        if (draggedDist < 10) {
          addStickyAt(startPt)
        } else {
          addStickyAt(startPt, Math.max(80, draft.width), Math.max(60, draft.height), draft.x, draft.y)
        }
        break
      }
      case 'erase':
        if (erased) {
          erased = false
          pushHistory()
        }
        break
      case 'move':
        if (moved) pushHistory()
        else if (tapSticky) startEditing(tapSticky)
        tapSticky = undefined
        break
      case 'resize':
      case 'rotate':
        pushHistory()
        break
      case 'marquee': {
        const box = marquee.value
        marquee.value = null
        if (!box || (box.w < 4 && box.h < 4)) break
        const hits = allKeys().filter((k) => isItemCaughtBySelectArea(k, { type: 'box', box }))
        selected.value = shiftHeld ? [...new Set([...selected.value, ...hits])] : hits
        break
      }
      case 'lasso': {
        const poly = lasso.value
        lasso.value = null
        if (!poly || poly.length < 3) break
        const hits = allKeys().filter((k) => isItemCaughtBySelectArea(k, { type: 'lasso', poly }))
        selected.value = shiftHeld ? [...new Set([...selected.value, ...hits])] : hits
        break
      }
    }
  }

  // Gestures: Apple Pencil, Touch, Mouse ------------------------------------
  const {
    isPinching,
    activePenId,
    lastPenTime,
    getCanvasCoords,
    handlePointerDown: basePointerDown,
    handlePointerMove: basePointerMove,
    handlePointerUp: basePointerUp,
    handlePointerCancel: basePointerCancel,
    attachListeners,
    detachListeners,
  } = usePencilGestures({
    containerRef,
    isPencilOnly: pencilOnly,
    zoom,
    pan,
    isSceneDrawing,
    onTwoFingerTap: () => {
      if (!isSceneDrawing.value) undo()
    },
    onThreeFingerTap: () => {
      if (!isSceneDrawing.value) redo()
    },
    onSingleTouchTap: (pt) => {
      if (!isSceneDrawing.value) tapAt(pt)
    },
    onPinchStart: () => {
      touchActive = false
      touchDraggingItem = false
      touchPanning.value = false
      cancelInteraction()
    },
    onPinchEnd: () => {
      touchActive = false
      touchDraggingItem = false
      touchPanning.value = false
      notifyChange()
    },
    onPenStrokeStart: (pt) => {
      if (isSceneDrawing.value) return
      if (currentTool.value === 'select' && selected.value.length > 0) {
        const handle = hitHandle(pt, 'mouse')
        if (handle) {
          startResizeForHandle(handle)
          return
        }
        const hit = hitTest(pt)
        if (hit && selected.value.includes(hit)) {
          beginMove(pt)
          return
        }
      } else if (currentTool.value !== 'select') {
        selected.value = []
      }
      beginInteraction(pt, 'pen')
    },
    onPenStrokeMove: (pt) => {
      if (!isSceneDrawing.value) moveInteraction(pt)
    },
    onPenStrokeEnd: () => {
      if (!isSceneDrawing.value) endInteraction()
    },
  })

  const isUi = (e: Event) => !!(e.target as Element | null)?.closest?.('[data-wb-ui]')

  const touchIds = new Set<number>()
  let touchActive = false
  let touchDraggingItem = false
  const touchPanning = ref(false)
  let touchPanStart = { x: 0, y: 0 }
  let touchStartClient = { x: 0, y: 0 }
  let touchStartTime = 0

  let mouseActive = false
  const mousePanning = ref(false)
  let mousePanStart = { x: 0, y: 0 }

  function onPointerDown(e: PointerEvent) {
    if (isSceneDrawing.value) return
    if (editingId.value) {
      const activeEl = document.activeElement as HTMLElement | null
      if (activeEl && activeEl !== e.target) {
        activeEl.blur()
        editingId.value = null
      }
    }
    if (isUi(e)) return
    shiftHeld = e.shiftKey
    closeAllPopovers()

    if (e.pointerType === 'pen') {
      e.preventDefault()
      try {
        containerRef.value?.setPointerCapture(e.pointerId)
      } catch {}
      window.getSelection()?.removeAllRanges()
      lastPenTime.value = performance.now()
      setPen(true)
      basePointerDown(e)
      return
    }

    if (e.pointerType === 'touch') {
      const isPalm = (e.width && e.width > 75) || (e.height && e.height > 75)
      if (activePenId.value !== null || isPalm || performance.now() - lastPenTime.value < 400) {
        e.preventDefault()
        return
      }

      touchIds.add(e.pointerId)
      if (touchIds.size > 1 || isPinching.value) {
        touchActive = false
        touchDraggingItem = false
        touchPanning.value = false
        cancelInteraction()
        basePointerDown(e)
        return
      }

      basePointerDown(e)
      touchStartClient = { x: e.clientX, y: e.clientY }
      touchStartTime = performance.now()

      if (currentTool.value === 'hand') {
        touchPanning.value = true
        touchPanStart = { x: e.clientX, y: e.clientY }
        return
      }

      const pt = getCanvasCoords(e.clientX, e.clientY)

      if (selected.value.length > 0) {
        if (hitRotateHandle(pt, 'touch')) {
          touchActive = true
          touchDraggingItem = true
          startRotateAt(pt)
          return
        }
        const handle = hitHandle(pt, 'touch')
        if (handle) {
          touchActive = true
          touchDraggingItem = true
          startResizeForHandle(handle)
          return
        }
        const hit = hitTest(pt)
        if (hit && selected.value.includes(hit)) {
          touchActive = true
          touchDraggingItem = true
          beginMove(pt)
          return
        }
      }

      if (!pencilOnly.value) {
        touchActive = true
        beginInteraction(pt, 'touch')
      } else {
        touchPanning.value = true
        touchPanStart = { x: e.clientX, y: e.clientY }
      }
      return
    }

    // Mouse input
    if (getDrawMode() === 'auto') setPen(false)
    if (currentTool.value === 'hand' || e.button === 1 || e.altKey) {
      mousePanning.value = true
      mousePanStart = { x: e.clientX, y: e.clientY }
      return
    }
    if (e.button === 0) {
      const pt = getCanvasCoords(e.clientX, e.clientY)
      if (selected.value.length > 0) {
        if (hitRotateHandle(pt, 'mouse')) {
          mouseActive = true
          startRotateAt(pt)
          return
        }
        const handle = hitHandle(pt, 'mouse')
        if (handle) {
          mouseActive = true
          startResizeForHandle(handle)
          return
        }
        const hit = hitTest(pt)
        if (hit && selected.value.includes(hit)) {
          mouseActive = true
          beginMove(pt)
          return
        }
      }
      mouseActive = true
      try {
        containerRef.value?.setPointerCapture(e.pointerId)
      } catch {}
      beginInteraction(pt, 'mouse')
    }
  }

  function onPointerMove(e: PointerEvent) {
    if (isSceneDrawing.value) return
    if (e.pointerType === 'pen') {
      lastPenTime.value = performance.now()
      setPen(true)
      basePointerMove(e)
      eraserCursor.value = currentTool.value === 'eraser' && eraserMode.value === 'pixel' ? { x: e.clientX, y: e.clientY } : null
      return
    }

    if (e.pointerType === 'touch') {
      const isPalm = (e.width && e.width > 75) || (e.height && e.height > 75)
      if (activePenId.value !== null || isPalm || performance.now() - lastPenTime.value < 400) return

      if (touchIds.size > 1 || isPinching.value) {
        touchActive = false
        touchDraggingItem = false
        touchPanning.value = false
        return
      }

      basePointerMove(e)
      if (touchPanning.value && touchIds.size === 1) {
        pan.value = { x: pan.value.x + (e.clientX - touchPanStart.x), y: pan.value.y + (e.clientY - touchPanStart.y) }
        touchPanStart = { x: e.clientX, y: e.clientY }
        return
      }
      if (touchActive && touchIds.size === 1) {
        moveInteraction(getCanvasCoords(e.clientX, e.clientY))
      }
      return
    }

    if (mousePanning.value) {
      pan.value = { x: pan.value.x + (e.clientX - mousePanStart.x), y: pan.value.y + (e.clientY - mousePanStart.y) }
      mousePanStart = { x: e.clientX, y: e.clientY }
      return
    }

    eraserCursor.value = currentTool.value === 'eraser' && eraserMode.value === 'pixel' ? { x: e.clientX, y: e.clientY } : null

    if (mouseActive) {
      moveInteraction(getCanvasCoords(e.clientX, e.clientY))
    } else if (currentTool.value === 'connector') {
      const pt = getCanvasCoords(e.clientX, e.clientY)
      hoveredSnapAnchor.value = findNearestSnapAnchor(pt, getSnapTargets(), getSnapRadius())
    } else if (hoveredSnapAnchor.value) {
      hoveredSnapAnchor.value = null
    }
  }

  function onPointerUp(e: PointerEvent) {
    if (isSceneDrawing.value) return
    if (e.pointerType === 'pen') {
      lastPenTime.value = performance.now()
      try {
        containerRef.value?.releasePointerCapture(e.pointerId)
      } catch {}
      basePointerUp(e)
      eraserCursor.value = null
      return
    }

    if (e.pointerType === 'touch') {
      touchIds.delete(e.pointerId)
      basePointerUp(e)

      const isPalm = (e.width && e.width > 75) || (e.height && e.height > 75)
      if (isPalm || performance.now() - lastPenTime.value < 400 || isPinching.value || touchIds.size > 0) {
        touchActive = false
        touchDraggingItem = false
        touchPanning.value = false
        return
      }

      const dist = Math.hypot(e.clientX - touchStartClient.x, e.clientY - touchStartClient.y)
      const duration = performance.now() - touchStartTime

      if (dist < 8 && duration < 350 && checkStickyDoubleTap(getCanvasCoords(e.clientX, e.clientY))) {
        if (touchActive) cancelInteraction()
        touchActive = false
        touchDraggingItem = false
        touchPanning.value = false
        return
      }

      if (dist < 8 && duration < 350 && !touchDraggingItem) {
        const pt = getCanvasCoords(e.clientX, e.clientY)
        const hit = hitTest(pt)
        if (hit) {
          if (touchActive) {
            cancelInteraction()
            touchActive = false
          }
          tapAt(pt)
          touchPanning.value = false
          return
        } else if (pencilOnly.value || currentTool.value === 'select') {
          tapAt(pt)
        }
      }

      if (touchActive) {
        touchActive = false
        touchDraggingItem = false
        endInteraction()
      }
      if (touchPanning.value) {
        touchPanning.value = false
        notifyChange()
      }
      return
    }

    if (mousePanning.value) {
      mousePanning.value = false
      notifyChange()
    }
    if (mouseActive) {
      mouseActive = false
      const dist = Math.hypot(e.clientX - mousePanStart.x, e.clientY - mousePanStart.y)
      if (dist < 6) {
        const pt = getCanvasCoords(e.clientX, e.clientY)
        if (checkStickyDoubleTap(pt)) {
          cancelInteraction()
          eraserCursor.value = null
          return
        }
        const hit = hitTest(pt)
        if (hit && (!selected.value.length || !selected.value.includes(hit))) {
          cancelInteraction()
          tapAt(pt)
          eraserCursor.value = null
          return
        }
      }
      endInteraction()
    }
    eraserCursor.value = null
  }

  function onPointerCancel(e: PointerEvent) {
    if (e.pointerType === 'pen') {
      try {
        containerRef.value?.releasePointerCapture(e.pointerId)
      } catch {}
    }
    touchIds.delete(e.pointerId)
    if (touchActive || mouseActive) cancelInteraction()
    touchActive = false
    touchDraggingItem = false
    touchPanning.value = false
    mouseActive = false
    eraserCursor.value = null
    basePointerCancel(e)
  }

  // Wheel Zoom & Pan (debounced persistence so 120Hz wheel events don't serialize on every frame)
  let lastPinchTime = 0
  let wheelNotifyTimer: ReturnType<typeof setTimeout> | null = null

  function onWheel(e: WheelEvent) {
    e.preventDefault()
    if (e.ctrlKey || e.metaKey) {
      lastPinchTime = performance.now()
      const factor = Math.exp(-e.deltaY * 0.006)
      const nextZoom = Math.min(Math.max(zoom.value * factor, 0.2), 4)
      if (containerRef.value) {
        const rect = containerRef.value.getBoundingClientRect()
        const mx = Math.max(0, Math.min(rect.width, e.clientX - rect.left))
        const my = Math.max(0, Math.min(rect.height, e.clientY - rect.top))
        const prev = zoom.value
        zoom.value = nextZoom
        pan.value = {
          x: mx - (mx - pan.value.x) * (nextZoom / prev),
          y: my - (my - pan.value.y) * (nextZoom / prev),
        }
      }
    } else {
      if (performance.now() - lastPinchTime < 250) return
      pan.value = { x: pan.value.x - e.deltaX, y: pan.value.y - e.deltaY }
    }
    if (wheelNotifyTimer) clearTimeout(wheelNotifyTimer)
    wheelNotifyTimer = setTimeout(() => {
      wheelNotifyTimer = null
      notifyChange()
    }, 150)
  }

  const isOverCanvas = (e: Event): boolean => {
    const target = e.target as Node | null
    return !!(containerRef.value && target && containerRef.value.contains(target))
  }

  const preventGestureIfOverCanvas = (e: Event) => {
    if (isOverCanvas(e)) e.preventDefault()
  }

  const preventBrowserZoomIfOverCanvas = (e: WheelEvent) => {
    if ((e.ctrlKey || e.metaKey) && isOverCanvas(e)) e.preventDefault()
  }

  function onKey(e: KeyboardEvent) {
    const t = e.target as HTMLElement | null
    if (t && (t.tagName === 'TEXTAREA' || t.tagName === 'INPUT' || t.isContentEditable)) return
    const mod = e.metaKey || e.ctrlKey
    if ((e.key === 'Delete' || e.key === 'Backspace') && selected.value.length) {
      e.preventDefault()
      deleteSelected()
    } else if (e.key === 'Escape') {
      selected.value = []
      cancelInteraction()
    } else if (mod && e.key.toLowerCase() === 'z') {
      e.preventDefault()
      if (e.shiftKey) redo()
      else undo()
    } else if (mod && e.key.toLowerCase() === 'd' && selected.value.length) {
      e.preventDefault()
      duplicateSelected()
    } else if (mod && e.key.toLowerCase() === 'a') {
      e.preventDefault()
      selectAll()
    } else if (!mod && e.key.toLowerCase() === 'h') {
      onSelectMainTool('hand')
    } else if (!mod && e.key.toLowerCase() === 'v') {
      onSelectMainTool('select')
    } else if (!mod && e.key.toLowerCase() === 'c') {
      onSelectMainTool('connector')
    }
  }

  const preventTextSelection = (e: Event) => {
    if (performance.now() - lastPenTime.value < 600) {
      e.preventDefault()
      window.getSelection()?.removeAllRanges()
    }
  }
  const preventDblClick = (e: MouseEvent | Event) => e.preventDefault()

  onMounted(() => {
    if (containerRef.value) {
      attachListeners(containerRef.value)
      containerRef.value.addEventListener('wheel', onWheel, { passive: false })
      containerRef.value.addEventListener('gesturestart', preventGestureIfOverCanvas, { passive: false })
      containerRef.value.addEventListener('gesturechange', preventGestureIfOverCanvas, { passive: false })
      containerRef.value.addEventListener('gestureend', preventGestureIfOverCanvas, { passive: false })
      containerRef.value.addEventListener('selectstart', preventDblClick)
      containerRef.value.addEventListener('dblclick', preventDblClick)
    }
    document.addEventListener('gesturestart', preventGestureIfOverCanvas, { passive: false })
    document.addEventListener('gesturechange', preventGestureIfOverCanvas, { passive: false })
    document.addEventListener('gestureend', preventGestureIfOverCanvas, { passive: false })
    document.addEventListener('wheel', preventBrowserZoomIfOverCanvas, { passive: false })
    window.addEventListener('selectstart', preventTextSelection, { capture: true })
    window.addEventListener('keydown', onKey)
    window.addEventListener('focus', refreshObjectSummaries)
    onPenDetected(penSeen.value)
    refreshObjectSummaries()
  })

  onUnmounted(() => {
    if (wheelNotifyTimer) clearTimeout(wheelNotifyTimer)
    if (containerRef.value) {
      detachListeners(containerRef.value)
      containerRef.value.removeEventListener('wheel', onWheel)
      containerRef.value.removeEventListener('gesturestart', preventGestureIfOverCanvas)
      containerRef.value.removeEventListener('gesturechange', preventGestureIfOverCanvas)
      containerRef.value.removeEventListener('gestureend', preventGestureIfOverCanvas)
      containerRef.value.removeEventListener('selectstart', preventDblClick)
      containerRef.value.removeEventListener('dblclick', preventDblClick)
    }
    document.removeEventListener('gesturestart', preventGestureIfOverCanvas)
    document.removeEventListener('gesturechange', preventGestureIfOverCanvas)
    document.removeEventListener('gestureend', preventGestureIfOverCanvas)
    document.removeEventListener('wheel', preventBrowserZoomIfOverCanvas)
    window.removeEventListener('selectstart', preventTextSelection, { capture: true })
    window.removeEventListener('keydown', onKey)
    window.removeEventListener('focus', refreshObjectSummaries)
  })

  return {
    currentStroke,
    currentShape,
    currentDraftSticky,
    marquee,
    lasso,
    hoveredSnapAnchor,
    activeMode,
    touchPanning,
    mousePanning,
    getCanvasCoords,
    startEditing,
    onStickyFocus,
    onStickyBlur,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel,
  }
}
