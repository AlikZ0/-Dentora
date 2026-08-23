<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import type { Work } from '~/types/models'
import { todayIso } from '~/utils/datetime'
import AppButton from './AppButton.vue'
import AppField from './AppField.vue'

const props = defineProps<{ work?: Work; saving?: boolean }>()
const emit = defineEmits<{
  submit: [draft: { date: string; title: string; description: string; notes: string }]
  cancel: []
}>()

const form = reactive({
  date: props.work?.date ?? todayIso(),
  title: props.work?.title ?? '',
  description: props.work?.description ?? '',
  notes: props.work?.notes ?? '',
})

const touched = ref(false)
const titleError = computed(() => (!form.title.trim() ? 'Укажите название работы' : ''))

function submit(): void {
  touched.value = true
  if (titleError.value) return
  emit('submit', { ...form })
}
</script>

<template>
  <form class="stack" novalidate @submit.prevent="submit">
    <AppField label="Название" required :error="touched ? titleError : ''" input-id="workTitle">
      <input id="workTitle" v-model="form.title" type="text" placeholder="Например: лечение кариеса" required />
    </AppField>

    <AppField label="Дата" input-id="workDate">
      <input id="workDate" v-model="form.date" type="date" />
    </AppField>

    <AppField label="Описание" input-id="workDescription">
      <textarea id="workDescription" v-model="form.description" rows="3" />
    </AppField>

    <AppField label="Заметки" input-id="workNotes">
      <textarea id="workNotes" v-model="form.notes" rows="2" />
    </AppField>

    <div class="actions">
      <AppButton variant="ghost" @click="emit('cancel')">Отмена</AppButton>
      <AppButton type="submit" variant="primary" :loading="saving">Сохранить</AppButton>
    </div>
  </form>
</template>

<style scoped>
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
