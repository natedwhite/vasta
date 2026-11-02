<script setup lang="ts">
import { inject } from 'vue'
import AppIcon from '../AppIcon.vue'
import { kindIcon } from '../../lib/properties.ts'
import { WHITEBOARD_CTX } from './context.ts'
import { STICKY_COLORS } from './shapes.ts'
import type { StickyFontSize } from './types.ts'

const {
  isSceneDrawing,
  sceneDraftScreenRect,
  sceneDraftRect,
  editingSceneName,
  getAspectRatioText,
  onScenePointerDown,
  onScenePointerMove,
  onScenePointerUp,
  saveDefiningScene,
  cancelDefiningScene,
  eraserCursor,
  currentTool,
  eraserMode,
  eraserSize,
  activePopover,
  closeAllPopovers,
  togglePopover,
  hasSelectedItems,
  activeMode,
  floatingMenuStyle,
  floatingPopoverStyle,
  hasSelected2DShapes,
  selectionOutlineColor,
  selectionFillPreviewBg,
  selectedStrokeIds,
  hasSelectedLines,
  selectionPrimaryColor,
  selectedStickyIds,
  startEditing,
  selectedCardIds,
  duplicateSelected,
  deleteSelected,
  activePalette,
  handleSwatchClick,
  handleSwatchInput,
  handleStickySwatchClick,
  isBrightColor,
  registerColorInput,
  setSelectionColor,
  selectionStrokeWidth,
  setSelectionStrokeWidth,
  selectionStrokeStyle,
  setSelectionStrokeStyle,
  selectionShapeFill,
  setSelectionFill,
  selectionShapeFillColor,
  setSelectionFillColor,
  setSelectionStickyColor,
  selectionCurvature,
  setSelectionCurvature,
  selectionStartOrientation,
  setSelectionStartOrientation,
  selectionEndOrientation,
  setSelectionEndOrientation,
  selectionStartAnchored,
  selectionEndAnchored,
  selectionStartTermination,
  setSelectionStartTermination,
  selectionEndTermination,
  setSelectionEndTermination,
  currentStickyFontSize,
  setSelectionStickyFontSize,
  selectionStickyTextColor,
  setSelectionStickyTextColor,
  bringToFront,
  bringForward,
  sendToBack,
  sendBackward,
  selectedCard,
  selectedCardIsQuery,
  selectedCardContentMode,
  setCardContentMode,
  selectedCardAvailableProperties,
  isCardPropertyShown,
  toggleCardProperty,
} = inject(WHITEBOARD_CTX)!
</script>

<template>
  <!-- ================================================================= -->
  <!-- SCENE DEFINING / FRAMING OVERLAY (Drag rectangle over whiteboard) -->
  <!-- ================================================================= -->
  <template v-if="isSceneDrawing">
    <!-- Darkened backdrop with cut-out / mask for scene draft -->
    <svg class="absolute inset-0 z-45 h-full w-full pointer-events-none overflow-hidden">
      <defs>
        <mask id="scene-cutout-mask">
          <rect width="100%" height="100%" fill="white" />
          <rect
            v-if="sceneDraftScreenRect"
            :x="sceneDraftScreenRect.x"
            :y="sceneDraftScreenRect.y"
            :width="sceneDraftScreenRect.w"
            :height="sceneDraftScreenRect.h"
            fill="black"
            rx="4"
          />
        </mask>
      </defs>
      <rect
        width="100%"
        height="100%"
        fill="rgba(15, 23, 42, 0.45)"
        mask="url(#scene-cutout-mask)"
      />
    </svg>

    <!-- Interactive gesture area for drawing / tweaking the scene rect -->
    <div
      class="absolute inset-0 z-46 cursor-crosshair select-none"
      @pointerdown.stop.prevent="onScenePointerDown"
      @pointermove.stop.prevent="onScenePointerMove"
      @pointerup.stop.prevent="onScenePointerUp"
      @pointercancel.stop.prevent="onScenePointerUp"
    >
      <!-- The draft rectangle border, dimensions tag, and grab handles -->
      <div
        v-if="sceneDraftScreenRect && sceneDraftScreenRect.w > 4 && sceneDraftScreenRect.h > 4"
        class="absolute border-2 border-primary ring-1 ring-white/60 shadow-2xl rounded-xs pointer-events-none"
        :style="{
          left: `${sceneDraftScreenRect.x}px`,
          top: `${sceneDraftScreenRect.y}px`,
          width: `${sceneDraftScreenRect.w}px`,
          height: `${sceneDraftScreenRect.h}px`,
        }"
      >
        <!-- Top dimensions pill -->
        <div class="absolute -top-7 left-0 flex items-center gap-1.5 rounded-md bg-primary px-2 py-0.5 text-[11px] font-mono font-semibold text-white shadow-md pointer-events-none whitespace-nowrap">
          <AppIcon fallback="ph:film-slate" :size="12" />
          <span>{{ Math.round(sceneDraftRect!.w) }} × {{ Math.round(sceneDraftRect!.h) }}</span>
          <span class="opacity-75 text-[10px]">({{ getAspectRatioText(sceneDraftRect!.w, sceneDraftRect!.h) }})</span>
        </div>

        <!-- Corner Grab Handles for visual and touch feedback -->
        <div class="absolute -left-2 -top-2 h-4 w-4 rounded-full border-2 border-primary bg-white shadow-md cursor-nwse-resize" />
        <div class="absolute -right-2 -top-2 h-4 w-4 rounded-full border-2 border-primary bg-white shadow-md cursor-nesw-resize" />
        <div class="absolute -right-2 -bottom-2 h-4 w-4 rounded-full border-2 border-primary bg-white shadow-md cursor-nwse-resize" />
        <div class="absolute -left-2 -bottom-2 h-4 w-4 rounded-full border-2 border-primary bg-white shadow-md cursor-nesw-resize" />
      </div>
    </div>

    <!-- Top Scene Controls Banner -->
    <div
      class="pointer-events-auto absolute top-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 rounded-2xl border border-line bg-surface/95 px-3.5 py-2 shadow-2xl backdrop-blur-xl text-xs select-none max-w-[95vw]"
      data-wb-ui
      @pointerdown.stop
      @click.stop
    >
      <div class="flex items-center gap-1.5 text-ink font-semibold">
        <AppIcon fallback="ph:film-slate" :size="16" class="text-primary" />
        <span class="max-sm:hidden">Scene:</span>
      </div>
      <input
        v-model="editingSceneName"
        placeholder="Scene Name"
        class="rounded-lg border border-line bg-hover/80 px-2.5 py-1 text-xs font-semibold text-ink outline-none focus:border-primary focus:bg-surface w-36 sm:w-48 transition-all"
        @keydown.enter.stop="saveDefiningScene"
      />

      <div class="h-4 w-px bg-line mx-0.5" />

      <button
        v-if="sceneDraftRect && sceneDraftRect.w > 20 && sceneDraftRect.h > 20"
        class="flex items-center gap-1 rounded-lg bg-primary px-3 py-1 text-xs font-semibold text-white shadow-sm hover:bg-primary/90 transition-all active:scale-95"
        @click.stop="saveDefiningScene"
      >
        <AppIcon fallback="ph:check" :size="14" />
        <span>Save Scene</span>
      </button>

      <button
        class="flex items-center gap-1 rounded-lg px-2.5 py-1 text-ink-soft hover:bg-hover hover:text-ink transition-colors"
        @click.stop="cancelDefiningScene"
      >
        Cancel
      </button>
    </div>

    <!-- Bottom Drag Prompt if no rect yet -->
    <div
      v-if="!sceneDraftRect || (sceneDraftRect.w < 10 && sceneDraftRect.h < 10)"
      class="pointer-events-none absolute bottom-8 left-1/2 -translate-x-1/2 z-50 rounded-full bg-black/80 px-4 py-2 text-xs font-medium text-white shadow-2xl backdrop-blur-md animate-pulse"
    >
      Drag a rectangle over the whiteboard to choose scene dimensions
    </div>
  </template>

  <!-- Visual Brush Cursor for Pixel Eraser -->
  <div
    v-if="eraserCursor && currentTool === 'eraser' && eraserMode === 'pixel'"
    class="pointer-events-none fixed rounded-full border border-red-500 bg-red-500/20 z-50 -translate-x-1/2 -translate-y-1/2"
    :style="{
      left: `${eraserCursor.x}px`,
      top: `${eraserCursor.y}px`,
      width: `${eraserSize}px`,
      height: `${eraserSize}px`,
    }"
  />

  <!-- Popover Dismiss Backdrop (prevents clicks punching through to canvas elements) -->
  <div
    v-if="activePopover"
    class="fixed inset-0 z-40 bg-transparent"
    data-wb-ui
    @pointerdown.stop="closeAllPopovers"
    @touchstart.stop="closeAllPopovers"
    @mousedown.stop="closeAllPopovers"
  />

  <!-- Floating Selection Menu (anchored near top of selection bounding box) -->
  <div
    v-if="hasSelectedItems && !isSceneDrawing && activeMode !== 'move' && activeMode !== 'resize' && activeMode !== 'rotate'"
    class="pointer-events-auto absolute z-45 flex items-center gap-1 rounded-xl border border-line bg-surface/95 px-2 py-1 shadow-xl backdrop-blur-md text-xs select-none"
    :style="floatingMenuStyle"
    data-wb-ui
    @pointerdown.stop
    @pointerup.stop
    @touchstart.stop
    @touchend.stop
    @mousedown.stop
    @mouseup.stop
    @click.stop
  >
    <!-- 2D SHAPES: Separate Outline and Fill Triggers -->
    <template v-if="hasSelected2DShapes">
      <button
        class="relative flex h-7 w-7 items-center justify-center rounded-lg text-ink hover:bg-hover active:scale-95 transition-all"
        :class="activePopover === 'selection-outline' ? 'bg-primary/15 text-primary ring-1 ring-primary/40' : ''"
        title="Outline (Color, Weight, Style)"
        @click.stop="togglePopover('selection-outline')"
      >
        <AppIcon fallback="ph:square" :size="16" />
        <span class="absolute bottom-1 right-1 h-2 w-2 rounded-full border border-surface shadow-xs" :style="{ backgroundColor: selectionOutlineColor }" />
      </button>

      <button
        class="relative flex h-7 w-7 items-center justify-center rounded-lg text-ink hover:bg-hover active:scale-95 transition-all"
        :class="activePopover === 'selection-fill' ? 'bg-primary/15 text-primary ring-1 ring-primary/40' : ''"
        title="Fill (Style, Color)"
        @click.stop="togglePopover('selection-fill')"
      >
        <AppIcon fallback="ph:paint-bucket" :size="16" />
        <span class="absolute bottom-1 right-1 h-2 w-2 rounded-full border border-surface shadow-xs" :style="{ backgroundColor: selectionFillPreviewBg }" />
      </button>
    </template>

    <!-- STROKES & 1D CONNECTORS: Stroke Trigger -->
    <button
      v-if="selectedStrokeIds.length || hasSelectedLines"
      class="flex h-7 items-center gap-1.5 px-2 rounded-lg text-ink hover:bg-hover active:scale-95 transition-all"
      :class="activePopover === 'selection-stroke' ? 'bg-primary/15 text-primary ring-1 ring-primary/40' : ''"
      title="Stroke & Style"
      @click.stop="togglePopover('selection-stroke')"
    >
      <span class="h-3.5 w-3.5 rounded-full ring-1 ring-black/15 shadow-xs" :style="{ backgroundColor: selectionPrimaryColor }" />
      <AppIcon fallback="ph:line-segments" :size="15" />
    </button>

    <!-- STICKY NOTE: Edit Text Trigger -->
    <button
      v-if="selectedStickyIds.length === 1"
      class="flex h-7 w-7 items-center justify-center rounded-lg text-ink-soft hover:bg-hover hover:text-ink active:scale-95 transition-all"
      title="Edit Text"
      @click.stop="startEditing(selectedStickyIds[0]!)"
    >
      <AppIcon fallback="ph:text-t" :size="15" />
    </button>

    <!-- STICKY NOTE: Color Trigger -->
    <button
      v-if="selectedStickyIds.length"
      class="flex h-7 w-7 items-center justify-center rounded-lg hover:bg-hover active:scale-95 transition-all"
      :class="activePopover === 'selection-color' ? 'bg-primary/15 text-primary ring-1 ring-primary/40' : ''"
      title="Sticky Color"
      @click.stop="togglePopover('selection-color')"
    >
      <span class="h-4 w-4 rounded-full ring-1 ring-black/15 shadow-xs" :style="{ backgroundColor: selectionPrimaryColor }" />
    </button>

    <!-- Sticky Text Size Trigger -->
    <button
      v-if="selectedStickyIds.length"
      class="flex h-7 w-7 items-center justify-center rounded-lg font-bold text-xs text-ink-soft hover:bg-hover hover:text-ink active:scale-95 transition-all"
      :class="activePopover === 'selection-text' ? 'bg-primary/15 text-primary ring-1 ring-primary/40' : ''"
      title="Text Size"
      @click.stop="togglePopover('selection-text')"
    >
      Aa
    </button>

    <!-- Object Card Details & Fields Trigger -->
    <button
      v-if="selectedCardIds.length === 1"
      class="flex h-7 w-7 items-center justify-center rounded-lg text-ink hover:bg-hover active:scale-95 transition-all"
      :class="activePopover === 'selection-card-fields' ? 'bg-primary/15 text-primary ring-1 ring-primary/40' : ''"
      title="Card Fields & Preview"
      @click.stop="togglePopover('selection-card-fields')"
    >
      <AppIcon fallback="ph:sliders-horizontal" :size="16" />
    </button>

    <!-- Layering / Z-Order Trigger -->
    <button
      class="flex h-7 w-7 items-center justify-center rounded-lg text-ink-soft hover:bg-hover hover:text-ink active:scale-95 transition-all"
      :class="activePopover === 'selection-zorder' ? 'bg-primary/15 text-primary ring-1 ring-primary/40' : ''"
      title="Layers & Order"
      @click.stop="togglePopover('selection-zorder')"
    >
      <AppIcon fallback="ph:stack" :size="16" />
    </button>

    <div class="mx-0.5 h-4 w-px bg-line" />

    <!-- Duplicate -->
    <button
      class="flex h-7 w-7 items-center justify-center rounded-lg text-ink-soft hover:bg-hover hover:text-ink active:scale-95 transition-all"
      title="Duplicate (⌘D)"
      @click.stop="duplicateSelected"
    >
      <AppIcon fallback="ph:copy" :size="16" />
    </button>

    <!-- Delete -->
    <button
      class="flex h-7 w-7 items-center justify-center rounded-lg text-red-500 hover:bg-red-50 dark:hover:bg-red-950/40 active:scale-95 transition-all"
      title="Delete (⌫)"
      @click.stop="deleteSelected"
    >
      <AppIcon fallback="ph:trash" :size="16" />
    </button>
  </div>

  <!-- Floating Selection Popovers (anchored near the selection) -->
  <div
    v-if="hasSelectedItems && activePopover && activePopover.startsWith('selection-')"
    class="pointer-events-auto absolute z-50 flex flex-col gap-2 rounded-2xl border border-line bg-surface p-3 shadow-2xl backdrop-blur-xl ring-1 ring-black/5 text-xs select-none w-72 sm:w-80 max-h-[min(520px,calc(100vh-80px))] overflow-y-auto overscroll-contain"
    :style="floatingPopoverStyle"
    data-wb-ui
    @pointerdown.stop
    @pointerup.stop
    @touchstart.stop
    @touchend.stop
    @mousedown.stop
    @mouseup.stop
    @click.stop
  >
    <!-- 1. Selection Outline Popover (for 2D Shapes) -->
    <template v-if="activePopover === 'selection-outline'">
      <span class="text-[10px] font-bold uppercase tracking-wider text-ink-faint">Outline Color</span>
      <div class="grid grid-cols-4 gap-1.5">
        <button
          v-for="(c, idx) in activePalette"
          :key="idx"
          class="relative flex h-6 w-full items-center justify-center rounded-md transition-transform hover:scale-110 ring-1 ring-black/10"
          :style="{ backgroundColor: c }"
          :class="(selectionOutlineColor || '').toLowerCase() === c.toLowerCase() ? 'ring-2 ring-primary ring-offset-2 scale-105' : ''"
          @click.stop="handleSwatchClick(c, idx, selectionOutlineColor, setSelectionColor, 'sel_outline')"
        >
          <AppIcon
            v-if="(selectionOutlineColor || '').toLowerCase() === c.toLowerCase()"
            fallback="ph:pencil-simple"
            :size="11"
            :class="isBrightColor(c) ? 'text-black/80' : 'text-white/90'"
          />
          <input
            type="color"
            :value="c"
            class="absolute inset-0 opacity-0 cursor-pointer"
            :class="(selectionOutlineColor || '').toLowerCase() === c.toLowerCase() ? 'h-full w-full pointer-events-auto z-10' : 'h-0 w-0 pointer-events-none'"
            :ref="(el) => registerColorInput(`sel_outline_${idx}`, el)"
            @input="handleSwatchInput($event, idx, setSelectionColor)"
            @change="handleSwatchInput($event, idx, setSelectionColor)"
          />
        </button>
        <label class="relative flex h-6 w-full cursor-pointer items-center justify-center rounded-md border border-line bg-surface hover:bg-hover transition-transform hover:scale-110 shadow-xs" title="Custom color">
          <AppIcon fallback="ph:paint-brush" :size="12" class="text-ink-soft" />
          <input type="color" :value="selectionOutlineColor" class="absolute inset-0 opacity-0 cursor-pointer w-full h-full" @input="setSelectionColor(($event.target as HTMLInputElement).value)" />
        </label>
      </div>

      <span class="text-[10px] font-bold uppercase tracking-wider text-ink-faint mt-1">Weight</span>
      <div class="flex gap-1">
        <button
          v-for="w in [2, 4, 8, 16]"
          :key="w"
          class="flex h-7 flex-1 items-center justify-center rounded-lg border transition-all"
          :class="selectionStrokeWidth === w ? 'border-primary bg-primary/10 text-primary' : 'border-line hover:bg-hover text-ink-soft'"
          :title="`${w}px`"
          @click="setSelectionStrokeWidth(w)"
        >
          <div class="rounded-full bg-current" :style="{ width: '22px', height: `${Math.min(w, 8)}px` }" />
        </button>
      </div>

      <span class="text-[10px] font-bold uppercase tracking-wider text-ink-faint mt-1">Style</span>
      <div class="flex gap-1">
        <button class="flex h-7 flex-1 items-center justify-center rounded-lg border transition-all" :class="selectionStrokeStyle === 'solid' ? 'border-primary bg-primary/10 text-primary' : 'border-line hover:bg-hover text-ink-soft'" title="Solid" @click="setSelectionStrokeStyle('solid')">
          <div class="h-0.5 w-6 bg-current rounded" />
        </button>
        <button class="flex h-7 flex-1 items-center justify-center rounded-lg border transition-all" :class="selectionStrokeStyle === 'dashed' ? 'border-primary bg-primary/10 text-primary' : 'border-line hover:bg-hover text-ink-soft'" title="Dashed" @click="setSelectionStrokeStyle('dashed')">
          <div class="h-0.5 w-6 border-b-2 border-dashed border-current" />
        </button>
        <button class="flex h-7 flex-1 items-center justify-center rounded-lg border transition-all" :class="selectionStrokeStyle === 'dotted' ? 'border-primary bg-primary/10 text-primary' : 'border-line hover:bg-hover text-ink-soft'" title="Dotted" @click="setSelectionStrokeStyle('dotted')">
          <div class="h-0.5 w-6 border-b-2 border-dotted border-current" />
        </button>
      </div>
    </template>

    <!-- 2. Selection Fill Popover (for 2D Shapes) -->
    <template v-else-if="activePopover === 'selection-fill'">
      <span class="text-[10px] font-bold uppercase tracking-wider text-ink-faint">Fill Style</span>
      <div class="grid grid-cols-2 gap-1.5">
        <button
          class="flex items-center gap-1.5 px-2 py-1.5 rounded-lg border text-xs transition-all"
          :class="selectionShapeFill === 'none' ? 'border-primary bg-primary/10 text-primary font-medium' : 'border-line hover:bg-hover text-ink-soft'"
          @click.stop="setSelectionFill('none')"
        >
          <AppIcon fallback="ph:prohibit" :size="14" />
          <span>No Fill</span>
        </button>
        <button
          class="flex items-center gap-1.5 px-2 py-1.5 rounded-lg border text-xs transition-all"
          :class="selectionShapeFill === 'tint' ? 'border-primary bg-primary/10 text-primary font-medium' : 'border-line hover:bg-hover text-ink-soft'"
          @click.stop="setSelectionFill('tint')"
        >
          <AppIcon fallback="ph:circle-half" :size="14" />
          <span>Tint (15%)</span>
        </button>
        <button
          class="flex items-center gap-1.5 px-2 py-1.5 rounded-lg border text-xs transition-all"
          :class="selectionShapeFill === 'white' ? 'border-primary bg-primary/10 text-primary font-medium' : 'border-line hover:bg-hover text-ink-soft'"
          @click.stop="setSelectionFill('white')"
        >
          <span class="h-3.5 w-3.5 rounded-xs border border-ink/40 bg-white shadow-2xs" />
          <span>White</span>
        </button>
        <button
          class="flex items-center gap-1.5 px-2 py-1.5 rounded-lg border text-xs transition-all"
          :class="selectionShapeFill === 'solid' ? 'border-primary bg-primary/10 text-primary font-medium' : 'border-line hover:bg-hover text-ink-soft'"
          @click.stop="setSelectionFill('solid')"
        >
          <span class="h-3.5 w-3.5 rounded-xs bg-current" />
          <span>Solid Fill</span>
        </button>
      </div>

      <template v-if="selectionShapeFill === 'tint' || selectionShapeFill === 'solid'">
        <span class="text-[10px] font-bold uppercase tracking-wider text-ink-faint mt-1">Fill Color</span>
        <div class="grid grid-cols-4 gap-1.5">
          <button
            v-for="(c, idx) in activePalette"
            :key="idx"
            class="relative flex h-6 w-full items-center justify-center rounded-md transition-transform hover:scale-110 ring-1 ring-black/10"
            :style="{ backgroundColor: c }"
            :class="(selectionShapeFillColor || '').toLowerCase() === c.toLowerCase() ? 'ring-2 ring-primary ring-offset-2 scale-105' : ''"
            @click.stop="handleSwatchClick(c, idx, selectionShapeFillColor, setSelectionFillColor, 'sel_fill')"
          >
            <AppIcon
              v-if="(selectionShapeFillColor || '').toLowerCase() === c.toLowerCase()"
              fallback="ph:pencil-simple"
              :size="11"
              :class="isBrightColor(c) ? 'text-black/80' : 'text-white/90'"
            />
            <input
              type="color"
              :value="c"
              class="absolute inset-0 opacity-0 cursor-pointer"
              :class="(selectionShapeFillColor || '').toLowerCase() === c.toLowerCase() ? 'h-full w-full pointer-events-auto z-10' : 'h-0 w-0 pointer-events-none'"
              :ref="(el) => registerColorInput(`sel_fill_${idx}`, el)"
              @input="handleSwatchInput($event, idx, setSelectionFillColor)"
              @change="handleSwatchInput($event, idx, setSelectionFillColor)"
            />
          </button>
          <label class="relative flex h-6 w-full cursor-pointer items-center justify-center rounded-md border border-line bg-surface hover:bg-hover transition-transform hover:scale-110 shadow-xs" title="Custom color">
            <AppIcon fallback="ph:paint-brush" :size="12" class="text-ink-soft" />
            <input type="color" :value="selectionShapeFillColor" class="absolute inset-0 opacity-0 cursor-pointer w-full h-full" @input="setSelectionFillColor(($event.target as HTMLInputElement).value)" />
          </label>
        </div>
      </template>
    </template>

    <!-- 3. Selection Sticky Color Popover -->
    <template v-else-if="activePopover === 'selection-color'">
      <span class="text-[10px] font-bold uppercase tracking-wider text-ink-faint">Sticky Color</span>
      <div class="grid grid-cols-4 gap-1.5">
        <button
          v-for="(st, name) in STICKY_COLORS"
          :key="name"
          class="relative flex h-6 w-full items-center justify-center rounded-md ring-1 ring-black/10 transition-transform hover:scale-110"
          :style="{ backgroundColor: st.bg }"
          :class="(selectionPrimaryColor === name || (selectionPrimaryColor || '').toLowerCase() === st.bg.toLowerCase()) ? 'ring-2 ring-primary ring-offset-1 scale-105' : ''"
          :title="name"
          @click="handleStickySwatchClick(name, st.bg, selectionPrimaryColor, setSelectionStickyColor, 'sel_sticky')"
        >
          <AppIcon
            v-if="selectionPrimaryColor === name || (selectionPrimaryColor || '').toLowerCase() === st.bg.toLowerCase()"
            fallback="ph:pencil-simple"
            :size="11"
            :class="isBrightColor(st.bg) ? 'text-black/80' : 'text-white/90'"
          />
          <input
            type="color"
            :value="st.bg"
            class="absolute inset-0 opacity-0 cursor-pointer"
            :class="(selectionPrimaryColor === name || (selectionPrimaryColor || '').toLowerCase() === st.bg.toLowerCase()) ? 'h-full w-full pointer-events-auto z-10' : 'h-0 w-0 pointer-events-none'"
            :ref="(el) => registerColorInput(`sel_sticky_${name}`, el)"
            @input="setSelectionStickyColor(($event.target as HTMLInputElement).value)"
            @change="setSelectionStickyColor(($event.target as HTMLInputElement).value)"
          />
        </button>
        <label class="relative flex h-6 w-full cursor-pointer items-center justify-center rounded-md border border-line bg-surface hover:bg-hover transition-transform hover:scale-110 shadow-xs" title="Custom color">
          <AppIcon fallback="ph:paint-brush" :size="12" class="text-ink-soft" />
          <input type="color" :value="selectionPrimaryColor" class="absolute inset-0 opacity-0 cursor-pointer w-full h-full" @input="setSelectionStickyColor(($event.target as HTMLInputElement).value)" />
        </label>
      </div>
    </template>

    <!-- 4. Selection Stroke & Style Popover (for strokes and 1D connectors) -->
    <template v-else-if="activePopover === 'selection-stroke'">
      <span class="text-[10px] font-bold uppercase tracking-wider text-ink-faint">Color</span>
      <div class="grid grid-cols-4 gap-1.5">
        <button
          v-for="(c, idx) in activePalette"
          :key="idx"
          class="relative flex h-6 w-full items-center justify-center rounded-md transition-transform hover:scale-110 ring-1 ring-black/10"
          :style="{ backgroundColor: c }"
          :class="(selectionPrimaryColor || '').toLowerCase() === c.toLowerCase() ? 'ring-2 ring-primary ring-offset-2 scale-105' : ''"
          @click.stop="handleSwatchClick(c, idx, selectionPrimaryColor, setSelectionColor, 'sel_stroke')"
        >
          <AppIcon
            v-if="(selectionPrimaryColor || '').toLowerCase() === c.toLowerCase()"
            fallback="ph:pencil-simple"
            :size="11"
            :class="isBrightColor(c) ? 'text-black/80' : 'text-white/90'"
          />
          <input
            type="color"
            :value="c"
            class="absolute inset-0 opacity-0 cursor-pointer"
            :class="(selectionPrimaryColor || '').toLowerCase() === c.toLowerCase() ? 'h-full w-full pointer-events-auto z-10' : 'h-0 w-0 pointer-events-none'"
            :ref="(el) => registerColorInput(`sel_stroke_${idx}`, el)"
            @input="handleSwatchInput($event, idx, setSelectionColor)"
            @change="handleSwatchInput($event, idx, setSelectionColor)"
          />
        </button>
        <label class="relative flex h-6 w-full cursor-pointer items-center justify-center rounded-md border border-line bg-surface hover:bg-hover transition-transform hover:scale-110 shadow-xs" title="Custom color">
          <AppIcon fallback="ph:paint-brush" :size="12" class="text-ink-soft" />
          <input type="color" :value="selectionPrimaryColor" class="absolute inset-0 opacity-0 cursor-pointer w-full h-full" @input="setSelectionColor(($event.target as HTMLInputElement).value)" />
        </label>
      </div>

      <span class="text-[10px] font-bold uppercase tracking-wider text-ink-faint mt-1">Weight</span>
      <div class="flex gap-1">
        <button
          v-for="w in [2, 4, 8, 16]"
          :key="w"
          class="flex h-7 flex-1 items-center justify-center rounded-lg border transition-all"
          :class="selectionStrokeWidth === w ? 'border-primary bg-primary/10 text-primary' : 'border-line hover:bg-hover text-ink-soft'"
          :title="`${w}px`"
          @click="setSelectionStrokeWidth(w)"
        >
          <div class="rounded-full bg-current" :style="{ width: '22px', height: `${Math.min(w, 8)}px` }" />
        </button>
      </div>

      <span class="text-[10px] font-bold uppercase tracking-wider text-ink-faint mt-1">Style</span>
      <div class="flex gap-1">
        <button class="flex h-7 flex-1 items-center justify-center rounded-lg border transition-all" :class="selectionStrokeStyle === 'solid' ? 'border-primary bg-primary/10 text-primary' : 'border-line hover:bg-hover text-ink-soft'" title="Solid" @click="setSelectionStrokeStyle('solid')">
          <div class="h-0.5 w-6 bg-current rounded" />
        </button>
        <button class="flex h-7 flex-1 items-center justify-center rounded-lg border transition-all" :class="selectionStrokeStyle === 'dashed' ? 'border-primary bg-primary/10 text-primary' : 'border-line hover:bg-hover text-ink-soft'" title="Dashed" @click="setSelectionStrokeStyle('dashed')">
          <div class="h-0.5 w-6 border-b-2 border-dashed border-current" />
        </button>
        <button class="flex h-7 flex-1 items-center justify-center rounded-lg border transition-all" :class="selectionStrokeStyle === 'dotted' ? 'border-primary bg-primary/10 text-primary' : 'border-line hover:bg-hover text-ink-soft'" title="Dotted" @click="setSelectionStrokeStyle('dotted')">
          <div class="h-0.5 w-6 border-b-2 border-dotted border-current" />
        </button>
      </div>

      <!-- If connectors selected: Curvature & Independent Terminations -->
      <template v-if="hasSelectedLines">
        <span class="text-[10px] font-bold uppercase tracking-wider text-ink-faint mt-1">Curvature</span>
        <div class="flex gap-1">
          <button class="flex h-7 flex-1 items-center justify-center rounded-lg border transition-all" :class="selectionCurvature === 'straight' ? 'border-primary bg-primary/10 text-primary' : 'border-line hover:bg-hover text-ink-soft'" title="Straight line" @click="setSelectionCurvature('straight')">
            <svg class="h-4 w-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
              <line x1="2.5" y1="13.5" x2="13.5" y2="2.5" />
            </svg>
          </button>
          <button class="flex h-7 flex-1 items-center justify-center rounded-lg border transition-all" :class="selectionCurvature === 'curved' ? 'border-primary bg-primary/10 text-primary' : 'border-line hover:bg-hover text-ink-soft'" title="Curved line" @click="setSelectionCurvature('curved')">
            <svg class="h-4 w-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
              <path d="M 2.5 13.5 Q 4 2.5 13.5 2.5" />
            </svg>
          </button>
          <button class="flex h-7 flex-1 items-center justify-center rounded-lg border transition-all" :class="selectionCurvature === 'orthogonal' ? 'border-primary bg-primary/10 text-primary' : 'border-line hover:bg-hover text-ink-soft'" title="Angled / Elbow line" @click="setSelectionCurvature('orthogonal')">
            <svg class="h-4 w-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <path d="M 2.5 13.5 H 8.5 V 2.5 H 13.5" />
            </svg>
          </button>
        </div>

        <!-- Start & End Orientation for Angled/Orthogonal Connector -->
        <template v-if="selectionCurvature === 'orthogonal'">
          <div class="mt-1 grid grid-cols-2 gap-2 rounded-lg border border-line/60 bg-hover/30 p-2">
            <div>
              <div class="flex items-center justify-between">
                <span class="text-[10px] font-bold uppercase tracking-wider text-ink-faint">Start Route</span>
                <span v-if="selectionStartAnchored" class="text-[9px] font-semibold text-primary" title="Locked to snapped object edge">Snapped</span>
              </div>
              <div class="flex gap-1 mt-1">
                <button
                  class="flex h-7 flex-1 items-center justify-center rounded-lg border transition-all"
                  :class="[
                    selectionStartOrientation === 'horizontal' ? 'border-primary bg-primary/10 text-primary' : 'border-line hover:bg-hover text-ink-soft',
                    selectionStartAnchored ? 'opacity-50 cursor-not-allowed' : ''
                  ]"
                  :disabled="selectionStartAnchored"
                  :title="selectionStartAnchored ? 'Locked to snapped object edge' : 'Horizontal Start (routes horizontally)'"
                  @click="setSelectionStartOrientation('horizontal')"
                >
                  <svg class="h-4 w-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M 2 8 H 14" />
                    <path d="M 10 4.5 L 13.5 8 L 10 11.5" stroke-width="1.6" />
                  </svg>
                </button>
                <button
                  class="flex h-7 flex-1 items-center justify-center rounded-lg border transition-all"
                  :class="[
                    selectionStartOrientation === 'vertical' ? 'border-primary bg-primary/10 text-primary' : 'border-line hover:bg-hover text-ink-soft',
                    selectionStartAnchored ? 'opacity-50 cursor-not-allowed' : ''
                  ]"
                  :disabled="selectionStartAnchored"
                  :title="selectionStartAnchored ? 'Locked to snapped object edge' : 'Vertical Start (routes vertically)'"
                  @click="setSelectionStartOrientation('vertical')"
                >
                  <svg class="h-4 w-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M 8 2 V 14" />
                    <path d="M 4.5 10 L 8 13.5 L 11.5 10" stroke-width="1.6" />
                  </svg>
                </button>
              </div>
            </div>
            <div>
              <div class="flex items-center justify-between">
                <span class="text-[10px] font-bold uppercase tracking-wider text-ink-faint">End Route</span>
                <span v-if="selectionEndAnchored" class="text-[9px] font-semibold text-primary" title="Locked to snapped object edge">Snapped</span>
              </div>
              <div class="flex gap-1 mt-1">
                <button
                  class="flex h-7 flex-1 items-center justify-center rounded-lg border transition-all"
                  :class="[
                    selectionEndOrientation === 'horizontal' ? 'border-primary bg-primary/10 text-primary' : 'border-line hover:bg-hover text-ink-soft',
                    selectionEndAnchored ? 'opacity-50 cursor-not-allowed' : ''
                  ]"
                  :disabled="selectionEndAnchored"
                  :title="selectionEndAnchored ? 'Locked to snapped object edge' : 'Horizontal End (enters horizontally)'"
                  @click="setSelectionEndOrientation('horizontal')"
                >
                  <svg class="h-4 w-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M 2 8 H 14" />
                    <path d="M 10 4.5 L 13.5 8 L 10 11.5" stroke-width="1.6" />
                  </svg>
                </button>
                <button
                  class="flex h-7 flex-1 items-center justify-center rounded-lg border transition-all"
                  :class="[
                    selectionEndOrientation === 'vertical' ? 'border-primary bg-primary/10 text-primary' : 'border-line hover:bg-hover text-ink-soft',
                    selectionEndAnchored ? 'opacity-50 cursor-not-allowed' : ''
                  ]"
                  :disabled="selectionEndAnchored"
                  :title="selectionEndAnchored ? 'Locked to snapped object edge' : 'Vertical End (enters vertically)'"
                  @click="setSelectionEndOrientation('vertical')"
                >
                  <svg class="h-4 w-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M 8 2 V 14" />
                    <path d="M 4.5 10 L 8 13.5 L 11.5 10" stroke-width="1.6" />
                  </svg>
                </button>
              </div>
            </div>
          </div>
        </template>

        <div class="grid grid-cols-2 gap-2 mt-1">
          <div>
            <span class="text-[10px] font-bold uppercase tracking-wider text-ink-faint">Start Point</span>
            <div class="flex gap-1 mt-1">
              <button class="flex h-7 flex-1 items-center justify-center rounded-lg border transition-all" :class="selectionStartTermination === 'none' ? 'border-primary bg-primary/10 text-primary font-medium' : 'border-line hover:bg-hover text-ink-soft'" title="None" @click="setSelectionStartTermination('none')">
                <div class="h-0.5 w-3 bg-current" />
              </button>
              <button class="flex h-7 flex-1 items-center justify-center rounded-lg border transition-all" :class="selectionStartTermination === 'arrow' ? 'border-primary bg-primary/10 text-primary font-medium' : 'border-line hover:bg-hover text-ink-soft'" title="Arrow" @click="setSelectionStartTermination('arrow')">
                <AppIcon fallback="ph:arrow-left" :size="13" />
              </button>
              <button class="flex h-7 flex-1 items-center justify-center rounded-lg border transition-all" :class="selectionStartTermination === 'dot' ? 'border-primary bg-primary/10 text-primary font-medium' : 'border-line hover:bg-hover text-ink-soft'" title="Dot" @click="setSelectionStartTermination('dot')">
                <div class="h-2 w-2 rounded-full bg-current" />
              </button>
            </div>
          </div>

          <div>
            <span class="text-[10px] font-bold uppercase tracking-wider text-ink-faint">End Point</span>
            <div class="flex gap-1 mt-1">
              <button class="flex h-7 flex-1 items-center justify-center rounded-lg border transition-all" :class="selectionEndTermination === 'none' ? 'border-primary bg-primary/10 text-primary font-medium' : 'border-line hover:bg-hover text-ink-soft'" title="None" @click="setSelectionEndTermination('none')">
                <div class="h-0.5 w-3 bg-current" />
              </button>
              <button class="flex h-7 flex-1 items-center justify-center rounded-lg border transition-all" :class="selectionEndTermination === 'arrow' ? 'border-primary bg-primary/10 text-primary font-medium' : 'border-line hover:bg-hover text-ink-soft'" title="Arrow" @click="setSelectionEndTermination('arrow')">
                <AppIcon fallback="ph:arrow-right" :size="13" />
              </button>
              <button class="flex h-7 flex-1 items-center justify-center rounded-lg border transition-all" :class="selectionEndTermination === 'dot' ? 'border-primary bg-primary/10 text-primary font-medium' : 'border-line hover:bg-hover text-ink-soft'" title="Dot" @click="setSelectionEndTermination('dot')">
                <div class="h-2 w-2 rounded-full bg-current" />
              </button>
            </div>
          </div>
        </div>
      </template>
    </template>

    <!-- 5. Selection Sticky Text Size & Text Color Popover -->
    <template v-else-if="activePopover === 'selection-text'">
      <span class="text-[10px] font-bold uppercase tracking-wider text-ink-faint">Font Size</span>
      <div class="flex gap-1">
        <button
          v-for="sz in (['sm', 'md', 'lg', 'xl'] as StickyFontSize[])"
          :key="sz"
          class="flex h-7 flex-1 items-center justify-center rounded-lg border text-xs font-semibold uppercase transition-all"
          :class="currentStickyFontSize === sz ? 'border-primary bg-primary/10 text-primary' : 'border-line hover:bg-hover text-ink-soft'"
          @click="setSelectionStickyFontSize(sz)"
        >
          {{ sz }}
        </button>
      </div>

      <span class="text-[10px] font-bold uppercase tracking-wider text-ink-faint mt-1">Text Color</span>
      <div class="grid grid-cols-4 gap-1.5">
        <button
          v-for="(c, idx) in activePalette"
          :key="idx"
          class="relative flex h-6 w-full items-center justify-center rounded-md transition-transform hover:scale-110 ring-1 ring-black/10"
          :style="{ backgroundColor: c }"
          :class="(selectionStickyTextColor || '').toLowerCase() === c.toLowerCase() ? 'ring-2 ring-primary ring-offset-2 scale-105' : ''"
          @click.stop="handleSwatchClick(c, idx, selectionStickyTextColor, setSelectionStickyTextColor, 'sel_sticky_text')"
        >
          <AppIcon
            v-if="(selectionStickyTextColor || '').toLowerCase() === c.toLowerCase()"
            fallback="ph:pencil-simple"
            :size="11"
            :class="isBrightColor(c) ? 'text-black/80' : 'text-white/90'"
          />
          <input
            type="color"
            :value="c"
            class="absolute inset-0 opacity-0 cursor-pointer"
            :class="(selectionStickyTextColor || '').toLowerCase() === c.toLowerCase() ? 'h-full w-full pointer-events-auto z-10' : 'h-0 w-0 pointer-events-none'"
            :ref="(el) => registerColorInput(`sel_sticky_text_${idx}`, el)"
            @input="handleSwatchInput($event, idx, setSelectionStickyTextColor)"
            @change="handleSwatchInput($event, idx, setSelectionStickyTextColor)"
          />
        </button>
        <label class="relative flex h-6 w-full cursor-pointer items-center justify-center rounded-md border border-line bg-surface hover:bg-hover transition-transform hover:scale-110 shadow-xs" title="Custom text color">
          <AppIcon fallback="ph:paint-brush" :size="12" class="text-ink-soft" />
          <input type="color" :value="selectionStickyTextColor" class="absolute inset-0 opacity-0 cursor-pointer w-full h-full" @input="setSelectionStickyTextColor(($event.target as HTMLInputElement).value)" />
        </label>
      </div>
    </template>

    <!-- 6. Selection Z-Order Popover (Left: Front/Back, Right: Forward/Backward) -->
    <template v-else-if="activePopover === 'selection-zorder'">
      <span class="text-[10px] font-bold uppercase tracking-wider text-ink-faint">Layer Order</span>
      <div class="grid grid-cols-2 gap-1">
        <button class="flex items-center gap-1.5 px-2 py-1.5 rounded-lg border border-line hover:bg-hover text-ink text-left" @click="bringToFront(); closeAllPopovers()">
          <AppIcon fallback="ph:arrow-fat-line-up" :size="14" /> Front
        </button>
        <button class="flex items-center gap-1.5 px-2 py-1.5 rounded-lg border border-line hover:bg-hover text-ink text-left" @click="bringForward(); closeAllPopovers()">
          <AppIcon fallback="ph:arrow-fat-up" :size="14" /> Forward
        </button>
        <button class="flex items-center gap-1.5 px-2 py-1.5 rounded-lg border border-line hover:bg-hover text-ink text-left" @click="sendToBack(); closeAllPopovers()">
          <AppIcon fallback="ph:arrow-fat-line-down" :size="14" /> Back
        </button>
        <button class="flex items-center gap-1.5 px-2 py-1.5 rounded-lg border border-line hover:bg-hover text-ink text-left" @click="sendBackward(); closeAllPopovers()">
          <AppIcon fallback="ph:arrow-fat-down" :size="14" /> Backward
        </button>
      </div>
    </template>

    <!-- 7. Selection Card Fields Popover -->
    <template v-else-if="activePopover === 'selection-card-fields' && selectedCard">
      <template v-if="!selectedCardIsQuery">
        <span class="text-[10px] font-bold uppercase tracking-wider text-ink-faint">Page Content</span>
        <div class="grid grid-cols-3 gap-1">
          <button
            class="flex items-center justify-center rounded-lg border px-2 py-1 text-[11px] font-medium transition-all"
            :class="selectedCardContentMode === 'none' ? 'border-primary bg-primary/10 text-primary' : 'border-line hover:bg-hover text-ink-soft'"
            @click="setCardContentMode('none')"
          >
            Hidden
          </button>
          <button
            class="flex items-center justify-center rounded-lg border px-2 py-1 text-[11px] font-medium transition-all"
            :class="selectedCardContentMode === 'preview' ? 'border-primary bg-primary/10 text-primary' : 'border-line hover:bg-hover text-ink-soft'"
            @click="setCardContentMode('preview')"
          >
            Snippet
          </button>
          <button
            class="flex items-center justify-center rounded-lg border px-2 py-1 text-[11px] font-medium transition-all"
            :class="selectedCardContentMode === 'full' ? 'border-primary bg-primary/10 text-primary' : 'border-line hover:bg-hover text-ink-soft'"
            @click="setCardContentMode('full')"
          >
            Full Page
          </button>
        </div>
      </template>
      <template v-else>
        <span class="text-[10px] font-bold uppercase tracking-wider text-ink-faint">Query Card</span>
        <p class="text-[11px] text-ink-soft leading-snug">
          Displays the live list of objects matching this query. Resize the card to show more items.
        </p>
      </template>
      <template v-if="selectedCardAvailableProperties.length">
        <div class="h-px bg-line my-1" />
        <span class="text-[10px] font-bold uppercase tracking-wider text-ink-faint">Visible Properties</span>
        <div class="max-h-48 overflow-y-auto flex flex-col gap-1 pr-1">
          <label
            v-for="prop in selectedCardAvailableProperties"
            :key="prop.id"
            class="flex items-center gap-2 px-1 py-1 rounded hover:bg-hover cursor-pointer text-xs text-ink"
          >
            <input
              type="checkbox"
              :checked="isCardPropertyShown(prop.id)"
              class="rounded border-line text-primary focus:ring-primary"
              @change="toggleCardProperty(prop.id)"
            />
            <AppIcon :fallback="kindIcon(prop.kind)" :size="14" class="text-ink-soft shrink-0" />
            <span class="truncate">{{ prop.name }}</span>
          </label>
        </div>
      </template>
    </template>
  </div>
</template>
