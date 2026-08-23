<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import type { Client } from '~/types/models'
import type { ClientSort } from '~/database/repositories/clients'
import { clientRepository } from '~/database/repositories/clients'
import { workRepository } from '~/database/repositories/works'
import { fileRepository } from '~/database/repositories/files'
import { useToasts } from '~/composables/useToasts'
import { formatNumber } from '~/utils/format'
import AppButton from '~/components/AppButton.vue'
import ClientListItem from '~/components/ClientListItem.vue'
import EmptyState from '~/components/EmptyState.vue'

useHead({ title: 'Клиенты — Dentora' })

const toasts = useToasts()

const clients = ref<Client[]>([])
const workCounts = ref<Record<string, number>>({})
const fileCounts = ref<Record<string, number>>({})
const loading = ref(true)

const search = ref('')
const sort = ref<ClientSort>('lastName')
const direction = ref<'asc' | 'desc'>('asc')
const from = ref('')
const to = ref('')
const filtersOpen = ref(false)

const filtersActive = computed(() => Boolean(from.value || to.value))

async function load(): Promise<void> {
  loading.value = true
  try {
    clients.value = await clientRepository().search({
      search: search.value,
      sort: sort.value,
      direction: direction.value,
      from: from.value || undefined,
      to: to.value || undefined,
    })

    // Counts come from the metadata stores only - no file bytes are touched.
    const [works, files] = await Promise.all([workRepository().all(), fileRepository().all()])
    const w: Record<string, number> = {}
    for (const work of works) w[work.clientId] = (w[work.clientId] ?? 0) + 1
    const f: Record<string, number> = {}
    for (const file of files) f[file.clientId] = (f[file.clientId] ?? 0) + 1
    workCounts.value = w
    fileCounts.value = f
  } catch (error) {
    toasts.error(error, 'clients.load')
  } finally {
    loading.value = false
  }
}

let debounce: ReturnType<typeof setTimeout> | undefined
watch(search, () => {
  clearTimeout(debounce)
  debounce = setTimeout(load, 180)
})
watch([sort, direction, from, to], load)

function resetFilters(): void {
  from.value = ''
  to.value = ''
}

onMounted(load)
</script>

<template>
  <div class="page">
    <header class="page-header">
      <div class="page-title">
        <h1>Клиенты</h1>
        <p class="page-subtitle">{{ formatNumber(clients.length) }} в списке</p>
      </div>
      <AppButton variant="primary" @click="navigateTo('/clients/new')">+ Клиент</AppButton>
    </header>

    <div class="toolbar">
      <input
        v-model="search"
        class="search"
        type="search"
        placeholder="Поиск по имени, телефону, заметкам"
        autocapitalize="off"
        spellcheck="false"
        enterkeyhint="search"
        aria-label="Поиск клиентов"
      />

      <div class="toolbar-row">
        <select v-model="sort" class="control" aria-label="Сортировка">
          <option value="lastName">По фамилии</option>
          <option value="arrivalDate">По дате прибытия</option>
          <option value="createdAt">По дате добавления</option>
          <option value="updatedAt">По дате изменения</option>
        </select>

        <button
          class="control control-btn"
          :aria-label="direction === 'asc' ? 'По возрастанию' : 'По убыванию'"
          @click="direction = direction === 'asc' ? 'desc' : 'asc'"
        >
          {{ direction === 'asc' ? '↑' : '↓' }}
        </button>

        <button
          class="control control-btn"
          :class="{ 'is-active': filtersActive }"
          @click="filtersOpen = !filtersOpen"
        >
          Фильтр<template v-if="filtersActive"> •</template>
        </button>
      </div>

      <div v-if="filtersOpen" class="filters card card-tight">
        <label class="filter">
          <span class="tiny muted">Прибытие с</span>
          <input v-model="from" type="date" />
        </label>
        <label class="filter">
          <span class="tiny muted">по</span>
          <input v-model="to" type="date" />
        </label>
        <AppButton size="sm" variant="ghost" :disabled="!filtersActive" @click="resetFilters">
          Сбросить
        </AppButton>
      </div>
    </div>

    <p v-if="loading" class="muted small">Загружаем…</p>

    <EmptyState
      v-else-if="!clients.length && (search || filtersActive)"
      icon="&#128269;"
      title="Ничего не найдено"
      description="Измените запрос или сбросьте фильтры."
    />

    <EmptyState
      v-else-if="!clients.length"
      icon="&#128101;"
      title="Пока нет клиентов"
      description="Добавьте первого клиента — данные сохранятся прямо на этом устройстве."
    >
      <AppButton variant="primary" @click="navigateTo('/clients/new')">Добавить клиента</AppButton>
    </EmptyState>

    <ul v-else class="list">
      <li v-for="client in clients" :key="client.id">
        <ClientListItem
          :client="client"
          :work-count="workCounts[client.id]"
          :file-count="fileCounts[client.id]"
        />
      </li>
    </ul>
  </div>
</template>

<style scoped>
.toolbar {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 14px;
}

.search {
  width: 100%;
  min-height: var(--touch);
  padding: 10px 14px;
  border-radius: var(--radius);
  border: 1px solid var(--c-border-strong);
  background: var(--c-surface);
  /* 16 px avoids the iOS focus zoom. */
  font-size: 16px;
  -webkit-appearance: none;
  appearance: none;
}

.search:focus {
  outline: none;
  border-color: var(--c-primary);
  box-shadow: 0 0 0 3px var(--c-primary-soft);
}

.toolbar-row {
  display: flex;
  gap: 8px;
}

.control {
  min-height: var(--touch);
  padding: 0 12px;
  border-radius: var(--radius);
  border: 1px solid var(--c-border-strong);
  background: var(--c-surface);
  font-size: 0.9375rem;
  -webkit-appearance: none;
  appearance: none;
}

select.control {
  flex: 1;
  min-width: 0;
  padding-right: 28px;
}

.control-btn {
  flex-shrink: 0;
  min-width: var(--touch);
}

.control-btn.is-active {
  border-color: var(--c-primary);
  color: var(--c-primary);
}

.filters {
  display: flex;
  gap: 8px;
  align-items: flex-end;
  flex-wrap: wrap;
}

.filter {
  display: flex;
  flex-direction: column;
  gap: 3px;
  flex: 1 1 140px;
}

.filter input {
  min-height: var(--touch);
  padding: 8px 10px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--c-border-strong);
  background: var(--c-surface);
  font-size: 16px;
}

.list {
  list-style: none;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
</style>
