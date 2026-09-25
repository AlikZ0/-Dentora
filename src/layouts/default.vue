<script setup lang="ts">
import { onMounted, onUnmounted, watch } from 'vue'
import { useAppStore } from '~/stores/app'
import { googleSyncConfigured, syncToGoogle } from '~/services/google/sync'
import { prepareConnect } from '~/services/google/calendar'
import AppNav from '~/components/AppNav.vue'
import ConfirmDialog from '~/components/ConfirmDialog.vue'
import ToastHost from '~/components/ToastHost.vue'

const app = useAppStore()
const config = useRuntimeConfig()

function syncOnline(): void {
  app.setOnline(navigator.onLine)
  // Visits saved offline go to Google Calendar once the network is back.
  // Without a live token this is a no-op; the user reconnects in Settings.
  if (navigator.onLine) void syncToGoogle().catch(() => undefined)
}

// Load Google's sign-in script early, so an expired token can be renewed
// without waiting for a script inside the Save tap.
watch(
  () => app.ready,
  (ready) => {
    const clientId = app.settings.googleClientId || String(config.public.googleClientId || '')
    if (ready && googleSyncConfigured(app.settings) && clientId && navigator.onLine) {
      void prepareConnect(clientId, app.settings.googleEmail).catch(() => undefined)
    }
  },
  { immediate: true },
)

onMounted(() => {
  syncOnline()
  window.addEventListener('online', syncOnline)
  window.addEventListener('offline', syncOnline)
})

onUnmounted(() => {
  window.removeEventListener('online', syncOnline)
  window.removeEventListener('offline', syncOnline)
})
</script>

<template>
  <div class="shell">
    <AppNav />
    <main class="content">
      <slot />
    </main>
    <ConfirmDialog />
    <ToastHost />
  </div>
</template>

<style scoped>
.shell {
  min-height: 100dvh;
}

.content {
  /* Room for the bottom nav plus the iOS home indicator. */
  padding-top: var(--safe-top);
  padding-bottom: calc(var(--bottom-nav-h) + var(--safe-bottom) + 12px);
  padding-left: var(--safe-left);
  padding-right: var(--safe-right);
  min-height: 100dvh;
}

@media (min-width: 861px) {
  .content {
    margin-left: var(--sidebar-w);
    padding-bottom: 32px;
  }
}
</style>
