<script setup lang="ts">
import { useToasts } from '~/composables/useToasts'

const { toasts, dismiss } = useToasts()
</script>

<template>
  <Teleport to="body">
    <div class="toast-host" role="status" aria-live="polite">
      <TransitionGroup name="toast">
        <div v-for="toast in toasts" :key="toast.id" :class="['toast', `toast-${toast.kind}`]">
          <span class="toast-message">{{ toast.message }}</span>
          <button
            v-if="toast.action"
            class="toast-action"
            @click="toast.action.run(); dismiss(toast.id)"
          >
            {{ toast.action.label }}
          </button>
          <button class="toast-close" aria-label="Закрыть" @click="dismiss(toast.id)">&#10005;</button>
        </div>
      </TransitionGroup>
    </div>
  </Teleport>
</template>

<style scoped>
.toast-host {
  position: fixed;
  left: 50%;
  transform: translateX(-50%);
  /* Above the bottom nav on phones, clear of the home indicator. */
  bottom: calc(var(--bottom-nav-h) + var(--safe-bottom) + 12px);
  z-index: 300;
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: min(480px, calc(100vw - 24px));
  pointer-events: none;
}

.toast {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 14px;
  border-radius: var(--radius);
  background: var(--c-surface);
  border: 1px solid var(--c-border-strong);
  box-shadow: var(--shadow-lg);
  font-size: 0.9375rem;
  pointer-events: auto;
}

.toast-message {
  flex: 1;
  min-width: 0;
}

.toast-success { border-left: 4px solid var(--c-success); }
.toast-error { border-left: 4px solid var(--c-danger); }
.toast-warning { border-left: 4px solid var(--c-warning); }
.toast-info { border-left: 4px solid var(--c-primary); }

.toast-action {
  color: var(--c-primary);
  font-weight: 600;
  padding: 6px 8px;
  border-radius: var(--radius-sm);
  flex-shrink: 0;
}

.toast-close {
  color: var(--c-text-faint);
  width: 28px;
  height: 28px;
  border-radius: 50%;
  flex-shrink: 0;
  display: grid;
  place-items: center;
}
.toast-close:hover { background: var(--c-surface-2); }

.toast-enter-active,
.toast-leave-active {
  transition: opacity 0.2s, transform 0.2s;
}
.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translateY(10px);
}

@media (min-width: 861px) {
  .toast-host {
    bottom: 20px;
    left: auto;
    right: 20px;
    transform: none;
  }
}
</style>
