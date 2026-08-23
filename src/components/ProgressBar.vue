<script setup lang="ts">
defineProps<{
  /** 0..1, or null for an indeterminate bar. */
  ratio: number | null
  label?: string
}>()
</script>

<template>
  <div class="progress">
    <div v-if="label" class="progress-label">
      <span class="truncate">{{ label }}</span>
      <span v-if="ratio !== null" class="numeric faint">{{ Math.round(ratio * 100) }}%</span>
    </div>
    <div
      class="progress-track"
      role="progressbar"
      :aria-valuenow="ratio === null ? undefined : Math.round(ratio * 100)"
      aria-valuemin="0"
      aria-valuemax="100"
    >
      <div
        :class="['progress-fill', { indeterminate: ratio === null }]"
        :style="ratio === null ? undefined : { width: `${Math.max(2, ratio * 100)}%` }"
      />
    </div>
  </div>
</template>

<style scoped>
.progress {
  display: flex;
  flex-direction: column;
  gap: 6px;
  width: 100%;
}

.progress-label {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  font-size: 0.8125rem;
  color: var(--c-text-muted);
}

.progress-track {
  height: 8px;
  border-radius: 999px;
  background: var(--c-surface-3);
  overflow: hidden;
}

.progress-fill {
  height: 100%;
  background: var(--c-primary);
  border-radius: 999px;
  transition: width 0.2s ease;
}

.progress-fill.indeterminate {
  width: 35%;
  animation: slide 1.2s ease-in-out infinite;
}

@keyframes slide {
  0% { margin-left: -35%; }
  100% { margin-left: 100%; }
}
</style>
