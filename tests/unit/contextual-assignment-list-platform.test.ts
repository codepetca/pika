import { describe, expect, it, vi } from 'vitest'
import { assignmentListExpectedResources, assignmentListRestorationPolicy, assignmentListRowChanges, assignmentListSafeCronJobs, assignmentListDockerInventory } from '../../scripts/contextual-assignment-list-proof-platform'
import { newAssignmentListProofFixture } from '../../scripts/contextual-assignment-list-proof-fixture'
import { assignmentListRevocationPlans } from '../../scripts/contextual-assignment-list-proof-revocations'
import { parseAssignmentListLifecycleArgs } from '../../scripts/check-contextual-assignment-list-lifecycle'
import { createHash, randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { assignmentListProofWorkdir } from '../../scripts/contextual-assignment-list-proof-path'
import { loadAssignmentListReviewedMigrations, prepareAssignmentListProjectFiles, writeAssignmentListStartupDiagnostic } from '../../scripts/contextual-assignment-list-proof-platform'
import { assignmentListEphemeralPlan } from '../../scripts/contextual-assignment-list-proof-lifecycle'

describe('assignment-list native platform proof contracts (offline)', () => {
  function withMigrationFiles(count: number, run: (repository: string, folder: string) => void) {
    const repository = mkdtempSync(join(tmpdir(), 'pika-proof-chain-offline-'))
    const folder = join(repository, 'supabase/migrations')
    try {
      mkdirSync(folder, { recursive: true })
      for (let n = 1; n <= count; n++) writeFileSync(join(folder, `${String(n).padStart(3, '0')}_offline.sql`), `-- OFFLINE migration ${n}\nselect ${n};`)
      run(repository, folder)
    } finally { rmSync(repository, { recursive: true, force: true }) }
  }
  it.each([243, 246, 247])('loads the complete %i-file chain and binds every selected SQL byte without a tail cutoff', count => {
    withMigrationFiles(count, repository => {
      const migrations = loadAssignmentListReviewedMigrations(repository)
      expect(migrations).toHaveLength(count)
      expect(migrations.map(m => m.name)).toEqual(Array.from({ length: count }, (_, n) => `${String(n + 1).padStart(3, '0')}_offline.sql`))
      for (const migration of migrations) {
        const sql = readFileSync(join(repository, 'supabase/migrations', migration.name), 'utf8')
        expect(migration).toEqual({ name: migration.name, sql, sha256: createHash('sha256').update(sql).digest('hex') })
      }
    })
  })
  it.each(['short baseline', 'gap', 'duplicate number', 'malformed extra SQL'] as const)('rejects a %s in the complete source inventory', defect => {
    withMigrationFiles(defect === 'short baseline' ? 242 : defect === 'malformed extra SQL' ? 243 : 246, (repository, folder) => {
      if (defect === 'gap') unlinkSync(join(folder, '124_offline.sql'))
      if (defect === 'duplicate number') writeFileSync(join(folder, '124_duplicate.sql'), 'select 1;')
      if (defect === 'malformed extra SQL') writeFileSync(join(folder, 'unreviewed.sql'), 'select 1;')
      expect(() => loadAssignmentListReviewedMigrations(repository)).toThrow()
    })
  })
  function inventoryRunner(substitute = false) {
    const containerIds = [1, 2].map(n => n.toString(16).padStart(64, '0'))
    const networkId = '3'.padStart(64, '0')
    const volumes = Array.from({ length: 614 }, (_, n) => ({ Name: `volume_${n}`, CreatedAt: 'created', Labels: {} }))
    const containers = containerIds.map((id, n) => ({ id, name: `/container_${n}`, labels: {}, mounts: [{ Type: 'volume', Name: 'volume_0' }],
      networks: { shared: { NetworkID: networkId } }, bindings: {}, created: 'created' }))
    const networks = [{ Id: networkId, Name: 'network', Created: 'created', Labels: {}, Containers: Object.fromEntries(containerIds.map(id => [id, {}])) }]
    const run = vi.fn(async (_file: string, args: string[]) => {
      if (args[0] === 'ps') return containerIds.join('\n')
      if (args[1] === 'ls') return args[0] === 'volume' ? volumes.map(v => v.Name).join('\n') : networkId
      if (args[0] === 'inspect') return containers.filter(c => args.includes(c.id)).map(c => JSON.stringify(substitute ? { ...c, id: '4'.padStart(64, '0') } : c)).join('\n')
      if (args[0] === 'volume') return JSON.stringify(volumes.filter(v => args.includes(v.Name)))
      return JSON.stringify(networks)
    })
    return { run, containerIds, networkId }
  }
  it('batches complete global inventory without caching or dropping foreign attachments', async () => {
    const { run, containerIds, networkId } = inventoryRunner()
    const resources = await assignmentListDockerInventory(run)
    expect(resources).toHaveLength(617)
    expect(resources.find(r => r.kind === 'volume' && r.name === 'volume_0')?.attachedIds).toEqual(containerIds)
    expect(resources.find(r => r.id === networkId)?.attachedIds).toEqual(containerIds)
    expect(resources.find(r => r.id === containerIds[0])?.attachedIds).toContain('volume:volume_0:created')
    expect(run.mock.calls).toHaveLength(10)
    expect(run.mock.calls.filter(([, args]) => args[0] === 'volume' && args[1] === 'inspect').every(([, args]) => args.length <= 130)).toBe(true)
    expect(run.mock.calls.every(([, args]) => !args.includes('--filter'))).toBe(true)
    await assignmentListDockerInventory(run)
    expect(run.mock.calls).toHaveLength(20)
  })
  it('fails closed if a batch returns a substituted or incomplete inspected identity', async () => {
    await expect(assignmentListDockerInventory(inventoryRunner(true).run)).rejects.toThrow()
    const { run } = inventoryRunner()
    await expect(assignmentListDockerInventory(async (file, args) => {
      const output = await run(file, args)
      return args[0] === 'volume' && args[1] === 'inspect' ? JSON.stringify(JSON.parse(output).slice(1)) : output
    })).rejects.toThrow()
  })
  it('keeps startup error output in one private no-overwrite receipt, not the console', () => {
    const project = `pika_assignment_list_${randomUUID().replaceAll('-', '').slice(0, 12)}`
    const path = `${assignmentListProofWorkdir(project)}-startup.json`
    try {
      expect(writeAssignmentListStartupDiagnostic(project, { code: 1, killed: false, stdout: '漢'.repeat(6000), stderr: 'Synthetic private error' })).toBe(path)
      expect(statSync(path).mode & 0o777).toBe(0o600)
      const receipt = JSON.parse(readFileSync(path, 'utf8'))
      expect(receipt).toMatchObject({ code: 1, stderr: 'Synthetic private error' })
      expect(Buffer.byteLength(receipt.stdout, 'utf8')).toBeLessThanOrEqual(16384)
      expect(receipt.stdout).not.toContain('�')
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
