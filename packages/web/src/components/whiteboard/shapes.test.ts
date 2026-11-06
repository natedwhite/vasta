import { describe, expect, it } from 'vitest'
import { getConnectorGeometry } from './shapes.ts'
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
})
