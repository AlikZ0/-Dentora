<script setup lang="ts">
import { onMounted } from 'vue'
import { useAppStore } from '~/stores/app'
import { usePwa } from '~/composables/usePwa'
import { useToasts } from '~/composables/useToasts'
import { formatBytes } from '~/utils/format'
import { REMINDER_CHOICES } from '~/types/models'
import { notificationsSupported } from '~/services/notifications/notifications'
import { showNotification } from '~/services/notifications/notifications'

useHead({ title: 'Настройки — Dentora' })

const app = useAppStore()
const toasts = useToasts()
const pwa = usePwa()
const config = useRuntimeConfig()

async function toggleReminder(value: boolean): Promise<void> {
  try {
    await app.saveSettings({ dailyBackupReminder: value })
  } catch (error) {
    toasts.error(error, 'settings.save')
  }
}

/**
 * The permission prompt must run inside this click - browsers ignore a
 * request made later, from a timer or a promise chain the user did not start.
 */
async function toggleAppointmentNotifications(value: boolean): Promise<void> {
  try {
    const state = await app.setAppointmentNotifications(value)
    if (!value) {
      toasts.info('Напоминания о визитах выключены')
    } else if (state === 'granted') {
      toasts.success('Напоминания о визитах включены')
    } else if (state === 'denied') {
      toasts.warning(
        'Браузер заблокировал уведомления. Разрешите их для этого сайта в настройках браузера.',
      )
    } else if (state === 'unsupported') {
      toasts.warning('Этот браузер не поддерживает уведомления.')
    } else {
      toasts.info('Разрешение на уведомления не выдано.')
    }
  } catch (error) {
    toasts.error(error, 'settings.notifications')
  }
}

async function setLeadTime(minutes: number): Promise<void> {
  try {
    await app.saveSettings({ defaultRemindMinutesBefore: minutes })
  } catch (error) {
    toasts.error(error, 'settings.save')
  }
}

async function toggleAgenda(value: boolean): Promise<void> {
  try {
    await app.saveSettings({ dailyAgenda: value })
  } catch (error) {
    toasts.error(error, 'settings.save')
  }
}

async function sendTestNotification(): Promise<void> {
  const ok = await showNotification({
    title: 'Проверка уведомлений',
    body: 'Так будет выглядеть напоминание о визите.',
    tag: 'test-notification',
    url: '/schedule',
  })
  if (ok) toasts.success('Уведомление отправлено')
  else toasts.warning('Не удалось показать уведомление на этом устройстве.')
}

async function install(): Promise<void> {
  const accepted = await pwa.install()
  if (accepted) toasts.success('Приложение установлено')
}

onMounted(async () => {
  await app.refreshAll()
  app.refreshNotificationState()
})
</script>

<template>
  <div class="page page-narrow">
    <header class="page-header">
      <div class="page-title">
        <h1>Настройки</h1>
        <p class="page-subtitle">Хранилище, установка и данные</p>
      </div>
    </header>

    <nav class="card links" aria-label="Разделы настроек">
      <NuxtLink to="/settings/storage" class="link-row">
        <span>
          <span class="strong">Хранилище</span>
          <span class="tiny muted">
            {{ formatBytes(app.storage.usage) }} использовано · {{ app.counts.files }} файлов
          </span>
        </span>
        <span class="chevron" aria-hidden="true">&rsaquo;</span>
      </NuxtLink>

      <NuxtLink to="/schedule" class="link-row">
        <span>
          <span class="strong">Визиты</span>
          <span class="tiny muted">
            Сегодня: {{ app.agenda.today.length }} · завтра: {{ app.agenda.tomorrow.length }}
          </span>
        </span>
        <span class="chevron" aria-hidden="true">&rsaquo;</span>
      </NuxtLink>

      <NuxtLink to="/settings/trash" class="link-row">
        <span>
          <span class="strong">Корзина</span>
          <span class="tiny muted">Восстановление удалённых клиентов</span>
        </span>
        <span class="chevron" aria-hidden="true">&rsaquo;</span>
      </NuxtLink>

      <NuxtLink to="/backup" class="link-row">
        <span>
          <span class="strong">Backup</span>
          <span class="tiny muted">Экспорт и импорт всей базы</span>
        </span>
        <span class="chevron" aria-hidden="true">&rsaquo;</span>
      </NuxtLink>
    </nav>

    <section class="card">
      <p class="card-title">Уведомления о визитах</p>

      <label class="toggle">
        <span>
          <span class="strong">Напоминать о визитах</span>
          <span class="tiny muted">
            Системное уведомление перед приёмом запланированного клиента
          </span>
        </span>
        <input
          type="checkbox"
          :checked="app.settings.appointmentNotifications"
          :disabled="!notificationsSupported()"
          @change="toggleAppointmentNotifications(($event.target as HTMLInputElement).checked)"
        />
      </label>

      <p v-if="!notificationsSupported()" class="status status-warn">
        Этот браузер не поддерживает уведомления. Визиты всё равно видны в разделе «Визиты».
      </p>
      <p v-else-if="app.notificationState === 'denied'" class="status status-warn">
        Уведомления заблокированы для этого сайта. Разрешите их в настройках браузера
        (значок замка рядом с адресом), затем включите переключатель снова.
      </p>
      <p v-else-if="app.notificationsActive" class="status status-ok">
        Уведомления разрешены.
      </p>

      <template v-if="app.settings.appointmentNotifications">
        <hr class="divider" />

        <div class="setting">
          <label class="setting-label" for="leadTime">
            <span class="strong">За сколько напоминать</span>
            <span class="tiny muted">Значение по умолчанию для новых визитов</span>
          </label>
          <select
            id="leadTime"
            class="select"
            :value="app.settings.defaultRemindMinutesBefore"
            @change="setLeadTime(Number(($event.target as HTMLSelectElement).value))"
          >
            <option v-for="choice in REMINDER_CHOICES" :key="choice.value" :value="choice.value">
              {{ choice.label }}
            </option>
          </select>
        </div>

        <label class="toggle">
          <span>
            <span class="strong">Сводка на день</span>
            <span class="tiny muted">
              Один раз при первом открытии показывать, сколько визитов сегодня
            </span>
          </span>
          <input
            type="checkbox"
            :checked="app.settings.dailyAgenda"
            @change="toggleAgenda(($event.target as HTMLInputElement).checked)"
          />
        </label>

        <button v-if="app.notificationsActive" class="test-btn" @click="sendTestNotification">
          Проверить уведомление
        </button>
      </template>

      <p class="limitation tiny">
        Напоминания приходят, пока приложение открыто или свёрнуто. Приложение работает
        без сервера, поэтому доставить уведомление при полностью закрытом приложении
        браузер не может — держите Dentora открытой в фоне или заглядывайте в раздел
        «Визиты».
      </p>
    </section>

    <section class="card">
      <p class="card-title">Напоминания о backup</p>
      <label class="toggle">
        <span>
          <span class="strong">Напоминать о backup раз в день</span>
          <span class="tiny muted">
            Ненавязчивый баннер, если сегодня backup ещё не создавался
          </span>
        </span>
        <input
          type="checkbox"
          :checked="app.settings.dailyBackupReminder"
          @change="toggleReminder(($event.target as HTMLInputElement).checked)"
        />
      </label>
    </section>

    <section class="card">
      <p class="card-title">Установка на устройство</p>

      <p v-if="pwa.standalone.value" class="small text-success">
        Приложение уже установлено и запущено в отдельном окне.
      </p>

      <template v-else-if="pwa.needsManualInstructions()">
        <p class="small muted">Чтобы установить приложение на iPhone или iPad:</p>
        <ol class="steps">
          <li>Откройте это приложение в Safari.</li>
          <li>Нажмите кнопку «Поделиться» внизу экрана.</li>
          <li>Выберите «На экран «Домой»».</li>
          <li>Нажмите «Добавить».</li>
        </ol>
        <p class="tiny faint">
          После установки приложение открывается как отдельное приложение и работает офлайн.
          Установка также защищает данные от автоматической очистки Safari.
        </p>
      </template>

      <template v-else-if="pwa.canInstall.value">
        <p class="small muted">Установите приложение, чтобы работать офлайн и без адресной строки.</p>
        <button class="install-btn" @click="install">Установить приложение</button>
      </template>

      <p v-else class="small muted">
        Откройте меню браузера и выберите «Установить приложение» / «Add to Home Screen».
      </p>
    </section>

    <section class="card">
      <p class="card-title">Приватность</p>
      <ul class="privacy">
        <li>Все данные хранятся только в этом браузере, в IndexedDB.</li>
        <li>Приложение не отправляет данные на серверы и не использует аналитику.</li>
        <li>Файлы не публикуются по внешним ссылкам.</li>
        <li>Единственный способ передать данные — backup-файл, который вы создаёте сами.</li>
      </ul>
    </section>

    <p class="version tiny faint">Dentora {{ config.public.appVersion }}</p>
  </div>
</template>

<style scoped>
.page-narrow { max-width: 720px; }

.status {
  margin-top: 10px;
  padding: 10px 12px;
  border-radius: var(--radius);
  font-size: 0.875rem;
}
.status-warn { background: var(--c-warning-soft); }
.status-ok { background: var(--c-success-soft); color: var(--c-text); }

.setting {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-height: var(--touch);
  margin-bottom: 4px;
}

.setting-label {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.select {
  min-height: var(--touch);
  padding: 8px 12px;
  border-radius: var(--radius);
  border: 1px solid var(--c-border-strong);
  background: var(--c-surface);
  font-size: 16px;
  flex-shrink: 0;
  -webkit-appearance: none;
  appearance: none;
}

.test-btn {
  margin-top: 10px;
  min-height: var(--touch);
  width: 100%;
  border-radius: var(--radius);
  border: 1px solid var(--c-border-strong);
  background: var(--c-surface);
  font-weight: 550;
}

.limitation {
  margin-top: 12px;
  color: var(--c-text-faint);
  line-height: 1.5;
}

@media (max-width: 480px) {
  .setting { flex-direction: column; align-items: stretch; }
  .select { width: 100%; }
}
.card + .card { margin-top: 16px; }

.links {
  padding: 4px 12px;
}

.link-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-height: 60px;
  padding: 10px 0;
  color: inherit;
  border-bottom: 1px solid var(--c-border);
}

.link-row:last-child { border-bottom: 0; }

.link-row > span:first-child {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.chevron {
  color: var(--c-text-faint);
  font-size: 1.35rem;
  line-height: 1;
}

.toggle {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-height: var(--touch);
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

.steps {
  margin: 8px 0;
  padding-left: 22px;
  font-size: 0.9375rem;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.install-btn {
  margin-top: 10px;
  min-height: var(--touch);
  width: 100%;
  border-radius: var(--radius);
  background: var(--c-primary);
  color: var(--c-on-primary);
  font-weight: 600;
}

.privacy {
  margin: 0;
  padding-left: 20px;
  font-size: 0.875rem;
  color: var(--c-text-muted);
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.version {
  text-align: center;
  margin-top: 20px;
}
</style>
