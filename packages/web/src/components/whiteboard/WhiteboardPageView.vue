<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import {
  formulaFromNames,
  formulaToNames,
  type ObjectRecord,
  type ObjectSummary,
  type ObjectType,
  type PropertyDef,
  type PropertyValue,
  type SelectOption,
} from '@vasta/core'
import AppIcon from '../AppIcon.vue'
import BacklinksPanel from '../BacklinksPanel.vue'
import ObjectChip from '../ObjectChip.vue'
import ObjectComments from '../ObjectComments.vue'
import ObjectPicker from '../ObjectPicker.vue'
import PopoverMenu from '../PopoverMenu.vue'
import PropertyDisplay from '../PropertyDisplay.vue'
import PropertyValueEditor from '../PropertyValueEditor.vue'
import { tagFromPath } from '../../lib/actions.ts'
import { api } from '../../lib/api.ts'
import { iconTextClasses } from '../../lib/colors.ts'
import { clone } from '../../lib/clone.ts'
import { PROPERTY_KINDS, kindIcon, newPropertyDef } from '../../lib/properties.ts'
import { openText, useReplica, type TextSession } from '../../lib/replica.ts'
import { lastError, primeFromObject, replaceType, systemType, workspace } from '../../lib/state.ts'
import type { DrawMode, WhiteboardData, WhiteboardScene } from './types.ts'
import WhiteboardCanvas from './WhiteboardCanvas.vue'

const props = defineProps<{
  object: ObjectRecord
  type?: ObjectType
}>()

const router = useRouter()
const canvasRef = ref<InstanceType<typeof WhiteboardCanvas> | null>(null)
const textSession = ref<TextSession | null>(null)

onMounted(async () => {
  if (useReplica()) {
    try {
      textSession.value = await openText(props.object.id)
    } catch (e) {
      console.warn('Could not open Y.Doc replica session for whiteboard', e)
    }
  }
})

// Local reactive object state so tags & custom properties can be edited in the drawer
const localObject = ref<ObjectRecord>(clone(props.object))
watch(
  () => props.object,
  (next) => {
    localObject.value = clone(next)
  }
)

// Title & Save state
const title = ref(props.object.title || '')
const status = ref<'saved' | 'saving'>('saved')
const drawerOpen = ref(false)
let propsDirty = false

// Tags & Properties state for the Details Drawer
const tagType = computed(() => systemType('tag'))
const tagAnchor = ref<HTMLElement | null>(null)
const tagOpen = ref(false)
const valueFields = computed(() => (props.type?.properties ?? []).filter((p) => p.kind !== 'rich-text'))

const addAnchor = ref<HTMLElement | null>(null)
const addOpen = ref(false)
const newProperty = ref({ name: '', kind: 'text' as PropertyDef['kind'], formula: '' })
const KINDS = PROPERTY_KINDS

function scheduleSave() {
  status.value = 'saving'
  clearTimeout(saveTimer)
  saveTimer = setTimeout(flushSave, 600)
}

function addTag(tag: ObjectSummary) {
  if (localObject.value.tagIds.includes(tag.id)) return
  localObject.value.tagIds.push(tag.id)
  tagOpen.value = false
  propsDirty = true
  scheduleSave()
}

async function createTag(tagTitle: string) {
  try {
    const tag = await tagFromPath(tagTitle)
    if (tag) addTag({ preview: '', ...tag })
  } catch (error) {
    lastError.value = (error as Error).message
  }
}

function removeTag(id: string) {
  localObject.value.tagIds = localObject.value.tagIds.filter((t) => t !== id)
  propsDirty = true
  scheduleSave()
}

function setProp(def: PropertyDef, value: PropertyValue | undefined) {
  if (value) localObject.value.props[def.id] = value
  else delete localObject.value.props[def.id]
  propsDirty = true
  scheduleSave()
}

async function addOption(def: PropertyDef, option: SelectOption) {
  if (!props.type || def.kind !== 'select') return
  const next = clone(props.type)
  const target = next.properties.find((p) => p.id === def.id)
  if (target?.kind === 'select') target.options.push(option)
  replaceType(await api.saveType(next))
}

async function addProperty() {
  if (!props.type || !newProperty.value.name.trim()) return
  const next = clone(props.type)
  const def = newPropertyDef(newProperty.value.name.trim(), newProperty.value.kind)
  if (def.kind === 'formula') def.expression = formulaFromNames(newProperty.value.formula, next, workspace.types)
  next.properties.push(def)
  replaceType(await api.saveType(next))
  newProperty.value = { name: '', kind: 'text', formula: '' }
  addOpen.value = false
}

// Draw mode: auto detects pencil when available, or user can force pencil/touch
const drawMode = ref<DrawMode>('auto')
const penDetected = ref(false)

function onPenDetected(present: boolean) {
  penDetected.value = present
}

function cycleDrawMode() {
  if (drawMode.value === 'auto') drawMode.value = 'pencil'
  else if (drawMode.value === 'pencil') drawMode.value = 'touch'
  else drawMode.value = 'auto'
}

const drawModeLabel = computed(() => {
  if (drawMode.value === 'auto') return 'Auto'
  if (drawMode.value === 'pencil') return 'Pencil Only'
  return 'Touch Draw'
})

// Gesture toast indicator
const toastMessage = ref<string | null>(null)
let toastTimer: ReturnType<typeof setTimeout> | undefined

function showToast(msg: string) {
  clearTimeout(toastTimer)
  toastMessage.value = msg
  toastTimer = setTimeout(() => {
    toastMessage.value = null
  }, 1200)
}

function onUndoTriggered() {
  showToast('Undo ⤺')
}

function onRedoTriggered() {
  showToast('Redo ⤼')
}

// Scenes State & Management
const showScenesModal = ref(false)
const editingSceneId = ref<string | null>(null)
const editingSceneName = ref('')

const scenesList = computed<WhiteboardScene[]>(() => canvasRef.value?.scenes || [])
const defaultSceneId = computed(() => canvasRef.value?.defaultSceneId)
const isSceneDrawing = computed(() => canvasRef.value?.isSceneDrawing || false)

function startSceneRename(scene: WhiteboardScene) {
  editingSceneId.value = scene.id
  editingSceneName.value = scene.name
}

function saveSceneRename(id: string) {
  if (editingSceneName.value.trim()) {
    canvasRef.value?.updateScene(id, { name: editingSceneName.value.trim() })
  }
  editingSceneId.value = null
}

function onSetDefaultScene(id: string) {
  canvasRef.value?.setDefaultScene(id)
  showToast('Default scene set 🌟')
}

function onFocusScene(id: string) {
  canvasRef.value?.focusScene(id)
  showScenesModal.value = false
  showToast('Focused on scene 🎬')
}

function onRedrawScene(id: string) {
  showScenesModal.value = false
  canvasRef.value?.startDefiningScene(id)
}

function onDeleteScene(id: string) {
  canvasRef.value?.deleteScene(id)
  showToast('Scene deleted')
}

function onAddNewScene() {
  showScenesModal.value = false
  canvasRef.value?.startDefiningScene()
}

// Initial whiteboard data loaded from object.props.whiteboardData (supports PropertyValue object or legacy string)
const initialData = computed<Partial<WhiteboardData>>(() => {
  try {
    const raw = props.object.props?.whiteboardData as unknown
    const str =
      typeof raw === 'string'
        ? raw
        : raw && typeof raw === 'object' && 'value' in raw && typeof (raw as { value: unknown }).value === 'string'
          ? (raw as { value: string }).value
          : null
    if (str) return JSON.parse(str)
    if (raw && typeof raw === 'object' && ('strokes' in raw || 'shapes' in raw || 'cards' in raw || 'stickies' in raw)) {
      return raw as Partial<WhiteboardData>
    }
  } catch (e) {
    console.warn('Failed to parse whiteboardData', e)
  }
  return { version: 1, pan: { x: 0, y: 0 }, zoom: 1, strokes: [], shapes: [], cards: [], stickies: [] }
})

/** The copy last loaded or saved: what the next save is made from and compared with. */
let current = clone(props.object)
let saveTimer: ReturnType<typeof setTimeout> | undefined
let pendingData: WhiteboardData | null = null

function onCanvasChange(data: WhiteboardData) {
  pendingData = data
  status.value = 'saving'
  clearTimeout(saveTimer)
  saveTimer = setTimeout(flushSave, 800)
}

async function flushSave() {
  clearTimeout(saveTimer)
  if (!pendingData && !propsDirty && title.value === current.title) {
    status.value = 'saved'
    return
  }

  status.value = 'saving'
  try {
    const next = clone(current)
    const written = pendingData
    next.title = title.value.trim()
    next.tagIds = [...localObject.value.tagIds]
    next.props = { ...localObject.value.props }

    if (pendingData) {
      // Wrap in a valid PropertyValue object so Vasta's sync server (packages/server/src/sync.ts) accepts it!
      const wrapped: PropertyValue = { kind: 'text', value: JSON.stringify(pendingData) }
      next.props.whiteboardData = wrapped
      localObject.value.props.whiteboardData = wrapped

      // Sync mentioned object cards, card-to-card connections, and sticky/shape text into content.body
      // so backlinks and FTS5 search stay accurate (and clear when items are deleted).
      if (!next.content) next.content = {}
      const paragraphs: any[] = []

      const referencedObjectIds = Array.from(new Set(pendingData.cards.map((c) => c.objectId)))
      if (referencedObjectIds.length > 0) {
        const mentions = referencedObjectIds.map((id) => ({
          type: 'mention',
          attrs: { objectId: id, label: pendingData?.cards.find((c) => c.objectId === id)?.title || '' },
        }))
        paragraphs.push({ type: 'paragraph', content: mentions })

        // Look for card-to-card connectors ("arrows that mean something")
        const cardMap = new Map(pendingData.cards.map((c) => [c.id, c.objectId]))
        const connections: { fromId: string; toId: string }[] = []
        for (const shape of pendingData.shapes) {
          if ((shape.type === 'arrow' || shape.type === 'line') && shape.startAnchor?.cardId && shape.endAnchor?.cardId) {
            const fromObjId = cardMap.get(shape.startAnchor.cardId)
            const toObjId = cardMap.get(shape.endAnchor.cardId)
            if (fromObjId && toObjId && fromObjId !== toObjId) {
              connections.push({ fromId: fromObjId, toId: toObjId })
            }
          }
        }

        if (connections.length > 0) {
          const connMentions = connections.flatMap((conn) => [
            { type: 'mention', attrs: { objectId: conn.fromId } },
            { type: 'text', text: ' ──➔ ' },
            { type: 'mention', attrs: { objectId: conn.toId } },
            { type: 'text', text: '  ' },
          ])
          paragraphs.push({ type: 'paragraph', content: connMentions })
        }
      }

      // Extract text from sticky notes and labeled shapes for full-text search (objects_fts)
      const boardTexts = [
        ...pendingData.stickies.map((s) => s.text?.trim()).filter(Boolean),
        ...pendingData.shapes.map((s) => s.text?.trim()).filter(Boolean),
      ]
      if (boardTexts.length > 0) {
        paragraphs.push({
          type: 'paragraph',
          content: [{ type: 'text', text: boardTexts.join(' · ') }],
        })
      }

      if (paragraphs.length > 0) {
        next.content.body = { type: 'doc', content: paragraphs }
      } else {
        delete next.content.body
      }
    }

    const saved = await api.saveObject(next, current)
    current = clone(saved)
    localObject.value = clone(saved)
    if (pendingData === written) pendingData = null
    propsDirty = false
    primeFromObject(saved)
    status.value = 'saved'
  } catch (err) {
    console.error('Failed to save whiteboard', err)
    status.value = 'saved'
  }
}

watch(title, () => {
  status.value = 'saving'
  clearTimeout(saveTimer)
  saveTimer = setTimeout(flushSave, 800)
})

// Save what is pending when leaving the page and release collaborative Yjs text session.
onBeforeUnmount(() => {
  textSession.value?.release()
  if (pendingData || propsDirty || title.value !== current.title) void flushSave()
})

function goBack() {
  if (window.history.length > 1) {
    router.back()
  } else {
    router.push('/')
  }
}
</script>

<template>
  <div
    class="relative flex h-full w-full flex-col overflow-hidden bg-surface select-none"
    style="-webkit-touch-callout: none; -webkit-user-select: none; user-select: none;"
  >
    <!-- Top Header Bar -->
    <header class="flex h-14 shrink-0 items-center justify-between border-b border-line bg-surface/90 px-4 backdrop-blur-md z-30">
      <!-- Left: Back, Type Badge, Title -->
      <div class="flex items-center gap-2.5 min-w-0 flex-1 mr-4">
        <button
          class="flex h-8 w-8 items-center justify-center rounded-lg text-ink-soft hover:bg-hover hover:text-ink"
          title="Go back"
          @click="goBack"
        >
          <AppIcon fallback="ph:caret-left" :size="20" />
        </button>

        <div class="flex items-center gap-1.5 rounded-lg bg-hover px-2 py-1 text-xs font-semibold text-ink-soft">
          <AppIcon :fallback="type?.icon?.value || 'ph:chalkboard-teacher'" :size="15" :class="type?.color ? iconTextClasses[type.color] : 'text-primary'" />
          <span class="max-sm:hidden">{{ type?.name || 'Whiteboard' }}</span>
        </div>

        <input
          v-model="title"
          placeholder="Untitled Whiteboard"
          class="min-w-0 flex-1 truncate bg-transparent font-semibold text-ink text-base outline-none hover:bg-hover/50 focus:bg-hover/50 rounded px-1.5 py-0.5 transition-colors"
          @keydown.enter="($event.target as HTMLInputElement).blur()"
        />
      </div>

      <!-- Center / Right Controls -->
      <div class="flex items-center gap-2 shrink-0">
        <!-- Save indicator -->
        <span class="text-xs text-ink-faint mr-1 max-sm:hidden">
          {{ status === 'saving' ? 'Saving…' : 'Saved' }}
        </span>

        <!-- Pen / Draw Mode Toggle -->
        <button
          class="flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium transition-colors border"
          :class="drawMode === 'pencil' || (drawMode === 'auto' && penDetected) ? 'bg-primary/10 text-primary border-primary/20' : 'bg-hover text-ink-soft hover:text-ink border-line'"
          :title="`Drawing Mode: ${drawModeLabel}. Click to cycle: Auto -> Pencil Only -> Touch Draw`"
          @click="cycleDrawMode"
        >
          <AppIcon :fallback="drawMode === 'pencil' || (drawMode === 'auto' && penDetected) ? 'ph:pencil-simple' : 'ph:hand-pointing'" :size="14" />
          <span class="max-md:hidden">{{ drawModeLabel }}</span>
        </button>

        <!-- Scenes Button -->
        <button
          class="flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium transition-colors border"
          :class="showScenesModal || isSceneDrawing ? 'border-primary bg-primary/10 text-primary' : 'border-line bg-hover text-ink-soft hover:text-ink'"
          title="Whiteboard Scenes (thumbnails and document embed frames)"
          @click="showScenesModal = !showScenesModal"
        >
          <AppIcon fallback="ph:film-slate" :size="14" />
          <span class="max-md:hidden">Scenes</span>
          <span
            v-if="scenesList.length > 0"
            class="ml-0.5 rounded-full bg-primary/20 text-primary px-1.5 py-0.2 text-[10px] font-bold"
          >
            {{ scenesList.length }}
          </span>
        </button>

        <!-- Properties Drawer Toggle -->
        <button
          class="flex h-8 w-8 items-center justify-center rounded-lg transition-colors"
          :class="drawerOpen ? 'bg-hover text-ink' : 'text-ink-soft hover:bg-hover hover:text-ink'"
          title="Whiteboard Properties & Backlinks"
          @click="drawerOpen = !drawerOpen"
        >
          <AppIcon fallback="ph:sliders-horizontal" :size="16" />
        </button>
      </div>
    </header>

    <!-- Main Canvas Area -->
    <main class="relative min-h-0 flex-1 w-full">
      <WhiteboardCanvas
        ref="canvasRef"
        :initial-data="initialData"
        :draw-mode="drawMode"
        :ydoc="textSession?.doc"
        @change="onCanvasChange"
        @undo-triggered="onUndoTriggered"
        @redo-triggered="onRedoTriggered"
        @pen-detected="onPenDetected"
      />

      <!-- Gesture Feedback Toast -->
      <transition
        enter-active-class="transition duration-150 ease-out"
        enter-from-class="opacity-0 -translate-y-2"
        enter-to-class="opacity-100 translate-y-0"
        leave-active-class="transition duration-150 ease-in"
        leave-from-class="opacity-100 translate-y-0"
        leave-to-class="opacity-0 -translate-y-2"
      >
        <div
          v-if="toastMessage"
          class="pointer-events-none absolute top-4 left-1/2 -translate-x-1/2 rounded-full border border-line bg-surface/90 px-4 py-1.5 text-xs font-semibold text-ink shadow-lg backdrop-blur-md z-40"
        >
          {{ toastMessage }}
        </div>
      </transition>
    </main>

    <!-- Slide-over Properties & Backlinks Drawer -->
    <transition
      enter-active-class="transition-transform duration-200 ease-out"
      enter-from-class="translate-x-full"
      enter-to-class="translate-x-0"
      leave-active-class="transition-transform duration-150 ease-in"
      leave-from-class="translate-x-0"
      leave-to-class="translate-x-full"
    >
      <aside
        v-if="drawerOpen"
        class="absolute top-14 right-0 bottom-0 w-88 max-w-[85vw] border-l border-line bg-surface/95 p-4 shadow-2xl backdrop-blur-md overflow-y-auto z-40 flex flex-col gap-5"
      >
        <div class="flex items-center justify-between border-b border-line pb-3">
          <div class="flex items-center gap-2">
            <AppIcon fallback="ph:sliders-horizontal" :size="16" class="text-ink-soft" />
            <span class="font-semibold text-ink text-sm">Whiteboard Details</span>
          </div>
          <button class="text-ink-soft hover:text-ink rounded p-1 hover:bg-hover" @click="drawerOpen = false">
            <AppIcon fallback="ph:x" :size="16" />
          </button>
        </div>

        <!-- Tags Section -->
        <div class="space-y-2">
          <h4 class="text-xs font-semibold text-ink-soft uppercase tracking-wider">Tags</h4>
          <div class="flex flex-wrap items-center gap-1.5">
            <ObjectChip v-for="id in localObject.tagIds" :key="id" :id="id" tag removable @remove="removeTag(id)" />
            <button ref="tagAnchor" class="rounded-md px-2 py-0.5 text-xs text-ink-faint ring-1 ring-line hover:bg-hover hover:text-ink" @click="tagOpen = !tagOpen">
              {{ localObject.tagIds.length ? '+ Tag' : '+ Add tags' }}
            </button>
            <PopoverMenu v-model:open="tagOpen" :anchor="tagAnchor" width="16rem">
              <ObjectPicker :type-ids="tagType ? [tagType.id] : []" :exclude="localObject.tagIds" create-label="New tag" @pick="addTag" @create="createTag" />
            </PopoverMenu>
          </div>
        </div>

        <!-- Custom Properties Section -->
        <div class="space-y-2 border-t border-line pt-3">
          <div class="flex items-center justify-between">
            <h4 class="text-xs font-semibold text-ink-soft uppercase tracking-wider">Properties</h4>
            <button ref="addAnchor" class="flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-ink-faint hover:bg-hover hover:text-ink" @click="addOpen = !addOpen">
              <AppIcon fallback="ph:plus" :size="12" /> Add
            </button>
            <PopoverMenu v-model:open="addOpen" :anchor="addAnchor" width="15rem">
              <input
                v-model="newProperty.name"
                class="mb-1 w-full rounded-lg bg-hover px-2.5 py-1.5 text-sm outline-none placeholder:text-ink-faint"
                placeholder="Property name"
                @keydown.enter.prevent="addProperty"
              />
              <button
                v-for="k in KINDS"
                :key="k.kind"
                class="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm hover:bg-hover"
                :class="newProperty.kind === k.kind ? 'bg-hover' : ''"
                @click="newProperty.kind = k.kind"
              >
                <AppIcon :fallback="k.icon" class="text-ink-soft" /> {{ k.label }}
                <AppIcon v-if="newProperty.kind === k.kind" fallback="ph:check" class="ml-auto text-accent" />
              </button>
              <input
                v-if="newProperty.kind === 'formula'"
                v-model="newProperty.formula"
                class="mt-1 w-full rounded-lg bg-hover px-2.5 py-1.5 font-mono text-xs outline-none placeholder:text-ink-faint"
                placeholder="{Price} * {Quantity}"
                @keydown.enter.prevent="addProperty"
              />
              <button class="mt-1 w-full rounded-lg bg-ink px-2.5 py-1.5 text-sm text-surface disabled:opacity-40" :disabled="!newProperty.name.trim()" @click="addProperty">
                Add property
              </button>
            </PopoverMenu>
          </div>

          <div v-if="valueFields.length === 0" class="text-xs text-ink-faint py-1">
            No custom properties on {{ type?.name || 'Whiteboard' }} yet.
          </div>
          <div v-else class="divide-y divide-line/60">
            <div v-for="def in valueFields" :key="def.id" class="py-1.5">
              <div class="flex items-center gap-1.5 text-xs text-ink-soft mb-1">
                <AppIcon :icon="def.icon" :fallback="kindIcon(def.kind)" :size="13" class="text-ink-faint" />
                <span class="truncate font-medium">{{ def.name }}</span>
              </div>
              <div v-if="def.kind === 'formula' && type" class="pl-1 text-sm" :title="formulaToNames(def.expression, type, workspace.types)">
                <PropertyDisplay :def="def" :value="undefined" :object="localObject" wrap />
              </div>
              <PropertyValueEditor
                v-else
                :def="def"
                :value="localObject.props[def.id]"
                @update="setProp(def, $event)"
                @add-option="addOption(def, $event)"
              />
            </div>
          </div>
        </div>

        <!-- Comments Section -->
        <div class="space-y-2 border-t border-line pt-3">
          <ObjectComments :object="localObject" />
        </div>

        <!-- Backlinks -->
        <div class="space-y-2 border-t border-line pt-3">
          <h4 class="text-xs font-semibold text-ink-soft uppercase tracking-wider">Backlinks & Mentions</h4>
          <BacklinksPanel :object-id="object.id" title="Referenced in" />
        </div>
      </aside>
    </transition>

    <!-- Scenes Management Modal -->
    <div
      v-if="showScenesModal"
      class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs select-none"
      @click.self="showScenesModal = false"
    >
      <div class="flex flex-col w-full max-w-md rounded-2xl border border-line bg-surface p-5 shadow-2xl space-y-4">
        <!-- Modal Header -->
        <div class="flex items-center justify-between border-b border-line pb-3">
          <div class="flex items-center gap-2">
            <div class="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <AppIcon fallback="ph:film-slate" :size="18" />
            </div>
            <div>
              <h3 class="text-sm font-semibold text-ink">Whiteboard Scenes</h3>
              <p class="text-xs text-ink-faint">Framed views for gallery previews and document embeds</p>
            </div>
          </div>
          <button
            class="rounded-lg p-1 text-ink-soft hover:bg-hover hover:text-ink transition-colors"
            @click="showScenesModal = false"
          >
            <AppIcon fallback="ph:x" :size="16" />
          </button>
        </div>

        <!-- Scenes List -->
        <div class="max-h-72 overflow-y-auto space-y-2 pr-1">
          <div
            v-if="scenesList.length === 0"
            class="flex flex-col items-center justify-center py-6 text-center text-xs text-ink-faint border border-dashed border-line rounded-xl"
          >
            <AppIcon fallback="ph:film-slate" :size="24" class="text-ink-soft mb-1.5 opacity-50" />
            <p class="font-medium text-ink">No scenes yet</p>
            <p class="text-[11px] text-ink-faint mt-0.5">Define a scene by dragging a rectangle over the whiteboard</p>
          </div>

          <div
            v-for="s in scenesList"
            :key="s.id"
            class="group flex items-center justify-between rounded-xl border border-line bg-surface/50 p-2.5 transition-all hover:border-line-strong hover:bg-hover/40"
          >
            <!-- Left Info -->
            <div class="min-w-0 flex-1 mr-2">
              <div class="flex items-center gap-1.5">
                <!-- Inline Name Edit if editing -->
                <div v-if="editingSceneId === s.id" class="flex items-center gap-1">
                  <input
                    v-model="editingSceneName"
                    class="rounded border border-primary bg-surface px-1.5 py-0.5 text-xs font-semibold text-ink outline-none w-36"
                    @blur="saveSceneRename(s.id)"
                    @keydown.enter="saveSceneRename(s.id)"
                    @keydown.esc="editingSceneId = null"
                    autofocus
                  />
                  <button class="p-1 rounded text-primary hover:bg-primary/10" title="Save" @click.stop="saveSceneRename(s.id)">
                    <AppIcon fallback="ph:check" :size="13" />
                  </button>
                </div>
                <span
                  v-else
                  class="truncate text-xs font-semibold text-ink cursor-pointer hover:underline"
                  title="Click to rename"
                  @click="startSceneRename(s)"
                >
                  {{ s.name }}
                </span>

                <!-- Default Badge -->
                <span
                  v-if="s.isDefault || defaultSceneId === s.id"
                  class="rounded bg-primary/15 text-primary px-1.5 py-0.2 text-[10px] font-bold"
                >
                  Default
                </span>
              </div>
              <div class="text-[11px] text-ink-faint mt-0.5 font-mono">
                {{ Math.round(s.rect.w) }} × {{ Math.round(s.rect.h) }}
              </div>
            </div>

            <!-- Actions -->
            <div class="flex items-center gap-1 shrink-0">
              <!-- Rename Button -->
              <button
                class="flex h-7 w-7 items-center justify-center rounded-lg text-ink-soft hover:bg-hover hover:text-ink transition-colors"
                title="Rename scene"
                @click.stop="startSceneRename(s)"
              >
                <AppIcon fallback="ph:pencil-simple" :size="15" />
              </button>

              <!-- Set as Default (if not default) -->
              <button
                v-if="!s.isDefault && defaultSceneId !== s.id"
                class="flex h-7 w-7 items-center justify-center rounded-lg text-ink-soft hover:bg-hover hover:text-primary transition-colors"
                title="Set as Default Scene"
                @click="onSetDefaultScene(s.id)"
              >
                <AppIcon fallback="ph:star" :size="15" />
              </button>

              <!-- Focus / Jump View -->
              <button
                class="flex h-7 w-7 items-center justify-center rounded-lg text-ink-soft hover:bg-hover hover:text-ink transition-colors"
                title="Pan & Zoom to Scene"
                @click="onFocusScene(s.id)"
              >
                <AppIcon fallback="ph:magnifying-glass-plus" :size="15" />
              </button>

              <!-- Redraw Rectangle -->
              <button
                class="flex h-7 w-7 items-center justify-center rounded-lg text-ink-soft hover:bg-hover hover:text-ink transition-colors"
                title="Redraw scene area"
                @click="onRedrawScene(s.id)"
              >
                <AppIcon fallback="ph:crop" :size="15" />
              </button>

              <!-- Delete -->
              <button
                class="flex h-7 w-7 items-center justify-center rounded-lg text-ink-soft hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-950/40 transition-colors"
                title="Delete scene"
                @click="onDeleteScene(s.id)"
              >
                <AppIcon fallback="ph:trash" :size="15" />
              </button>
            </div>
          </div>
        </div>

        <!-- Modal Footer Actions -->
        <div class="flex items-center justify-end border-t border-line pt-3">
          <button
            class="flex items-center gap-1.5 rounded-lg bg-primary px-3.5 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-primary/90 transition-all active:scale-95"
            @click="onAddNewScene"
          >
            <AppIcon fallback="ph:plus" :size="14" />
            <span>New Scene</span>
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
