<script setup lang="ts">
defineProps<{ icon?: string; title: string; description?: string }>()
</script>

<template>
  <div class="empty">
    <div v-if="icon" class="empty-icon" aria-hidden="true">{{ icon }}</div>
    <p class="empty-title">{{ title }}</p>
    <p v-if="description" class="empty-description">{{ description }}</p>
    <div v-if="$slots.default" class="empty-actions"><slot /></div>
  </div>
</template>

<style scoped>
.empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: 6px;
  padding: 40px 20px;
  color: var(--c-text-muted);
}

.empty-icon {
  font-size: 2.25rem;
  line-height: 1;
  margin-bottom: 4px;
  opacity: 0.7;
}

.empty-title {
  font-weight: 600;
  color: var(--c-text);
}

.empty-description {
  font-size: 0.875rem;
  max-width: 36ch;
}

.empty-actions {
  margin-top: 12px;
}
</style>
