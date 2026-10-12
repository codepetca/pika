/** Actual factory/child-dispatch seams, entirely offline. No socket or command. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const seam = vi.hoisted(() => ({ host: 'unix:///offline-survey.sock', ino: 2, context: 'unix:///offline-survey.sock',
  fail: false, replaceAfter: false, retargetAfter: false,
  calls: [] as Array<{ file: string; args: string[]; options: Record<string, unknown> }> }))
vi.mock('node:fs', async original => {
  const actual = await original<typeof import('node:fs')>()
  return { ...actual, realpathSync: ((path: string) => path === '/offline-survey.sock' ? path : actual.realpathSync(path)) as typeof actual.realpathSync,
    statSync: ((path: string) => path === '/offline-survey.sock'
      ? { dev: 1, ino: seam.ino, mode: 3, rdev: 4, isSocket: () => true } : actual.statSync(path)) as typeof actual.statSync }
})
vi.mock('node:child_process', async original => {
  const actual = await original<typeof import('node:child_process')>()
  return { ...actual, execFile: vi.fn((file: string, args: string[], options: Record<string, unknown>, callback: (error: Error | null, stdout: string, stderr: string) => void) => {
    seam.calls.push({ file, args: [...args], options })
    queueMicrotask(() => {
      if (file === 'docker' && args[0] === 'context') {
        callback(null, JSON.stringify({ endpoints: { docker: { Host: seam.context } }, tlsMaterial: null }), '')
        return
      }
      if (seam.replaceAfter) seam.ino = 99
      if (seam.retargetAfter) seam.context = 'unix:///different.sock'
      callback(seam.fail ? new Error('Offline command failure') : null, file === 'supabase' ? '{"offline":true}' : '', '')
    })
    return { stdin: { on: vi.fn(), end: vi.fn() }, kill: vi.fn() }
  }) }
})
vi.mock('node:net', async original => {
  const actual = await original<typeof import('node:net')>()
  return { ...actual, createServer: vi.fn(() => {
    const server = { once: vi.fn(() => server), listen: vi.fn((_port: number, _host: string, callback: () => void) => {
      queueMicrotask(callback); return server
    }), close: vi.fn((callback: () => void) => { queueMicrotask(callback); return server }) }
    return server
  }) }
})
import { createAssignmentListNativeAdapters, requireSurvey263AdapterEndpoint } from '../../scripts/contextual-assignment-list-proof-platform'
import { newAssignmentListProofFixture } from '../../scripts/contextual-assignment-list-proof-fixture'
import { assignmentListProofWorkdir } from '../../scripts/contextual-assignment-list-proof-path'
const fixture = newAssignmentListProofFixture(new Date('2026-10-12T12:00:00Z'))
const project = `pika_assignment_list_${fixture.manifest.syntheticTag.slice(-12)}`
const workdir = assignmentListProofWorkdir(project)
const endpoint = () => ({ kind: 'survey263' as const, host: seam.host, identity: [1, 2, 3, 4] as const })
const make = () => createAssignmentListNativeAdapters(fixture, { survey263Endpoint: endpoint(), ephemeralSnapshot: 'metadata' })
beforeEach(() => {
  seam.context = seam.host; seam.ino = 2; seam.fail = false; seam.replaceAfter = false; seam.retargetAfter = false; seam.calls.length = 0
  for (const name of Object.keys(process.env)) if (/^(?:DOCKER_(?:HOST|CONTEXT|CONFIG|API_VERSION|TLS.*|CERT_PATH|CUSTOM_HEADERS)|(?:.*_)?PROXY)$/i.test(name)) vi.stubEnv(name, undefined)
})
afterEach(() => { vi.unstubAllEnvs() })

describe('sealed Survey platform factory (offline actual seams)', () => {
  it('brands only the actual socket-bound factory result, not a legacy or copied adapter', () => {
    const adapters = make()
    expect(requireSurvey263AdapterEndpoint(adapters)).toEqual(endpoint())
    expect(() => requireSurvey263AdapterEndpoint({ ...adapters })).toThrow()
    expect(() => requireSurvey263AdapterEndpoint(createAssignmentListNativeAdapters(fixture))).toThrow()
    expect(seam.calls).toHaveLength(0)
  })
  it.each(['DOCKER_HOST', 'DOCKER_CONTEXT', 'DOCKER_CUSTOM_HEADERS', 'HTTPS_PROXY'])('rejects caller override %s before child dispatch', name => {
    vi.stubEnv(name, 'offline-override')
    expect(() => make()).toThrow(); expect(seam.calls).toHaveLength(0)
  })
  it('rejects remote or extra executable bindings and changed socket epochs before dispatch', () => {
    expect(() => createAssignmentListNativeAdapters(fixture, { survey263Endpoint: { ...endpoint(), host: 'tcp://remote:2375' } })).toThrow()
    expect(() => createAssignmentListNativeAdapters(fixture, { survey263Endpoint: { ...endpoint(), run: () => {} } as never })).toThrow()
    seam.ino = 99; expect(() => make()).toThrow(); expect(seam.calls).toHaveLength(0)
  })
  it('pins Supabase start/status/stop children without changing the parent environment', async () => {
    const adapters = make()
    for (const args of [['start', '--workdir', workdir], ['status', '--workdir', workdir, '-o', 'json'], ['stop', '--project-id', project, '--no-backup']]) {
      await adapters.command({ args, workdir, timeoutMs: 1000 })
    }
    const children = seam.calls.filter(call => call.file === 'supabase')
    expect(children).toHaveLength(3)
    for (const child of children) expect(child.options.env).toMatchObject({ DOCKER_HOST: seam.host })
    expect(process.env.DOCKER_HOST).toBeUndefined()
    expect(seam.calls.filter(call => call.args[0] === 'context')).toHaveLength(6)
  })
  it('pins every global Docker discovery child to the accepted host', async () => {
    await make().inventory({ projectId: project, workdir, apiUrl: 'http://127.0.0.1:54331', dbPort: 54332 })
    const dispatched = seam.calls.filter(call => call.file === 'docker' && call.args[0] !== 'context')
    expect(dispatched.length).toBeGreaterThan(0)
    for (const child of dispatched) expect(child.args.slice(0, 2)).toEqual(['--host', seam.host])
  })
  it('rejects a changed default context before a Supabase operation', async () => {
    const adapters = make(); seam.context = 'unix:///different.sock'
    await expect(adapters.command({ args: ['status', '--workdir', workdir, '-o', 'json'], workdir, timeoutMs: 1000 })).rejects.toThrow()
    expect(seam.calls.some(call => call.file === 'supabase')).toBe(false)
  })
  it.each(['failure', 'socket', 'context'])('never accepts a %s after dispatch and still checks settlement', async fault => {
    const adapters = make(); seam.fail = fault === 'failure'; seam.replaceAfter = fault === 'socket'; seam.retargetAfter = fault === 'context'
    await expect(adapters.command({ args: ['status', '--workdir', workdir, '-o', 'json'], workdir, timeoutMs: 1000 })).rejects.toThrow()
    expect(seam.calls.filter(call => call.file === 'supabase')).toHaveLength(1)
    expect((seam.calls.find(call => call.file === 'supabase')!.options.env as NodeJS.ProcessEnv).DOCKER_HOST).toBe(seam.host)
  })
})
