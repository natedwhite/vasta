// Whiteboard diagram, layout, import, and export helpers for the web app.
import {
  addBoardElements,
  boardToJsonCanvas,
  boardToMermaid,
  computeConnectorEndpoints,
  elementsToWhiteboardData,
  graphToElements,
  jsonCanvasToElements,
  layoutBoardElements,
   newId,
  parseMermaidFlowchart,
  spotAfter,
  syncBoardToWhiteboard,
  whiteboardDataToElements,
  type BoardElement,
  type Direction,
  type Id,
  type ObjectRecord,
  type WbCardMeta,
} from '@vasta/core'
import { getConnectorGeometry, stickyStyle } from '../components/whiteboard/shapes.ts'
import type {
  InkStroke,
  ObjectCardElement,
  Point,
  ShapeElement,
  StickyElement,
  WhiteboardData,
  WhiteboardScene,
} from '../components/whiteboard/types.ts'
import { createObject } from './actions.ts'
import { api } from './api.ts'
import { clone } from './clone.ts'
import { displayTitle } from './format.ts'
import { openText, useReplica } from './replica.ts'
import { primeFromObject, primeSummaries, summaryOf, systemType, typesById, workspace } from './state.ts'

const fold = (text: string) => text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim()

/** Resolve a Vasta object by exact title in the active workspace. */
async function resolveObjectByLabels(labels: string[]): Promise<Map<string, Id>> {
  const found = new Map<string, Id>()
  if (!workspace.space) return found
  const unique = [...new Set(labels.map((l) => l.trim()).filter(Boolean))]
  await Promise.all(
    unique.map(async (label) => {
      try {
        const list = await api.search(workspace.space!.id, label, 10)
        primeSummaries(list)
        const hit = list.find((o) => fold(o.title) === fold(label))
        if (hit) found.set(fold(label), hit.id)
      } catch {
        // ignore search errors
      }
    })
  )
  return found
}

export function cardMetaFromWorkspace(objectId: Id): WbCardMeta | undefined {
  const s = summaryOf(objectId)
  if (!s) return undefined
  const type = typesById.value.get(s.typeId)
  return {
    title: s.title || displayTitle(s, type),
    typeId: s.typeId,
    typeName: type?.name || 'Page',
    ...(type?.color ? { typeColor: type.color } : {}),
    ...(type?.icon?.value ? { typeIcon: type.icon.value } : {}),
  }
}

/**
 * Convert a Mermaid flowchart into elements ready to append to an existing `WhiteboardData` canvas.
 */
export async function mermaidToWhiteboardPatch(
  source: string,
  existingData?: Partial<WhiteboardData>
): Promise<{
  shapes: ShapeElement[]
  cards: ObjectCardElement[]
  scenes: WhiteboardScene[]
}> {
  const graph = parseMermaidFlowchart(source)
  const labelMap = await resolveObjectByLabels(graph.nodes.map((n) => n.label))
  const existingElements = existingData ? whiteboardDataToElements(existingData) : []
  const at = spotAfter(existingElements)

  const newBoardElements = graphToElements(
    graph,
    at,
    newId,
    (label) => labelMap.get(fold(label))
  ) as BoardElement[]

  const converted = elementsToWhiteboardData(newBoardElements, undefined, cardMetaFromWorkspace)
  return {
    shapes: converted.shapes as ShapeElement[],
    cards: converted.cards as ObjectCardElement[],
    scenes: (converted.scenes ?? []) as WhiteboardScene[],
  }
}

/**
 * Create a brand-new Whiteboard object from a Mermaid flowchart (e.g. from a note's Mermaid code block).
 */
export async function boardFromMermaid(source: string, title = 'Diagram'): Promise<ObjectRecord> {
  const boardType = systemType('whiteboard')
  if (!boardType || !workspace.space) throw new Error('This space has no Whiteboard type.')

  const patch = await mermaidToWhiteboardPatch(source)
  const wbData: WhiteboardData = {
    version: 1,
    pan: { x: 80, y: 80 },
    zoom: 1,
    strokes: [],
    shapes: patch.shapes,
    cards: patch.cards,
    stickies: [],
    ...(patch.scenes.length
      ? { scenes: patch.scenes, defaultSceneId: patch.scenes[0]!.id }
      : {}),
  }

  const board = await createObject(
    boardType.id,
    {
      title,
      props: {
        whiteboardData: { kind: 'text', value: JSON.stringify(wbData) },
      },
    },
    false
  )

  if (useReplica()) {
    try {
      const text = await openText(board.id)
      try {
        const elements = whiteboardDataToElements(wbData)
        addBoardElements(text.doc, elements)
        syncBoardToWhiteboard(text.doc, board, cardMetaFromWorkspace)
      } finally {
        text.release()
      }
    } catch {
      // ignore replica sync warning
    }
  }

  primeFromObject(board)
  return board
}

/**
 * Convert a JSON Canvas (`.canvas`) file into elements ready to append to an existing `WhiteboardData` canvas.
 */
export async function jsonCanvasToWhiteboardPatch(
  rawCanvas: string | unknown,
  existingData?: Partial<WhiteboardData>
): Promise<{
  shapes: ShapeElement[]
  cards: ObjectCardElement[]
  stickies: StickyElement[]
  scenes: WhiteboardScene[]
}> {
  const parsed = typeof rawCanvas === 'string' ? JSON.parse(rawCanvas) : rawCanvas
  const existingElements = existingData ? whiteboardDataToElements(existingData) : []
  const at = spotAfter(existingElements)
  const nodes = Array.isArray((parsed as { nodes?: unknown[] })?.nodes)
    ? ((parsed as { nodes: { x?: number; y?: number }[] }).nodes)
    : []
  const minX = nodes.length ? Math.min(0, ...nodes.map((n) => n.x ?? 0)) : 0
  const minY = nodes.length ? Math.min(0, ...nodes.map((n) => n.y ?? 0)) : 0

  const linkedObject = (text: string): Id | undefined => {
    const match = /\/o\/([^/?#)\s]+)/.exec(text)
    return match?.[1] ? decodeURIComponent(match[1]) : undefined
  }

  const newElements = jsonCanvasToElements(parsed, newId, linkedObject, {
    x: at.x - minX,
    y: at.y - minY,
  }) as BoardElement[]

  const cardIds = newElements.filter((e): e is Extract<BoardElement, { kind: 'card' }> => e.kind === 'card').map((e) => e.objectId)
  if (cardIds.length) {
    try {
      const list = await api.summaries(cardIds)
      primeSummaries(list)
    } catch {
      // ignore
    }
  }

  const converted = elementsToWhiteboardData(newElements, undefined, cardMetaFromWorkspace)
  return {
    shapes: converted.shapes as ShapeElement[],
    cards: converted.cards as ObjectCardElement[],
    stickies: converted.stickies as StickyElement[],
    scenes: (converted.scenes ?? []) as WhiteboardScene[],
  }
}

/**
 * Auto-layout an existing `WhiteboardData` in the given direction (`down`, `right`, `up`, `left`, or `grid`),
 * updating node positions, refitting scenes, and snapping all anchored connectors cleanly.
 */
export function autoLayoutWhiteboardData(
  data: WhiteboardData,
  direction: Direction | 'grid' = 'down'
): WhiteboardData {
  const next = clone(data)
  const elements = whiteboardDataToElements(next)
  const patches = layoutBoardElements(elements, direction)

  const boxById = new Map<string, { x: number; y: number; w: number; h: number; shape?: string }>()

  for (const card of next.cards) {
    const p = patches[card.id]
    if (p) {
      card.x = p.x
      card.y = p.y
    }
    boxById.set(card.id, { x: card.x, y: card.y, w: card.width, h: card.height })
  }

  for (const sticky of next.stickies) {
    const p = patches[sticky.id]
    if (p) {
      sticky.x = p.x
      sticky.y = p.y
    }
    boxById.set(sticky.id, { x: sticky.x, y: sticky.y, w: sticky.width, h: sticky.height })
  }

  for (const shape of next.shapes) {
    if (shape.type === 'arrow' || shape.type === 'line') continue
    const p = patches[shape.id]
    if (p) {
      shape.x = p.x
      shape.y = p.y
      shape.width = Math.abs(shape.width)
      shape.height = Math.abs(shape.height)
    }
    boxById.set(shape.id, {
      x: Math.min(shape.x, shape.x + shape.width),
      y: Math.min(shape.y, shape.y + shape.height),
      w: Math.abs(shape.width),
      h: Math.abs(shape.height),
      shape: shape.type,
    })
  }

  for (const scene of next.scenes ?? []) {
    const p = patches[scene.id]
    if (p) {
      scene.rect.x = p.x
      scene.rect.y = p.y
      if (p.w !== undefined) scene.rect.w = p.w
      if (p.h !== undefined) scene.rect.h = p.h
    }
  }

  // Re-snap all anchored connectors to optimal sides and boundary points
  for (const shape of next.shapes) {
    if (shape.type !== 'arrow' && shape.type !== 'line') continue
    const fromId = shape.startAnchor?.targetId || shape.startAnchor?.cardId
    const toId = shape.endAnchor?.targetId || shape.endAnchor?.cardId
    if (!fromId || !toId) continue
    const fromBox = boxById.get(fromId)
    const toBox = boxById.get(toId)
    if (!fromBox || !toBox) continue

    const { startSide, endSide, startPt, endPt, startOrientation, endOrientation } = computeConnectorEndpoints(fromBox, toBox)
    shape.x = startPt.x
    shape.y = startPt.y
    shape.width = endPt.x - startPt.x
    shape.height = endPt.y - startPt.y
    if (shape.startAnchor) shape.startAnchor.side = startSide
    if (shape.endAnchor) shape.endAnchor.side = endSide
    shape.startOrientation = startOrientation
    shape.endOrientation = endOrientation
    shape.midOffset = undefined
    shape.controlPoint = undefined
  }

  return next
}

function resolveRelationLabel(shape: ShapeElement, cards: ObjectCardElement[]): string | null {
  if (!shape.relation) return null
  const ownerId = shape.relation.ownerObjectId
  const card = cards.find((c) => c.objectId === ownerId)
  const summary = summaryOf(ownerId)
  const typeId = card?.typeId || summary?.typeId
  const ownerType = typeId ? typesById.value.get(typeId) : undefined
  const prop = ownerType?.properties.find((p) => p.id === shape.relation!.propertyId)
  if (!prop) return null
  return prop.name
}

function elementsWithResolvedRelations(data: WhiteboardData): BoardElement[] {
  const shapeById = new Map(data.shapes.map((s) => [s.id, s]))
  return whiteboardDataToElements(data).map((e) => {
    if (e.kind !== 'arrow') return e
    const shape = shapeById.get(e.id)
    const relLabel = shape ? resolveRelationLabel(shape, data.cards) : null
    const label = e.label || relLabel || undefined
    return {
      ...e,
      ...(relLabel ? { relation: relLabel } : {}),
      ...(label ? { label } : {}),
    }
  })
}

/** Export `WhiteboardData` to JSON Canvas 1.0 (`.canvas`). */
export function exportWhiteboardToJsonCanvas(data: WhiteboardData): string {
  const elements = elementsWithResolvedRelations(data)
  const canvas = boardToJsonCanvas(elements, (id) => {
    const card = data.cards.find((c) => c.objectId === id)
    const s = summaryOf(id)
    const title = card?.title || s?.title || id
    return { title, url: `${window.location.origin}/o/${id}` }
  })
  return JSON.stringify(canvas, null, 2)
}

/** Export `WhiteboardData` to a Mermaid `flowchart` diagram string. */
export function exportWhiteboardToMermaid(data: WhiteboardData, direction?: Direction): string {
  const elements = elementsWithResolvedRelations(data)
  return boardToMermaid(
    elements,
    (id) => data.cards.find((c) => c.objectId === id)?.title || summaryOf(id)?.title || id,
    direction
  )
}

const escapeXml = (str: string) =>
  str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')

function normBox(s: { x: number; y: number; width: number; height: number }) {
  return {
    x: Math.min(s.x, s.x + s.width),
    y: Math.min(s.y, s.y + s.height),
    w: Math.abs(s.width),
    h: Math.abs(s.height),
  }
}

function getStrokePath(points: Point[]): string {
  if (!points.length) return ''
  if (points.length === 1) {
    const p = points[0]!
    return `M ${p.x} ${p.y} L ${p.x + 0.1} ${p.y + 0.1}`
  }
  let d = `M ${points[0]!.x} ${points[0]!.y}`
  for (let i = 1; i < points.length - 1; i++) {
    const p = points[i]!
    const next = points[i + 1]!
    const mx = (p.x + next.x) / 2
    const my = (p.y + next.y) / 2
    d += ` Q ${p.x} ${p.y} ${mx} ${my}`
  }
  const last = points[points.length - 1]!
  d += ` L ${last.x} ${last.y}`
  return d
}

/** Compute bounding box of all visible items on a `WhiteboardData` canvas. */
export function computeWhiteboardBounds(data: Partial<WhiteboardData>): { x: number; y: number; w: number; h: number } {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity

  const addBox = (x: number, y: number, w: number, h: number) => {
    minX = Math.min(minX, x)
    minY = Math.min(minY, y)
    maxX = Math.max(maxX, x + w)
    maxY = Math.max(maxY, y + h)
  }

  for (const s of data.scenes ?? []) addBox(s.rect.x, s.rect.y, s.rect.w, s.rect.h)
  for (const c of data.cards ?? []) addBox(c.x, c.y, c.width || 260, c.height || 130)
  for (const st of data.stickies ?? []) addBox(st.x, st.y, st.width || 180, st.height || 180)
  for (const sh of data.shapes ?? []) {
    const b = normBox(sh)
    addBox(b.x, b.y, b.w, b.h)
  }
  for (const stroke of data.strokes ?? []) {
    for (const pt of stroke.points ?? []) {
      addBox(pt.x - (stroke.width || 3), pt.y - (stroke.width || 3), (stroke.width || 3) * 2, (stroke.width || 3) * 2)
    }
  }

  if (!Number.isFinite(minX)) return { x: 0, y: 0, w: 800, h: 520 }
  return {
    x: Math.round(minX),
    y: Math.round(minY),
    w: Math.max(200, Math.round(maxX - minX)),
    h: Math.max(150, Math.round(maxY - minY)),
  }
}

/**
 * Render `WhiteboardData` (including freehand ink strokes, curved/orthogonal connectors, object
 * cards, sticky notes, 2D shapes, and scenes) into a standalone vector SVG string.
 */
export function exportWhiteboardToSvg(data: WhiteboardData, padding = 48): string {
  const bounds = computeWhiteboardBounds(data)
  const vx = bounds.x - padding
  const vy = bounds.y - padding
  const vw = bounds.w + padding * 2
  const vh = bounds.h + padding * 2

  const parts: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vx} ${vy} ${vw} ${vh}" width="${vw}" height="${vh}" font-family="Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif">`,
    `  <rect x="${vx}" y="${vy}" width="${vw}" height="${vh}" fill="#f8fafc" />`,
  ]

  // 1. Scenes
  for (const scene of data.scenes ?? []) {
    parts.push(
      `  <g>`,
      `    <rect x="${scene.rect.x}" y="${scene.rect.y}" width="${scene.rect.w}" height="${scene.rect.h}" rx="14" fill="#ffffff" fill-opacity="0.6" stroke="#94a3b8" stroke-width="1.5" stroke-dasharray="6 4" />`,
      `    <text x="${scene.rect.x + 14}" y="${scene.rect.y + 24}" font-size="12" font-weight="600" fill="#475569">${escapeXml(scene.name || 'Scene')}</text>`,
      `  </g>`
    )
  }

  // 2. Connectors (1D lines & arrows - rendered underneath shapes, stickies, and cards)
  const labelOverlayParts: string[] = []
  const dotOverlayParts: string[] = []
  for (const s of data.shapes) {
    if (s.type !== 'line' && s.type !== 'arrow') continue
    const geom = getConnectorGeometry(s)
    const stroke = s.color || '#64748b'
    const sw = s.strokeWidth ?? 2.5
    const dash = s.strokeStyle === 'dashed' ? ' stroke-dasharray="8 6"' : s.strokeStyle === 'dotted' ? ' stroke-dasharray="3 5"' : ''

    parts.push(`  <g>`)
    parts.push(
      `    <path d="${geom.shaftPath}" fill="none" stroke="${stroke}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round"${dash} />`
    )
    if (geom.startHead && geom.startHeadType !== 'dot') {
      parts.push(`    <path d="${geom.startHead}" fill="${stroke}" />`)
    }
    if (geom.endHead && geom.endHeadType !== 'dot') {
      parts.push(`    <path d="${geom.endHead}" fill="${stroke}" />`)
    }
    parts.push(`  </g>`)

    if (geom.startDot) {
      dotOverlayParts.push(`  <path d="${geom.startDot}" fill="${stroke}" />`)
    }
    if (geom.endDot) {
      dotOverlayParts.push(`  <path d="${geom.endDot}" fill="${stroke}" />`)
    }

    const labelText = s.text?.trim() || resolveRelationLabel(s, data.cards)
    if (labelText) {
      const tw = Math.max(40, labelText.length * 7 + 16)
      labelOverlayParts.push(
        `  <g>`,
        `    <rect x="${geom.labelPoint.x - tw / 2}" y="${geom.labelPoint.y - 11}" width="${tw}" height="22" rx="6" fill="#ffffff" stroke="${stroke}" stroke-width="1.2" />`,
        `    <text x="${geom.labelPoint.x}" y="${geom.labelPoint.y + 4}" text-anchor="middle" font-size="11" font-weight="600" fill="#1e293b">${escapeXml(labelText)}</text>`,
        `  </g>`
      )
    }
  }

  // 3. Unified canvas objects sorted by z-index (2D shapes, stickies, cards, ink strokes)
  type ExportCanvasObject =
    | { kind: 'shape'; item: ShapeElement; zIndex: number }
    | { kind: 'sticky'; item: StickyElement; zIndex: number }
    | { kind: 'card'; item: ObjectCardElement; zIndex: number }
    | { kind: 'stroke'; item: InkStroke; zIndex: number }

  const unifiedObjects: ExportCanvasObject[] = [
    ...data.shapes.filter((s) => s.type !== 'line' && s.type !== 'arrow').map((s) => ({ kind: 'shape' as const, item: s, zIndex: Math.max(s.zIndex ?? 100, 100) })),
    ...data.stickies.map((st) => ({ kind: 'sticky' as const, item: st, zIndex: Math.max(st.zIndex ?? 100, 100) })),
    ...data.cards.map((c) => ({ kind: 'card' as const, item: c, zIndex: Math.max(c.zIndex ?? 100, 100) })),
    ...data.strokes.map((str) => ({ kind: 'stroke' as const, item: str, zIndex: Math.max(str.zIndex ?? 100, 100) })),
  ].sort((a, b) => a.zIndex - b.zIndex)

  for (const obj of unifiedObjects) {
    if (obj.kind === 'shape') {
      const s = obj.item
      const b = normBox(s)
      const cx = b.x + b.w / 2
      const cy = b.y + b.h / 2
      const stroke = s.color || '#3b82f6'
      const fill =
        s.fill === 'none'
          ? 'none'
          : s.fill === 'white'
            ? '#ffffff'
            : s.fill === 'solid'
              ? s.fillColor || stroke
              : s.fillColor
                ? `${s.fillColor}28`
                : `${stroke}1a`
      const dash = s.strokeStyle === 'dashed' ? ' stroke-dasharray="8 6"' : s.strokeStyle === 'dotted' ? ' stroke-dasharray="3 5"' : ''
      const sw = s.strokeWidth ?? 2.5

      let baseGeom = `<rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" rx="10" fill="#ffffff" stroke="none" />`
      let geom = `<rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" rx="10" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"${dash} />`
      if (s.type === 'ellipse') {
        baseGeom = `<ellipse cx="${cx}" cy="${cy}" rx="${b.w / 2}" ry="${b.h / 2}" fill="#ffffff" stroke="none" />`
        geom = `<ellipse cx="${cx}" cy="${cy}" rx="${b.w / 2}" ry="${b.h / 2}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"${dash} />`
      } else if (s.type === 'diamond') {
        baseGeom = `<polygon points="${cx},${b.y} ${b.x + b.w},${cy} ${cx},${b.y + b.h} ${b.x},${cy}" fill="#ffffff" stroke="none" />`
        geom = `<polygon points="${cx},${b.y} ${b.x + b.w},${cy} ${cx},${b.y + b.h} ${b.x},${cy}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" stroke-linejoin="round"${dash} />`
      } else if (s.type === 'triangle') {
        baseGeom = `<polygon points="${cx},${b.y} ${b.x + b.w},${b.y + b.h} ${b.x},${b.y + b.h}" fill="#ffffff" stroke="none" />`
        geom = `<polygon points="${cx},${b.y} ${b.x + b.w},${b.y + b.h} ${b.x},${b.y + b.h}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" stroke-linejoin="round"${dash} />`
      }

      parts.push(`  <g>`)
      parts.push(`    ${baseGeom}`)
      parts.push(`    ${geom}`)
      if (s.text?.trim()) {
        const textFill = s.fill === 'solid' && !s.fillColor ? '#ffffff' : '#0f172a'
        const lines = s.text.trim().split(/\r?\n/)
        const startY = cy - ((lines.length - 1) * 18) / 2 + 5
        lines.forEach((line, idx) => {
          parts.push(
            `    <text x="${cx}" y="${startY + idx * 18}" text-anchor="middle" font-size="14" font-weight="600" fill="${textFill}">${escapeXml(line)}</text>`
          )
        })
      }
      parts.push(`  </g>`)
    } else if (obj.kind === 'sticky') {
      const st = obj.item
      const pal = stickyStyle(st.color)
      parts.push(`  <g>`)
      parts.push(
        `    <rect x="${st.x}" y="${st.y}" width="${st.width}" height="${st.height}" rx="12" fill="${pal.bg}" stroke="${pal.border}" stroke-width="1.5" />`
      )
      if (st.text?.trim()) {
        const lines = st.text.trim().split(/\r?\n/)
        lines.slice(0, 7).forEach((line, idx) => {
          parts.push(
            `    <text x="${st.x + 16}" y="${st.y + 30 + idx * 19}" font-size="13" font-weight="500" fill="${st.textColor || pal.text}">${escapeXml(line.slice(0, 36))}</text>`
          )
        })
      }
      parts.push(`  </g>`)
    } else if (obj.kind === 'card') {
      const c = obj.item
      const typeLabel = c.typeName || 'Page'
      const title = c.title || 'Untitled'
      const pillW = Math.min(c.width - 28, Math.max(48, typeLabel.length * 7 + 18))
      parts.push(
        `  <g>`,
        `    <rect x="${c.x}" y="${c.y}" width="${c.width}" height="${c.height}" rx="12" fill="#ffffff" stroke="#cbd5e1" stroke-width="1.5" />`,
        `    <rect x="${c.x + 14}" y="${c.y + 14}" width="${pillW}" height="20" rx="6" fill="#eff6ff" />`,
        `    <text x="${c.x + 22}" y="${c.y + 28}" font-size="10" font-weight="600" fill="#2563eb">${escapeXml(typeLabel)}</text>`,
        `    <text x="${c.x + 14}" y="${c.y + 56}" font-size="14" font-weight="600" fill="#0f172a">${escapeXml(title.length > 34 ? `${title.slice(0, 33)}…` : title)}</text>`,
        `  </g>`
      )
    } else if (obj.kind === 'stroke') {
      const stroke = obj.item
      if (!stroke.points?.length) continue
      const d = getStrokePath(stroke.points)
      const isHighlighter = stroke.penType === 'highlighter' || stroke.style === 'marker'
      const sw = isHighlighter ? stroke.width * 2.6 : stroke.width
      const opacity = isHighlighter ? ' opacity="0.35"' : ''
      const dash =
        stroke.style === 'dashed'
          ? ` stroke-dasharray="${stroke.width * 2.5} ${stroke.width * 1.8}"`
          : stroke.style === 'dotted'
            ? ` stroke-dasharray="1 ${stroke.width * 2}"`
            : ''
      parts.push(
        `  <path d="${d}" fill="none" stroke="${stroke.color || '#1e293b'}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round"${opacity}${dash} />`
      )
    }
  }

  parts.push(...dotOverlayParts)
  parts.push(...labelOverlayParts)

  parts.push(`</svg>`)
  return parts.join('\n')
}

/**
 * Render `WhiteboardData` to a high-DPI PNG `Blob`.
 */
export async function exportWhiteboardToPng(data: WhiteboardData, scale = 2): Promise<Blob> {
  const svgString = exportWhiteboardToSvg(data, 48)
  const bounds = computeWhiteboardBounds(data)
  const width = bounds.w + 96
  const height = bounds.h + 96

  const svgBlob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' })
  const url = URL.createObjectURL(svgBlob)
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image()
      image.onload = () => resolve(image)
      image.onerror = () => reject(new Error('Failed to render whiteboard SVG to image'))
      image.src = url
    })
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(width * scale)
    canvas.height = Math.round(height * scale)
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas 2D context unavailable')
    ctx.scale(scale, scale)
    ctx.drawImage(img, 0, 0, width, height)
    const pngBlob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Failed to encode PNG'))), 'image/png')
    })
    return pngBlob
  } finally {
    URL.revokeObjectURL(url)
  }
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function downloadTextFile(content: string, filename: string, mimeType = 'text/plain;charset=utf-8') {
  downloadBlob(new Blob([content], { type: mimeType }), filename)
}
