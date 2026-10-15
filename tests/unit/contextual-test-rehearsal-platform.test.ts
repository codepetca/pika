import { describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { mkdtempSync, writeFileSync, chmodSync, rmSync, symlinkSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createContextualTestPlan } from '../../e2e/helpers/contextual-test-rehearsal'
import { contextualTestSql, validateContextualTestRunBinding, readContextualTestBinding, validateContextualTestClosure, runContextualTestDisposableLifecycle, contextualTestSetupDiagnostic } from '../../scripts/contextual-test-rehearsal-platform'
import { assignmentListEphemeralPlan, assignmentListExpectedResources } from '../../scripts/contextual-assignment-list-proof-lifecycle'
import { loadAssignmentListReviewedMigrations } from '../../scripts/contextual-assignment-list-proof-platform'
import { assignmentListProofWorkdir } from '../../scripts/contextual-assignment-list-proof-path'

const sha = (s: string) => createHash('sha256').update(s).digest('hex')
const projectId = 'pika_assignment_list_012345abcdef'
const plan = createContextualTestPlan(projectId)
const now = Date.now()
const workdir = assignmentListProofWorkdir(projectId)
const binding = () => ({ version: 1, projectId, ...Object.fromEntries(['sourceSha','sourceTree','migrationChainSha256','appOrigin','apiOrigin'].map(k => [k, plan[k as keyof typeof plan]])),
  nonce: '0123456789abcdef0123012345abcdef', startedAt: now - 1000, deadline: now + 100000, cleanupDeadline: now + 200000,
  planSha256: sha(JSON.stringify(plan)), password: 'Private-CPU-fixture-password', workdir,
  appDir: join(workdir, 'app'), outputDir: '/private/tmp/cpu-durable-receipts', dependencyManifestSha256: 'a'.repeat(64),
  docker: { path: '/usr/local/bin/docker', sha256: 'b'.repeat(64), host: 'unix:///private/tmp/docker.sock', socketIdentity: [1,2,3,4], containerId: 'c'.repeat(64) } })

describe('Tests rehearsal binding and fixed SQL', () => {
  it('binds the exact frozen plan and original finite clock', () => {
    const value = validateContextualTestRunBinding(binding(), now)
    expect(value.projectId).toBe(projectId)
    expect(Object.isFrozen(value.docker.socketIdentity)).toBe(true)
  })
  it.each([
    { sourceSha: 'd'.repeat(40) }, { migrationChainSha256: 'e'.repeat(64) }, { appOrigin: 'http://127.0.0.1:3117' },
    { deadline: now + 2700001 }, { cleanupDeadline: now + 500000 }, { planSha256: 'f'.repeat(64) },
    { outputDir: join(workdir, 'output') }, { nonce: '0'.repeat(32) },
  ])('rejects binding drift %j', change => expect(() => validateContextualTestRunBinding({ ...binding(), ...change }, now)).toThrow())
  it('rejects extra fields, accessors, expired and reconstructed deadlines', () => {
    expect(() => validateContextualTestRunBinding({ ...binding(), extra: true }, now)).toThrow()
    const getter = Object.defineProperty(binding(), 'password', { get: () => { throw new Error('must not evaluate') } })
    expect(() => validateContextualTestRunBinding(getter, now)).toThrow()
    expect(() => validateContextualTestRunBinding(binding(), now + 110000)).toThrow()
  })
  it('reads only exact-hash owned private regular files', () => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), 'contextual-binding-cpu-')))
    try {
      const file = join(dir, 'binding.json'); const content = JSON.stringify({ ...binding(), outputDir: dir })
      writeFileSync(file, content, { mode: 0o600 })
      expect(readContextualTestBinding(file, sha(content)).projectId).toBe(projectId)
      expect(() => readContextualTestBinding(file, '0'.repeat(64))).toThrow()
      const link = join(dir, 'link.json'); symlinkSync(file, link)
      expect(() => readContextualTestBinding(link, sha(content))).toThrow()
      chmodSync(file, 0o644)
      expect(() => readContextualTestBinding(file, sha(content))).toThrow()
    } finally { rmSync(dir, { recursive: true }) }
  })
  it('supplies only named fixture operations; never accepts arbitrary SQL', () => {
    const b = validateContextualTestRunBinding(binding(), now)
    expect(contextualTestSql(b, 'witness')).toContain('READ ONLY')
    expect(contextualTestSql(b, 'archiveA')).toBe(plan.mutations.archiveA)
    expect(() => contextualTestSql(b, 'DROP TABLE' as never)).toThrow()
    expect(() => contextualTestSql(b, 'bootstrap', 'not bcrypt')).toThrow()
    expect(contextualTestSql(b, 'bootstrap', '$2b$12$' + 'a'.repeat(53))).toContain('fixture_identity_collision')
  })
  it('rejects foreign attachments and preexisting resource adoption', () => {
    const resource = { kind: 'container' as const, id: 'db-id', name: `supabase_db_${projectId}`, createdAt: 'today',
      labels: { 'com.supabase.cli.project': projectId, 'com.docker.compose.project': projectId }, attachedIds: [], ports: [54332] }
    expect(validateContextualTestClosure(projectId, [], [resource], false)).toEqual([resource])
    expect(() => validateContextualTestClosure(projectId, [resource], [resource], false)).toThrow()
    expect(() => validateContextualTestClosure(projectId, [], [resource, { ...resource, id: 'foreign', name: 'other', labels: {}, attachedIds: ['db-id'] }], false)).toThrow()
  })
})

describe('Tests-only injected disposable lifecycle', () => {
  // Source text only: no migration is executed by these CPU tests.
  const migrations = loadAssignmentListReviewedMigrations(process.cwd()).slice(0, 262)
  function scenario(failure?: 'start' | 'settlement' | 'drift' | 'canonical' | 'anon', cleanup: {
    longBudget?: boolean; clock?: () => number; afterSettle?: () => void; afterTeardown?: () => void; afterCanonical?: () => void
  } = {}) {
    const b = validateContextualTestRunBinding({ ...binding(), ...(cleanup.longBudget ? { deadline: now + 2699000, cleanupDeadline: now + 3059000 } : {}) }, now)
    const plan = assignmentListEphemeralPlan(b)
    const events: string[] = []; let launched = false, removed = false, snapshots = 0
    const resources = assignmentListExpectedResources(projectId).map((r, n) => ({ ...r, id: `fresh-${n}`, createdAt: 'fresh',
      labels: { 'com.supabase.cli.project': projectId, 'com.docker.compose.project': projectId }, attachedIds: [],
      ports: r.name === `supabase_db_${projectId}` && r.kind === 'container' ? [54332] : r.name === `supabase_kong_${projectId}` ? [54331] : [] }))
    const canonical = { rowDigests: 'all public/private/storage counts+digests', guard168Metadata: 'immutable168', settings: 'off', cronJobs: 'safe', resources: 'canonical IDs' }
    const adapters = {
      async canonicalSnapshot() { events.push('canonical'); const after = snapshots++ > 0; if (after) cleanup.afterCanonical?.(); return { ...canonical, ...(failure === 'canonical' && after ? { settings: 'drift' } : {}) } },
      async inventory() { return { resources: launched && !removed ? resources.map(r => ({ ...r })) : [], occupiedPorts: [], workdirExists: false } },
      async prepare() { events.push('prepare'); return { workdir: b.workdir, realpath: b.workdir, created: true, configSha256: sha(plan.config), migrations: migrations.map(({ name, sha256 }) => ({ name, sha256 })), envFiles: [], symlinks: [] } },
      async command({ args }: { args: string[] }) {
        if (args[0] === 'start') { events.push('start'); launched = true; if (failure === 'start') throw new Error('ambiguous start'); return }
        return { API_URL: b.apiOrigin, DB_URL: 'postgres://postgres:synthetic@127.0.0.1:54332/postgres', SERVICE_ROLE_KEY: `demo.${Buffer.from(JSON.stringify({ iss: 'supabase-demo', role: 'service_role' })).toString('base64url')}.demo`,
          ANON_KEY: `demo.${Buffer.from(JSON.stringify({ iss: 'supabase-demo', role: failure === 'anon' ? 'service_role' : 'anon' })).toString('base64url')}.demo` }
      },
      async verifyEphemeral() { return { projectId, containerId: resources[0].id, dbPort: 54332 as const, applicationName: `${projectId}_fixture`, guard168Enabled: true, persistedGatesOff: true, activeNetworkCronAbsent: true } },
      async teardown(request: { stopArgs: string[] | null }) { expect(request.stopArgs).toBeNull(); events.push('teardown'); removed = true; cleanup.afterTeardown?.() },
      async removeWorkdir() { events.push('remove-workdir') },
    }
    const run = () => runContextualTestDisposableLifecycle(b, migrations, adapters, async (target, _resources, status) => {
      expect(status.API_URL).toBe(target.API_URL); expect(status.SERVICE_ROLE_KEY).toBe(target.SERVICE_ROLE_KEY)
      expect(status.ANON_KEY).toBeDefined(); expect(Object.isFrozen(status)).toBe(true)
      events.push('work'); if (failure === 'drift') resources[0].id = 'replacement'
    }, async () => { events.push('settle'); cleanup.afterSettle?.(); if (failure === 'settlement') throw new Error('unjoined') }, cleanup.clock)
    return { run, events, adapters }
  }
  it.each([
    ['start', 'start', 'pre-start', []],
    ['anon', 'status', 'capture', []],
    ['canonical', null, 'work', ['canonical-after']],
    ['settlement', null, 'work', ['owned-processes']],
    ['drift', null, 'work', ['cleanup-closure']],
  ] as const)('retains only sealed fixed setup/cleanup labels for %s', async (failure, firstFailure, lastCompleted, cleanupFailures) => {
    const s = scenario(failure), error = await s.run().catch(error => error)
    expect(error).toBeInstanceOf(AggregateError)
    const diagnostic = contextualTestSetupDiagnostic(error)
    expect(diagnostic).toEqual({ firstFailure, lastCompleted, cleanupFailures })
    expect(Object.isFrozen(diagnostic)).toBe(true); expect(Object.isFrozen(diagnostic!.cleanupFailures)).toBe(true)
    expect(JSON.stringify(diagnostic)).not.toMatch(/ambiguous|unjoined|replacement|postgres|demo/)
  })
  it('does not read or trust hostile exception properties or fabricated diagnostics', async () => {
    const getter = vi.fn(() => { throw Error('SECRET password URL path') })
    const hostile = new Proxy({}, { get: getter, ownKeys: getter, getPrototypeOf: getter })
    const s = scenario(); s.adapters.canonicalSnapshot = async () => { throw hostile }
    const error = await s.run().catch(error => error)
    expect(contextualTestSetupDiagnostic(error)).toEqual({ firstFailure: 'canonical-before', lastCompleted: null, cleanupFailures: [] })
    for (const fake of [null, 'SECRET', hostile, { firstFailure: 'start' }, new AggregateError([error])]) expect(contextualTestSetupDiagnostic(fake)).toBeNull()
    expect(getter).not.toHaveBeenCalled()
    expect(JSON.stringify(contextualTestSetupDiagnostic(error))).not.toContain('SECRET')
  })
  it.each(['prepare', 'verifyEphemeral'] as const)('labels %s adapter failure while still cleaning up', async method => {
    const s = scenario(); vi.spyOn(s.adapters, method).mockRejectedValueOnce(Error('SECRET private fixture'))
    const error = await s.run().catch(error => error)
    expect(contextualTestSetupDiagnostic(error)?.firstFailure).toBe(method === 'prepare' ? 'prepare' : 'verify-ephemeral')
    expect(s.events).not.toContain('work'); expect(s.events).toContain('settle')
    expect(JSON.stringify(contextualTestSetupDiagnostic(error))).not.toContain('SECRET')
  })
  it.each([[1, 'inventory'], [2, 'pre-start'], [3, 'capture']] as const)('distinguishes inventory call %s as %s', async (at, step) => {
    const s = scenario(), original = s.adapters.inventory
    let calls = 0
    s.adapters.inventory = async () => { if (++calls === at) throw Error('SECRET inventory'); return original() }
    const error = await s.run().catch(error => error)
    expect(contextualTestSetupDiagnostic(error)?.firstFailure).toBe(step)
    expect(s.events).not.toContain('work'); expect(s.events).toContain('settle')
  })
  it.each(['teardown', 'removeWorkdir'] as const)('retains %s cleanup failure without inventing a setup failure', async method => {
    const s = scenario(); vi.spyOn(s.adapters, method).mockRejectedValueOnce(Error('SECRET cleanup'))
    const error = await s.run().catch(error => error)
    expect(contextualTestSetupDiagnostic(error)).toEqual({ firstFailure: null, lastCompleted: 'work', cleanupFailures: [method === 'teardown' ? 'resource-teardown' : 'workdir-remove'] })
    expect(s.events.at(-1)).toBe('canonical')
  })
  it('settles before exact disposal and compares the complete canonical witness', async () => {
    const s = scenario(); await s.run()
    expect(s.events).toEqual(['canonical','prepare','start','work','settle','teardown','remove-workdir','canonical'])
  })
  it('discovers the exact new closure after an ambiguous start failure', async () => {
    const s = scenario('start'); await expect(s.run()).rejects.toThrow('Private Tests lifecycle failed')
    expect(s.events).toEqual(['canonical','prepare','start','settle','teardown','remove-workdir','canonical'])
  })
  it.each(['settlement','drift'] as const)('refuses disposal on uncertain %s', async failure => {
    const s = scenario(failure); await expect(s.run()).rejects.toThrow()
    expect(s.events).not.toContain('teardown'); expect(s.events).not.toContain('remove-workdir')
    expect(s.events.at(-1)).toBe('canonical')
  })
  it('reports canonical drift instead of overwriting it', async () => {
    const s = scenario('canonical'); await expect(s.run()).rejects.toThrow()
    expect(s.events.filter(v => v === 'canonical')).toHaveLength(2)
  })
  it('rejects a privileged key in the anon slot before app work and still cleans up', async () => {
    const s = scenario('anon'); await expect(s.run()).rejects.toThrow()
    expect(s.events).not.toContain('work')
    expect(s.events).toContain('teardown'); expect(s.events).toContain('remove-workdir')
  })
  it('caps cleanup at six minutes after an early failure even with a much later global reserve', async () => {
    vi.useFakeTimers(); vi.setSystemTime(now)
    try {
      const s = scenario('start', { longBudget: true, afterSettle: () => vi.setSystemTime(now + 360001) })
      await expect(s.run()).rejects.toThrow('Private Tests lifecycle failed')
      expect(s.events).toContain('settle'); expect(s.events).not.toContain('teardown'); expect(s.events).not.toContain('remove-workdir')
      expect(s.events.filter(value => value === 'canonical')).toHaveLength(1)
    } finally { vi.useRealTimers() }
  })
  it('shares one original cleanup clock and checks the end after teardown awaits', async () => {
    vi.useFakeTimers(); vi.setSystemTime(now)
    try {
      const clock = vi.fn(() => now + 100)
      const s = scenario(undefined, { clock, afterTeardown: () => vi.setSystemTime(now + 101) })
      await expect(s.run()).rejects.toThrow('Private Tests lifecycle failed')
      expect(clock).toHaveBeenCalledOnce(); expect(s.events).toContain('teardown'); expect(s.events).not.toContain('remove-workdir')
      expect(s.events.filter(value => value === 'canonical')).toHaveLength(1)
    } finally { vi.useRealTimers() }
  })
  it('does not accept a canonical preservation read that finishes beyond the shared cleanup end', async () => {
    vi.useFakeTimers(); vi.setSystemTime(now)
    try {
      const s = scenario(undefined, { clock: () => now + 100, afterCanonical: () => vi.setSystemTime(now + 101) })
      await expect(s.run()).rejects.toThrow('Private Tests lifecycle failed')
      expect(s.events).toContain('remove-workdir'); expect(s.events.filter(value => value === 'canonical')).toHaveLength(2)
    } finally { vi.useRealTimers() }
  })
  it('rejects cleanup-clock extension and uses the shorter original absolute reserve', async () => {
    vi.useFakeTimers(); vi.setSystemTime(now)
    try {
      const invalid = scenario(undefined, { clock: () => now + 200001 })
      await expect(invalid.run()).rejects.toThrow('Private Tests lifecycle failed')
      expect(invalid.events).not.toContain('settle'); expect(invalid.events).not.toContain('teardown')
      const late = scenario('start', { afterSettle: () => vi.setSystemTime(now + 200001) })
      await expect(late.run()).rejects.toThrow('Private Tests lifecycle failed')
      expect(late.events).toContain('settle'); expect(late.events).not.toContain('teardown')
    } finally { vi.useRealTimers() }
  })
})
