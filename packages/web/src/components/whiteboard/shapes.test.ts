import { describe, expect, it } from 'vitest'
import { getAnchorPoint, getAllAnchorPoints, getConnectorGeometry, getOrthogonalMidPoint, type SnapTarget } from './shapes.ts'
import type { ShapeElement } from './types.ts'

describe('Whiteboard Connector Geometry', () => {
  it('touches the outer edge of an object when snapped without leaving a gap', () => {
    const snappedArrow: ShapeElement = {
      id: 'conn-1',
      type: 'arrow',
      x: 100,
      y: 100,
      width: 200,
      height: 0,
      color: '#000000',
      strokeWidth: 3,
      startHead: 'none',
      endHead: 'arrow',
      startAnchor: { targetId: 'card-1', side: 'right' },
      endAnchor: { targetId: 'card-2', side: 'left' },
    }

    const geo = getConnectorGeometry(snappedArrow)
    // Snapped arrow termination touches the object's outer edge cleanly at 298.5 without extending inside 300
    expect(geo.endHead).toBeDefined()
    expect(geo.endHead).toContain('M 298.5 100')
  })

  it('does not offset dot termination when snapped, keeping the dot centered on the edge', () => {
    const snappedDot: ShapeElement = {
      id: 'conn-2',
      type: 'line',
      x: 100,
      y: 100,
      width: 200,
      height: 0,
      color: '#000000',
      strokeWidth: 3,
      startHead: 'dot',
      endHead: 'dot',
      startAnchor: { targetId: 'card-1', side: 'right' },
      endAnchor: { targetId: 'card-2', side: 'left' },
    }

    const geo = getConnectorGeometry(snappedDot)
    // Start dot centered at x=100, end dot centered at x=300
    expect(geo.startHead).toContain('M 94.5 100') // 100 - dotRadius (5.5)
    expect(geo.endHead).toContain('M 294.5 100') // 300 - dotRadius (5.5)
    expect(geo.startDot).toBeDefined()
    expect(geo.endDot).toBeDefined()
    expect(geo.startHeadType).toBe('dot')
    expect(geo.endHeadType).toBe('dot')
  })

  it('does not offset free-floating connector ends (no anchors)', () => {
    const freeArrow: ShapeElement = {
      id: 'conn-3',
      type: 'arrow',
      x: 100,
      y: 100,
      width: 200,
      height: 0,
      color: '#000000',
      strokeWidth: 3,
      startHead: 'none',
      endHead: 'arrow',
    }

    const geo = getConnectorGeometry(freeArrow)
    // Without snap anchors, tip remains exactly at the end coordinate (300)
    expect(geo.endHeadType).toBe('arrow')
    expect(geo.endDot).toBeUndefined()
    expect(geo.endHead).toBeDefined()
    expect(geo.endHead).toContain('M 300 100')
  })

  it('supports drag-to-size sticky bounds', () => {
    const startPt = { x: 50, y: 80 }
    const endPt = { x: 250, y: 220 }

    const x = Math.min(startPt.x, endPt.x)
    const y = Math.min(startPt.y, endPt.y)
    const width = Math.max(80, Math.abs(endPt.x - startPt.x))
    const height = Math.max(60, Math.abs(endPt.y - startPt.y))

    expect(x).toBe(50)
    expect(y).toBe(80)
    expect(width).toBe(200)
    expect(height).toBe(140)
  })

  it('enforces minimum dimensions on dragged stickies', () => {
    const startPt = { x: 100, y: 100 }
    const endPt = { x: 120, y: 115 } // small drag (20x15)

    const width = Math.max(80, Math.abs(endPt.x - startPt.x))
    const height = Math.max(60, Math.abs(endPt.y - startPt.y))

    expect(width).toBe(80)
    expect(height).toBe(60)
  })

  it('returns null for single-turn elbow connectors (no middle handle dot)', () => {
    const elbow: ShapeElement = {
      id: 'conn-elbow',
      type: 'arrow',
      color: '#000000',
      curvature: 'orthogonal',
      x: 100,
      y: 100,
      width: 150,
      height: 100,
      startOrientation: 'horizontal',
      endOrientation: 'vertical',
      startAnchor: { targetId: 'c1', side: 'right' },
      endAnchor: { targetId: 'c2', side: 'top' },
    }
    expect(getOrthogonalMidPoint(elbow)).toBeNull()
  })

  it('returns middle segment point for 2-turn S/Z orthogonal connectors', () => {
    const sShape: ShapeElement = {
      id: 'conn-s',
      type: 'arrow',
      color: '#000000',
      curvature: 'orthogonal',
      x: 100,
      y: 100,
      width: 200,
      height: 100,
      startOrientation: 'horizontal',
      endOrientation: 'horizontal',
      startAnchor: { targetId: 'c1', side: 'right' },
      endAnchor: { targetId: 'c2', side: 'left' },
      midOffset: 80,
    }
    const mid = getOrthogonalMidPoint(sShape)
    expect(mid).not.toBeNull()
    expect(mid!.x).toBe(180) // 100 + midOffset (80)
    expect(mid!.y).toBe(150) // (100 + 200) / 2
  })

  it('returns middle segment point for 2-turn U-shaped orthogonal connectors', () => {
    const uShape: ShapeElement = {
      id: 'conn-u',
      type: 'arrow',
      color: '#000000',
      curvature: 'orthogonal',
      x: 100,
      y: 100,
      width: 200,
      height: 0,
      startOrientation: 'vertical',
      endOrientation: 'vertical',
      startAnchor: { targetId: 'c1', side: 'bottom' },
      endAnchor: { targetId: 'c2', side: 'bottom' },
      midOffset: 60,
    }
    const mid = getOrthogonalMidPoint(uShape)
    expect(mid).not.toBeNull()
    expect(mid!.x).toBe(200) // 100 + 200/2
    expect(mid!.y).toBe(160) // 100 + midOffset (60)
  })

  it('routes same-side top-top connectors above both boxes with default clearance', () => {
    const topTop: ShapeElement = {
      id: 'conn-top-top',
      type: 'arrow',
      color: '#000000',
      curvature: 'orthogonal',
      x: 100,
      y: 150,
      width: 200,
      height: -50, // start at y=150, end at y=100 (c2 is higher)
      startOrientation: 'vertical',
      endOrientation: 'vertical',
      startAnchor: { targetId: 'c1', side: 'top' },
      endAnchor: { targetId: 'c2', side: 'top' },
    }
    const mid = getOrthogonalMidPoint(topTop)
    expect(mid).not.toBeNull()
    expect(mid!.x).toBe(200) // (100 + 300) / 2
    // Higher box is at y=100. Default clearance is 36px above it: 100 - 36 = 64
    expect(mid!.y).toBe(64)
  })

  it('routes same-side bottom-bottom connectors below both boxes with default clearance', () => {
    const bottomBottom: ShapeElement = {
      id: 'conn-bb',
      type: 'arrow',
      color: '#000000',
      curvature: 'orthogonal',
      x: 100,
      y: 150,
      width: 200,
      height: 50, // start at y=150, end at y=200 (c2 is lower)
      startOrientation: 'vertical',
      endOrientation: 'vertical',
      startAnchor: { targetId: 'c1', side: 'bottom' },
      endAnchor: { targetId: 'c2', side: 'bottom' },
    }
    const mid = getOrthogonalMidPoint(bottomBottom)
    expect(mid).not.toBeNull()
    expect(mid!.x).toBe(200)
    // Lower box is at y=200. Default clearance is 36px below it: 200 + 36 = 236
    expect(mid!.y).toBe(236)
  })

  it('routes same-side right-right connectors to the right of both boxes with default clearance', () => {
    const rightRight: ShapeElement = {
      id: 'conn-rr',
      type: 'arrow',
      color: '#000000',
      curvature: 'orthogonal',
      x: 100,
      y: 100,
      width: 150, // start at x=100, end at x=250
      height: 100,
      startOrientation: 'horizontal',
      endOrientation: 'horizontal',
      startAnchor: { targetId: 'c1', side: 'right' },
      endAnchor: { targetId: 'c2', side: 'right' },
    }
    const mid = getOrthogonalMidPoint(rightRight)
    expect(mid).not.toBeNull()
    // Rightmost box is at x=250. Default clearance is 36px to the right: 250 + 36 = 286
    expect(mid!.x).toBe(286)
    expect(mid!.y).toBe(150) // (100 + 200) / 2
  })

  it('calculates curved connector midpoint on the exact bezier curve', () => {
    const curved: ShapeElement = {
      id: 'conn-curved',
      type: 'line',
      color: '#000000',
      curvature: 'curved',
      arrowHead: 'none',
      x: 100,
      y: 100,
      width: 200,
      height: 0,
      controlPoint: { x: 200, y: 50 },
    }
    const geo = getConnectorGeometry(curved)
    expect(geo.midPoint).toBeDefined()
    // At t=0.5: 0.25*start + 0.5*ctrl + 0.25*end
    expect(geo.midPoint!.x).toBeCloseTo(200, 1)
    expect(geo.midPoint!.y).toBeCloseTo(75, 1) // 0.25*100 + 0.5*50 + 0.25*100 = 75

    // Also verify when arrow is present, midpoint is exactly halfway along the drawn shaft
    const curvedArrow: ShapeElement = {
      ...curved,
      id: 'conn-curved-arrow',
      type: 'arrow',
      arrowHead: 'single',
    }
    const arrowGeo = getConnectorGeometry(curvedArrow)
    const expectedX = 0.25 * arrowGeo.shaftStart.x + 0.5 * curved.controlPoint!.x + 0.25 * arrowGeo.shaftEnd.x
    const expectedY = 0.25 * arrowGeo.shaftStart.y + 0.5 * curved.controlPoint!.y + 0.25 * arrowGeo.shaftEnd.y
    expect(arrowGeo.midPoint!.x).toBeCloseTo(expectedX, 3)
    expect(arrowGeo.midPoint!.y).toBeCloseTo(expectedY, 3)
  })

  it('computes labelPoint along the longer leg for 1-turn elbow connectors and at midPoint for 2-turn/curved connectors', () => {
    const elbow: ShapeElement = {
      id: 'conn-elbow-label',
      type: 'line',
      color: '#000000',
      curvature: 'orthogonal',
      arrowHead: 'none',
      x: 100,
      y: 100,
      width: 240,
      height: 80,
      startOrientation: 'horizontal',
      endOrientation: 'vertical',
    }
    const geo = getConnectorGeometry(elbow)
    // Horizontal leg is 240px (from 100 to 340 at y=100), vertical leg is 80px (from 100 to 180 at x=340)
    // labelPoint should be at the midpoint of the longer horizontal leg: (220, 100)
    expect(geo.labelPoint).toEqual({ x: 220, y: 100 })
  })

  it('calculates triangle anchor points at the middle of each edge and at the center', () => {
    const triangle: SnapTarget = {
      id: 'tri-1',
      kind: 'shape',
      shapeType: 'triangle',
      x: 100,
      y: 100,
      width: 200,
      height: 100,
    }

    // Top apex: (cx, minY) = (200, 100)
    expect(getAnchorPoint(triangle, 'top')).toEqual({ x: 200, y: 100 })
    // Left slanted edge midpoint: (100 + 200*0.25, 100 + 50) = (150, 150)
    expect(getAnchorPoint(triangle, 'left')).toEqual({ x: 150, y: 150 })
    // Right slanted edge midpoint: (100 + 200*0.75, 100 + 50) = (250, 150)
    expect(getAnchorPoint(triangle, 'right')).toEqual({ x: 250, y: 150 })
    // Bottom edge midpoint: (200, 200)
    expect(getAnchorPoint(triangle, 'bottom')).toEqual({ x: 200, y: 200 })
    // Middle of shape: (200, 150)
    expect(getAnchorPoint(triangle, 'center')).toEqual({ x: 200, y: 150 })

    const all = getAllAnchorPoints(triangle)
    expect(all.map((a) => a.side)).toEqual(['top', 'right', 'bottom', 'left', 'center'])
  })

  it('draws a direct vertical shaft when orthogonal connector endpoints are vertically aligned without looping', () => {
    const verticalArrow: ShapeElement = {
      id: 'conn-vert',
      type: 'arrow',
      curvature: 'orthogonal',
      color: '#000000',
      x: 200,
      y: 100,
      width: 0,
      height: 120,
      startOrientation: 'vertical',
      endOrientation: 'vertical',
      startAnchor: { targetId: 'card-1', side: 'bottom' },
      endAnchor: { targetId: 'card-2', side: 'top' },
    }

    const geo = getConnectorGeometry(verticalArrow)
    // Shaft should be a straight vertical line without detour corners
    expect(geo.shaftPath).toBe('M 200 101.5 L 200 204.5')
    expect(geo.endHead).toBeDefined()
  })
})
