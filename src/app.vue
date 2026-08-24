<script setup lang="ts">
import { onMounted } from 'vue'
import { useAppStore } from '~/stores/app'
import { useToasts } from '~/composables/useToasts'
import { setAppVersion } from '~/services/backup/export'
import { useAppointmentReminders } from '~/composables/useAppointmentReminders'
import { assertStorageAvailable } from '~/services/storage/storage'

const app = useAppStore()
const toasts = useToasts()
const config = useRuntimeConfig()
const reminders = useAppointmentReminders()

onMounted(async () => {
  setAppVersion(String(config.public.appVersion))
  try {
    assertStorageAvailable()
    await app.init()
    // Reminders can only fire while the app is running; see the composable.
    reminders.start()
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
