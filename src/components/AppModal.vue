<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from 'vue'

const props = withDefaults(
  defineProps<{
    open: boolean
    title?: string
    /** Full-height sheet on phones; centred dialog on desktop. */
    sheet?: boolean
    dismissible?: boolean
  }>(),
  { dismissible: true, sheet: true },
)

const emit = defineEmits<{ close: [] }>()
const panel = ref<HTMLElement | null>(null)

function requestClose(): void {
  if (props.dismissible) emit('close')
}

function onKeydown(event: KeyboardEvent): void {
  if (!props.open) return
  if (event.key === 'Escape') {
    requestClose()
    return
  }
  // Keep tab focus inside the dialog.
  if (event.key !== 'Tab' || !panel.value) return
  const focusable = panel.value.querySelectorAll<HTMLElement>(
    'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
  )
  if (!focusable.length) return
  const first = focusable[0]!
  const last = focusable[focusable.length - 1]!
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault()
    first.focus()
  }
}

watch(
  () => props.open,
  (open) => {
    if (typeof document === 'undefined') return
    // Locking the body avoids the iOS "scroll the page behind the sheet" bug.
    document.body.style.overflow = open ? 'hidden' : ''
    if (open) {
      requestAnimationFrame(() => {
        panel.value?.querySelector<HTMLElement>('[autofocus], input, button')?.focus()
      })
    }
  },
)

onMounted(() => document.addEventListener('keydown', onKeydown))
onUnmounted(() => {
  document.removeEventListener('keydown', onKeydown)
  document.body.style.overflow = ''
})
</script>

<template>
  <Teleport to="body">
    <Transition name="modal">
      <div v-if="open" class="backdrop" @click.self="requestClose">
        <div
          ref="panel"
          :class="['panel', { 'panel-sheet': sheet }]"
          role="dialog"
          aria-modal="true"
          :aria-label="title"
        >
          <header v-if="title || dismissible" class="panel-header">
            <h2 class="panel-title">{{ title }}</h2>
            <button v-if="dismissible" class="panel-close" aria-label="Закрыть" @click="requestClose">
              &#10005;
            </button>
          </header>
          <div class="panel-body">
            <slot />
          </div>
          <footer v-if="$slots.footer" class="panel-footer">
            <slot name="footer" />
          </footer>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.backdrop {
  position: fixed;
  inset: 0;
  background: rgb(8 12 18 / 0.55);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  z-index: 200;
  backdrop-filter: blur(2px);
}

.panel {
  background: var(--c-surface);
  border-radius: var(--radius-xl);
  box-shadow: var(--shadow-lg);
  width: min(520px, 100%);
  max-height: min(86dvh, 760px);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.panel-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 16px 16px 8px;
}

.panel-title {
  font-size: 1.0625rem;
  flex: 1;
  min-width: 0;
}

.panel-close {
  width: var(--touch);
  height: var(--touch);
  display: grid;
  place-items: center;
  border-radius: 50%;
  color: var(--c-text-muted);
  font-size: 1rem;
  flex-shrink: 0;
}
.panel-close:hover {
  background: var(--c-surface-2);
  color: var(--c-text);
}

.panel-body {
  padding: 8px 16px 16px;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  flex: 1;
}

.panel-footer {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
  padding: 12px 16px;
  border-top: 1px solid var(--c-border);
  background: var(--c-surface-2);
}

.modal-enter-active,
.modal-leave-active {
  transition: opacity 0.18s ease;
}
.modal-enter-active .panel,
.modal-leave-active .panel {
  transition: transform 0.2s ease;
}
.modal-enter-from,
.modal-leave-to {
  opacity: 0;
}
.modal-enter-from .panel,
.modal-leave-to .panel {
  transform: translateY(12px) scale(0.98);
}

/* Phones: dock the dialog to the bottom as a sheet, clearing the home indicator. */
@media (max-width: 640px) {
  .backdrop {
    align-items: flex-end;
    padding: 0;
  }
  .panel-sheet {
    width: 100%;
    max-height: 92dvh;
    border-radius: var(--radius-xl) var(--radius-xl) 0 0;
    padding-bottom: var(--safe-bottom);
  }
  .panel-sheet .panel-footer {
    padding-bottom: 12px;
  }
  .modal-enter-from .panel,
  .modal-leave-to .panel {
    transform: translateY(100%);
  }
  .panel-sheet::before {
    content: '';
    display: block;
    width: 36px;
    height: 4px;
    border-radius: 2px;
    background: var(--c-border-strong);
    margin: 8px auto 0;
    flex-shrink: 0;
  }
}
</style>
