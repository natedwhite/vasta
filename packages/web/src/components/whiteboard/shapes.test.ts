import { describe, expect, it } from 'vitest'
import { getConnectorGeometry, getOrthogonalMidPoint } from './shapes.ts'
import type { ShapeElement } from './types.ts'

describe('Whiteboard Connector Geometry', () => {
  it('offsets arrow termination to the outer edge when snapped to an object side', () => {
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
    // End anchor is at side 'left', meaning the target is to the right of x2 (300).
    // Outward direction is -x (left), so end tip should be offset outward from 300 to ~296.5.
    expect(geo.endHead).toBeDefined()
    expect(geo.endHead).toContain('M 296.5 100')
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
})
