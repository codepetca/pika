import { describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { contextualTestAppEnvironment, contextualTestRunnerEnvironment, contextualTestLaunchCommands, validateContextualTestDemoStatus,
  createContextualTestPinnedCommand, contextualTestSnapshotPath, contextualTestReadOnlyDependencyProfile, createContextualTestOwnedFamily } from '../../scripts/contextual-test-rehearsal-launch'
import { createContextualTestPlan } from '../../e2e/helpers/contextual-test-rehearsal'

const plan = createContextualTestPlan('pika_assignment_list_123456abcdef')
const jwt = (role: string) => ['header', Buffer.from(JSON.stringify({ iss: 'supabase-demo', role })).toString('base64url'), 'signature'].join('.')
const status = () => ({ API_URL: plan.apiOrigin, ANON_KEY: jwt('anon'), SERVICE_ROLE_KEY: jwt('service_role'), DB_URL: 'postgresql://postgres:demo@127.0.0.1:54332/postgres' })
const binding = () => ({ version: 1, ...Object.fromEntries(['sourceSha','sourceTree','migrationChainSha256','appOrigin','apiOrigin'].map(k => [k, plan[k as keyof typeof plan]])),
  projectId: plan.projectId, planSha256: createHash('sha256').update(JSON.stringify(plan)).digest('hex'), nonce: '0'.repeat(20) + '123456abcdef', startedAt: 1000, deadline: 2701000, cleanupDeadline: 3061000,
  password: 'synthetic-private-password-only', workdir: '/private/tmp/pika-assignment-list-123456abcdef', appDir: '/private/tmp/pika-assignment-list-123456abcdef/app', outputDir: '/private/tmp/private-tests-output', dependencyManifestSha256: 'a'.repeat(64),
  docker: { path: '/usr/local/bin/docker', sha256: 'b'.repeat(64), host: 'unix:///private/tmp/docker.sock', socketIdentity: [1,2,3,4], containerId: 'c'.repeat(64) } })
const pins = { git: { path: '/pinned/git', sha256: 'a'.repeat(64) }, docker: { path: '/pinned/docker', sha256: 'b'.repeat(64) }, supabase: { path: '/pinned/supabase', sha256: 'c'.repeat(64) }, dockerHost: 'unix:///private/tmp/pinned.sock', socketIdentity: [1,2,3,4] as const, outputDir: '/private/tmp/private-tests-output' }
function child() { return Object.assign(new EventEmitter(), { stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), pid: 501 }) }

describe('import-safe contextual Test launch contracts (CPU only)', () => {
  it('validates both demo roles and exact isolated origins without deriving keys', () => {
    expect(validateContextualTestDemoStatus(status(), plan.projectId)).toMatchObject(status())
    for (const patch of [{ API_URL: 'http://127.0.0.1:54321' }, { ANON_KEY: jwt('service_role') }, { SERVICE_ROLE_KEY: jwt('anon') }, { DB_URL: 'postgresql://postgres:demo@127.0.0.1:54322/postgres' }]) {
      expect(() => validateContextualTestDemoStatus({ ...status(), ...patch }, plan.projectId)).toThrow()
    }
  })
  it('builds a fresh allowlisted app env without inheriting provider, loader or proxy variables', () => {
    const app = contextualTestAppEnvironment(binding() as never, status(), 's'.repeat(64), '/runner/scripts/contextual-test-rehearsal-egress.cjs', '/private/tmp/private-tests-output/run-binding.json', 'd'.repeat(64))
    expect(app.NODE_OPTIONS).toBe('--require=/runner/scripts/contextual-test-rehearsal-egress.cjs')
    expect(app.NEXT_DISABLE_MEM_OVERRIDE).toBe('1'); expect(app.NODE_ENV).toBe('development')
    expect(app.PIKA_CLASSROOM_EXPERIENCE_ADMISSION).toBe(JSON.stringify(plan.admission))
    expect(app.PIKA_CLASSROOM_PAGE_ACCESS_PAIRS).toBe(JSON.stringify(plan.pageAccessPairs))
    expect(app.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY).toBe(status().ANON_KEY)
    for (const key of ['NODE_EXTRA_CA_CERTS','HTTP_PROXY','HTTPS_PROXY','OPENAI_API_KEY','WORKOS_API_KEY','BREVO_API_KEY','STRIPE_SECRET_KEY']) expect(app).not.toHaveProperty(key)
    for (const gate of ['PIKA_CLASSROOM_HOME_ACCESS_ENABLED','PIKA_E2E_FIXTURES','WORKOS_MAGIC_AUTH_PILOT','PAL_ENABLED','PIKA_BARA_ATTENDANCE_ENABLED','STUDENT_PROVIDER_CLEANUP_ENABLED']) expect(app[gate]).toBe('false')
    expect(Object.isFrozen(app)).toBe(true)
  })
  it('keeps the Playwright child env separate from the app preload and app credentials', () => {
    const env = contextualTestRunnerEnvironment(binding() as never, '/private/tmp/private-tests-output/run-binding.json', 'd'.repeat(64))
    expect(env.PIKA_CONTEXTUAL_TEST_REHEARSAL).toBe('true')
    expect(env.PIKA_CONTEXTUAL_TEST_BINDING_FILE).toBe('/private/tmp/private-tests-output/run-binding.json')
    for (const key of ['NODE_OPTIONS','NODE_EXTRA_CA_CERTS','SUPABASE_SECRET_KEY','SESSION_SECRET','NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY']) expect(env).not.toHaveProperty(key)
  })
  it('selects only fixed Next dev and the dedicated existing Playwright CLI/spec', () => {
    const commands = contextualTestLaunchCommands('/runner', '/deps', binding() as never)
    expect(commands.app).toEqual(['/deps/next/dist/bin/next','dev','--hostname','127.0.0.1','--port','3117'])
    expect(commands.runner).toEqual(['/deps/@playwright/test/cli.js','test','--config=/runner/playwright.contextual-tests.config.ts','contextual-test-lifecycle.spec.ts'])
    expect(commands).not.toHaveProperty('shell')
  })
  it('rejects preload whitespace, binding relocation and invalid secrets before creating an environment', () => {
    for (const [secret, preload, file, hash] of [ ['short','/runner/preload.cjs','/private/tmp/private-tests-output/run-binding.json','d'.repeat(64)], ['s'.repeat(64),'/runner/bad preload.cjs','/private/tmp/private-tests-output/run-binding.json','d'.repeat(64)], ['s'.repeat(64),'/runner/preload.cjs','/elsewhere/binding.json','d'.repeat(64)], ['s'.repeat(64),'/runner/preload.cjs','/private/tmp/private-tests-output/run-binding.json','bad'] ]) {
      expect(() => contextualTestAppEnvironment(binding() as never, status(), secret, preload, file, hash)).toThrow()
    }
  })
  it('dispatches pinned absolute binaries/endpoint and waits for positive child close', async () => {
    const instance = child(); let verified = 0, settled = 0, launched = 0
    const transport = createContextualTestPinnedCommand(pins, { startedAt: 0, deadline: 1000, cleanupDeadline: 2000 }, {
      now: () => 1, verify() { verified++ }, async settle() { settled++ }, spawn(file, args, options) {
        launched++; expect(file).toBe('/pinned/docker'); expect(args).toEqual(['--host', pins.dockerHost, 'version'])
        expect(options?.env).toMatchObject({ DOCKER_HOST: pins.dockerHost, PATH: '/usr/bin:/bin' }); expect(options?.shell).toBe(false)
        return instance as never
      },
    })
    let done = false; const result = transport.run('docker', ['version']).then(value => { done = true; return value })
    instance.stdout.write('bounded output\n'); instance.emit('exit', 0, null)
    await Promise.resolve(); expect(done).toBe(false); expect(transport.state().pending).toBe(1)
    instance.emit('close', 0, null); await expect(result).resolves.toBe('bounded output')
    expect(verified).toBe(2); expect(launched).toBe(1); expect(settled).toBe(0); transport.assertClosed()
  })
  it('an error event never grants closure and a failed command cannot resume ordinary work', async () => {
    const instance = child(); let settlements = 0
    const transport = createContextualTestPinnedCommand(pins, { startedAt: 0, deadline: 1000, cleanupDeadline: 2000 }, { now: () => 1, verify() {}, async settle() { settlements++ }, spawn: () => instance as never })
    const result = transport.run('git', ['status']); const rejected = expect(result).rejects.toThrow('Private pinned command failed')
    instance.emit('error', new Error('private raw output')); await Promise.resolve(); await Promise.resolve()
    expect(transport.state().pending).toBe(1); expect(settlements).toBe(1)
    instance.emit('close', 1, null); await rejected
    await expect(transport.run('git', ['status'])).rejects.toThrow('admission closed')
    transport.beginCleanup(); expect(transport.state().cleaning).toBe(true); transport.assertClosed()
  })
  it('a timed-out unjoined child poisons cleanup without accepting a settlement callback', async () => {
    vi.useFakeTimers(); vi.setSystemTime(0)
    try {
      const instance = child(); let settlements = 0
      const transport = createContextualTestPinnedCommand(pins, { startedAt: 0, deadline: 100, cleanupDeadline: 200 }, { verify() {}, async settle() { settlements++ }, spawn: () => instance as never })
      const result = transport.run('git', ['status'], { timeout: 20 }); const rejected = expect(result).rejects.toThrow('closure unconfirmed')
      await vi.advanceTimersByTimeAsync(20); expect(settlements).toBe(1); expect(transport.state().pending).toBe(1)
      await vi.advanceTimersByTimeAsync(180); await rejected
      expect(transport.state().poisoned).toBe(true); expect(() => transport.beginCleanup()).toThrow(); expect(() => transport.assertClosed()).toThrow()
      instance.emit('close', 0, null)
    } finally { vi.useRealTimers() }
  })
  it('rejects implicit binaries, endpoint overrides, inherited env and invalid operation windows before spawn', async () => {
    let spawns = 0
    const transport = createContextualTestPinnedCommand(pins, { startedAt: 0, deadline: 100, cleanupDeadline: 200 }, { now: () => 1, verify() {}, async settle() {}, spawn() { spawns++; return child() as never } })
    for (const [file, args, options] of [['curl', [], {}], ['docker', ['--host=unix:///other'], {}], ['git', [], { env: { OPENAI_API_KEY: 'synthetic' } }], ['git', [], { timeout: -1 }]] as const) {
      await expect(transport.run(file, [...args], options as never)).rejects.toThrow()
    }
    expect(spawns).toBe(0)
  })
  it('clamps reused canonical60000ms requests to original30000ms normal deadline and12000ms settlement', async () => {
    vi.useFakeTimers(); vi.setSystemTime(0)
    try {
      const instance = child(); const settlementEnds: number[] = []
      const transport = createContextualTestPinnedCommand(pins, { startedAt: 0, deadline: 90000, cleanupDeadline: 120000 }, { verify() {}, async settle(_child, end) { settlementEnds.push(end) }, spawn: () => instance as never })
      const result = transport.run('docker', ['exec','synthetic-readonly'], { timeout: 60000 })
      const rejected = expect(result).rejects.toThrow('closure unconfirmed')
      await vi.advanceTimersByTimeAsync(29999); expect(settlementEnds).toEqual([])
      await vi.advanceTimersByTimeAsync(1); expect(settlementEnds).toEqual([42000])
      await vi.advanceTimersByTimeAsync(12000); await rejected
      expect(transport.state().poisoned).toBe(true); instance.emit('close', 0, null)
    } finally { vi.useRealTimers() }
  })
  it('excludes dotenv/build/auth/dependency state and rejects traversal/symlink modes', () => {
    for (const name of ['.env', '.env.local', 'a/.env.production', '.environment', '.auth/student.json', '.next/cache/file', 'node_modules/a/index.js', '.git/config']) expect(contextualTestSnapshotPath(name)).toBe(false)
    for (const name of ['src/app/page.tsx', 'package.json', 'supabase/migrations/001_initial.sql']) expect(contextualTestSnapshotPath(name)).toBe(true)
    for (const name of ['/absolute', '../escape', 'a/../escape', 'a\0b']) expect(() => contextualTestSnapshotPath(name)).toThrow()
  })
  it('protects every physical dependency root in the inherited sandbox without claiming network containment', () => {
    const profile = contextualTestReadOnlyDependencyProfile(['/deps/node_modules','/store/pnpm'])
    expect(profile).toContain('(deny file-write* (subpath "/deps/node_modules") (subpath "/store/pnpm"))')
    expect(profile).not.toContain('network-outbound')
    expect(() => contextualTestReadOnlyDependencyProfile(['/'])).toThrow()
    expect(() => contextualTestReadOnlyDependencyProfile([])).toThrow()
  })
  it('reuses exact family reconciliation, rejecting argv/cwd and kernel identity mismatches', () => {
    const row = { pid: 501, ppid: 1, pgid: 501, started: '123:4', executable: '/pinned/node', state: 'alive' as const }
    const input = { pid: 501, pgid: 501, executable: '/pinned/node', cwd: '/owned/app', argv: ['/pinned/node','next'], expectedArgv: ['/pinned/node','next'], expectedCwd: '/owned/app', role: 'app' as const, rows: [row] }
    const family = createContextualTestOwnedFamily(input)
    expect(family.snapshot().identity.started).toBe('123:4'); expect(family.absent([])).toBe(true)
    expect(() => createContextualTestOwnedFamily({ ...input, cwd: '/foreign' })).toThrow()
    expect(() => createContextualTestOwnedFamily({ ...input, argv: ['/pinned/node','foreign'] })).toThrow()
    expect(() => family.refresh([{ ...row, started: '999:1' }])).toThrow()
  })
})
