import { createHash } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { assignmentListEphemeralPlan } from '../../scripts/contextual-assignment-list-proof-lifecycle'
import { assignmentListProofWorkdir } from '../../scripts/contextual-assignment-list-proof-path'
import { generateTestDraftGetTypes, testDraftGetTypeGenerationPlan } from '../../scripts/generate-contextual-test-draft-get-types'
import type { AssignmentListResource } from '../../scripts/contextual-assignment-list-proof-lifecycle'

const state = vi.hoisted(() => ({ config: '', copiesChanged: false, count: 247, writes: vi.fn() }))
const digest = (value: string) => createHash('sha256').update(value).digest('hex')
vi.mock('node:fs', () => ({
  realpathSync: (path: string) => path,
  readFileSync: (path: string) => path.endsWith('config.toml') ? state.config : state.copiesChanged ? 'changed' : 'synthetic schema',
  writeFileSync: (...args: unknown[]) => state.writes(...args),
}))
vi.mock('../../scripts/contextual-assignment-list-proof-platform', () => ({
  loadAssignmentListReviewedMigrations: () => Array.from({ length: state.count }, (_, index) => ({
    name: `${String(index + 1).padStart(3, '0')}_synthetic.sql`, sql: 'synthetic schema', sha256: digest('synthetic schema'),
  })),
}))
vi.mock('../../scripts/contextual-test-owner-list-proof-inventory', () => ({ testOwnerListDockerInventory: vi.fn() }))

const projectId = 'pika_assignment_list_abcdef123456'
const workdir = assignmentListProofWorkdir(projectId)
const head = 'a'.repeat(40)
const repository = '/private/synthetic-reviewed-repository'
const rows = (): AssignmentListResource[] => [{ kind: 'container', id: 'b'.repeat(64), name: `supabase_db_${projectId}`,
  createdAt: '2026-10-05T00:00:00Z', labels: { 'com.supabase.cli.project': projectId, 'com.docker.compose.project': projectId },
  ports: [54332], attachedIds: [] }]
const generated = 'export type Database = { snapshot_test_draft_for_owner_v1: {}; finish_test_draft_get_for_owner_v1: {} }\n\n'
const run = vi.fn(async (file: string, args: readonly string[]) => {
  if (file === 'supabase') return generated
  return args.includes('HEAD') ? head : ''
})
const guard = vi.fn(async () => {})
const inventory = vi.fn(async () => rows())
const invoke = () => generateTestDraftGetTypes({ repository, reviewedHead: head, projectId, guard }, run, inventory)

describe('reviewed isolated draft GET type generation, offline only', () => {
  beforeEach(() => {
    state.config = assignmentListEphemeralPlan({ projectId, workdir }).config
    state.count = 247; state.copiesChanged = false; state.writes.mockReset(); guard.mockClear()
    inventory.mockReset().mockImplementation(async () => rows())
    run.mockReset().mockImplementation(async (file, args) => file === 'supabase' ? generated : args.includes('HEAD') ? head : '')
  })
  it('fixes the local command, reviewed manifest and private output without source writes', () => {
    const plan = testDraftGetTypeGenerationPlan(repository, head, projectId)
    expect(plan.args).toEqual(['gen', 'types', 'typescript', '--local', '--schema', 'public', '--query-timeout', '15s', '--workdir', workdir])
    expect(plan.outputPath).toContain(head)
    expect(state.writes).not.toHaveBeenCalled()
  })
  it('includes later migrations in the reviewed manifest and still rejects changed copies', () => {
    const baseline = testDraftGetTypeGenerationPlan(repository, head, projectId)
    state.count = 248
    const extended = testDraftGetTypeGenerationPlan(repository, head, projectId)
    expect(extended.migrationManifestSha256).not.toBe(baseline.migrationManifestSha256)
    state.copiesChanged = true
    expect(() => testDraftGetTypeGenerationPlan(repository, head, projectId)).toThrow()
  })
  it('rejects canonical project before any read or command', () => {
    expect(() => testDraftGetTypeGenerationPlan(repository, head, 'pika')).toThrow()
    expect(run).not.toHaveBeenCalled()
  })
  it('rejects retargeted config even when comments contain the expected project and port', () => {
    state.config = state.config.replace('port = 54332', 'port = 54322') + '\n# port = 54332\n'
    expect(() => testDraftGetTypeGenerationPlan(repository, head, projectId)).toThrow()
  })
  it.each(['history', 'copy'])('rejects %s drift', reason => {
    if (reason === 'history') state.count = 246
    else state.copiesChanged = true
    expect(() => testDraftGetTypeGenerationPlan(repository, head, projectId)).toThrow()
  })
  it('requires clean exact HEAD and guards before and after generation; writes only wx0600 artifact', async () => {
    const receipt = await invoke()
    expect(guard).toHaveBeenCalledTimes(2)
    expect(inventory).toHaveBeenCalledTimes(2)
    expect(state.writes).toHaveBeenCalledExactlyOnceWith(receipt.path, generated.trimEnd() + '\n', { mode: 0o600, flag: 'wx' })
    expect(receipt.sha256).toBe(digest(generated.trimEnd() + '\n'))
    expect(run.mock.calls.filter(([file]) => file === 'supabase')).toHaveLength(1)
  })
  it.each(['head', 'dirty'])('rejects %s drift before CLI', async reason => {
    run.mockImplementation(async (file, args) => file === 'supabase' ? generated : args.includes('HEAD') ? reason === 'head' ? 'c'.repeat(40) : head : 'dirty')
    await expect(invoke()).rejects.toThrow()
    expect(run.mock.calls.some(([file]) => file === 'supabase')).toBe(false)
    expect(state.writes).not.toHaveBeenCalled()
  })
  it('rejects a wrong live DB identity before CLI', async () => {
    inventory.mockResolvedValue([{ ...rows()[0], ports: [54322] }])
    await expect(invoke()).rejects.toThrow()
    expect(run.mock.calls.some(([file]) => file === 'supabase')).toBe(false)
  })
  it('refuses artifacts when CLI leaves any resource behind', async () => {
    inventory.mockResolvedValueOnce(rows()).mockResolvedValueOnce([...rows(), { ...rows()[0], id: 'd'.repeat(64), name: 'unsettled-pg-meta' }])
    await expect(invoke()).rejects.toThrow(/closure differs/)
    expect(state.writes).not.toHaveBeenCalled()
  })
  it('checks settlement even after command failure', async () => {
    run.mockImplementation(async (file, args) => {
      if (file === 'supabase') throw new Error('synthetic CLI failure')
      return args.includes('HEAD') ? head : ''
    })
    await expect(invoke()).rejects.toThrow('synthetic CLI failure')
    expect(inventory).toHaveBeenCalledTimes(2); expect(guard).toHaveBeenCalledTimes(2)
    expect(state.writes).not.toHaveBeenCalled()
  })
  it('rejects incomplete generated contract', async () => {
    run.mockImplementation(async (file, args) => file === 'supabase' ? 'export type Database = {}' : args.includes('HEAD') ? head : '')
    await expect(invoke()).rejects.toThrow()
    expect(state.writes).not.toHaveBeenCalled()
  })
})
