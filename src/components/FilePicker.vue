<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { ACCEPT_ATTRIBUTE } from '~/services/files/attachments'
import { isIos } from '~/services/files/download'
import AppButton from './AppButton.vue'

withDefaults(
  defineProps<{
    /** Restrict to images and offer a "take a photo" entry point. */
    photosOnly?: boolean
    multiple?: boolean
    disabled?: boolean
    label?: string
  }>(),
  { multiple: true, label: 'Добавить файлы' },
)

const emit = defineEmits<{ picked: [files: File[]] }>()

const galleryInput = ref<HTMLInputElement | null>(null)
const cameraInput = ref<HTMLInputElement | null>(null)
const showCamera = ref(false)

/*
 * `capture` only makes sense where the browser can open a camera directly.
 * Detect that by capability, not by user-agent string: a coarse primary
 * pointer plus touch support means a phone or tablet. UA sniffing would miss
 * Android tablets with unusual strings and would wrongly offer the camera on
 * a desktop, where `capture` just opens an ordinary file dialog.
 */
onMounted(() => {
  const coarse = window.matchMedia?.('(pointer: coarse)').matches ?? false
  const touch = (navigator.maxTouchPoints ?? 0) > 0
  showCamera.value = (coarse && touch) || isIos()
})

function onChange(event: Event): void {
  const input = event.target as HTMLInputElement
  const files = Array.from(input.files ?? [])
  // Resetting lets the user pick the same file twice in a row - iOS Safari
  // otherwise fires no change event the second time.
  input.value = ''
  if (files.length) emit('picked', files)
}
</script>

<template>
  <div class="picker">
    <!--
      Two separate inputs: one plain (gallery / Files / iCloud Drive), one with
      `capture` (camera). Putting `capture` on a single shared input would stop
      iOS from offering the photo library at all.
    -->
    <input
      ref="galleryInput"
      type="file"
      class="visually-hidden"
      :accept="photosOnly ? 'image/*' : ACCEPT_ATTRIBUTE"
      :multiple="multiple"
      @change="onChange"
    />
    <input
      v-if="showCamera"
      ref="cameraInput"
      type="file"
      class="visually-hidden"
      accept="image/*"
      capture="environment"
      @change="onChange"
    />

    <AppButton variant="primary" :disabled="disabled" @click="galleryInput?.click()">
      {{ label }}
    </AppButton>
    <AppButton v-if="showCamera" variant="secondary" :disabled="disabled" @click="cameraInput?.click()">
      Сделать фото
    </AppButton>
  </div>
</template>

<style scoped>
.picker {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.picker :deep(.btn) {
  flex: 1 1 auto;
  min-width: 140px;
}
</style>
