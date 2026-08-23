<script setup lang="ts">
import { onMounted, ref } from 'vue'
import type { Client } from '~/types/models'
import { clientRepository } from '~/database/repositories/clients'
import { useToasts } from '~/composables/useToasts'
import { useConfirm } from '~/composables/useConfirm'
import { useAppStore } from '~/stores/app'
import { formatDateTime } from '~/utils/datetime'
import { fullName } from '~/utils/format'
import AppButton from '~/components/AppButton.vue'
import EmptyState from '~/components/EmptyState.vue'

useHead({ title: 'Корзина — Dentora' })

const toasts = useToasts()
const { confirm } = useConfirm()
const app = useAppStore()

const items = ref<Client[]>([])
const loading = ref(true)

async function load(): Promise<void> {
  loading.value = true
  try {
    items.value = await clientRepository().search({ onlyDeleted: true, sort: 'updatedAt', direction: 'desc' })
  } catch (error) {
    toasts.error(error, 'trash.load')
  } finally {
    loading.value = false
  }
}

async function restore(client: Client): Promise<void> {
  try {
    await clientRepository().restore(client.id)
    toasts.success('Клиент восстановлен')
    await load()
    await app.refreshCounts()
  } catch (error) {
    toasts.error(error, 'trash.restore')
  }
}

async function destroy(client: Client): Promise<void> {
  const ok = await confirm({
    title: 'Удалить навсегда?',
    message: `${fullName(client)} и все связанные работы и файлы будут удалены без возможности восстановления.`,
    confirmLabel: 'Удалить навсегда',
    danger: true,
  })
  if (!ok) return

  try {
    await clientRepository().destroy(client.id)
    toasts.success('Удалено навсегда')
    await load()
    await app.refreshAll()
  } catch (error) {
    toasts.error(error, 'trash.destroy')
  }
}

onMounted(load)
</script>

<template>
  <div class="page page-narrow">
    <header class="page-header">
      <div class="page-title">
        <NuxtLink to="/settings" class="back-link">&lsaquo; Настройки</NuxtLink>
        <h1>Корзина</h1>
        <p class="page-subtitle">Удалённые клиенты можно восстановить</p>
      </div>
    </header>

    <p v-if="loading" class="muted small">Загружаем…</p>

    <EmptyState
      v-else-if="!items.length"
      icon="&#128465;"
      title="Корзина пуста"
      description="Удалённые клиенты будут появляться здесь."
    />

    <ul v-else class="list">
      <li v-for="client in items" :key="client.id" class="row-item">
        <div class="body">
          <span class="strong truncate">{{ fullName(client) }}</span>
          <span class="tiny muted">Удалён: {{ formatDateTime(client.deletedAt) }}</span>
        </div>
        <div class="row">
          <AppButton size="sm" @click="restore(client)">Восстановить</AppButton>
          <AppButton size="sm" variant="ghost" @click="destroy(client)">Удалить</AppButton>
        </div>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.page-narrow { max-width: 720px; }


.list {
  list-style: none;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.row-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px;
  border: 1px solid var(--c-border);
  border-radius: var(--radius);
  background: var(--c-surface);
  min-height: 60px;
}

.body {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

@media (max-width: 520px) {
  .row-item { flex-direction: column; align-items: stretch; }
  .row-item .row { justify-content: flex-end; }
}
</style>
