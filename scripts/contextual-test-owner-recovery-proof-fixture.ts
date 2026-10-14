/** Fixed synthetic recovery scenarios; import opens no process/network/SQL. */
import assert from 'node:assert/strict'
import { normalizeTestResponses, buildTestAttemptHistoryMetrics } from '../src/lib/test-attempts'
import type { AssignmentListProofFixture } from './contextual-assignment-list-proof-fixture'
import { newTestOwnerGradingFixture, freezeOwnerGrading as freeze, ownerGradingDigest as hash } from './contextual-test-owner-grading-proof-fixture'

export const TEST_OWNER_RECOVERY_PROOF_CAPS = freeze({ sqlBytes: 256 * 1024, responseBytes: 4 * 1024 * 1024,
  requestMs: 12000, closeMs: 12000, totalMs: 180000, dispatches: 40, rows: 10000 })
export const TEST_OWNER_RECOVERY_PROOF_CHECKS = freeze(['service-only-empty-search-path', 'mixed-role-current-owner',
  'current-nonowner-selection', 'source-revision-cas', 'partial-unsubmit-counts', 'retained-draft-return-clear',
  'best-effort-history-failure', 'single-delete-exact-cascade', 'bulk-delete-nontarget-preservation',
  'zero-work-replay', 'active-ai-exclusion', 'late-failure-rollback', 'authority-archive-parent-purge'] as const)
export function newTestOwnerRecoveryFixture(original: AssignmentListProofFixture) {
  const base = newTestOwnerGradingFixture(original), tag = `testownerrecover_${base.tag.slice(-12)}`
  const id = (label: string) => { const h = hash(`${tag}:${label}`); return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}` }
  const attemptIds = [1, 2].map(i => id(`attempt:${i}`)), historyIds = [1, 2].map(i => id(`history:${i}`)),
    focusIds = [1, 2].map(i => id(`focus:${i}`)), itemIds = [1, 2].map(i => id(`item:${i}`))
  const allocatedIds = [...base.allocatedIds, ...attemptIds, ...historyIds, ...focusIds, ...itemIds]
  assert.equal(new Set(allocatedIds).size, allocatedIds.length)
  return freeze({ ...base, tag, attemptIds, historyIds, focusIds, itemIds, allocatedIds, nativeVerified: false as const })
}
export type TestOwnerRecoveryFixture = ReturnType<typeof newTestOwnerRecoveryFixture>
export type TestOwnerRecoveryOperation = 'unsubmit-plan' | 'unsubmit' | 'delete-single' | 'delete-bulk'
const record = (value: unknown): Record<string, unknown> => { assert(value && typeof value === 'object' && !Array.isArray(value)); return value as Record<string, unknown> }
const keys = (r: Record<string, unknown>, expected: string[]) => assert.deepEqual(Object.keys(r).sort(), [...expected].sort())
const integer = (v: unknown, min = 0) => { assert(typeof v === 'number' && Number.isSafeInteger(v) && v >= min); return v }
const ids = (v: unknown) => {
  assert(Array.isArray(v) && v.length <= 100); const result = v.map(id => { assert(typeof id === 'string'); assert.match(id, /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/); return id })
  assert.equal(new Set(result).size, result.length); return result
}
export function recoveryUnsubmitPayload(raw: unknown) {
  const plan = record(raw); keys(plan, ['student_ids', 'eligible_student_ids', 'attempts'])
  const student_ids = ids(plan.student_ids), eligible_student_ids = ids(plan.eligible_student_ids)
  assert(student_ids.length > 0 && eligible_student_ids.every(id => student_ids.includes(id)))
  assert(Array.isArray(plan.attempts) && plan.attempts.length <= eligible_student_ids.length)
  const attempts = plan.attempts.map(value => {
    const row = record(value); keys(row, ['id', 'student_id', 'draft_revision', 'responses'])
    const [id, student_id] = ids([row.id, row.student_id]); assert(eligible_student_ids.includes(student_id))
    const draft_revision = integer(row.draft_revision, 1), responses = row.responses
    assert(responses !== undefined && Buffer.byteLength(JSON.stringify(responses)) <= 2 * 1024 * 1024)
    const snapshot = normalizeTestResponses(responses), metrics = buildTestAttemptHistoryMetrics(snapshot, 0, 0)
    return { id, student_id, draft_revision, responses, snapshot, ...metrics }
  })
  assert.equal(new Set(attempts.map(a => a.id)).size, attempts.length)
  assert.equal(new Set(attempts.map(a => a.student_id)).size, attempts.length)
  return freeze({ student_ids, eligible_student_ids, attempts })
}
/** Narrow public route projections; strict internal IDs/counts are validated first. */
export function validateTestOwnerRecoveryResult(operation: Exclude<TestOwnerRecoveryOperation, 'unsubmit-plan'>, selected: readonly string[], raw: unknown) {
  const result = record(raw), studentIds = ids(result.student_ids)
  assert.deepEqual([...studentIds].sort(), [...selected].sort()); assert(selected.length > 0 && selected.length <= 100)
  if (operation === 'unsubmit') {
    keys(result, ['student_ids', 'unsubmitted_count', 'skipped_count', 'skipped_enrollment_count', 'history_written_count'])
    const unsubmitted_count = integer(result.unsubmitted_count), skipped_count = integer(result.skipped_count),
      skipped_enrollment_count = integer(result.skipped_enrollment_count), history = integer(result.history_written_count)
    assert.equal(unsubmitted_count + skipped_count, selected.length); assert(skipped_enrollment_count <= skipped_count && history <= unsubmitted_count)
    return freeze({ unsubmitted_count, skipped_count, skipped_enrollment_count })
  }
  const names = ['deleted_attempts', 'deleted_responses', 'deleted_focus_events', 'deleted_ai_grading_items']
  keys(result, ['student_ids', ...names, ...(operation === 'delete-bulk' ? ['requested_count', 'deleted_student_count'] : [])])
  const counts = Object.fromEntries(names.map(key => [key, integer(result[key])]))
  assert(counts.deleted_attempts <= selected.length)
  if (operation === 'delete-single') { assert.equal(selected.length, 1); return freeze(counts) }
  const requested_count = integer(result.requested_count), deleted_student_count = integer(result.deleted_student_count)
  assert.equal(requested_count, selected.length); assert(deleted_student_count <= requested_count && counts.deleted_attempts <= deleted_student_count)
  return freeze({ success: true, requested_count, deleted_student_count, ...counts })
}
