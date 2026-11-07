// Whiteboards: a board is an object whose elements (object cards, text, shapes, sticky notes,
// pen strokes, frames, arrows) live in its Y.Doc,
// in the map BOARD_FIELD, one entry per element id, each a Y.Map of its fields. Two devices moving
// different elements, or changing different fields of one, both keep their change, offline too;
// the same field resolves as Yjs does. Stacking order is a rank key per element (rank.ts), so
// bringing one to the front writes only that one.
//
// The object's `content[BOARD_FIELD]` is derived from the map (boardContent): the board as blocks,
// cards as object embeds and text as paragraphs, so search, backlinks and agents read a board as
// they read a page.
import { BOARD_FIELD, Y, normalizeDoc, readContent, type JsonDoc } from '@vasta/editor-schema/yjs'
import { newId } from './ids.ts'
import type { ColorName, Doc, DocNode, Id, ObjectRecord } from './model.ts'
import { rankBetween } from './rank.ts'
import { COLOR_NAMES } from './tags.ts'
import { textToBlocks } from './text-doc.ts'

export { BOARD_FIELD }

interface Placed {
  id: Id
  /** Stacking order: higher ranks are drawn on top (frames are always drawn under the rest). */
  rank: string
  x: number
  y: number
  w: number
  h: number
  /** Left out: the kind's own color (ink, a yellow note). */
  color?: ColorName
}

export const CARD_VIEWS = ['card', 'compact', 'embed'] as const
/** How a card shows its object: the card (default), one line, or what it holds (a query's live results, a page's text, a picture). */
export type CardView = (typeof CARD_VIEWS)[number]

/** An object of the space, drawn as its card. */
export interface CardElement extends Placed {
  kind: 'card'
  objectId: Id
  view?: CardView
}

/** Free text that lives only on the board. */
export interface TextElement extends Placed {
  kind: 'text'
  text: string
}

export const SHAPES = ['rectangle', 'ellipse', 'diamond', 'triangle', 'parallelogram', 'star', 'heart'] as const
export type ShapeName = (typeof SHAPES)[number]

/** A shape that can hold text, centered in it. */
export interface ShapeElement extends Placed {
  kind: 'shape'
  shape: ShapeName
  text: string
}

/** A sticky note: a colored square of text. */
export interface StickyElement extends Placed {
  kind: 'sticky'
  text: string
}

/**
 * A pen stroke. `points` are x, y and pressure (0–1) in turn, relative to the element's corner,
 * already simplified; `size` is the pen's width in board units. Resizing scales the points with
 * the box (the stored points fill `w` × `h` as they were drawn: `sw`, `sh`).
 */
export interface StrokeElement extends Placed {
  kind: 'stroke'
  points: number[]
  size: number
  /** The box the points were drawn in, so a resized stroke scales them. */
  sw: number
  sh: number
  /** A highlighter: drawn wide and see-through. */
  highlight?: boolean
  /**
   * Drawn on another element (a card, a frame…): then `x`, `y`, `w` and `h` are fractions of that
   * element's box, so the stroke moves and scales with it, and goes when it goes.
   */
  parent?: Id
}

/** A named region; moving it moves what lies inside. */
export interface FrameElement extends Placed {
  kind: 'frame'
  title?: string
}

/** A line from one element to another, drawn from edge to edge; the label is optional. */
export interface ArrowElement {
  id: Id
  rank: string
  kind: 'arrow'
  from: Id
  to: Id
  label?: string
  color?: ColorName
  /**
   * Between two cards: the relation property (of the "from" card's object) that this arrow wrote
   * the "to" card's object into, so the link shows in backlinks and queries too.
   */
  relation?: string
  /** Its course: straight (default), a curve, or right angles. */
  path?: ArrowPath
  /** Which ends have a head: the end (default), both, or none (a plain line). */
  heads?: ArrowHeads
  dashed?: boolean
  /** Between two cards: the "to" object was mentioned in the "from" object's text. */
  mentioned?: boolean
}

export const ARROW_PATHS = ['straight', 'curved', 'elbow'] as const
export type ArrowPath = (typeof ARROW_PATHS)[number]
export const ARROW_HEADS = ['end', 'both', 'none'] as const
export type ArrowHeads = (typeof ARROW_HEADS)[number]

export type PlacedElement = CardElement | TextElement | ShapeElement | StickyElement | StrokeElement | FrameElement
export type BoardElement = PlacedElement | ArrowElement

type Distribute<T> = T extends unknown ? Omit<T, 'id' | 'rank'> & { id?: Id } : never
/** An element to add: its id is made when missing, its rank puts it on top. */
export type NewBoardElement = Distribute<BoardElement>

type UnionKeys<T> = T extends unknown ? keyof T : never
type FieldOf<K extends PropertyKey> = BoardElement extends infer E ? (E extends Record<K, infer V> ? V : E extends Partial<Record<K, infer V>> ? V : never) : never
/** What may change in an element (its kind and id never do); undefined removes an optional field. */
export type BoardPatch = { [K in Exclude<UnionKeys<BoardElement>, 'id' | 'kind'>]?: FieldOf<K> | undefined }

type Shape = 'number' | 'string' | 'optional-string' | 'optional-boolean' | 'numbers'
const PLACED: Record<string, Shape> = { rank: 'string', x: 'number', y: 'number', w: 'number', h: 'number', color: 'optional-string' }
const FIELDS: Record<BoardElement['kind'], Record<string, Shape>> = {
  card: { ...PLACED, objectId: 'string', view: 'optional-string' },
  text: { ...PLACED, text: 'string' },
  shape: { ...PLACED, shape: 'string', text: 'string' },
  sticky: { ...PLACED, text: 'string' },
  stroke: { ...PLACED, points: 'numbers', size: 'number', sw: 'number', sh: 'number', highlight: 'optional-boolean', parent: 'optional-string' },
  frame: { ...PLACED, title: 'optional-string' },
  arrow: { rank: 'string', from: 'string', to: 'string', label: 'optional-string', color: 'optional-string', relation: 'optional-string', path: 'optional-string', heads: 'optional-string', dashed: 'optional-boolean', mentioned: 'optional-boolean' },
}

const fits = (shape: Shape, value: unknown) => {
  if (shape === 'number') return typeof value === 'number' && Number.isFinite(value)
  if (shape === 'string') return typeof value === 'string'
  if (shape === 'optional-string') return value === undefined || typeof value === 'string'
  if (shape === 'optional-boolean') return value === undefined || typeof value === 'boolean'
  return Array.isArray(value) && value.every((n) => typeof n === 'number' && Number.isFinite(n))
}

export const isPlaced = (element: BoardElement): element is PlacedElement => element.kind !== 'arrow'

const boardMap = (ydoc: Y.Doc) => ydoc.getMap<Y.Map<unknown>>(BOARD_FIELD)

/** Whether a Y.Doc holds a board (either in BOARD_FIELD or wb_elements). */
export const hasBoard = (ydoc: Y.Doc) =>
  ydoc.share.has(BOARD_FIELD) || (ydoc.share.has('wb_elements') && ydoc.getMap('wb_elements').size > 0)

/** One element from its Y.Map; undefined when a field is missing or has the wrong shape (a newer device's kind). */
function readElement(id: Id, entry: unknown): BoardElement | undefined {
  if (!(entry instanceof Y.Map)) return undefined
  const kind = entry.get('kind')
  const fields = FIELDS[kind as BoardElement['kind']]
  if (!fields) return undefined
  const element: Record<string, unknown> = { id, kind }
  for (const [name, shape] of Object.entries(fields)) {
    const value = entry.get(name)
    if (!fits(shape, value)) return undefined
    if (value !== undefined) element[name] = value
  }
  if (element.kind === 'shape' && !SHAPES.includes(element.shape as ShapeName)) element.shape = 'rectangle'
  if (element.kind === 'arrow' && element.path !== undefined && !ARROW_PATHS.includes(element.path as ArrowPath)) delete element.path
  if (element.kind === 'arrow' && element.heads !== undefined && !ARROW_HEADS.includes(element.heads as ArrowHeads)) delete element.heads
  if (element.kind === 'card' && element.view !== undefined && !CARD_VIEWS.includes(element.view as CardView)) delete element.view
  return element as unknown as BoardElement
}

const byRank = (a: BoardElement, b: BoardElement) => (a.rank < b.rank ? -1 : a.rank > b.rank ? 1 : a.id < b.id ? -1 : 1)

function filterAndSortElements(elements: BoardElement[]): BoardElement[] {
  // A stroke drawn on an element needs it (and the element must not be a stroke itself).
  const holders = new Set(elements.filter((e) => isPlaced(e) && e.kind !== 'stroke').map((e) => e.id))
  const kept = elements.filter((e) => e.kind !== 'stroke' || !e.parent || holders.has(e.parent))
  const placed = new Set(kept.filter(isPlaced).map((e) => e.id))
  return kept
    .filter((e) => e.kind !== 'arrow' || (placed.has(e.from) && placed.has(e.to) && e.from !== e.to))
    .sort((a, b) => Number(b.kind === 'frame') - Number(a.kind === 'frame') || byRank(a, b))
}

/**
 * The elements of a board, bottom to top. Arrows whose ends are gone (an element deleted on
 * another device while the arrow was drawn) are left out.
 * Reads from `BOARD_FIELD` or from the interactive canvas representation (`wb_elements` / `object.props.whiteboardData`).
 */
export function readBoard(ydoc: Y.Doc, object?: ObjectRecord): BoardElement[] {
  const wbMeta = ydoc.share.has('wb_meta') ? ydoc.getMap<unknown>('wb_meta') : undefined
  const wbElems = ydoc.share.has('wb_elements') ? ydoc.getMap<unknown>('wb_elements') : undefined
  const fromProp = parseWhiteboardProp(object)
  const uiModified =
    (fromProp !== undefined && !fromProp.aiSynced) ||
    (wbElems && wbElems.size > 0 && wbMeta?.get('updatedByUi') !== false)

  if (uiModified) {
    const source = fromProp ?? readWbDataFromYDoc(ydoc)
    return filterAndSortElements(whiteboardDataToElements(source))
  }

  if (ydoc.share.has(BOARD_FIELD) && boardMap(ydoc).size > 0) {
    const elements: BoardElement[] = []
    for (const [id, entry] of boardMap(ydoc)) {
      const element = readElement(id, entry)
      if (element) elements.push(element)
    }
    return filterAndSortElements(elements)
  }

  if (wbElems && wbElems.size > 0) {
    return filterAndSortElements(whiteboardDataToElements(readWbDataFromYDoc(ydoc)))
  }

  if (fromProp) {
    return filterAndSortElements(whiteboardDataToElements(fromProp))
  }

  return []
}

const topRank = (ydoc: Y.Doc) => {
  let top: string | undefined
  for (const entry of boardMap(ydoc).values()) {
    const rank = entry instanceof Y.Map ? entry.get('rank') : undefined
    if (typeof rank === 'string' && (top === undefined || rank > top)) top = rank
  }
  return top
}

/** Add elements on top of the board, in the order given; returns their ids. */
export function addBoardElements(ydoc: Y.Doc, elements: NewBoardElement[], origin?: unknown): Id[] {
  const ids: Id[] = []
  ydoc.transact(() => {
    const map = boardMap(ydoc)
    let rank = topRank(ydoc)
    for (const { id = newId(), ...fields } of elements) {
      const entry = new Y.Map<unknown>()
      rank = rankBetween(rank)
      for (const [name, value] of Object.entries({ ...fields, rank })) if (value !== undefined) entry.set(name, value)
      map.set(id, entry)
      ids.push(id)
    }
  }, origin)
  return ids
}

/** Change fields of elements, writing only the ones that differ (so a move does not touch the text). */
export function updateBoardElements(ydoc: Y.Doc, patches: Record<Id, BoardPatch>, origin?: unknown) {
  ydoc.transact(() => {
    const map = boardMap(ydoc)
    for (const [id, patch] of Object.entries(patches)) {
      const entry = map.get(id)
      if (!(entry instanceof Y.Map)) continue
      for (const [name, value] of Object.entries(patch)) {
        if (name === 'id' || name === 'kind') continue
        if (value === undefined) entry.delete(name)
        else if (entry.get(name) !== value) entry.set(name, value)
      }
    }
  }, origin)
}

/** Delete elements, the arrows that start or end at them and the strokes drawn on them. */
export function removeBoardElements(ydoc: Y.Doc, ids: Id[], origin?: unknown) {
  const gone = new Set(ids)
  ydoc.transact(() => {
    const map = boardMap(ydoc)
    for (const [id, entry] of map) {
      const field = (name: string) => (entry instanceof Y.Map ? (entry.get(name) as Id | undefined) : undefined)
      if (gone.has(id) || [field('from'), field('to'), field('parent')].some((other) => other !== undefined && gone.has(other))) map.delete(id)
    }
  }, origin)
}

/** Whether an element is a stroke drawn on another element (its box is in fractions of that one's). */
export const isAttached = (element: BoardElement): element is StrokeElement & { parent: Id } => element.kind === 'stroke' && !!element.parent

/** The strokes drawn on an element. */
export const attachedTo = (id: Id, elements: BoardElement[]) => elements.filter((e): e is StrokeElement => e.kind === 'stroke' && e.parent === id)

/** Put elements under all others, keeping their order among themselves. */
export function sendToBack(ydoc: Y.Doc, ids: Id[], origin?: unknown) {
  const all = readBoard(ydoc)
  const elements = all.filter((e) => ids.includes(e.id))
  let bottom = all.find((e) => !ids.includes(e.id))?.rank
  ydoc.transact(() => {
    const patches: Record<Id, BoardPatch> = {}
    for (const element of [...elements].reverse()) patches[element.id] = { rank: (bottom = rankBetween(undefined, bottom)) }
    updateBoardElements(ydoc, patches)
  }, origin)
}

/**
 * Copies of elements, for pasting or duplicating: new ids, moved by (dx, dy). Arrows come along
 * only when both their ends do, strokes drawn on an element only with it (they keep their place
 * on it).
 */
export function copyElements(elements: BoardElement[], dx: number, dy: number, makeId: () => Id = newId): (NewBoardElement & { id: Id })[] {
  const ids = new Map(elements.map((e) => [e.id, makeId()]))
  const copies: (NewBoardElement & { id: Id })[] = []
  for (const { id, rank: _rank, ...element } of elements) {
    if (element.kind === 'arrow') {
      const from = ids.get(element.from)
      const to = ids.get(element.to)
      if (from && to) copies.push({ ...element, id: ids.get(id)!, from, to })
    } else if (element.kind === 'stroke' && element.parent) {
      const parent = ids.get(element.parent)
      if (parent) copies.push({ ...element, id: ids.get(id)!, parent, points: [...element.points] })
    } else copies.push({ ...element, id: ids.get(id)!, x: element.x + dx, y: element.y + dy, ...(element.kind === 'stroke' ? { points: [...element.points] } : {}) })
  }
  return copies
}

/** Elements whose box lies wholly inside a frame's (what moves with it). */
export function insideFrame(frame: FrameElement, elements: BoardElement[]): PlacedElement[] {
  return elements.filter(
    (e): e is PlacedElement => isPlaced(e) && !isAttached(e) && e.id !== frame.id && e.x >= frame.x && e.y >= frame.y && e.x + e.w <= frame.x + frame.w && e.y + e.h <= frame.y + frame.h
  )
}

/** Put elements above all others, keeping their order among themselves. */
export function bringToFront(ydoc: Y.Doc, ids: Id[], origin?: unknown) {
  const elements = readBoard(ydoc).filter((e) => ids.includes(e.id))
  ydoc.transact(() => {
    let rank = topRank(ydoc)
    const patches: Record<Id, BoardPatch> = {}
    for (const element of elements) patches[element.id] = { rank: (rank = rankBetween(rank)) }
    updateBoardElements(ydoc, patches)
  }, origin)
}

/** Reading order of placed elements: top to bottom, then left to right (rows of half a card). */
function readingOrder(elements: PlacedElement[]): PlacedElement[] {
  const row = (e: PlacedElement) => Math.round(e.y / 60)
  return [...elements].sort((a, b) => row(a) - row(b) || a.x - b.x || (a.id < b.id ? -1 : 1))
}

/**
 * The board as blocks, in reading order: each frame's title as a heading followed by what is in
 * it, then what is outside frames; cards as object embeds, text of text, shapes and notes as
 * paragraphs (strokes have none), arrow labels last.
 */
export function boardContent(elements: BoardElement[]): Doc | undefined {
  const content: DocNode[] = []
  const placed = elements.filter(isPlaced)
  const frames = readingOrder(placed.filter((e) => e.kind === 'frame'))
  const listed = new Set<Id>()
  const blocks = (list: PlacedElement[]) => {
    for (const element of readingOrder(list)) {
      if (listed.has(element.id) || element.kind === 'frame' || element.kind === 'stroke') continue
      listed.add(element.id)
      if (element.kind === 'card') content.push({ type: 'objectEmbed', attrs: { objectId: element.objectId, display: 'card', blockId: null } })
      else content.push(...textToBlocks(element.text))
    }
  }
  for (const frame of frames) {
    if (frame.kind !== 'frame') continue
    if (frame.title?.trim()) content.push({ type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: frame.title.trim() }] })
    blocks(insideFrame(frame, placed))
  }
  blocks(placed)
  for (const element of elements) if (element.kind === 'arrow' && element.label?.trim()) content.push(...textToBlocks(element.label))
  return content.length ? { type: 'doc', content } : undefined
}

/** An object's rich text read from its Y.Doc: the text fields, and a board's blocks when it has one. */
export function contentOfText(ydoc: Y.Doc): ObjectRecord['content'] {
  const content = readContent(ydoc) as ObjectRecord['content']
  const board = hasBoard(ydoc) ? boardContent(readBoard(ydoc)) : undefined
  // As the editor would save it, so comparing it with a stored copy finds no change.
  if (board) content[BOARD_FIELD] = normalizeDoc(board as JsonDoc) as Doc
  return content
}

// Interactive Whiteboard Data Bridge ---------------------------------------------------------------
// Bridges the flat `BoardElement` model (used by MCP agents, CLI, Mermaid, JSON Canvas, and Space
// Export) with the interactive canvas `WhiteboardData` model (`wb_elements`, `wb_meta`, and
// `object.props.whiteboardData`) used by the web app.

export type WbAnchorSide = 'top' | 'bottom' | 'left' | 'right' | 'center'
export type WbAnchorTargetKind = 'card' | 'sticky' | 'shape'

export interface WbConnectorAnchor {
  targetId?: string
  targetKind?: WbAnchorTargetKind
  cardId?: string
  side?: WbAnchorSide
  locked?: boolean
}

export interface WbRelationBinding {
  propertyId: Id
  ownerObjectId: Id
  targetObjectId: Id
  twoWay?: boolean
}

export interface WbPoint {
  x: number
  y: number
  pressure?: number
}

export interface WbInkStroke {
  id: string
  color: string
  width: number
  style?: 'solid' | 'dashed' | 'dotted' | 'marker'
  penType?: 'pen' | 'highlighter'
  points: WbPoint[]
  zIndex?: number
  rotation?: number
}

export interface WbShapeElement {
  id: string
  type: 'rectangle' | 'ellipse' | 'diamond' | 'triangle' | 'line' | 'arrow'
  x: number
  y: number
  width: number
  height: number
  color: string
  fill?: 'none' | 'tint' | 'white' | 'solid' | string
  fillColor?: string
  strokeWidth?: number
  strokeStyle?: 'solid' | 'dashed' | 'dotted' | 'marker'
  curvature?: 'straight' | 'curved' | 'orthogonal'
  arrowHead?: 'single' | 'double' | 'dot' | 'none'
  startHead?: 'none' | 'arrow' | 'dot'
  endHead?: 'none' | 'arrow' | 'dot'
  arrowSize?: 'sm' | 'md' | 'lg'
  controlPoint?: WbPoint
  midOffset?: number
  orientation?: 'horizontal' | 'vertical'
  startOrientation?: 'horizontal' | 'vertical'
  endOrientation?: 'horizontal' | 'vertical'
  text?: string
  startAnchor?: WbConnectorAnchor
  endAnchor?: WbConnectorAnchor
  relation?: WbRelationBinding
  zIndex?: number
  rotation?: number
  /** Preserves whether a 2D shape originated as free board `text` or a specific ShapeName */
  boardKind?: 'text' | 'shape'
  boardShape?: ShapeName
  /** Preserves whether an arrow's path was explicitly set (`straight` | `curved` | `elbow`) vs auto-routed */
  boardPath?: ArrowPath | null
}

export interface WbObjectCardElement {
  id: string
  objectId: Id
  title: string
  typeId: Id
  typeName: string
  typeColor?: string
  typeIcon?: string
  x: number
  y: number
  width: number
  height: number
  zIndex?: number
  rotation?: number
  showContent?: boolean
  contentMode?: 'none' | 'preview' | 'full'
  showProperties?: string[]
}

export interface WbStickyElement {
  id: string
  text: string
  color: string
  fontSize?: 'sm' | 'md' | 'lg' | 'xl'
  textColor?: string
  x: number
  y: number
  width: number
  height: number
  zIndex?: number
  rotation?: number
}

export interface WbScene {
  id: string
  name: string
  rect: { x: number; y: number; w: number; h: number }
  isDefault?: boolean
}

export interface WbData {
  version: 1
  pan: { x: number; y: number }
  zoom: number
  thumbnailRect?: { x: number; y: number; w: number; h: number }
  scenes?: WbScene[]
  defaultSceneId?: string
  strokes: WbInkStroke[]
  shapes: WbShapeElement[]
  cards: WbObjectCardElement[]
  stickies: WbStickyElement[]
  aiSynced?: boolean
}

export interface WbCardMeta {
  title: string
  typeId: Id
  typeName: string
  typeColor?: string
  typeIcon?: string
}

export const BOARD_COLOR_HEX: Record<ColorName, string> = {
  gray: '#64748b',
  red: '#ef4444',
  orange: '#f97316',
  amber: '#f59e0b',
  yellow: '#eab308',
  lime: '#84cc16',
  green: '#22c55e',
  emerald: '#10b981',
  teal: '#14b8a6',
  cyan: '#06b6d4',
  sky: '#0ea5e9',
  blue: '#3b82f6',
  indigo: '#6366f1',
  violet: '#8b5cf6',
  purple: '#a855f7',
  fuchsia: '#d946ef',
  pink: '#ec4899',
  rose: '#f43f5e',
}

const DEFAULT_SHAPE_HEX = '#3b82f6'
const DEFAULT_ARROW_HEX = '#64748b'

export function colorNameToHex(color: ColorName | undefined, fallback = DEFAULT_SHAPE_HEX): string {
  if (!color) return fallback
  return BOARD_COLOR_HEX[color] ?? fallback
}

function parseHexRgb(hex: string): [number, number, number] | undefined {
  const clean = hex.trim().replace(/^#/, '')
  if (clean.length === 3) {
    const r = parseInt(clean[0]! + clean[0]!, 16)
    const g = parseInt(clean[1]! + clean[1]!, 16)
    const b = parseInt(clean[2]! + clean[2]!, 16)
    if (!Number.isNaN(r) && !Number.isNaN(g) && !Number.isNaN(b)) return [r, g, b]
  } else if (clean.length === 6) {
    const r = parseInt(clean.slice(0, 2), 16)
    const g = parseInt(clean.slice(2, 4), 16)
    const b = parseInt(clean.slice(4, 6), 16)
    if (!Number.isNaN(r) && !Number.isNaN(g) && !Number.isNaN(b)) return [r, g, b]
  }
  return undefined
}

export function hexToColorName(value: string | undefined, defaultHex?: string): ColorName | undefined {
  if (!value) return undefined
  const lower = value.trim().toLowerCase()
  if ((COLOR_NAMES as readonly string[]).includes(lower)) return lower as ColorName
  if (defaultHex && lower === defaultHex.toLowerCase()) return undefined
  if (lower === '#1e293b' || lower === '#0f172a' || lower === '#334155') return undefined
  for (const [name, hex] of Object.entries(BOARD_COLOR_HEX)) {
    if (hex.toLowerCase() === lower) return name as ColorName
  }
  const rgb = parseHexRgb(lower)
  if (!rgb) return undefined
  let best: ColorName | undefined
  let bestDist = Infinity
  for (const [name, hex] of Object.entries(BOARD_COLOR_HEX)) {
    const c = parseHexRgb(hex)
    if (!c) continue
    const dist = (rgb[0] - c[0]) ** 2 + (rgb[1] - c[1]) ** 2 + (rgb[2] - c[2]) ** 2
    if (dist < bestDist) {
      bestDist = dist
      best = name as ColorName
    }
  }
  return best
}

/** Computes the best anchor sides and boundary coordinates between two boxes. */
export function computeConnectorEndpoints(
  fromBox: { x: number; y: number; w: number; h: number; shape?: string },
  toBox: { x: number; y: number; w: number; h: number; shape?: string }
): {
  startSide: WbAnchorSide
  endSide: WbAnchorSide
  startPt: { x: number; y: number }
  endPt: { x: number; y: number }
  startOrientation: 'horizontal' | 'vertical'
  endOrientation: 'horizontal' | 'vertical'
} {
  const c1 = { x: fromBox.x + fromBox.w / 2, y: fromBox.y + fromBox.h / 2 }
  const c2 = { x: toBox.x + toBox.w / 2, y: toBox.y + toBox.h / 2 }
  const dx = c2.x - c1.x
  const dy = c2.y - c1.y

  const gapX = dx >= 0 ? toBox.x - (fromBox.x + fromBox.w) : fromBox.x - (toBox.x + toBox.w)
  const gapY = dy >= 0 ? toBox.y - (fromBox.y + fromBox.h) : fromBox.y - (toBox.y + toBox.h)

  let startSide: WbAnchorSide
  let endSide: WbAnchorSide

  if (gapY >= 16 && gapY >= gapX * 0.6) {
    startSide = dy >= 0 ? 'bottom' : 'top'
    endSide = dy >= 0 ? 'top' : 'bottom'
  } else if (gapX >= 16) {
    startSide = dx >= 0 ? 'right' : 'left'
    endSide = dx >= 0 ? 'left' : 'right'
  } else {
    const normX = Math.abs(dx) / Math.max(1, (fromBox.w + toBox.w) / 2)
    const normY = Math.abs(dy) / Math.max(1, (fromBox.h + toBox.h) / 2)
    if (normX >= normY) {
      startSide = dx >= 0 ? 'right' : 'left'
      endSide = dx >= 0 ? 'left' : 'right'
    } else {
      startSide = dy >= 0 ? 'bottom' : 'top'
      endSide = dy >= 0 ? 'top' : 'bottom'
    }
  }

  const anchorPt = (box: { x: number; y: number; w: number; h: number; shape?: string }, side: WbAnchorSide) => {
    if (box.shape === 'triangle') {
      if (side === 'top') return { x: Math.round(box.x + box.w / 2), y: Math.round(box.y) }
      if (side === 'bottom') return { x: Math.round(box.x + box.w / 2), y: Math.round(box.y + box.h) }
      if (side === 'left') return { x: Math.round(box.x + box.w * 0.25), y: Math.round(box.y + box.h / 2) }
      if (side === 'right') return { x: Math.round(box.x + box.w * 0.75), y: Math.round(box.y + box.h / 2) }
      return { x: Math.round(box.x + box.w / 2), y: Math.round(box.y + box.h / 2) }
    }
    if (side === 'center') return { x: Math.round(box.x + box.w / 2), y: Math.round(box.y + box.h / 2) }
    if (side === 'top') return { x: Math.round(box.x + box.w / 2), y: Math.round(box.y) }
    if (side === 'bottom') return { x: Math.round(box.x + box.w / 2), y: Math.round(box.y + box.h) }
    if (side === 'left') return { x: Math.round(box.x), y: Math.round(box.y + box.h / 2) }
    return { x: Math.round(box.x + box.w), y: Math.round(box.y + box.h / 2) }
  }

  const startPt = anchorPt(fromBox, startSide)
  const endPt = anchorPt(toBox, endSide)
  const startOrientation = startSide === 'left' || startSide === 'right' ? 'horizontal' : 'vertical'
  const endOrientation = endSide === 'left' || endSide === 'right' ? 'horizontal' : 'vertical'

  return { startSide, endSide, startPt, endPt, startOrientation, endOrientation }
}

/** Parse `object.props.whiteboardData` if present. */
export function parseWhiteboardProp(object?: ObjectRecord): WbData | undefined {
  if (!object?.props?.whiteboardData) return undefined
  try {
    const raw = object.props.whiteboardData as unknown
    const str =
      typeof raw === 'string'
        ? raw
        : raw && typeof raw === 'object' && 'value' in raw && typeof (raw as { value: unknown }).value === 'string'
          ? (raw as { value: string }).value
          : null
    const parsed = str ? JSON.parse(str) : raw
    if (parsed && typeof parsed === 'object' && ('strokes' in parsed || 'shapes' in parsed || 'cards' in parsed || 'stickies' in parsed)) {
      const d = parsed as Partial<WbData>
      return {
        version: 1,
        pan: d.pan ?? { x: 0, y: 0 },
        zoom: d.zoom ?? 1,
        ...(d.thumbnailRect ? { thumbnailRect: d.thumbnailRect } : {}),
        ...(d.scenes ? { scenes: d.scenes } : {}),
        ...(d.defaultSceneId ? { defaultSceneId: d.defaultSceneId } : {}),
        ...(d.aiSynced ? { aiSynced: true } : {}),
        strokes: Array.isArray(d.strokes) ? d.strokes : [],
        shapes: Array.isArray(d.shapes) ? d.shapes : [],
        cards: Array.isArray(d.cards) ? d.cards : [],
        stickies: Array.isArray(d.stickies) ? d.stickies : [],
      }
    }
  } catch {
    // ignore malformed whiteboardData
  }
  return undefined
}

/** Read `WbData` from `wb_elements` and `wb_meta` in a `Y.Doc`. */
export function readWbDataFromYDoc(ydoc: Y.Doc): Partial<WbData> {
  const elements = ydoc.getMap<unknown>('wb_elements')
  const meta = ydoc.getMap<unknown>('wb_meta')
  const strokes: WbInkStroke[] = []
  const shapes: WbShapeElement[] = []
  const stickies: WbStickyElement[] = []
  const cards: WbObjectCardElement[] = []

  for (const [key, val] of elements.entries()) {
    if (!val || typeof val !== 'object') continue
    if (key.startsWith('stroke:')) strokes.push(val as WbInkStroke)
    else if (key.startsWith('shape:')) shapes.push(val as WbShapeElement)
    else if (key.startsWith('sticky:')) stickies.push(val as WbStickyElement)
    else if (key.startsWith('card:')) cards.push(val as WbObjectCardElement)
  }

  return {
    version: 1,
    pan: (meta.get('pan') as { x: number; y: number } | undefined) ?? { x: 0, y: 0 },
    zoom: (meta.get('zoom') as number | undefined) ?? 1,
    scenes: meta.get('scenes') as WbScene[] | undefined,
    defaultSceneId: meta.get('defaultSceneId') as string | undefined,
    strokes,
    shapes,
    stickies,
    cards,
  }
}

/** Convert interactive `WbData` into `BoardElement[]`. */
export function whiteboardDataToElements(data: Partial<WbData>): BoardElement[] {
  const out: BoardElement[] = []
  let rank: string | undefined
  const nextRank = () => (rank = rankBetween(rank))

  for (const scene of data.scenes ?? []) {
    if (!scene?.id || !scene.rect) continue
    out.push({
      id: scene.id,
      rank: nextRank(),
      kind: 'frame',
      x: Math.round(scene.rect.x),
      y: Math.round(scene.rect.y),
      w: Math.max(24, Math.round(scene.rect.w)),
      h: Math.max(24, Math.round(scene.rect.h)),
      ...(scene.name ? { title: scene.name } : {}),
    })
  }

  const orderedItems: { zIndex: number; build: (r: string) => BoardElement | undefined }[] = []

  for (const c of data.cards ?? []) {
    if (!c?.id || !c.objectId) continue
    const view: CardView | undefined =
      c.contentMode === 'none' || c.showContent === false
        ? 'compact'
        : c.contentMode === 'full'
          ? 'embed'
          : undefined
    orderedItems.push({
      zIndex: c.zIndex ?? 0,
      build: (r) => ({
        id: c.id,
        rank: r,
        kind: 'card',
        objectId: c.objectId,
        x: Math.round(c.x ?? 0),
        y: Math.round(c.y ?? 0),
        w: Math.max(24, Math.round(c.width ?? 260)),
        h: Math.max(24, Math.round(c.height ?? 130)),
        ...(view ? { view } : {}),
      }),
    })
  }

  for (const s of data.stickies ?? []) {
    if (!s?.id) continue
    const color = hexToColorName(s.color)
    orderedItems.push({
      zIndex: s.zIndex ?? 0,
      build: (r) => ({
        id: s.id,
        rank: r,
        kind: 'sticky',
        text: s.text ?? '',
        x: Math.round(s.x ?? 0),
        y: Math.round(s.y ?? 0),
        w: Math.max(24, Math.round(s.width ?? 180)),
        h: Math.max(24, Math.round(s.height ?? 180)),
        ...(color ? { color } : {}),
      }),
    })
  }

  for (const s of data.shapes ?? []) {
    if (!s?.id) continue
    if (s.type === 'arrow' || s.type === 'line') {
      const from = s.startAnchor?.targetId || s.startAnchor?.cardId
      const to = s.endAnchor?.targetId || s.endAnchor?.cardId
      if (!from || !to || from === to) continue
      const color = hexToColorName(s.color, DEFAULT_ARROW_HEX)
      const path: ArrowPath | undefined =
        s.boardPath !== undefined
          ? (s.boardPath ?? undefined)
          : s.curvature === 'curved'
            ? 'curved'
            : s.curvature === 'orthogonal'
              ? 'elbow'
              : undefined
      const startHead = s.startHead ?? (s.arrowHead === 'double' ? 'arrow' : 'none')
      const endHead = s.endHead ?? (s.type === 'line' || s.arrowHead === 'none' ? 'none' : 'arrow')
      const heads: ArrowHeads | undefined =
        startHead === 'arrow' && endHead === 'arrow'
          ? 'both'
          : startHead === 'none' && endHead === 'none'
            ? 'none'
            : undefined
      const dashed = s.strokeStyle === 'dashed' || s.strokeStyle === 'dotted' ? true : undefined
      orderedItems.push({
        zIndex: s.zIndex ?? 0,
        build: (r) => ({
          id: s.id,
          rank: r,
          kind: 'arrow',
          from,
          to,
          ...(s.text?.trim() ? { label: s.text.trim() } : {}),
          ...(color ? { color } : {}),
          ...(s.relation?.propertyId ? { relation: s.relation.propertyId } : {}),
          ...(path ? { path } : {}),
          ...(heads ? { heads } : {}),
          ...(dashed ? { dashed } : {}),
        }),
      })
    } else {
      const color = hexToColorName(s.color, DEFAULT_SHAPE_HEX)
      const x = Math.round(Math.min(s.x, s.x + s.width))
      const y = Math.round(Math.min(s.y, s.y + s.height))
      const w = Math.max(24, Math.round(Math.abs(s.width)))
      const h = Math.max(24, Math.round(Math.abs(s.height)))
      if (s.boardKind === 'text') {
        orderedItems.push({
          zIndex: s.zIndex ?? 0,
          build: (r) => ({
            id: s.id,
            rank: r,
            kind: 'text',
            text: s.text ?? '',
            x,
            y,
            w,
            h,
            ...(color ? { color } : {}),
          }),
        })
      } else {
        const shapeName: ShapeName = s.boardShape && SHAPES.includes(s.boardShape) ? s.boardShape : (s.type as ShapeName)
        orderedItems.push({
          zIndex: s.zIndex ?? 0,
          build: (r) => ({
            id: s.id,
            rank: r,
            kind: 'shape',
            shape: SHAPES.includes(shapeName) ? shapeName : 'rectangle',
            text: s.text ?? '',
            x,
            y,
            w,
            h,
            ...(color ? { color } : {}),
          }),
        })
      }
    }
  }

  for (const stroke of data.strokes ?? []) {
    if (!stroke?.id || !Array.isArray(stroke.points) || stroke.points.length === 0) continue
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    for (const p of stroke.points) {
      if (p.x < minX) minX = p.x
      if (p.y < minY) minY = p.y
      if (p.x > maxX) maxX = p.x
      if (p.y > maxY) maxY = p.y
    }
    const w = Math.max(1, maxX - minX)
    const h = Math.max(1, maxY - minY)
    const flatPoints: number[] = []
    for (const pt of stroke.points) {
      flatPoints.push(pt.x - minX, pt.y - minY, pt.pressure ?? 0.5)
    }
    const color = hexToColorName(stroke.color)
    orderedItems.push({
      zIndex: stroke.zIndex ?? 0,
      build: (r) => ({
        id: stroke.id,
        rank: r,
        kind: 'stroke',
        points: flatPoints,
        size: stroke.width ?? 3,
        sw: w,
        sh: h,
        x: Math.round(minX),
        y: Math.round(minY),
        w: Math.round(w),
        h: Math.round(h),
        ...(stroke.penType === 'highlighter' ? { highlight: true } : {}),
        ...(color ? { color } : {}),
      }),
    })
  }

  orderedItems.sort((a, b) => a.zIndex - b.zIndex)
  for (const item of orderedItems) {
    const built = item.build(nextRank())
    if (built) out.push(built)
  }

  return out
}

/** Convert `BoardElement[]` into the interactive `WbData` representation, preserving rich UI fields from `existing`. */
export function elementsToWhiteboardData(
  elements: BoardElement[],
  existing?: Partial<WbData>,
  cardMeta?: (objectId: Id) => WbCardMeta | undefined,
  relationResolver?: (fromObjectId: Id, toObjectId: Id, relationKey: string) => WbRelationBinding | undefined
): WbData {
  const existingCards = new Map((existing?.cards ?? []).map((c) => [c.id, c]))
  const existingShapes = new Map((existing?.shapes ?? []).map((s) => [s.id, s]))
  const existingStickies = new Map((existing?.stickies ?? []).map((s) => [s.id, s]))
  const existingStrokes = new Map((existing?.strokes ?? []).map((s) => [s.id, s]))
  const existingScenes = new Map((existing?.scenes ?? []).map((s) => [s.id, s]))

  const scenes: WbScene[] = []
  const cards: WbObjectCardElement[] = []
  const shapes: WbShapeElement[] = []
  const stickies: WbStickyElement[] = []
  const strokes: WbInkStroke[] = []

  const boxById = new Map<Id, { x: number; y: number; w: number; h: number; kind: WbAnchorTargetKind; shape?: string; objectId?: Id }>()
  for (const el of elements) {
    if (el.kind === 'card') {
      boxById.set(el.id, { x: el.x, y: el.y, w: el.w, h: el.h, kind: 'card', objectId: el.objectId })
    } else if (el.kind === 'sticky') {
      boxById.set(el.id, { x: el.x, y: el.y, w: el.w, h: el.h, kind: 'sticky' })
    } else if (el.kind === 'shape' || el.kind === 'text') {
      const renderType: 'rectangle' | 'ellipse' | 'diamond' | 'triangle' =
        el.kind === 'text'
          ? 'rectangle'
          : el.shape === 'ellipse' || el.shape === 'diamond' || el.shape === 'triangle'
            ? el.shape
            : 'rectangle'
      boxById.set(el.id, { x: el.x, y: el.y, w: el.w, h: el.h, kind: 'shape', shape: renderType })
    }
  }

  let z = 1

  // Connectors / arrows default to lowest z-index so they sit underneath cards, stickies, and 2D shapes
  for (const el of elements) {
    if (el.kind !== 'arrow') continue
    const fromBox = boxById.get(el.from)
    const toBox = boxById.get(el.to)
    if (!fromBox || !toBox) continue

    const prev = existingShapes.get(el.id)
    const { startSide, endSide, startPt, endPt, startOrientation, endOrientation } = computeConnectorEndpoints(fromBox, toBox)

    const curvature: 'straight' | 'curved' | 'orthogonal' =
      el.path === 'curved'
        ? 'curved'
        : el.path === 'elbow'
          ? 'orthogonal'
          : el.path === 'straight'
            ? 'straight'
            : (prev?.curvature ?? 'orthogonal')

    const isLine = el.heads === 'none'
    const isBoth = el.heads === 'both'
    const startHead: 'none' | 'arrow' | 'dot' = isBoth ? 'arrow' : 'none'
    const endHead: 'none' | 'arrow' | 'dot' = isLine ? 'none' : 'arrow'

    let relation = prev?.relation
    if (el.relation && fromBox.kind === 'card' && toBox.kind === 'card' && fromBox.objectId && toBox.objectId) {
      relation =
        relationResolver?.(fromBox.objectId, toBox.objectId, el.relation) ??
        (prev?.relation?.propertyId === el.relation
          ? prev.relation
          : {
              propertyId: el.relation,
              ownerObjectId: fromBox.objectId,
              targetObjectId: toBox.objectId,
            })
    } else if (!el.relation) {
      relation = undefined
    }

    const connector: WbShapeElement = {
      ...(prev ?? {}),
      id: el.id,
      type: isLine ? 'line' : 'arrow',
      x: startPt.x,
      y: startPt.y,
      width: endPt.x - startPt.x,
      height: endPt.y - startPt.y,
      color: el.color ? colorNameToHex(el.color, DEFAULT_ARROW_HEX) : (prev?.color ?? DEFAULT_ARROW_HEX),
      strokeWidth: prev?.strokeWidth ?? 2.5,
      strokeStyle: el.dashed ? 'dashed' : 'solid',
      curvature,
      arrowHead: isLine ? 'none' : isBoth ? 'double' : 'single',
      startHead,
      endHead,
      startOrientation,
      endOrientation,
      startAnchor: {
        targetId: el.from,
        targetKind: fromBox.kind,
        ...(fromBox.kind === 'card' ? { cardId: el.from } : {}),
        side: startSide,
      },
      endAnchor: {
        targetId: el.to,
        targetKind: toBox.kind,
        ...(toBox.kind === 'card' ? { cardId: el.to } : {}),
        side: endSide,
      },
      ...(relation ? { relation } : {}),
      text: el.label,
      boardPath: el.path ?? null,
      zIndex: z++,
    }
    shapes.push(connector)
  }

  z = Math.max(100, z)

  for (const el of elements) {
    if (el.kind === 'frame') {
      const prev = existingScenes.get(el.id)
      scenes.push({
        id: el.id,
        name: el.title || prev?.name || 'Scene',
        rect: { x: el.x, y: el.y, w: el.w, h: el.h },
        ...(prev?.isDefault ? { isDefault: true } : {}),
      })
    } else if (el.kind === 'card') {
      const prev = existingCards.get(el.id)
      const meta = cardMeta?.(el.objectId)
      const contentMode: 'none' | 'preview' | 'full' =
        el.view === 'compact' ? 'none' : el.view === 'embed' ? 'full' : (prev?.contentMode ?? 'preview')
      const card: WbObjectCardElement = {
        ...(prev ?? {}),
        id: el.id,
        objectId: el.objectId,
        title: meta?.title ?? prev?.title ?? 'Untitled',
        typeId: meta?.typeId ?? prev?.typeId ?? 'page',
        typeName: meta?.typeName ?? prev?.typeName ?? 'Page',
        ...(meta?.typeColor || prev?.typeColor ? { typeColor: meta?.typeColor ?? prev?.typeColor } : {}),
        ...(meta?.typeIcon || prev?.typeIcon ? { typeIcon: meta?.typeIcon ?? prev?.typeIcon } : {}),
        x: el.x,
        y: el.y,
        width: el.w,
        height: el.h,
        contentMode,
        showContent: contentMode !== 'none',
        zIndex: z++,
      }
      cards.push(card)
    } else if (el.kind === 'sticky') {
      const prev = existingStickies.get(el.id)
      const sticky: WbStickyElement = {
        ...(prev ?? {}),
        id: el.id,
        text: el.text,
        color: el.color ?? prev?.color ?? 'amber',
        x: el.x,
        y: el.y,
        width: el.w,
        height: el.h,
        zIndex: z++,
      }
      stickies.push(sticky)
    } else if (el.kind === 'shape' || el.kind === 'text') {
      const prev = existingShapes.get(el.id)
      const renderType: 'rectangle' | 'ellipse' | 'diamond' | 'triangle' =
        el.kind === 'text'
          ? 'rectangle'
          : el.shape === 'ellipse' || el.shape === 'diamond' || el.shape === 'triangle'
            ? el.shape
            : 'rectangle'
      const shape: WbShapeElement = {
        ...(prev ?? {}),
        id: el.id,
        type: renderType,
        x: el.x,
        y: el.y,
        width: el.w,
        height: el.h,
        color: el.color ? colorNameToHex(el.color) : (prev?.color ?? DEFAULT_SHAPE_HEX),
        fill: el.kind === 'text' ? 'none' : (prev?.fill ?? 'tint'),
        strokeWidth: el.kind === 'text' ? 1.5 : (prev?.strokeWidth ?? 2.5),
        strokeStyle: prev?.strokeStyle ?? 'solid',
        text: el.text,
        boardKind: el.kind,
        ...(el.kind === 'shape' ? { boardShape: el.shape } : {}),
        zIndex: z++,
      }
      shapes.push(shape)
    } else if (el.kind === 'stroke' && !el.parent) {
      const prev = existingStrokes.get(el.id)
      const pts: WbPoint[] = []
      const scaleX = el.sw > 0 ? el.w / el.sw : 1
      const scaleY = el.sh > 0 ? el.h / el.sh : 1
      for (let i = 0; i + 2 < el.points.length; i += 3) {
        pts.push({
          x: el.x + el.points[i]! * scaleX,
          y: el.y + el.points[i + 1]! * scaleY,
          pressure: el.points[i + 2]!,
        })
      }
      strokes.push({
        ...(prev ?? {}),
        id: el.id,
        color: el.color ? colorNameToHex(el.color, '#1e293b') : (prev?.color ?? '#1e293b'),
        width: el.size,
        style: prev?.style ?? 'solid',
        penType: el.highlight ? 'highlighter' : 'pen',
        points: pts,
        zIndex: z++,
      })
    }
  }

  // Preserve any existing strokes from the whiteboard that were not part of the board elements
  for (const s of existing?.strokes ?? []) {
    if (!strokes.some((existingS) => existingS.id === s.id)) {
      strokes.push({
        ...s,
        zIndex: s.zIndex ?? z++,
      })
    }
  }

  const defaultSceneId =
    existing?.defaultSceneId && scenes.some((s) => s.id === existing.defaultSceneId)
      ? existing.defaultSceneId
      : scenes.find((s) => s.isDefault)?.id ?? scenes[0]?.id

  return {
    version: 1,
    pan: existing?.pan ?? { x: 0, y: 0 },
    zoom: existing?.zoom ?? 1,
    ...(existing?.thumbnailRect ? { thumbnailRect: existing.thumbnailRect } : {}),
    ...(scenes.length ? { scenes } : {}),
    ...(defaultSceneId ? { defaultSceneId } : {}),
    strokes,
    shapes,
    cards,
    stickies,
  }
}

/**
 * Ensures `BOARD_FIELD` in `ydoc` is populated from `wb_elements` or `object.props.whiteboardData`
 * before `editBoard` modifies `BOARD_FIELD`.
 */
export function ensureBoardMap(ydoc: Y.Doc, object?: ObjectRecord) {
  const wbMeta = ydoc.share.has('wb_meta') ? ydoc.getMap<unknown>('wb_meta') : undefined
  const wbElems = ydoc.share.has('wb_elements') ? ydoc.getMap<unknown>('wb_elements') : undefined
  const fromProp = parseWhiteboardProp(object)
  const uiModified =
    (fromProp !== undefined && !fromProp.aiSynced) ||
    (wbElems && wbElems.size > 0 && wbMeta?.get('updatedByUi') !== false)
  const map = boardMap(ydoc)

  if (uiModified || (map.size === 0 && ((wbElems && wbElems.size > 0) || fromProp))) {
    const currentElements = readBoard(ydoc, object)
    ydoc.transact(() => {
      map.clear()
      for (const el of currentElements) {
        const entry = new Y.Map<unknown>()
        for (const [k, v] of Object.entries(el)) {
          if (k !== 'id' && v !== undefined) entry.set(k, v)
        }
        map.set(el.id, entry)
      }
      if (wbMeta) wbMeta.set('updatedByUi', false)
    })
  }
}

/**
 * Synchronizes `BOARD_FIELD` changes into `wb_elements`, `wb_meta`, and returns the updated `WbData`
 * so `object.props.whiteboardData` can be persisted alongside `ydoc`.
 */
export function syncBoardToWhiteboard(
  ydoc: Y.Doc,
  object?: ObjectRecord,
  cardMeta?: (objectId: Id) => WbCardMeta | undefined,
  relationResolver?: (fromObjectId: Id, toObjectId: Id, relationKey: string) => WbRelationBinding | undefined
): WbData {
  const existingProp = parseWhiteboardProp(object)
  const existingYjs = ydoc.share.has('wb_elements') && ydoc.getMap('wb_elements').size > 0 ? readWbDataFromYDoc(ydoc) : undefined
  const existing: Partial<WbData> = {
    ...(existingProp ?? {}),
    ...(existingYjs ?? {}),
    pan: existingYjs?.pan ?? existingProp?.pan ?? { x: 0, y: 0 },
    zoom: existingYjs?.zoom ?? existingProp?.zoom ?? 1,
  }

  // Read directly from BOARD_FIELD
  const elements: BoardElement[] = []
  for (const [id, entry] of boardMap(ydoc)) {
    const element = readElement(id, entry)
    if (element) elements.push(element)
  }
  const sorted = filterAndSortElements(elements)
  const wbData = elementsToWhiteboardData(sorted, existing, cardMeta, relationResolver)

  ydoc.transact(() => {
    const wbElements = ydoc.getMap<unknown>('wb_elements')
    const wbMeta = ydoc.getMap<unknown>('wb_meta')
    const currentKeys = new Set<string>()

    for (const s of wbData.strokes) {
      const k = `stroke:${s.id}`
      currentKeys.add(k)
      wbElements.set(k, s)
    }
    for (const s of wbData.shapes) {
      const k = `shape:${s.id}`
      currentKeys.add(k)
      wbElements.set(k, s)
    }
    for (const s of wbData.stickies) {
      const k = `sticky:${s.id}`
      currentKeys.add(k)
      wbElements.set(k, s)
    }
    for (const c of wbData.cards) {
      const k = `card:${c.id}`
      currentKeys.add(k)
      wbElements.set(k, c)
    }
    for (const k of Array.from(wbElements.keys())) {
      if (!currentKeys.has(k)) wbElements.delete(k)
    }

    wbMeta.set('scenes', wbData.scenes ?? [])
    if (wbData.defaultSceneId !== undefined) wbMeta.set('defaultSceneId', wbData.defaultSceneId)
    wbMeta.set('pan', wbData.pan)
    wbMeta.set('zoom', wbData.zoom)
    wbMeta.set('updatedByUi', false)
  })

  wbData.aiSynced = true
  return wbData
}
