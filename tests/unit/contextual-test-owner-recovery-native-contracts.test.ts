import { createHash,randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it,vi } from 'vitest'
import * as platform from '../../scripts/contextual-assignment-list-proof-platform'
import { testOwnerRecoveryNativePlan } from '../../scripts/contextual-test-owner-recovery-native-contracts'
import { newAssignmentListProofFixture } from '../../scripts/contextual-assignment-list-proof-fixture'
import { newTestOwnerRecoveryFixture, recoveryUnsubmitPayload, validateTestOwnerRecoveryResult,
  TEST_OWNER_RECOVERY_PROOF_CHECKS } from '../../scripts/contextual-test-owner-recovery-proof-fixture'

const original=newAssignmentListProofFixture(new Date('2026-10-11T12:00:00Z'))
const f = newTestOwnerRecoveryFixture(original)
const plan = { student_ids: [f.actors[1].id, f.actors[3].id], eligible_student_ids: [f.actors[1].id],
  attempts: [{ id: f.attemptIds[0], student_id: f.actors[1].id, draft_revision: 19,
    responses: { [f.questions[0].id]: 'Synthetic recovery answer' } }] }

describe('inert recovery proof and exact selected-work projections', () => {
  it('retains mixed roles and noncolliding finite synthetic identities', () => {
    expect(f.actors.map(a => a.role)).toEqual(['student', 'teacher', 'student', 'teacher'])
    expect(f.nativeVerified).toBe(false)
    expect(new Set(f.allocatedIds).size).toBe(f.allocatedIds.length)
    expect(Object.isFrozen(f)).toBe(true)
  })
  it('uses actual positive revisions and normalizes the exact plan without inventing revision1', () => {
    const payload = recoveryUnsubmitPayload(plan)
    expect(payload.attempts[0]).toMatchObject({ draft_revision: 19, word_count: 3, paste_word_count: 0, keystroke_count: 0,
      snapshot: { [f.questions[0].id]: { question_type: 'open_response', response_text: 'Synthetic recovery answer' } } })
    expect(payload.attempts[0].responses).toEqual(plan.attempts[0].responses)
    for (const revision of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, '19', null])
      expect(() => recoveryUnsubmitPayload({ ...plan, attempts: [{ ...plan.attempts[0], draft_revision: revision }] })).toThrow()
  })
  it('refuses forged subjects, duplicate attempts, removed bindings and extra private plan fields', () => {
    for (const broken of [{ ...plan, eligible_student_ids: [f.actors[2].id] },
      { ...plan, attempts: [...plan.attempts, plan.attempts[0]] },
      { ...plan, attempts: [{ ...plan.attempts[0], student_id: f.actors[2].id }] },
      { ...plan, attempts: [{ ...plan.attempts[0], secret: 'never disclosed' }] }])
      expect(() => recoveryUnsubmitPayload(broken)).toThrow()
  })
  it('validates public count accounting and omits only the known private acknowledgement IDs', () => {
    const r = { student_ids: plan.student_ids, unsubmitted_count: 1, skipped_count: 1, skipped_enrollment_count: 1, history_written_count: 0 }
    expect(validateTestOwnerRecoveryResult('unsubmit', plan.student_ids, r)).toEqual({ unsubmitted_count: 1, skipped_count: 1, skipped_enrollment_count: 1 })
    for (const broken of [{ ...r, student_ids: [f.actors[2].id] }, { ...r, skipped_count: 0 }, { ...r, history_written_count: 2 },
      { ...r, unsubmitted_count: -1 }, { ...r, responses: [] }])
      expect(() => validateTestOwnerRecoveryResult('unsubmit', plan.student_ids, broken)).toThrow()
  })
  it('requires exact single/bulk envelopes and safe integer counters', () => {
    const counts = { deleted_attempts: 1, deleted_responses: 2, deleted_focus_events: 1, deleted_ai_grading_items: 0 }
    expect(validateTestOwnerRecoveryResult('delete-single', [f.actors[1].id], { student_ids: [f.actors[1].id], ...counts })).toEqual(counts)
    const bulk = { student_ids: [f.actors[1].id], requested_count: 1, deleted_student_count: 1, ...counts }
    expect(validateTestOwnerRecoveryResult('delete-bulk', bulk.student_ids, bulk)).toEqual({ success: true, requested_count: 1, deleted_student_count: 1, ...counts })
    for (const broken of [{ ...bulk, requested_count: 2 }, { ...bulk, deleted_student_count: 2 }, { ...bulk, deleted_attempts: Infinity },
      { ...bulk, deleted_attempts: 2 }, { ...bulk, private_rows: [] }])
      expect(() => validateTestOwnerRecoveryResult('delete-bulk', bulk.student_ids, broken)).toThrow()
  })
  it('ships rollback-only fixture/contract sections and every declared semantic check', () => {
    const sql = readFileSync('scripts/check-contextual-test-owner-recovery.sql', 'utf8')
    expect(sql).toContain('rollback;')
    expect(sql).not.toMatch(/\bcommit\s*;|disable\s+trigger|session_replication_role|delete\s+from\s+public\.test_questions/i)
    for (const label of TEST_OWNER_RECOVERY_PROOF_CHECKS) expect(sql).toContain(label)
    for (const marker of ['owner-recovery-fixture-begin', 'owner-recovery-fixture-end', 'owner-recovery-contracts-begin', 'owner-recovery-contracts-end'])
      expect(sql.split(marker)).toHaveLength(2)
    expect(sql).toContain('history_fault260')
    expect(sql).toContain("exception when sqlstate 'ZX260'")
    expect(createHash('sha256').update(sql).digest('hex')).toMatch(/^[a-f0-9]{64}$/)
  })
})

describe('recovery current282 sealed source profile',()=>{
  const observed=Object.freeze([1,2].map(i=>Object.freeze({actorId:f.actors[i].id,attemptId:randomUUID(),revision:1})))
  const nativePlan=()=>testOwnerRecoveryNativePlan(original,observed,'a'.repeat(40),process.cwd())
  it('retains the complete current282 tail',()=>{expect(nativePlan().migrations).toHaveLength(282)})
  it.each(['name','digest','bytes','self-hashed-bytes','unknown283'])('refuses changed268 or future tail %s',defect=>{
    const migrations=platform.loadAssignmentListReviewedMigrations(process.cwd()).map(m=>({...m})),tail=migrations[267]
    if(defect==='name')tail.name='268_unknown.sql'
    if(defect==='digest')tail.sha256='f'.repeat(64)
    if(defect==='bytes'||defect==='self-hashed-bytes')tail.sql+='\n'
    if(defect==='self-hashed-bytes')tail.sha256=createHash('sha256').update(tail.sql).digest('hex')
    if(defect==='unknown283')migrations.push({name:'283_unknown.sql',sql:'select 1;',sha256:createHash('sha256').update('select 1;').digest('hex')})
    const loader=vi.spyOn(platform,'loadAssignmentListReviewedMigrations').mockReturnValue(migrations)
    try {expect(nativePlan).toThrow()}finally{loader.mockRestore()}
  })
})
