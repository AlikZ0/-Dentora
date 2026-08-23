<script setup lang="ts">
import type { Client } from '~/types/models'
import { formatDate } from '~/utils/datetime'
import { fullName, initials } from '~/utils/format'

defineProps<{ client: Client; workCount?: number; fileCount?: number }>()
</script>

<template>
  <NuxtLink :to="`/clients/${client.id}`" class="item">
    <span class="avatar" aria-hidden="true">{{ initials(client) }}</span>
    <span class="body">
      <span class="name truncate">{{ fullName(client) }}</span>
      <span class="meta truncate">
        Прибытие: {{ formatDate(client.arrivalDate) }}
        <template v-if="workCount"> · работ: {{ workCount }}</template>
        <template v-if="fileCount"> · файлов: {{ fileCount }}</template>
      </span>
    </span>
    <span class="chevron" aria-hidden="true">&rsaquo;</span>
  </NuxtLink>
</template>

<style scoped>
.item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  border-radius: var(--radius);
  background: var(--c-surface);
  border: 1px solid var(--c-border);
  color: inherit;
  /* Comfortably above the 44 px touch floor. */
  min-height: 60px;
  -webkit-tap-highlight-color: transparent;
}

.item:hover { border-color: var(--c-border-strong); }
.item:active { background: var(--c-surface-2); }

.avatar {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  background: var(--c-primary-soft);
  color: var(--c-primary);
  display: grid;
  place-items: center;
  font-weight: 650;
  font-size: 0.875rem;
  flex-shrink: 0;
}

.body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.name { font-weight: 550; }

.meta {
  font-size: 0.8125rem;
  color: var(--c-text-muted);
}

.chevron {
  color: var(--c-text-faint);
  font-size: 1.35rem;
  line-height: 1;
  flex-shrink: 0;
}
</style>
