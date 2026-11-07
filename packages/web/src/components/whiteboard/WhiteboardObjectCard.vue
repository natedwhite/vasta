<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import type { Backlink, ColorName, DocNode, Id, ObjectRecord, ObjectSummary, PropertyDef } from '@vasta/core'
import { api } from '../../lib/api.ts'
import { chip, iconTextClasses } from '../../lib/colors.ts'
import { onChange } from '../../lib/events.ts'
import { displayTitle } from '../../lib/format.ts'
import { imageOf } from '../../lib/media.ts'
import { runServerQuery } from '../../lib/query.ts'
import { primeSummaries, summaryOf, typesById } from '../../lib/state.ts'
import AppIcon from '../AppIcon.vue'
import DocPreview from '../DocPreview.ts'
import ObjectChip from '../ObjectChip.vue'
import PropertyDisplay from '../PropertyDisplay.vue'
import type { CardContentMode, ObjectCardElement } from './types.ts'

const props = withDefaults(
  defineProps<{
    card: ObjectCardElement
    selected?: boolean
    interactive?: boolean
    embedded?: boolean
  }>(),
  {
    selected: false,
    interactive: true,
    embedded: false,
  },
)

const emit = defineEmits<{
  open: [objectId: Id]
  remove: [cardId: string]
  heightChange: [cardId: string, height: number]
}>()

const router = useRouter()

const summary = computed<ObjectSummary | undefined>(() => summaryOf(props.card.objectId))
const type = computed(() => {
  const s = summary.value
  return typesById.value.get(s?.typeId ?? props.card.typeId)
})

const title = computed(() => {
  const s = summary.value
  if (s) return s.title || displayTitle(s, type.value)
  return props.card.title || 'Untitled'
})

const typeName = computed(() => type.value?.name || props.card.typeName || 'Page')
const typeColor = computed<ColorName | undefined>(() => (type.value?.color || props.card.typeColor) as ColorName | undefined)
const typeIcon = computed(() => type.value?.icon?.value || props.card.typeIcon || 'ph:file-text')

const imageBroken = ref(false)
const coverImage = computed(() => {
  if (imageBroken.value || !summary.value) return undefined
  return imageOf(summary.value)
})

const shownProperties = computed<PropertyDef[]>(() => {
  const showIds = props.card.showProperties
  if (!showIds || !showIds.length) return []
  const allProps = type.value?.properties ?? []
  return allProps.filter((p) => p.kind !== 'rich-text' && showIds.includes(p.id))
})

function propertyValue(prop: PropertyDef) {
  return summary.value?.props?.[prop.id]
}

const reverseLinks = ref<Backlink[]>([])
async function loadReverseRelations() {
  try {
    const list = (await api.backlinks(props.card.objectId)).filter((l) => l.kind === 'relation')
    primeSummaries(list.map((l) => l.object))
    reverseLinks.value = list
  } catch {
    reverseLinks.value = []
  }
}

watch(() => props.card.objectId, () => void loadReverseRelations(), { immediate: true })

interface ReverseRelationRow {
  key: string
  name: string
  objects: ObjectSummary[]
}

const shownReverseRelations = computed<ReverseRelationRow[]>(() => {
  const showIds = props.card.showProperties
  if (!showIds || !showIds.length || !reverseLinks.value.length) return []
  const byKey = new Map<string, ReverseRelationRow>()
  for (const link of reverseLinks.value) {
    const fromType = typesById.value.get(link.object.typeId)
    const def = fromType?.properties.find((p) => p.id === link.via)
    if (def?.kind !== 'relation') continue
    if (!showIds.includes(def.id)) continue
    const key = `${link.object.typeId}/${def.id}`
    const displayName = def.reverseName?.trim() || `${fromType?.name || 'Object'} · ${def.name}`
    const row = byKey.get(key) ?? { key, name: displayName, objects: [] }
    if (!row.objects.some((o) => o.id === link.object.id)) {
      row.objects.push(link.object)
    }
    byKey.set(key, row)
  }
  return [...byKey.values()]
})

const effectiveContentMode = computed<CardContentMode>(() => {
  if (props.card.contentMode) return props.card.contentMode
  return props.card.showContent ? 'preview' : 'none'
})

// Full-page rich text loading (only fetched when effectiveContentMode === 'full')
const fullObject = ref<ObjectRecord | null>(null)
const fullLoading = ref(false)
let fullReqSeq = 0

async function loadFullObject() {
  if (effectiveContentMode.value !== 'full') return
  const seq = ++fullReqSeq
  fullLoading.value = !fullObject.value
  try {
    const rec = await api.object(props.card.objectId)
    if (seq === fullReqSeq) fullObject.value = rec
  } catch {
    // ignore missing/deleted object
  } finally {
    if (seq === fullReqSeq) fullLoading.value = false
  }
}

watch(
  () => [props.card.objectId, effectiveContentMode.value] as const,
  ([, mode]) => {
    if (mode === 'full') void loadFullObject()
  },
  { immediate: true },
)

const fullDocNodes = computed<DocNode[]>(() => {
  const rec = fullObject.value
  if (!rec?.content) return []
  const nodes: DocNode[] = []
  for (const doc of Object.values(rec.content)) {
    if (doc?.content?.length) nodes.push(...doc.content)
  }
  return nodes
})

// Live Query results (only fetched when summary.query is present)
const isQueryCard = computed(() => !!summary.value?.query || type.value?.system === 'query')
const queryResults = ref<ObjectSummary[]>([])
const queryLoading = ref(false)
let querySeq = 0

async function loadQueryResults() {
  const q = summary.value?.query
  if (!q) {
    queryResults.value = []
    return
  }
  const seq = ++querySeq
  queryLoading.value = !queryResults.value.length
  try {
    const list = await runServerQuery(q)
    if (seq !== querySeq) return
    primeSummaries(list)
    queryResults.value = list
  } catch {
    if (seq === querySeq) queryResults.value = []
  } finally {
    if (seq === querySeq) queryLoading.value = false
  }
}

watch(
  () => (summary.value?.query ? JSON.stringify(summary.value.query) : ''),
  (qStr) => {
    if (qStr) void loadQueryResults()
  },
  { immediate: true },
)

let changeTimer: ReturnType<typeof setTimeout> | undefined
let revTimer: ReturnType<typeof setTimeout> | undefined
const stopChange = onChange((event) => {
  if (event.kind !== 'object') return
  if (event.id === props.card.objectId && effectiveContentMode.value === 'full') {
    void loadFullObject()
  }
  if (isQueryCard.value) {
    clearTimeout(changeTimer)
    changeTimer = setTimeout(() => void loadQueryResults(), 350)
  }
  clearTimeout(revTimer)
  revTimer = setTimeout(() => void loadReverseRelations(), 400)
})

onBeforeUnmount(() => {
  stopChange()
  clearTimeout(changeTimer)
  clearTimeout(revTimer)
})

function openObject(id: Id) {
  if (props.interactive) {
    emit('open', id)
  } else {
    router.push(`/o/${id}`)
  }
}

function getResultType(item: ObjectSummary) {
  return typesById.value.get(item.typeId)
}

const cardEl = ref<HTMLElement | null>(null)
let resizeObserver: ResizeObserver | null = null

onMounted(() => {
  if (props.embedded || !cardEl.value || typeof ResizeObserver === 'undefined') return
  resizeObserver = new ResizeObserver((entries) => {
    for (const entry of entries) {
      const h = Math.round(entry.borderBoxSize?.[0]?.blockSize ?? cardEl.value?.offsetHeight ?? 0)
      if (h > 0 && Math.abs(props.card.height - h) > 1) {
        if (effectiveContentMode.value !== 'full' && !isQueryCard.value) {
          props.card.height = h
          emit('heightChange', props.card.id, h)
        }
      }
    }
  })
  resizeObserver.observe(cardEl.value)
})

onBeforeUnmount(() => {
  resizeObserver?.disconnect()
})
</script>

<template>
  <div
    ref="cardEl"
    class="flex flex-col rounded-xl border border-line bg-surface p-3 shadow-md pointer-events-none overflow-hidden"
    :class="embedded ? 'w-full h-full' : 'absolute'"
    :style="
      embedded
        ? {
            width: '100%',
            height: '100%',
            boxSizing: 'border-box',
          }
        : {
            left: `${card.x}px`,
            top: `${card.y}px`,
            width: `${card.width}px`,
            height: effectiveContentMode === 'full' || isQueryCard ? `${card.height}px` : undefined,
            minHeight: `${card.height}px`,
            transform: card.rotation ? `rotate(${card.rotation}deg)` : undefined,
            transformOrigin: 'center center',
            boxShadow: selected ? '0 0 0 2px #3b82f6' : undefined,
            zIndex: card.zIndex,
          }
    "
  >
    <!-- Header Row: Type Chip + Action Buttons -->
    <div class="flex shrink-0 items-center justify-between gap-1 text-xs">
      <span
        class="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium"
        :class="chip(typeColor)"
      >
        <AppIcon :icon="summary?.icon ?? type?.icon" :fallback="typeIcon" :size="12" />
        <span>{{ typeName }}</span>
      </span>

      <div v-if="interactive" class="pointer-events-auto flex items-center gap-1" data-wb-ui>
        <button
          class="rounded p-1 text-ink-soft hover:bg-hover hover:text-ink"
          title="Open in Vasta"
          @click.stop="openObject(card.objectId)"
        >
          <AppIcon fallback="ph:arrow-square-out" :size="14" />
        </button>
        <button
          class="rounded p-1 text-ink-soft hover:bg-hover hover:text-red-600"
          title="Remove from whiteboard"
          @click.stop="emit('remove', card.id)"
        >
          <AppIcon fallback="ph:x" :size="14" />
        </button>
      </div>
    </div>

    <!-- Cover / Media Image (for Image or Weblink objects) -->
    <div v-if="coverImage" class="my-1.5 shrink-0 overflow-hidden rounded-lg border border-line/50 bg-hover">
      <img
        :src="coverImage"
        alt=""
        loading="lazy"
        class="max-h-36 w-full object-cover"
        @error="imageBroken = true"
      />
    </div>

    <!-- Object Title -->
    <h4 class="my-1.5 shrink-0 line-clamp-2 font-semibold leading-snug text-ink">
      {{ title }}
    </h4>

    <!-- Selected Custom / System Properties + Reverse Relations -->
    <div
      v-if="shownProperties.length || shownReverseRelations.length"
      class="my-1 flex shrink-0 flex-col gap-1 border-t border-line/60 pt-1.5 text-xs text-ink-soft"
    >
      <div
        v-for="prop in shownProperties"
        :key="prop.id"
        class="flex items-center justify-between gap-2"
      >
        <span class="truncate text-[11px] text-ink-faint">{{ prop.name }}:</span>
        <div class="truncate text-right text-[11px]">
          <PropertyDisplay :def="prop" :value="propertyValue(prop)" :object="summary" />
        </div>
      </div>

      <div
        v-for="rev in shownReverseRelations"
        :key="rev.key"
        class="flex items-center justify-between gap-2"
      >
        <span class="truncate text-[11px] text-ink-faint">{{ rev.name }}:</span>
        <div class="truncate text-right text-[11px] flex items-center gap-1 justify-end">
          <ObjectChip v-for="o in rev.objects" :key="o.id" :id="o.id" />
        </div>
      </div>
    </div>

    <!-- Object Tags (if any) -->
    <div v-if="summary?.tagIds?.length" class="my-1 flex shrink-0 flex-wrap gap-1">
      <ObjectChip v-for="tagId in summary.tagIds" :key="tagId" :id="tagId" tag />
    </div>

    <!-- 1. Query Card: Clean Live List of Matching Objects -->
    <div
      v-if="isQueryCard"
      class="my-1.5 flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-line/70 bg-hover/30 text-xs"
      :class="interactive ? 'pointer-events-auto' : 'pointer-events-none'"
      data-wb-ui
      @wheel.stop
    >
      <div class="flex shrink-0 items-center justify-between border-b border-line/50 px-2.5 py-1.5 text-[11px] font-medium text-ink-soft">
        <span class="inline-flex items-center gap-1">
          <AppIcon fallback="ph:funnel" :size="12" />
          <span>Matching Objects</span>
        </span>
        <span class="rounded-full bg-surface px-1.5 py-0.2 text-[10px] font-semibold text-ink-faint border border-line/60">
          {{ queryResults.length }}
        </span>
      </div>

      <div class="flex-1 overflow-y-auto divide-y divide-line/40 p-1">
        <p v-if="queryLoading" class="px-2 py-3 text-center text-[11px] text-ink-faint">
          Loading results…
        </p>
        <p v-else-if="!queryResults.length" class="px-2 py-3 text-center text-[11px] text-ink-faint">
          No matching objects.
        </p>
        <button
          v-for="item in queryResults"
          :key="item.id"
          type="button"
          class="group flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition hover:bg-surface"
          @click.stop="openObject(item.id)"
        >
          <AppIcon
            :icon="item.icon ?? getResultType(item)?.icon"
            fallback="ph:file-text"
            :size="14"
            class="shrink-0"
            :class="getResultType(item)?.color ? iconTextClasses[getResultType(item)!.color!] : 'text-ink-soft'"
          />
          <span class="min-w-0 flex-1 truncate text-xs font-medium text-ink">
            {{ displayTitle(item, getResultType(item)) }}
          </span>
          <span
            v-if="getResultType(item)"
            class="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium"
            :class="chip(getResultType(item)?.color)"
          >
            {{ getResultType(item)?.name }}
          </span>
        </button>
      </div>
    </div>

    <!-- 2. Standard Page / Object: Text Preview Mode -->
    <p
      v-else-if="effectiveContentMode === 'preview' && summary?.preview"
      class="my-1 text-xs text-ink-soft line-clamp-5 whitespace-pre-line rounded-lg border border-line/50 bg-hover/40 p-2"
    >
      {{ summary.preview }}
    </p>

    <!-- 3. Standard Page / Object: Full Page Body Mode -->
    <div
      v-else-if="effectiveContentMode === 'full'"
      class="my-1.5 min-h-0 flex-1 overflow-y-auto rounded-lg border border-line/60 bg-hover/25 p-2.5 text-xs text-ink"
      :class="interactive ? 'pointer-events-auto' : 'pointer-events-none'"
      data-wb-ui
      @wheel.stop
    >
      <p v-if="fullLoading" class="py-2 text-xs text-ink-faint">Loading page content…</p>
      <DocPreview v-else-if="fullDocNodes.length" :content="fullDocNodes" class="!text-xs !leading-relaxed" />
      <p v-else-if="summary?.preview" class="whitespace-pre-line text-xs text-ink-soft">{{ summary.preview }}</p>
      <p v-else class="py-2 text-xs italic text-ink-faint">Empty page</p>
    </div>
  </div>
</template>
