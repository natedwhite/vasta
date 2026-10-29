import { computed, ref, type ComputedRef, type Ref } from 'vue'
import { newId } from './ids.ts'
import type { Point, WhiteboardData, WhiteboardScene } from './types.ts'

export type SceneHandle = 'drag_new' | 'nw' | 'ne' | 'se' | 'sw' | 'body' | null

export interface UseWhiteboardScenesOptions {
  initialData?: Partial<WhiteboardData>
  containerRef: Ref<HTMLElement | null>
  pan: Ref<{ x: number; y: number }>
  zoom: Ref<number>
  pencilOnly: ComputedRef<boolean>
  setPen: (present: boolean) => void
  getCanvasCoords: (clientX: number, clientY: number) => Point
  closeAllPopovers: () => void
  notifyChange: () => void
}

export function useWhiteboardScenes(opts: UseWhiteboardScenesOptions) {
  const {
    initialData,
    containerRef,
    pan,
    zoom,
    pencilOnly,
    setPen,
    getCanvasCoords,
    closeAllPopovers,
    notifyChange,
  } = opts

  const thumbnailRect = ref<{ x: number; y: number; w: number; h: number } | undefined>(
    initialData?.thumbnailRect,
  )
  const scenes = ref<WhiteboardScene[]>(
    initialData?.scenes ? initialData.scenes.map((s) => ({ ...s, rect: { ...s.rect } })) : [],
  )
  const defaultSceneId = ref<string | undefined>(
    initialData?.defaultSceneId || scenes.value.find((s) => s.isDefault)?.id || scenes.value[0]?.id,
  )

  // Legacy thumbnail migration:
  if (initialData?.thumbnailRect && scenes.value.length === 0) {
    const migId = newId()
    scenes.value.push({
      id: migId,
      name: 'Main Scene',
      rect: { ...initialData.thumbnailRect },
      isDefault: true,
    })
    defaultSceneId.value = migId
  }

  // Scene Defining Mode (interactive drag rectangle)
  const isSceneDrawing = ref(false)
  const editingSceneId = ref<string | null>(null)
  const editingSceneName = ref('Scene 1')
  const sceneDragStart = ref<Point | null>(null)
  const sceneOriginalRect = ref<{ x: number; y: number; w: number; h: number } | null>(null)
  const sceneDraftRect = ref<{ x: number; y: number; w: number; h: number } | null>(null)
  const sceneActiveHandle = ref<SceneHandle>(null)

  const sceneDraftScreenRect = computed(() => {
    if (!sceneDraftRect.value) return null
    const { x, y, w, h } = sceneDraftRect.value
    return {
      x: x * zoom.value + pan.value.x,
      y: y * zoom.value + pan.value.y,
      w: w * zoom.value,
      h: h * zoom.value,
    }
  })

  function getAspectRatioText(w: number, h: number): string {
    if (w <= 0 || h <= 0) return ''
    const ratio = w / h
    if (Math.abs(ratio - 16 / 9) < 0.08) return '16:9'
    if (Math.abs(ratio - 4 / 3) < 0.08) return '4:3'
    if (Math.abs(ratio - 1) < 0.08) return '1:1'
    if (Math.abs(ratio - 3 / 2) < 0.08) return '3:2'
    if (Math.abs(ratio - 21 / 9) < 0.1) return '21:9'
    return `${ratio.toFixed(2)}:1`
  }

  function startDefiningScene(sceneId?: string, defaultName?: string) {
    closeAllPopovers()
    if (sceneId) {
      const s = scenes.value.find((item) => item.id === sceneId)
      if (s) {
        editingSceneId.value = s.id
        editingSceneName.value = s.name
        sceneDraftRect.value = { ...s.rect }
      }
    } else {
      editingSceneId.value = null
      editingSceneName.value = defaultName || `Scene ${scenes.value.length + 1}`
      sceneDraftRect.value = null
    }
    isSceneDrawing.value = true
  }

  function cancelDefiningScene() {
    isSceneDrawing.value = false
    editingSceneId.value = null
    sceneDraftRect.value = null
    sceneOriginalRect.value = null
    sceneDragStart.value = null
    sceneActiveHandle.value = null
  }

  function saveDefiningScene(): WhiteboardScene | null {
    if (!sceneDraftRect.value || sceneDraftRect.value.w < 10 || sceneDraftRect.value.h < 10) return null
    const rect = {
      x: Math.round(sceneDraftRect.value.x),
      y: Math.round(sceneDraftRect.value.y),
      w: Math.round(sceneDraftRect.value.w),
      h: Math.round(sceneDraftRect.value.h),
    }
    const name = editingSceneName.value.trim() || (editingSceneId.value ? 'Scene' : `Scene ${scenes.value.length + 1}`)
    let saved: WhiteboardScene

    if (editingSceneId.value) {
      const target = scenes.value.find((s) => s.id === editingSceneId.value)
      if (target) {
        target.name = name
        target.rect = rect
        saved = target
      } else {
        return null
      }
    } else {
      const isFirst = scenes.value.length === 0
      saved = {
        id: newId(),
        name,
        rect,
        isDefault: isFirst,
      }
      if (isFirst) {
        defaultSceneId.value = saved.id
      }
      scenes.value.push(saved)
    }

    if (saved.isDefault || defaultSceneId.value === saved.id || scenes.value.length === 1) {
      thumbnailRect.value = { ...rect }
    }

    cancelDefiningScene()
    notifyChange()
    return saved
  }

  function setCurrentViewAsSceneDraft() {
    if (!containerRef.value) return
    const w = containerRef.value.clientWidth
    const h = containerRef.value.clientHeight
    sceneDraftRect.value = {
      x: Math.round(-pan.value.x / zoom.value),
      y: Math.round(-pan.value.y / zoom.value),
      w: Math.round(w / zoom.value),
      h: Math.round(h / zoom.value),
    }
  }

  function focusScene(id: string) {
    const s = scenes.value.find((item) => item.id === id)
    if (!s || !containerRef.value) return
    const w = containerRef.value.clientWidth
    const h = containerRef.value.clientHeight
    const pad = 60
    const zX = (w - pad * 2) / s.rect.w
    const zY = (h - pad * 2) / s.rect.h
    const targetZoom = Math.min(2.5, Math.max(0.1, Math.min(zX, zY)))
    const targetPanX = Math.round(w / 2 - (s.rect.x + s.rect.w / 2) * targetZoom)
    const targetPanY = Math.round(h / 2 - (s.rect.y + s.rect.h / 2) * targetZoom)
    zoom.value = targetZoom
    pan.value = { x: targetPanX, y: targetPanY }
    notifyChange()
  }

  function deleteScene(id: string) {
    const idx = scenes.value.findIndex((s) => s.id === id)
    if (idx !== -1) {
      const target = scenes.value[idx]
      const wasDefault = target ? target.isDefault || defaultSceneId.value === id : false
      scenes.value.splice(idx, 1)
      const first = scenes.value[0]
      if (wasDefault && first) {
        first.isDefault = true
        defaultSceneId.value = first.id
        thumbnailRect.value = { ...first.rect }
      } else if (scenes.value.length === 0) {
        defaultSceneId.value = undefined
        thumbnailRect.value = undefined
      }
      notifyChange()
    }
  }

  function updateScene(id: string, updates: Partial<WhiteboardScene>) {
    const target = scenes.value.find((s) => s.id === id)
    if (target) {
      if (updates.isDefault) {
        scenes.value.forEach((s) => (s.isDefault = false))
        defaultSceneId.value = id
        thumbnailRect.value = { ...target.rect }
      }
      Object.assign(target, updates)
      notifyChange()
    }
  }

  function setDefaultScene(id: string) {
    scenes.value.forEach((s) => {
      s.isDefault = s.id === id
    })
    defaultSceneId.value = id
    const target = scenes.value.find((s) => s.id === id)
    if (target) {
      thumbnailRect.value = { ...target.rect }
    }
    notifyChange()
  }

  function setThumbnailToCurrentView(): { x: number; y: number; w: number; h: number } {
    const w = containerRef.value?.clientWidth || 800
    const h = containerRef.value?.clientHeight || 600
    const rect = {
      x: Math.round(-pan.value.x / zoom.value),
      y: Math.round(-pan.value.y / zoom.value),
      w: Math.round(w / zoom.value),
      h: Math.round(h / zoom.value),
    }
    thumbnailRect.value = rect
    notifyChange()
    return rect
  }

  function clearThumbnail() {
    thumbnailRect.value = undefined
    notifyChange()
  }

  const sceneTouchIds = new Set<number>()
  let sceneTouchPanning = false
  let sceneTouchPanStart = { x: 0, y: 0 }

  function startSceneInteraction(e: PointerEvent) {
    const pt = getCanvasCoords(e.clientX, e.clientY)
    sceneDragStart.value = pt

    if (sceneDraftRect.value && sceneDraftRect.value.w > 10 && sceneDraftRect.value.h > 10) {
      const r = sceneDraftRect.value
      sceneOriginalRect.value = { ...r }
      const tol = Math.max(16, 24 / zoom.value)

      const distNW = Math.hypot(pt.x - r.x, pt.y - r.y)
      const distNE = Math.hypot(pt.x - (r.x + r.w), pt.y - r.y)
      const distSE = Math.hypot(pt.x - (r.x + r.w), pt.y - (r.y + r.h))
      const distSW = Math.hypot(pt.x - r.x, pt.y - (r.y + r.h))

      if (distNW <= tol) {
        sceneActiveHandle.value = 'nw'
        return
      }
      if (distNE <= tol) {
        sceneActiveHandle.value = 'ne'
        return
      }
      if (distSE <= tol) {
        sceneActiveHandle.value = 'se'
        return
      }
      if (distSW <= tol) {
        sceneActiveHandle.value = 'sw'
        return
      }
      if (pt.x >= r.x && pt.x <= r.x + r.w && pt.y >= r.y && pt.y <= r.y + r.h) {
        sceneActiveHandle.value = 'body'
        return
      }
    }

    sceneOriginalRect.value = null
    sceneDraftRect.value = { x: pt.x, y: pt.y, w: 0, h: 0 }
    sceneActiveHandle.value = 'drag_new'
  }

  function onScenePointerDown(e: PointerEvent) {
    e.stopPropagation()
    if (e.pointerType === 'pen') {
      setPen(true)
      startSceneInteraction(e)
      return
    }

    if (e.pointerType === 'touch') {
      sceneTouchIds.add(e.pointerId)
      if (sceneTouchIds.size > 1) {
        sceneActiveHandle.value = null
        sceneDragStart.value = null
        sceneTouchPanning = false
        return
      }

      if (pencilOnly.value) {
        sceneTouchPanning = true
        sceneTouchPanStart = { x: e.clientX, y: e.clientY }
        return
      }

      startSceneInteraction(e)
      return
    }

    if (e.button === 1 || e.altKey) {
      sceneTouchPanning = true
      sceneTouchPanStart = { x: e.clientX, y: e.clientY }
      return
    }
    if (e.button === 0) {
      startSceneInteraction(e)
    }
  }

  function onScenePointerMove(e: PointerEvent) {
    if (e.pointerType === 'touch' && sceneTouchPanning && sceneTouchIds.size === 1) {
      const dx = e.clientX - sceneTouchPanStart.x
      const dy = e.clientY - sceneTouchPanStart.y
      pan.value = { x: pan.value.x + dx, y: pan.value.y + dy }
      sceneTouchPanStart = { x: e.clientX, y: e.clientY }
      return
    }

    if (sceneTouchPanning && (e.buttons === 4 || e.altKey)) {
      const dx = e.clientX - sceneTouchPanStart.x
      const dy = e.clientY - sceneTouchPanStart.y
      pan.value = { x: pan.value.x + dx, y: pan.value.y + dy }
      sceneTouchPanStart = { x: e.clientX, y: e.clientY }
      return
    }

    if (!sceneActiveHandle.value || !sceneDragStart.value) return
    const pt = getCanvasCoords(e.clientX, e.clientY)

    if (sceneActiveHandle.value === 'drag_new') {
      const x = Math.min(sceneDragStart.value.x, pt.x)
      const y = Math.min(sceneDragStart.value.y, pt.y)
      const w = Math.abs(pt.x - sceneDragStart.value.x)
      const h = Math.abs(pt.y - sceneDragStart.value.y)
      sceneDraftRect.value = { x, y, w, h }
      return
    }

    const orig = sceneOriginalRect.value
    if (!orig) return

    if (sceneActiveHandle.value === 'body') {
      const dx = pt.x - sceneDragStart.value.x
      const dy = pt.y - sceneDragStart.value.y
      sceneDraftRect.value = { x: orig.x + dx, y: orig.y + dy, w: orig.w, h: orig.h }
      return
    }

    if (sceneActiveHandle.value === 'nw') {
      const right = orig.x + orig.w
      const bottom = orig.y + orig.h
      const newX = Math.min(pt.x, right - 10)
      const newY = Math.min(pt.y, bottom - 10)
      sceneDraftRect.value = { x: newX, y: newY, w: right - newX, h: bottom - newY }
      return
    }

    if (sceneActiveHandle.value === 'ne') {
      const bottom = orig.y + orig.h
      const newY = Math.min(pt.y, bottom - 10)
      const newW = Math.max(10, pt.x - orig.x)
      sceneDraftRect.value = { x: orig.x, y: newY, w: newW, h: bottom - newY }
      return
    }

    if (sceneActiveHandle.value === 'se') {
      const newW = Math.max(10, pt.x - orig.x)
      const newH = Math.max(10, pt.y - orig.y)
      sceneDraftRect.value = { x: orig.x, y: orig.y, w: newW, h: newH }
      return
    }

    if (sceneActiveHandle.value === 'sw') {
      const right = orig.x + orig.w
      const newX = Math.min(pt.x, right - 10)
      const newH = Math.max(10, pt.y - orig.y)
      sceneDraftRect.value = { x: newX, y: orig.y, w: right - newX, h: newH }
      return
    }
  }

  function onScenePointerUp(e: PointerEvent) {
    const wasPanning = sceneTouchPanning
    if (e.pointerType === 'touch') {
      sceneTouchIds.delete(e.pointerId)
      if (sceneTouchIds.size === 0) {
        sceneTouchPanning = false
      }
    } else {
      sceneTouchPanning = false
    }
    if (wasPanning && !sceneTouchPanning) {
      notifyChange()
    }
    sceneActiveHandle.value = null
    sceneDragStart.value = null
    sceneOriginalRect.value = null
  }

  return {
    thumbnailRect,
    scenes,
    defaultSceneId,
    isSceneDrawing,
    editingSceneId,
    editingSceneName,
    sceneDragStart,
    sceneOriginalRect,
    sceneDraftRect,
    sceneActiveHandle,
    sceneDraftScreenRect,
    getAspectRatioText,
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
    onScenePointerDown,
    onScenePointerMove,
    onScenePointerUp,
  }
}
