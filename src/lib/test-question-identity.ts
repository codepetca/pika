import { UUID_V4_PATTERN } from '@/lib/course-blueprint-artifact-identity'
import type { TestDraftContent } from '@/types'

// Every test-question id in this system is a v4 UUID (crypto.randomUUID()
// client-side, gen_random_uuid() as the row default) — reuse the same
// strict pattern the rest of the Blueprint artifact-identity pipeline
// validates against, instead of a second, looser UUID regex that would
// accept ids (v1/v2/v3/v5) the rest of the pipeline rejects.
const UUID_RE = UUID_V4_PATTERN

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
 *
 * TODO(remove after migration 134 has been live in production for one full
 * release cycle with no `question_identity_ambiguous`/row-id-fallback hits in
 * the RPC failure ledger — see docs/architecture/course-blueprint-identity-versioning.md):
 * migration 134's one-time backfill rewrites every existing draft's question
 * ids to portable identity at deploy time, so after that point no legitimately
 * saved draft should ever exercise the row-id branch below again. Until it's
 * removed, it stays a live source of the very ambiguity this module exists to
 * eliminate (see the `matchingRowIds.size > 1` guard a few lines down, which
 * exists specifically to catch this path colliding with the
 * artifact_id/source_artifact_id path).
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

      // rowsByInternalId already indexes every row by its normalized id
      // (built above); reuse it instead of a linear scan so resolution stays
      // O(n) instead of O(n^2) as the number of input/persisted ids grows.
      const matchingRow = rowsByInternalId.get(normalizeTestQuestionIdentity(matchingRowId))
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
