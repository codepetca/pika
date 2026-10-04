import { describe, expect, it } from 'vitest'
import { newAssignmentListProofFixture } from '../../scripts/contextual-assignment-list-proof-fixture'
import { assignmentOverviewProofExpectation } from '../../scripts/check-contextual-assignment-overview-lifecycle'
import { decodeAssignmentListProofManifest } from '../../scripts/check-contextual-assignment-list-reads'

describe('overview proof reuses only the isolated reviewed Assignment fixture', () => {
  it('covers both owner role labels and denies members/outsiders without allocating new rows', () => {
    const f = newAssignmentListProofFixture()
    const before = JSON.stringify(f)
    const expectations = f.manifest.cases.map(c => assignmentOverviewProofExpectation(f, c)).filter(e => e !== null)
    expect(expectations).toHaveLength(7)
    expect(expectations.filter(e => e!.status === 200)).toHaveLength(3)
    expect(expectations.filter(e => e!.status === 403)).toHaveLength(4)
    expect(expectations.find(e => e!.actorId === f.classes[0].owner)).toMatchObject({
      status: 200, studentIds: f.students.map(s => s.id).sort(), requirementIds: f.requirements.map(r => r.id).sort(),
    })
    expect(JSON.stringify(f)).toBe(before)
  })

  it('owner precedence excludes historical owner self-enrollment from the overview', () => {
    const f = newAssignmentListProofFixture()
    const self = f.manifest.cases.find(c => c.label === 'self_owner')!
    const expected = assignmentOverviewProofExpectation(f, self)!
    expect(expected.status).toBe(200)
    expect(expected.studentIds).not.toContain(expected.actorId)
    expect(expected.studentIds).toHaveLength(1001)
  })

  it('rejects a case that is not in the exact generated manifest', () => {
    const f = newAssignmentListProofFixture()
    expect(() => assignmentOverviewProofExpectation(f, { ...f.manifest.cases[0], actorId: f.manifest.actors[4].id })).toThrow()
  })

  it('accepts the strict decoded manifest case without relying on JSON key insertion order', () => {
    const f = newAssignmentListProofFixture()
    const decoded = decodeAssignmentListProofManifest(f.manifest)
    expect(assignmentOverviewProofExpectation(f, decoded.cases[0])).toMatchObject({ status: 200 })
  })

  it('does not invent assignments for the archive and hidden empty fixture classrooms', () => {
    const f = newAssignmentListProofFixture()
    for (const label of ['archived_member', 'hidden_member']) {
      expect(assignmentOverviewProofExpectation(f, f.manifest.cases.find(c => c.label === label)!)).toBeNull()
    }
  })
})
