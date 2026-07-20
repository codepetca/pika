export type AssignmentHistorySeedEntry = {
  assignment_doc_id: string
  trigger: string
  created_at: string
  snapshot: unknown
}

export type AssignmentHistorySeedSubmission = {
  assignmentDocId: string
  submittedAt: string
}

export function ensureSeedTimestampAfter(candidate: string, preceding: string): string {
  const candidateMs = Date.parse(candidate)
  const precedingMs = Date.parse(preceding)
  if (!Number.isFinite(candidateMs) || !Number.isFinite(precedingMs)) {
    throw new Error('Seed assignment chronology requires valid timestamps')
  }

  return new Date(Math.max(candidateMs, precedingMs + 60_000)).toISOString()
}

export function splitAssignmentHistoryAtSubmission<
  TEntry extends AssignmentHistorySeedEntry,
>(entries: readonly TEntry[]): {
  historyEntries: TEntry[]
  submission: AssignmentHistorySeedSubmission | null
} {
  const submitIndex = entries.findIndex(entry => entry.trigger === 'submit')

  if (submitIndex === -1) {
    return { historyEntries: [...entries], submission: null }
  }

  if (submitIndex !== entries.length - 1) {
    throw new Error('Seed assignment submit history must be the final entry')
  }

  const submitEntry = entries[submitIndex]!
  if (submitEntry.snapshot == null) {
    throw new Error('Seed assignment submit history requires a snapshot')
  }

  return {
    historyEntries: entries.slice(0, submitIndex),
    submission: {
      assignmentDocId: submitEntry.assignment_doc_id,
      submittedAt: submitEntry.created_at,
    },
  }
}
