<script setup lang="ts">
withDefaults(
  defineProps<{
    variant?: 'primary' | 'secondary' | 'ghost' | 'danger'
    size?: 'sm' | 'md' | 'lg'
    type?: 'button' | 'submit'
    disabled?: boolean
    loading?: boolean
    block?: boolean
  }>(),
  { variant: 'secondary', size: 'md', type: 'button' },
)
</script>

<template>
  <button
    :type="type"
    :class="['btn', `btn-${variant}`, `btn-${size}`, { 'btn-block': block, 'is-loading': loading }]"
    :disabled="disabled || loading"
  >
    <span v-if="loading" class="btn-spinner" aria-hidden="true" />
    <slot />
  </button>
</template>

<style scoped>
.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  border-radius: var(--radius);
  font-weight: 550;
  border: 1px solid transparent;
  transition: background-color 0.15s, border-color 0.15s, opacity 0.15s;
  /* Every button clears the 44 px touch floor. */
  min-height: var(--touch);
  padding: 0 16px;
  white-space: nowrap;
  -webkit-tap-highlight-color: transparent;
  user-select: none;
}

.btn-sm {
  min-height: 36px;
  padding: 0 12px;
  font-size: 0.875rem;
  border-radius: var(--radius-sm);
}
.btn-lg {
  min-height: 52px;
  padding: 0 22px;
  font-size: 1.0625rem;
}

.btn-block {
  width: 100%;
}

.btn-primary {
  background: var(--c-primary);
  color: var(--c-on-primary);
}
.btn-primary:hover:not(:disabled) { background: var(--c-primary-hover); }

.btn-secondary {
  background: var(--c-surface);
  color: var(--c-text);
  border-color: var(--c-border-strong);
}
.btn-secondary:hover:not(:disabled) { background: var(--c-surface-2); }

.btn-ghost {
  background: transparent;
  color: var(--c-text-muted);
}
.btn-ghost:hover:not(:disabled) {
  background: var(--c-surface-2);
  color: var(--c-text);
}

.btn-danger {
  background: var(--c-danger);
  color: #fff;
}
.btn-danger:hover:not(:disabled) { background: var(--c-danger-hover); }

.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-spinner {
  width: 15px;
  height: 15px;
  border: 2px solid currentColor;
  border-right-color: transparent;
  border-radius: 50%;
  animation: btn-spin 0.65s linear infinite;
}

@keyframes btn-spin {
  to { transform: rotate(360deg); }
}

/* Touch devices get no hover state, but do get a pressed state. */
@media (hover: none) {
  .btn:active:not(:disabled) { opacity: 0.7; }
}
</style>
