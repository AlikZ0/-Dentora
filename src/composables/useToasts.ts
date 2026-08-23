import { ref } from 'vue'
import { toTechnical, toUserMessage } from '~/utils/errors'
import { logger } from '~/utils/logger'

export type ToastKind = 'info' | 'success' | 'error' | 'warning'

export interface Toast {
  id: number
  kind: ToastKind
  message: string
  /** Optional inline action, e.g. "Отменить". */
  action?: { label: string; run: () => void }
}

const toasts = ref<Toast[]>([])
let nextId = 1

function push(kind: ToastKind, message: string, action?: Toast['action'], ttl = 4500): number {
  const id = nextId++
  toasts.value = [...toasts.value, { id, kind, message, action }]
  if (ttl > 0) setTimeout(() => dismiss(id), ttl)
  return id
}

function dismiss(id: number): void {
  toasts.value = toasts.value.filter((t) => t.id !== id)
}

/**
 * App-wide toast queue. `error()` is the only place that turns a thrown value
 * into text, so no raw DOMException ever reaches the screen.
 */
export function useToasts() {
  return {
    toasts,
    dismiss,
    info: (message: string, action?: Toast['action']) => push('info', message, action),
    success: (message: string, action?: Toast['action']) => push('success', message, action),
    warning: (message: string, action?: Toast['action']) => push('warning', message, action, 6000),
    error: (error: unknown, scope = 'app') => {
      logger.error(scope, toTechnical(error))
      return push('error', toUserMessage(error), undefined, 7000)
    },
    /** Show a literal message as an error without going through the mapper. */
    errorText: (message: string) => push('error', message, undefined, 7000),
  }
}
