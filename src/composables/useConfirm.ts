import { ref } from 'vue'

export interface ConfirmRequest {
  title: string
  message?: string
  /** Extra lines rendered as a warning block. */
  details?: string[]
  confirmLabel?: string
  cancelLabel?: string
  danger?: boolean
  /**
   * When set, the user must type this exact string to enable the confirm
   * button. Used for "Удалить все данные".
   */
  requirePhrase?: string
}

interface PendingConfirm extends ConfirmRequest {
  resolve: (ok: boolean) => void
}

const pending = ref<PendingConfirm | null>(null)

/**
 * Promise-based confirmation dialog. `window.confirm` is unusable here: it is
 * blocked inside iOS standalone PWAs in some versions and cannot express a
 * destructive action or a typed phrase.
 */
export function useConfirm() {
  function confirm(request: ConfirmRequest): Promise<boolean> {
    // A second request while one is open resolves the first as cancelled.
    pending.value?.resolve(false)
    return new Promise<boolean>((resolve) => {
      pending.value = { ...request, resolve }
    })
  }

  function settle(ok: boolean): void {
    const current = pending.value
    pending.value = null
    current?.resolve(ok)
  }

  return { pending, confirm, settle }
}
