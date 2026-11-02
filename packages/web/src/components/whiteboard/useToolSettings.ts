import { computed, ref } from 'vue'
import { PALETTE } from './shapes.ts'
import type {
  DrawMode,
  LineCurvature,
  LineTermination,
  PenPreset,
  PenType,
  Shape2DType,
  ShapeFill,
  StickyFontSize,
  StrokeStyle,
  WhiteboardTool,
} from './types.ts'

export interface Shape2DSettings {
  color: string
  fill: ShapeFill
  fillColor?: string
  strokeWidth: number
  strokeStyle: StrokeStyle
}

export type ShapeItemType = Shape2DType

export interface ConnectorSettings {
  color: string
  strokeWidth: number
  strokeStyle: StrokeStyle
  curvature: LineCurvature
  startHead: LineTermination
  endHead: LineTermination
  startOrientation?: 'horizontal' | 'vertical'
  endOrientation?: 'horizontal' | 'vertical'
}

export type PopoverName =
  | 'pen-preset'
  | 'eraser'
  | 'shape'
  | 'connector'
  | 'sticky'
  | 'selection-outline'
  | 'selection-fill'
  | 'selection-color'
  | 'selection-stroke'
  | 'selection-text'
  | 'selection-zorder'
  | 'selection-card-fields'
  | null

const isDarkTheme = () =>
  typeof document !== 'undefined' &&
  (document.documentElement.classList.contains('dark') ||
    window.matchMedia?.('(prefers-color-scheme: dark)').matches)

const PEN_PRESETS_KEY = 'vasta.whiteboard.pen_presets_v6'
const SHAPE_SETTINGS_KEY = 'vasta.whiteboard.shape2d_settings_v3'
const CONNECTOR_SETTINGS_KEY = 'vasta.whiteboard.connector_settings_v3'
const PEN_KEY = 'vasta.whiteboard.pencil'

export const mainTools: { id: WhiteboardTool; icon: string; title: string }[] = [
  { id: 'hand', icon: 'ph:hand', title: 'Hand (Pan)' },
  { id: 'select', icon: 'ph:bounding-box', title: 'Selection' },
  { id: 'pen', icon: 'ph:pencil-simple', title: 'Pen & Drawing' },
  { id: 'eraser', icon: 'ph:eraser', title: 'Eraser' },
  { id: 'shape2d', icon: 'ph:shapes', title: 'Shapes' },
  { id: 'connector', icon: 'ph:flow-arrow', title: 'Connectors & Lines' },
  { id: 'sticky', icon: 'ph:note', title: 'Sticky Note' },
]

export function isBrightColor(color: string): boolean {
  if (!color || color === 'none' || color === 'transparent') return false
  if (color === '#ffffff' || color === 'white') return true
  const hex = color.replace('#', '')
  if (hex.length === 6) {
    const r = parseInt(hex.substring(0, 2), 16)
    const g = parseInt(hex.substring(2, 4), 16)
    const b = parseInt(hex.substring(4, 6), 16)
    return (r * 299 + g * 587 + b * 114) / 1000 > 160
  }
  return false
}

export function getConnectorIconPaths(
  curvature: LineCurvature,
  startHead: LineTermination = 'none',
  endHead: LineTermination = 'arrow',
) {
  const hasStartArrow = startHead === 'arrow'
  const hasEndArrow = endHead === 'arrow'

  if (curvature === 'curved') {
    return {
      shaft: `M ${hasStartArrow ? '5.3 14.6' : '4 18.5'} Q 8.5 5.5 ${hasEndArrow ? '16.1 6.4' : '20 6.5'}`,
      startTriangle: '4,18.5 8.2,15.3 2.4,13.9',
      endTriangle: '20,6.5 15.8,3.4 16.4,9.4',
      startDot: { cx: 5.5, cy: 17.5 },
      endDot: { cx: 18.5, cy: 6.5 },
    }
  }

  if (curvature === 'orthogonal') {
    return {
      shaft: `M ${hasStartArrow ? '7.2 17.5' : '3.5 17.5'} H 12 V 6.5 H ${hasEndArrow ? '16.8' : '20.5'}`,
      startTriangle: '3.5,17.5 7.5,14.5 7.5,20.5',
      endTriangle: '20.5,6.5 16.5,3.5 16.5,9.5',
      startDot: { cx: 5.5, cy: 17.5 },
      endDot: { cx: 18.5, cy: 6.5 },
    }
  }

  return {
    shaft: `M ${hasStartArrow ? '6.8 15.4' : '3.5 18.0'} L ${hasEndArrow ? '17.2 8.6' : '20.5 6.0'}`,
    startTriangle: '3.5,18.0 8.8,17.9 4.8,12.9',
    endTriangle: '20.5,6.0 15.2,6.1 19.2,11.1',
    startDot: { cx: 5.5, cy: 17.5 },
    endDot: { cx: 18.5, cy: 6.5 },
  }
}

export const toolBtn = (active: boolean) =>
  active ? 'text-ink' : 'text-ink-soft hover:bg-hover hover:text-ink'

export function useToolSettings(
  getDrawMode: () => DrawMode,
  onPenDetected: (present: boolean) => void,
) {
  const defaultInkColor = isDarkTheme() ? '#ffffff' : '#0f172a'

  const DEFAULT_PEN_PRESETS: PenPreset[] = [
    { id: 'p1', name: 'Pen', type: 'pen', color: defaultInkColor, width: 3, style: 'solid' },
    { id: 'p2', name: 'Fine Pen', type: 'pen', color: '#64748b', width: 2, style: 'solid' },
    { id: 'p3', name: 'Highlighter', type: 'highlighter', color: '#f59e0b', width: 18, style: 'marker' },
    { id: 'p4', name: 'Color Pen', type: 'pen', color: '#2563eb', width: 3, style: 'solid' },
  ]

  function loadPenPresets(): PenPreset[] {
    try {
      const raw = localStorage.getItem(PEN_PRESETS_KEY)
      if (raw) {
        const parsed = JSON.parse(raw)
        if (Array.isArray(parsed) && parsed.length === 4 && parsed[0]?.type) {
          // Normalize any legacy 'pencil' presets to 'pen'
          for (const item of parsed) {
            if ((item.type as string) === 'pencil') {
              item.type = 'pen'
              if (item.name === 'Pencil') item.name = 'Fine Pen'
            }
          }
          return parsed
        }
      }
    } catch {}
    return DEFAULT_PEN_PRESETS
  }

  const penPresets = ref<PenPreset[]>(loadPenPresets())
  const activePresetIndex = ref(0)

  function savePenPresets() {
    try {
      localStorage.setItem(PEN_PRESETS_KEY, JSON.stringify(penPresets.value))
    } catch {}
  }

  const initialPreset = penPresets.value[0] || DEFAULT_PEN_PRESETS[0]!

  // Editable Palette & Swatch Interactivity
  const activePalette = ref<string[]>([...PALETTE])
  const colorInputMap = new Map<string, HTMLInputElement>()

  function registerColorInput(key: string, el: any) {
    if (el) colorInputMap.set(key, el as HTMLInputElement)
  }

  function handleSwatchClick(
    c: string,
    idx: number,
    currentVal: string,
    applyFn: (val: string) => void,
    key: string,
  ) {
    if (currentVal && currentVal.toLowerCase() === c.toLowerCase()) {
      const input = colorInputMap.get(`${key}_${idx}`)
      if (input) {
        if ('showPicker' in HTMLInputElement.prototype) {
          try {
            input.showPicker()
            return
          } catch {}
        }
        input.click()
      }
    } else {
      applyFn(c)
    }
  }

  function handleSwatchInput(e: Event, idx: number, applyFn: (val: string) => void) {
    const val = (e.target as HTMLInputElement).value
    if (!val) return
    activePalette.value[idx] = val
    applyFn(val)
  }

  function handleStickySwatchClick(
    name: string,
    bg: string,
    currentVal: string,
    applyFn: (val: string) => void,
    key: string,
  ) {
    if (currentVal === name || currentVal === bg) {
      const input = colorInputMap.get(`${key}_${name}`)
      if (input) {
        if ('showPicker' in HTMLInputElement.prototype) {
          try {
            input.showPicker()
            return
          } catch {}
        }
        input.click()
      }
    } else {
      applyFn(name)
    }
  }

  // Tools & Sub-Modes
  const currentTool = ref<WhiteboardTool>('hand')
  const selectMode = ref<'box' | 'lasso'>('box')
  const currentShape2D = ref<Shape2DType>('rectangle')
  const shapeFillTab = ref<'outline' | 'fill'>('outline')
  const currentPenType = ref<PenType>(initialPreset.type || 'pen')
  const currentStrokeStyle = ref<StrokeStyle>(initialPreset.style || 'solid')
  const currentColor = ref(initialPreset.color)
  const currentWidth = ref(initialPreset.width)
  const eraserMode = ref<'pixel' | 'object'>('pixel')
  const eraserSize = ref(18)
  const currentStickyColor = ref('amber')
  const currentStickyTextColor = ref('#0f172a')
  const currentStickyFontSize = ref<StickyFontSize>('md')

  const DEFAULT_SHAPE_2D_SETTINGS: Record<Shape2DType, Shape2DSettings> = {
    rectangle: { color: defaultInkColor, fill: 'none', strokeWidth: 3, strokeStyle: 'solid' },
    ellipse: { color: '#2563eb', fill: 'none', strokeWidth: 3, strokeStyle: 'solid' },
    diamond: { color: '#9333ea', fill: 'none', strokeWidth: 3, strokeStyle: 'solid' },
    triangle: { color: '#16a34a', fill: 'none', strokeWidth: 3, strokeStyle: 'solid' },
  }

  function loadShapeSettings(): Record<Shape2DType, Shape2DSettings> {
    try {
      const raw = localStorage.getItem(SHAPE_SETTINGS_KEY)
      if (raw) return { ...DEFAULT_SHAPE_2D_SETTINGS, ...JSON.parse(raw) }
    } catch {}
    return { ...DEFAULT_SHAPE_2D_SETTINGS }
  }

  const shape2DSettings = ref<Record<Shape2DType, Shape2DSettings>>(loadShapeSettings())
  function saveShapeSettings() {
    try {
      localStorage.setItem(SHAPE_SETTINGS_KEY, JSON.stringify(shape2DSettings.value))
    } catch {}
  }

  function setShapeColor(color: string) {
    shape2DSettings.value[currentShape2D.value].color = color
    saveShapeSettings()
  }

  function setShapeStrokeWidth(w: number) {
    shape2DSettings.value[currentShape2D.value].strokeWidth = w
    saveShapeSettings()
  }

  function setShapeFill(fill: ShapeFill) {
    shape2DSettings.value[currentShape2D.value].fill = fill
    saveShapeSettings()
  }

  function setShapeFillColor(color: string) {
    shape2DSettings.value[currentShape2D.value].fillColor = color
    if (shape2DSettings.value[currentShape2D.value].fill === 'none') {
      shape2DSettings.value[currentShape2D.value].fill = 'solid'
    }
    saveShapeSettings()
  }

  const activeShapeItem = ref<Shape2DType>('rectangle')

  function getShapeFillPreview(type: Shape2DType): string {
    const s = shape2DSettings.value[type]
    if (!s || s.fill === 'none') return 'none'
    if (s.fill === 'white') return '#ffffff'
    const base = s.fillColor || s.color
    if (s.fill === 'tint') return `${base}33`
    return base
  }

  function loadConnectorSettings(): ConnectorSettings {
    try {
      const raw = localStorage.getItem(CONNECTOR_SETTINGS_KEY)
      if (raw) return JSON.parse(raw)
    } catch {}
    return {
      color: '#2563eb',
      strokeWidth: 3,
      strokeStyle: 'solid',
      curvature: 'straight',
      startHead: 'none',
      endHead: 'arrow',
    }
  }

  const connectorSettings = ref<ConnectorSettings>(loadConnectorSettings())
  function saveConnectorSettings() {
    try {
      localStorage.setItem(CONNECTOR_SETTINGS_KEY, JSON.stringify(connectorSettings.value))
    } catch {}
  }

  function selectPenPreset(index: number) {
    activePresetIndex.value = index
    const p = penPresets.value[index]
    if (p) {
      currentColor.value = p.color
      currentWidth.value = p.width
      currentPenType.value = p.type
      currentStrokeStyle.value = p.style || (p.type === 'highlighter' ? 'marker' : 'solid')
    }
  }

  function setPresetType(type: PenType) {
    currentPenType.value = type
    const p = penPresets.value[activePresetIndex.value]
    if (p) {
      p.type = type
      if (type === 'highlighter' && p.width < 12) p.width = 18
      if (type !== 'highlighter' && p.width > 12) p.width = 3
      currentWidth.value = p.width
      p.style = type === 'highlighter' ? 'marker' : 'solid'
      currentStrokeStyle.value = p.style
      p.name = type === 'pen' ? 'Pen' : 'Highlighter'
      savePenPresets()
    }
  }

  function setPresetWidth(w: number) {
    currentWidth.value = w
    const p = penPresets.value[activePresetIndex.value]
    if (p) {
      p.width = w
      savePenPresets()
    }
  }

  function setPresetColor(color: string) {
    currentColor.value = color
    const p = penPresets.value[activePresetIndex.value]
    if (p) {
      p.color = color
      savePenPresets()
    }
  }

  const activePopover = ref<PopoverName>(null)
  const secondaryOpen = ref(true)
  const objectPickerOpen = ref(false)

  function togglePopover(name: PopoverName) {
    activePopover.value = activePopover.value === name ? null : name
  }

  function closeAllPopovers() {
    activePopover.value = null
    objectPickerOpen.value = false
  }

  function onSelectMainTool(tool: WhiteboardTool) {
    if (currentTool.value === tool) {
      secondaryOpen.value = !secondaryOpen.value
      if (!secondaryOpen.value) closeAllPopovers()
    } else {
      currentTool.value = tool
      closeAllPopovers()
      if (tool === 'pen') selectPenPreset(activePresetIndex.value)
    }
  }

  function onPresetClick(idx: number) {
    if (activePresetIndex.value === idx) {
      togglePopover('pen-preset')
    } else {
      selectPenPreset(idx)
      closeAllPopovers()
    }
  }

  function onShapeClick(shp: Shape2DType) {
    if (activeShapeItem.value === shp && currentShape2D.value === shp) {
      togglePopover('shape')
    } else {
      activeShapeItem.value = shp
      currentShape2D.value = shp
      closeAllPopovers()
    }
  }

  function onConnectorCurvatureClick(curv: LineCurvature) {
    if (connectorSettings.value.curvature === curv) {
      togglePopover('connector')
    } else {
      connectorSettings.value.curvature = curv
      saveConnectorSettings()
      closeAllPopovers()
    }
  }

  function onStickyColorClick(name: string) {
    if (currentStickyColor.value === name) {
      togglePopover('sticky')
    } else {
      currentStickyColor.value = name
      closeAllPopovers()
    }
  }

  const hasSecondary = computed(() =>
    ['select', 'pen', 'eraser', 'shape2d', 'connector', 'sticky'].includes(currentTool.value),
  )

  const eraserCursor = ref<{ x: number; y: number } | null>(null)

  const penSeen = ref(false)
  try {
    penSeen.value = localStorage.getItem(PEN_KEY) === '1'
  } catch {}

  function setPen(present: boolean) {
    if (penSeen.value === present) return
    penSeen.value = present
    try {
      localStorage.setItem(PEN_KEY, present ? '1' : '0')
    } catch {}
    onPenDetected(present)
  }

  const pencilOnly = computed(() => {
    const mode = getDrawMode()
    return mode === 'pencil' || (mode === 'auto' && penSeen.value)
  })

  const dockPenIcon = computed(() => {
    if (currentPenType.value === 'highlighter') return 'ph:highlighter'
    return 'ph:pen-nib'
  })

  const dockEraserIcon = computed(() =>
    eraserMode.value === 'object' ? 'ph:backspace' : 'ph:eraser',
  )

  const dockShape2DFill = computed(() => {
    const current = shape2DSettings.value[currentShape2D.value]
    if (current.fill === 'none') return 'transparent'
    if (current.fill === 'white') return '#ffffff'
    const base = current.fillColor || current.color
    if (current.fill === 'tint') return `${base}33`
    return base
  })

  return {
    activePalette,
    isBrightColor,
    registerColorInput,
    handleSwatchClick,
    handleSwatchInput,
    handleStickySwatchClick,
    penPresets,
    activePresetIndex,
    savePenPresets,
    initialPreset,
    currentTool,
    selectMode,
    currentShape2D,
    shapeFillTab,
    currentPenType,
    currentStrokeStyle,
    currentColor,
    currentWidth,
    eraserMode,
    eraserSize,
    currentStickyColor,
    currentStickyTextColor,
    currentStickyFontSize,
    shape2DSettings,
    saveShapeSettings,
    setShapeColor,
    setShapeStrokeWidth,
    setShapeFill,
    setShapeFillColor,
    activeShapeItem,
    getShapeFillPreview,
    connectorSettings,
    saveConnectorSettings,
    selectPenPreset,
    setPresetType,
    setPresetWidth,
    setPresetColor,
    activePopover,
    secondaryOpen,
    objectPickerOpen,
    togglePopover,
    closeAllPopovers,
    onSelectMainTool,
    onPresetClick,
    onShapeClick,
    onConnectorCurvatureClick,
    onStickyColorClick,
    hasSecondary,
    eraserCursor,
    penSeen,
    setPen,
    pencilOnly,
    mainTools,
    getConnectorIconPaths,
    dockPenIcon,
    dockEraserIcon,
    dockShape2DFill,
    toolBtn,
  }
}
