import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { createHash } from 'node:crypto'
import { lstatSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const doubles = vi.hoisted(() => ({ spawn: vi.fn(), settle: vi.fn(), nativeClosed: vi.fn(), native: vi.fn() }))
vi.mock('node:child_process', async original => ({ ...await original<typeof import('node:child_process')>(), spawn: doubles.spawn }))
vi.mock('../../scripts/contextual-test-rehearsal-native', () => ({ createContextualTestNativeControls: doubles.native }))
vi.mock('../../scripts/contextual-test-rehearsal-launch', async original => {
  const actual = await original<typeof import('../../scripts/contextual-test-rehearsal-launch')>()
  return { ...actual, createContextualTestPinnedCommand: (pins: Parameters<typeof actual.createContextualTestPinnedCommand>[0], budget: Parameters<typeof actual.createContextualTestPinnedCommand>[1], seams: Parameters<typeof actual.createContextualTestPinnedCommand>[2]) =>
    actual.createContextualTestPinnedCommand(pins, budget, { ...seams, verify() {}, spawn: doubles.spawn }) }
})
import { assertContextualTestSqlSettled, executeContextualTestSql, readContextualTestBinding, validateContextualTestRunBinding } from '../../scripts/contextual-test-rehearsal-platform'
import { createContextualTestPlan } from '../../e2e/helpers/contextual-test-rehearsal'
import { createContextualTestPinnedCommand } from '../../scripts/contextual-test-rehearsal-launch'
import { runContextualTestRehearsalController, type ContextualTestControllerAdmission, type ContextualTestControllerEdges } from '../../scripts/contextual-test-rehearsal-controller'

class Child extends EventEmitter {
  readonly stdout = new EventEmitter()
  readonly stderr = new EventEmitter()
  readonly stdin = Object.assign(new EventEmitter(), { end: vi.fn() })
  readonly kill = vi.fn(() => { throw new Error('Raw child signal forbidden') })
  constructor(readonly pid: number) { super() }
}
const projectId = 'pika_assignment_list_123456abcdef', plan = createContextualTestPlan(projectId)
const sha = (text: string) => createHash('sha256').update(text).digest('hex')
const directories: string[] = []
let behavior: 'success' | 'unjoined' | 'closed-failure' | 'overflow' | 'foreign-container', events: string[], children: Child[]
beforeEach(() => {
  behavior = 'success'; events = []; children = []
  doubles.spawn.mockReset(); doubles.settle.mockReset(); doubles.nativeClosed.mockReset(); doubles.native.mockReset()
  doubles.native.mockImplementation(() => ({ settleCommand: doubles.settle, assertClosed: doubles.nativeClosed }))
  doubles.settle.mockImplementation(async (child: Child) => {
    events.push('owned-settle')
    if (behavior === 'unjoined') throw new Error('CPU ownership cannot prove close')
    child.emit('close', 1, null)
  })
  doubles.spawn.mockImplementation((_file: string, args: string[]) => {
    const child = new Child(5000 + children.length); children.push(child)
    child.stdin.end.mockImplementation(() => queueMicrotask(() => {
      const inspect = args.includes('inspect')
      events.push(inspect ? 'inspect' : 'sql')
      if (!inspect && behavior === 'unjoined') return
      if (!inspect && behavior === 'closed-failure') { child.emit('close', 1, null); return }
      if (!inspect && behavior === 'overflow') { child.stdout.emit('data', Buffer.alloc(1048577)); return }
      child.stdout.emit('data', Buffer.from(inspect ? JSON.stringify({ id: behavior === 'foreign-container' ? 'f'.repeat(64) : 'c'.repeat(64), name: `/supabase_db_${projectId}`, running: true,
        labels: { 'com.supabase.cli.project': projectId, 'com.docker.compose.project': projectId } }) : '{}'))
      child.emit('close', 0, null)
    }))
    return child
  })
})
afterEach(() => {
  vi.useRealTimers()
  for (const dir of directories.splice(0)) rmSync(dir, { recursive: true })
})
function fixture(withControl = true) {
  const outputDir = realpathSync(mkdtempSync(join(tmpdir(), 'contextual-sql-ownership-cpu-'))); directories.push(outputDir)
  const pin = { path: '/cpu/pinned-binary', sha256: 'b'.repeat(64) }
  const transportPins = { git: pin, docker: pin, supabase: pin, dockerHost: 'unix:///cpu/docker.sock', socketIdentity: [1,2,3,4], outputDir }
  const nativePins = { node: pin, ps: pin, python: pin, lsof: pin, sandbox: pin, codesign: pin, chrome: pin, docker: pin, helper: pin, dockerHost: transportPins.dockerHost, outputDir }
  const now = Date.now(), data = { version: 1, projectId, sourceSha: plan.sourceSha, sourceTree: plan.sourceTree,
    appOrigin: plan.appOrigin, apiOrigin: plan.apiOrigin, migrationChainSha256: plan.migrationChainSha256,
    planSha256: sha(JSON.stringify(plan)), nonce: '0'.repeat(20) + projectId.slice(-12), startedAt: now - 1, deadline: now + 60000, cleanupDeadline: now + 120000,
    password: 'synthetic-private-password', workdir: '/private/tmp/pika-assignment-list-123456abcdef', appDir: '/private/tmp/pika-assignment-list-123456abcdef/app',
    outputDir, dependencyManifestSha256: 'a'.repeat(64), docker: { ...pin, host: transportPins.dockerHost, socketIdentity: [1,2,3,4], containerId: 'c'.repeat(64) },
    ...(withControl ? { sqlControl: { nativePins, transportPins } } : {}) }
  const file = join(outputDir, 'binding.json'), text = JSON.stringify(data); writeFileSync(file, text, { mode: 0o600 })
  const binding = readContextualTestBinding(file, sha(text))
  return { binding, data, file, sha256: sha(text), reread: () => readContextualTestBinding(file, sha(text)), marker: join(outputDir, 'sql-uncertain.json') }
}

describe('fixed SQL uses the admitted tracked native transport (CPU doubles only)', () => {
  it('uses the existing pinned command and ownership controller for worker SQL, closing before acknowledgment', async () => {
    const f = fixture()
    expect(doubles.spawn).not.toHaveBeenCalled(); expect(doubles.native).not.toHaveBeenCalled()
    await expect(executeContextualTestSql(f.binding, 'witness')).resolves.toBe('{}')
    expect(doubles.native).toHaveBeenCalledExactlyOnceWith(f.binding.sqlControl!.nativePins, f.binding.cleanupDeadline)
    expect(doubles.nativeClosed).toHaveBeenCalled()
    expect(events).toEqual(['inspect','sql'])
    const [file, args, options] = doubles.spawn.mock.calls[1]
    expect(file).toBe(f.binding.docker.path)
    expect(args).toEqual(['--host', f.binding.docker.host, 'exec','-i','-e',`PGAPPNAME=${projectId}_fixture`, f.binding.docker.containerId,
      'psql','-X','-q','-A','-t','-v','ON_ERROR_STOP=1','-U','postgres','-d','postgres'])
    expect(options).toMatchObject({ detached: true, shell: false, cwd: f.binding.outputDir })
    expect(children[1].stdin.end).toHaveBeenCalledWith(expect.stringContaining('REPEATABLE READ READ ONLY'))
    expect(() => assertContextualTestSqlSettled(f.reread())).not.toThrow()
  })
  it('uses the explicit root transport for bootstrap and joins it before returning', async () => {
    const f = fixture(), command = createContextualTestPinnedCommand(f.binding.sqlControl!.transportPins, f.binding, { settle: doubles.settle })
    const joined: string[] = []
    const transport = { ...command, async joinSettlements() { joined.push('join'); await command.joinSettlements() } }
    await executeContextualTestSql(f.binding, 'bootstrap', '$2b$12$' + 'a'.repeat(53), transport)
    expect(doubles.native).not.toHaveBeenCalled()
    expect(joined).toHaveLength(3)
    expect(children[1].stdin.end).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO public.users'))
    expect(() => assertContextualTestSqlSettled(f.binding)).not.toThrow()
  })
  it('does not acknowledge an exit event until actual close and keeps the marker while pending', async () => {
    vi.useFakeTimers(); const f = fixture(); behavior = 'unjoined'; let acknowledged = false
    const pending = executeContextualTestSql(f.binding, 'witness').then(value => { acknowledged = true; return value })
    await vi.advanceTimersByTimeAsync(0)
    children[1].stdout.emit('data', Buffer.from('{}')); children[1].emit('exit', 0, null)
    await vi.advanceTimersByTimeAsync(100)
    expect(acknowledged).toBe(false); expect(() => assertContextualTestSqlSettled(f.reread())).toThrow('closure unconfirmed')
    children[1].emit('close', 0, null)
    await expect(pending).resolves.toBe('{}')
    expect(doubles.settle).not.toHaveBeenCalled(); expect(() => assertContextualTestSqlSettled(f.reread())).not.toThrow()
  })
  it('blocks controller launch and exact disposal when real bootstrap SQL ownership never closes', async () => {
    vi.useFakeTimers(); const f = fixture(); behavior = 'unjoined'
    const command = createContextualTestPinnedCommand(f.binding.sqlControl!.transportPins, f.binding, { settle: doubles.settle })
    const receipts: unknown[] = [], lifecycleEvents: string[] = []
    const source = { repository: '/cpu/frozen', head: plan.sourceSha, tree: plan.sourceTree, entries: [], sha256: 'a'.repeat(64), bytes: 0 }
    const admission: ContextualTestControllerAdmission = {
      version: 1, projectId, nonce: f.binding.nonce, migrationChainSha256: plan.migrationChainSha256,
      startedAt: f.binding.startedAt, deadline: f.binding.deadline, cleanupDeadline: f.binding.cleanupDeadline,
      workdir: f.binding.workdir, appDir: f.binding.appDir, outputDir: f.binding.outputDir,
      password: f.binding.password, sessionSecret: 's'.repeat(64), frozen: source,
      runner: { ...source, repository: '/cpu/runner', head: 'd'.repeat(40), tree: 'e'.repeat(40) },
      review: { manifestSha256: 'f'.repeat(64), runnerHead: 'd'.repeat(40), runnerTree: 'e'.repeat(40) },
      dependencies: { root: '/cpu/deps', sha256: f.binding.dependencyManifestSha256, roots: ['/cpu/deps'] },
      transportPins: f.binding.sqlControl!.transportPins,
      assignmentMetadata: { manifest: { syntheticTag: 'assignmentlist_123456abcdef' } } as ContextualTestControllerAdmission['assignmentMetadata'],
      migrations: [],
    }
    const token = (role: string) => `header.${Buffer.from(JSON.stringify({ iss: 'supabase-demo', role })).toString('base64url')}.signature`
    const status = { API_URL: plan.apiOrigin, DB_URL: 'postgresql://postgres:demo@127.0.0.1:54332/postgres', ANON_KEY: token('anon'), SERVICE_ROLE_KEY: token('service_role') }
    const unexpected = () => { throw new Error('Reached a stage after uncertain bootstrap SQL') }
    const controls = {
      now: () => Date.now(), command, sqlControl: f.binding.sqlControl,
      async assertReady() {}, async assertUnchanged() {},
      launchApp: vi.fn(async () => { unexpected(); return { ready: async () => {} } }),
      launchPlaywright: vi.fn(async () => { unexpected(); return { wait: async () => ({ code: 0, signal: null, closed: true }) } }),
      settleAll: vi.fn(async () => { lifecycleEvents.push('native-settled') }),
    }
    const edges: ContextualTestControllerEdges = {
      openEvidence() {}, prepareApp() {}, createAdapters: () => ({ verifyEphemeral: unexpected }) as never,
      async lifecycle(_identity, _migrations, _adapters, work, settle) {
        try {
          await work(status, [{ kind: 'container', id: f.binding.docker.containerId, name: `supabase_db_${projectId}`,
            ports: [54332], labels: { 'com.supabase.cli.project': projectId, 'com.docker.compose.project': projectId }, attachedIds: [], createdAt: 'synthetic' }], status)
        } finally {
          lifecycleEvents.push('settlement-required')
          await settle()
          lifecycleEvents.push('exact-disposal', 'workdir-removal')
        }
      },
      bind(candidate) { expect(candidate).toEqual(f.binding); return { binding: f.binding, file: f.file, sha256: f.sha256 } },
      passwordHash: async () => '$2b$12$' + 'a'.repeat(53),
      sql: executeContextualTestSql, assertSqlSettled: assertContextualTestSqlSettled,
      createLedger: unexpected, readPlaywrightReceipt: unexpected, verifyArtifacts: unexpected,
      writeReceipt(receipt) { receipts.push(receipt) },
    }
    const rawSignal = vi.spyOn(process, 'kill').mockImplementation(() => { throw new Error('Raw process signal forbidden') })
    try {
      const pending = runContextualTestRehearsalController(admission, controls, edges)
      const rejected = expect(pending).rejects.toThrow('Private contextual Test controller failed')
      await vi.advanceTimersByTimeAsync(0)
      expect(events).toEqual(['inspect', 'sql'])
      expect(children[1].stdin.end).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO public.users'))
      await vi.advanceTimersByTimeAsync(42000); await rejected
      expect(doubles.native).not.toHaveBeenCalled() // The root's real pinned transport owns bootstrap SQL.
      expect(doubles.settle).toHaveBeenCalledOnce()
      expect(doubles.settle.mock.calls[0][0]).toBe(children[1])
      expect(command.state()).toMatchObject({ poisoned: true, pending: 1 })
      expect(() => command.assertClosed()).toThrow()
      expect(controls.launchApp).not.toHaveBeenCalled(); expect(controls.launchPlaywright).not.toHaveBeenCalled()
      expect(lifecycleEvents).toEqual(['settlement-required'])
      expect(receipts).toHaveLength(1)
      expect(receipts[0]).toMatchObject({ outcome: 'failed', firstFailureStage: 'fixture', ownedSettled: false, lifecycleCompleted: false, playwrightValidated: false })
      expect(JSON.parse(readFileSync(f.marker, 'utf8'))).toMatchObject({ uncertain: true, nonce: f.binding.nonce })
      expect(lstatSync(f.marker).mode & 0o777).toBe(0o600)
      expect(() => assertContextualTestSqlSettled(f.reread())).toThrow('closure unconfirmed')
      expect(children[1].kill).not.toHaveBeenCalled(); expect(rawSignal).not.toHaveBeenCalled()
    } finally { rawSignal.mockRestore() }
  })
  it('does not clear an altered marker even after its own child positively closes', async () => {
    vi.useFakeTimers(); const f = fixture(); behavior = 'unjoined'
    const pending = executeContextualTestSql(f.binding, 'witness')
    const rejected = expect(pending).rejects.toThrow('Private SQL child closure unconfirmed')
    await vi.advanceTimersByTimeAsync(0)
    writeFileSync(f.marker, 'changed-marker')
    children[1].stdout.emit('data', Buffer.from('{}')); children[1].emit('close', 0, null)
    await rejected
    expect(readFileSync(f.marker, 'utf8')).toBe('changed-marker')
    expect(() => assertContextualTestSqlSettled(f.reread())).toThrow('closure unconfirmed')
  })
  it.each(['worker','bootstrap'] as const)('retains durable uncertainty and forbids disposal after an unjoined %s SQL child', async role => {
    vi.useFakeTimers(); const f = fixture(); behavior = 'unjoined'
    const command = role === 'bootstrap' ? createContextualTestPinnedCommand(f.binding.sqlControl!.transportPins, f.binding, { settle: doubles.settle }) : undefined
    const pending = executeContextualTestSql(f.binding, role === 'bootstrap' ? 'bootstrap' : 'witness', role === 'bootstrap' ? '$2b$12$' + 'a'.repeat(53) : undefined, command)
    const rejected = expect(pending).rejects.toThrow('Private SQL child closure unconfirmed')
    await vi.advanceTimersByTimeAsync(0)
    const marker = JSON.parse(readFileSync(f.marker, 'utf8'))
    expect(marker).toEqual({ version: 1, projectId, nonce: f.binding.nonce, deadline: f.binding.deadline, uncertain: true })
    expect(lstatSync(f.marker).mode & 0o777).toBe(0o600)
    expect(() => assertContextualTestSqlSettled(f.reread())).toThrow('closure unconfirmed')
    await vi.advanceTimersByTimeAsync(42000); await rejected
    expect(doubles.settle).toHaveBeenCalledOnce()
    expect(() => assertContextualTestSqlSettled(f.binding)).toThrow('closure unconfirmed')
    expect(() => assertContextualTestSqlSettled(f.reread())).toThrow('closure unconfirmed')
    expect(readFileSync(f.marker, 'utf8')).not.toMatch(/password|SQL|raw/)
    children[1].emit('close', 0, null) // Late close cannot promote the poisoned run.
    expect(() => assertContextualTestSqlSettled(f.reread())).toThrow('closure unconfirmed')
  })
  it('clears only its own pending marker after a failed command positively closes', async () => {
    const f = fixture(); behavior = 'closed-failure'
    await expect(executeContextualTestSql(f.binding, 'witness')).rejects.toThrow('Private rehearsal SQL command failed')
    expect(doubles.settle).not.toHaveBeenCalled()
    expect(() => assertContextualTestSqlSettled(f.reread())).not.toThrow()
  })
  it('keeps the one-MiB transport cap and requires verified settlement after overflow', async () => {
    const f = fixture(); behavior = 'overflow'
    await expect(executeContextualTestSql(f.binding, 'witness')).rejects.toThrow('Private rehearsal SQL command failed')
    expect(doubles.settle).toHaveBeenCalledOnce()
    expect(() => assertContextualTestSqlSettled(f.reread())).not.toThrow()
  })
  it('refuses arbitrary SQL, missing worker ownership, foreign container IDs and existing markers before SQL dispatch', async () => {
    const missing = fixture(false)
    await expect(executeContextualTestSql(missing.binding, 'witness')).rejects.toThrow('ownership binding required')
    await expect(executeContextualTestSql(missing.binding, 'DROP TABLE' as never)).rejects.toThrow()
    expect(doubles.spawn).not.toHaveBeenCalled()
    const existing = fixture(); writeFileSync(existing.marker, 'unowned marker', { mode: 0o600 })
    await expect(executeContextualTestSql(existing.binding, 'witness')).rejects.toThrow('closure unconfirmed')
    expect(readFileSync(existing.marker, 'utf8')).toBe('unowned marker'); expect(doubles.spawn).not.toHaveBeenCalled()
    const foreign = fixture(); behavior = 'foreign-container'
    await expect(executeContextualTestSql(foreign.binding, 'witness')).rejects.toThrow('Private rehearsal SQL command failed')
    expect(events).toEqual(['inspect']); expect(() => assertContextualTestSqlSettled(foreign.binding)).not.toThrow()
  })
  it('binds worker pins to the same Docker executable, socket and private directory', () => {
    const f = fixture(), value = f.data
    expect(Object.isFrozen(f.binding.sqlControl!.nativePins.node)).toBe(true)
    expect(Object.isFrozen(f.binding.sqlControl!.transportPins.socketIdentity)).toBe(true)
    for (const sqlControl of [
      { ...value.sqlControl!, nativePins: { ...value.sqlControl!.nativePins, outputDir: '/foreign' } },
      { ...value.sqlControl!, nativePins: { ...value.sqlControl!.nativePins, dockerHost: 'unix:///foreign.sock' } },
      { ...value.sqlControl!, transportPins: { ...value.sqlControl!.transportPins, socketIdentity: [2,2,3,4] } },
      { ...value.sqlControl!, transportPins: { ...value.sqlControl!.transportPins, docker: { path: '/foreign/docker', sha256: 'b'.repeat(64) } } },
    ]) expect(() => validateContextualTestRunBinding({ ...value, sqlControl })).toThrow()
    expect(doubles.spawn).not.toHaveBeenCalled()
  })
})
