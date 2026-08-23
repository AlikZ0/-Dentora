<script setup lang="ts">
defineProps<{
  label: string
  hint?: string
  error?: string
  required?: boolean
  inputId?: string
}>()
</script>

<template>
  <div class="field">
    <label class="field-label" :for="inputId">
      {{ label }}
      <span v-if="required" class="field-required" aria-hidden="true">*</span>
    </label>
    <slot />
    <p v-if="error" class="field-error">{{ error }}</p>
    <p v-else-if="hint" class="field-hint">{{ hint }}</p>
  </div>
</template>

<style scoped>
.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.field-label {
  font-size: 0.875rem;
  font-weight: 550;
  color: var(--c-text-muted);
}

.field-required { color: var(--c-danger); }

.field-hint {
  font-size: 0.8125rem;
  color: var(--c-text-faint);
}

.field-error {
  font-size: 0.8125rem;
  color: var(--c-danger);
}

.field :deep(input),
.field :deep(textarea),
.field :deep(select) {
  width: 100%;
  min-height: var(--touch);
  padding: 10px 12px;
  border: 1px solid var(--c-border-strong);
  border-radius: var(--radius);
  background: var(--c-surface);
  color: var(--c-text);
  /* 16 px keeps iOS Safari from zooming the viewport on focus. */
  font-size: 16px;
  transition: border-color 0.15s, box-shadow 0.15s;
  -webkit-appearance: none;
  appearance: none;
}

.field :deep(textarea) {
  min-height: 96px;
  resize: vertical;
  line-height: 1.5;
}

.field :deep(input:focus),
.field :deep(textarea:focus),
.field :deep(select:focus) {
  outline: none;
  border-color: var(--c-primary);
  box-shadow: 0 0 0 3px var(--c-primary-soft);
}

.field :deep(input::placeholder),
.field :deep(textarea::placeholder) {
  color: var(--c-text-faint);
}

/* Safari renders date inputs at their intrinsic width otherwise. */
.field :deep(input[type='date']) {
  min-width: 0;
}
</style>
