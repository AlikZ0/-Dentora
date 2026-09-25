import { useToasts } from '~/composables/useToasts'
import { useAppStore } from '~/stores/app'
import { connect, isConnected } from '~/services/google/calendar'
import { googleSyncConfigured, syncToGoogle } from '~/services/google/sync'

/**
 * Called after a visit is created, edited, cancelled or deleted. Runs in the
 * background: the local save already succeeded, so a Google failure is a
 * warning, never an error that undoes anything.
 */
export function useGoogleSync() {
  const toasts = useToasts()
  const app = useAppStore()
  const config = useRuntimeConfig()

  async function pushVisit(id: string): Promise<void> {
    const settings = app.settings
    if (!googleSyncConfigured(settings)) return
    if (!navigator.onLine) return

    // The token lives about an hour. Still inside the Save click, Google can
    // usually renew it with a popup that closes by itself.
    if (!isConnected(settings.googleEmail)) {
      try {
        await connect(settings.googleClientId || String(config.public.googleClientId || ''), settings.googleEmail)
      } catch {
        toasts.warning(
          'Визит сохранён, но Google Календарь не подключён. Настройки → Google Календарь → «Подключить».',
        )
        return
      }
    }

    const result = await syncToGoogle([id])
    if (result.error) toasts.warning(result.error)
  }

  return { pushVisit }
}
