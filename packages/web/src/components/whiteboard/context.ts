import type { InjectionKey, Ref } from 'vue'
import type { ObjectSummary } from '@vasta/core'
import type { useToolSettings } from './useToolSettings.ts'
import type { useWhiteboardHistory } from './useWhiteboardHistory.ts'
import type { useWhiteboardScenes } from './useWhiteboardScenes.ts'
import type { useWhiteboardSelection } from './useWhiteboardSelection.ts'

export type WhiteboardContext = ReturnType<typeof useToolSettings> &
  ReturnType<typeof useWhiteboardScenes> &
  ReturnType<typeof useWhiteboardHistory> &
  ReturnType<typeof useWhiteboardSelection> & {
    zoom: Ref<number>
    activeMode: Ref<string | null>
    startEditing: (id: string) => void
    onPickObject: (obj: ObjectSummary) => void
    zoomIn: () => void
    zoomOut: () => void
    resetView: () => void
  }

export const WHITEBOARD_CTX: InjectionKey<WhiteboardContext> = Symbol('WHITEBOARD_CTX')
