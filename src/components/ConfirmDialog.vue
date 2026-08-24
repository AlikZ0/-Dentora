<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useConfirm } from '~/composables/useConfirm'
import AppButton from './AppButton.vue'
import AppModal from './AppModal.vue'

const { pending, settle } = useConfirm()
const typed = ref('')

watch(pending, () => {
  typed.value = ''
})

const phraseSatisfied = computed(() => {
  const phrase = pending.value?.requirePhrase
  return !phrase || typed.value.trim() === phrase
})
</script>

<template>
  <AppModal
    :open="Boolean(pending)"
    :title="pending?.title ?? ''"
    :sheet="true"
    :backdrop-dismiss="!pending?.danger"
    @close="settle(false)"
  >
    <div class="stack-sm stack">
      <p v-if="pending?.message" class="confirm-message">{{ pending.message }}</p>

      <ul v-if="pending?.details?.length" class="confirm-details">
        <li v-for="line in pending.details" :key="line">{{ line }}</li>
      </ul>

      <div v-if="pending?.requirePhrase" class="stack-sm stack">
        <label class="confirm-phrase-label" for="confirm-phrase">
          Для подтверждения введите
          <code>{{ pending.requirePhrase }}</code>
        </label>
        <input
          id="confirm-phrase"
          v-model="typed"
          class="confirm-phrase-input"
          type="text"
          autocomplete="off"
          autocapitalize="off"
          spellcheck="false"
        />
      </div>
    </div>

    <template #footer>
      <AppButton variant="ghost" @click="settle(false)">
        {{ pending?.cancelLabel ?? 'Отмена' }}
      </AppButton>
      <AppButton
        :variant="pending?.danger ? 'danger' : 'primary'"
        :disabled="!phraseSatisfied"
        @click="settle(true)"
      >
        {{ pending?.confirmLabel ?? 'Подтвердить' }}
      </AppButton>
    </template>
  </AppModal>
</template>

<style scoped>
.confirm-message {
  color: var(--c-text-muted);
  line-height: 1.55;
}

.confirm-details {
  margin: 0;
  padding: 12px 12px 12px 30px;
  background: var(--c-warning-soft);
  color: var(--c-text);
  border-radius: var(--radius);
  font-size: 0.875rem;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.confirm-phrase-label {
  font-size: 0.875rem;
  color: var(--c-text-muted);
}

.confirm-phrase-label code {
  font-family: var(--font-mono);
  background: var(--c-surface-3);
  padding: 1px 6px;
  border-radius: 4px;
  font-size: 0.875em;
}

.confirm-phrase-input {
  width: 100%;
  min-height: var(--touch);
  padding: 10px 12px;
  border: 1px solid var(--c-border-strong);
  border-radius: var(--radius);
  background: var(--c-surface);
  font-size: 16px;
}
</style>
