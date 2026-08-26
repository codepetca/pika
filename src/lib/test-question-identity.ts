import type { TestDraftContent } from '@/types'

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export type PersistedTestQuestionIdentity = {
  id: string
  artifact_id?: string | null
  source_artifact_id?: string | null
}

export type ResolvedTestQuestionIdentity = {
  inputId: string
  portableId: string
  matchingRowId?: string
}

/**
 * UUID text is case-insensitive in PostgreSQL. Normalize it at the application
 * boundary so JavaScript maps and sets preserve the same identity semantics.
 */
export function normalizeTestQuestionIdentity(identity: string): string {
  return UUID_RE.test(identity) ? identity.toLowerCase() : identity
}

export function getPortableTestQuestionIdentity(
  question: PersistedTestQuestionIdentity,
): string {
  return normalizeTestQuestionIdentity(
    question.source_artifact_id ?? question.artifact_id ?? question.id,
  )
}

/**
 * Resolve draft identities without positional or content inference.
 *
 * Portable artifact identities are canonical. An exact persisted row-id match
 * is accepted only as a temporary dual-read path for drafts written before the
 * portable-identity backfill. No source identity is assigned or rewritten.
 */
export function resolveTestQuestionIdentities(
  inputIds: string[],
  persistedQuestions: PersistedTestQuestionIdentity[],
): { ok: true; identities: ResolvedTestQuestionIdentity[] } | { ok: false } {
  const rowIdsByKnownIdentity = new Map<string, Set<string>>()
  const rowsByInternalId = new Map<string, PersistedTestQuestionIdentity>()

  for (const question of persistedQuestions) {
    rowsByInternalId.set(normalizeTestQuestionIdentity(question.id), question)

    for (const identity of new Set([
      question.source_artifact_id,
      question.artifact_id,
    ].filter(Boolean))) {
      const normalizedIdentity = normalizeTestQuestionIdentity(identity as string)
      const rowIds = rowIdsByKnownIdentity.get(normalizedIdentity) ?? new Set<string>()
      rowIds.add(question.id)
      rowIdsByKnownIdentity.set(normalizedIdentity, rowIds)
    }
  }

  const seenInputIds = new Set<string>()
  const matchedRowIds = new Set<string>()
  const identities: ResolvedTestQuestionIdentity[] = []

  for (const rawInputId of inputIds) {
    const inputId = normalizeTestQuestionIdentity(rawInputId)
    if (seenInputIds.has(inputId)) return { ok: false }
    seenInputIds.add(inputId)

    const matchingRowIds = new Set(rowIdsByKnownIdentity.get(inputId) ?? [])
    const internalRow = rowsByInternalId.get(inputId)
    if (internalRow) matchingRowIds.add(internalRow.id)
    if (matchingRowIds.size > 1) return { ok: false }

    const [matchingRowId] = matchingRowIds
    if (matchingRowId) {
      if (matchedRowIds.has(matchingRowId)) return { ok: false }
      matchedRowIds.add(matchingRowId)

      const matchingRow = persistedQuestions.find((row) => row.id === matchingRowId)
      if (!matchingRow) return { ok: false }

      identities.push({
        inputId,
        portableId: getPortableTestQuestionIdentity(matchingRow),
        matchingRowId,
      })
      continue
    }

    identities.push({ inputId, portableId: inputId })
  }

  return { ok: true, identities }
}

export function projectPortableTestQuestionIds(
  content: TestDraftContent,
  persistedQuestions: PersistedTestQuestionIdentity[],
): { ok: true; content: TestDraftContent } | { ok: false } {
  const resolved = resolveTestQuestionIdentities(
    content.questions.map((question) => question.id),
    persistedQuestions,
  )
  if (!resolved.ok) return resolved

  return {
    ok: true,
    content: {
      ...content,
      questions: content.questions.map((question, index) => ({
        ...question,
        id: resolved.identities[index]!.portableId,
      })),
    },
  }
}
