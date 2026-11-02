import { computed, ref, type Ref } from 'vue'
import type { InkStroke, ObjectCardElement, ShapeElement, StickyElement } from './types.ts'

export interface HistorySnapshot {
  strokes: InkStroke[]
  shapes: ShapeElement[]
  cards: ObjectCardElement[]
  stickies: StickyElement[]
}

export interface UseWhiteboardHistoryOptions {
  strokes: Ref<InkStroke[]>
  shapes: Ref<ShapeElement[]>
  cards: Ref<ObjectCardElement[]>
  stickies: Ref<StickyElement[]>
  selected: Ref<string[]>
  editingId: Ref<string | null>
  ensureZIndices: () => void
  renormalizeZIndices: () => void
  notifyChange: () => void
  onUndo?: () => void
  onRedo?: () => void
}

export function useWhiteboardHistory(opts: UseWhiteboardHistoryOptions) {
  const {
    strokes,
    shapes,
    cards,
    stickies,
    selected,
    editingId,
    ensureZIndices,
    renormalizeZIndices,
    notifyChange,
    onUndo,
    onRedo,
  } = opts

  const snapshot = (): HistorySnapshot =>
    JSON.parse(
      JSON.stringify({
        strokes: strokes.value,
        shapes: shapes.value,
        cards: cards.value,
        stickies: stickies.value,
      }),
    )

  const history = ref<HistorySnapshot[]>([snapshot()])
  const historyIndex = ref(0)

  const canUndo = computed(() => historyIndex.value > 0)
  const canRedo = computed(() => historyIndex.value < history.value.length - 1)

  function pushHistory() {
    history.value = history.value.slice(0, historyIndex.value + 1)
    history.value.push(snapshot())
    if (history.value.length > 60) history.value.shift()
    historyIndex.value = history.value.length - 1
    notifyChange()
  }

  function restore(index: number) {
    const snap = history.value[index]
    if (!snap) return
    historyIndex.value = index
    const copy: HistorySnapshot = JSON.parse(JSON.stringify(snap))
    strokes.value = copy.strokes
    shapes.value = copy.shapes
    cards.value = copy.cards
    stickies.value = copy.stickies
    ensureZIndices()
    renormalizeZIndices()
    selected.value = []
    editingId.value = null
    notifyChange()
  }

  function undo() {
    if (historyIndex.value > 0) {
      restore(historyIndex.value - 1)
      onUndo?.()
    }
  }

  function redo() {
    if (historyIndex.value < history.value.length - 1) {
      restore(historyIndex.value + 1)
      onRedo?.()
    }
  }

  return {
    history,
    historyIndex,
    canUndo,
    canRedo,
    pushHistory,
    restore,
    undo,
    redo,
  }
}
