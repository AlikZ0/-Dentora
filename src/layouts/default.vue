<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue'
import { useAppStore } from '~/stores/app'
import AppNav from '~/components/AppNav.vue'
import ConfirmDialog from '~/components/ConfirmDialog.vue'
import ToastHost from '~/components/ToastHost.vue'

const app = useAppStore()

function syncOnline(): void {
  app.setOnline(navigator.onLine)
}

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
