<script setup lang="ts">
defineProps<{
  label: string
  value: string | number
  hint?: string
  tone?: 'default' | 'success' | 'warning' | 'danger'
  to?: string
}>()
</script>

<template>
  <component :is="to ? 'NuxtLink' : 'div'" :to="to" :class="['stat', `tone-${tone ?? 'default'}`, { 'is-link': to }]">
    <span class="stat-label">{{ label }}</span>
    <span class="stat-value numeric">{{ value }}</span>
    <span v-if="hint" class="stat-hint">{{ hint }}</span>
  </component>
</template>

<style scoped>
.stat {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 14px;
  background: var(--c-surface);
  border: 1px solid var(--c-border);
  border-radius: var(--radius-lg);
  color: inherit;
  min-width: 0;
}

.is-link {
  transition: border-color 0.15s, transform 0.1s;
}
.is-link:hover {
  border-color: var(--c-border-strong);
}
.is-link:active {
  transform: scale(0.99);
}

.stat-label {
  font-size: 0.8125rem;
  color: var(--c-text-muted);
}

.stat-value {
  font-size: 1.625rem;
  font-weight: 650;
  letter-spacing: -0.02em;
  line-height: 1.15;
}

.stat-hint {
  font-size: 0.75rem;
  color: var(--c-text-faint);
}

.tone-success .stat-value { color: var(--c-success); }
.tone-warning .stat-value { color: var(--c-warning); }
.tone-danger .stat-value { color: var(--c-danger); }
</style>
