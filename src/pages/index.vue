<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useAppStore } from '~/stores/app'
import { workRepository } from '~/database/repositories/works'
import { clientRepository } from '~/database/repositories/clients'
import { appointmentRepository } from '~/database/repositories/appointments'
import { formatDateLong, formatDateTime, todayIso } from '~/utils/datetime'
import { formatBytes, formatNumber, fullName } from '~/utils/format'
import type { Appointment, Client, Work } from '~/types/models'
import AppButton from '~/components/AppButton.vue'
import BackupReminder from '~/components/BackupReminder.vue'
import EmptyState from '~/components/EmptyState.vue'
import StatCard from '~/components/StatCard.vue'
import AppointmentItem from '~/components/AppointmentItem.vue'


useHead({ title: 'Dentora — главная' })

const app = useAppStore()
const recent = ref<{ work: Work; client?: Client }[]>([])
const visitClients = ref<Map<string, Client>>(new Map())

const today = computed(() => formatDateLong(todayIso()))

async function loadRecent(): Promise<void> {
  const works = await workRepository().recent(5)
  const clients = await clientRepository().getMany([...new Set(works.map((w) => w.clientId))])
  const byId = new Map(clients.map((c) => [c.id, c]))
  recent.value = works.map((work) => ({ work, client: byId.get(work.clientId) }))
}

/** Today first, then tomorrow - the two days that actually need attention. */
const agendaGroups = computed(() => {
  const groups: { day: string; items: Appointment[] }[] = []
  if (app.agenda.today.length) groups.push({ day: 'today', items: app.agenda.today })
  if (app.agenda.tomorrow.length) groups.push({ day: 'tomorrow', items: app.agenda.tomorrow })
  return groups
})

async function loadAgendaClients(): Promise<void> {
  const ids = [...app.agenda.today, ...app.agenda.tomorrow].map((a) => a.clientId)
  const list = await clientRepository().getMany([...new Set(ids)])
  visitClients.value = new Map(list.map((c) => [c.id, c]))
}

onMounted(async () => {
  await app.refreshAll()
  await app.evaluateReminder()
  await Promise.all([loadRecent(), loadAgendaClients()])
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
        label="Визитов сегодня"
        :value="formatNumber(app.agenda.today.length)"
        :hint="app.agenda.tomorrow.length ? `Завтра: ${app.agenda.tomorrow.length}` : 'Завтра пусто'"
        to="/schedule"
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

    <section v-if="agendaGroups.length" class="card" aria-label="Ближайшие визиты">
      <div class="section-head">
        <p class="card-title">Ближайшие визиты</p>
        <NuxtLink to="/schedule" class="see-all">Все визиты &rsaquo;</NuxtLink>
      </div>

      <NuxtLink v-if="app.notificationHint" to="/settings" class="notice">
        <span>{{ app.notificationHint }}</span>
        <span aria-hidden="true">&rsaquo;</span>
      </NuxtLink>

      <div v-for="group in agendaGroups" :key="group.day" class="agenda-group">
        <p class="agenda-day">
          {{ group.day === 'today' ? 'Сегодня' : 'Завтра' }}
        </p>
        <ul class="visits">
          <AppointmentItem
            v-for="visit in group.items"
            :key="visit.id"
            :appointment="visit"
            :client="visitClients.get(visit.clientId)"
            @edit="navigateTo('/schedule')"
            @status="navigateTo('/schedule')"
            @remove="navigateTo('/schedule')"
          />
        </ul>
      </div>
    </section>

    <section class="card quick" aria-label="Быстрые действия">
      <p class="card-title">Быстрые действия</p>
      <div class="quick-actions">
        <AppButton variant="primary" @click="navigateTo('/clients/new')">+ Новый клиент</AppButton>
        <AppButton variant="secondary" @click="navigateTo('/schedule')">Запланировать визит</AppButton>
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

.section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 10px;
}
.section-head .card-title { margin-bottom: 0; }

.see-all {
  font-size: 0.8125rem;
  font-weight: 550;
  min-height: 36px;
  display: inline-flex;
  align-items: center;
}

.notice {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 8px 12px;
  border-radius: var(--radius-sm);
  background: var(--c-warning-soft);
  color: var(--c-text);
  font-size: 0.8125rem;
  margin-bottom: 10px;
  min-height: 40px;
}

.agenda-group + .agenda-group { margin-top: 12px; }

.agenda-day {
  font-size: 0.75rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--c-text-faint);
  margin-bottom: 6px;
}

.visits {
  list-style: none;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
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
