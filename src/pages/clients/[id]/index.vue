<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import type { Client, StoredFile, Work } from '~/types/models'
import { clientRepository } from '~/database/repositories/clients'
import { workRepository } from '~/database/repositories/works'
import { fileRepository } from '~/database/repositories/files'
import { useToasts } from '~/composables/useToasts'
import { useConfirm } from '~/composables/useConfirm'
import { useAppStore } from '~/stores/app'
import { ACCEPT_ATTRIBUTE, attachFiles, KIND_LABELS } from '~/services/files/attachments'
import { formatDate, formatDateLong } from '~/utils/datetime'
import { formatBytes, fullName } from '~/utils/format'
import AppButton from '~/components/AppButton.vue'
import AppModal from '~/components/AppModal.vue'
import EmptyState from '~/components/EmptyState.vue'
import FilePicker from '~/components/FilePicker.vue'
import FileThumb from '~/components/FileThumb.vue'
import FileViewer from '~/components/FileViewer.vue'
import ProgressBar from '~/components/ProgressBar.vue'
import WorkForm from '~/components/WorkForm.vue'

const route = useRoute()
const toasts = useToasts()
const { confirm } = useConfirm()
const app = useAppStore()

const clientId = computed(() => String(route.params.id))
const client = ref<Client | null>(null)
const works = ref<Work[]>([])
const files = ref<StoredFile[]>([])
const loading = ref(true)
const notFound = ref(false)

const workModal = ref<{ open: boolean; work?: Work }>({ open: false })
const savingWork = ref(false)
const uploading = ref<{ active: boolean; done: number; total: number }>({
  active: false,
  done: 0,
  total: 0,
})

const viewerIndex = ref<number | null>(null)
const kindFilter = ref<'all' | StoredFile['kind']>('all')
/** Attach the next upload to this work, when opened from a work card. */
const attachTarget = ref<string | undefined>()

const visibleFiles = computed(() =>
  kindFilter.value === 'all' ? files.value : files.value.filter((f) => f.kind === kindFilter.value),
)

const filesByWork = computed(() => {
  const map = new Map<string, StoredFile[]>()
  for (const file of files.value) {
    if (!file.workId) continue
    const list = map.get(file.workId) ?? []
    list.push(file)
    map.set(file.workId, list)
  }
  return map
})

const totalSize = computed(() => files.value.reduce((sum, f) => sum + f.size, 0))

const kindCounts = computed(() => {
  const counts: Record<string, number> = {}
  for (const file of files.value) counts[file.kind] = (counts[file.kind] ?? 0) + 1
  return counts
})

useHead(() => ({ title: client.value ? `${fullName(client.value)} — Dentora` : 'Клиент — Dentora' }))

async function load(): Promise<void> {
  loading.value = true
  try {
    const found = await clientRepository().getById(clientId.value)
    if (!found) {
      notFound.value = true
      return
    }
    client.value = found
    ;[works.value, files.value] = await Promise.all([
      workRepository().getByClientId(clientId.value),
      fileRepository().getByClientId(clientId.value),
    ])
  } catch (error) {
    toasts.error(error, 'client.load')
  } finally {
    loading.value = false
  }
}

// ---- works ----------------------------------------------------------------

function openWorkModal(work?: Work): void {
  workModal.value = { open: true, work }
}

async function saveWork(draft: {
  date: string
  title: string
  description: string
  notes: string
}): Promise<void> {
  savingWork.value = true
  try {
    if (workModal.value.work) {
      await workRepository().update(workModal.value.work.id, draft)
      toasts.success('Работа обновлена')
    } else {
      await workRepository().create({ clientId: clientId.value, ...draft })
      toasts.success('Работа добавлена')
    }
    workModal.value = { open: false }
    await load()
    await app.refreshCounts()
  } catch (error) {
    toasts.error(error, 'work.save')
  } finally {
    savingWork.value = false
  }
}

async function deleteWork(work: Work): Promise<void> {
  const attached = filesByWork.value.get(work.id)?.length ?? 0
  const ok = await confirm({
    title: 'Удалить работу?',
    message: `«${work.title}» будет удалена.`,
    details: attached
      ? [`Прикреплённых файлов: ${attached}. Они останутся у клиента, но потеряют связь с работой.`]
      : undefined,
    confirmLabel: 'Удалить',
    danger: true,
  })
  if (!ok) return

  try {
    await workRepository().destroy(work.id)
    toasts.success('Работа удалена')
    await load()
    await app.refreshCounts()
  } catch (error) {
    toasts.error(error, 'work.delete')
  }
}

// ---- files ----------------------------------------------------------------

async function onPicked(picked: File[]): Promise<void> {
  uploading.value = { active: true, done: 0, total: picked.length }
  try {
    const { stored, failed } = await attachFiles(picked, {
      clientId: clientId.value,
      workId: attachTarget.value,
      onProgress: (done, total) => {
        uploading.value = { active: true, done, total }
      },
    })

    if (stored.length) toasts.success(`Добавлено файлов: ${stored.length}`)
    for (const failure of failed) toasts.error(failure.error, 'file.attach')

    await load()
    await app.refreshCounts()
    await app.refreshStorage()
  } finally {
    uploading.value = { active: false, done: 0, total: 0 }
    attachTarget.value = undefined
  }
}

async function deleteFile(file: StoredFile): Promise<void> {
  const ok = await confirm({
    title: 'Удалить файл?',
    message: `«${file.name}» будет удалён без возможности восстановления.`,
    confirmLabel: 'Удалить',
    danger: true,
  })
  if (!ok) return

  try {
    await fileRepository().destroy(file.id)
    viewerIndex.value = null
    toasts.success('Файл удалён')
    await load()
    await app.refreshCounts()
    await app.refreshStorage()
  } catch (error) {
    toasts.error(error, 'file.delete')
  }
}

const workFileInput = ref<HTMLInputElement | null>(null)

function attachToWork(workId: string): void {
  attachTarget.value = workId
  workFileInput.value?.click()
}

function onWorkFileChange(event: Event): void {
  const input = event.target as HTMLInputElement
  const picked = Array.from(input.files ?? [])
  input.value = ''
  if (picked.length) void onPicked(picked)
  else attachTarget.value = undefined
}

function openViewer(file: StoredFile): void {
  viewerIndex.value = visibleFiles.value.findIndex((f) => f.id === file.id)
}

// ---- client ---------------------------------------------------------------

async function deleteClient(): Promise<void> {
  if (!client.value) return
  const ok = await confirm({
    title: 'Удалить клиента?',
    message: `${fullName(client.value)} будет перемещён в корзину.`,
    details: [
      `Вместе с ним скроются работы (${works.value.length}) и файлы (${files.value.length}).`,
      'Восстановить можно в разделе Настройки → Корзина.',
    ],
    confirmLabel: 'Удалить',
    danger: true,
  })
  if (!ok) return

  try {
    await clientRepository().softDelete(client.value.id)
    await app.refreshCounts()
    toasts.success('Клиент перемещён в корзину', {
      label: 'Отменить',
      run: async () => {
        await clientRepository().restore(clientId.value)
        await app.refreshCounts()
        toasts.info('Клиент восстановлен')
      },
    })
    await navigateTo('/clients')
  } catch (error) {
    toasts.error(error, 'client.delete')
  }
}

onMounted(load)
</script>

<template>
  <div class="page">
    <p v-if="loading" class="muted small">Загружаем…</p>

    <EmptyState
      v-else-if="notFound"
      icon="&#129300;"
      title="Клиент не найден"
      description="Возможно, запись была удалена."
    >
      <AppButton variant="primary" @click="navigateTo('/clients')">К списку клиентов</AppButton>
    </EmptyState>

    <template v-else-if="client">
      <header class="page-header">
        <div class="page-title">
          <NuxtLink to="/clients" class="back-link">&lsaquo; Клиенты</NuxtLink>
          <h1>{{ fullName(client) }}</h1>
          <p class="page-subtitle">Прибытие: {{ formatDateLong(client.arrivalDate) }}</p>
        </div>
        <div class="row">
          <AppButton size="sm" @click="navigateTo(`/clients/${client.id}/edit`)">Изменить</AppButton>
          <AppButton size="sm" variant="ghost" @click="deleteClient">Удалить</AppButton>
        </div>
      </header>

      <!-- Basic information -->
      <section class="card">
        <p class="card-title">Основная информация</p>
        <dl class="details">
          <div class="detail">
            <dt>Телефон</dt>
            <dd>
              <a v-if="client.phone" :href="`tel:${client.phone}`">{{ client.phone }}</a>
              <span v-else class="faint">—</span>
            </dd>
          </div>
          <div class="detail">
            <dt>E-mail</dt>
            <dd>
              <a v-if="client.email" :href="`mailto:${client.email}`" class="break-word">
                {{ client.email }}
              </a>
              <span v-else class="faint">—</span>
            </dd>
          </div>
          <div class="detail">
            <dt>Добавлен</dt>
            <dd class="numeric">{{ formatDate(client.createdAt) }}</dd>
          </div>
          <div class="detail">
            <dt>Изменён</dt>
            <dd class="numeric">{{ formatDate(client.updatedAt) }}</dd>
          </div>
        </dl>
        <template v-if="client.notes">
          <hr class="divider" />
          <p class="pre-wrap break-word">{{ client.notes }}</p>
        </template>
      </section>

      <!-- Works -->
      <section class="card">
        <div class="section-head">
          <p class="card-title">Работы ({{ works.length }})</p>
          <AppButton size="sm" variant="primary" @click="openWorkModal()">+ Работа</AppButton>
        </div>

        <EmptyState
          v-if="!works.length"
          title="Работ пока нет"
          description="Запишите выполненную работу, чтобы вести историю."
        />

        <ul v-else class="works">
          <li v-for="work in works" :key="work.id" class="work">
            <div class="work-head">
              <div class="work-title">
                <span class="strong break-word">{{ work.title }}</span>
                <span class="tiny faint numeric">{{ formatDateLong(work.date) }}</span>
              </div>
              <div class="row">
                <button class="link-btn" @click="openWorkModal(work)">Изменить</button>
                <button class="link-btn danger" @click="deleteWork(work)">Удалить</button>
              </div>
            </div>

            <p v-if="work.description" class="small pre-wrap break-word">{{ work.description }}</p>
            <p v-if="work.notes" class="tiny muted pre-wrap break-word">{{ work.notes }}</p>

            <div v-if="filesByWork.get(work.id)?.length" class="work-files">
              <FileThumb
                v-for="file in filesByWork.get(work.id)"
                :key="file.id"
                :file="file"
                @open="openViewer(file)"
              />
            </div>

            <button class="link-btn" @click="attachToWork(work.id)">
              + Прикрепить файл к работе
            </button>
          </li>
        </ul>
      </section>

      <!-- Files -->
      <section class="card">
        <div class="section-head">
          <p class="card-title">
            Файлы ({{ files.length }}) · {{ formatBytes(totalSize) }}
          </p>
        </div>

        <div class="upload">
          <FilePicker :disabled="uploading.active" @picked="onPicked" />
          <ProgressBar
            v-if="uploading.active"
            :ratio="uploading.total ? uploading.done / uploading.total : null"
            :label="`Сохраняем ${uploading.done} из ${uploading.total}`"
          />
        </div>

        <div v-if="files.length" class="chips" role="tablist">
          <button
            class="chip"
            :class="{ 'is-active': kindFilter === 'all' }"
            @click="kindFilter = 'all'"
          >
            Все · {{ files.length }}
          </button>
          <button
            v-for="(label, kind) in KIND_LABELS"
            :key="kind"
            v-show="kindCounts[kind]"
            class="chip"
            :class="{ 'is-active': kindFilter === kind }"
            @click="kindFilter = kind"
          >
            {{ label }} · {{ kindCounts[kind] }}
          </button>
        </div>

        <EmptyState
          v-if="!files.length"
          icon="&#128247;"
          title="Файлов пока нет"
          description="Добавьте рентген, фото или PDF — они сохранятся на этом устройстве."
        />

        <EmptyState v-else-if="!visibleFiles.length" title="В этой категории пусто" />

        <div v-else class="gallery">
          <FileThumb
            v-for="file in visibleFiles"
            :key="file.id"
            :file="file"
            @open="openViewer(file)"
          />
        </div>
      </section>

      <!--
        One shared hidden input for "attach to this work". A per-work
        <FilePicker> would mean N inputs in the DOM for no benefit.
      -->
      <input
        ref="workFileInput"
        type="file"
        class="visually-hidden"
        :accept="ACCEPT_ATTRIBUTE"
        multiple
        @change="onWorkFileChange"
      />

      <!-- Work editor -->
      <AppModal
        :open="workModal.open"
        :title="workModal.work ? 'Изменить работу' : 'Новая работа'"
        @close="workModal = { open: false }"
      >
        <WorkForm
          :key="workModal.work?.id ?? 'new'"
          :work="workModal.work"
          :saving="savingWork"
          @submit="saveWork"
          @cancel="workModal = { open: false }"
        />
      </AppModal>

      <!-- Viewer -->
      <FileViewer
        v-if="viewerIndex !== null && visibleFiles.length"
        :files="visibleFiles"
        :index="viewerIndex"
        @close="viewerIndex = null"
        @navigate="viewerIndex = $event"
        @remove="deleteFile"
      />
    </template>
  </div>
</template>

<style scoped>

.card + .card { margin-top: 16px; }

.section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 10px;
}
.section-head .card-title { margin-bottom: 0; }

.details {
  display: grid;
  gap: 10px;
  grid-template-columns: 1fr;
  margin: 0;
}

@media (min-width: 560px) {
  .details { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}

.detail dt {
  font-size: 0.75rem;
  color: var(--c-text-faint);
  text-transform: uppercase;
  letter-spacing: 0.03em;
}

.detail dd {
  margin: 0;
  font-size: 0.9375rem;
}

.works {
  list-style: none;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.work {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 12px;
  border: 1px solid var(--c-border);
  border-radius: var(--radius);
  background: var(--c-surface-2);
}

.work-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px;
  flex-wrap: wrap;
}

.work-title {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.work-files {
  display: grid;
  gap: 8px;
  grid-template-columns: repeat(auto-fill, minmax(92px, 1fr));
  margin-top: 4px;
}

.link-btn {
  color: var(--c-primary);
  font-size: 0.8125rem;
  font-weight: 550;
  /* Small text, but the tap area still clears 44 px vertically. */
  min-height: var(--touch);
  display: inline-flex;
  align-items: center;
  padding: 0 6px;
  align-self: flex-start;
}
.link-btn.danger { color: var(--c-danger); }

.upload {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-bottom: 12px;
}

.chips {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  margin-bottom: 12px;
}

.chip {
  min-height: 34px;
  padding: 0 12px;
  border-radius: 999px;
  border: 1px solid var(--c-border-strong);
  background: var(--c-surface);
  font-size: 0.8125rem;
  font-weight: 550;
  color: var(--c-text-muted);
}

.chip.is-active {
  background: var(--c-primary-soft);
  border-color: var(--c-primary);
  color: var(--c-primary);
}

.gallery {
  display: grid;
  gap: 12px;
  grid-template-columns: repeat(auto-fill, minmax(104px, 1fr));
}

@media (min-width: 700px) {
  .gallery { grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); }
}
</style>
