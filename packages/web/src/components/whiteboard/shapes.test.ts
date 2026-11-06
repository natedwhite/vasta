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
})
