import type { Id } from '@vasta/core'

export interface Point {
  x: number
  y: number
  pressure?: number
}

export type StrokeStyle = 'solid' | 'dashed' | 'dotted' | 'marker'
export type PenType = 'pen' | 'highlighter'

export interface PenPreset {
  id: string
  name: string
  type: PenType
  color: string
  width: number
  style?: StrokeStyle
}

export interface InkStroke {
  id: string
  color: string
  width: number
  style?: StrokeStyle
  penType?: PenType
  points: Point[]
  zIndex?: number
  rotation?: number
}

export type Shape2DType = 'rectangle' | 'ellipse' | 'diamond' | 'triangle'
export type Shape1DType = 'line' | 'arrow'
export type ShapeType = Shape2DType | Shape1DType

export type LineCurvature = 'straight' | 'curved' | 'orthogonal'
export type ArrowHeadType = 'single' | 'double' | 'dot' | 'none'
export type LineTermination = 'none' | 'arrow' | 'dot'
export type ShapeFill = 'none' | 'tint' | 'white' | 'solid'

export type AnchorTargetKind = 'card' | 'sticky' | 'shape'
export type AnchorSide = 'top' | 'bottom' | 'left' | 'right'

export interface ConnectorAnchor {
  targetId?: string
  targetKind?: AnchorTargetKind
  /** Kept for backward compatibility with card-only anchors */
  cardId?: string
  side?: AnchorSide
}

export interface ShapeElement {
  id: string
  type: ShapeType
  x: number
  y: number
  width: number
  height: number
  color: string
  fill?: ShapeFill | string
  fillColor?: string
  strokeWidth?: number
  strokeStyle?: StrokeStyle
  curvature?: LineCurvature
  arrowHead?: ArrowHeadType
  startHead?: LineTermination
  endHead?: LineTermination
  arrowSize?: 'sm' | 'md' | 'lg'
  controlPoint?: Point
  midOffset?: number
  orientation?: 'horizontal' | 'vertical'
  startOrientation?: 'horizontal' | 'vertical'
  endOrientation?: 'horizontal' | 'vertical'
  text?: string
  startAnchor?: ConnectorAnchor
  endAnchor?: ConnectorAnchor
  zIndex?: number
  rotation?: number
}

export type CardContentMode = 'none' | 'preview' | 'full'

export interface ObjectCardElement {
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
  contentMode?: CardContentMode
  showProperties?: string[]
}

export type StickyFontSize = 'sm' | 'md' | 'lg' | 'xl'

export interface StickyElement {
  id: string
  text: string
  color: string // 'amber' | 'emerald' | 'sky' | 'rose' | 'purple' | 'gray'
  fontSize?: StickyFontSize
  textColor?: string
  x: number
  y: number
  width: number
  height: number
  zIndex?: number
  rotation?: number
}

export interface WhiteboardScene {
  id: string
  name: string
  rect: { x: number; y: number; w: number; h: number }
  isDefault?: boolean
}

export interface WhiteboardData {
  version: 1
  pan: { x: number; y: number }
  zoom: number
  thumbnailRect?: { x: number; y: number; w: number; h: number }
  scenes?: WhiteboardScene[]
  defaultSceneId?: string
  strokes: InkStroke[]
  shapes: ShapeElement[]
  cards: ObjectCardElement[]
  stickies: StickyElement[]
}

export type WhiteboardTool =
  | 'hand'
  | 'select'
  | 'lasso'
  | 'pen'
  | 'eraser'
  | 'shape2d'
  | 'connector'
  | 'sticky'

/** How drawing input is handled: Auto uses the pencil once one has been seen. */
export type DrawMode = 'auto' | 'pencil' | 'touch'
