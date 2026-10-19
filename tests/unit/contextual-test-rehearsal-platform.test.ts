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
const binding = () => ({ version: 1, projectId, ...Object.fromEntries(['sourceSha','sourceTree','appOverlaySha256','migrationChainSha256','appOrigin','apiOrigin'].map(k => [k, plan[k as keyof typeof plan]])),
  nonce: '0123456789abcdef0123012345abcdef', startedAt: now - 1000, deadline: now + 100000, cleanupDeadline: now + 200000,
  planSha256: sha(JSON.stringify(plan)), password: 'Private-CPU-fixture-password', workdir,
  appDir: join(workdir, 'app'), outputDir: '/private/tmp/cpu-durable-receipts', dependencyManifestSha256: 'a'.repeat(64),
  docker: { path: '/usr/local/bin/docker', sha256: 'b'.repeat(64), host: 'unix:///private/tmp/docker.sock', socketIdentity: [1,2,3,4], containerId: 'c'.repeat(64) } })

describe('Tests rehearsal binding and fixed SQL', () => {
  it('seals login-only into a strict immutable Survey binding and rejects stripped or malformed selection', () => {
    const proofScope = 'survey-workflow-v1' as const, survey = createContextualTestPlan(projectId, proofScope)
    const candidate = { ...binding(), proofScope, diagnostic: 'login-only', sourceSha: survey.sourceSha, sourceTree: survey.sourceTree,
      migrationChainSha256: survey.migrationChainSha256, planSha256: sha(JSON.stringify(survey)) }
    const selected = validateContextualTestRunBinding(candidate, now)
    expect(Object.isFrozen(selected)).toBe(true); expect(selected.diagnostic).toBe('login-only')
    for (const diagnostic of [undefined, null, true, 'other']) expect(() => validateContextualTestRunBinding({ ...candidate, diagnostic }, now)).toThrow()
    for (const proofScope of [undefined, 'vertical-v1', 'lifecycle-permissions-v1', 'vertical-grade-return-v1'])
      expect(() => validateContextualTestRunBinding({ ...candidate, proofScope }, now)).toThrow()
    const outputDir = realpathSync(mkdtempSync(join(tmpdir(), 'pika-binding-login-cpu-')))
    try {
      chmodSync(outputDir, 0o700)
      const file = join(outputDir, 'run-binding.json'), content = JSON.stringify({ ...candidate, outputDir })
      writeFileSync(file, content, { mode: 0o600 })
      expect(readContextualTestBinding(file, sha(content)).diagnostic).toBe('login-only')
      const stripped = JSON.parse(content); delete stripped.diagnostic
      writeFileSync(file, JSON.stringify(stripped), { mode: 0o600 })
      expect(() => readContextualTestBinding(file, sha(content))).toThrow()
    } finally { rmSync(outputDir, { recursive: true, force: true }) }
  })
  it('binds Survey269 and rejects downgraded, forged, expired or SQL-capable Survey bindings', () => {
    const proofScope = 'survey-workflow-v1' as const
    const survey = createContextualTestPlan(projectId, proofScope)
    const candidate = { ...binding(), proofScope, sourceSha: survey.sourceSha, sourceTree: survey.sourceTree,
      migrationChainSha256: survey.migrationChainSha256, planSha256: sha(JSON.stringify(survey)) }
    expect(validateContextualTestRunBinding(candidate, now).proofScope).toBe(proofScope)
    for (const drift of [{ proofScope: undefined }, { proofScope: 'survey-workflow-v2' }, { sourceSha: plan.sourceSha },
      { sourceTree: plan.sourceTree }, { migrationChainSha256: plan.migrationChainSha256 },
      { planSha256: sha(JSON.stringify(plan)) }, { sqlControl: {} }]) {
      expect(() => validateContextualTestRunBinding({ ...candidate, ...drift }, now)).toThrow()
    }
    expect(() => validateContextualTestRunBinding(candidate, candidate.deadline)).toThrow()
    const value = validateContextualTestRunBinding(candidate, now)
    expect(contextualTestSql(value, 'surveyWitness')).toContain('READ ONLY')
    expect(() => contextualTestSql(value, 'surveyWitness', 'password')).toThrow()
    for (const kind of ['archiveA', 'restoreArchiveA', 'revokeMemberTeacherA', 'restoreMemberTeacherA'] as const)
      expect(() => contextualTestSql(value, kind)).toThrow()
    expect(() => contextualTestSql(validateContextualTestRunBinding(binding(), now), 'surveyWitness')).toThrow()
  })
  it('binds the exact frozen plan and original finite clock', () => {
    const value = validateContextualTestRunBinding(binding(), now)
    expect(value.projectId).toBe(projectId)
    expect(Object.isFrozen(value.docker.socketIdentity)).toBe(true)
  })
  it('separates narrow proof scope and withholds browser SQL authority', () => {
    expect(validateContextualTestRunBinding({ ...binding(), proofScope: 'vertical-v1' }, now).proofScope).toBe('vertical-v1')
    expect(() => validateContextualTestRunBinding({ ...binding(), proofScope: 'full' }, now)).toThrow()
    expect(() => validateContextualTestRunBinding({ ...binding(), proofScope: 'vertical-v1', sqlControl: {} }, now)).toThrow()
  })
  it.each(['vertical-grade-return-v1', 'lifecycle-permissions-v1'] as const)('binds successor to exact source/plan/chain without historical or Survey drift: %s', proofScope => {
    const successor = createContextualTestPlan(projectId, proofScope)
    const candidate = { ...binding(), proofScope, sourceSha: successor.sourceSha, sourceTree: successor.sourceTree,
      migrationChainSha256: successor.migrationChainSha256, planSha256: sha(JSON.stringify(successor)) }
    expect(validateContextualTestRunBinding(candidate, now).proofScope).toBe(proofScope)
    for (const drift of [{ proofScope: 'vertical-v1' }, { sourceSha: plan.sourceSha }, { sourceTree: plan.sourceTree },
      { migrationChainSha256: plan.migrationChainSha256 }, { migrationChainSha256: 'f'.repeat(64) }, { planSha256: sha(JSON.stringify(plan)) }, { sqlControl: {} }]) {
      expect(() => validateContextualTestRunBinding({ ...candidate, ...drift }, now)).toThrow()
    }
    const validated = validateContextualTestRunBinding(candidate, now)
    for (const operation of ['revokeMemberTeacherA', 'restoreMemberTeacherA', 'archiveA', 'restoreArchiveA'] as const) {
      expect(() => contextualTestSql(validated, operation)).toThrow()
    }
    if (proofScope === 'lifecycle-permissions-v1') {
      expect(contextualTestSql(validated, 'lifecycleWitness')).toContain('READ ONLY')
      expect(() => contextualTestSql(validated, 'gradeReturnWitness')).toThrow()
      expect(() => contextualTestSql(validated, 'lifecycleWitness', 'extra')).toThrow()
    } else expect(() => contextualTestSql(validated, 'lifecycleWitness')).toThrow()
  })
  it('keeps lifecycle roster setup scoped to the new lifecycle plan without changing entitlement policy', () => {
    const hash = '$2b$12$' + 'a'.repeat(53)
    for (const proofScope of [undefined, 'vertical-v1', 'vertical-grade-return-v1', 'lifecycle-permissions-v1'] as const) {
      const scoped = createContextualTestPlan(projectId, proofScope)
      const validated = validateContextualTestRunBinding({ ...binding(), ...(proofScope ? { proofScope } : {}),
        sourceSha: scoped.sourceSha, sourceTree: scoped.sourceTree, migrationChainSha256: scoped.migrationChainSha256,
        planSha256: sha(JSON.stringify(scoped)) }, now)
      const sql = contextualTestSql(validated, 'bootstrap', hash)
      expect(sql.includes('INSERT INTO public.classroom_roster(')).toBe(proofScope === 'lifecycle-permissions-v1')
      expect(sql.includes('fixture_roster_binding_missing')).toBe(proofScope === 'lifecycle-permissions-v1')
      expect(sql).not.toMatch(/set_effective_feature_entitlement|set_account_plan|strict_enforcement_enabled\s*=/i)
    }
  })
  it.each(['sourceSha', 'sourceTree', 'migrationChainSha256', 'complete-old-profile'] as const)(
    'rejects the old267 grade-return %s substituted into the lifecycle binding', defect => {
      const old = createContextualTestPlan(projectId, 'vertical-grade-return-v1')
      const current = createContextualTestPlan(projectId, 'lifecycle-permissions-v1')
      const candidate = { ...binding(), proofScope: 'lifecycle-permissions-v1', sourceSha: current.sourceSha,
        sourceTree: current.sourceTree, migrationChainSha256: current.migrationChainSha256, planSha256: sha(JSON.stringify(current)) }
      const changed = defect === 'complete-old-profile' ? { sourceSha: old.sourceSha, sourceTree: old.sourceTree,
        migrationChainSha256: old.migrationChainSha256, planSha256: sha(JSON.stringify(old)) } : { [defect]: old[defect] }
      expect(() => validateContextualTestRunBinding({ ...candidate, ...changed }, now)).toThrow()
    })
  it.each([undefined, 'vertical-v1', 'vertical-grade-return-v1', 'lifecycle-permissions-v1'] as const)(
    'requires the exact migration count before any adapter operation for %s', async proofScope => {
      const current = createContextualTestPlan(projectId, proofScope)
      const validated = validateContextualTestRunBinding({ ...binding(), ...(proofScope ? { proofScope } : {}),
        sourceSha: current.sourceSha, sourceTree: current.sourceTree, migrationChainSha256: current.migrationChainSha256,
        planSha256: sha(JSON.stringify(current)) }, now)
      const expected = proofScope === 'lifecycle-permissions-v1' ? 268 : proofScope === 'vertical-grade-return-v1' ? 267 : 262
      const work = vi.fn(), settle = vi.fn()
      // Count-only fixtures never reach SQL, source-chain validation or native
      // adapters. Lifecycle explicitly refuses the previously admitted267.
      await expect(runContextualTestDisposableLifecycle(validated, Array(expected - 1).fill(null), {} as never, work, settle))
        .rejects.toMatchObject({ actual: expected - 1, expected })
      expect(work).not.toHaveBeenCalled(); expect(settle).not.toHaveBeenCalled()
    })
  it.each([
    { sourceSha: 'd'.repeat(40) }, { appOverlaySha256: '0'.repeat(64) }, { appOverlaySha256: undefined }, { migrationChainSha256: 'e'.repeat(64) }, { appOrigin: 'http://127.0.0.1:3117' },
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
