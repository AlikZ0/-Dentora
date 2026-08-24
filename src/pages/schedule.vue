<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import type { Appointment, Client } from '~/types/models'
import { appointmentRepository } from '~/database/repositories/appointments'
import { clientRepository } from '~/database/repositories/clients'
import { useToasts } from '~/composables/useToasts'
import { useConfirm } from '~/composables/useConfirm'
import { useAppStore } from '~/stores/app'
import { describeDay, dayKey, startOfLocalDay } from '~/utils/schedule'
import { fullName } from '~/utils/format'
import AppButton from '~/components/AppButton.vue'
import AppModal from '~/components/AppModal.vue'
import AppointmentForm from '~/components/AppointmentForm.vue'
import AppointmentItem from '~/components/AppointmentItem.vue'
import EmptyState from '~/components/EmptyState.vue'

useHead({ title: 'Визиты — Dentora' })

const toasts = useToasts()
const { confirm } = useConfirm()
const app = useAppStore()

const appointments = ref<Appointment[]>([])
const clients = ref<Map<string, Client>>(new Map())
const loading = ref(true)
const scope = ref<'upcoming' | 'past'>('upcoming')

const editor = ref<{ open: boolean; appointment?: Appointment; clientId?: string }>({ open: false })
const saving = ref(false)
const clientPicker = ref('')

async function load(): Promise<void> {
  loading.value = true
  try {
    const all = await appointmentRepository().all()
    const today = startOfLocalDay()
    appointments.value =
      scope.value === 'upcoming'
        ? all.filter((a) => a.at >= today).sort((a, b) => a.at.localeCompare(b.at))
        : all.filter((a) => a.at < today).sort((a, b) => b.at.localeCompare(a.at))

    const list = await clientRepository().getMany([
      ...new Set(appointments.value.map((a) => a.clientId)),
    ])
    clients.value = new Map(list.map((c) => [c.id, c]))
  } catch (error) {
    toasts.error(error, 'schedule.load')
  } finally {
    loading.value = false
  }
}

/** Grouped by local day so the list reads like a diary. */
const grouped = computed(() => {
  const groups = new Map<string, Appointment[]>()
  for (const appointment of appointments.value) {
    const day = appointment.at.slice(0, 10)
    const list = groups.get(day) ?? []
    list.push(appointment)
    groups.set(day, list)
  }
  return [...groups.entries()]
})

const allClients = ref<Client[]>([])

async function openEditor(appointment?: Appointment, clientId?: string): Promise<void> {
  allClients.value = await clientRepository().search({ sort: 'lastName' })
  clientPicker.value = clientId ?? appointment?.clientId ?? allClients.value[0]?.id ?? ''
  editor.value = { open: true, appointment, clientId: clientPicker.value }
}

async function save(draft: {
  at: string
  title: string
  notes: string
  durationMinutes: number
  remindMinutesBefore: number
}): Promise<void> {
  saving.value = true
  try {
    if (editor.value.appointment) {
      await appointmentRepository().update(editor.value.appointment.id, draft)
      toasts.success('Визит обновлён')
    } else {
      if (!clientPicker.value) {
        toasts.errorText('Сначала выберите клиента.')
        return
      }
      await appointmentRepository().create({ clientId: clientPicker.value, ...draft })
      toasts.success('Визит запланирован')
    }
    editor.value = { open: false }
    await load()
    await app.refreshAgenda()
  } catch (error) {
    toasts.error(error, 'schedule.save')
  } finally {
    saving.value = false
  }
}

async function setStatus(appointment: Appointment, status: Appointment['status']): Promise<void> {
  try {
    await appointmentRepository().setStatus(appointment.id, status)
    await load()
    await app.refreshAgenda()
  } catch (error) {
    toasts.error(error, 'schedule.status')
  }
}

async function remove(appointment: Appointment): Promise<void> {
  const ok = await confirm({
    title: 'Удалить визит?',
    message: `«${appointment.title}» будет удалён из расписания.`,
    confirmLabel: 'Удалить',
    danger: true,
  })
  if (!ok) return
  try {
    await appointmentRepository().softDelete(appointment.id)
    toasts.success('Визит удалён')
    await load()
    await app.refreshAgenda()
  } catch (error) {
    toasts.error(error, 'schedule.remove')
  }
}

onMounted(async () => {
  await load()
  await app.refreshNotificationState()
})
</script>

<template>
  <div class="page page-narrow">
    <header class="page-header">
      <div class="page-title">
        <h1>Визиты</h1>
        <p class="page-subtitle">Расписание приёмов и напоминания</p>
      </div>
      <AppButton variant="primary" @click="openEditor()">+ Визит</AppButton>
    </header>

    <!-- Notification status: never let the user assume reminders are on. -->
    <NuxtLink v-if="app.notificationHint" to="/settings" class="notice">
      <span>{{ app.notificationHint }}</span>
      <span aria-hidden="true">&rsaquo;</span>
    </NuxtLink>

    <div class="tabs" role="tablist">
      <button
        class="tab"
        :class="{ 'is-active': scope === 'upcoming' }"
        @click="scope = 'upcoming'; load()"
      >
        Предстоящие
      </button>
      <button
        class="tab"
        :class="{ 'is-active': scope === 'past' }"
        @click="scope = 'past'; load()"
      >
        Прошедшие
      </button>
    </div>

    <p v-if="loading" class="muted small">Загружаем…</p>

    <EmptyState
      v-else-if="!appointments.length && scope === 'upcoming'"
      icon="&#128197;"
      title="Визитов пока нет"
      description="Запланируйте приём — приложение напомнит о нём заранее."
    >
      <AppButton variant="primary" @click="openEditor()">Запланировать визит</AppButton>
    </EmptyState>

    <EmptyState v-else-if="!appointments.length" icon="&#128197;" title="Прошедших визитов нет" />

    <section v-for="[day, items] in grouped" :key="day" class="day">
      <h2 class="day-title">
        {{ describeDay(day) }}
        <span class="day-count faint">{{ items.length }}</span>
      </h2>
      <ul class="visits">
        <AppointmentItem
          v-for="item in items"
          :key="item.id"
          :appointment="item"
          :client="clients.get(item.clientId)"
          @edit="openEditor(item)"
          @status="setStatus(item, $event)"
          @remove="remove(item)"
        />
      </ul>
    </section>

    <AppModal
      :open="editor.open"
      :title="editor.appointment ? 'Изменить визит' : 'Новый визит'"
      @close="editor = { open: false }"
    >
      <div class="stack">
        <div v-if="!editor.appointment" class="field">
          <label class="field-label" for="visitClient">Клиент</label>
          <select id="visitClient" v-model="clientPicker" class="client-select">
            <option v-if="!allClients.length" value="">Сначала добавьте клиента</option>
            <option v-for="client in allClients" :key="client.id" :value="client.id">
              {{ fullName(client) }}
            </option>
          </select>
        </div>

        <AppointmentForm
          :key="editor.appointment?.id ?? 'new'"
          :appointment="editor.appointment"
          :saving="saving"
          :default-remind-minutes-before="app.settings.defaultRemindMinutesBefore"
          :notifications-active="app.notificationsActive"
          @submit="save"
          @cancel="editor = { open: false }"
        />
      </div>
    </AppModal>
  </div>
</template>

<style scoped>
.page-narrow { max-width: 720px; }

.notice {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 10px 14px;
  border-radius: var(--radius);
  background: var(--c-warning-soft);
  color: var(--c-text);
  font-size: 0.875rem;
  margin-bottom: 12px;
  min-height: var(--touch);
}

.tabs {
  display: flex;
  gap: 6px;
  margin-bottom: 14px;
}

.tab {
  min-height: 38px;
  padding: 0 14px;
  border-radius: 999px;
  border: 1px solid var(--c-border-strong);
  background: var(--c-surface);
  font-size: 0.875rem;
  font-weight: 550;
  color: var(--c-text-muted);
}

.tab.is-active {
  background: var(--c-primary-soft);
  border-color: var(--c-primary);
  color: var(--c-primary);
}

.day + .day { margin-top: 18px; }

.day-title {
  display: flex;
  align-items: baseline;
  gap: 8px;
  font-size: 0.875rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--c-text-faint);
  margin-bottom: 8px;
}

.day-count { font-size: 0.8125rem; }

.visits {
  list-style: none;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

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

.client-select {
  width: 100%;
  min-height: var(--touch);
  padding: 10px 12px;
  border: 1px solid var(--c-border-strong);
  border-radius: var(--radius);
  background: var(--c-surface);
  font-size: 16px;
  -webkit-appearance: none;
  appearance: none;
}
</style>
