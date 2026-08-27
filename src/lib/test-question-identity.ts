import { UUID_V4_PATTERN } from '@/lib/course-blueprint-artifact-identity'
import type { TestDraftContent } from '@/types'

// Every test-question id in this system is a v4 UUID (crypto.randomUUID()
// client-side, gen_random_uuid() as the row default) — reuse the same
// strict pattern the rest of the Blueprint artifact-identity pipeline
// validates against, instead of a second, looser UUID regex that would
// accept ids (v1/v2/v3/v5) the rest of the pipeline rejects.
const UUID_RE = UUID_V4_PATTERN

export const PORTABLE_TEST_QUESTION_IDENTITY_VERSION = 1 as const

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

export type TestQuestionIdentityResolutionOptions = {
  /** Accept legacy draft JSON whose question IDs are internal row IDs. */
  acceptInternalRowIds?: boolean
  /** Accept a portable draft identity that has not been materialized yet. */
  allowDraftOnly?: boolean
}

export function usesPortableTestQuestionIdentity(
  content: Pick<TestDraftContent, 'question_identity_version'>,
): boolean {
  return content.question_identity_version === PORTABLE_TEST_QUESTION_IDENTITY_VERSION
}

export function markPortableTestQuestionIdentity(
  content: TestDraftContent,
): TestDraftContent {
  return {
    ...content,
    question_identity_version: PORTABLE_TEST_QUESTION_IDENTITY_VERSION,
  }
}

export function getTestDraftIdentityResolutionOptions(
  content: Pick<TestDraftContent, 'question_identity_version'>,
): TestQuestionIdentityResolutionOptions {
  return usesPortableTestQuestionIdentity(content)
    ? {
        acceptInternalRowIds: false,
        allowDraftOnly: true,
      }
    : {
        acceptInternalRowIds: true,
        allowDraftOnly: true,
      }
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
 * Portable artifact identities are canonical. Internal row-id matching is off
 * by default and must be explicitly selected for an unmarked document. Live
 * unmarked drafts exist only during the application-before-migration rollout
 * window; after migration 134, the same adapter remains only for cold archived
 * Classrooms. No source identity is assigned or rewritten.
 */
export function resolveTestQuestionIdentities(
  inputIds: string[],
  persistedQuestions: PersistedTestQuestionIdentity[],
  options: TestQuestionIdentityResolutionOptions = {},
): { ok: true; identities: ResolvedTestQuestionIdentity[] } | { ok: false } {
  const {
    acceptInternalRowIds = false,
    allowDraftOnly = false,
  } = options
  const rowIdsByKnownIdentity = new Map<string, Set<string>>()
  const rowsByInternalId = new Map<string, PersistedTestQuestionIdentity>()

  for (const question of persistedQuestions) {
    rowsByInternalId.set(normalizeTestQuestionIdentity(question.id), question)
    const portableIdentity = getPortableTestQuestionIdentity(question)
    const rowIds = rowIdsByKnownIdentity.get(portableIdentity) ?? new Set<string>()
    rowIds.add(question.id)
    rowIdsByKnownIdentity.set(portableIdentity, rowIds)
  }

  const seenInputIds = new Set<string>()
  const matchedRowIds = new Set<string>()
  const seenPortableIds = new Set<string>()
  const identities: ResolvedTestQuestionIdentity[] = []

  for (const rawInputId of inputIds) {
    const inputId = normalizeTestQuestionIdentity(rawInputId)
    if (seenInputIds.has(inputId)) return { ok: false }
    seenInputIds.add(inputId)

    // Unmarked legacy drafts contractually stored internal row IDs, so an
    // exact row match wins before portable fallback. Marked drafts disable
    // this branch and stay entirely in the artifact/source identity domain.
    const internalRow = acceptInternalRowIds
      ? rowsByInternalId.get(inputId)
      : undefined
    const matchingRowIds = internalRow
      ? new Set([internalRow.id])
      : new Set(rowIdsByKnownIdentity.get(inputId) ?? [])
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

      const portableId = getPortableTestQuestionIdentity(matchingRow)
      if (seenPortableIds.has(portableId)) return { ok: false }
      seenPortableIds.add(portableId)

      identities.push({
        inputId,
        portableId,
        matchingRowId,
      })
      continue
    }

    if (!allowDraftOnly) return { ok: false }
    if (seenPortableIds.has(inputId)) return { ok: false }
    seenPortableIds.add(inputId)
    identities.push({ inputId, portableId: inputId })
  }

  return { ok: true, identities }
}

export function projectPortableTestQuestionIds(
  content: TestDraftContent,
  persistedQuestions: PersistedTestQuestionIdentity[],
  options?: TestQuestionIdentityResolutionOptions,
): { ok: true; content: TestDraftContent } | { ok: false } {
  const resolved = resolveTestQuestionIdentities(
    content.questions.map((question) => question.id),
    persistedQuestions,
    options,
  )
  if (!resolved.ok) return resolved

  return {
    ok: true,
    content: {
      ...markPortableTestQuestionIdentity(content),
      questions: content.questions.map((question, index) => ({
        ...question,
        id: resolved.identities[index]!.portableId,
      })),
    },
  }
}
