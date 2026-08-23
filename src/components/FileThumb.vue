<script setup lang="ts">
import { onMounted, watch } from 'vue'
import type { StoredFile } from '~/types/models'
import { useBlobUrl } from '~/composables/useBlobUrl'
import { KIND_LABELS } from '~/services/files/attachments'
import { formatBytes } from '~/utils/format'

const props = defineProps<{ file: StoredFile; selectable?: boolean }>()
defineEmits<{ open: []; remove: [] }>()

// Only the small preview is ever loaded here. The original stays in
// IndexedDB until the viewer asks for it.
const { url, set } = useBlobUrl()

function refresh(): void {
  set(props.file.thumbnail ?? null)
}

onMounted(refresh)
watch(() => props.file.id, refresh)
watch(() => props.file.thumbnail, refresh)

const ICONS: Record<string, string> = {
  document: '\u{1F4C4}',
  xray: '\u{1FA7B}',
  photo: '\u{1F5BC}\u{FE0F}',
  other: '\u{1F4CE}',
}
</script>

<template>
  <figure class="thumb">
    <button class="thumb-open" :aria-label="`Открыть ${file.name}`" @click="$emit('open')">
      <img v-if="url" :src="url" :alt="file.name" loading="lazy" decoding="async" />
      <span v-else class="thumb-icon" aria-hidden="true">{{ ICONS[file.kind] ?? ICONS.other }}</span>
      <span class="thumb-kind">{{ KIND_LABELS[file.kind] }}</span>
    </button>

    <figcaption class="thumb-caption">
      <span class="thumb-name truncate" :title="file.name">{{ file.name }}</span>
      <span class="thumb-size numeric">{{ formatBytes(file.size) }}</span>
    </figcaption>

    <button v-if="selectable" class="thumb-remove" aria-label="Удалить файл" @click="$emit('remove')">
      &#10005;
    </button>
  </figure>
</template>

<style scoped>
.thumb {
  position: relative;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}

.thumb-open {
  position: relative;
  aspect-ratio: 1;
  width: 100%;
  border-radius: var(--radius);
  overflow: hidden;
  background: var(--c-surface-3);
  border: 1px solid var(--c-border);
  display: grid;
  place-items: center;
}

.thumb-open img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.thumb-icon {
  font-size: 1.75rem;
}

.thumb-kind {
  position: absolute;
  left: 6px;
  bottom: 6px;
  font-size: 0.6875rem;
  font-weight: 600;
  padding: 2px 6px;
  border-radius: 999px;
  background: rgb(8 12 18 / 0.68);
  color: #fff;
}

.thumb-caption {
  display: flex;
  flex-direction: column;
  gap: 0;
  min-width: 0;
}

.thumb-name {
  font-size: 0.8125rem;
}

.thumb-size {
  font-size: 0.75rem;
  color: var(--c-text-faint);
}

.thumb-remove {
  position: absolute;
  top: -6px;
  right: -6px;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: var(--c-danger);
  color: #fff;
  font-size: 0.75rem;
  display: grid;
  place-items: center;
  box-shadow: var(--shadow-sm);
}
</style>
