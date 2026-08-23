<script setup lang="ts">
import { onMounted } from 'vue'
import { useAppStore } from '~/stores/app'
import { usePwa } from '~/composables/usePwa'
import { useToasts } from '~/composables/useToasts'
import { formatBytes } from '~/utils/format'

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

async function install(): Promise<void> {
  const accepted = await pwa.install()
  if (accepted) toasts.success('Приложение установлено')
}

onMounted(() => app.refreshAll())
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
      <p class="card-title">Напоминания</p>
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
