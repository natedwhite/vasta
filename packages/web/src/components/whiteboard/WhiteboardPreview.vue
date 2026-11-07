<script setup lang="ts">
// Read-only miniature of a whiteboard, shown where one is embedded in a page or gallery.
import { computed, onBeforeUnmount, onMounted, ref, useAttrs, watch } from 'vue'
import { useRouter } from 'vue-router'
import { parseWhiteboardProp, type Id, type ObjectRecord, type ObjectSummary } from '@vasta/core'
import AppIcon from '../AppIcon.vue'
import { api } from '../../lib/api.ts'
import { onChange } from '../../lib/events.ts'
import { requestSummaries } from '../../lib/state.ts'
import { getConnectorGeometry, getShapeFill, getStrokeDash, isLine, shapePath, stickyStyle } from './shapes.ts'
import type { WhiteboardData, WhiteboardScene } from './types.ts'
import WhiteboardObjectCard from './WhiteboardObjectCard.vue'

const props = withDefaults(
  defineProps<{
    objectId: Id
    object?: ObjectRecord | ObjectSummary | null
    interactive?: boolean
    sceneId?: string | null
  }>(),
  { interactive: true, sceneId: null }
)

const emit = defineEmits<{
  (e: 'selectScene', sceneId: string | null): void
}>()

const router = useRouter()
const fetchedObject = ref<ObjectRecord | null>(null)
const selected = ref(false)

async function load() {
  if (props.object && props.object.props?.whiteboardData) {
    fetchedObject.value = props.object as ObjectRecord
    return
  }
  fetchedObject.value = await api.object(props.objectId).catch(() => null)
}

onMounted(() => {
  load()
  if (props.interactive) {
    window.addEventListener('pointerdown', onWindowPointerDown)
  }
})

watch(() => props.objectId, load)
watch(() => props.object, load, { deep: true })
const stop = onChange(() => load())
onBeforeUnmount(() => {
  stop()
  if (props.interactive) {
    window.removeEventListener('pointerdown', onWindowPointerDown)
  }
})

const rootEl = ref<HTMLElement | null>(null)
function onWindowPointerDown(e: PointerEvent) {
  if (!rootEl.value || !selected.value) return
  if (!rootEl.value.contains(e.target as Node)) {
    selected.value = false
  }
}

const targetObject = computed(() => (props.object as ObjectRecord) || fetchedObject.value)

const data = computed<WhiteboardData | null>(() => {
  return (parseWhiteboardProp(targetObject.value ?? undefined) as WhiteboardData | undefined) ?? null
})

watch(
  () => data.value?.cards,
  (cards) => {
    if (cards?.length) {
      requestSummaries(cards.map((c) => c.objectId))
    }
  },
  { immediate: true },
)

function path(points: { x: number; y: number }[]) {
  return points.map((p, i) => `${i ? 'L' : 'M'}${p.x} ${p.y}`).join(' ')
}

const scenes = computed<WhiteboardScene[]>(() => data.value?.scenes || [])
const localSceneId = ref<string | null>(props.sceneId)
watch(() => props.sceneId, (val) => {
  localSceneId.value = val
})

const effectiveSceneId = computed(() => localSceneId.value ?? props.sceneId)
const isAuto = computed(() => effectiveSceneId.value === 'auto')

const currentScene = computed<WhiteboardScene | null>(() => {
  if (isAuto.value) return null
  const scs = scenes.value
  if (!scs.length) return null
  if (effectiveSceneId.value && effectiveSceneId.value !== 'auto') {
    const s = scs.find((item) => item.id === effectiveSceneId.value)
    if (s) return s
  }
  if (!effectiveSceneId.value) {
    if (data.value?.defaultSceneId) {
      const s = scs.find((item) => item.id === data.value?.defaultSceneId)
      if (s) return s
    }
    const def = scs.find((item) => item.isDefault)
    if (def) return def
  }
  return null
})

const activeSelectValue = computed(() => {
  if (isAuto.value || !currentScene.value) return 'auto'
  return currentScene.value.id
})

const renderedShapes = computed(() =>
  (data.value?.shapes ?? [])
    .map((s) => {
      const line = isLine(s)
      return {
        shape: s,
        line,
        zIndex: s.zIndex ?? (line ? 0 : 10),
        connector: line ? getConnectorGeometry(s) : null,
      }
    })
    .sort((a, b) => a.zIndex - b.zIndex),
)

const renderedStickies = computed(() =>
  (data.value?.stickies ?? []).map((s) => ({
    sticky: s,
    palette: stickyStyle(s.color),
  })),
)

/** The box around everything on the board, with a margin, or the user's custom thumbnailRect / selected Scene. */
const box = computed(() => {
  if (!isAuto.value && currentScene.value && currentScene.value.rect.w > 0 && currentScene.value.rect.h > 0) {
    return { ...currentScene.value.rect, empty: false }
  }
  if (!isAuto.value) {
    const d = data.value
    if (d?.thumbnailRect && d.thumbnailRect.w > 0 && d.thumbnailRect.h > 0) {
      return { ...d.thumbnailRect, empty: false }
    }
  }
  const d = data.value
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  const addPt = (x: number, y: number) => {
    if (x < minX) minX = x
    if (y < minY) minY = y
    if (x > maxX) maxX = x
    if (y > maxY) maxY = y
  }
  for (const s of d?.strokes ?? []) for (const p of s.points) addPt(p.x, p.y)
  for (const s of d?.shapes ?? []) { addPt(s.x, s.y); addPt(s.x + s.width, s.y + s.height) }
  for (const c of d?.cards ?? []) { addPt(c.x, c.y); addPt(c.x + c.width, c.y + c.height) }
  for (const st of d?.stickies ?? []) { addPt(st.x, st.y); addPt(st.x + st.width, st.y + st.height) }
  if (!Number.isFinite(minX)) return { x: 0, y: 0, w: 600, h: 300, empty: true }
  const pad = 30
  const x = minX - pad
  const y = minY - pad
  return { x, y, w: maxX + pad - x, h: maxY + pad - y, empty: false }
})

function onSceneSelect(val: string) {
  localSceneId.value = val
  emit('selectScene', val)
}

const attrs = useAttrs()
const rootStyle = computed(() => {
  const cls = String(attrs.class || '')
  if (cls.includes('aspect-') || cls.includes('h-') || cls.includes('max-h-')) return undefined
  return box.value.w && box.value.h ? { aspectRatio: `${box.value.w} / ${box.value.h}` } : undefined
})

function handleClick() {
  if (!props.interactive) return
  selected.value = true
}

function open() {
  router.push(`/o/${props.objectId}`)
}
</script>

<template>
  <div
    ref="rootEl"
    class="group relative block overflow-hidden rounded-xl border border-line bg-surface text-left shadow-sm transition"
    :class="[
      interactive ? 'cursor-pointer hover:border-line-strong' : '',
      selected ? 'ring-2 ring-primary ring-offset-2 border-primary' : '',
    ]"
    :style="rootStyle"
    data-whiteboard-embed
    @click="handleClick"
    @dblclick="open"
  >
    <svg class="h-full w-full text-ink" :viewBox="`${box.x} ${box.y} ${box.w} ${box.h}`" preserveAspectRatio="xMidYMid meet">
      <!-- Ink Strokes -->
      <path
        v-for="s in data?.strokes ?? []"
        :key="s.id"
        :d="path(s.points)"
        :stroke="s.color"
        :stroke-width="s.width"
        :stroke-dasharray="getStrokeDash(s.style)"
        :opacity="s.style === 'marker' ? 0.45 : 1"
        stroke-linecap="round"
        stroke-linejoin="round"
        fill="none"
      />
      <!-- Shapes & Connectors -->
      <g
        v-for="{ shape: s, line, connector } in renderedShapes"
        :key="s.id"
        :transform="!line && s.rotation ? `rotate(${s.rotation} ${s.x + s.width / 2} ${s.y + s.height / 2})` : undefined"
      >
        <template v-if="connector">
          <path
            :d="connector.shaftPath"
            :stroke="s.color"
            :stroke-width="s.strokeWidth || 2.5"
            :stroke-dasharray="getStrokeDash(s.strokeStyle)"
            stroke-linecap="round"
            stroke-linejoin="round"
            fill="none"
          />
          <path
            v-if="connector.startHead && connector.startHeadType !== 'dot'"
            :d="connector.startHead"
            :fill="s.color"
            :stroke="s.color"
            stroke-width="1"
          />
          <path
            v-if="connector.endHead && connector.endHeadType !== 'dot'"
            :d="connector.endHead"
            :fill="s.color"
            :stroke="s.color"
            stroke-width="1"
          />
        </template>
        <template v-else>
          <path
            :d="shapePath(s)"
            :stroke="s.color"
            :stroke-width="s.strokeWidth || 2.5"
            :stroke-dasharray="getStrokeDash(s.strokeStyle)"
            :fill="getShapeFill(s)"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
          <text
            v-if="s.text?.trim()"
            :x="s.x + s.width / 2"
            :y="s.y + s.height / 2 + 5"
            text-anchor="middle"
            font-size="13"
            font-weight="600"
            :fill="s.fill === 'solid' && !s.fillColor ? '#ffffff' : 'currentColor'"
          >{{ s.text }}</text>
        </template>
      </g>
      <!-- Stickies -->
      <g v-for="{ sticky: s, palette } in renderedStickies" :key="s.id">
        <rect :x="s.x" :y="s.y" :width="s.width" :height="s.height" rx="10" :fill="palette.bg" :stroke="palette.border" />
        <foreignObject :x="s.x + 8" :y="s.y + 8" :width="s.width - 16" :height="s.height - 16">
          <div xmlns="http://www.w3.org/1999/xhtml" :style="{ fontSize: '13px', color: s.textColor || palette.text, whiteSpace: 'pre-wrap', overflow: 'hidden', height: '100%' }">{{ s.text }}</div>
        </foreignObject>
      </g>
      <!-- Cards -->
      <g
        v-for="c in data?.cards ?? []"
        :key="c.id"
        :transform="c.rotation ? `rotate(${c.rotation} ${c.x + c.width / 2} ${c.y + c.height / 2})` : undefined"
      >
        <rect
          :x="c.x"
          :y="c.y"
          :width="c.width"
          :height="c.height"
          rx="12"
          fill="var(--color-surface, #ffffff)"
          stroke="var(--color-line, #e2e8f0)"
          stroke-width="1.5"
        />
        <foreignObject
          :x="c.x"
          :y="c.y"
          :width="c.width"
          :height="c.height"
          class="overflow-hidden"
          style="overflow: hidden;"
        >
          <div
            xmlns="http://www.w3.org/1999/xhtml"
            class="h-full w-full overflow-hidden"
            style="width: 100%; height: 100%; box-sizing: border-box; overflow: hidden;"
          >
            <WhiteboardObjectCard
              :card="c"
              :interactive="false"
              :embedded="true"
            />
          </div>
        </foreignObject>
      </g>
      <!-- Dot Terminations (on top of cards, stickies, and 2D shapes) -->
      <g v-for="{ shape: s, line, connector } in renderedShapes" :key="`dot-${s.id}`">
        <template v-if="line && connector">
          <path v-if="connector.startDot" :d="connector.startDot" :fill="s.color" stroke="none" />
          <path v-if="connector.endDot" :d="connector.endDot" :fill="s.color" stroke="none" />
        </template>
      </g>
      <!-- Connector Text Labels (on top of cards and shapes) -->
      <template v-for="{ shape: s, line, connector } in renderedShapes" :key="`lbl-${s.id}`">
        <text
          v-if="line && connector && s.text?.trim()"
          :x="connector.labelPoint.x"
          :y="connector.labelPoint.y - 6"
          text-anchor="middle"
          font-size="11"
          font-weight="600"
          fill="currentColor"
        >{{ s.text }}</text>
      </template>
    </svg>
    <span v-if="box.empty" class="absolute inset-0 grid place-items-center text-sm text-ink-faint">Empty whiteboard</span>
    <span class="absolute left-2 top-2 flex items-center gap-1 rounded-md bg-surface/90 px-1.5 py-0.5 text-[11px] font-medium text-ink-soft ring-1 ring-line pointer-events-none">
      <AppIcon fallback="ph:chalkboard-teacher" :size="12" />{{ targetObject?.title || 'Whiteboard' }}
      <template v-if="currentScene">
        <span class="text-ink-faint">/</span>
        <AppIcon fallback="ph:film-slate" :size="11" class="text-primary" />
        <span class="text-primary font-semibold">{{ currentScene.name }}</span>
      </template>
      <template v-else-if="isAuto">
        <span class="text-ink-faint">/</span>
        <span class="text-primary font-semibold">Auto</span>
      </template>
    </span>

    <!-- Interactive Selection Action: Scene Selector & Edit Button -->
    <div
      v-if="interactive && (selected || 'group-hover:opacity-100')"
      class="absolute right-2 top-2 z-10 flex items-center gap-1.5 transition-opacity"
      :class="selected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'"
      @click.stop
    >
      <!-- Scene Selector Dropdown when scenes exist (styled to match edit button) -->
      <label
        v-if="scenes.length > 0"
        class="relative flex h-6 cursor-pointer items-center gap-1 rounded-md bg-surface/95 px-2 text-[11px] font-semibold text-ink shadow-xs ring-1 ring-line hover:bg-surface hover:text-primary transition-all backdrop-blur-sm"
        title="Choose Scene for this embed"
      >
        <AppIcon fallback="ph:film-slate" :size="12" class="text-primary shrink-0" />
        <span class="truncate max-w-[100px]">{{ activeSelectValue === 'auto' ? 'Auto' : (scenes.find(s => s.id === activeSelectValue)?.name || 'Scene') }}</span>
        <AppIcon fallback="ph:caret-down" :size="10" class="text-ink-soft shrink-0" />
        <select
          :value="activeSelectValue"
          class="absolute inset-0 h-full w-full opacity-0 cursor-pointer"
          title="Choose Scene for this embed"
          @change="onSceneSelect(($event.target as HTMLSelectElement).value)"
        >
          <option value="auto">Auto</option>
          <option
            v-for="s in scenes"
            :key="s.id"
            :value="s.id"
          >
            {{ s.name }}
          </option>
        </select>
      </label>

      <button
        class="flex h-6 items-center gap-1 rounded-md bg-surface/95 px-2 text-[11px] font-semibold text-ink shadow-xs ring-1 ring-line hover:bg-surface hover:text-primary transition-all backdrop-blur-sm"
        title="Edit whiteboard"
        @click.stop="open"
      >
        <AppIcon fallback="ph:arrow-square-out" :size="12" />
        <span>Edit</span>
      </button>
    </div>
  </div>
</template>
