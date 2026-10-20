import { describe, expect, it } from 'vitest'
import {
  contextualGradebookOwnerEnvelopeSchema,
  contextualGradebookMemberGradesEnvelopeSchema,
  contextualGradebookMemberItemsEnvelopeSchema,
  contextualGradebookMutationPayloadSchema,
  contextualGradebookMutationEnvelopeSchema,
  contextualGradebookMutationPayloadSchemas,
  GRADEBOOK_LIMITS,
} from '@/lib/validations/contextual-gradebook'

const actor = '00000000-0000-4000-8000-000000000001'
const classroom = '00000000-0000-4000-8000-000000000002'
const member = '00000000-0000-4000-8000-000000000003'
const source = {
  categories: [], assignments: [], assignment_docs: [], tests: [], test_questions: [],
  test_responses: [], test_attempts: [], items: [], item_scores: [], score_overrides: [],
}
const owner = { actor_id: actor, classroom: { id: classroom, teacher_id: actor, archived_at: null },
  operation: 'owner-read', selected_student_id: null, source: { ...source, roster: [], profiles: [] } }
const own = { actor_id: member, classroom: owner.classroom, operation: 'member-grades', source: {
  ...source, student_id: member, visibility: { classwork: true, tests: true, student_grades: true, gradebook_compact_zero_weight_assessments: true },
} }

describe('contextual Gradebook strict contracts', () => {
  it('accepts complete owner and own-member snapshots', () => {
    expect(contextualGradebookOwnerEnvelopeSchema.safeParse(owner).success).toBe(true)
    expect(contextualGradebookMemberGradesEnvelopeSchema.safeParse(own).success).toBe(true)
    expect(contextualGradebookMemberItemsEnvelopeSchema.safeParse({ ...own, operation: 'member-items' }).success).toBe(true)
  })
  it('rejects mixed permission/mutation/read envelopes and hidden contents', () => {
    expect(contextualGradebookOwnerEnvelopeSchema.safeParse({ ...owner, allowed: true }).success).toBe(false)
    expect(contextualGradebookOwnerEnvelopeSchema.safeParse({ ...owner, result: { saved: true } }).success).toBe(false)
    expect(contextualGradebookMemberGradesEnvelopeSchema.safeParse({ ...own, source: { ...own.source, roster: [] } }).success).toBe(false)
  })
  it('retains zero weight and nullable standalone marks without coercion', () => {
    expect(contextualGradebookMutationPayloadSchema.safeParse({ action: 'assessment_weight', payload: { assessment_type: 'test', assessment_id: classroom, gradebook_weight: 0 } }).success).toBe(true)
    expect(contextualGradebookMutationPayloadSchema.safeParse({ action: 'item_score', payload: { item_id: classroom, student_id: member, earned: null } }).success).toBe(true)
    expect(contextualGradebookMutationPayloadSchema.safeParse({ action: 'item_score', payload: { item_id: classroom, student_id: member, earned: '0' } }).success).toBe(false)
  })
  it('rejects extra actor/classroom fields and maximum mode mismatch', () => {
    expect(contextualGradebookMutationPayloadSchema.safeParse({ action: 'override_delete_all', payload: { actor_id: actor } }).success).toBe(false)
    expect(contextualGradebookMutationPayloadSchema.safeParse({ action: 'maximum', payload: { assessment_type: 'test', assessment_id: classroom, maximum: null, mode: 'keep_marks', expected_maximum: 10, expected_scale: 1 } }).success).toBe(false)
  })
  it('requires exact action-specific acknowledgements', () => {
    const mutation = { actor_id: actor, classroom: owner.classroom, operation: 'item_score', target: { item_id: classroom, student_id: member }, result: { saved: true } }
    expect(contextualGradebookMutationEnvelopeSchema.safeParse(mutation).success).toBe(true)
    expect(contextualGradebookMutationEnvelopeSchema.safeParse({ ...mutation, result: { saved: false } }).success).toBe(false)
    expect(contextualGradebookMutationEnvelopeSchema.safeParse({ ...mutation, selected_student_id: null }).success).toBe(false)
    expect(contextualGradebookMutationEnvelopeSchema.safeParse({ ...mutation, target: undefined }).success).toBe(false)
    expect(contextualGradebookMutationEnvelopeSchema.safeParse({ ...mutation, target: { item_id: classroom } }).success).toBe(false)
    expect(contextualGradebookMutationEnvelopeSchema.safeParse({ ...mutation, target: { ...mutation.target, actor_id: actor } }).success).toBe(false)
    expect(contextualGradebookMutationEnvelopeSchema.safeParse({ ...mutation, target: { assessment_id: classroom, student_id: member } }).success).toBe(false)
  })
  it('requires all four normalized visibility booleans and canonical timestamp/UUID fields', () => {
    expect(contextualGradebookMemberGradesEnvelopeSchema.safeParse({ ...own, source: { ...own.source, visibility: { ...own.source.visibility, classwork: 'true' } } }).success).toBe(false)
    expect(contextualGradebookOwnerEnvelopeSchema.safeParse({ ...owner, classroom: { ...owner.classroom, archived_at: '2026-10-19' } }).success).toBe(false)
    expect(contextualGradebookOwnerEnvelopeSchema.safeParse({ ...owner, actor_id: 'not-a-uuid' }).success).toBe(false)
  })
  it('bounds UTF-8 projected strings, finite numbers, arrays and exact projected columns', () => {
    const roster = { student_id: member, email: 'é'.repeat(GRADEBOOK_LIMITS.stringBytes / 2) }
    expect(contextualGradebookOwnerEnvelopeSchema.safeParse({ ...owner, source: { ...owner.source, roster: [roster] } }).success).toBe(true)
    expect(contextualGradebookOwnerEnvelopeSchema.safeParse({ ...owner, source: { ...owner.source, roster: [{ ...roster, email: roster.email + 'é' }] } }).success).toBe(false)
    expect(contextualGradebookOwnerEnvelopeSchema.safeParse({ ...owner, source: { ...owner.source, roster: Array.from({ length: 1001 }, () => roster) } }).success).toBe(false)
    expect(contextualGradebookOwnerEnvelopeSchema.safeParse({ ...owner, source: { ...owner.source, roster: [{ ...roster, password_hash: 'secret' }] } }).success).toBe(false)
    expect(contextualGradebookMutationPayloadSchemas.item_score.safeParse({ item_id: classroom, student_id: member, earned: Infinity }).success).toBe(false)
    expect(contextualGradebookMutationPayloadSchemas.item_score.safeParse({ item_id: classroom, student_id: member, earned: NaN }).success).toBe(false)
  })
  it('requires atomic category invariants and generated array-order positions', () => {
    const category = { id: classroom, name: 'Course', percentage: 100, default_assessment_weight: 1, position: 0, is_default: true }
    expect(contextualGradebookMutationPayloadSchemas.categories_replace.safeParse({ categories: [category] }).success).toBe(true)
    for (const patch of [{ percentage: 99 }, { is_default: false }, { position: 1 }, { name: '__pika_replacing__reserved' }, { percentage: '100' }]) {
      expect(contextualGradebookMutationPayloadSchemas.categories_replace.safeParse({ categories: [{ ...category, ...patch }] }).success).toBe(false)
    }
    expect(contextualGradebookMutationPayloadSchemas.categories_replace.safeParse({ categories: [category, { ...category, percentage: 0, is_default: false, position: 1 }] }).success).toBe(false)
  })
  it('validates complete item acknowledgements without forwarding writer extras', () => {
    const item = { id: classroom, classroom_id: classroom, title: 'Standalone', points_possible: 10, gradebook_category_id: null, gradebook_weight: 0, include_in_final: true, created_by: actor, created_at: '2026-10-19T12:00:00+00:00', updated_at: '2026-10-19T12:00:00+00:00', gradebook_maximum_override: null, gradebook_score_scale: 1 }
    const mutation = { actor_id: actor, classroom: owner.classroom, operation: 'item_create', target: { item_id: classroom }, result: { ok: true, item } }
    expect(contextualGradebookMutationEnvelopeSchema.safeParse(mutation).success).toBe(true)
    expect(contextualGradebookMutationEnvelopeSchema.safeParse({ ...mutation, result: { ok: true, item: { ...item, future_sensitive_field: 'private' } } }).success).toBe(false)
    expect(contextualGradebookMutationEnvelopeSchema.safeParse({ ...mutation, result: { ok: true, item: { ...item, gradebook_score_scale: undefined } } }).success).toBe(false)
  })
})
