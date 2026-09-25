<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useAppStore } from '~/stores/app'
import { useToasts } from '~/composables/useToasts'
import { connect, disconnect, isConnected } from '~/services/google/calendar'
import { isValidEmail } from '~/services/google/events'
import { pendingGoogleCount, syncToGoogle } from '~/services/google/sync'
import AppButton from '~/components/AppButton.vue'
import AppField from '~/components/AppField.vue'

useHead({ title: 'Google Календарь — Dentora' })

const app = useAppStore()
const toasts = useToasts()
const config = useRuntimeConfig()

const email = ref('')
const clientId = ref('')
const connected = ref(false)
const connecting = ref(false)
const syncing = ref(false)
const pending = ref(0)

const builtInClientId = computed(() => String(config.public.googleClientId || ''))
const effectiveClientId = computed(() => clientId.value.trim() || builtInClientId.value)
const emailError = computed(() =>
  email.value && !isValidEmail(email.value) ? 'Проверьте адрес: например, doctor@gmail.com' : '',
)

function refreshState(): void {
  connected.value = isValidEmail(app.settings.googleEmail) && isConnected(app.settings.googleEmail)
}

async function refreshPending(): Promise<void> {
  pending.value = await pendingGoogleCount()
}

async function saveAccount(): Promise<boolean> {
  if (!isValidEmail(email.value)) {
    toasts.errorText('Введите Gmail врача.')
    return false
  }
  const nextEmail = email.value.trim()
  if (nextEmail.toLowerCase() !== app.settings.googleEmail.toLowerCase()) disconnect()
  await app.saveSettings({ googleEmail: nextEmail, googleClientId: clientId.value.trim() })
  return true
}

/** Straight from the click: the Google popup is blocked otherwise. */
async function connectGoogle(): Promise<void> {
  connecting.value = true
  try {
    if (!(await saveAccount())) return
    await connect(effectiveClientId.value, app.settings.googleEmail)
    await app.saveSettings({ googleCalendarSync: true })
    refreshState()
    toasts.success('Google Календарь подключён')
    await runSync()
  } catch (error) {
    toasts.error(error, 'google.connect')
  } finally {
    connecting.value = false
  }
}

async function runSync(): Promise<void> {
  syncing.value = true
  try {
    const result = await syncToGoogle()
    if (result.error) toasts.warning(result.error)
    else if (result.pushed || result.removed) {
      toasts.success(`Отправлено в Google Календарь: ${result.pushed + result.removed}`)
    } else toasts.info('Все визиты уже в календаре')
  } finally {
    syncing.value = false
    refreshState()
    await refreshPending()
  }
}

async function toggleSync(value: boolean): Promise<void> {
  try {
    await app.saveSettings({ googleCalendarSync: value })
  } catch (error) {
    toasts.error(error, 'settings.save')
  }
}

async function toggle(key: 'googleEmailReminders' | 'googleInvitePatient', value: boolean): Promise<void> {
  try {
    await app.saveSettings({ [key]: value })
  } catch (error) {
    toasts.error(error, 'settings.save')
  }
}

function disconnectGoogle(): void {
  disconnect()
  refreshState()
  toasts.info('Google-аккаунт отключён на этом устройстве')
}

onMounted(async () => {
  await app.init()
  email.value = app.settings.googleEmail
  clientId.value = app.settings.googleClientId
  refreshState()
  await refreshPending()
})
</script>

<template>
  <div class="page page-narrow">
    <header class="page-header">
      <div class="page-title">
        <h1>Google Календарь</h1>
        <p class="page-subtitle">Визиты в календаре врача и напоминания на телефон</p>
      </div>
    </header>

    <section class="card">
      <p class="card-title">Аккаунт врача</p>

      <div class="form">
        <AppField
          label="Gmail врача"
          input-id="googleEmail"
          hint="В календарь этого аккаунта будут добавляться визиты"
          :error="emailError"
          required
        >
          <input
            id="googleEmail"
            v-model="email"
            type="email"
            inputmode="email"
            autocomplete="email"
            placeholder="doctor@gmail.com"
          />
        </AppField>

        <AppField
          label="OAuth Client ID"
          input-id="googleClientId"
          :hint="
            builtInClientId
              ? 'Можно оставить пустым — используется ключ, встроенный в приложение'
              : 'Из Google Cloud Console → APIs & Services → Credentials (тип «Web application»)'
          "
        >
          <input
            id="googleClientId"
            v-model="clientId"
            type="text"
            autocomplete="off"
            spellcheck="false"
            placeholder="1234567890-abc.apps.googleusercontent.com"
          />
        </AppField>
      </div>

      <p v-if="connected" class="status status-ok">
        Подключено: {{ app.settings.googleEmail }}
      </p>
      <p v-else-if="app.settings.googleEmail" class="status status-warn">
        Не подключено. Нажмите «Подключить» и войдите в {{ app.settings.googleEmail }}.
      </p>
      <p v-if="!app.online" class="status status-warn">
        Нет интернета. Визиты сохраняются в приложении и уйдут в календарь позже.
      </p>

      <div class="actions">
        <AppButton
          variant="primary"
          block
          :loading="connecting"
          :disabled="!app.online || !effectiveClientId"
          @click="connectGoogle"
        >
          {{ connected ? 'Переподключить' : 'Подключить Google' }}
        </AppButton>
        <AppButton v-if="connected" variant="ghost" block @click="disconnectGoogle">
          Отключить
        </AppButton>
      </div>
    </section>

    <section class="card">
      <p class="card-title">Синхронизация визитов</p>

      <label class="toggle">
        <span>
          <span class="strong">Добавлять визиты в Google Календарь</span>
          <span class="tiny muted">
            Новые, перенесённые и отменённые визиты обновляются в календаре автоматически
          </span>
        </span>
        <input
          type="checkbox"
          :checked="app.settings.googleCalendarSync"
          :disabled="!app.settings.googleEmail"
          @change="toggleSync(($event.target as HTMLInputElement).checked)"
        />
      </label>

      <label class="toggle">
        <span>
          <span class="strong">Напоминание на почту</span>
          <span class="tiny muted">
            Кроме уведомления в приложении Google Календарь — письмо на Gmail
          </span>
        </span>
        <input
          type="checkbox"
          :checked="app.settings.googleEmailReminders"
          @change="toggle('googleEmailReminders', ($event.target as HTMLInputElement).checked)"
        />
      </label>

      <label class="toggle">
        <span>
          <span class="strong">Приглашать пациента</span>
          <span class="tiny muted">
            Если у клиента указан e-mail, ему придёт приглашение и напоминание от Google
          </span>
        </span>
        <input
          type="checkbox"
          :checked="app.settings.googleInvitePatient"
          @change="toggle('googleInvitePatient', ($event.target as HTMLInputElement).checked)"
        />
      </label>

      <hr class="divider" />

      <p class="small muted">
        Ожидают отправки: <span class="strong">{{ pending }}</span>
      </p>
      <AppButton
        block
        :loading="syncing"
        :disabled="!connected || !app.settings.googleCalendarSync || !app.online"
        @click="runSync"
      >
        Синхронизировать сейчас
      </AppButton>
    </section>

    <section class="card">
      <p class="card-title">Как приходят напоминания</p>
      <ul class="notes">
        <li>
          Установите приложение <span class="strong">Google Календарь</span> на телефон и войдите
          в тот же Gmail — напоминание о визите придёт пуш-уведомлением, даже когда Dentora
          закрыта.
        </li>
        <li>Время напоминания берётся из визита («за час», «за день» и т. д.).</li>
        <li>
          SMS-напоминания Google Календарь больше не отправляет (Google отключил их в 2019 году),
          поэтому используются пуш-уведомления и письма на почту.
        </li>
        <li>
          В Google уходят только название визита, имя и телефон пациента и заметка визита.
          Снимки и файлы не передаются.
        </li>
      </ul>
    </section>
  </div>
</template>

<style scoped>
.page-narrow { max-width: 720px; }
.card + .card { margin-top: 16px; }

.form {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.actions {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 14px;
}

.status {
  margin-top: 12px;
  padding: 10px 12px;
  border-radius: var(--radius);
  font-size: 0.875rem;
  overflow-wrap: anywhere;
}
.status-warn { background: var(--c-warning-soft); }
.status-ok { background: var(--c-success-soft); color: var(--c-text); }

.toggle {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-height: var(--touch);
  padding: 4px 0;
  cursor: pointer;
}

.toggle > span {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.toggle input {
  width: 22px;
  height: 22px;
  flex-shrink: 0;
  accent-color: var(--c-primary);
}

.notes {
  margin: 0;
  padding-left: 20px;
  font-size: 0.875rem;
  color: var(--c-text-muted);
  display: flex;
  flex-direction: column;
  gap: 6px;
}
</style>
