import { computed, ref, type Ref } from 'vue'

export interface PanZoomState {
  scale: number
  x: number
  y: number
  rotation: number
}

const MIN_SCALE = 1
const MAX_SCALE = 8
const DOUBLE_TAP_MS = 300
const DOUBLE_TAP_SLOP = 24

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/**
 * Pointer-event driven pan / pinch-zoom / rotate.
 *
 * Pointer events cover mouse, trackpad, pen and touch with one code path, and
 * are supported by every browser we target (Safari 13+). The container must
 * set `touch-action: none` so iOS does not hijack the gesture for its own
 * page zoom.
 */
export function usePanZoom(container: Ref<HTMLElement | null>) {
  const scale = ref(1)
  const x = ref(0)
  const y = ref(0)
  const rotation = ref(0)

  const pointers = new Map<number, { x: number; y: number }>()
  let pinchStartDistance = 0
  let pinchStartScale = 1
  let panStart: { x: number; y: number; originX: number; originY: number } | null = null
  let lastTap = { time: 0, x: 0, y: 0 }

  const transform = computed(
    () =>
      `translate3d(${x.value}px, ${y.value}px, 0) scale(${scale.value}) rotate(${rotation.value}deg)`,
  )

  const isZoomed = computed(() => scale.value > 1.001)

  function reset(): void {
    scale.value = 1
    x.value = 0
    y.value = 0
    rotation.value = 0
  }

  function rotate(delta = 90): void {
    rotation.value = (rotation.value + delta) % 360
  }

  /** Keeps the image from being dragged entirely off-screen. */
  function clampOffset(): void {
    const element = container.value
    if (!element) return
    const rect = element.getBoundingClientRect()
    const limitX = (rect.width * (scale.value - 1)) / 2
    const limitY = (rect.height * (scale.value - 1)) / 2
    x.value = clamp(x.value, -limitX, limitX)
    y.value = clamp(y.value, -limitY, limitY)
  }

  /** Zooms toward a point in client coordinates, so the pixel under the finger stays put. */
  function zoomTo(nextScale: number, clientX?: number, clientY?: number): void {
    const element = container.value
    const previous = scale.value
    const target = clamp(nextScale, MIN_SCALE, MAX_SCALE)
    if (target === previous) return

    if (element && clientX !== undefined && clientY !== undefined) {
      const rect = element.getBoundingClientRect()
      const originX = clientX - rect.left - rect.width / 2
      const originY = clientY - rect.top - rect.height / 2
      const ratio = target / previous
      x.value = originX - (originX - x.value) * ratio
      y.value = originY - (originY - y.value) * ratio
    }

    scale.value = target
    if (target === MIN_SCALE) {
      x.value = 0
      y.value = 0
    } else {
      clampOffset()
    }
  }

  function zoomIn(): void {
    zoomTo(scale.value * 1.5)
  }

  function zoomOut(): void {
    zoomTo(scale.value / 1.5)
  }

  function distance(a: { x: number; y: number }, b: { x: number; y: number }): number {
    return Math.hypot(a.x - b.x, a.y - b.y)
  }

  function onPointerDown(event: PointerEvent): void {
    // Capture keeps the gesture alive when a finger leaves the element, but it
    // throws for a pointer id the element does not own. That must never abort
    // the gesture, so failures are ignored.
    try {
      ;(event.currentTarget as HTMLElement)?.setPointerCapture?.(event.pointerId)
    } catch {
      /* capture is an optimisation, not a requirement */
    }
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY })

    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()]
      pinchStartDistance = distance(a!, b!)
      pinchStartScale = scale.value
      panStart = null
      return
    }

    // Double tap / double click toggles between fit and 2.5x.
    const now = Date.now()
    if (
      now - lastTap.time < DOUBLE_TAP_MS &&
      Math.hypot(event.clientX - lastTap.x, event.clientY - lastTap.y) < DOUBLE_TAP_SLOP
    ) {
      if (isZoomed.value) reset()
      else zoomTo(2.5, event.clientX, event.clientY)
      lastTap = { time: 0, x: 0, y: 0 }
      return
    }
    lastTap = { time: now, x: event.clientX, y: event.clientY }

    panStart = { x: event.clientX, y: event.clientY, originX: x.value, originY: y.value }
  }

  function onPointerMove(event: PointerEvent): void {
    if (!pointers.has(event.pointerId)) return
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY })

    if (pointers.size >= 2) {
      const [a, b] = [...pointers.values()]
      if (!pinchStartDistance) return
      const next = (distance(a!, b!) / pinchStartDistance) * pinchStartScale
      zoomTo(next, (a!.x + b!.x) / 2, (a!.y + b!.y) / 2)
      return
    }

    if (!panStart || !isZoomed.value) return
    x.value = panStart.originX + (event.clientX - panStart.x)
    y.value = panStart.originY + (event.clientY - panStart.y)
    clampOffset()
  }

  function onPointerUp(event: PointerEvent): void {
    try {
      ;(event.currentTarget as HTMLElement)?.releasePointerCapture?.(event.pointerId)
    } catch {
      /* never captured */
    }
    pointers.delete(event.pointerId)
    if (pointers.size < 2) pinchStartDistance = 0
    if (pointers.size === 0) panStart = null
  }

  function onWheel(event: WheelEvent): void {
    // Trackpad pinch arrives as ctrl+wheel; plain wheel also zooms here since
    // the viewer owns the whole surface.
    event.preventDefault()
    const factor = Math.exp(-event.deltaY / 400)
    zoomTo(scale.value * factor, event.clientX, event.clientY)
  }

  return {
    scale,
    x,
    y,
    rotation,
    transform,
    isZoomed,
    reset,
    rotate,
    zoomIn,
    zoomOut,
    zoomTo,
    handlers: {
      onPointerdown: onPointerDown,
      onPointermove: onPointerMove,
      onPointerup: onPointerUp,
      onPointercancel: onPointerUp,
      onPointerleave: onPointerUp,
      onWheel,
    },
  }
}
