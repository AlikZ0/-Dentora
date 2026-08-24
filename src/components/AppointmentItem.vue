<script setup lang="ts">
import { computed } from 'vue'
import type { Appointment, Client } from '~/types/models'
import { APPOINTMENT_STATUS_LABELS } from '~/types/models'
import { fullName } from '~/utils/format'
import { describeRelative, formatTime, localDateTimeToDate } from '~/utils/schedule'

const props = defineProps<{
  appointment: Appointment
  client?: Client
  /** Hide the client name when the list is already scoped to one client. */
  hideClient?: boolean
}>()

defineEmits<{ edit: []; status: [status: Appointment['status']]; remove: [] }>()

const isPast = computed(() => {
  const at = localDateTimeToDate(props.appointment.at)
  return Boolean(at && at.getTime() < Date.now())
})

const soon = computed(
  () => props.appointment.status === 'scheduled' && !isPast.value,
)
</script>

<template>
  <li class="visit" :class="[`status-${appointment.status}`, { 'is-past': isPast }]">
    <span class="time numeric">{{ formatTime(appointment.at) }}</span>

    <div class="body">
      <div class="line">
        <NuxtLink
          v-if="client && !hideClient"
          :to="`/clients/${client.id}`"
          class="who truncate"
        >
          {{ fullName(client) }}
        </NuxtLink>
        <span v-else-if="!hideClient" class="who faint">Клиент удалён</span>
        <span v-else class="who truncate">{{ appointment.title }}</span>

        <span v-if="appointment.status !== 'scheduled'" class="badge">
          {{ APPOINTMENT_STATUS_LABELS[appointment.status] }}
        </span>
      </div>

      <p class="meta">
        <template v-if="!hideClient">{{ appointment.title }} · </template>
        {{ appointment.durationMinutes }} мин
        <template v-if="soon"> · {{ describeRelative(appointment.at) }}</template>
      </p>

      <p v-if="appointment.notes" class="notes break-word">{{ appointment.notes }}</p>
    </div>

    <div class="actions">
      <button
        v-if="appointment.status === 'scheduled'"
        class="act"
        title="Отметить как состоявшийся"
        aria-label="Отметить как состоявшийся"
        @click="$emit('status', 'done')"
      >
        &#10003;
      </button>
      <button class="act" aria-label="Изменить визит" @click="$emit('edit')">&#9998;</button>
      <button class="act danger" aria-label="Удалить визит" @click="$emit('remove')">&#10005;</button>
    </div>
  </li>
</template>

<style scoped>
.visit {
  display: flex;
  align-items: flex-start;
  flex-wrap: wrap;
  gap: 10px;
  padding: 10px 12px;
  border: 1px solid var(--c-border);
  border-left: 3px solid var(--c-primary);
  border-radius: var(--radius);
  background: var(--c-surface);
  min-height: 56px;
}

.is-past,
.status-done,
.status-cancelled,
.status-noshow {
  border-left-color: var(--c-border-strong);
}
.status-done { border-left-color: var(--c-success); }
.status-cancelled,
.status-noshow { opacity: 0.65; }

.time {
  font-weight: 650;
  font-size: 0.9375rem;
  min-width: 44px;
  padding-top: 1px;
}

.body {
  flex: 1;
  min-width: 0;
}

.line {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.who {
  font-weight: 550;
  color: var(--c-text);
  min-width: 0;
}

.badge {
  font-size: 0.6875rem;
  font-weight: 600;
  padding: 1px 7px;
  border-radius: 999px;
  background: var(--c-surface-3);
  color: var(--c-text-muted);
  flex-shrink: 0;
}

.meta {
  font-size: 0.8125rem;
  color: var(--c-text-muted);
  /* Title, duration and "in N hours" is long; wrapping beats truncating. */
  overflow-wrap: anywhere;
}

.notes {
  font-size: 0.8125rem;
  color: var(--c-text-faint);
  margin-top: 2px;
}

.actions {
  display: flex;
  gap: 2px;
  flex-shrink: 0;
}

/*
 * Three 44 px targets eat a third of a phone screen, which was clipping the
 * client's name. Below this width the actions take a row of their own so the
 * name and the visit title get the full line.
 */
@media (max-width: 560px) {
  .actions {
    flex: 1 0 100%;
    justify-content: flex-end;
    margin-top: -4px;
    border-top: 1px solid var(--c-border);
    padding-top: 2px;
  }
}

.act {
  width: var(--touch);
  height: var(--touch);
  display: grid;
  place-items: center;
  border-radius: var(--radius-sm);
  color: var(--c-text-muted);
  font-size: 1rem;
}
.act:hover { background: var(--c-surface-2); color: var(--c-text); }
.act.danger:hover { color: var(--c-danger); }
</style>
