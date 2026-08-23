<script setup lang="ts">
import { onMounted } from 'vue'
import { useAppStore } from '~/stores/app'
import { useToasts } from '~/composables/useToasts'
import { setAppVersion } from '~/services/backup/export'
import { assertStorageAvailable } from '~/services/storage/storage'

const app = useAppStore()
const toasts = useToasts()
const config = useRuntimeConfig()

onMounted(async () => {
  setAppVersion(String(config.public.appVersion))
  try {
    assertStorageAvailable()
    await app.init()
  } catch (error) {
    toasts.error(error, 'app.init')
  }
})
</script>

<template>
  <NuxtLayout>
    <NuxtPage />
  </NuxtLayout>
</template>
