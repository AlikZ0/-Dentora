<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import type { Client } from '~/types/models'
import type { ClientDraft } from '~/database/repositories/clients'
import { todayIso } from '~/utils/datetime'
import AppButton from './AppButton.vue'
import AppField from './AppField.vue'

const props = defineProps<{ client?: Client; saving?: boolean }>()
const emit = defineEmits<{ submit: [draft: ClientDraft]; cancel: [] }>()

const form = reactive<ClientDraft>({
  firstName: props.client?.firstName ?? '',
  lastName: props.client?.lastName ?? '',
  arrivalDate: props.client?.arrivalDate ?? todayIso(),
  phone: props.client?.phone ?? '',
  email: props.client?.email ?? '',
  notes: props.client?.notes ?? '',
})

const touched = ref(false)

const errors = computed(() => ({
  firstName: !form.firstName.trim() ? 'Укажите имя' : '',
  lastName: !form.lastName.trim() ? 'Укажите фамилию' : '',
  email:
    form.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email) ? 'Проверьте адрес почты' : '',
}))

const valid = computed(() => !Object.values(errors.value).some(Boolean))

function submit(): void {
  touched.value = true
  if (!valid.value) return
  emit('submit', { ...form })
}
</script>

<template>
  <form class="stack" novalidate @submit.prevent="submit">
    <div class="grid-2">
      <AppField label="Фамилия" required :error="touched ? errors.lastName : ''" input-id="lastName">
        <input
          id="lastName"
          v-model="form.lastName"
          type="text"
          autocomplete="family-name"
          enterkeyhint="next"
          required
        />
      </AppField>

      <AppField label="Имя" required :error="touched ? errors.firstName : ''" input-id="firstName">
        <input
          id="firstName"
          v-model="form.firstName"
          type="text"
          autocomplete="given-name"
          enterkeyhint="next"
          required
        />
      </AppField>
    </div>

    <AppField label="Дата прибытия" input-id="arrivalDate">
      <input id="arrivalDate" v-model="form.arrivalDate" type="date" />
    </AppField>

    <div class="grid-2">
      <AppField label="Телефон" hint="Необязательно" input-id="phone">
        <!-- `tel` gives phones a numeric keypad without breaking + and spaces. -->
        <input id="phone" v-model="form.phone" type="tel" autocomplete="tel" inputmode="tel" />
      </AppField>

      <AppField label="E-mail" hint="Необязательно" :error="touched ? errors.email : ''" input-id="email">
        <input
          id="email"
          v-model="form.email"
          type="email"
          autocomplete="email"
          inputmode="email"
          autocapitalize="off"
          spellcheck="false"
        />
      </AppField>
    </div>

    <AppField label="Заметки" input-id="notes">
      <textarea id="notes" v-model="form.notes" rows="4" />
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

@media (min-width: 560px) {
  .grid-2 { grid-template-columns: 1fr 1fr; }
}

.actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
  padding-top: 4px;
}

@media (max-width: 480px) {
  .actions { flex-direction: column-reverse; }
  .actions :deep(.btn) { width: 100%; }
}
</style>
