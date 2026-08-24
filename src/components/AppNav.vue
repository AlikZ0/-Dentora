<script setup lang="ts">
import { useAppStore } from '~/stores/app'

const app = useAppStore()

const items = [
  { to: '/', label: 'Главная', short: 'Главная', icon: '\u{1F3E0}' },
  { to: '/clients', label: 'Клиенты', short: 'Клиенты', icon: '\u{1F465}' },
  { to: '/schedule', label: 'Визиты', short: 'Визиты', icon: '\u{1F4C5}' },
  { to: '/backup', label: 'Backup', short: 'Backup', icon: '\u{1F4E6}' },
  { to: '/settings', label: 'Настройки', short: 'Ещё', icon: '\u{2699}\u{FE0F}' },
]
</script>

<template>
  <!-- Desktop / tablet: persistent sidebar -->
  <nav class="sidebar" aria-label="Основная навигация">
    <NuxtLink to="/" class="brand">
      <span class="brand-mark" aria-hidden="true">D</span>
      <span class="brand-name">Dentora</span>
    </NuxtLink>

    <ul class="sidebar-list">
      <li v-for="item in items" :key="item.to">
        <NuxtLink :to="item.to" class="sidebar-link">
          <span class="sidebar-icon" aria-hidden="true">{{ item.icon }}</span>
          <span>{{ item.label }}</span>
        </NuxtLink>
      </li>
    </ul>

    <div class="sidebar-foot">
      <p v-if="!app.online" class="offline-pill">Офлайн — всё работает</p>
      <p class="tiny faint">Данные хранятся только на этом устройстве</p>
    </div>
  </nav>

  <!-- Phones: bottom tab bar -->
  <nav class="bottom-nav" aria-label="Основная навигация">
    <NuxtLink v-for="item in items" :key="item.to" :to="item.to" class="tab">
      <span class="tab-icon" aria-hidden="true">{{ item.icon }}</span>
      <span class="tab-label">{{ item.short }}</span>
    </NuxtLink>
  </nav>
</template>

<style scoped>
/* ---------- Sidebar (>= 861 px) ---------- */
.sidebar {
  display: none;
}

@media (min-width: 861px) {
  .sidebar {
    display: flex;
    flex-direction: column;
    gap: 6px;
    position: fixed;
    inset: 0 auto 0 0;
    width: var(--sidebar-w);
    padding: 16px 12px calc(16px + var(--safe-bottom));
    padding-left: calc(12px + var(--safe-left));
    background: var(--c-surface);
    border-right: 1px solid var(--c-border);
    z-index: 50;
  }
}

.brand {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px 16px;
  color: var(--c-text);
}

.brand-mark {
  width: 32px;
  height: 32px;
  border-radius: 9px;
  background: var(--c-primary);
  color: var(--c-on-primary);
  display: grid;
  place-items: center;
  font-weight: 700;
}

.brand-name {
  font-weight: 650;
  font-size: 1.0625rem;
  letter-spacing: -0.01em;
}

.sidebar-list {
  list-style: none;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 1;
}

.sidebar-link {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: var(--touch);
  padding: 0 12px;
  border-radius: var(--radius);
  color: var(--c-text-muted);
  font-weight: 500;
}

.sidebar-link:hover {
  background: var(--c-surface-2);
  color: var(--c-text);
}

.sidebar-link.router-link-active {
  background: var(--c-primary-soft);
  color: var(--c-primary);
  font-weight: 600;
}

.sidebar-icon {
  font-size: 1.05rem;
  width: 22px;
  text-align: center;
}

.sidebar-foot {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px 10px 0;
  border-top: 1px solid var(--c-border);
}

.offline-pill {
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--c-warning);
  background: var(--c-warning-soft);
  padding: 4px 8px;
  border-radius: 999px;
  align-self: flex-start;
}

/* ---------- Bottom nav (<= 860 px) ---------- */
.bottom-nav {
  position: fixed;
  inset: auto 0 0 0;
  display: flex;
  background: color-mix(in srgb, var(--c-surface) 92%, transparent);
  backdrop-filter: blur(12px);
  border-top: 1px solid var(--c-border);
  /* The home indicator lives inside this padding. */
  padding-bottom: var(--safe-bottom);
  padding-left: var(--safe-left);
  padding-right: var(--safe-right);
  z-index: 100;
}

@media (min-width: 861px) {
  .bottom-nav { display: none; }
}

.tab {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  min-height: var(--bottom-nav-h);
  color: var(--c-text-faint);
  font-size: 0.6875rem;
  font-weight: 550;
  -webkit-tap-highlight-color: transparent;
}

.tab-icon {
  font-size: 1.25rem;
  line-height: 1;
}

.tab.router-link-active {
  color: var(--c-primary);
}

/* Landscape phones are short: shrink the bar rather than eating the content. */
@media (max-height: 480px) and (orientation: landscape) {
  .tab { flex-direction: row; gap: 6px; min-height: 44px; }
  .tab-icon { font-size: 1rem; }
}
</style>
