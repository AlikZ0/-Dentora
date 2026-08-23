<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useAppStore } from '~/stores/app'
import { workRepository } from '~/database/repositories/works'
import { clientRepository } from '~/database/repositories/clients'
import { formatDateLong, formatDateTime, todayIso } from '~/utils/datetime'
import { formatBytes, formatNumber, fullName } from '~/utils/format'
import type { Client, Work } from '~/types/models'
import AppButton from '~/components/AppButton.vue'
import BackupReminder from '~/components/BackupReminder.vue'
import EmptyState from '~/components/EmptyState.vue'
import StatCard from '~/components/StatCard.vue'

useHead({ title: 'Dentora — главная' })

const app = useAppStore()
const recent = ref<{ work: Work; client?: Client }[]>([])

const today = computed(() => formatDateLong(todayIso()))

async function loadRecent(): Promise<void> {
  const works = await workRepository().recent(5)
  const clients = await clientRepository().getMany([...new Set(works.map((w) => w.clientId))])
  const byId = new Map(clients.map((c) => [c.id, c]))
  recent.value = works.map((work) => ({ work, client: byId.get(work.clientId) }))
}

onMounted(async () => {
  await app.refreshAll()
  await app.evaluateReminder()
  await loadRecent()
})
</script>

<template>
  <div class="page">
    <BackupReminder />

    <header class="page-header">
      <div class="page-title">
        <h1>Сегодня</h1>
        <p class="page-subtitle">{{ today }}</p>
      </div>
      <span v-if="!app.online" class="offline-badge">Офлайн</span>
    </header>

    <section class="grid-auto" aria-label="Статистика">
      <StatCard label="Клиентов" :value="formatNumber(app.counts.clients)" to="/clients" />
      <StatCard label="Работ" :value="formatNumber(app.counts.works)" />
      <StatCard
        label="Файлов"
        :value="formatNumber(app.counts.files)"
        :hint="formatBytes(app.counts.storageUsed)"
      />
      <StatCard
        label="Backup сегодня"
        :value="app.backedUpToday ? '✓ Создан' : 'Нет'"
        :tone="app.backedUpToday ? 'success' : 'warning'"
        :hint="
          app.backupStats.lastExportAt
            ? formatDateTime(app.backupStats.lastExportAt)
            : 'Ещё не создавался'
        "
        to="/backup"
      />
    </section>

    <section class="card quick" aria-label="Быстрые действия">
      <p class="card-title">Быстрые действия</p>
      <div class="quick-actions">
        <AppButton variant="primary" @click="navigateTo('/clients/new')">+ Новый клиент</AppButton>
        <AppButton variant="secondary" @click="navigateTo('/backup?action=export')">
          Экспорт
        </AppButton>
        <AppButton variant="secondary" @click="navigateTo('/backup?action=import')">
          Импорт
        </AppButton>
      </div>
    </section>

    <section class="card" aria-label="Последние работы">
      <p class="card-title">Последние работы</p>

      <EmptyState
        v-if="!recent.length"
        icon="&#128203;"
        title="Пока нет ни одной работы"
        description="Добавьте клиента и запишите выполненную работу — всё сохранится на этом устройстве."
      >
        <AppButton variant="primary" @click="navigateTo('/clients/new')">
          Добавить клиента
        </AppButton>
      </EmptyState>

      <ul v-else class="recent-list">
        <li v-for="entry in recent" :key="entry.work.id">
          <NuxtLink :to="`/clients/${entry.work.clientId}`" class="recent-item">
            <span class="recent-body">
              <span class="strong truncate">{{ entry.work.title }}</span>
              <span class="small muted truncate">
                {{ entry.client ? fullName(entry.client) : 'Клиент удалён' }}
              </span>
            </span>
            <span class="tiny faint numeric">{{ formatDateLong(entry.work.date) }}</span>
          </NuxtLink>
        </li>
      </ul>
    </section>

    <p class="privacy tiny faint">
      Все данные хранятся только в этом браузере. Ничего не отправляется на серверы.
    </p>
  </div>
</template>

<style scoped>
.offline-badge {
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--c-warning);
  background: var(--c-warning-soft);
  padding: 4px 10px;
  border-radius: 999px;
}

.quick {
  margin-top: 16px;
}

.quick-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.quick-actions :deep(.btn) {
  flex: 1 1 150px;
}

.card + .card {
  margin-top: 16px;
}

.recent-list {
  list-style: none;
  padding: 0;
  display: flex;
  flex-direction: column;
}

.recent-item {
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: var(--touch);
  padding: 10px 4px;
  color: inherit;
  border-bottom: 1px solid var(--c-border);
}

.recent-list li:last-child .recent-item {
  border-bottom: 0;
}

.recent-body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.privacy {
  text-align: center;
  margin-top: 20px;
}
</style>
