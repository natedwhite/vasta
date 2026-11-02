<script setup lang="ts">
import { inject } from 'vue'
import AppIcon from '../AppIcon.vue'
import ObjectPicker from '../ObjectPicker.vue'
import { WHITEBOARD_CTX } from './context.ts'
import { STICKY_COLORS, stickyStyle } from './shapes.ts'
import type { LineCurvature, Shape2DType, StickyFontSize } from './types.ts'

const {
  isSceneDrawing,
  activePopover,
  penPresets,
  activePresetIndex,
  closeAllPopovers,
  setPresetType,
  currentWidth,
  setPresetWidth,
  activePalette,
  currentColor,
  handleSwatchClick,
  isBrightColor,
  registerColorInput,
  handleSwatchInput,
  setPresetColor,
  eraserSize,
  shapeFillTab,
  shape2DSettings,
  currentShape2D,
  setShapeStrokeWidth,
  setShapeColor,
  setShapeFill,
  setShapeFillColor,
  connectorSettings,
  saveConnectorSettings,
  currentStickyFontSize,
  setSelectionStickyFontSize,
  currentStickyColor,
  handleStickySwatchClick,
  onStickyColorClick,
  currentStickyTextColor,
  setSelectionStickyTextColor,
  secondaryOpen,
  hasSecondary,
  currentTool,
  selectMode,
  onPresetClick,
  togglePopover,
  eraserMode,
  activeShapeItem,
  onShapeClick,
  onConnectorCurvatureClick,
  getShapeFillPreview,
  getConnectorIconPaths,
  canUndo,
  undo,
  canRedo,
  redo,
  mainTools,
  toolBtn,
  onSelectMainTool,
  dockPenIcon,
  dockEraserIcon,
  objectPickerOpen,
  onPickObject,
  zoom,
  zoomIn,
  zoomOut,
  resetView,
} = inject(WHITEBOARD_CTX)!
</script>

<template>
  <!-- ================================================================= -->
  <!-- UNIFIED BOTTOM DOCK (Moved closer to bottom, maximum screen space)-->
  <!-- ================================================================= -->
  <div v-if="!isSceneDrawing" class="absolute bottom-2.5 left-1/2 z-45 flex max-w-[98vw] -translate-x-1/2 flex-col items-center gap-1 max-sm:bottom-1.5" data-wb-ui>
    <!-- SECONDARY TOOLBAR POPOVER (Floating modal card above secondary bar) -->
    <div
      v-if="activePopover && !activePopover.startsWith('selection-')"
      class="mb-1.5 flex flex-col gap-2 rounded-2xl border border-line bg-surface p-3 shadow-2xl backdrop-blur-xl ring-1 ring-black/5 text-xs select-none w-72 sm:w-80 max-h-[calc(100vh-140px)] overflow-y-auto overscroll-contain"
      @pointerdown.stop
    >
      <!-- Pen Preset Settings Popover -->
      <template v-if="activePopover === 'pen-preset'">
        <div class="flex items-center justify-between pb-0.5">
          <span class="text-[10px] font-bold uppercase tracking-wider text-ink-faint">{{ penPresets[activePresetIndex]?.name || 'Pen Settings' }}</span>
          <button class="text-ink-faint hover:text-ink" @click="closeAllPopovers"><AppIcon fallback="ph:x" :size="13" /></button>
        </div>

        <!-- Pen Type: Pen, Pencil, Highlighter -->
        <span class="text-[10px] font-bold uppercase tracking-wider text-ink-faint">Type</span>
        <div class="grid grid-cols-3 gap-1">
          <button
            class="flex items-center justify-center gap-1.5 py-1.5 rounded-lg border text-xs transition-all"
            :class="penPresets[activePresetIndex]?.type === 'pen' ? 'border-primary bg-primary/10 text-primary font-medium' : 'border-line hover:bg-hover text-ink-soft'"
            @click="setPresetType('pen')"
          >
            <AppIcon fallback="ph:pen-nib" :size="14" />
            <span>Pen</span>
          </button>
          <button
            class="flex items-center justify-center gap-1.5 py-1.5 rounded-lg border text-xs transition-all"
            :class="penPresets[activePresetIndex]?.type === 'pencil' ? 'border-primary bg-primary/10 text-primary font-medium' : 'border-line hover:bg-hover text-ink-soft'"
            @click="setPresetType('pencil')"
          >
            <AppIcon fallback="ph:pencil-simple" :size="14" />
            <span>Pencil</span>
          </button>
          <button
            class="flex items-center justify-center gap-1.5 py-1.5 rounded-lg border text-xs transition-all"
            :class="penPresets[activePresetIndex]?.type === 'highlighter' ? 'border-primary bg-primary/10 text-primary font-medium' : 'border-line hover:bg-hover text-ink-soft'"
            @click="setPresetType('highlighter')"
          >
            <AppIcon fallback="ph:highlighter" :size="14" />
            <span>Marker</span>
          </button>
        </div>

        <!-- Weight -->
        <span class="text-[10px] font-bold uppercase tracking-wider text-ink-faint mt-1">Weight</span>
        <div class="flex gap-1">
          <button
            v-for="w in (penPresets[activePresetIndex]?.type === 'highlighter' ? [12, 18, 24, 32] : [1, 2, 4, 8])"
            :key="w"
            class="flex h-7 flex-1 items-center justify-center rounded-lg border transition-all"
            :class="currentWidth === w ? 'border-primary bg-primary/10 text-primary' : 'border-line hover:bg-hover text-ink-soft'"
            :title="`${w}px`"
            @click="setPresetWidth(w)"
          >
            <div
              class="rounded-full bg-current"
              :style="{
                width: '22px',
                height: penPresets[activePresetIndex]?.type === 'highlighter' ? `${Math.min(w / 3, 10)}px` : `${Math.min(w, 8)}px`
              }"
            />
          </button>
        </div>

        <!-- Color Grid -->
        <span class="text-[10px] font-bold uppercase tracking-wider text-ink-faint mt-1">Color</span>
        <div class="grid grid-cols-4 gap-1.5">
          <button
            v-for="(c, idx) in activePalette"
            :key="idx"
            class="relative flex h-6 w-full items-center justify-center rounded-md transition-transform hover:scale-110 ring-1 ring-black/10"
            :style="{ backgroundColor: c }"
            :class="(currentColor || '').toLowerCase() === c.toLowerCase() ? 'ring-2 ring-primary ring-offset-2 scale-105' : 'opacity-85 hover:opacity-100'"
            @click="handleSwatchClick(c, idx, currentColor, setPresetColor, 'pen_preset')"
          >
            <AppIcon
              v-if="(currentColor || '').toLowerCase() === c.toLowerCase()"
              fallback="ph:pencil-simple"
              :size="11"
              :class="isBrightColor(c) ? 'text-black/80' : 'text-white/90'"
            />
            <input
              type="color"
              :value="c"
              class="absolute inset-0 opacity-0 cursor-pointer"
              :class="(currentColor || '').toLowerCase() === c.toLowerCase() ? 'h-full w-full pointer-events-auto z-10' : 'h-0 w-0 pointer-events-none'"
              :ref="(el) => registerColorInput(`pen_preset_${idx}`, el)"
              @input="handleSwatchInput($event, idx, setPresetColor)"
              @change="handleSwatchInput($event, idx, setPresetColor)"
            />
          </button>
          <label class="relative flex h-6 w-full cursor-pointer items-center justify-center rounded-md border border-line bg-surface hover:bg-hover transition-transform hover:scale-110 shadow-xs" title="Custom color">
            <AppIcon fallback="ph:paint-brush" :size="12" class="text-ink-soft" />
            <input type="color" :value="currentColor" class="absolute inset-0 opacity-0 cursor-pointer w-full h-full" @input="setPresetColor(($event.target as HTMLInputElement).value)" />
          </label>
        </div>
      </template>

      <!-- Eraser Popover -->
      <template v-else-if="activePopover === 'eraser'">
        <div class="flex items-center justify-between pb-0.5">
          <span class="text-[10px] font-bold uppercase tracking-wider text-ink-faint">Pixel Eraser Size</span>
          <button class="text-ink-faint hover:text-ink" @click="closeAllPopovers"><AppIcon fallback="ph:x" :size="13" /></button>
        </div>
        <div class="flex items-center gap-1.5 pt-1">
          <button
            v-for="sz in [8, 16, 32, 54]"
            :key="sz"
            class="flex h-9 flex-1 items-center justify-center rounded-lg border transition-all"
            :class="eraserSize === sz ? 'border-primary bg-primary/10 text-primary' : 'border-line hover:bg-hover text-ink-soft'"
            :title="`${sz}px`"
            @click="eraserSize = sz"
          >
            <div class="rounded-full bg-current" :style="{ width: `${Math.min(sz / 3, 16)}px`, height: `${Math.min(sz / 3, 16)}px` }" />
          </button>
        </div>
      </template>

      <!-- 2D Shape Popover -->
      <template v-else-if="activePopover === 'shape'">
        <div class="flex items-center justify-between pb-0.5">
          <span class="text-[10px] font-bold uppercase tracking-wider text-ink-faint">Shape Style</span>
          <button class="text-ink-faint hover:text-ink" @click="closeAllPopovers"><AppIcon fallback="ph:x" :size="13" /></button>
        </div>

        <!-- Segmented Tab: Outline vs Fill -->
        <div class="flex rounded-lg bg-hover/80 p-0.5">
          <button
            class="flex-1 rounded-md py-1 text-center font-medium transition-all"
            :class="shapeFillTab === 'outline' ? 'bg-surface text-ink shadow-xs' : 'text-ink-soft hover:text-ink'"
            @click.stop="shapeFillTab = 'outline'"
          >
            Outline
          </button>
          <button
            class="flex-1 rounded-md py-1 text-center font-medium transition-all"
            :class="shapeFillTab === 'fill' ? 'bg-surface text-ink shadow-xs' : 'text-ink-soft hover:text-ink'"
            @click.stop="shapeFillTab = 'fill'"
          >
            Fill
          </button>
        </div>

        <!-- Outline Tab Content -->
        <template v-if="shapeFillTab === 'outline'">
          <span class="text-[10px] font-bold uppercase tracking-wider text-ink-faint">Outline Weight</span>
          <div class="flex gap-1">
            <button
              v-for="w in [2, 3, 5, 8]"
              :key="w"
              class="flex h-7 flex-1 items-center justify-center rounded-lg border transition-all"
              :class="shape2DSettings[currentShape2D].strokeWidth === w ? 'border-primary bg-primary/10 text-primary' : 'border-line hover:bg-hover text-ink-soft'"
              :title="`${w}px`"
              @click="setShapeStrokeWidth(w)"
            >
              <div class="rounded-full bg-current" :style="{ width: '22px', height: `${Math.min(w, 8)}px` }" />
            </button>
          </div>

          <span class="text-[10px] font-bold uppercase tracking-wider text-ink-faint mt-1">Outline Color</span>
          <div class="grid grid-cols-4 gap-1.5">
            <button
              v-for="(c, idx) in activePalette"
              :key="idx"
              class="relative flex h-6 w-full items-center justify-center rounded-md transition-transform hover:scale-110 ring-1 ring-black/10"
              :style="{ backgroundColor: c }"
              :class="(shape2DSettings[currentShape2D].color || '').toLowerCase() === c.toLowerCase() ? 'ring-2 ring-primary ring-offset-2 scale-105' : 'opacity-85 hover:opacity-100'"
              @click="handleSwatchClick(c, idx, shape2DSettings[currentShape2D].color, setShapeColor, 'shape_outline')"
            >
              <AppIcon
                v-if="(shape2DSettings[currentShape2D].color || '').toLowerCase() === c.toLowerCase()"
                fallback="ph:pencil-simple"
                :size="11"
                :class="isBrightColor(c) ? 'text-black/80' : 'text-white/90'"
              />
              <input
                type="color"
                :value="c"
                class="absolute inset-0 opacity-0 cursor-pointer"
                :class="(shape2DSettings[currentShape2D].color || '').toLowerCase() === c.toLowerCase() ? 'h-full w-full pointer-events-auto z-10' : 'h-0 w-0 pointer-events-none'"
                :ref="(el) => registerColorInput(`shape_outline_${idx}`, el)"
                @input="handleSwatchInput($event, idx, setShapeColor)"
                @change="handleSwatchInput($event, idx, setShapeColor)"
              />
            </button>
            <label class="relative flex h-6 w-full cursor-pointer items-center justify-center rounded-md border border-line bg-surface hover:bg-hover transition-transform hover:scale-110 shadow-xs" title="Custom color">
              <AppIcon fallback="ph:paint-brush" :size="12" class="text-ink-soft" />
              <input type="color" :value="shape2DSettings[currentShape2D].color" class="absolute inset-0 opacity-0 cursor-pointer w-full h-full" @input="setShapeColor(($event.target as HTMLInputElement).value)" />
            </label>
          </div>
        </template>

        <!-- Fill Tab Content -->
        <template v-else>
          <span class="text-[10px] font-bold uppercase tracking-wider text-ink-faint">Fill Style</span>
          <div class="grid grid-cols-2 gap-1.5">
            <button
              class="flex items-center gap-1.5 px-2 py-1.5 rounded-lg border text-xs transition-all"
              :class="shape2DSettings[currentShape2D].fill === 'none' ? 'border-primary bg-primary/10 text-primary font-medium' : 'border-line hover:bg-hover text-ink-soft'"
              @click="setShapeFill('none')"
            >
              <AppIcon fallback="ph:prohibit" :size="14" />
              <span>No Fill</span>
            </button>
            <button
              class="flex items-center gap-1.5 px-2 py-1.5 rounded-lg border text-xs transition-all"
              :class="shape2DSettings[currentShape2D].fill === 'tint' ? 'border-primary bg-primary/10 text-primary font-medium' : 'border-line hover:bg-hover text-ink-soft'"
              @click="setShapeFill('tint')"
            >
              <AppIcon fallback="ph:circle-half" :size="14" />
              <span>Tint (15%)</span>
            </button>
            <button
              class="flex items-center gap-1.5 px-2 py-1.5 rounded-lg border text-xs transition-all"
              :class="shape2DSettings[currentShape2D].fill === 'white' ? 'border-primary bg-primary/10 text-primary font-medium' : 'border-line hover:bg-hover text-ink-soft'"
              @click="setShapeFill('white')"
            >
              <span class="h-3.5 w-3.5 rounded-xs border border-ink/40 bg-white shadow-2xs" />
              <span>White</span>
            </button>
            <button
              class="flex items-center gap-1.5 px-2 py-1.5 rounded-lg border text-xs transition-all"
              :class="shape2DSettings[currentShape2D].fill === 'solid' ? 'border-primary bg-primary/10 text-primary font-medium' : 'border-line hover:bg-hover text-ink-soft'"
              @click="setShapeFill('solid')"
            >
              <span class="h-3.5 w-3.5 rounded-xs bg-current" />
              <span>Solid Fill</span>
            </button>
          </div>

          <template v-if="shape2DSettings[currentShape2D].fill === 'tint' || shape2DSettings[currentShape2D].fill === 'solid'">
            <span class="text-[10px] font-bold uppercase tracking-wider text-ink-faint mt-1">Fill Color</span>
            <div class="grid grid-cols-4 gap-1.5">
              <button
                v-for="(c, idx) in activePalette"
                :key="idx"
                class="relative flex h-6 w-full items-center justify-center rounded-md transition-transform hover:scale-110 ring-1 ring-black/10"
                :style="{ backgroundColor: c }"
                :class="((shape2DSettings[currentShape2D].fillColor || shape2DSettings[currentShape2D].color) || '').toLowerCase() === c.toLowerCase() ? 'ring-2 ring-primary ring-offset-2 scale-105' : 'opacity-85 hover:opacity-100'"
                @click="handleSwatchClick(c, idx, shape2DSettings[currentShape2D].fillColor || shape2DSettings[currentShape2D].color, setShapeFillColor, 'shape_fill')"
              >
                <AppIcon
                  v-if="((shape2DSettings[currentShape2D].fillColor || shape2DSettings[currentShape2D].color) || '').toLowerCase() === c.toLowerCase()"
                  fallback="ph:pencil-simple"
                  :size="11"
                  :class="isBrightColor(c) ? 'text-black/80' : 'text-white/90'"
                />
                <input
                  type="color"
                  :value="c"
                  class="absolute inset-0 opacity-0 cursor-pointer"
                  :class="((shape2DSettings[currentShape2D].fillColor || shape2DSettings[currentShape2D].color) || '').toLowerCase() === c.toLowerCase() ? 'h-full w-full pointer-events-auto z-10' : 'h-0 w-0 pointer-events-none'"
                  :ref="(el) => registerColorInput(`shape_fill_${idx}`, el)"
                  @input="handleSwatchInput($event, idx, setShapeFillColor)"
                  @change="handleSwatchInput($event, idx, setShapeFillColor)"
                />
              </button>
              <label class="relative flex h-6 w-full cursor-pointer items-center justify-center rounded-md border border-line bg-surface hover:bg-hover transition-transform hover:scale-110 shadow-xs" title="Custom color">
                <AppIcon fallback="ph:paint-brush" :size="12" class="text-ink-soft" />
                <input type="color" :value="shape2DSettings[currentShape2D].fillColor || shape2DSettings[currentShape2D].color" class="absolute inset-0 opacity-0 cursor-pointer w-full h-full" @input="setShapeFillColor(($event.target as HTMLInputElement).value)" />
              </label>
            </div>
          </template>
        </template>
      </template>

      <!-- Unified Connector Popover -->
      <template v-else-if="activePopover === 'connector'">
        <div class="flex items-center justify-between pb-0.5">
          <span class="text-[10px] font-bold uppercase tracking-wider text-ink-faint">Connector Settings</span>
          <button class="text-ink-faint hover:text-ink" @click="closeAllPopovers"><AppIcon fallback="ph:x" :size="13" /></button>
        </div>

        <span class="text-[10px] font-bold uppercase tracking-wider text-ink-faint">Curvature</span>
        <div class="flex gap-1">
          <button class="flex h-7 flex-1 items-center justify-center rounded-lg border transition-all" :class="connectorSettings.curvature === 'straight' ? 'border-primary bg-primary/10 text-primary' : 'border-line hover:bg-hover text-ink-soft'" title="Straight line" @click="connectorSettings.curvature = 'straight'; saveConnectorSettings()">
            <svg class="h-4 w-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
              <line x1="2.5" y1="13.5" x2="13.5" y2="2.5" />
            </svg>
          </button>
          <button class="flex h-7 flex-1 items-center justify-center rounded-lg border transition-all" :class="connectorSettings.curvature === 'curved' ? 'border-primary bg-primary/10 text-primary' : 'border-line hover:bg-hover text-ink-soft'" title="Curved line" @click="connectorSettings.curvature = 'curved'; saveConnectorSettings()">
            <svg class="h-4 w-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
              <path d="M 2.5 13.5 Q 4 2.5 13.5 2.5" />
            </svg>
          </button>
          <button class="flex h-7 flex-1 items-center justify-center rounded-lg border transition-all" :class="connectorSettings.curvature === 'orthogonal' ? 'border-primary bg-primary/10 text-primary' : 'border-line hover:bg-hover text-ink-soft'" title="Angled / Elbow line" @click="connectorSettings.curvature = 'orthogonal'; saveConnectorSettings()">
            <svg class="h-4 w-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <path d="M 2.5 13.5 H 8.5 V 2.5 H 13.5" />
            </svg>
          </button>
        </div>

        <!-- Start & End Orientation for Angled/Orthogonal Connector -->
        <template v-if="connectorSettings.curvature === 'orthogonal'">
          <div class="mt-1 grid grid-cols-2 gap-2 rounded-lg border border-line/60 bg-hover/30 p-2">
            <div>
              <span class="text-[10px] font-bold uppercase tracking-wider text-ink-faint">Start Route</span>
              <div class="flex gap-1 mt-1">
                <button
                  class="flex h-7 flex-1 items-center justify-center rounded-lg border transition-all"
                  :class="(connectorSettings.startOrientation || 'horizontal') === 'horizontal' ? 'border-primary bg-primary/10 text-primary' : 'border-line hover:bg-hover text-ink-soft'"
                  title="Horizontal Start (routes horizontally)"
                  @click="connectorSettings.startOrientation = 'horizontal'; saveConnectorSettings()"
                >
                  <svg class="h-4 w-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M 2 8 H 14" />
                    <path d="M 10 4.5 L 13.5 8 L 10 11.5" stroke-width="1.6" />
                  </svg>
                </button>
                <button
                  class="flex h-7 flex-1 items-center justify-center rounded-lg border transition-all"
                  :class="connectorSettings.startOrientation === 'vertical' ? 'border-primary bg-primary/10 text-primary' : 'border-line hover:bg-hover text-ink-soft'"
                  title="Vertical Start (routes vertically)"
                  @click="connectorSettings.startOrientation = 'vertical'; saveConnectorSettings()"
                >
                  <svg class="h-4 w-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M 8 2 V 14" />
                    <path d="M 4.5 10 L 8 13.5 L 11.5 10" stroke-width="1.6" />
                  </svg>
                </button>
              </div>
            </div>
            <div>
              <span class="text-[10px] font-bold uppercase tracking-wider text-ink-faint">End Route</span>
              <div class="flex gap-1 mt-1">
                <button
                  class="flex h-7 flex-1 items-center justify-center rounded-lg border transition-all"
                  :class="(connectorSettings.endOrientation || 'horizontal') === 'horizontal' ? 'border-primary bg-primary/10 text-primary' : 'border-line hover:bg-hover text-ink-soft'"
                  title="Horizontal End (enters horizontally)"
                  @click="connectorSettings.endOrientation = 'horizontal'; saveConnectorSettings()"
                >
                  <svg class="h-4 w-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M 2 8 H 14" />
                    <path d="M 10 4.5 L 13.5 8 L 10 11.5" stroke-width="1.6" />
                  </svg>
                </button>
                <button
                  class="flex h-7 flex-1 items-center justify-center rounded-lg border transition-all"
                  :class="connectorSettings.endOrientation === 'vertical' ? 'border-primary bg-primary/10 text-primary' : 'border-line hover:bg-hover text-ink-soft'"
                  title="Vertical End (enters vertically)"
                  @click="connectorSettings.endOrientation = 'vertical'; saveConnectorSettings()"
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
              <button class="flex h-7 flex-1 items-center justify-center rounded-lg border transition-all" :class="connectorSettings.startHead === 'none' ? 'border-primary bg-primary/10 text-primary font-medium' : 'border-line hover:bg-hover text-ink-soft'" title="None" @click="connectorSettings.startHead = 'none'; saveConnectorSettings()">
                <div class="h-0.5 w-3 bg-current" />
              </button>
              <button class="flex h-7 flex-1 items-center justify-center rounded-lg border transition-all" :class="connectorSettings.startHead === 'arrow' ? 'border-primary bg-primary/10 text-primary font-medium' : 'border-line hover:bg-hover text-ink-soft'" title="Arrow" @click="connectorSettings.startHead = 'arrow'; saveConnectorSettings()">
                <AppIcon fallback="ph:arrow-left" :size="13" />
              </button>
              <button class="flex h-7 flex-1 items-center justify-center rounded-lg border transition-all" :class="connectorSettings.startHead === 'dot' ? 'border-primary bg-primary/10 text-primary font-medium' : 'border-line hover:bg-hover text-ink-soft'" title="Dot" @click="connectorSettings.startHead = 'dot'; saveConnectorSettings()">
                <div class="h-2 w-2 rounded-full bg-current" />
              </button>
            </div>
          </div>

          <div>
            <span class="text-[10px] font-bold uppercase tracking-wider text-ink-faint">End Point</span>
            <div class="flex gap-1 mt-1">
              <button class="flex h-7 flex-1 items-center justify-center rounded-lg border transition-all" :class="connectorSettings.endHead === 'none' ? 'border-primary bg-primary/10 text-primary font-medium' : 'border-line hover:bg-hover text-ink-soft'" title="None" @click="connectorSettings.endHead = 'none'; saveConnectorSettings()">
                <div class="h-0.5 w-3 bg-current" />
              </button>
              <button class="flex h-7 flex-1 items-center justify-center rounded-lg border transition-all" :class="connectorSettings.endHead === 'arrow' ? 'border-primary bg-primary/10 text-primary font-medium' : 'border-line hover:bg-hover text-ink-soft'" title="Arrow" @click="connectorSettings.endHead = 'arrow'; saveConnectorSettings()">
                <AppIcon fallback="ph:arrow-right" :size="13" />
              </button>
              <button class="flex h-7 flex-1 items-center justify-center rounded-lg border transition-all" :class="connectorSettings.endHead === 'dot' ? 'border-primary bg-primary/10 text-primary font-medium' : 'border-line hover:bg-hover text-ink-soft'" title="Dot" @click="connectorSettings.endHead = 'dot'; saveConnectorSettings()">
                <div class="h-2 w-2 rounded-full bg-current" />
              </button>
            </div>
          </div>
        </div>

        <span class="text-[10px] font-bold uppercase tracking-wider text-ink-faint mt-1">Weight</span>
        <div class="flex gap-1">
          <button
            v-for="w in [2, 3, 5, 8]"
            :key="w"
            class="flex h-7 flex-1 items-center justify-center rounded-lg border transition-all"
            :class="connectorSettings.strokeWidth === w ? 'border-primary bg-primary/10 text-primary' : 'border-line hover:bg-hover text-ink-soft'"
            :title="`${w}px`"
            @click="connectorSettings.strokeWidth = w; saveConnectorSettings()"
          >
            <div class="rounded-full bg-current" :style="{ width: '22px', height: `${Math.min(w, 8)}px` }" />
          </button>
        </div>

        <span class="text-[10px] font-bold uppercase tracking-wider text-ink-faint mt-1">Style</span>
        <div class="flex gap-1">
          <button class="flex h-7 flex-1 items-center justify-center rounded-lg border transition-all" :class="connectorSettings.strokeStyle === 'solid' ? 'border-primary bg-primary/10 text-primary' : 'border-line hover:bg-hover text-ink-soft'" title="Solid" @click="connectorSettings.strokeStyle = 'solid'; saveConnectorSettings()">
            <div class="h-0.5 w-6 bg-current rounded" />
          </button>
          <button class="flex h-7 flex-1 items-center justify-center rounded-lg border transition-all" :class="connectorSettings.strokeStyle === 'dashed' ? 'border-primary bg-primary/10 text-primary' : 'border-line hover:bg-hover text-ink-soft'" title="Dashed" @click="connectorSettings.strokeStyle = 'dashed'; saveConnectorSettings()">
            <div class="h-0.5 w-6 border-b-2 border-dashed border-current" />
          </button>
          <button class="flex h-7 flex-1 items-center justify-center rounded-lg border transition-all" :class="connectorSettings.strokeStyle === 'dotted' ? 'border-primary bg-primary/10 text-primary' : 'border-line hover:bg-hover text-ink-soft'" title="Dotted" @click="connectorSettings.strokeStyle = 'dotted'; saveConnectorSettings()">
            <div class="h-0.5 w-6 border-b-2 border-dotted border-current" />
          </button>
        </div>

        <span class="text-[10px] font-bold uppercase tracking-wider text-ink-faint mt-1">Color</span>
        <div class="grid grid-cols-4 gap-1.5">
          <button
            v-for="(c, idx) in activePalette"
            :key="idx"
            class="relative flex h-6 w-full items-center justify-center rounded-md transition-transform hover:scale-110 ring-1 ring-black/10"
            :style="{ backgroundColor: c }"
            :class="(connectorSettings.color || '').toLowerCase() === c.toLowerCase() ? 'ring-2 ring-primary ring-offset-2 scale-105' : 'opacity-85 hover:opacity-100'"
            @click="handleSwatchClick(c, idx, connectorSettings.color, (val) => { connectorSettings.color = val; saveConnectorSettings() }, 'conn_color')"
          >
            <AppIcon
              v-if="(connectorSettings.color || '').toLowerCase() === c.toLowerCase()"
              fallback="ph:pencil-simple"
              :size="11"
              :class="isBrightColor(c) ? 'text-black/80' : 'text-white/90'"
            />
            <input
              type="color"
              :value="c"
              class="absolute inset-0 opacity-0 cursor-pointer"
              :class="(connectorSettings.color || '').toLowerCase() === c.toLowerCase() ? 'h-full w-full pointer-events-auto z-10' : 'h-0 w-0 pointer-events-none'"
              :ref="(el) => registerColorInput(`conn_color_${idx}`, el)"
              @input="handleSwatchInput($event, idx, (val) => { connectorSettings.color = val; saveConnectorSettings() })"
              @change="handleSwatchInput($event, idx, (val) => { connectorSettings.color = val; saveConnectorSettings() })"
            />
          </button>
          <label class="relative flex h-6 w-full cursor-pointer items-center justify-center rounded-md border border-line bg-surface hover:bg-hover transition-transform hover:scale-110 shadow-xs" title="Custom color">
            <AppIcon fallback="ph:paint-brush" :size="12" class="text-ink-soft" />
            <input type="color" :value="connectorSettings.color" class="absolute inset-0 opacity-0 cursor-pointer w-full h-full" @input="connectorSettings.color = ($event.target as HTMLInputElement).value; saveConnectorSettings()" />
          </label>
        </div>
      </template>

      <!-- Sticky Popover -->
      <template v-else-if="activePopover === 'sticky'">
        <div class="flex items-center justify-between pb-0.5">
          <span class="text-[10px] font-bold uppercase tracking-wider text-ink-faint">Sticky Settings</span>
          <button class="text-ink-faint hover:text-ink" @click="closeAllPopovers"><AppIcon fallback="ph:x" :size="13" /></button>
        </div>

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

        <span class="text-[10px] font-bold uppercase tracking-wider text-ink-faint mt-1">Sticky Color</span>
        <div class="grid grid-cols-4 gap-1.5">
          <button
            v-for="(st, name) in STICKY_COLORS"
            :key="name"
            class="relative flex h-6 w-full items-center justify-center rounded-md ring-1 ring-black/10 transition-transform hover:scale-110"
            :style="{ backgroundColor: st.bg }"
            :class="(currentStickyColor === name || (currentStickyColor || '').toLowerCase() === st.bg.toLowerCase()) ? 'ring-2 ring-primary ring-offset-1 scale-105' : ''"
            :title="`Sticky ${name}`"
            @click="handleStickySwatchClick(name, st.bg, currentStickyColor, onStickyColorClick, 'dock_sticky_bg')"
          >
            <AppIcon
              v-if="currentStickyColor === name || (currentStickyColor || '').toLowerCase() === st.bg.toLowerCase()"
              fallback="ph:pencil-simple"
              :size="11"
              :class="isBrightColor(st.bg) ? 'text-black/80' : 'text-white/90'"
            />
            <input
              type="color"
              :value="st.bg"
              class="absolute inset-0 opacity-0 cursor-pointer"
              :class="(currentStickyColor === name || (currentStickyColor || '').toLowerCase() === st.bg.toLowerCase()) ? 'h-full w-full pointer-events-auto z-10' : 'h-0 w-0 pointer-events-none'"
              :ref="(el) => registerColorInput(`dock_sticky_bg_${name}`, el)"
              @input="onStickyColorClick(($event.target as HTMLInputElement).value)"
              @change="onStickyColorClick(($event.target as HTMLInputElement).value)"
            />
          </button>
          <label class="relative flex h-6 w-full cursor-pointer items-center justify-center rounded-md border border-line bg-surface hover:bg-hover transition-transform hover:scale-110 shadow-xs" title="Custom color">
            <AppIcon fallback="ph:paint-brush" :size="12" class="text-ink-soft" />
            <input type="color" :value="currentStickyColor" class="absolute inset-0 opacity-0 cursor-pointer w-full h-full" @input="onStickyColorClick(($event.target as HTMLInputElement).value)" />
          </label>
        </div>

        <span class="text-[10px] font-bold uppercase tracking-wider text-ink-faint mt-1">Text Color</span>
        <div class="grid grid-cols-4 gap-1.5">
          <button
            v-for="(c, idx) in activePalette"
            :key="idx"
            class="relative flex h-6 w-full items-center justify-center rounded-md transition-transform hover:scale-110 ring-1 ring-black/10"
            :style="{ backgroundColor: c }"
            :class="(currentStickyTextColor || '').toLowerCase() === c.toLowerCase() ? 'ring-2 ring-primary ring-offset-2 scale-105' : 'opacity-85 hover:opacity-100'"
            @click.stop="handleSwatchClick(c, idx, currentStickyTextColor, setSelectionStickyTextColor, 'dock_sticky_text')"
          >
            <AppIcon
              v-if="(currentStickyTextColor || '').toLowerCase() === c.toLowerCase()"
              fallback="ph:pencil-simple"
              :size="11"
              :class="isBrightColor(c) ? 'text-black/80' : 'text-white/90'"
            />
            <input
              type="color"
              :value="c"
              class="absolute inset-0 opacity-0 cursor-pointer"
              :class="(currentStickyTextColor || '').toLowerCase() === c.toLowerCase() ? 'h-full w-full pointer-events-auto z-10' : 'h-0 w-0 pointer-events-none'"
              :ref="(el) => registerColorInput(`dock_sticky_text_${idx}`, el)"
              @input="handleSwatchInput($event, idx, setSelectionStickyTextColor)"
              @change="handleSwatchInput($event, idx, setSelectionStickyTextColor)"
            />
          </button>
          <label class="relative flex h-6 w-full cursor-pointer items-center justify-center rounded-md border border-line bg-surface hover:bg-hover transition-transform hover:scale-110 shadow-xs" title="Custom text color">
            <AppIcon fallback="ph:paint-brush" :size="12" class="text-ink-soft" />
            <input type="color" :value="currentStickyTextColor" class="absolute inset-0 opacity-0 cursor-pointer w-full h-full" @input="setSelectionStickyTextColor(($event.target as HTMLInputElement).value)" />
          </label>
        </div>
      </template>
    </div>

    <!-- SECONDARY TIER: Pure Visual Icon Presets / Sub-Tools -->
    <div
      v-if="secondaryOpen && hasSecondary"
      class="flex items-center gap-1 rounded-2xl border border-line bg-surface/95 px-2.5 py-1 shadow-lg backdrop-blur-md text-xs"
    >
      <!-- 0. Selection Mode: Box vs Lasso -->
      <template v-if="currentTool === 'select'">
        <div class="flex items-center gap-1">
          <button
            class="flex h-8 w-8 items-center justify-center rounded-lg transition-all"
            :class="selectMode === 'box' ? 'bg-primary/15 ring-1 ring-primary/40 text-primary' : 'text-ink-soft hover:bg-hover'"
            title="Box Selection"
            @click="selectMode = 'box'"
          >
            <AppIcon fallback="ph:bounding-box" :size="16" />
          </button>
          <button
            class="flex h-8 w-8 items-center justify-center rounded-lg transition-all"
            :class="selectMode === 'lasso' ? 'bg-primary/15 ring-1 ring-primary/40 text-primary' : 'text-ink-soft hover:bg-hover'"
            title="Lasso Selection"
            @click="selectMode = 'lasso'"
          >
            <AppIcon fallback="ph:lasso" :size="16" />
          </button>
        </div>
      </template>

      <!-- 1. Draw Mode: 4 Pen Presets -->
      <template v-else-if="currentTool === 'pen'">
        <div v-for="(p, idx) in penPresets" :key="p.id" class="relative">
          <button
            class="flex h-8 w-8 items-center justify-center rounded-lg transition-all"
            :class="activePresetIndex === idx ? 'bg-primary/15 ring-1 ring-primary/40 text-primary' : 'text-ink-soft hover:bg-hover'"
            :title="p.name"
            @click="onPresetClick(idx)"
          >
            <div class="relative flex items-center justify-center">
              <AppIcon :fallback="p.type === 'pencil' ? 'ph:pencil-simple' : p.type === 'highlighter' ? 'ph:highlighter' : 'ph:pen-nib'" :size="16" />
              <span class="absolute -bottom-1 -right-1 h-2.5 w-2.5 rounded-full ring-1 ring-surface shadow-xs" :style="{ backgroundColor: p.color }" />
            </div>
          </button>
          <button
            v-if="activePresetIndex === idx"
            class="absolute -top-2 left-1/2 -translate-x-1/2 flex h-3.5 w-4 items-center justify-center rounded-t-sm bg-surface border-t border-x border-line text-ink-soft hover:text-ink shadow-xs"
            title="Preset settings"
            @click.stop="togglePopover('pen-preset')"
          >
            <AppIcon fallback="ph:caret-up" :size="8" />
          </button>
        </div>
      </template>

      <!-- 2. Eraser Mode: Pixel vs Object -->
      <template v-else-if="currentTool === 'eraser'">
        <div class="flex items-center gap-1">
          <div class="relative">
            <button
              class="flex h-8 w-8 items-center justify-center rounded-lg transition-all"
              :class="eraserMode === 'pixel' ? 'bg-primary/15 ring-1 ring-primary/40 text-primary' : 'text-ink-soft hover:bg-hover'"
              title="Pixel Eraser"
              @click="eraserMode = 'pixel'"
            >
              <AppIcon fallback="ph:eraser" :size="16" />
            </button>
            <button
              v-if="eraserMode === 'pixel'"
              class="absolute -top-2 left-1/2 -translate-x-1/2 flex h-3.5 w-4 items-center justify-center rounded-t-sm bg-surface border-t border-x border-line text-ink-soft hover:text-ink shadow-xs"
              title="Pixel eraser size"
              @click.stop="togglePopover('eraser')"
            >
              <AppIcon fallback="ph:caret-up" :size="8" />
            </button>
          </div>
          <button
            class="flex h-8 w-8 items-center justify-center rounded-lg transition-all"
            :class="eraserMode === 'object' ? 'bg-primary/15 ring-1 ring-primary/40 text-primary' : 'text-ink-soft hover:bg-hover'"
            title="Object Eraser"
            @click="eraserMode = 'object'; closeAllPopovers()"
          >
            <AppIcon fallback="ph:backspace" :size="16" />
          </button>
        </div>
      </template>

      <!-- 3. 2D Shapes Mode: 4 Shapes -->
      <template v-else-if="currentTool === 'shape2d'">
        <div v-for="shp in (['rectangle', 'ellipse', 'diamond', 'triangle'] as Shape2DType[])" :key="shp" class="relative">
          <button
            class="flex h-8 w-8 items-center justify-center rounded-lg transition-all"
            :class="activeShapeItem === shp ? 'bg-primary/15 ring-1 ring-primary/40 text-primary' : 'text-ink-soft hover:bg-hover'"
            :title="shp"
            @click="onShapeClick(shp)"
          >
            <svg class="h-[18px] w-[18px] shrink-0" viewBox="0 0 20 20">
              <rect
                v-if="shp === 'rectangle'"
                x="2.5"
                y="3.5"
                width="15"
                height="13"
                rx="2"
                :stroke="shape2DSettings[shp].color"
                stroke-width="2"
                :fill="getShapeFillPreview(shp)"
              />
              <ellipse
                v-else-if="shp === 'ellipse'"
                cx="10"
                cy="10"
                rx="8"
                ry="6.5"
                :stroke="shape2DSettings[shp].color"
                stroke-width="2"
                :fill="getShapeFillPreview(shp)"
              />
              <polygon
                v-else-if="shp === 'diamond'"
                points="10,2 18,10 10,18 2,10"
                :stroke="shape2DSettings[shp].color"
                stroke-width="2"
                stroke-linejoin="round"
                :fill="getShapeFillPreview(shp)"
              />
              <polygon
                v-else-if="shp === 'triangle'"
                points="10,2.5 18,17.5 2,17.5"
                :stroke="shape2DSettings[shp].color"
                stroke-width="2"
                stroke-linejoin="round"
                :fill="getShapeFillPreview(shp)"
              />
            </svg>
          </button>
          <button
            v-if="activeShapeItem === shp"
            class="absolute -top-2 left-1/2 -translate-x-1/2 flex h-3.5 w-4 items-center justify-center rounded-t-sm bg-surface border-t border-x border-line text-ink-soft hover:text-ink shadow-xs"
            title="Shape settings"
            @click.stop="togglePopover('shape')"
          >
            <AppIcon fallback="ph:caret-up" :size="8" />
          </button>
        </div>
      </template>

      <!-- 4. 1D Connectors Mode: Curvature Presets + Settings -->
      <template v-else-if="currentTool === 'connector'">
        <div v-for="curv in (['straight', 'curved', 'orthogonal'] as LineCurvature[])" :key="curv" class="relative">
          <button
            class="flex h-8 w-8 items-center justify-center rounded-lg transition-all"
            :class="connectorSettings.curvature === curv ? 'bg-primary/15 ring-1 ring-primary/40 text-primary' : 'text-ink-soft hover:bg-hover'"
            :title="`${curv} connector`"
            @click="onConnectorCurvatureClick(curv)"
          >
            <svg class="h-[18px] w-[18px] shrink-0" viewBox="0 0 24 24">
              <template v-for="paths in [getConnectorIconPaths(curv, connectorSettings.startHead, connectorSettings.endHead)]" :key="curv + connectorSettings.startHead + connectorSettings.endHead">
                <path
                  :d="paths.shaft"
                  fill="none"
                  :stroke="connectorSettings.color"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                />
                <circle v-if="connectorSettings.startHead === 'dot'" :cx="paths.startDot.cx" :cy="paths.startDot.cy" r="2.2" :fill="connectorSettings.color" />
                <polygon v-else-if="connectorSettings.startHead === 'arrow'" :points="paths.startTriangle" :fill="connectorSettings.color" />
                <circle v-if="connectorSettings.endHead === 'dot'" :cx="paths.endDot.cx" :cy="paths.endDot.cy" r="2.2" :fill="connectorSettings.color" />
                <polygon v-else-if="connectorSettings.endHead === 'arrow'" :points="paths.endTriangle" :fill="connectorSettings.color" />
              </template>
            </svg>
          </button>
          <button
            v-if="connectorSettings.curvature === curv"
            class="absolute -top-2 left-1/2 -translate-x-1/2 flex h-3.5 w-4 items-center justify-center rounded-t-sm bg-surface border-t border-x border-line text-ink-soft hover:text-ink shadow-xs"
            title="Connector settings"
            @click.stop="togglePopover('connector')"
          >
            <AppIcon fallback="ph:caret-up" :size="8" />
          </button>
        </div>
      </template>

      <!-- 5. Sticky Note Mode: Color Presets -->
      <template v-else-if="currentTool === 'sticky'">
        <div v-for="(st, name) in STICKY_COLORS" :key="name" class="relative">
          <button
            class="h-6 w-6 rounded-md ring-1 ring-black/10 transition-transform hover:scale-110"
            :style="{ backgroundColor: st.bg }"
            :class="currentStickyColor === name ? 'ring-2 ring-primary ring-offset-1 scale-110' : ''"
            :title="`Sticky ${name}`"
            @click="onStickyColorClick(name)"
          />
          <button
            v-if="currentStickyColor === name"
            class="absolute -top-2 left-1/2 -translate-x-1/2 flex h-3.5 w-4 items-center justify-center rounded-t-sm bg-surface border-t border-x border-line text-ink-soft hover:text-ink shadow-xs"
            title="Sticky settings"
            @click.stop="togglePopover('sticky')"
          >
            <AppIcon fallback="ph:caret-up" :size="8" />
          </button>
        </div>
      </template>
    </div>

    <!-- PRIMARY TIER: Main Tools Dock -->
    <div class="flex items-center gap-1 rounded-2xl border border-line bg-surface/90 px-2.5 py-1.5 shadow-xl backdrop-blur-md">
      <!-- Undo & Redo on the left side of main toolbar -->
      <button
        class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-all"
        :class="canUndo ? 'text-ink-soft hover:bg-hover hover:text-ink active:scale-95' : 'text-ink-faint/30 cursor-not-allowed'"
        :disabled="!canUndo"
        title="Undo (⌘Z)"
        @click="undo"
      >
        <AppIcon fallback="ph:arrow-u-up-left" :size="16" />
      </button>
      <button
        class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-all"
        :class="canRedo ? 'text-ink-soft hover:bg-hover hover:text-ink active:scale-95' : 'text-ink-faint/30 cursor-not-allowed'"
        :disabled="!canRedo"
        title="Redo (⇧⌘Z)"
        @click="redo"
      >
        <AppIcon fallback="ph:arrow-u-up-right" :size="16" />
      </button>

      <div class="mx-0.5 h-4 w-px bg-line" />

      <!-- Main Tool Buttons with Dynamic Icon State -->
      <button
        v-for="t in mainTools"
        :key="t.id"
        class="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-all"
        :class="toolBtn(currentTool === t.id)"
        :title="t.title"
        @click="onSelectMainTool(t.id)"
      >
        <!-- Dynamic Pen Preview (Pen/Pencil/Marker type with color matching ink) -->
        <template v-if="t.id === 'pen'">
          <div class="relative flex items-center justify-center">
            <AppIcon
              :fallback="dockPenIcon"
              :size="18"
              :style="{ color: currentColor, filter: isBrightColor(currentColor) ? 'drop-shadow(0 0 1px rgba(0,0,0,0.7))' : undefined }"
            />
          </div>
        </template>

        <!-- Dynamic Eraser Preview (Pixel vs Object) -->
        <template v-else-if="t.id === 'eraser'">
          <AppIcon :fallback="dockEraserIcon" :size="17" />
        </template>

        <!-- Dynamic 2D Shape Preview -->
        <template v-else-if="t.id === 'shape2d'">
          <svg class="h-[18px] w-[18px] shrink-0" viewBox="0 0 20 20">
            <rect
              v-if="activeShapeItem === 'rectangle'"
              x="2.5"
              y="3.5"
              width="15"
              height="13"
              rx="2"
              :stroke="shape2DSettings[activeShapeItem].color"
              stroke-width="2"
              :fill="getShapeFillPreview(activeShapeItem)"
            />
            <ellipse
              v-else-if="activeShapeItem === 'ellipse'"
              cx="10"
              cy="10"
              rx="8"
              ry="6.5"
              :stroke="shape2DSettings[activeShapeItem].color"
              stroke-width="2"
              :fill="getShapeFillPreview(activeShapeItem)"
            />
            <polygon
              v-else-if="activeShapeItem === 'diamond'"
              points="10,2 18,10 10,18 2,10"
              :stroke="shape2DSettings[activeShapeItem].color"
              stroke-width="2"
              stroke-linejoin="round"
              :fill="getShapeFillPreview(activeShapeItem)"
            />
            <polygon
              v-else-if="activeShapeItem === 'triangle'"
              points="10,2.5 18,17.5 2,17.5"
              :stroke="shape2DSettings[activeShapeItem].color"
              stroke-width="2"
              stroke-linejoin="round"
              :fill="getShapeFillPreview(activeShapeItem)"
            />
          </svg>
        </template>

        <!-- Dynamic 1D Connector Preview -->
        <template v-else-if="t.id === 'connector'">
          <svg class="h-[18px] w-[18px] shrink-0" viewBox="0 0 24 24">
            <template v-for="paths in [getConnectorIconPaths(connectorSettings.curvature, connectorSettings.startHead, connectorSettings.endHead)]" :key="connectorSettings.curvature + connectorSettings.startHead + connectorSettings.endHead">
              <path
                :d="paths.shaft"
                fill="none"
                :stroke="connectorSettings.color"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
              <circle v-if="connectorSettings.startHead === 'dot'" :cx="paths.startDot.cx" :cy="paths.startDot.cy" r="2.2" :fill="connectorSettings.color" />
              <polygon v-else-if="connectorSettings.startHead === 'arrow'" :points="paths.startTriangle" :fill="connectorSettings.color" />
              <circle v-if="connectorSettings.endHead === 'dot'" :cx="paths.endDot.cx" :cy="paths.endDot.cy" r="2.2" :fill="connectorSettings.color" />
              <polygon v-else-if="connectorSettings.endHead === 'arrow'" :points="paths.endTriangle" :fill="connectorSettings.color" />
            </template>
          </svg>
        </template>

        <!-- Dynamic Sticky Note Preview matching actual sticky color -->
        <template v-else-if="t.id === 'sticky'">
          <svg class="h-[18px] w-[18px] shrink-0" viewBox="0 0 20 20">
            <path
              d="M 4 3 L 13 3 L 17 7 L 17 17 C 17 17.6 16.6 18 16 18 L 4 18 C 3.4 18 3 17.6 3 17 L 3 4 C 3 3.4 3.4 3 4 3 Z"
              :fill="stickyStyle(currentStickyColor).bg"
              :stroke="stickyStyle(currentStickyColor).border"
              stroke-width="1.5"
              stroke-linejoin="round"
            />
            <path
              d="M 13 3 L 13 7 L 17 7"
              fill="none"
              :stroke="stickyStyle(currentStickyColor).border"
              stroke-width="1.5"
              stroke-linejoin="round"
            />
          </svg>
        </template>

        <!-- Selection Tool (Box vs Lasso) or Hand Tool -->
        <template v-else>
          <AppIcon :fallback="t.id === 'select' ? (selectMode === 'lasso' ? 'ph:lasso' : t.icon) : t.icon" :size="17" />
        </template>

        <!-- Selection Dot Indicator below active tool -->
        <span
          v-if="currentTool === t.id"
          class="absolute bottom-0.5 h-1.5 w-1.5 rounded-full bg-white shadow-xs pointer-events-none"
        />
      </button>

      <div class="mx-0.5 h-4 w-px bg-line" />

      <!-- + Add Object Button -->
      <div class="relative">
        <button
          class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-hover text-ink shadow-xs ring-1 ring-line transition-all hover:bg-hover/80 active:scale-95"
          title="Add a Vasta object to the board (@)"
          @click="objectPickerOpen = !objectPickerOpen"
        >
          <AppIcon fallback="ph:plus" :size="14" />
        </button>
        <div v-if="objectPickerOpen" class="absolute bottom-11 left-1/2 z-50 w-80 -translate-x-1/2 rounded-2xl border border-line bg-surface p-2 shadow-2xl ring-1 ring-black/5">
          <div class="mb-2 flex items-center justify-between px-2 pt-1">
            <span class="text-xs font-semibold text-ink-soft">Drop an object onto the board</span>
            <button class="text-ink-faint hover:text-ink" @click="objectPickerOpen = false"><AppIcon fallback="ph:x" :size="14" /></button>
          </div>
          <ObjectPicker @pick="onPickObject" />
        </div>
      </div>
    </div>
  </div>

  <!-- Floating Zoom Controls (Bottom Right, moved close to bottom) -->
  <div class="absolute bottom-2.5 right-3 z-20 flex items-center gap-0.5 rounded-xl border border-line bg-surface/90 p-0.5 text-xs shadow-lg backdrop-blur-md max-sm:bottom-1.5 max-sm:right-2" data-wb-ui>
    <button class="rounded-lg p-1.5 text-ink-soft hover:bg-hover hover:text-ink" title="Zoom out" @click="zoomOut"><AppIcon fallback="ph:magnifying-glass-minus" :size="15" /></button>
    <button class="px-1 py-0.5 font-semibold text-[11px] text-ink" title="Reset view" @click="resetView">{{ Math.round(zoom * 100) }}%</button>
    <button class="rounded-lg p-1.5 text-ink-soft hover:bg-hover hover:text-ink" title="Zoom in" @click="zoomIn"><AppIcon fallback="ph:magnifying-glass-plus" :size="15" /></button>
  </div>
</template>
