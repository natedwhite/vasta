<script setup lang="ts">
import { computed, onMounted, onUnmounted, provide, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import type { Direction, Id, ObjectSummary } from '@vasta/core'
import { api } from '../../lib/api.ts'
import {
  autoLayoutWhiteboardData,
  jsonCanvasToWhiteboardPatch,
  mermaidToWhiteboardPatch,
} from '../../lib/board-actions.ts'
import { displayTitle } from '../../lib/format.ts'
import { primeSummaries, typesById } from '../../lib/state.ts'
import AppIcon from '../AppIcon.vue'
import { WHITEBOARD_CTX } from './context.ts'
import { newId } from './ids.ts'
import {
  STICKY_FONT_SIZES,
  getAllAnchorPoints,
  getConnectorGeometry,
  getShapeFill,
  getStrokeDash,
  isLine,
  shapePath,
  stickyStyle,
} from './shapes.ts'
import type {
  DrawMode,
  InkStroke,
  ObjectCardElement,
  Point,
  ShapeElement,
  StickyElement,
  WhiteboardData,
  WhiteboardScene,
} from './types.ts'
import { useToolSettings } from './useToolSettings.ts'
import { useWhiteboardHistory } from './useWhiteboardHistory.ts'
import { useWhiteboardInteractions } from './useWhiteboardInteractions.ts'
import { useWhiteboardScenes } from './useWhiteboardScenes.ts'
import {
  keyOf,
  useWhiteboardSelection,
} from './useWhiteboardSelection.ts'
import WhiteboardObjectCard from './WhiteboardObjectCard.vue'
import WhiteboardPopovers from './WhiteboardPopovers.vue'
import WhiteboardToolbar from './WhiteboardToolbar.vue'
import { bindWhiteboardToYDoc, type YjsWhiteboardBridge } from './yjsSync.ts'

export type { ConnectorSettings, Shape2DSettings, ShapeItemType } from './useToolSettings.ts'
export type { CanvasItem, Handle, ResizeHandleId, SelectedGeometry } from './useWhiteboardSelection.ts'

const props = defineProps<{
  initialData?: Partial<WhiteboardData>
  drawMode: DrawMode
  ydoc?: any
}>()

const emit = defineEmits<{
  change: [data: WhiteboardData]
  undoTriggered: []
  redoTriggered: []
  penDetected: [present: boolean]
}>()

const router = useRouter()
const containerRef = ref<HTMLElement | null>(null)

// Canvas transformation & elements
const pan = ref(props.initialData?.pan ?? { x: 0, y: 0 })
const zoom = ref(props.initialData?.zoom ?? 1)
const strokes = ref<InkStroke[]>(props.initialData?.strokes ? [...props.initialData.strokes] : [])
const shapes = ref<ShapeElement[]>(props.initialData?.shapes ? [...props.initialData.shapes] : [])
const cards = ref<ObjectCardElement[]>(props.initialData?.cards ? [...props.initialData.cards] : [])
const stickies = ref<StickyElement[]>(props.initialData?.stickies ? [...props.initialData.stickies] : [])
const editingId = ref<string | null>(null)

let yjsBridge: YjsWhiteboardBridge | null = null

const toolSettings = useToolSettings(
  () => props.drawMode,
  (present) => emit('penDetected', present),
)
const {
  currentTool,
  currentShape2D,
  shapeFillTab,
  currentStickyColor,
  currentStickyTextColor,
  currentStickyFontSize,
  shape2DSettings,
  saveShapeSettings,
  connectorSettings,
  saveConnectorSettings,
  objectPickerOpen,
  activePopover,
  closeAllPopovers,
  setPen,
  pencilOnly,
  dockShape2DFill,
} = toolSettings

const scenesState = useWhiteboardScenes({
  initialData: props.initialData,
  containerRef,
  pan,
  zoom,
  pencilOnly,
  setPen,
  getCanvasCoords: (x, y) => getCanvasCoords(x, y),
  closeAllPopovers,
  notifyChange,
})
const {
  thumbnailRect,
  scenes,
  defaultSceneId,
  isSceneDrawing,
  startDefiningScene,
  cancelDefiningScene,
  saveDefiningScene,
  setCurrentViewAsSceneDraft,
  focusScene,
  deleteScene,
  updateScene,
  setDefaultScene,
  setThumbnailToCurrentView,
  clearThumbnail,
} = scenesState

const selectionState = useWhiteboardSelection({
  containerRef,
  pan,
  zoom,
  strokes,
  shapes,
  cards,
  stickies,
  editingId,
  currentShape2D,
  shapeFillTab,
  shape2DSettings,
  saveShapeSettings,
  connectorSettings,
  saveConnectorSettings,
  currentStickyColor,
  currentStickyTextColor,
  currentStickyFontSize,
  dockShape2DFill,
  pushHistory: () => historyState.pushHistory(),
  notifyChange,
})
const {
  selected,
  isSelected,
  allKeys,
  ensureZIndices,
  renormalizeZIndices,
  getMaxZIndex,
  allCanvasItems,
  isOnlySelectedLine,
  selectedGeometry,
  handles,
  detachAnchorsTo,
  selectionStartAnchored,
  selectionEndAnchored,
  syncAnchoredConnectors,
} = selectionState

const historyState = useWhiteboardHistory({
  strokes,
  shapes,
  cards,
  stickies,
  selected,
  editingId,
  ensureZIndices,
  renormalizeZIndices,
  notifyChange,
  onUndo: () => emit('undoTriggered'),
  onRedo: () => emit('redoTriggered'),
})
const { pushHistory, undo, redo } = historyState

const interactionsState = useWhiteboardInteractions({
  containerRef,
  getDrawMode: () => props.drawMode,
  pan,
  zoom,
  strokes,
  shapes,
  cards,
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
  onPenDetected: (present) => emit('penDetected', present),
})
const {
  currentStroke,
  currentShape,
  currentDraftSticky,
  marquee,
  lasso,
  activeMode,
  touchPanning,
  mousePanning,
  hoveredSnapAnchor,
  getCanvasCoords,
  startEditing,
  onStickyFocus,
  onStickyBlur,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
} = interactionsState

watch(
  () => props.ydoc,
  (newDoc) => {
    yjsBridge?.destroy()
    yjsBridge = null
    if (newDoc) {
      yjsBridge = bindWhiteboardToYDoc(newDoc, props.initialData, (remoteData) => {
        if (remoteData.strokes) strokes.value = remoteData.strokes
        if (remoteData.shapes) shapes.value = remoteData.shapes
        if (remoteData.stickies) stickies.value = remoteData.stickies
        if (remoteData.cards) cards.value = remoteData.cards
        if (remoteData.scenes) scenes.value = remoteData.scenes
        if (remoteData.defaultSceneId !== undefined) defaultSceneId.value = remoteData.defaultSceneId
        if (remoteData.pan) pan.value = remoteData.pan
        if (remoteData.zoom) zoom.value = remoteData.zoom
      })
    }
  },
  { immediate: true },
)

onUnmounted(() => {
  yjsBridge?.destroy()
})

function getCurrentData(): WhiteboardData {
  const defScene =
    scenes.value.find((s) => s.id === defaultSceneId.value) ||
    scenes.value.find((s) => s.isDefault) ||
    scenes.value[0]
  return {
    version: 1,
    pan: pan.value,
    zoom: zoom.value,
    thumbnailRect: defScene ? { ...defScene.rect } : thumbnailRect.value ? { ...thumbnailRect.value } : undefined,
    scenes: scenes.value.map((s) => ({ ...s, rect: { ...s.rect } })),
    defaultSceneId: defaultSceneId.value,
    strokes: strokes.value,
    shapes: shapes.value,
    cards: cards.value,
    stickies: stickies.value,
  }
}

function notifyChange() {
  const currentData = getCurrentData()
  yjsBridge?.syncLocalToYjs(currentData)
  emit('change', currentData)
}

function refreshObjectSummaries() {
  const ids = cards.value.map((c) => c.objectId).filter(Boolean)
  if (!ids.length) return
  api
    .summaries(ids)
    .then((list) => {
      primeSummaries(list)
      let changed = false
      for (const card of cards.value) {
        const s = list.find((x) => x.id === card.objectId)
        if (s) {
          const type = typesById.value.get(s.typeId)
          const newTitle = s.title || displayTitle(s, type)
          const newTypeName = type?.name || card.typeName
          const newTypeColor = type?.color || card.typeColor
          const newTypeIcon = type?.icon?.value || card.typeIcon
          if (
            card.title !== newTitle ||
            card.typeName !== newTypeName ||
            card.typeColor !== newTypeColor ||
            card.typeIcon !== newTypeIcon
          ) {
            card.title = newTitle
            card.typeId = s.typeId
            card.typeName = newTypeName
            card.typeColor = newTypeColor
            card.typeIcon = newTypeIcon
            changed = true
          }
        }
      }
      if (changed) notifyChange()
    })
    .catch(() => {})
}

watch(
  () => cards.value.length,
  () => refreshObjectSummaries(),
)

// Vasta Objects & Viewport Actions ----------------------------------------
function onPickObject(obj: ObjectSummary) {
  objectPickerOpen.value = false
  const type = typesById.value.get(obj.typeId)
  const isQuery = !!obj.query || type?.system === 'query'
  const cardW = isQuery ? 300 : 260
  const cardH = isQuery ? 220 : 110
  const rect = containerRef.value?.getBoundingClientRect()
  const centerX = rect ? (rect.width / 2 - pan.value.x) / zoom.value : 100
  const centerY = rect ? (rect.height / 2 - pan.value.y) / zoom.value : 100
  const card: ObjectCardElement = {
    id: newId(),
    objectId: obj.id,
    title: obj.title || displayTitle(obj, type),
    typeId: obj.typeId,
    typeName: type?.name || 'Page',
    ...(type?.color ? { typeColor: type.color } : {}),
    typeIcon: type?.icon?.value || 'ph:file-text',
    x: centerX - cardW / 2,
    y: centerY - cardH / 2,
    width: cardW,
    height: cardH,
    zIndex: getMaxZIndex() + 1,
  }
  cards.value.push(card)
  selected.value = [keyOf('card', card.id)]
  pushHistory()
}

function removeCard(id: string) {
  cards.value = cards.value.filter((c) => c.id !== id)
  detachAnchorsTo(new Set([id]))
  selected.value = selected.value.filter((k) => k !== keyOf('card', id))
  pushHistory()
}

function navigateToObject(objectId: Id) {
  router.push(`/o/${objectId}`)
}

function onConnectorRelationBadgeClick(connectorId: string) {
  currentTool.value = 'select'
  selected.value = [keyOf('shape', connectorId)]
  activePopover.value = 'selection-relation'
}

function onCardHeightChange(cardId?: string, height?: number) {
  if (cardId && height) {
    const card = cards.value.find((c) => c.id === cardId)
    if (card && card.height !== height) {
      card.height = height
      notifyChange()
    }
  }
  syncAnchoredConnectors()
}

function resetView() {
  pan.value = { x: 0, y: 0 }
  zoom.value = 1
  notifyChange()
}

function zoomIn() {
  zoom.value = Math.min(zoom.value * 1.25, 4)
  notifyChange()
}

function zoomOut() {
  zoom.value = Math.max(zoom.value / 1.25, 0.2)
  notifyChange()
}

function clearCanvas() {
  if (!allKeys().length) return
  strokes.value = []
  shapes.value = []
  cards.value = []
  stickies.value = []
  selected.value = []
  pushHistory()
}

function appendElements(patch: {
  shapes?: ShapeElement[]
  cards?: ObjectCardElement[]
  stickies?: StickyElement[]
  scenes?: WhiteboardScene[]
}) {
  let z = getMaxZIndex() + 1
  const newSelected: string[] = []
  for (const s of patch.scenes ?? []) {
    scenes.value.push(s)
    if (!defaultSceneId.value) defaultSceneId.value = s.id
  }
  for (const c of patch.cards ?? []) {
    c.zIndex = z++
    cards.value.push(c)
    newSelected.push(keyOf('card', c.id))
  }
  for (const st of patch.stickies ?? []) {
    st.zIndex = z++
    stickies.value.push(st)
    newSelected.push(keyOf('sticky', st.id))
  }
  for (const sh of patch.shapes ?? []) {
    sh.zIndex = isLine(sh) ? 1 : z++
    shapes.value.push(sh)
    newSelected.push(keyOf('shape', sh.id))
  }
  if (newSelected.length) {
    currentTool.value = 'select'
    selected.value = newSelected
    pushHistory()
  }
}

function autoLayout(direction: Direction | 'grid' = 'down') {
  const laid = autoLayoutWhiteboardData(getCurrentData(), direction)
  cards.value = laid.cards
  stickies.value = laid.stickies
  shapes.value = laid.shapes
  if (laid.scenes) scenes.value = laid.scenes
  pushHistory()
}

async function onPaste(e: ClipboardEvent) {
  const target = e.target as HTMLElement | null
  if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return
  const text = e.clipboardData?.getData('text/plain')?.trim()
  if (!text) return

  if (/^(graph|flowchart)\b/i.test(text)) {
    e.preventDefault()
    try {
      const patch = await mermaidToWhiteboardPatch(text, getCurrentData())
      appendElements(patch)
    } catch {
      // ignore invalid mermaid paste
    }
    return
  }

  if (text.startsWith('{') && (text.includes('"nodes"') || text.includes('"edges"'))) {
    try {
      const parsed = JSON.parse(text)
      if (parsed && typeof parsed === 'object' && (Array.isArray(parsed.nodes) || Array.isArray(parsed.edges))) {
        e.preventDefault()
        const patch = await jsonCanvasToWhiteboardPatch(parsed, getCurrentData())
        appendElements(patch)
      }
    } catch {
      // ignore non-canvas JSON
    }
  }
}

onMounted(() => {
  window.addEventListener('paste', onPaste)
})
onUnmounted(() => {
  window.removeEventListener('paste', onPaste)
})

provide(WHITEBOARD_CTX, {
  ...toolSettings,
  ...scenesState,
  ...historyState,
  ...selectionState,
  zoom,
  activeMode,
  startEditing,
  onPickObject,
  zoomIn,
  zoomOut,
  resetView,
})

defineExpose({
  undo,
  redo,
  zoomIn,
  zoomOut,
  resetView,
  clearCanvas,
  getCurrentData,
  appendElements,
  autoLayout,
  openObjectPicker: () => {
    objectPickerOpen.value = true
  },
  setThumbnailToCurrentView,
  clearThumbnail,
  thumbnailRect,
  scenes,
  defaultSceneId,
  isSceneDrawing,
  startDefiningScene,
  cancelDefiningScene,
  saveDefiningScene,
  setCurrentViewAsSceneDraft,
  focusScene,
  deleteScene,
  updateScene,
  setDefaultScene,
})

const polyPath = (pts: Point[]) => pts.map((p, i) => `${i ? 'L' : 'M'} ${p.x} ${p.y}`).join(' ') + ' Z'
const activeDraftConnectorGeo = computed(() =>
  currentShape.value && isLine(currentShape.value) ? getConnectorGeometry(currentShape.value) : null
)
</script>

<template>
  <div
    ref="containerRef"
    class="relative h-full w-full select-none overflow-hidden touch-none overscroll-none bg-surface"
    :class="currentTool === 'hand' ? (mousePanning || touchPanning ? 'cursor-grabbing' : 'cursor-grab') : undefined"
    style="-webkit-touch-callout: none; -webkit-user-select: none; user-select: none; overscroll-behavior: none;"
    @pointerdown="onPointerDown"
    @pointermove="onPointerMove"
    @pointerup="onPointerUp"
    @pointercancel="onPointerCancel"
  >
    <!-- Background Dot Grid (SVG vector pattern strictly bound to viewport matrix) -->
    <svg class="pointer-events-none absolute inset-0 h-full w-full">
      <defs>
        <pattern
          id="wb-dot-grid"
          width="24"
          height="24"
          patternUnits="userSpaceOnUse"
          :patternTransform="`translate(${pan.x}, ${pan.y}) scale(${zoom})`"
        >
          <circle cx="12" cy="12" :r="Math.max(0.6, 1 / zoom)" fill="currentColor" />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#wb-dot-grid)" class="text-ink opacity-[0.25] dark:opacity-[0.18]" />
    </svg>

    <!-- Main Viewport Layer -->
    <div class="pointer-events-none absolute left-0 top-0 h-full w-full origin-top-left" :style="{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }">
      <!-- Unified Canvas Elements Rendered in Exact Z-Order -->
      <template v-for="entry in allCanvasItems" :key="entry.key">
        <!-- 1. Ink Stroke -->
        <svg
          v-if="entry.kind === 'stroke'"
          class="pointer-events-none absolute left-0 top-0 h-px w-px overflow-visible"
          :style="{ zIndex: entry.zIndex }"
          :transform="entry.item.rotation && entry.center ? `rotate(${entry.item.rotation} ${entry.center.x} ${entry.center.y})` : undefined"
        >
          <path
            :d="entry.pathD"
            :stroke="entry.item.color"
            :stroke-width="entry.item.width"
            :stroke-dasharray="getStrokeDash(entry.item.style)"
            :opacity="entry.item.penType === 'highlighter' || entry.item.style === 'marker' ? 0.45 : 1"
            stroke-linecap="round"
            stroke-linejoin="round"
            fill="none"
          />
        </svg>

        <!-- 2. Shape (2D or 1D Connector) -->
        <template v-else-if="entry.kind === 'shape'">
          <svg
            class="pointer-events-none absolute left-0 top-0 h-px w-px overflow-visible"
            :style="{ zIndex: entry.zIndex }"
          >
            <g :transform="!entry.isLine && entry.item.rotation ? `rotate(${entry.item.rotation} ${entry.item.x + entry.item.width / 2} ${entry.item.y + entry.item.height / 2})` : undefined">
              <template v-if="entry.isLine && entry.connectorGeo">
                <path
                  :d="entry.connectorGeo.shaftPath"
                  :stroke="entry.item.color"
                  :stroke-width="entry.item.strokeWidth || 3"
                  :stroke-dasharray="getStrokeDash(entry.item.strokeStyle)"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  fill="none"
                />
                <path
                  v-if="entry.connectorGeo.startHead && entry.connectorGeo.startHeadType !== 'dot'"
                  :d="entry.connectorGeo.startHead"
                  :fill="entry.item.color"
                  stroke="none"
                />
                <path
                  v-if="entry.connectorGeo.endHead && entry.connectorGeo.endHeadType !== 'dot'"
                  :d="entry.connectorGeo.endHead"
                  :fill="entry.item.color"
                  stroke="none"
                />
              </template>

              <path
                v-else
                :d="shapePath(entry.item)"
                :stroke="entry.item.color"
                :stroke-width="entry.item.strokeWidth || 3"
                :stroke-dasharray="getStrokeDash(entry.item.strokeStyle)"
                :fill="getShapeFill(entry.item)"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
            </g>
          </svg>

          <!-- Centered Text Label & Inline Editor for 2D Shapes -->
          <div
            v-if="!entry.isLine && (entry.item.text || editingId === entry.item.id)"
            class="pointer-events-none absolute flex items-center justify-center p-2 text-center"
            :style="{
              left: `${Math.min(entry.item.x, entry.item.x + entry.item.width)}px`,
              top: `${Math.min(entry.item.y, entry.item.y + entry.item.height)}px`,
              width: `${Math.abs(entry.item.width)}px`,
              height: `${Math.abs(entry.item.height)}px`,
              zIndex: entry.zIndex + 1,
              transform: entry.item.rotation ? `rotate(${entry.item.rotation}deg)` : undefined,
              transformOrigin: 'center center',
            }"
          >
            <textarea
              v-if="editingId === entry.item.id"
              :id="`wb-shape-text-${entry.item.id}`"
              v-model="entry.item.text"
              placeholder="Label…"
              class="pointer-events-auto h-full w-full resize-none border-none bg-transparent p-0 text-center text-sm font-semibold leading-snug text-ink outline-none placeholder:opacity-40"
              @focus="onStickyFocus(entry.item)"
              @blur="onStickyBlur(entry.item)"
              @input="notifyChange"
              @pointerdown.stop
            />
            <span
              v-else
              class="max-h-full max-w-full overflow-hidden whitespace-pre-wrap break-words text-sm font-semibold leading-snug"
              :style="{ color: entry.item.fill === 'solid' && !entry.item.fillColor ? '#ffffff' : undefined }"
            >
              {{ entry.item.text }}
            </span>
          </div>

          <!-- On-Canvas Relation Badge for Linked Connectors -->
          <button
            v-if="entry.isLine && entry.relationInfo && entry.connectorGeo"
            type="button"
            data-wb-ui
            class="pointer-events-auto absolute flex items-center gap-1 rounded-full border bg-surface/95 px-2 py-0.5 text-[11px] font-semibold shadow-sm backdrop-blur-xs transition-transform hover:scale-105"
            :class="
              isSelected('shape', entry.item.id)
                ? 'border-primary text-primary ring-2 ring-primary/25'
                : 'border-line text-ink hover:border-primary/60'
            "
            :style="{
              left: `${entry.connectorGeo.labelPoint.x}px`,
              top: `${entry.connectorGeo.labelPoint.y}px`,
              zIndex: entry.zIndex + 1,
              transform:
                isSelected('shape', entry.item.id) && entry.connectorGeo.midPoint
                  ? 'translate(-50%, -145%)'
                  : 'translate(-50%, -50%)',
            }"
            :title="
              entry.item.text?.trim()
                ? `${entry.item.text.trim()} (Linked: ${entry.relationInfo.ownerTitle} · ${entry.relationInfo.propertyName} → ${entry.relationInfo.targetTitle})`
                : `${entry.relationInfo.ownerTitle} · ${entry.relationInfo.propertyName} → ${entry.relationInfo.targetTitle}`
            "
            @pointerdown.stop
            @click.stop="onConnectorRelationBadgeClick(entry.item.id)"
          >
            <AppIcon fallback="ph:link-simple" :size="11" class="text-primary shrink-0" />
            <span class="max-w-36 truncate">{{ entry.item.text?.trim() || entry.relationInfo.displayLabel }}</span>
          </button>

          <!-- Plain Text Label Pill for Non-Relation Connectors -->
          <button
            v-else-if="entry.isLine && entry.item.text?.trim() && entry.connectorGeo"
            type="button"
            data-wb-ui
            class="pointer-events-auto absolute flex items-center rounded-full border bg-surface/95 px-2 py-0.5 text-[11px] font-semibold shadow-xs backdrop-blur-xs transition-transform hover:scale-105 hover:border-primary/60"
            :class="
              isSelected('shape', entry.item.id)
                ? 'border-primary text-primary ring-2 ring-primary/25'
                : 'border-line text-ink hover:border-primary/60'
            "
            :style="{
              left: `${entry.connectorGeo.labelPoint.x}px`,
              top: `${entry.connectorGeo.labelPoint.y}px`,
              zIndex: entry.zIndex + 1,
              transform:
                isSelected('shape', entry.item.id) && entry.connectorGeo.midPoint
                  ? 'translate(-50%, -145%)'
                  : 'translate(-50%, -50%)',
            }"
            :title="`Connector label: ${entry.item.text.trim()}`"
            @pointerdown.stop
            @click.stop="onConnectorRelationBadgeClick(entry.item.id)"
          >
            <span class="max-w-36 truncate">{{ entry.item.text.trim() }}</span>
          </button>
        </template>

        <!-- 3. Object Card -->
        <WhiteboardObjectCard
          v-else-if="entry.kind === 'card'"
          :card="entry.item"
          :selected="isSelected('card', entry.item.id)"
          :style="{ zIndex: entry.zIndex }"
          @open="navigateToObject"
          @remove="removeCard"
          @heightChange="onCardHeightChange"
        />

        <!-- 4. Sticky Note -->
        <div
          v-else-if="entry.kind === 'sticky'"
          class="absolute flex flex-col rounded-xl border p-3 shadow-md pointer-events-none"
          :style="{
            left: `${entry.item.x}px`,
            top: `${entry.item.y}px`,
            width: `${entry.item.width}px`,
            height: `${entry.item.height}px`,
            zIndex: entry.zIndex,
            background: entry.palette.bg,
            borderColor: entry.palette.border,
            color: entry.item.textColor || entry.palette.text,
            transform: entry.item.rotation ? `rotate(${entry.item.rotation}deg)` : undefined,
            transformOrigin: 'center center',
            boxShadow: isSelected('sticky', entry.item.id) ? '0 0 0 2px #3b82f6' : undefined,
          }"
        >
          <textarea
            :id="`wb-sticky-${entry.item.id}`"
            v-model="entry.item.text"
            placeholder="Write a note…"
            class="h-full w-full resize-none border-none bg-transparent p-0 outline-none placeholder:opacity-40"
            :style="{
              fontSize: STICKY_FONT_SIZES[entry.item.fontSize || 'md'],
              color: entry.item.textColor || entry.palette.text,
              pointerEvents: editingId === entry.item.id ? 'auto' : 'none',
              userSelect: editingId === entry.item.id ? 'text' : 'none',
              WebkitUserSelect: editingId === entry.item.id ? 'text' : 'none',
            }"
            @focus="onStickyFocus(entry.item)"
            @blur="onStickyBlur(entry.item)"
            @input="notifyChange"
            @pointerdown.stop
          />
        </div>
      </template>

      <!-- Dot terminations overlay (always on top of cards, stickies, and 2D shapes) -->
      <template v-for="entry in allCanvasItems" :key="`dot-${entry.key}`">
        <svg
          v-if="entry.kind === 'shape' && entry.isLine && entry.connectorGeo && (entry.connectorGeo.startDot || entry.connectorGeo.endDot)"
          class="pointer-events-none absolute left-0 top-0 h-px w-px overflow-visible"
          :style="{ zIndex: 20000 + entry.zIndex }"
        >
          <path
            v-if="entry.connectorGeo.startDot"
            :d="entry.connectorGeo.startDot"
            :fill="entry.item.color"
            stroke="none"
          />
          <path
            v-if="entry.connectorGeo.endDot"
            :d="entry.connectorGeo.endDot"
            :fill="entry.item.color"
            stroke="none"
          />
        </svg>
      </template>

      <!-- Active Drawing / Shape Overlay (Live in progress) -->
      <svg v-if="currentStroke || currentShape" class="pointer-events-none absolute left-0 top-0 h-px w-px overflow-visible" :style="{ zIndex: 999999 }">
        <path
          v-if="currentStroke"
          :d="currentStroke.points.map((p, i) => `${i ? 'L' : 'M'} ${p.x} ${p.y}`).join(' ')"
          :stroke="currentStroke.color"
          :stroke-width="currentStroke.width"
          :stroke-dasharray="getStrokeDash(currentStroke.style)"
          :opacity="currentStroke.penType === 'highlighter' ? 0.45 : 1"
          stroke-linecap="round"
          stroke-linejoin="round"
          fill="none"
        />
        <g v-if="currentShape">
          <template v-if="activeDraftConnectorGeo">
            <path
              :d="activeDraftConnectorGeo.shaftPath"
              :stroke="currentShape.color"
              :stroke-width="currentShape.strokeWidth || 3"
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-dasharray="6 5"
              fill="none"
            />
            <path
              v-if="activeDraftConnectorGeo.startHead && activeDraftConnectorGeo.startHeadType !== 'dot'"
              :d="activeDraftConnectorGeo.startHead"
              :fill="currentShape.color"
              stroke="none"
            />
            <path
              v-if="activeDraftConnectorGeo.endHead && activeDraftConnectorGeo.endHeadType !== 'dot'"
              :d="activeDraftConnectorGeo.endHead"
              :fill="currentShape.color"
              stroke="none"
            />
            <path
              v-if="activeDraftConnectorGeo.startDot"
              :d="activeDraftConnectorGeo.startDot"
              :fill="currentShape.color"
              stroke="none"
            />
            <path
              v-if="activeDraftConnectorGeo.endDot"
              :d="activeDraftConnectorGeo.endDot"
              :fill="currentShape.color"
              stroke="none"
            />
          </template>
          <path
            v-else
            :d="shapePath(currentShape)"
            :stroke="currentShape.color"
            :stroke-width="currentShape.strokeWidth || 3"
            :fill="getShapeFill(currentShape)"
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-dasharray="6 5"
          />
        </g>
      </svg>

      <!-- Active Sticky Note Overlay (Live in progress) -->
      <div
        v-if="currentDraftSticky"
        class="absolute flex flex-col rounded-xl border p-3 shadow-md pointer-events-none"
        :style="{
          left: `${currentDraftSticky.x}px`,
          top: `${currentDraftSticky.y}px`,
          width: `${currentDraftSticky.width}px`,
          height: `${currentDraftSticky.height}px`,
          zIndex: 999999,
          background: stickyStyle(currentDraftSticky.color).bg,
          borderColor: stickyStyle(currentDraftSticky.color).border,
          borderStyle: 'dashed',
          opacity: 0.85,
        }"
      />

      <!-- Selection & Resize Handles Overlay -->
      <svg
        class="pointer-events-none absolute left-0 top-0 h-px w-px overflow-visible"
        :style="{ zIndex: 1000000 }"
      >
        <template v-if="selectedGeometry && !isOnlySelectedLine">
          <g :transform="selectedGeometry.rotation ? `rotate(${selectedGeometry.rotation} ${selectedGeometry.center.x} ${selectedGeometry.center.y})` : undefined">
            <rect
              :x="selectedGeometry.box.x"
              :y="selectedGeometry.box.y"
              :width="selectedGeometry.box.w"
              :height="selectedGeometry.box.h"
              fill="none"
              stroke="#3b82f6"
              stroke-width="1.5"
              stroke-dasharray="6 4"
              vector-effect="non-scaling-stroke"
            />
            <template v-if="selectedGeometry.rotateHandle">
              <line
                :x1="selectedGeometry.center.x"
                :y1="selectedGeometry.box.y"
                :x2="selectedGeometry.center.x"
                :y2="selectedGeometry.box.y - 28"
                stroke="#3b82f6"
                stroke-width="1.5"
                vector-effect="non-scaling-stroke"
              />
              <circle
                :cx="selectedGeometry.center.x"
                :cy="selectedGeometry.box.y - 28"
                :r="7 / zoom"
                fill="white"
                stroke="#3b82f6"
                :stroke-width="2 / zoom"
              />
            </template>
          </g>
        </template>
        <!-- Visual Snap Candidate Feedback (4 edge ports on target + active snap ring) -->
        <template v-if="hoveredSnapAnchor">
          <circle
            v-for="ap in getAllAnchorPoints(hoveredSnapAnchor.target)"
            :key="ap.side"
            :cx="ap.point.x"
            :cy="ap.point.y"
            :r="(ap.side === hoveredSnapAnchor.side ? 6.5 : 4.5) / zoom"
            :fill="ap.side === hoveredSnapAnchor.side ? '#3b82f6' : 'white'"
            stroke="#3b82f6"
            :stroke-width="2 / zoom"
          />
          <circle
            :cx="hoveredSnapAnchor.point.x"
            :cy="hoveredSnapAnchor.point.y"
            :r="12 / zoom"
            fill="#3b82f626"
            stroke="#3b82f6"
            :stroke-width="1.75 / zoom"
          />
        </template>
        <circle
          v-for="h in handles"
          :key="h.id"
          :cx="h.x"
          :cy="h.y"
          :r="(isOnlySelectedLine ? 9 : 8) / zoom"
          :fill="isOnlySelectedLine && ((h.id === 'start' && selectionStartAnchored) || (h.id === 'end' && selectionEndAnchored)) ? '#dbeafe' : 'white'"
          stroke="#3b82f6"
          :stroke-width="2 / zoom"
        />
        <rect
          v-if="marquee"
          :x="marquee.x"
          :y="marquee.y"
          :width="marquee.w"
          :height="marquee.h"
          fill="#3b82f61a"
          stroke="#3b82f6"
          stroke-width="1.5"
          stroke-dasharray="5 4"
          vector-effect="non-scaling-stroke"
        />
        <path
          v-if="lasso && lasso.length > 1"
          :d="polyPath(lasso)"
          fill="#3b82f61a"
          stroke="#3b82f6"
          stroke-width="1.5"
          stroke-dasharray="5 4"
          vector-effect="non-scaling-stroke"
        />
      </svg>
    </div>

    <!-- Scene Defining Overlay, Selection Floating Menu & Selection Popovers -->
    <WhiteboardPopovers />

    <!-- Bottom Tool Dock, Secondary Tool Popovers & Zoom Controls -->
    <WhiteboardToolbar />
  </div>
</template>
