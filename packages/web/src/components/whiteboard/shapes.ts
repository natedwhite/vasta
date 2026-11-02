import type {
  AnchorSide,
  AnchorTargetKind,
  ConnectorAnchor,
  LineCurvature,
  LineTermination,
  Point,
  ShapeElement,
  StrokeStyle,
} from './types.ts'

export const PALETTE = [
  '#ffffff', // White
  '#0f172a', // Slate black
  '#2563eb', // Blue
  '#16a34a', // Green
  '#d97706', // Amber / Orange
  '#dc2626', // Red
  '#9333ea', // Purple
]

export const STICKY_COLORS: Record<string, { bg: string; border: string; text: string }> = {
  amber: { bg: '#fef3c7', border: '#fcd34d', text: '#451a03' },
  emerald: { bg: '#d1fae5', border: '#6ee7b7', text: '#022c22' },
  sky: { bg: '#e0f2fe', border: '#7dd3fc', text: '#082f49' },
  rose: { bg: '#ffe4e6', border: '#fda4af', text: '#4c0519' },
  purple: { bg: '#f3e8ff', border: '#d8b4fe', text: '#3b0764' },
  gray: { bg: '#f1f5f9', border: '#cbd5e1', text: '#0f172a' },
}

export const stickyStyle = (name: string) => {
  if (name?.startsWith('#') || name?.startsWith('rgb')) {
    return { bg: name, border: '#cbd5e1', text: '#0f172a' }
  }
  return STICKY_COLORS[name] ?? STICKY_COLORS.amber!
}

export const STICKY_FONT_SIZES = {
  sm: '12px',
  md: '14px',
  lg: '18px',
  xl: '24px',
}

export const isLine = (s: ShapeElement) => s.type === 'line' || s.type === 'arrow'

export interface SnapTarget {
  id: string
  kind: AnchorTargetKind
  x: number
  y: number
  width: number
  height: number
  rotation?: number
}

export interface SnapCandidate {
  targetId: string
  targetKind: AnchorTargetKind
  side: AnchorSide
  point: Point
  target: SnapTarget
}

export const ANCHOR_SIDES: AnchorSide[] = ['top', 'right', 'bottom', 'left']

export function orientationForSide(side?: AnchorSide): 'horizontal' | 'vertical' | undefined {
  if (!side) return undefined
  return side === 'left' || side === 'right' ? 'horizontal' : 'vertical'
}

export function anchorTargetId(anchor?: ConnectorAnchor): string | undefined {
  return anchor?.targetId || anchor?.cardId
}

/**
 * Computes the world-space anchor point on a target's edge (`top`, `right`, `bottom`, `left`),
 * including for triangles, diamonds, ellipses, and rotated objects.
 */
export function getAnchorPoint(target: SnapTarget, side: AnchorSide): Point {
  const minX = Math.min(target.x, target.x + target.width)
  const minY = Math.min(target.y, target.y + target.height)
  const w = Math.abs(target.width)
  const h = Math.abs(target.height)
  const cx = minX + w / 2
  const cy = minY + h / 2

  let local: Point
  switch (side) {
    case 'top':
      local = { x: cx, y: minY }
      break
    case 'right':
      local = { x: minX + w, y: cy }
      break
    case 'bottom':
      local = { x: cx, y: minY + h }
      break
    case 'left':
      local = { x: minX, y: cy }
      break
  }
  return target.rotation ? rotatePoint(local, { x: cx, y: cy }, target.rotation) : local
}

export function getAllAnchorPoints(target: SnapTarget): { side: AnchorSide; point: Point }[] {
  return ANCHOR_SIDES.map((side) => ({ side, point: getAnchorPoint(target, side) }))
}

/**
 * Picks the best side on `target` to connect toward `referencePt`.
 */
export function bestSideToward(target: SnapTarget, referencePt: Point): AnchorSide {
  const anchors = getAllAnchorPoints(target)
  let best = anchors[0]!
  let bestDist = Infinity
  for (const a of anchors) {
    const d = Math.hypot(a.point.x - referencePt.x, a.point.y - referencePt.y)
    if (d < bestDist) {
      bestDist = d
      best = a
    }
  }
  return best.side
}

/**
 * Finds the nearest snap anchor for `pt` across all connectible canvas objects.
 * - First checks direct proximity to the 4 edge anchor dots (within `snapRadius * 1.35`).
 * - Next checks if `pt` is inside or within `snapRadius * 0.8` of an object's bounding box,
 *   snapping to the edge closest to `pt` (or facing `otherEndPt` when near the center).
 */
export function findNearestSnapAnchor(
  pt: Point,
  targets: SnapTarget[],
  snapRadius: number,
  otherEndPt?: Point,
  excludeTargetId?: string,
): SnapCandidate | null {
  let bestDot: SnapCandidate | null = null
  let bestDotDist = snapRadius * 1.35

  // 1. Direct proximity to any of the 4 edge anchor dots
  for (let i = targets.length - 1; i >= 0; i--) {
    const t = targets[i]!
    if (excludeTargetId && t.id === excludeTargetId) continue
    for (const { side, point } of getAllAnchorPoints(t)) {
      const d = Math.hypot(pt.x - point.x, pt.y - point.y)
      if (d <= bestDotDist) {
        bestDotDist = d
        bestDot = { targetId: t.id, targetKind: t.kind, side, point, target: t }
      }
    }
  }
  if (bestDot) return bestDot

  // 2. Inside or near the border of a target object (top-most first)
  const edgePad = snapRadius * 0.75
  for (let i = targets.length - 1; i >= 0; i--) {
    const t = targets[i]!
    if (excludeTargetId && t.id === excludeTargetId) continue
    const minX = Math.min(t.x, t.x + t.width)
    const minY = Math.min(t.y, t.y + t.height)
    const w = Math.abs(t.width)
    const h = Math.abs(t.height)
    const cx = minX + w / 2
    const cy = minY + h / 2
    const localPt = t.rotation ? rotatePoint(pt, { x: cx, y: cy }, -t.rotation) : pt

    if (
      localPt.x >= minX - edgePad &&
      localPt.x <= minX + w + edgePad &&
      localPt.y >= minY - edgePad &&
      localPt.y <= minY + h + edgePad
    ) {
      // Pick the edge closest to the pointer, or if deep inside the center, the edge facing otherEndPt
      const distToCenter = Math.hypot(localPt.x - cx, localPt.y - cy)
      const isDeepCenter = otherEndPt && distToCenter < Math.min(w, h) * 0.22
      const side = isDeepCenter ? bestSideToward(t, otherEndPt) : bestSideToward(t, pt)
      const point = getAnchorPoint(t, side)
      return { targetId: t.id, targetKind: t.kind, side, point, target: t }
    }
  }

  return null
}

/** Stroke DashArray */
export function getStrokeDash(style?: StrokeStyle): string | undefined {
  if (style === 'dashed') return '8 6'
  if (style === 'dotted') return '3 5'
  return undefined
}

/** 2D Shape Fill */
export function getShapeFill(s: ShapeElement): string {
  const f = s.fill || 'none'
  if (f === 'none') return 'transparent'
  if (f === 'white') return '#ffffff'
  const base = s.fillColor || s.color
  if (f === 'tint') return `${base}26` // 15% opacity hex
  if (f === 'solid') return base
  return f // custom hex
}

export function rotatePoint(p: Point, center: Point, angleDeg: number): Point {
  if (!angleDeg) return p
  const rad = (angleDeg * Math.PI) / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  const dx = p.x - center.x
  const dy = p.y - center.y
  return {
    x: center.x + dx * cos - dy * sin,
    y: center.y + dx * sin + dy * cos,
  }
}

/** Outline of a closed shape as a polygon (an ellipse is sampled). */
export function shapePolygon(s: ShapeElement): Point[] {
  const { x, y, width: w, height: h } = s
  const cx = x + w / 2
  const cy = y + h / 2
  let poly: Point[]
  switch (s.type) {
    case 'diamond':
      poly = [{ x: cx, y }, { x: x + w, y: cy }, { x: cx, y: y + h }, { x, y: cy }]
      break
    case 'triangle':
      poly = [{ x: cx, y }, { x: x + w, y: y + h }, { x, y: y + h }]
      break
    case 'ellipse':
      poly = Array.from({ length: 32 }, (_, i) => {
        const a = (i / 32) * Math.PI * 2
        return { x: cx + (Math.cos(a) * w) / 2, y: cy + (Math.sin(a) * h) / 2 }
      })
      break
    default:
      poly = [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }]
      break
  }
  return s.rotation ? poly.map((p) => rotatePoint(p, { x: cx, y: cy }, s.rotation!)) : poly
}

/** SVG path data for 2D shapes. */
export function shapePath(s: ShapeElement): string {
  if (isLine(s)) {
    return getConnectorGeometry(s).shaftPath
  }
  const { x, y, width: w, height: h } = s
  if (s.type === 'ellipse') {
    const rx = Math.max(1, Math.abs(w) / 2)
    const ry = Math.max(1, Math.abs(h) / 2)
    const cx = x + w / 2
    const cy = y + h / 2
    return `M ${cx - rx} ${cy} a ${rx} ${ry} 0 1 0 ${rx * 2} 0 a ${rx} ${ry} 0 1 0 ${-rx * 2} 0 Z`
  }
  if (s.type === 'rectangle') {
    const r = Math.max(0, Math.min(8, Math.abs(w) / 2, Math.abs(h) / 2))
    const minX = Math.min(x, x + w)
    const minY = Math.min(y, y + h)
    const absW = Math.abs(w)
    const absH = Math.abs(h)
    return `M ${minX + r} ${minY} H ${minX + absW - r} Q ${minX + absW} ${minY} ${minX + absW} ${minY + r} V ${minY + absH - r} Q ${minX + absW} ${minY + absH} ${minX + absW - r} ${minY + absH} H ${minX + r} Q ${minX} ${minY + absH} ${minX} ${minY + absH - r} V ${minY + r} Q ${minX} ${minY} ${minX + r} ${minY} Z`
  }
  return shapePolygon(s).map((p, i) => `${i ? 'L' : 'M'} ${p.x} ${p.y}`).join(' ') + ' Z'
}

export interface ConnectorGeometry {
  shaftPath: string
  startHead?: string // SVG path for polygon/circle
  endHead?: string // SVG path for polygon/circle
  hitPoints: Point[]
}

/**
 * Calculates connector line and arrowheads.
 * When snapped to an object (`startAnchor` / `endAnchor`), orientation is locked to the snapped side
 * and outward normals prevent lines from cutting backward through the inside of a card.
 */
export function getConnectorGeometry(s: ShapeElement): ConnectorGeometry {
  const x1 = s.x
  const y1 = s.y
  const x2 = s.x + s.width
  const y2 = s.y + s.height
  const strokeW = s.strokeWidth || 3
  const curvature: LineCurvature = s.curvature || 'straight'

  const arrowLen = Math.max(14, strokeW * 4.2)
  const arrowWidth = Math.max(12, strokeW * 3.6)
  const dotRadius = Math.max(5.5, strokeW * 1.8)

  const dx = x2 - x1
  const dy = y2 - y1
  const dist = Math.hypot(dx, dy)

  if (dist < 4) {
    return {
      shaftPath: `M ${x1} ${y1} L ${x2} ${y2}`,
      hitPoints: [{ x: x1, y: y1 }, { x: x2, y: y2 }],
    }
  }

  const startTerm: LineTermination = s.startHead ?? (s.arrowHead === 'double' ? 'arrow' : 'none')
  const endTerm: LineTermination =
    s.endHead ??
    (s.arrowHead === 'single' || s.arrowHead === 'double'
      ? 'arrow'
      : s.arrowHead === 'dot'
        ? 'dot'
        : s.arrowHead === 'none'
          ? 'none'
          : s.type === 'arrow'
            ? 'arrow'
            : 'none')

  const hasStartArrow = startTerm === 'arrow'
  const hasStartDot = startTerm === 'dot'
  const hasEndArrow = endTerm === 'arrow'
  const hasEndDot = endTerm === 'dot'

  if (curvature === 'orthogonal') {
    const lockedStartOri = orientationForSide(s.startAnchor?.side)
    const lockedEndOri = orientationForSide(s.endAnchor?.side)

    const defStartOri = s.orientation ?? (Math.abs(dx) >= Math.abs(dy) ? 'horizontal' : 'vertical')
    const startOri = lockedStartOri ?? s.startOrientation ?? defStartOri
    const endOri =
      lockedEndOri ??
      s.endOrientation ??
      (s.startOrientation || lockedStartOri ? (startOri === 'horizontal' ? 'horizontal' : 'vertical') : defStartOri)

    let shaftStart = { x: x1, y: y1 }
    let shaftEnd = { x: x2, y: y2 }
    let startHead: string | undefined
    let endHead: string | undefined

    const baseUx = dx >= 0 ? 1 : -1
    const baseUy = dy >= 0 ? 1 : -1

    // Outward direction from start point along startOri
    const startSign =
      s.startAnchor?.side === 'right'
        ? 1
        : s.startAnchor?.side === 'left'
          ? -1
          : s.startAnchor?.side === 'bottom'
            ? 1
            : s.startAnchor?.side === 'top'
              ? -1
              : startOri === 'horizontal'
                ? baseUx
                : baseUy

    // Approach direction into end point along endOri (points toward x2, y2)
    const endSign =
      s.endAnchor?.side === 'left'
        ? 1
        : s.endAnchor?.side === 'right'
          ? -1
          : s.endAnchor?.side === 'top'
            ? 1
            : s.endAnchor?.side === 'bottom'
              ? -1
              : endOri === 'horizontal'
                ? baseUx
                : baseUy

    // Arrowhead / dot at start
    if (startOri === 'vertical') {
      if (hasStartArrow) {
        shaftStart = { x: x1, y: y1 + startSign * arrowLen }
        const sw1 = { x: x1 + arrowWidth / 2, y: shaftStart.y }
        const sw2 = { x: x1 - arrowWidth / 2, y: shaftStart.y }
        startHead = `M ${x1} ${y1} L ${sw1.x} ${sw1.y} L ${sw2.x} ${sw2.y} Z`
      } else if (hasStartDot) {
        shaftStart = { x: x1, y: y1 + startSign * dotRadius }
        startHead = `M ${x1 - dotRadius} ${y1} a ${dotRadius} ${dotRadius} 0 1 0 ${dotRadius * 2} 0 a ${dotRadius} ${dotRadius} 0 1 0 ${-dotRadius * 2} 0 Z`
      }
    } else {
      if (hasStartArrow) {
        shaftStart = { x: x1 + startSign * arrowLen, y: y1 }
        const sw1 = { x: shaftStart.x, y: y1 + arrowWidth / 2 }
        const sw2 = { x: shaftStart.x, y: y1 - arrowWidth / 2 }
        startHead = `M ${x1} ${y1} L ${sw1.x} ${sw1.y} L ${sw2.x} ${sw2.y} Z`
      } else if (hasStartDot) {
        shaftStart = { x: x1 + startSign * dotRadius, y: y1 }
        startHead = `M ${x1 - dotRadius} ${y1} a ${dotRadius} ${dotRadius} 0 1 0 ${dotRadius * 2} 0 a ${dotRadius} ${dotRadius} 0 1 0 ${-dotRadius * 2} 0 Z`
      }
    }

    // Arrowhead / dot at end
    if (endOri === 'vertical') {
      if (hasEndArrow) {
        shaftEnd = { x: x2, y: y2 - endSign * arrowLen }
        const w1 = { x: x2 + arrowWidth / 2, y: shaftEnd.y }
        const w2 = { x: x2 - arrowWidth / 2, y: shaftEnd.y }
        endHead = `M ${x2} ${y2} L ${w1.x} ${w1.y} L ${w2.x} ${w2.y} Z`
      } else if (hasEndDot) {
        shaftEnd = { x: x2, y: y2 - endSign * dotRadius }
        endHead = `M ${x2 - dotRadius} ${y2} a ${dotRadius} ${dotRadius} 0 1 0 ${dotRadius * 2} 0 a ${dotRadius} ${dotRadius} 0 1 0 ${-dotRadius * 2} 0 Z`
      }
    } else {
      if (hasEndArrow) {
        shaftEnd = { x: x2 - endSign * arrowLen, y: y2 }
        const w1 = { x: shaftEnd.x, y: y2 + arrowWidth / 2 }
        const w2 = { x: shaftEnd.x, y: y2 - arrowWidth / 2 }
        endHead = `M ${x2} ${y2} L ${w1.x} ${w1.y} L ${w2.x} ${w2.y} Z`
      } else if (hasEndDot) {
        shaftEnd = { x: x2 - endSign * dotRadius, y: y2 }
        endHead = `M ${x2 - dotRadius} ${y2} a ${dotRadius} ${dotRadius} 0 1 0 ${dotRadius * 2} 0 a ${dotRadius} ${dotRadius} 0 1 0 ${-dotRadius * 2} 0 Z`
      }
    }

    const r = Math.min(12, Math.abs(dx) / 2, Math.abs(dy) / 2)

    if (startOri === 'horizontal' && endOri === 'vertical') {
      const cornerX = x2
      const cornerY = y1
      const p1 = `M ${shaftStart.x} ${shaftStart.y} L ${cornerX - startSign * r} ${cornerY}`
      const c1 = `Q ${cornerX} ${cornerY} ${cornerX} ${cornerY + endSign * r}`
      const p2 = `L ${shaftEnd.x} ${shaftEnd.y}`
      const shaftPath =
        r > 2 && startSign === baseUx && endSign === baseUy
          ? `${p1} ${c1} ${p2}`
          : `M ${shaftStart.x} ${shaftStart.y} L ${cornerX} ${cornerY} L ${shaftEnd.x} ${shaftEnd.y}`
      return {
        shaftPath,
        startHead,
        endHead,
        hitPoints: [{ x: x1, y: y1 }, { x: cornerX, y: cornerY }, { x: x2, y: y2 }],
      }
    } else if (startOri === 'vertical' && endOri === 'horizontal') {
      const cornerX = x1
      const cornerY = y2
      const p1 = `M ${shaftStart.x} ${shaftStart.y} L ${cornerX} ${cornerY - startSign * r}`
      const c1 = `Q ${cornerX} ${cornerY} ${cornerX + endSign * r} ${cornerY}`
      const p2 = `L ${shaftEnd.x} ${shaftEnd.y}`
      const shaftPath =
        r > 2 && startSign === baseUy && endSign === baseUx
          ? `${p1} ${c1} ${p2}`
          : `M ${shaftStart.x} ${shaftStart.y} L ${cornerX} ${cornerY} L ${shaftEnd.x} ${shaftEnd.y}`
      return {
        shaftPath,
        startHead,
        endHead,
        hitPoints: [{ x: x1, y: y1 }, { x: cornerX, y: cornerY }, { x: x2, y: y2 }],
      }
    } else if (startOri === 'vertical' && endOri === 'vertical') {
      const stub = 24
      let midY = s.midOffset !== undefined ? y1 + s.midOffset : y1 + dy / 2
      if (s.startAnchor?.side && s.midOffset === undefined && startSign * dy < stub) {
        midY = y1 + startSign * Math.max(stub, Math.abs(dy) + stub)
      }
      const dir1 = midY >= shaftStart.y ? 1 : -1
      const dir2 = shaftEnd.y >= midY ? 1 : -1
      const p1 = `M ${shaftStart.x} ${shaftStart.y} L ${x1} ${midY - dir1 * r}`
      const c1 = `Q ${x1} ${midY} ${x1 + baseUx * r} ${midY}`
      const p2 = `L ${x2 - baseUx * r} ${midY}`
      const c2 = `Q ${x2} ${midY} ${x2} ${midY + dir2 * r}`
      const p3 = `L ${shaftEnd.x} ${shaftEnd.y}`
      const shaftPath =
        r > 2 && Math.abs(midY - shaftStart.y) > r && Math.abs(shaftEnd.y - midY) > r
          ? `${p1} ${c1} ${p2} ${c2} ${p3}`
          : `M ${shaftStart.x} ${shaftStart.y} L ${x1} ${midY} L ${x2} ${midY} L ${shaftEnd.x} ${shaftEnd.y}`
      return {
        shaftPath,
        startHead,
        endHead,
        hitPoints: [{ x: x1, y: y1 }, { x: x1, y: midY }, { x: x2, y: midY }, { x: x2, y: y2 }],
      }
    } else {
      // Horizontal -> Horizontal (standard 3 segment)
      const stub = 24
      let midX = s.midOffset !== undefined ? x1 + s.midOffset : x1 + dx / 2
      if (s.startAnchor?.side && s.midOffset === undefined && startSign * dx < stub) {
        midX = x1 + startSign * Math.max(stub, Math.abs(dx) + stub)
      }
      const dir1 = midX >= shaftStart.x ? 1 : -1
      const dir2 = shaftEnd.x >= midX ? 1 : -1
      const p1 = `M ${shaftStart.x} ${shaftStart.y} L ${midX - dir1 * r} ${y1}`
      const c1 = `Q ${midX} ${y1} ${midX} ${y1 + baseUy * r}`
      const p2 = `L ${midX} ${y2 - baseUy * r}`
      const c2 = `Q ${midX} ${y2} ${midX + dir2 * r} ${y2}`
      const p3 = `L ${shaftEnd.x} ${shaftEnd.y}`
      const shaftPath =
        r > 2 && Math.abs(midX - shaftStart.x) > r && Math.abs(shaftEnd.x - midX) > r
          ? `${p1} ${c1} ${p2} ${c2} ${p3}`
          : `M ${shaftStart.x} ${shaftStart.y} L ${midX} ${y1} L ${midX} ${y2} L ${shaftEnd.x} ${shaftEnd.y}`
      return {
        shaftPath,
        startHead,
        endHead,
        hitPoints: [{ x: x1, y: y1 }, { x: midX, y: y1 }, { x: midX, y: y2 }, { x: x2, y: y2 }],
      }
    }
  }

  if (curvature === 'curved') {
    let ctrl: Point
    if (s.controlPoint) {
      ctrl = { ...s.controlPoint }
    } else {
      const uX = dx / dist
      const uY = dy / dist
      const nX = -uY
      const nY = uX
      const arcOffset = dist * 0.22
      ctrl = { x: (x1 + x2) / 2 + nX * arcOffset, y: (y1 + y2) / 2 + nY * arcOffset }
    }

    const tEndDx = x2 - ctrl.x
    const tEndDy = y2 - ctrl.y
    const tEndLen = Math.hypot(tEndDx, tEndDy) || 1
    const tuX = tEndDx / tEndLen
    const tuY = tEndDy / tEndLen
    const tnX = -tuY
    const tnY = tuX

    let shaftEnd = { x: x2, y: y2 }
    let endHead: string | undefined

    if (hasEndArrow) {
      shaftEnd = { x: x2 - tuX * arrowLen, y: y2 - tuY * arrowLen }
      const w1 = { x: shaftEnd.x + tnX * (arrowWidth / 2), y: shaftEnd.y + tnY * (arrowWidth / 2) }
      const w2 = { x: shaftEnd.x - tnX * (arrowWidth / 2), y: shaftEnd.y - tnY * (arrowWidth / 2) }
      endHead = `M ${x2} ${y2} L ${w1.x} ${w1.y} L ${w2.x} ${w2.y} Z`
    } else if (hasEndDot) {
      shaftEnd = { x: x2 - tuX * dotRadius, y: y2 - tuY * dotRadius }
      endHead = `M ${x2 - dotRadius} ${y2} a ${dotRadius} ${dotRadius} 0 1 0 ${dotRadius * 2} 0 a ${dotRadius} ${dotRadius} 0 1 0 ${-dotRadius * 2} 0 Z`
    }

    let shaftStart = { x: x1, y: y1 }
    let startHead: string | undefined
    if (hasStartArrow || hasStartDot) {
      const tStartDx = ctrl.x - x1
      const tStartDy = ctrl.y - y1
      const tStartLen = Math.hypot(tStartDx, tStartDy) || 1
      const suX = tStartDx / tStartLen
      const suY = tStartDy / tStartLen
      const snX = -suY
      const snY = suX
      if (hasStartArrow) {
        shaftStart = { x: x1 + suX * arrowLen, y: y1 + suY * arrowLen }
        const sw1 = { x: shaftStart.x + snX * (arrowWidth / 2), y: shaftStart.y + snY * (arrowWidth / 2) }
        const sw2 = { x: shaftStart.x - snX * (arrowWidth / 2), y: shaftStart.y - snY * (arrowWidth / 2) }
        startHead = `M ${x1} ${y1} L ${sw1.x} ${sw1.y} L ${sw2.x} ${sw2.y} Z`
      } else {
        shaftStart = { x: x1 + suX * dotRadius, y: y1 + suY * dotRadius }
        startHead = `M ${x1 - dotRadius} ${y1} a ${dotRadius} ${dotRadius} 0 1 0 ${dotRadius * 2} 0 a ${dotRadius} ${dotRadius} 0 1 0 ${-dotRadius * 2} 0 Z`
      }
    }

    return {
      shaftPath: `M ${shaftStart.x} ${shaftStart.y} Q ${ctrl.x} ${ctrl.y} ${shaftEnd.x} ${shaftEnd.y}`,
      startHead,
      endHead,
      hitPoints: [{ x: x1, y: y1 }, ctrl, { x: x2, y: y2 }],
    }
  }

  // Straight line
  const uX = dx / dist
  const uY = dy / dist
  const nX = -uY
  const nY = uX

  let shaftStart = { x: x1, y: y1 }
  let shaftEnd = { x: x2, y: y2 }
  let startHead: string | undefined
  let endHead: string | undefined

  if (hasEndArrow) {
    shaftEnd = { x: x2 - uX * arrowLen, y: y2 - uY * arrowLen }
    const w1 = { x: shaftEnd.x + nX * (arrowWidth / 2), y: shaftEnd.y + nY * (arrowWidth / 2) }
    const w2 = { x: shaftEnd.x - nX * (arrowWidth / 2), y: shaftEnd.y - nY * (arrowWidth / 2) }
    endHead = `M ${x2} ${y2} L ${w1.x} ${w1.y} L ${w2.x} ${w2.y} Z`
  } else if (hasEndDot) {
    shaftEnd = { x: x2 - uX * dotRadius, y: y2 - uY * dotRadius }
    endHead = `M ${x2 - dotRadius} ${y2} a ${dotRadius} ${dotRadius} 0 1 0 ${dotRadius * 2} 0 a ${dotRadius} ${dotRadius} 0 1 0 ${-dotRadius * 2} 0 Z`
  }

  if (hasStartArrow) {
    shaftStart = { x: x1 + uX * arrowLen, y: y1 + uY * arrowLen }
    const sw1 = { x: shaftStart.x + nX * (arrowWidth / 2), y: shaftStart.y + nY * (arrowWidth / 2) }
    const sw2 = { x: shaftStart.x - nX * (arrowWidth / 2), y: shaftStart.y - nY * (arrowWidth / 2) }
    startHead = `M ${x1} ${y1} L ${sw1.x} ${sw1.y} L ${sw2.x} ${sw2.y} Z`
  } else if (hasStartDot) {
    shaftStart = { x: x1 + uX * dotRadius, y: y1 + uY * dotRadius }
    startHead = `M ${x1 - dotRadius} ${y1} a ${dotRadius} ${dotRadius} 0 1 0 ${dotRadius * 2} 0 a ${dotRadius} ${dotRadius} 0 1 0 ${-dotRadius * 2} 0 Z`
  }

  return {
    shaftPath: `M ${shaftStart.x} ${shaftStart.y} L ${shaftEnd.x} ${shaftEnd.y}`,
    startHead,
    endHead,
    hitPoints: [{ x: x1, y: y1 }, { x: x2, y: y2 }],
  }
}

export function distToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len2 = dx * dx + dy * dy
  const t = len2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2)) : 0
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy))
}

export function distToPolyline(p: Point, points: Point[], closed = false): number {
  const first = points[0]
  if (!first) return Infinity
  if (points.length === 1) return Math.hypot(p.x - first.x, p.y - first.y)
  let best = Infinity
  const last = closed ? points.length : points.length - 1
  for (let i = 0; i < last; i++) best = Math.min(best, distToSegment(p, points[i]!, points[(i + 1) % points.length]!))
  return best
}

/** Is `p` within `tol` of the shape's outline (or its line)? */
export function shapeHit(s: ShapeElement, p: Point, tol: number): boolean {
  if (isLine(s)) {
    const geo = getConnectorGeometry(s)
    return distToPolyline(p, geo.hitPoints) <= tol + (s.strokeWidth || 3) / 2
  }
  const poly = shapePolygon(s)
  return pointInPolygon(p, poly) || distToPolyline(p, poly, true) <= tol
}

export function pointInPolygon(p: Point, poly: Point[]): boolean {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!
    const b = poly[j]!
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside
  }
  return inside
}

/**
 * Simplifies high-frequency (120Hz/240Hz Apple Pencil) freehand stroke points using
 * radial distance pre-filtering followed by Ramer–Douglas–Peucker decimation.
 */
export function simplifyStrokePoints<T extends Point & { pressure?: number }>(points: T[], tolerance = 0.5): T[] {
  if (points.length <= 2) return points

  const radialTol = tolerance * 0.5
  const radial: T[] = [points[0]!]
  let prev = points[0]!
  for (let i = 1; i < points.length - 1; i++) {
    const pt = points[i]!
    if (Math.hypot(pt.x - prev.x, pt.y - prev.y) >= radialTol) {
      radial.push(pt)
      prev = pt
    }
  }
  radial.push(points[points.length - 1]!)
  if (radial.length <= 2) return radial

  const keep = new Uint8Array(radial.length)
  keep[0] = 1
  keep[radial.length - 1] = 1
  const stack: Array<[number, number]> = [[0, radial.length - 1]]

  while (stack.length > 0) {
    const [first, last] = stack.pop()!
    if (last <= first + 1) continue
    let maxDist = 0
    let index = first
    const a = radial[first]!
    const b = radial[last]!
    for (let i = first + 1; i < last; i++) {
      const d = distToSegment(radial[i]!, a, b)
      if (d > maxDist) {
        maxDist = d
        index = i
      }
    }
    if (maxDist > tolerance) {
      keep[index] = 1
      stack.push([first, index], [index, last])
    }
  }

  const out: T[] = []
  for (let i = 0; i < radial.length; i++) {
    if (keep[i]) {
      const p = radial[i]!
      out.push({
        ...p,
        x: Math.round(p.x * 100) / 100,
        y: Math.round(p.y * 100) / 100,
        ...(p.pressure !== undefined ? { pressure: Math.round(p.pressure * 1000) / 1000 } : {}),
      })
    }
  }
  return out
}
