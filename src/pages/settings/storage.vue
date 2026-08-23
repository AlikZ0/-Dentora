<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useAppStore } from '~/stores/app'
import { useToasts } from '~/composables/useToasts'
import { useConfirm } from '~/composables/useConfirm'
import { fileRepository } from '~/database/repositories/files'
import { destroyDatabase } from '~/database/db'
import {
  clearAppCache,
  requestPersistence,
  STORAGE_WARN_RATIO,
} from '~/services/storage/storage'
import { formatBytes, formatNumber } from '~/utils/format'
import AppButton from '~/components/AppButton.vue'

useHead({ title: 'Хранилище — Dentora' })

const app = useAppStore()
const toasts = useToasts()
const { confirm } = useConfirm()

const busy = ref(false)
const deletedFileCount = ref(0)

const usedRatio = computed(() => app.storage.ratio)
const nearFull = computed(() => usedRatio.value !== null && usedRatio.value >= STORAGE_WARN_RATIO)

async function refresh(): Promise<void> {
  await app.refreshAll()
  const all = await fileRepository().all(true)
  deletedFileCount.value = all.filter((f) => f.deleted).length
}

async function onClearCache(): Promise<void> {
  const ok = await confirm({
    title: 'Очистить кэш приложения?',
    message:
      'Будут удалены только загруженные файлы интерфейса. Клиенты, работы и снимки останутся на месте.',
    details: ['После очистки приложению понадобится интернет один раз, чтобы загрузиться заново.'],
    confirmLabel: 'Очистить кэш',
  })
  if (!ok) return

  busy.value = true
  try {
    const count = await clearAppCache()
    toasts.success(count ? 'Кэш очищен' : 'Кэш уже пуст')
    await refresh()
  } catch (error) {
    toasts.error(error, 'storage.clearCache')
  } finally {
    busy.value = false
  }
}

async function onPurgeDeleted(): Promise<void> {
  const ok = await confirm({
    title: 'Удалить файлы из корзины навсегда?',
    message: `Будет освобождено место, занятое ${deletedFileCount.value} удалёнными файлами.`,
    confirmLabel: 'Удалить навсегда',
    danger: true,
  })
  if (!ok) return

  busy.value = true
  try {
    const count = await fileRepository().purgeDeleted()
    toasts.success(`Удалено файлов: ${count}`)
    await refresh()
  } catch (error) {
    toasts.error(error, 'storage.purge')
  } finally {
    busy.value = false
  }
}

/** Two independent confirmations, the second requiring a typed phrase. */
async function onDeleteEverything(): Promise<void> {
  const first = await confirm({
    title: 'Удалить все данные?',
    message: 'Будут безвозвратно удалены все клиенты, работы и файлы на этом устройстве.',
    details: [
      `Сейчас в базе: клиентов ${formatNumber(app.counts.clients)}, работ ${formatNumber(app.counts.works)}, файлов ${formatNumber(app.counts.files)}.`,
      'Если у вас нет backup — сначала сделайте экспорт.',
    ],
    confirmLabel: 'Продолжить',
    danger: true,
  })
  if (!first) return

  const second = await confirm({
    title: 'Это действие необратимо',
    message: 'Восстановить данные без backup-файла будет невозможно.',
    requirePhrase: 'УДАЛИТЬ',
    confirmLabel: 'Удалить всё',
    danger: true,
  })
  if (!second) return

  busy.value = true
  try {
    await destroyDatabase()
    toasts.success('Все данные удалены')
    await refresh()
    await navigateTo('/')
  } catch (error) {
    toasts.error(error, 'storage.destroy')
  } finally {
    busy.value = false
  }
}

async function onRequestPersistence(): Promise<void> {
  const granted = await requestPersistence()
  await app.refreshStorage()
  if (granted) toasts.success('Браузер больше не будет автоматически удалять данные')
  else toasts.info('Браузер не выдал постоянное хранилище. Установите приложение на устройство.')
}

onMounted(refresh)
</script>

<template>
  <div class="page page-narrow">
    <header class="page-header">
      <div class="page-title">
        <NuxtLink to="/settings" class="back-link">&lsaquo; Настройки</NuxtLink>
        <h1>Хранилище</h1>
      </div>
    </header>

    <section class="card">
      <p class="card-title">Использование</p>

      <div class="usage">
        <p class="usage-value numeric">{{ formatBytes(app.storage.usage) }}</p>
        <p v-if="app.storage.quota" class="small muted">
          из {{ formatBytes(app.storage.quota) }} доступных
        </p>
        <p v-else class="small muted">Браузер не сообщает доступный объём</p>
      </div>

      <div v-if="usedRatio !== null" class="bar">
        <div
          class="bar-fill"
          :class="{ warn: nearFull }"
          :style="{ width: `${Math.max(1, Math.min(100, usedRatio * 100))}%` }"
        />
      </div>

      <p v-if="nearFull" class="alert small">
        Хранилище почти заполнено. Сделайте backup и удалите ненужные файлы,
        иначе новые снимки могут не сохраниться.
      </p>

      <hr class="divider" />

      <dl class="facts">
        <div><dt>Файлов</dt><dd class="numeric">{{ formatNumber(app.counts.files) }}</dd></div>
        <div><dt>Клиентов</dt><dd class="numeric">{{ formatNumber(app.counts.clients) }}</dd></div>
        <div><dt>Работ</dt><dd class="numeric">{{ formatNumber(app.counts.works) }}</dd></div>
        <div>
          <dt>Размер файлов</dt>
          <dd class="numeric">{{ formatBytes(app.counts.storageUsed) }}</dd>
        </div>
      </dl>
    </section>

    <section class="card">
      <p class="card-title">Постоянное хранилище</p>
      <p v-if="app.persisted" class="small text-success">
        Включено. Браузер не удалит данные автоматически при нехватке места.
      </p>
      <template v-else>
        <p class="small muted">
          Без постоянного хранилища браузер может удалить базу при нехватке места на устройстве.
          В Safari на iPhone надёжный способ — установить приложение на экран «Домой».
        </p>
        <AppButton block @click="onRequestPersistence">Запросить постоянное хранилище</AppButton>
      </template>
    </section>

    <section class="card">
      <p class="card-title">Обслуживание</p>

      <div class="action">
        <div>
          <p class="strong">Очистить кэш</p>
          <p class="tiny muted">
            Удаляет только файлы интерфейса. Данные клиентов не затрагиваются.
          </p>
        </div>
        <AppButton size="sm" :disabled="busy" @click="onClearCache">Очистить</AppButton>
      </div>

      <div v-if="deletedFileCount" class="action">
        <div>
          <p class="strong">Освободить место</p>
          <p class="tiny muted">
            Удалить навсегда {{ deletedFileCount }} файлов, находящихся в корзине.
          </p>
        </div>
        <AppButton size="sm" :disabled="busy" @click="onPurgeDeleted">Освободить</AppButton>
      </div>
    </section>

    <section class="card danger-zone">
      <p class="card-title text-danger">Опасная зона</p>
      <div class="action">
        <div>
          <p class="strong">Удалить все данные</p>
          <p class="tiny muted">
            Полностью очищает базу этого устройства. Требуется двойное подтверждение.
          </p>
        </div>
        <AppButton size="sm" variant="danger" :disabled="busy" @click="onDeleteEverything">
          Удалить всё
        </AppButton>
      </div>
    </section>
  </div>
</template>

<style scoped>
.page-narrow { max-width: 720px; }
.card + .card { margin-top: 16px; }


.usage { margin-bottom: 10px; }

.usage-value {
  font-size: 2rem;
  font-weight: 650;
  letter-spacing: -0.02em;
  line-height: 1.1;
}

.bar {
  height: 10px;
  border-radius: 999px;
  background: var(--c-surface-3);
  overflow: hidden;
}

.bar-fill {
  height: 100%;
  background: var(--c-primary);
  border-radius: 999px;
  transition: width 0.3s;
}
.bar-fill.warn { background: var(--c-warning); }

.alert {
  margin-top: 10px;
  padding: 10px 12px;
  border-radius: var(--radius);
  background: var(--c-warning-soft);
}

.facts {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
  margin: 0;
}

.facts dt {
  font-size: 0.75rem;
  color: var(--c-text-faint);
  text-transform: uppercase;
  letter-spacing: 0.03em;
}

.facts dd {
  margin: 0;
  font-size: 1.0625rem;
  font-weight: 600;
}

.action {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 0;
  border-bottom: 1px solid var(--c-border);
}
.action:last-child { border-bottom: 0; padding-bottom: 0; }
.action > div { min-width: 0; }

.danger-zone {
  border-color: color-mix(in srgb, var(--c-danger) 35%, var(--c-border));
}

@media (max-width: 480px) {
  .action { flex-direction: column; align-items: stretch; }
  .action :deep(.btn) { width: 100%; }
}
</style>
