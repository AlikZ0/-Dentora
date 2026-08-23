<script setup lang="ts">
import { useAppStore } from '~/stores/app'
import { formatDateTime } from '~/utils/datetime'

const app = useAppStore()
</script>

<template>
  <Transition name="reminder">
    <aside v-if="app.reminderVisible" class="reminder" role="status">
      <div class="reminder-body">
        <p class="reminder-title">Сегодня ещё не создан backup</p>
        <p class="reminder-sub">
          Последний:
          {{ app.backupStats.lastExportAt ? formatDateTime(app.backupStats.lastExportAt) : 'никогда' }}
        </p>
      </div>
      <div class="reminder-actions">
        <NuxtLink to="/backup" class="reminder-cta" @click="app.dismissReminder()">
          Экспортировать
        </NuxtLink>
        <button class="reminder-close" aria-label="Скрыть" @click="app.dismissReminder()">
          &#10005;
        </button>
      </div>
    </aside>
  </Transition>
</template>

<style scoped>
.reminder {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 14px;
  background: var(--c-warning-soft);
  border: 1px solid color-mix(in srgb, var(--c-warning) 32%, transparent);
  border-radius: var(--radius-lg);
  margin-bottom: 16px;
}

.reminder-body {
  flex: 1;
  min-width: 0;
}

.reminder-title {
  font-weight: 600;
  font-size: 0.9375rem;
}

.reminder-sub {
  font-size: 0.8125rem;
  color: var(--c-text-muted);
}

.reminder-actions {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
}

.reminder-cta {
  min-height: 36px;
  display: inline-flex;
  align-items: center;
  padding: 0 12px;
  border-radius: var(--radius-sm);
  background: var(--c-surface);
  color: var(--c-text);
  font-size: 0.875rem;
  font-weight: 600;
  border: 1px solid var(--c-border-strong);
}

.reminder-close {
  width: var(--touch);
  height: var(--touch);
  display: grid;
  place-items: center;
  color: var(--c-text-muted);
  border-radius: 50%;
}

.reminder-enter-active,
.reminder-leave-active {
  transition: opacity 0.2s, transform 0.2s;
}
.reminder-enter-from,
.reminder-leave-to {
  opacity: 0;
  transform: translateY(-6px);
}

@media (max-width: 420px) {
  .reminder { flex-wrap: wrap; }
  .reminder-actions { width: 100%; justify-content: flex-end; }
}
</style>
