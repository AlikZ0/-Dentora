import { computed, ref } from 'vue'

/**
 * Registry of open modals.
 *
 * Dialogs stack: the import sheet opens a confirmation on top of itself. Each
 * one used to manage `body.overflow` and the Escape key on its own, so closing
 * the inner dialog unlocked scrolling behind the outer one, and Escape closed
 * both at once. A single shared stack fixes both, and makes paint order
 * explicit instead of depending on which component mounted first.
 */

const BASE_Z_INDEX = 200

const stack = ref<number[]>([])
let nextId = 1

function applyScrollLock(): void {
  if (typeof document === 'undefined') return
  document.body.style.overflow = stack.value.length > 0 ? 'hidden' : ''
}

export function useModalStack() {
  const id = nextId++

  const index = computed(() => stack.value.indexOf(id))
  /** Only the topmost dialog reacts to Escape and traps focus. */
  const isTop = computed(() => stack.value[stack.value.length - 1] === id)
  /** Later dialogs paint above earlier ones regardless of DOM order. */
  const zIndex = computed(() => BASE_Z_INDEX + Math.max(0, index.value) * 2)

  function enter(): void {
    if (!stack.value.includes(id)) stack.value = [...stack.value, id]
    applyScrollLock()
  }

  function leave(): void {
    if (!stack.value.includes(id)) return
    stack.value = stack.value.filter((entry) => entry !== id)
    applyScrollLock()
  }

  return { isTop, zIndex, enter, leave }
}

/** Test hook: drop any registration left behind by a crashed component. */
export function resetModalStack(): void {
  stack.value = []
  applyScrollLock()
}
