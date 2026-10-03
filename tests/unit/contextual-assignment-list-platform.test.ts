import { describe, expect, it } from 'vitest'
import { assignmentListExpectedResources, assignmentListRestorationPolicy, assignmentListRowChanges, assignmentListSafeCronJobs } from '../../scripts/contextual-assignment-list-proof-platform'
import { newAssignmentListProofFixture } from '../../scripts/contextual-assignment-list-proof-fixture'
import { assignmentListRevocationPlans } from '../../scripts/contextual-assignment-list-proof-revocations'
import { parseAssignmentListLifecycleArgs } from '../../scripts/check-contextual-assignment-list-lifecycle'

describe('assignment-list native platform proof contracts (offline)', () => {
  it('requires an exact reviewed head and a closed execution mode', () => {
    const head = 'a'.repeat(40)
    expect(parseAssignmentListLifecycleArgs(['--reviewed-head', head, '--mode', 'normal'])).toEqual({ head, mode: 'normal' })
    for (const args of [[], ['--reviewed-head', head, '--mode', 'production'], ['--reviewed-head', 'main', '--mode', 'normal'], ['--reviewed-head', head, '--mode', 'normal', '--all']]) expect(() => parseAssignmentListLifecycleArgs(args)).toThrow()
  })
  it('names only the eight exact isolated CLI resources', () => {
    const resources = assignmentListExpectedResources('pika_assignment_list_abcdef123456')
    expect(resources).toHaveLength(8)
    expect(new Set(resources.map(r => `${r.kind}:${r.name}`)).size).toBe(8)
    expect(resources.every(r => r.name.endsWith('_pika_assignment_list_abcdef123456'))).toBe(true)
    expect(() => assignmentListExpectedResources('pika')).toThrow()
  })
  it('reports exact changed cells, insertions and removals without accepting counts as equality', () => {
    const before = { 'public.classrooms': [{ id: 'a', title: 'A', archive_revision: 1 }], 'private.pal_membership_generations': [{ generation_id: 'old', state: 'active' }] }
    const after = { 'public.classrooms': [{ id: 'a', title: 'B', archive_revision: 2 }], 'private.pal_membership_generations': [{ generation_id: 'old', state: 'removed' }, { generation_id: 'new', state: 'active' }] }
    expect(assignmentListRowChanges(before, after)).toEqual([
      { schema: 'private', table: 'pal_membership_generations', id: 'new', columns: ['__row__'] },
      { schema: 'private', table: 'pal_membership_generations', id: 'old', columns: ['state'] },
      { schema: 'public', table: 'classrooms', id: 'a', columns: ['archive_revision', 'title'] },
    ])
    expect(assignmentListRowChanges(before, structuredClone(before))).toEqual([])
    expect(assignmentListRowChanges(after, before)[0]).toMatchObject({ id: 'new', columns: ['__row__'] })
  })
  it('permits only preallocated generation effects and scoped trigger bookkeeping', () => {
    const fixture = newAssignmentListProofFixture()
    const removal = assignmentListRevocationPlans(fixture).find(p => p.transition === 'member-remove')!
    const policy = assignmentListRestorationPolicy(fixture, removal)
    expect(policy.allowedCells.some(c => c.table === 'pal_membership_generations' && c.columns.includes('state'))).toBe(true)
    expect(policy.allowedCells.some(c => c.table === 'pal_membership_generations' && c.id === fixture.replacementEnrollments[0].id && c.columns.includes('__row__'))).toBe(true)
    expect(policy.allowedCells.every(c => c.id !== fixture.classes[1].id)).toBe(true)
    expect(policy.allowedCells.some(c => c.table === 'users' || c.table === 'assignments' || c.table === 'student_provider_cleanup_settings')).toBe(false)
  })
  it('does not permit changed released values after semantic restoration', () => {
    const fixture = newAssignmentListProofFixture()
    const plan = assignmentListRevocationPlans(fixture).find(p => p.transition === 'grade-withdraw')!
    const policy = assignmentListRestorationPolicy(fixture, plan)
    const doc = policy.allowedCells.find(c => c.table === 'assignment_docs')!
    expect(doc.id).toBe(fixture.docs.find(d => d.returned)!.id)
    expect(doc.columns).toEqual(['updated_at'])
  })
  it('allows only the two installed dormant watchdog commands, not arbitrary active scheduling', () => {
    expect(assignmentListSafeCronJobs([])).toBe(true)
    expect(assignmentListSafeCronJobs([{ active: true, jobname: 'pika-removed-student-cleanup-watchdog', command: 'select private.run_removed_student_cleanup_watchdog()' }, { active: true, jobname: 'pika-test-ai-grading-watchdog', command: 'select private.watchdog_test_ai_grading_runs()' }])).toBe(true)
    for (const job of [{ active: true, jobname: 'unknown', command: 'select 1' }, { active: true, jobname: 'pika-test-ai-grading-watchdog', command: 'select net.http_post()' }, { active: true, command: 'select private.watchdog_test_ai_grading_runs()' }, {}]) expect(assignmentListSafeCronJobs([job])).toBe(false)
  })
})
