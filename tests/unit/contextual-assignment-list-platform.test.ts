import { describe, expect, it } from 'vitest'
import { assignmentListExpectedResources, assignmentListRestorationPolicy, assignmentListRowChanges, assignmentListSafeCronJobs } from '../../scripts/contextual-assignment-list-proof-platform'
import { newAssignmentListProofFixture } from '../../scripts/contextual-assignment-list-proof-fixture'
import { assignmentListRevocationPlans } from '../../scripts/contextual-assignment-list-proof-revocations'
import { parseAssignmentListLifecycleArgs } from '../../scripts/check-contextual-assignment-list-lifecycle'
import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync, statSync, unlinkSync } from 'node:fs'
import { assignmentListProofWorkdir } from '../../scripts/contextual-assignment-list-proof-path'
import { prepareAssignmentListProjectFiles, writeAssignmentListStartupDiagnostic } from '../../scripts/contextual-assignment-list-proof-platform'
import { assignmentListEphemeralPlan } from '../../scripts/contextual-assignment-list-proof-lifecycle'

describe('assignment-list native platform proof contracts (offline)', () => {
  it('keeps startup error output in one private no-overwrite receipt, not the console', () => {
    const project = `pika_assignment_list_${randomUUID().replaceAll('-', '').slice(0, 12)}`
    const path = `${assignmentListProofWorkdir(project)}-startup.json`
    try {
      expect(writeAssignmentListStartupDiagnostic(project, { code: 1, killed: false, stdout: 'Synthetic private output', stderr: 'Synthetic private error' })).toBe(path)
      expect(statSync(path).mode & 0o777).toBe(0o600)
      expect(JSON.parse(readFileSync(path, 'utf8'))).toMatchObject({ code: 1, stdout: 'Synthetic private output', stderr: 'Synthetic private error' })
      expect(() => writeAssignmentListStartupDiagnostic(project, { code: 2, killed: false, stdout: 'overwrite', stderr: '' })).toThrow()
      expect(readFileSync(path, 'utf8')).not.toContain('overwrite')
      expect(() => writeAssignmentListStartupDiagnostic('pika', { code: 1, killed: false, stdout: '', stderr: '' })).toThrow()
    } finally { if (existsSync(path)) unlinkSync(path) }
  })
  it('allocates platform-specific canonical temp roots without accepting a caller parent', () => {
    const project = 'pika_assignment_list_abcdef123456'
    expect(assignmentListProofWorkdir(project, 'linux')).toBe('/tmp/pika-assignment-list-abcdef123456')
    expect(assignmentListProofWorkdir(project, 'darwin')).toBe('/private/tmp/pika-assignment-list-abcdef123456')
    expect(() => assignmentListProofWorkdir(project, 'win32')).toThrow()
    expect(() => assignmentListProofWorkdir('pika', 'linux')).toThrow()
  })
  it.each(['directory', 'migration'] as const)('removes only its owned generated directory after partial preparation failure at %s', checkpoint => {
    const projectId = `pika_assignment_list_${randomUUID().replaceAll('-', '').slice(0, 12)}`
    const workdir = assignmentListProofWorkdir(projectId)
    const plan = assignmentListEphemeralPlan({ projectId, workdir })
    const failure = new Error('Synthetic preparation failure')
    expect(existsSync(workdir)).toBe(false)
    expect(() => prepareAssignmentListProjectFiles(plan, [{ name: '001_fixture.sql', sql: 'select 1;', sha256: 'a'.repeat(64) }], stage => { if (stage === checkpoint) throw failure })).toThrow(failure)
    expect(existsSync(workdir)).toBe(false)
  })
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
