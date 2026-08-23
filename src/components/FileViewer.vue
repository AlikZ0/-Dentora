<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue'
import type { StoredFile } from '~/types/models'
import { fileRepository } from '~/database/repositories/files'
import { usePanZoom } from '~/composables/usePanZoom'
import { useToasts } from '~/composables/useToasts'
import { isPdf, isViewableImage, KIND_LABELS } from '~/services/files/attachments'
import { saveBlob, isIos } from '~/services/files/download'
import { formatBytes } from '~/utils/format'
import { formatDateTime } from '~/utils/datetime'
import AppButton from './AppButton.vue'

const props = defineProps<{
  /** Files in the current gallery, so the viewer can page through them. */
  files: StoredFile[]
  index: number
}>()

const emit = defineEmits<{ close: []; navigate: [index: number]; remove: [file: StoredFile] }>()

const toasts = useToasts()
const stage = ref<HTMLElement | null>(null)
const { transform, isZoomed, reset, rotate, zoomIn, zoomOut, handlers } = usePanZoom(stage)

const objectUrl = ref<string | null>(null)
const loading = ref(false)
const failed = ref(false)

const current = computed<StoredFile | undefined>(() => props.files[props.index])
const canPrev = computed(() => props.index > 0)
const canNext = computed(() => props.index < props.files.length - 1)

function releaseUrl(): void {
  if (objectUrl.value) {
    URL.revokeObjectURL(objectUrl.value)
    objectUrl.value = null
  }
}

/**
 * Loads the original bytes - and only now. Until the viewer opens, a client
 * card has shown nothing but the small thumbnails.
 */
async function loadOriginal(): Promise<void> {
  releaseUrl()
  failed.value = false
  const file = current.value
  if (!file) return

  loading.value = true
  try {
    const blob = await fileRepository().getBlob(file.id)
    if (!blob) {
      failed.value = true
      return
    }
    objectUrl.value = URL.createObjectURL(blob)
  } catch (error) {
    failed.value = true
    toasts.error(error, 'viewer.load')
  } finally {
    loading.value = false
  }
}

watch(
  () => current.value?.id,
  () => {
    reset()
    void loadOriginal()
  },
  { immediate: true },
)

onUnmounted(releaseUrl)

function go(delta: number): void {
  const next = props.index + delta
  if (next >= 0 && next < props.files.length) emit('navigate', next)
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'ArrowLeft') go(-1)
  else if (event.key === 'ArrowRight') go(1)
  else if (event.key === 'Escape') emit('close')
  else if (event.key === 'r' || event.key === 'R') rotate()
  else if (event.key === '0') reset()
}

async function toggleFullscreen(): Promise<void> {
  const element = stage.value?.closest('.viewer') as HTMLElement | null
  if (!element) return
  try {
    if (document.fullscreenElement) await document.exitFullscreen()
    // iOS Safari has no Element.requestFullscreen; the viewer is already a
    // full-viewport overlay there, so this is simply a no-op.
    else await element.requestFullscreen?.()
  } catch {
    toasts.info('Полноэкранный режим недоступен в этом браузере.')
  }
}

async function download(): Promise<void> {
  const file = current.value
  if (!file) return
  try {
    const blob = await fileRepository().getBlob(file.id)
    if (!blob) throw new Error('missing_blob')
    await saveBlob(blob, { suggestedName: file.name, mimeType: file.mimeType, preferShare: isIos() })
  } catch (error) {
    toasts.error(error, 'viewer.download')
  }
}

const supportsFullscreen = computed(
  () => typeof document !== 'undefined' && Boolean(document.documentElement.requestFullscreen),
)
</script>

<template>
  <Teleport to="body">
    <div
      v-if="current"
      class="viewer"
      role="dialog"
      aria-modal="true"
      :aria-label="current.name"
      tabindex="-1"
      @keydown="onKeydown"
    >
      <header class="viewer-bar viewer-top">
        <div class="viewer-meta">
          <p class="viewer-name truncate">{{ current.name }}</p>
          <p class="viewer-sub">
            {{ KIND_LABELS[current.kind] }} ·
            {{ formatBytes(current.size) }}
            <template v-if="current.width"> · {{ current.width }}&times;{{ current.height }}</template>
            · {{ formatDateTime(current.createdAt) }}
          </p>
        </div>
        <button class="icon-btn" aria-label="Закрыть" @click="emit('close')">&#10005;</button>
      </header>

      <div
        ref="stage"
        class="viewer-stage"
        v-bind="isViewableImage(current) ? handlers : {}"
        :class="{ 'is-zoomed': isZoomed }"
      >
        <p v-if="loading" class="viewer-status">Загружаем файл…</p>

        <p v-else-if="failed" class="viewer-status">
          Не удалось открыть файл. Возможно, он был удалён из хранилища.
        </p>

        <img
          v-else-if="objectUrl && isViewableImage(current)"
          :src="objectUrl"
          :alt="current.name"
          class="viewer-image"
          :style="{ transform }"
          draggable="false"
        />

        <!-- iOS Safari refuses to render PDFs in an iframe, so we offer to open it. -->
        <div v-else-if="objectUrl && isPdf(current)" class="viewer-pdf">
          <iframe :src="objectUrl" :title="current.name" class="viewer-frame" />
          <AppButton variant="secondary" @click="download">Открыть в приложении</AppButton>
        </div>

        <div v-else class="viewer-status stack">
          <p>Предпросмотр для этого формата недоступен.</p>
          <AppButton variant="secondary" @click="download">Сохранить файл</AppButton>
        </div>
      </div>

      <!--
        Arrows hug the edges and the counter floats above the toolbar - neither
        may sit over the image, or it hides exactly the detail being examined.
      -->
      <template v-if="files.length > 1">
        <nav class="viewer-paddle" aria-label="Навигация по файлам">
          <button class="paddle" :disabled="!canPrev" aria-label="Предыдущий" @click="go(-1)">
            &lsaquo;
          </button>
          <button class="paddle" :disabled="!canNext" aria-label="Следующий" @click="go(1)">
            &rsaquo;
          </button>
        </nav>
        <p class="viewer-count numeric">{{ index + 1 }} / {{ files.length }}</p>
      </template>

      <footer class="viewer-bar viewer-bottom">
        <template v-if="isViewableImage(current)">
          <button class="icon-btn" aria-label="Уменьшить" @click="zoomOut">&minus;</button>
          <button class="icon-btn" aria-label="Увеличить" @click="zoomIn">+</button>
          <button class="icon-btn" aria-label="Повернуть" @click="rotate()">&#8635;</button>
          <button class="icon-btn" aria-label="Сбросить" @click="reset">&#9634;</button>
        </template>
        <button
          v-if="supportsFullscreen"
          class="icon-btn"
          aria-label="Во весь экран"
          @click="toggleFullscreen"
        >
          &#9974;
        </button>
        <span class="spacer" />
        <button class="icon-btn" aria-label="Сохранить" @click="download">&#8681;</button>
        <button class="icon-btn danger" aria-label="Удалить" @click="emit('remove', current)">
          &#128465;
        </button>
      </footer>
    </div>
  </Teleport>
</template>

<style scoped>
.viewer {
  position: fixed;
  inset: 0;
  z-index: 400;
  background: #05070a;
  color: #f2f5f8;
  display: flex;
  flex-direction: column;
  padding-top: var(--safe-top);
  padding-bottom: var(--safe-bottom);
  padding-left: var(--safe-left);
  padding-right: var(--safe-right);
}

.viewer-bar {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 10px;
  background: rgb(10 14 20 / 0.9);
  flex-shrink: 0;
}

.viewer-top { border-bottom: 1px solid rgb(255 255 255 / 0.08); }
.viewer-bottom { border-top: 1px solid rgb(255 255 255 / 0.08); }

.viewer-meta {
  flex: 1;
  min-width: 0;
}

.viewer-name {
  font-weight: 600;
  font-size: 0.9375rem;
}

.viewer-sub {
  font-size: 0.75rem;
  color: rgb(242 245 248 / 0.6);
}

.icon-btn {
  width: var(--touch);
  height: var(--touch);
  display: grid;
  place-items: center;
  border-radius: var(--radius-sm);
  color: #f2f5f8;
  font-size: 1.1rem;
  flex-shrink: 0;
}
.icon-btn:hover { background: rgb(255 255 255 / 0.1); }
.icon-btn.danger { color: #fda29b; }

.viewer-stage {
  flex: 1;
  overflow: hidden;
  display: grid;
  place-items: center;
  position: relative;
  /* Required so iOS hands the pinch gesture to us instead of zooming the page. */
  touch-action: none;
  cursor: grab;
  user-select: none;
}

.viewer-stage.is-zoomed { cursor: move; }

.viewer-image {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
  transform-origin: center center;
  will-change: transform;
  -webkit-user-drag: none;
}

.viewer-status {
  color: rgb(242 245 248 / 0.72);
  text-align: center;
  padding: 24px;
  align-items: center;
}

.viewer-pdf {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 8px;
}

.viewer-frame {
  flex: 1;
  width: 100%;
  border: 0;
  border-radius: var(--radius);
  background: #fff;
}

.viewer-paddle {
  position: absolute;
  left: 0;
  right: 0;
  top: 50%;
  transform: translateY(-50%);
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 8px;
  pointer-events: none;
}

.paddle {
  width: 48px;
  height: 48px;
  border-radius: 50%;
  background: rgb(10 14 20 / 0.6);
  color: #fff;
  font-size: 1.6rem;
  line-height: 1;
  display: grid;
  place-items: center;
  pointer-events: auto;
}
.paddle:disabled { opacity: 0.25; pointer-events: none; }

.viewer-count {
  position: absolute;
  left: 50%;
  transform: translateX(-50%);
  bottom: calc(var(--touch) + var(--safe-bottom) + 20px);
  font-size: 0.8125rem;
  background: rgb(10 14 20 / 0.72);
  padding: 4px 12px;
  border-radius: 999px;
  pointer-events: none;
}
</style>
