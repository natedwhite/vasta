import { ref, type Ref } from 'vue'
import type { Point } from './types.ts'

export interface GestureOptions {
  containerRef: Ref<HTMLElement | null>
  isPencilOnly: Ref<boolean>
  zoom: Ref<number>
  pan: Ref<{ x: number; y: number }>
  isSceneDrawing?: Ref<boolean>
  onTwoFingerTap?: () => void
  onThreeFingerTap?: () => void
  onSingleTouchTap?: (point: Point, client: { x: number; y: number }) => void
  onPinchStart?: () => void
  onPinchEnd?: () => void
  onPenStrokeStart?: (point: { x: number; y: number; pressure: number }) => void
  onPenStrokeMove?: (point: { x: number; y: number; pressure: number }) => void
  onPenStrokeEnd?: () => void
}

export function usePencilGestures(options: GestureOptions) {
  const {
    containerRef,
    isPencilOnly,
    zoom,
    pan,
    isSceneDrawing,
    onTwoFingerTap,
    onThreeFingerTap,
    onSingleTouchTap,
    onPinchStart,
    onPinchEnd,
    onPenStrokeStart,
    onPenStrokeMove,
    onPenStrokeEnd,
  } = options

  // Active pen pointer tracking (for palm rejection)
  const activePenId = ref<number | null>(null)
  const lastPenTime = ref<number>(0)
  let lastTapActionTime = 0
  let penStartPos = { x: 0, y: 0 }
  let penMaxDist = 0

  // Multi-touch tap & pinch state
  let touchStartTime = 0
  let touchInitialCount = 0
  let touchStartPoints: { x: number; y: number }[] = []
  let touchMaxDisplacement = 0
  const isPinching = ref(false)
  let initialPinchDistance = 0
  let initialPinchZoom = 1
  let pinchAnchorWorld = { x: 0, y: 0 }

  function getCanvasCoords(clientX: number, clientY: number): { x: number; y: number } {
    if (!containerRef.value) return { x: 0, y: 0 }
    const rect = containerRef.value.getBoundingClientRect()
    return {
      x: (clientX - rect.left - pan.value.x) / zoom.value,
      y: (clientY - rect.top - pan.value.y) / zoom.value,
    }
  }

  function isUiTarget(e: Event): boolean {
    return !!(e.target as Element | null)?.closest?.('[data-wb-ui]')
  }

  function startPinch(touches: TouchList) {
    if (touches.length < 2 || !containerRef.value) return
    const t1 = touches[0]!
    const t2 = touches[1]!
    const dist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY)
    if (dist < 10) return

    const rect = containerRef.value.getBoundingClientRect()
    const centerScreen = {
      x: (t1.clientX + t2.clientX) / 2 - rect.left,
      y: (t1.clientY + t2.clientY) / 2 - rect.top,
    }

    isPinching.value = true
    initialPinchDistance = dist
    initialPinchZoom = zoom.value
    // The exact canvas point directly beneath the midpoint between the fingers:
    pinchAnchorWorld = {
      x: (centerScreen.x - pan.value.x) / zoom.value,
      y: (centerScreen.y - pan.value.y) / zoom.value,
    }
    onPinchStart?.()
  }

  function updatePinch(touches: TouchList) {
    if (touches.length < 2 || !containerRef.value || !isPinching.value || initialPinchDistance <= 0) return
    const t1 = touches[0]!
    const t2 = touches[1]!
    const currentDistance = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY)
    const scaleFactor = currentDistance / initialPinchDistance
    const nextZoom = Math.min(Math.max(initialPinchZoom * scaleFactor, 0.2), 4)

    const rect = containerRef.value.getBoundingClientRect()
    const currentCenter = {
      x: (t1.clientX + t2.clientX) / 2 - rect.left,
      y: (t1.clientY + t2.clientY) / 2 - rect.top,
    }

    // Anchor point in world space MUST remain directly beneath the midpoint of fingers:
    zoom.value = nextZoom
    pan.value = {
      x: currentCenter.x - pinchAnchorWorld.x * nextZoom,
      y: currentCenter.y - pinchAnchorWorld.y * nextZoom,
    }
  }

  function endPinch() {
    if (isPinching.value) {
      isPinching.value = false
      onPinchEnd?.()
    }
  }

  // Pointer events: Pen drawing and palm rejection
  function handlePointerDown(e: PointerEvent) {
    if (isUiTarget(e)) return
    if (e.pointerType === 'pen') {
      lastPenTime.value = performance.now()
      activePenId.value = e.pointerId
      penStartPos = { x: e.clientX, y: e.clientY }
      penMaxDist = 0
      if (isSceneDrawing?.value) return
      const coords = getCanvasCoords(e.clientX, e.clientY)
      onPenStrokeStart?.({
        x: coords.x,
        y: coords.y,
        pressure: e.pressure || 0.5,
      })
      e.preventDefault()
    } else if (e.pointerType === 'touch') {
      const isPalm = (e.width && e.width > 75) || (e.height && e.height > 75)
      // Reject if Apple Pencil is currently on screen, contact area is huge (palm), or recent pen writing (< 400ms)
      if (activePenId.value !== null || isPalm || performance.now() - lastPenTime.value < 400) {
        e.preventDefault()
      }
    }
  }

  function handlePointerMove(e: PointerEvent) {
    if (isUiTarget(e)) return
    if (e.pointerType === 'pen' && activePenId.value === e.pointerId) {
      lastPenTime.value = performance.now()
      if (isSceneDrawing?.value) return
      const d = Math.hypot(e.clientX - penStartPos.x, e.clientY - penStartPos.y)
      if (d > penMaxDist) penMaxDist = d
      const coords = getCanvasCoords(e.clientX, e.clientY)
      onPenStrokeMove?.({
        x: coords.x,
        y: coords.y,
        pressure: e.pressure || 0.5,
      })
      e.preventDefault()
    } else if (e.pointerType === 'touch') {
      const isPalm = (e.width && e.width > 75) || (e.height && e.height > 75)
      if (activePenId.value !== null || isPalm || performance.now() - lastPenTime.value < 400) {
        e.preventDefault()
      }
    }
  }

  function handlePointerUp(e: PointerEvent) {
    if (isUiTarget(e)) return
    if (e.pointerType === 'pen') {
      lastPenTime.value = performance.now()
      activePenId.value = null
      if (isSceneDrawing?.value) return
      onPenStrokeEnd?.()
      e.preventDefault()
    }
  }

  function handlePointerCancel(e: PointerEvent) {
    if (e.pointerType === 'pen') {
      lastPenTime.value = performance.now()
      activePenId.value = null
      if (!isSceneDrawing?.value) {
        onPenStrokeEnd?.()
      }
    }
  }

  // Multi-touch gestures: 2-finger tap (undo), 3-finger tap (redo), 2-finger pinch (zoom)
  function handleTouchStart(e: TouchEvent) {
    if (isUiTarget(e)) return
    // Always swallow stylus touches so Safari never synthesizes browser gestures or text selection
    for (let i = 0; i < e.touches.length; i++) {
      const t = e.touches[i]! as any
      if (t.touchType === 'stylus') {
        e.preventDefault()
        return
      }
    }
    // Palm rejection: if pencil is touching or was active within 400ms, ignore touch
    if (activePenId.value !== null || performance.now() - lastPenTime.value < 400) {
      e.preventDefault()
      return
    }

    // Only apply large palm rejection if it's a single contact.
    // Multi-touch gestures (e.g. thumb + finger) often have larger contact area and must NOT be rejected!
    if (e.touches.length === 1) {
      const t = e.touches[0]! as any
      if ((t.radiusX && t.radiusX > 55) || (t.radiusY && t.radiusY > 55)) {
        e.preventDefault()
        return
      }
    }

    touchStartTime = performance.now()
    touchInitialCount = e.touches.length
    touchMaxDisplacement = 0
    touchStartPoints = Array.from(e.touches).map((t) => ({ x: t.clientX, y: t.clientY }))

    if (e.touches.length === 2) {
      startPinch(e.touches)
      e.preventDefault()
    }
  }

  function handleTouchMove(e: TouchEvent) {
    if (isUiTarget(e)) return
    for (let i = 0; i < e.touches.length; i++) {
      if ((e.touches[i] as any).touchType === 'stylus') {
        e.preventDefault()
        return
      }
    }
    if (activePenId.value !== null || performance.now() - lastPenTime.value < 400) {
      e.preventDefault()
      return
    }

    // Track displacement from initial touch points for tap detection
    for (let i = 0; i < e.touches.length && i < touchStartPoints.length; i++) {
      const t = e.touches[i]!
      const start = touchStartPoints[i]!
      const dist = Math.hypot(t.clientX - start.x, t.clientY - start.y)
      if (dist > touchMaxDisplacement) {
        touchMaxDisplacement = dist
      }
    }

    // Handle 2-finger pinch to zoom & pan
    if (e.touches.length === 2) {
      if (!isPinching.value) {
        startPinch(e.touches)
      } else {
        updatePinch(e.touches)
      }
      e.preventDefault()
      return
    }
  }

  function handleTouchEnd(e: TouchEvent) {
    if (isUiTarget(e)) return
    for (let i = 0; i < e.changedTouches.length; i++) {
      if ((e.changedTouches[i] as any).touchType === 'stylus') {
        e.preventDefault()
        return
      }
    }
    if (activePenId.value !== null || performance.now() - lastPenTime.value < 400) {
      e.preventDefault()
      return
    }

    const duration = performance.now() - touchStartTime

    // Check for multi-finger tap: quick (< 280ms) and minimal movement (< 14px)
    if (duration < 280 && touchMaxDisplacement < 14) {
      const now = performance.now()
      if (now - lastTapActionTime > 300) {
        if (touchInitialCount === 2) {
          lastTapActionTime = now
          touchInitialCount = 0
          endPinch()
          onTwoFingerTap?.()
          e.preventDefault()
          return
        }
        if (touchInitialCount === 3) {
          lastTapActionTime = now
          touchInitialCount = 0
          endPinch()
          onThreeFingerTap?.()
          e.preventDefault()
          return
        }
      }
    }

    if (e.touches.length < 2) {
      endPinch()
    }

    // Check for single finger tap in pencil mode: quick (< 350ms) and minimal movement (< 8px)
    if (
      isPencilOnly.value &&
      !isSceneDrawing?.value &&
      touchInitialCount === 1 &&
      duration < 350 &&
      touchMaxDisplacement < 8 &&
      touchStartPoints[0]
    ) {
      const p = touchStartPoints[0]
      const coords = getCanvasCoords(p.x, p.y)
      onSingleTouchTap?.(coords, p)
    }
  }

  function handleTouchCancel() {
    endPinch()
  }

  // Attach native non-passive touch listeners to container
  function attachListeners(el: HTMLElement) {
    el.addEventListener('touchstart', handleTouchStart, { passive: false })
    el.addEventListener('touchmove', handleTouchMove, { passive: false })
    el.addEventListener('touchend', handleTouchEnd, { passive: false })
    el.addEventListener('touchcancel', handleTouchCancel, { passive: false })
  }

  function detachListeners(el: HTMLElement) {
    el.removeEventListener('touchstart', handleTouchStart)
    el.removeEventListener('touchmove', handleTouchMove)
    el.removeEventListener('touchend', handleTouchEnd)
    el.removeEventListener('touchcancel', handleTouchCancel)
  }

  return {
    isPinching,
    activePenId,
    lastPenTime,
    getCanvasCoords,
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
    handlePointerCancel,
    attachListeners,
    detachListeners,
  }
}
