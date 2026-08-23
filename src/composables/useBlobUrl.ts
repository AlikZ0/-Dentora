import { onScopeDispose, ref, type Ref } from 'vue'

/**
 * Object URLs with guaranteed revocation.
 *
 * A leaked object URL pins its Blob in memory for the lifetime of the
 * document - with 60 MB x-rays that is how a tab reaches a gigabyte and gets
 * killed by iOS. Every URL created here is revoked when it is replaced and
 * when the owning component unmounts.
 */
export function useBlobUrl() {
  const url: Ref<string | null> = ref(null)

  function release(): void {
    if (url.value) {
      URL.revokeObjectURL(url.value)
      url.value = null
    }
  }

  function set(blob: Blob | null | undefined): string | null {
    release()
    if (!blob) return null
    url.value = URL.createObjectURL(blob)
    return url.value
  }

  onScopeDispose(release)
  return { url, set, release }
}
