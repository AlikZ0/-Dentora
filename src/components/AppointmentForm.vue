<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import type { Appointment } from '~/types/models'
import { REMINDER_CHOICES } from '~/types/models'
import { combineDateAndTime, describeLeadTime, localDateTimeToDate, splitDateTime } from '~/utils/schedule'
import { dayKey } from '~/utils/schedule'
import AppButton from './AppButton.vue'
import AppField from './AppField.vue'

const props = defineProps<{
  appointment?: Appointment
  saving?: boolean
  /** Default lead time from settings, used for new visits. */
  defaultRemindMinutesBefore?: number
  notificationsActive?: boolean
}>()

const emit = defineEmits<{
  submit: [draft: { at: string; title: string; notes: string; durationMinutes: number; remindMinutesBefore: number }]
  cancel: []
}>()

const initial = props.appointment
  ? splitDateTime(props.appointment.at)
  : { day: dayKey(1), time: '10:00' } // new visits default to tomorrow morning

const form = reactive({
  day: initial.day,
  time: initial.time,
  title: props.appointment?.title ?? 'Визит',
  notes: props.appointment?.notes ?? '',
  durationMinutes: props.appointment?.durationMinutes ?? 30,
  remindMinutesBefore:
    props.appointment?.remindMinutesBefore ?? props.defaultRemindMinutesBefore ?? 60,
})

const touched = ref(false)

const at = computed(() => combineDateAndTime(form.day, form.time))
const parsed = computed(() => localDateTimeToDate(at.value))

const errors = computed(() => ({
  when: !parsed.value ? 'Укажите дату и время визита' : '',
  title: !form.title.trim() ? 'Укажите название' : '',
}))

const valid = computed(() => !Object.values(errors.value).some(Boolean))

/** Warn, but never block: recording a past visit is legitimate. */
const inThePast = computed(() => Boolean(parsed.value && parsed.value.getTime() < Date.now()))

const reminderAt = computed(() => {
  if (!parsed.value || form.remindMinutesBefore <= 0) return null
  return new Date(parsed.value.getTime() - form.remindMinutesBefore * 60_000)
})

function submit(): void {
  touched.value = true
  if (!valid.value) return
  emit('submit', {
    at: at.value,
    title: form.title,
    notes: form.notes,
    durationMinutes: Number(form.durationMinutes) || 30,
    remindMinutesBefore: Number(form.remindMinutesBefore),
  })
}
</script>

<template>
  <form class="stack" novalidate @submit.prevent="submit">
    <div class="grid-2">
      <AppField label="Дата" required :error="touched ? errors.when : ''" input-id="visitDay">
        <input id="visitDay" v-model="form.day" type="date" required />
      </AppField>

      <AppField label="Время" required input-id="visitTime">
        <input id="visitTime" v-model="form.time" type="time" step="300" required />
      </AppField>
    </div>

    <p v-if="inThePast" class="hint hint-warn">
      Это время уже прошло — напоминание не сработает, но визит сохранится в истории.
    </p>

    <AppField label="Название" required :error="touched ? errors.title : ''" input-id="visitTitle">
      <input id="visitTitle" v-model="form.title" type="text" placeholder="Например: осмотр" required />
    </AppField>

    <div class="grid-2">
      <AppField label="Длительность" input-id="visitDuration">
        <select id="visitDuration" v-model.number="form.durationMinutes">
          <option :value="15">15 минут</option>
          <option :value="30">30 минут</option>
          <option :value="45">45 минут</option>
          <option :value="60">1 час</option>
          <option :value="90">1,5 часа</option>
          <option :value="120">2 часа</option>
        </select>
      </AppField>

      <AppField label="Напомнить" input-id="visitRemind">
        <select id="visitRemind" v-model.number="form.remindMinutesBefore">
          <option v-for="choice in REMINDER_CHOICES" :key="choice.value" :value="choice.value">
            {{ choice.label }}
          </option>
        </select>
      </AppField>
    </div>

    <p v-if="reminderAt && !inThePast" class="hint">
      Напоминание {{ describeLeadTime(form.remindMinutesBefore) }} до визита.
    </p>

    <p v-if="notificationsActive === false" class="hint hint-warn">
      Уведомления сейчас выключены. Визит сохранится, но напоминание не придёт —
      включить можно в Настройках.
    </p>

    <AppField label="Заметки" input-id="visitNotes">
      <textarea id="visitNotes" v-model="form.notes" rows="2" />
    </AppField>

    <div class="actions">
      <AppButton variant="ghost" @click="emit('cancel')">Отмена</AppButton>
      <AppButton type="submit" variant="primary" :loading="saving">Сохранить</AppButton>
    </div>
  </form>
</template>

<style scoped>
.grid-2 {
  display: grid;
  gap: 12px;
  grid-template-columns: 1fr;
}

@media (min-width: 480px) {
  .grid-2 { grid-template-columns: 1fr 1fr; }
}

.hint {
  font-size: 0.8125rem;
  color: var(--c-text-muted);
}

.hint-warn {
  padding: 8px 10px;
  border-radius: var(--radius-sm);
  background: var(--c-warning-soft);
  color: var(--c-text);
}

.actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
}

@media (max-width: 480px) {
  .actions { flex-direction: column-reverse; }
  .actions :deep(.btn) { width: 100%; }
}
</style>
