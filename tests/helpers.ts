import { DentoraDatabase } from '~/database/db'
import { createClientRepository } from '~/database/repositories/clients'
import { createWorkRepository } from '~/database/repositories/works'
import { createFileRepository } from '~/database/repositories/files'
import { createMetaRepository } from '~/database/repositories/meta'

let counter = 0

/** A fresh, isolated database per test. */
export function freshDatabase(): DentoraDatabase {
  counter += 1
  return new DentoraDatabase(`dentora-test-${counter}-${Math.random().toString(36).slice(2)}`)
}

export function repositories(database: DentoraDatabase) {
  return {
    database,
    clients: createClientRepository(database),
    works: createWorkRepository(database),
    files: createFileRepository(database),
    meta: createMetaRepository(database),
  }
}

export type Repos = ReturnType<typeof repositories>

export function imageBlob(size = 128, fill = 3): Blob {
  return new Blob([new Uint8Array(size).fill(fill)], { type: 'image/jpeg' })
}

/** Cheap KDF so encryption tests stay fast. */
export const TEST_ITERATIONS = 1_000
