import { onMounted, onUnmounted, ref } from 'vue'
import { isIos, isStandalone } from '~/services/files/download'

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

const deferredPrompt = ref<BeforeInstallPromptEvent | null>(null)
const installed = ref(false)

/**
 * Install affordances.
 *
 * Android/Chromium fire `beforeinstallprompt`, so we can show a real button.
 * iOS has no such event - the only route is Share -> "На экран «Домой»", so
 * there we show instructions instead of a button.
 */
export function usePwa() {
  const standalone = ref(false)
  const ios = ref(false)

  function onBeforeInstall(event: Event): void {
    event.preventDefault()
    deferredPrompt.value = event as BeforeInstallPromptEvent
  }

  function onInstalled(): void {
    installed.value = true
    deferredPrompt.value = null
  }

  onMounted(() => {
    standalone.value = isStandalone()
    ios.value = isIos()
    window.addEventListener('beforeinstallprompt', onBeforeInstall)
    window.addEventListener('appinstalled', onInstalled)
  })

  onUnmounted(() => {
    window.removeEventListener('beforeinstallprompt', onBeforeInstall)
    window.removeEventListener('appinstalled', onInstalled)
  })

  async function install(): Promise<boolean> {
    const prompt = deferredPrompt.value
    if (!prompt) return false
    await prompt.prompt()
    const { outcome } = await prompt.userChoice
    deferredPrompt.value = null
    return outcome === 'accepted'
  }

  return {
    canInstall: deferredPrompt,
    installed,
    standalone,
    ios,
    install,
    /** iOS cannot be prompted; the UI has to explain the Share-sheet route. */
    needsManualInstructions: () => ios.value && !standalone.value,
  }
}
