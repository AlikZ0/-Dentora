import type { BackupFileEntry, MergeReport } from '~/types/backup'
import type { Appointment, Client, StoredFile, Work } from '~/types/models'

/**
 * Merge policy.
 *
 * Identity is the UUID, which is stable across export/import - that is the
 * whole reason entities carry one. Conflicts are resolved last-write-wins on
 * `updatedAt`; a tie keeps the local row, so re-importing the very backup you
 * just made is a no-op rather than a churn of rewrites.
 */

export type MergeDecision = 'add' | 'update' | 'skip'

export interface Timestamped {
  id: string
  updatedAt: string
}

export function decide(local: Timestamped | undefined, incoming: Timestamped): MergeDecision {
  if (!local) return 'add'
  // String compare is correct for ISO-8601 in UTC, which is what we always write.
  if (incoming.updatedAt > local.updatedAt) return 'update'
  return 'skip'
}

export function emptyReport(): MergeReport {
  return {
    clientsAdded: 0,
    clientsUpdated: 0,
    clientsSkipped: 0,
    worksAdded: 0,
    worksUpdated: 0,
    worksSkipped: 0,
    appointmentsAdded: 0,
    appointmentsUpdated: 0,
    appointmentsSkipped: 0,
    filesAdded: 0,
    filesUpdated: 0,
    filesSkipped: 0,
  }
}

export interface MergePlan<T> {
  add: T[]
  update: T[]
  skipped: number
}

function planFor<T extends Timestamped>(incoming: T[], localById: Map<string, Timestamped>): MergePlan<T> {
  const plan: MergePlan<T> = { add: [], update: [], skipped: 0 }
  for (const row of incoming) {
    switch (decide(localById.get(row.id), row)) {
      case 'add':
        plan.add.push(row)
        break
      case 'update':
        plan.update.push(row)
        break
      default:
        plan.skipped += 1
    }
  }
  return plan
}

export function planClients(incoming: Client[], local: Client[]): MergePlan<Client> {
  return planFor(incoming, new Map(local.map((c) => [c.id, c])))
}

export function planWorks(incoming: Work[], local: Work[]): MergePlan<Work> {
  return planFor(incoming, new Map(local.map((w) => [w.id, w])))
}

export function planAppointments(
  incoming: Appointment[],
  local: Appointment[],
): MergePlan<Appointment> {
  return planFor(incoming, new Map(local.map((a) => [a.id, a])))
}

export function planFiles(
  incoming: BackupFileEntry[],
  local: StoredFile[],
): MergePlan<BackupFileEntry> {
  return planFor(incoming, new Map(local.map((f) => [f.id, f])))
}

/**
 * Per-file decision taken while the archive streams past, so we never hold
 * more than one payload in memory.
 *
 * `needsBytes` is false when the local row already has identical content
 * (same hash) - the metadata may still need refreshing, but re-writing a
 * 60 MB blob would be pure waste.
 */
export function decideFile(
  incoming: BackupFileEntry,
  local: StoredFile | undefined,
): { decision: MergeDecision; needsBytes: boolean } {
  const decision = decide(local, incoming)
  if (decision === 'skip') return { decision, needsBytes: false }
  if (decision === 'add') return { decision, needsBytes: true }
  const sameBytes = Boolean(incoming.hash && local?.hash && incoming.hash === local.hash)
  return { decision, needsBytes: !sameBytes }
}
