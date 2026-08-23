<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import type { BackupPreview, ImportMode } from '~/types/backup'
import { exportBackup, type ExportProgress } from '~/services/backup/export'
import { importBackup, previewBackup, isEncryptedArchive } from '~/services/backup/import'
import type { ImportProgress } from '~/services/backup/import'
import { isIos, saveBlob, supportsFilePicker } from '~/services/files/download'
import { passwordStrength } from '~/services/encryption/crypto'
import { useAppStore } from '~/stores/app'
import { useToasts } from '~/composables/useToasts'
import { useConfirm } from '~/composables/useConfirm'
import { formatDateTime } from '~/utils/datetime'
import { formatBytes, formatNumber } from '~/utils/format'
import AppButton from '~/components/AppButton.vue'
import AppField from '~/components/AppField.vue'
import AppModal from '~/components/AppModal.vue'
import ProgressBar from '~/components/ProgressBar.vue'

useHead({ title: 'Backup — Dentora' })

const app = useAppStore()
const toasts = useToasts()
const { confirm } = useConfirm()
const route = useRoute()

// ---- export ---------------------------------------------------------------

const exportDialog = ref(false)
const usePassword = ref(false)
const password = ref('')
const passwordRepeat = ref('')
const exporting = ref(false)
const exportProgress = ref<ExportProgress | null>(null)

const strength = computed(() => passwordStrength(password.value))
const passwordMismatch = computed(
  () => usePassword.value && passwordRepeat.value.length > 0 && password.value !== passwordRepeat.value,
)
const canExport = computed(() => {
  if (!usePassword.value) return true
  return password.value.length >= 8 && password.value === passwordRepeat.value
})

function resetExportDialog(): void {
  usePassword.value = false
  password.value = ''
  passwordRepeat.value = ''
}

async function runExport(): Promise<void> {
  exporting.value = true
  exportProgress.value = { stage: 'collecting', ratio: null, label: 'Готовим данные…' }
  try {
    const result = await exportBackup({
      password: usePassword.value ? password.value : undefined,
      onProgress: (p) => {
        exportProgress.value = p
      },
    })

    const outcome = await saveBlob(result.blob, {
      suggestedName: result.fileName,
      mimeType: 'application/zip',
      // On iOS the share sheet is the only way into Files / iCloud Drive.
      preferShare: isIos(),
    })

    if (outcome === 'cancelled') {
      toasts.info('Сохранение отменено')
    } else {
      toasts.success(
        `Backup готов: ${result.manifest.counts.clients} клиентов, ${result.manifest.counts.files} файлов, ${formatBytes(result.blob.size)}`,
      )
    }

    exportDialog.value = false
    resetExportDialog()
    await app.refreshBackupStats()
    app.reminderVisible = false
  } catch (error) {
    toasts.error(error, 'backup.export')
  } finally {
    exporting.value = false
    exportProgress.value = null
  }
}

// ---- import ---------------------------------------------------------------

const fileInput = ref<HTMLInputElement | null>(null)
const selected = ref<File | null>(null)
const preview = ref<BackupPreview | null>(null)
const importPassword = ref('')
const needsPassword = ref(false)
const analysing = ref(false)
const importing = ref(false)
const importProgress = ref<ImportProgress | null>(null)
const importDialog = ref(false)

function resetImport(): void {
  selected.value = null
  preview.value = null
  importPassword.value = ''
  needsPassword.value = false
  importProgress.value = null
}

async function onFileChosen(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0] ?? null
  input.value = ''
  if (!file) return

  resetImport()
  selected.value = file
  importDialog.value = true
  needsPassword.value = await isEncryptedArchive(file)
  if (!needsPassword.value) await analyse()
}

async function analyse(): Promise<void> {
  if (!selected.value) return
  analysing.value = true
  try {
    preview.value = await previewBackup(selected.value, {
      password: importPassword.value || undefined,
    })
    needsPassword.value = false
  } catch (error) {
    preview.value = null
    toasts.error(error, 'backup.preview')
  } finally {
    analysing.value = false
  }
}

async function runImport(mode: ImportMode): Promise<void> {
  if (!selected.value || !preview.value) return

  if (mode === 'replace') {
    const ok = await confirm({
      title: 'Заменить текущие данные?',
      message: 'Текущие локальные данные будут заменены содержимым backup.',
      details: [
        `Сейчас в базе: клиентов ${formatNumber(app.counts.clients)}, работ ${formatNumber(app.counts.works)}, файлов ${formatNumber(app.counts.files)}.`,
        `После импорта: клиентов ${formatNumber(preview.value.clients)}, работ ${formatNumber(preview.value.works)}, файлов ${formatNumber(preview.value.files)}.`,
        'Это действие нельзя отменить. Сначала сделайте экспорт текущей базы.',
      ],
      confirmLabel: 'Заменить',
      danger: true,
    })
    if (!ok) return
  }

  importing.value = true
  importProgress.value = { stage: 'reading', ratio: null, label: 'Читаем архив…' }
  try {
    const result = await importBackup(selected.value, mode, {
      password: importPassword.value || undefined,
      onProgress: (p) => {
        importProgress.value = p
      },
    })

    toasts.success(
      mode === 'replace'
        ? `База заменена: ${result.clientsAdded} клиентов, ${result.filesAdded} файлов`
        : `Объединено: +${result.clientsAdded} клиентов, +${result.worksAdded} работ, +${result.filesAdded} файлов`,
    )

    importDialog.value = false
    resetImport()
    await app.refreshAll()
  } catch (error) {
    toasts.error(error, 'backup.import')
  } finally {
    importing.value = false
    importProgress.value = null
  }
}

onMounted(async () => {
  await app.refreshAll()
  if (route.query.action === 'export') exportDialog.value = true
  if (route.query.action === 'import') fileInput.value?.click()
})
</script>

<template>
  <div class="page page-narrow">
    <header class="page-header">
      <div class="page-title">
        <h1>Backup</h1>
        <p class="page-subtitle">Перенос базы между устройствами и защита от потери данных</p>
      </div>
    </header>

    <!-- Daily status -->
    <section class="card">
      <p class="card-title">Состояние</p>
      <div class="status" :class="app.backedUpToday ? 'ok' : 'warn'">
        <span class="status-dot" aria-hidden="true" />
        <div>
          <p class="strong">
            {{ app.backedUpToday ? 'Backup сегодня создан' : 'Сегодня backup ещё не создавался' }}
          </p>
          <p class="small muted">
            Последний backup:
            {{
              app.backupStats.lastExportAt
                ? formatDateTime(app.backupStats.lastExportAt)
                : 'никогда'
            }}
          </p>
        </div>
      </div>

      <hr class="divider" />

      <dl class="history">
        <div>
          <dt>Последний экспорт</dt>
          <dd>{{ formatDateTime(app.backupStats.lastExportAt) }}</dd>
        </div>
        <div>
          <dt>Последний импорт</dt>
          <dd>{{ formatDateTime(app.backupStats.lastImportAt) }}</dd>
        </div>
        <div>
          <dt>Размер последнего backup</dt>
          <dd class="numeric">{{ formatBytes(app.backupStats.lastBackupSize) }}</dd>
        </div>
        <div>
          <dt>Всего экспортов</dt>
          <dd class="numeric">{{ formatNumber(app.backupStats.backupCount) }}</dd>
        </div>
      </dl>
    </section>

    <!-- Export -->
    <section class="card">
      <p class="card-title">Экспорт</p>
      <p class="small muted">
        Один архив со всей базой: клиенты, работы и все файлы. Держите его на компьютере,
        в облаке или на флешке.
      </p>
      <ul class="facts">
        <li>Клиентов: <span class="numeric strong">{{ formatNumber(app.counts.clients) }}</span></li>
        <li>Работ: <span class="numeric strong">{{ formatNumber(app.counts.works) }}</span></li>
        <li>
          Файлов: <span class="numeric strong">{{ formatNumber(app.counts.files) }}</span>
          <span class="faint"> ({{ formatBytes(app.counts.storageUsed) }})</span>
        </li>
      </ul>
      <AppButton
        variant="primary"
        block
        :disabled="app.counts.clients === 0"
        @click="exportDialog = true"
      >
        Экспортировать данные
      </AppButton>
      <p v-if="app.counts.clients === 0" class="tiny faint">
        В базе пока нет данных — сначала добавьте клиента.
      </p>
      <p v-else-if="!supportsFilePicker()" class="tiny faint">
        Файл сохранится в папку «Загрузки»<template v-if="isIos()">
          или откроется меню «Поделиться» — выберите «Сохранить в Файлы»</template>.
      </p>
    </section>

    <!-- Import -->
    <section class="card">
      <p class="card-title">Импорт</p>
      <p class="small muted">
        Выберите файл <code>backup_….zip</code>. Перед импортом вы увидите, что внутри.
      </p>
      <input
        ref="fileInput"
        type="file"
        class="visually-hidden"
        accept=".zip,.enc,application/zip,application/octet-stream"
        @change="onFileChosen"
      />
      <AppButton block @click="fileInput?.click()">Импортировать backup</AppButton>
      <p class="tiny faint">
        iPhone: файл можно взять из «Файлы», iCloud Drive или «Загрузки».
      </p>
    </section>

    <!-- ==================== Export dialog ==================== -->
    <AppModal
      :open="exportDialog"
      title="Экспорт данных"
      :dismissible="!exporting"
      @close="exportDialog = false"
    >
      <div class="stack">
        <p class="small muted">
          Backup содержит персональные и медицинские данные. Если файл будет храниться
          в облаке или передаваться по почте — защитите его паролем.
        </p>

        <fieldset class="choice">
          <legend class="visually-hidden">Защита backup</legend>
          <label class="option">
            <input v-model="usePassword" type="radio" :value="false" name="protection" />
            <span>
              <span class="strong">Без пароля</span>
              <span class="tiny muted">Обычный ZIP, открывается любым архиватором</span>
            </span>
          </label>
          <label class="option">
            <input v-model="usePassword" type="radio" :value="true" name="protection" />
            <span>
              <span class="strong">Защитить паролем</span>
              <span class="tiny muted">Шифрование AES-256-GCM, пароль нигде не сохраняется</span>
            </span>
          </label>
        </fieldset>

        <template v-if="usePassword">
          <AppField
            label="Пароль"
            required
            :hint="password ? strength.label : 'Минимум 8 символов'"
            input-id="exportPassword"
          >
            <input
              id="exportPassword"
              v-model="password"
              type="password"
              autocomplete="new-password"
              :disabled="exporting"
            />
          </AppField>

          <AppField
            label="Повторите пароль"
            required
            :error="passwordMismatch ? 'Пароли не совпадают' : ''"
            input-id="exportPasswordRepeat"
          >
            <input
              id="exportPasswordRepeat"
              v-model="passwordRepeat"
              type="password"
              autocomplete="new-password"
              :disabled="exporting"
            />
          </AppField>

          <p class="warning tiny">
            Пароль невозможно восстановить. Если вы его забудете, backup будет утерян навсегда.
          </p>
        </template>

        <ProgressBar
          v-if="exportProgress"
          :ratio="exportProgress.ratio"
          :label="exportProgress.label"
        />
      </div>

      <template #footer>
        <AppButton variant="ghost" :disabled="exporting" @click="exportDialog = false">
          Отмена
        </AppButton>
        <AppButton variant="primary" :loading="exporting" :disabled="!canExport" @click="runExport">
          Экспортировать
        </AppButton>
      </template>
    </AppModal>

    <!-- ==================== Import dialog ==================== -->
    <AppModal
      :open="importDialog"
      title="Импорт backup"
      :dismissible="!importing"
      @close="importDialog = false; resetImport()"
    >
      <div class="stack">
        <p v-if="selected" class="small muted truncate">
          Файл: <span class="strong">{{ selected.name }}</span> ({{ formatBytes(selected.size) }})
        </p>

        <!-- Password gate -->
        <template v-if="needsPassword">
          <p class="small">Этот backup защищён паролем.</p>
          <AppField label="Пароль" required input-id="importPassword">
            <input
              id="importPassword"
              v-model="importPassword"
              type="password"
              autocomplete="current-password"
              @keyup.enter="analyse"
            />
          </AppField>
          <AppButton
            variant="primary"
            block
            :loading="analysing"
            :disabled="!importPassword"
            @click="analyse"
          >
            Расшифровать
          </AppButton>
        </template>

        <p v-else-if="analysing" class="small muted">Проверяем архив…</p>

        <!-- Preview -->
        <template v-else-if="preview">
          <div class="preview">
            <p class="preview-head">Backup создан</p>
            <p class="preview-date numeric">{{ formatDateTime(preview.manifest.createdAt) }}</p>
            <dl class="preview-grid">
              <div><dt>Клиентов</dt><dd class="numeric">{{ formatNumber(preview.clients) }}</dd></div>
              <div><dt>Работ</dt><dd class="numeric">{{ formatNumber(preview.works) }}</dd></div>
              <div><dt>Файлов</dt><dd class="numeric">{{ formatNumber(preview.files) }}</dd></div>
              <div><dt>Размер</dt><dd class="numeric">{{ formatBytes(preview.payloadSize) }}</dd></div>
            </dl>
            <p class="tiny faint">
              Версия приложения: {{ preview.manifest.appVersion }} · формат
              {{ preview.manifest.version }} · база {{ preview.manifest.databaseVersion }}
              <template v-if="preview.encrypted"> · зашифрован</template>
            </p>
          </div>

          <div class="modes">
            <button class="mode" :disabled="importing" @click="runImport('merge')">
              <span class="mode-title">Объединить</span>
              <span class="mode-text">
                Добавить недостающие записи к текущей базе. Дубликаты не создаются,
                более свежая версия записи побеждает.
              </span>
            </button>

            <button class="mode mode-danger" :disabled="importing" @click="runImport('replace')">
              <span class="mode-title">Заменить</span>
              <span class="mode-text">
                Полностью очистить текущую базу и записать данные из backup.
                Текущие локальные данные будут заменены.
              </span>
            </button>
          </div>

          <ProgressBar
            v-if="importProgress"
            :ratio="importProgress.ratio"
            :label="importProgress.label"
          />
        </template>
      </div>
    </AppModal>
  </div>
</template>

<style scoped>
.page-narrow { max-width: 720px; }

.card + .card { margin-top: 16px; }

.status {
  display: flex;
  align-items: center;
  gap: 10px;
}

.status-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  flex-shrink: 0;
}
.status.ok .status-dot { background: var(--c-success); }
.status.warn .status-dot { background: var(--c-warning); }

.history {
  display: grid;
  gap: 10px;
  grid-template-columns: 1fr;
  margin: 0;
}

@media (min-width: 520px) {
  .history { grid-template-columns: 1fr 1fr; }
}

.history dt {
  font-size: 0.75rem;
  color: var(--c-text-faint);
  text-transform: uppercase;
  letter-spacing: 0.03em;
}

.history dd {
  margin: 0;
  font-size: 0.9375rem;
}

.facts {
  list-style: none;
  padding: 0;
  margin: 10px 0 14px;
  display: flex;
  flex-direction: column;
  gap: 3px;
  font-size: 0.9375rem;
}

code {
  font-family: var(--font-mono);
  font-size: 0.875em;
  background: var(--c-surface-3);
  padding: 1px 5px;
  border-radius: 4px;
}

.card :deep(.btn) { margin-top: 4px; }
.card p.tiny { margin-top: 8px; }

.choice {
  border: 0;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.option {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 12px;
  border: 1px solid var(--c-border-strong);
  border-radius: var(--radius);
  cursor: pointer;
  min-height: var(--touch);
}

.option:has(input:checked) {
  border-color: var(--c-primary);
  background: var(--c-primary-soft);
}

.option input {
  margin-top: 3px;
  width: 18px;
  height: 18px;
  flex-shrink: 0;
  accent-color: var(--c-primary);
}

.option > span {
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.warning {
  padding: 10px 12px;
  background: var(--c-warning-soft);
  border-radius: var(--radius);
  color: var(--c-text);
}

.preview {
  padding: 14px;
  border: 1px solid var(--c-border);
  border-radius: var(--radius);
  background: var(--c-surface-2);
}

.preview-head {
  font-size: 0.75rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--c-text-faint);
}

.preview-date {
  font-size: 1.0625rem;
  font-weight: 600;
  margin-bottom: 10px;
}

.preview-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 8px;
  margin: 0 0 8px;
}

@media (min-width: 480px) {
  .preview-grid { grid-template-columns: repeat(4, 1fr); }
}

.preview-grid dt {
  font-size: 0.75rem;
  color: var(--c-text-faint);
}

.preview-grid dd {
  margin: 0;
  font-size: 1.0625rem;
  font-weight: 600;
}

.modes {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.mode {
  display: flex;
  flex-direction: column;
  gap: 3px;
  text-align: left;
  padding: 14px;
  border: 1px solid var(--c-border-strong);
  border-radius: var(--radius);
  background: var(--c-surface);
  min-height: var(--touch);
}

.mode:hover:not(:disabled) { border-color: var(--c-primary); }
.mode:disabled { opacity: 0.5; }

.mode-title {
  font-weight: 650;
}

.mode-text {
  font-size: 0.8125rem;
  color: var(--c-text-muted);
  line-height: 1.45;
}

.mode-danger .mode-title { color: var(--c-danger); }
.mode-danger:hover:not(:disabled) { border-color: var(--c-danger); }
</style>
