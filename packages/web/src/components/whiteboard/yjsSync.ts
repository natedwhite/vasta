// Collaborative and offline sync bridge for Whiteboards using Yjs.
// Each whiteboard element (stroke, shape, sticky, card) lives as an independent entry
// in a Y.Map ('wb_elements') to allow concurrent multi-device editing and offline merge.
import type * as Y from 'yjs'
import type {
  InkStroke,
  ObjectCardElement,
  ShapeElement,
  StickyElement,
  WhiteboardData,
  WhiteboardScene,
} from './types.ts'

export interface YjsWhiteboardBridge {
  syncLocalToYjs: (data: WhiteboardData) => void
  destroy: () => void
}

export function bindWhiteboardToYDoc(
  ydoc: Y.Doc,
  initialData: Partial<WhiteboardData> | undefined,
  onRemoteChange: (data: Partial<WhiteboardData>) => void
): YjsWhiteboardBridge {
  const elements = ydoc.getMap<unknown>('wb_elements')
  const meta = ydoc.getMap<unknown>('wb_meta')

  let isApplyingRemote = false
  const serializedCache = new Map<string, string>()

  function setIfChanged(map: Y.Map<unknown>, key: string, value: unknown) {
    const json = JSON.stringify(value)
    if (serializedCache.get(key) === json && map.has(key)) return
    serializedCache.set(key, json)
    map.set(key, value)
  }

  // Seed initial data if Y.Doc is brand new and initialData is provided
  if (elements.size === 0 && initialData) {
    ydoc.transact(() => {
      initialData.strokes?.forEach((s) => setIfChanged(elements, `stroke:${s.id}`, s))
      initialData.shapes?.forEach((s) => setIfChanged(elements, `shape:${s.id}`, s))
      initialData.stickies?.forEach((s) => setIfChanged(elements, `sticky:${s.id}`, s))
      initialData.cards?.forEach((c) => setIfChanged(elements, `card:${c.id}`, c))
      if (initialData.scenes) setIfChanged(meta, 'scenes', initialData.scenes)
      if (initialData.defaultSceneId) setIfChanged(meta, 'defaultSceneId', initialData.defaultSceneId)
      if (initialData.pan) setIfChanged(meta, 'pan', initialData.pan)
      if (initialData.zoom) setIfChanged(meta, 'zoom', initialData.zoom)
    })
  }

  function readFromYjs(includeViewport = false): Partial<WhiteboardData> {
    const strokes: InkStroke[] = []
    const shapes: ShapeElement[] = []
    const stickies: StickyElement[] = []
    const cards: ObjectCardElement[] = []

    for (const [key, val] of elements.entries()) {
      if (!val) continue
      serializedCache.set(key, JSON.stringify(val))
      if (key.startsWith('stroke:')) strokes.push(val as InkStroke)
      else if (key.startsWith('shape:')) shapes.push(val as ShapeElement)
      else if (key.startsWith('sticky:')) stickies.push(val as StickyElement)
      else if (key.startsWith('card:')) cards.push(val as ObjectCardElement)
    }

    const scenes = meta.get('scenes') as WhiteboardScene[] | undefined
    const defaultSceneId = meta.get('defaultSceneId') as string | undefined
    if (scenes !== undefined) serializedCache.set('scenes', JSON.stringify(scenes))
    if (defaultSceneId !== undefined) serializedCache.set('defaultSceneId', JSON.stringify(defaultSceneId))

    return {
      strokes,
      shapes,
      stickies,
      cards,
      scenes,
      defaultSceneId,
      ...(includeViewport
        ? {
            pan: meta.get('pan') as { x: number; y: number } | undefined,
            zoom: meta.get('zoom') as number | undefined,
          }
        : {}),
    }
  }

  const observer = () => {
    if (isApplyingRemote) return
    isApplyingRemote = true
    try {
      const updated = readFromYjs(false)
      onRemoteChange(updated)
    } finally {
      isApplyingRemote = false
    }
  }

  elements.observe(observer)
  meta.observe(observer)

  // Initial read if Y.Doc already has elements from remote or seed
  if (elements.size > 0) {
    isApplyingRemote = true
    try {
      onRemoteChange(readFromYjs(true))
    } finally {
      isApplyingRemote = false
    }
  }

  return {
    syncLocalToYjs: (data: WhiteboardData) => {
      if (isApplyingRemote) return
      ydoc.transact(() => {
        // Add or update only changed elements
        const currentKeys = new Set<string>()
        data.strokes.forEach((s) => {
          const k = `stroke:${s.id}`
          currentKeys.add(k)
          setIfChanged(elements, k, s)
        })
        data.shapes.forEach((s) => {
          const k = `shape:${s.id}`
          currentKeys.add(k)
          setIfChanged(elements, k, s)
        })
        data.stickies.forEach((s) => {
          const k = `sticky:${s.id}`
          currentKeys.add(k)
          setIfChanged(elements, k, s)
        })
        data.cards.forEach((c) => {
          const k = `card:${c.id}`
          currentKeys.add(k)
          setIfChanged(elements, k, c)
        })

        // Delete elements that were removed locally
        for (const k of elements.keys()) {
          if (!currentKeys.has(k)) {
            serializedCache.delete(k)
            elements.delete(k)
          }
        }

        if (data.scenes !== undefined) setIfChanged(meta, 'scenes', data.scenes)
        if (data.defaultSceneId !== undefined) setIfChanged(meta, 'defaultSceneId', data.defaultSceneId)
        if (!meta.has('pan') && data.pan) setIfChanged(meta, 'pan', data.pan)
        if (!meta.has('zoom') && data.zoom) setIfChanged(meta, 'zoom', data.zoom)
        if (meta.get('updatedByUi') !== true) meta.set('updatedByUi', true)
      })
    },
    destroy: () => {
      elements.unobserve(observer)
      meta.unobserve(observer)
      serializedCache.clear()
    },
  }
}
