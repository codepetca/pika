import { describe, expect, it } from 'vitest'
import { newAssignmentListProofFixture } from '../../scripts/contextual-assignment-list-proof-fixture'
import { assignmentListRevocationPlans } from '../../scripts/contextual-assignment-list-proof-revocations'
import { decodeAssignmentListProofManifest } from '../../scripts/check-contextual-assignment-list-reads'
import { ApiError } from '../../src/lib/api-error'
import {
  assignmentStudentDetailProofDiagnostic,
  assignmentStudentDetailProofExpectation,
  assignmentStudentDetailRevocationBoundary,
  observeAssignmentStudentDetailTransition,
} from '../../scripts/check-contextual-assignment-student-detail-lifecycle'

describe('isolated student-detail observer preserves the reviewed fixture and transitions', () => {
  it('maps seven existing cases to exact current owner/target relationships without new rows', () => {
    const fixture = newAssignmentListProofFixture()
    const before = JSON.stringify(fixture)
    const cases = fixture.manifest.cases.map(c => assignmentStudentDetailProofExpectation(fixture, c)).filter(c => c !== null)
    expect(cases).toHaveLength(7)
    expect(cases.filter(c => c!.status === 200)).toHaveLength(3)
    expect(cases.filter(c => c!.status === 403)).toHaveLength(4)
    for (const value of cases) expect(value!.studentId).not.toBe(fixture.classes.find(c => c.id === value!.classroomId)!.owner)
    expect(cases.find(c => c!.actorId === fixture.classes[0].owner)).toMatchObject({ studentId: fixture.manifest.actors[2].id, docId: fixture.docs.find(d => d.assignment === fixture.assignments[0].id && d.student === fixture.manifest.actors[2].id)!.id })
    expect(cases.find(c => c!.classroomId === fixture.classes[1].id && c!.status === 200)).toMatchObject({ studentId: fixture.manifest.actors[0].id, docId: null })
    expect(JSON.stringify(fixture)).toBe(before)
  })

  it('accepts decoded manifest order and rejects substituted cases', () => {
    const fixture = newAssignmentListProofFixture()
    expect(assignmentStudentDetailProofExpectation(fixture, decodeAssignmentListProofManifest(fixture.manifest).cases[0])).toMatchObject({ status: 200 })
    expect(() => assignmentStudentDetailProofExpectation(fixture, { ...fixture.manifest.cases[0], actorId: fixture.manifest.actors[4].id })).toThrow()
  })

  it('does not invent assignments for empty archived/hidden classrooms', () => {
    const fixture = newAssignmentListProofFixture()
    for (const label of ['archived_member', 'hidden_member']) expect(assignmentStudentDetailProofExpectation(fixture, fixture.manifest.cases.find(c => c.label === label)!)).toBeNull()
  })

  it('reuses exactly six existing owner-transfer/removal transitions at first/later/terminal boundaries', () => {
    const fixture = newAssignmentListProofFixture()
    const plans = assignmentListRevocationPlans(fixture).filter(p => ['owner-transfer', 'member-remove'].includes(p.transition))
    expect(plans).toHaveLength(6)
    const ids = fixture.requirements.map(r => r.id).sort()
    for (const plan of plans) {
      const url = new URL('http://127.0.0.1:54331/rest/v1/assignments')
      url.searchParams.set('select', plan.boundary === 'first' ? 'id,title,description,instructions_markdown' : 'id,requirements:assignment_submission_requirements(id)')
      if (plan.boundary !== 'first') url.searchParams.set('requirements.id', `gt.${plan.boundary === 'later' ? ids.at(-2) : ids.at(-1)}`)
      expect(assignmentStudentDetailRevocationBoundary(fixture, plan, url)).toBe(true)
      url.searchParams.set('select', 'id,classroom_id,classrooms(id,teacher_id)')
      expect(assignmentStudentDetailRevocationBoundary(fixture, plan, url)).toBe(false)
    }
  })

  it('ignores grade/feedback/publication changes that are not owner-target revocations', () => {
    const fixture = newAssignmentListProofFixture()
    const url = new URL('http://127.0.0.1:54331/rest/v1/assignments?select=id,title,description,instructions_markdown')
    for (const plan of assignmentListRevocationPlans(fixture).filter(p => !['owner-transfer', 'member-remove'].includes(p.transition))) expect(assignmentStudentDetailRevocationBoundary(fixture, plan, url)).toBe(false)
  })

  it('prints bounded closed diagnostics, never response rows, identifiers, URLs or messages', () => {
    expect(assignmentStudentDetailProofDiagnostic({ case: 'owner_student', phase: 'requirements', statement: 5, http: 200, code: 'PGRST108' })).toBe('case=owner_student phase=requirements statement=5 http=200 code=PGRST108')
    expect(assignmentStudentDetailProofDiagnostic({ case: 'private\nrow', phase: 'token=https://private', statement: Infinity, http: 999, code: 'private message' })).toBe('case=none phase=none statement=0 http=0 code=none')
  })

  it('injects exactly the original approved revoke once and leaves restoration to the original observer', async () => {
    const fixture = newAssignmentListProofFixture()
    const plan = assignmentListRevocationPlans(fixture).find(p => p.transition === 'member-remove' && p.boundary === 'first')!
    const calls: string[] = []
    const url = new URL('http://127.0.0.1:54331/rest/v1/assignments?select=id,title,description,instructions_markdown')
    expect(await observeAssignmentStudentDetailTransition(fixture, plan, plan.revokeSql, async sql => { calls.push(sql) }, async hook => {
      await hook(url)
      await hook(url)
      throw new ApiError(503, 'Unavailable')
    })).toBe(true)
    expect(calls).toEqual([plan.revokeSql])
    expect(await observeAssignmentStudentDetailTransition(fixture, plan, plan.restoreSql, async sql => { calls.push(sql) }, async () => { throw new Error('Must not read during restore') })).toBe(false)
    expect(calls).toEqual([plan.revokeSql, plan.restoreSql])
  })

  it('never retries an ambiguous mutation or accepts a read denied before reaching its boundary', async () => {
    const fixture = newAssignmentListProofFixture()
    const plan = assignmentListRevocationPlans(fixture).find(p => p.transition === 'owner-transfer' && p.boundary === 'first')!
    const calls: string[] = []
    const url = new URL('http://127.0.0.1:54331/rest/v1/assignments?select=id,title,description,instructions_markdown')
    await expect(observeAssignmentStudentDetailTransition(fixture, plan, plan.revokeSql, async sql => { calls.push(sql); throw new Error('Ambiguous commit') }, async hook => {
      await hook(url).catch(() => undefined)
      await hook(url)
      throw new ApiError(503, 'Unavailable')
    })).rejects.toThrow('Required student-detail revocation boundary not reached')
    expect(calls).toEqual([plan.revokeSql])
    calls.length = 0
    await expect(observeAssignmentStudentDetailTransition(fixture, plan, plan.revokeSql, async sql => { calls.push(sql) }, async () => { throw new ApiError(503, 'Unavailable') })).rejects.toThrow('Required student-detail revocation boundary not reached')
    expect(calls).toEqual([])
  })
})
