import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { execFile } from 'node:child_process'
import { EventEmitter } from 'node:events'
import type { request } from 'node:http'
import { closeSync, constants, fstatSync, openSync, readSync, type statSync } from 'node:fs'
import * as platform from '../../scripts/contextual-assignment-list-proof-platform'
import { testOwnerListDockerInventory } from '../../scripts/contextual-test-owner-list-proof-inventory'

vi.mock('node:child_process', async importOriginal => ({ ...await importOriginal<typeof import('node:child_process')>(), execFile: vi.fn() }))
vi.mock('node:fs', async importOriginal => ({ ...await importOriginal<typeof import('node:fs')>(), openSync: vi.fn(), fstatSync: vi.fn(), readSync: vi.fn(), closeSync: vi.fn() }))

const id = (n: number) => n.toString(16).padStart(64, '0')
const template = '{"id":{{json .Id}},"name":{{json .Name}},"labels":{{json .Config.Labels}},"mounts":{{json .Mounts}},"networks":{{json .NetworkSettings.Networks}},"bindings":{{json .HostConfig.PortBindings}},"created":{{json .Created}}}'
const listArgs = [['ps', '-aq', '--no-trunc'], ['volume', 'ls', '-q'], ['network', 'ls', '-q', '--no-trunc']]
const key = (args: string[]) => JSON.stringify(args)
type Run = (file: string, args: string[]) => Promise<string>

function globalFixture(size = 129, revision = 'synthetic-one', sizes = { containers: size, volumes: size, networks: size }) {
  const own = { 'com.supabase.cli.project': 'pika_assignment_list_abcdef123456', 'com.docker.compose.project': 'pika_assignment_list_abcdef123456' }
  const foreign = { 'com.supabase.cli.project': 'foreign' }
  const containers = Array.from({ length: sizes.containers }, (_, n) => ({ id: id(n + 1), name: `/synthetic_${n}`, labels: n ? foreign : own,
    mounts: [{ Type: 'volume', Name: `synthetic_volume_${n}` }, ...(n === 1 ? [{ Type: 'volume', Name: 'synthetic_volume_0' }] : [])],
    networks: { synthetic: { NetworkID: id(10000 + n) }, ...(n === 1 ? { shared: { NetworkID: id(10000) } } : {}) },
    bindings: { '5432/tcp': [{ HostPort: String(n ? 20000 + n : 54332) }] }, created: revision }))
  const volumes = Array.from({ length: sizes.volumes }, (_, n) => ({ Name: `synthetic_volume_${n}`, CreatedAt: revision, Labels: n ? foreign : own }))
  const networks = Array.from({ length: sizes.networks }, (_, n) => ({ Id: id(10000 + n), Name: `synthetic_network_${n}`, Created: revision, Labels: n ? foreign : own,
    Containers: Object.fromEntries([id(n + 1), ...(n === 0 ? [id(2)] : [])].map(value => [value, {}])) }))
  const outputs = new Map<string, string>([
    [key(listArgs[0]), containers.map(c => c.id).join('\n')], [key(listArgs[1]), volumes.map(v => v.Name).join('\n')], [key(listArgs[2]), networks.map(n => n.Id).join('\n')],
  ])
  for (let start = 0; start < Math.max(sizes.containers, sizes.volumes, sizes.networks); start += 128) {
    const c = containers.slice(start, start + 128); const v = volumes.slice(start, start + 128); const n = networks.slice(start, start + 128)
    if (c.length) outputs.set(key(['inspect', '--format', template, ...c.map(row => row.id)]), c.map(row => JSON.stringify(row)).join('\n'))
    if (v.length) outputs.set(key(['volume', 'inspect', ...v.map(row => row.Name)]), JSON.stringify(v))
    if (n.length) outputs.set(key(['network', 'inspect', ...n.map(row => row.Id)]), JSON.stringify(n))
  }
  const calls: string[] = []
  const run: Run = async (file, args) => {
    expect(file).toBe('docker'); calls.push(key(args))
    const output = outputs.get(key(args)); if (output === undefined) throw new Error('PRIVATE nonallowlisted command')
    return output
  }
  return { outputs, calls, run, containers, volumes, networks }
}

beforeEach(() => {
  vi.mocked(execFile).mockImplementation((_file, _args, _options, callback) => {
    queueMicrotask(() => (callback as unknown as (error: Error, stdout: string) => void)(new Error('Offline unconfigured command'), ''))
    return {} as ReturnType<typeof execFile>
  })
})
afterEach(() => {
  vi.useRealTimers(); vi.restoreAllMocks()
  for (const mock of [execFile, openSync, fstatSync, readSync, closeSync]) vi.mocked(mock).mockReset()
})

const contextTemplate = '{"endpoints":{{json .Endpoints}},"tlsMaterial":{{json .TLSMaterial}}}'
const endpoint = 'unix:///canonical/docker.sock'
const contextArgs = ['context', 'inspect', '--format', contextTemplate]
function nativeFixture(size = 129, sizes = { containers: size, volumes: size, networks: size }) {
  const fixture = globalFixture(size, 'synthetic-one', sizes)
  const run = vi.fn<Run>(async (file, args) => {
    if (key(args) === key(contextArgs)) return JSON.stringify({ endpoints: { docker: { Host: 'unix:///alias/docker.sock', SkipTLSVerify: false } }, tlsMaterial: {} })
    expect(args.slice(0, 2)).toEqual(['--host', endpoint])
    expect(args.slice(2, 4)).not.toEqual(['volume', 'inspect'])
    return fixture.run(file, args.slice(2))
  })
  const realpath = vi.fn(() => '/canonical/docker.sock')
  const stat = vi.fn(() => ({ dev: 1, ino: 2, mode: 0o140600, rdev: 0, isSocket: () => true }) as ReturnType<typeof statSync>)
  const sockets: Array<EventEmitter & { destroy: ReturnType<typeof vi.fn> }> = []
  const requests: Array<EventEmitter & { destroy: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn> }> = []
  const responses: Array<EventEmitter & { destroy: ReturnType<typeof vi.fn>; statusCode: number; headers: Record<string, string>; complete: boolean }> = []
  let body = JSON.stringify({ Volumes: fixture.volumes, Warnings: null })
  let respond = true
  const requestMock = vi.fn((options, callback) => {
    expect(options).toEqual({ socketPath: '/canonical/docker.sock', path: '/v1.45/volumes', method: 'GET', agent: false,
      headers: { Accept: 'application/json', 'Accept-Encoding': 'identity', Connection: 'close' } })
    const socket = Object.assign(new EventEmitter(), { destroy: vi.fn(() => queueMicrotask(() => socket.emit('close'))) })
    const response = Object.assign(new EventEmitter(), { statusCode: 200, headers: { 'content-type': 'application/json' }, complete: true,
      destroy: vi.fn(() => queueMicrotask(() => response.emit('close'))) })
    const req = Object.assign(new EventEmitter(), { destroy: vi.fn(() => queueMicrotask(() => req.emit('close'))),
      end: vi.fn(() => queueMicrotask(() => {
        req.emit('socket', socket)
        if (!respond) return
        callback(response)
        response.emit('data', Buffer.from(body)); response.emit('end')
      })) })
    sockets.push(socket); requests.push(req); responses.push(response)
    return req
  }) as unknown as typeof request
  const readConfig = vi.fn<() => string | undefined>(() => undefined)
  const transport = { env: {} as NodeJS.ProcessEnv, run, realpath, stat, request: requestMock, readConfig }
  return { ...fixture, transport, sockets, requests, responses, requestMock,
    setBody: (value: unknown) => { body = JSON.stringify(value) }, setRaw: (value: string) => { body = value }, stall: () => { respond = false } }
}

describe('Test owner list bulk native transport (offline)', () => {
  it('uses bounded native execFile for context and every bound inventory command', async () => {
    const f = nativeFixture(1)
    vi.mocked(execFile).mockImplementation((file, args, options, callback) => {
      expect(options).toEqual({ timeout: 20000, maxBuffer: 64 * 1024 * 1024, encoding: 'utf8', env: {} })
      const finish = callback as unknown as (error: Error | null, stdout: string) => void
      f.transport.run(file, args as string[]).then(stdout => finish(null, stdout), error => finish(error, ''))
      return {} as ReturnType<typeof execFile>
    })
    const { run: _run, ...seams } = f.transport
    expect(await testOwnerListDockerInventory(undefined, seams)).toEqual(await platform.assignmentListDockerInventory(globalFixture(1).run))
    expect(execFile).toHaveBeenCalledTimes(6); expect(f.requestMock).toHaveBeenCalledOnce()
  })

  it.each(['normal', 'missing', 'read-fail', 'stat-fail', 'non-file', 'oversize', 'short', 'growth', 'open-fail'])('bounds native config file reads and descriptor cleanup: %s', async kind => {
    const f = nativeFixture(0); const config = Buffer.from('{}'); let position = 0
    vi.mocked(openSync).mockImplementation((path, flags) => {
      expect(path).toBe('/offline/.docker/config.json'); expect(flags).toBe(constants.O_RDONLY | constants.O_NONBLOCK)
      if (kind === 'missing' || kind === 'open-fail') throw Object.assign(new Error('PRIVATE'), { code: kind === 'missing' ? 'ENOENT' : 'EACCES' })
      return 7
    })
    vi.mocked(fstatSync).mockImplementation(() => {
      if (kind === 'stat-fail') throw new Error('PRIVATE')
      return { size: kind === 'oversize' ? 64 * 1024 * 1024 + 1 : kind === 'short' ? 3 : kind === 'growth' ? 1 : 2,
        isFile: () => kind !== 'non-file' } as ReturnType<typeof fstatSync>
    })
    vi.mocked(readSync).mockImplementation((_fd, buffer, offset, length) => {
      if (kind === 'read-fail') throw new Error('PRIVATE')
      const copied = config.copy(buffer as Buffer, offset, position, position + length); position += copied; return copied
    })
    const { readConfig: _readConfig, ...seams } = f.transport
    const pending = testOwnerListDockerInventory(undefined, { ...seams, env: { HOME: '/offline' } })
    if (kind === 'normal' || kind === 'missing') expect(await pending).toEqual([])
    else { await expect(pending).rejects.toThrow('Private Test owner list inventory rejected'); expect(f.transport.run).not.toHaveBeenCalled() }
    expect(closeSync).toHaveBeenCalledTimes(kind === 'missing' || kind === 'open-fail' ? 0 : 1)
    if (kind === 'oversize' || kind === 'non-file' || kind === 'stat-fail') expect(readSync).not.toHaveBeenCalled()
  })

  it('replays exact logical batches from one unfiltered bulk read with every CLI bound to the canonical socket', async () => {
    const f = nativeFixture(257)
    expect(await testOwnerListDockerInventory(undefined, f.transport)).toEqual(await platform.assignmentListDockerInventory(globalFixture(257).run))
    expect(f.requestMock).toHaveBeenCalledOnce(); expect(f.transport.run.mock.calls[0][1]).toEqual(contextArgs)
    expect(f.calls.filter(c => JSON.parse(c)[0] === 'volume')).toEqual([key(listArgs[1])])
    expect(f.sockets.every(s => s.destroy.mock.calls.length === 1)).toBe(true)
    expect(f.requests.every(r => r.destroy.mock.calls.length === 1)).toBe(true)
    expect(f.transport.stat).toHaveBeenCalledTimes(2)
  })

  it.each(['DOCKER_HOST', 'docker_context', 'Docker_Config', 'DOCKER_API_VERSION', 'DOCKER_TLS_VERIFY', 'DOCKER_CERT_PATH', 'DOCKER_CUSTOM_HEADERS', 'HTTP_PROXY', 'https_proxy', 'ALL_PROXY', 'No_Proxy'])('rejects %s overrides before any command or request', async name => {
    const f = nativeFixture(0); f.transport.env = { [name]: '' }
    await expect(testOwnerListDockerInventory(undefined, f.transport)).rejects.toThrow('Private Test owner list inventory rejected')
    expect(f.transport.run).not.toHaveBeenCalled(); expect(f.requestMock).not.toHaveBeenCalled()
  })

  it.each(['PRIVATE invalid', '{"HttpHeaders":{"X-Private":"PRIVATE"}}', '{"HttpHeaders":null}', '{"HttpHeaders":[]}', '{"HttpHeaders":"PRIVATE"}', '[]', 'x'.repeat(64 * 1024 * 1024 + 1)])('rejects malformed, oversized or routing-header config %# before CLI', async config => {
    const f = nativeFixture(0); f.transport.readConfig.mockReturnValue(config)
    await expect(testOwnerListDockerInventory(undefined, f.transport)).rejects.toThrow('Private Test owner list inventory rejected')
    expect(f.transport.run).not.toHaveBeenCalled(); expect(f.requestMock).not.toHaveBeenCalled()
  })

  it.each(['{}', '{"HttpHeaders":{},"auths":{"private":{"auth":"PRIVATE"}}}'])('accepts config with no custom headers %# without replaying credentials', async config => {
    const f = nativeFixture(0); f.transport.readConfig.mockReturnValue(config)
    expect(await testOwnerListDockerInventory(undefined, f.transport)).toEqual([])
    expect(JSON.stringify(f.transport.run.mock.calls)).not.toContain('PRIVATE')
  })

  it.each(['tcp://127.0.0.1:2375', 'unix://private@/docker.sock', 'unix:///docker.sock?private', 'unix:///docker.sock#private', 'unix://relative.sock', 'unix:///docker%2Esock', 'unix:///a/../docker.sock', 'unix:///docker.sock\n', 'unix:////docker.sock'])('rejects unsafe context endpoint %s before discovery', async host => {
    const f = nativeFixture(0)
    f.transport.run.mockResolvedValue(JSON.stringify({ endpoints: { docker: { Host: host, SkipTLSVerify: false } }, tlsMaterial: {} }))
    await expect(testOwnerListDockerInventory(undefined, f.transport)).rejects.toThrow('Private Test owner list inventory rejected')
    expect(f.transport.run).toHaveBeenCalledOnce(); expect(f.requestMock).not.toHaveBeenCalled()
  })

  it.each([{ endpoints: {}, tlsMaterial: {} }, { endpoints: { docker: { Host: endpoint, SkipTLSVerify: true } }, tlsMaterial: {} },
    { endpoints: { docker: { Host: endpoint }, other: { Host: endpoint } }, tlsMaterial: {} },
    { endpoints: { docker: { Host: endpoint } }, tlsMaterial: { docker: ['private.pem'] } }])('rejects incomplete, multiple or TLS contexts %#', async context => {
    const f = nativeFixture(0); f.transport.run.mockResolvedValue(JSON.stringify(context))
    await expect(testOwnerListDockerInventory(undefined, f.transport)).rejects.toThrow('Private Test owner list inventory rejected')
    expect(f.requestMock).not.toHaveBeenCalled()
  })

  it('rejects non-sockets and identity drift before accepting results', async () => {
    const f = nativeFixture(0); f.transport.stat.mockReturnValue({ isSocket: () => false } as ReturnType<typeof statSync>)
    await expect(testOwnerListDockerInventory(undefined, f.transport)).rejects.toThrow('Private Test owner list inventory rejected')
    expect(f.requestMock).not.toHaveBeenCalled()
    const drift = nativeFixture(0)
    drift.transport.stat.mockReturnValueOnce({ dev: 1, ino: 2, mode: 0o140600, rdev: 0, isSocket: () => true } as ReturnType<typeof statSync>)
      .mockReturnValue({ dev: 1, ino: 3, mode: 0o140600, rdev: 0, isSocket: () => true } as ReturnType<typeof statSync>)
    await expect(testOwnerListDockerInventory(undefined, drift.transport)).rejects.toThrow('Private Test owner list inventory rejected')
    expect(drift.sockets[0].destroy).toHaveBeenCalledOnce()
  })

  it.each([{ Warnings: null }, { Volumes: null, Warnings: null }, { Volumes: [], Warnings: ['PRIVATE'] },
    { Volumes: [], Warnings: 'PRIVATE' }, { Volumes: [], Warnings: null },
    { Volumes: [{ Name: 'unexpected', CreatedAt: 'raw', Labels: null }], Warnings: null }])('rejects bulk shape or list disagreement %#', async body => {
    const f = nativeFixture(1); f.setBody(body)
    await expect(testOwnerListDockerInventory(undefined, f.transport)).rejects.toThrow('Private Test owner list inventory rejected')
    expect(f.sockets[0].destroy).toHaveBeenCalledOnce()
  })

  it.each([{ Name: 'synthetic_volume_0', Labels: null }, { Name: 'synthetic_volume_0', CreatedAt: '', Labels: null },
    { Name: 'synthetic_volume_0', CreatedAt: 'raw', Labels: { private: 1 } }, { Name: '--unsafe', CreatedAt: 'raw', Labels: null },
    { Name: 'synthetic_volume_0', CreatedAt: 'raw' }])('rejects malformed metadata %#', async row => {
    const f = nativeFixture(1); f.setBody({ Volumes: [row], Warnings: null })
    await expect(testOwnerListDockerInventory(undefined, f.transport)).rejects.toThrow('Private Test owner list inventory rejected')
  })

  it('rejects duplicate metadata, preserves raw CreatedAt and null labels, and accepts null Volumes only for an empty list', async () => {
    const duplicate = nativeFixture(1); duplicate.setBody({ Volumes: [duplicate.volumes[0], duplicate.volumes[0]], Warnings: [] })
    await expect(testOwnerListDockerInventory(undefined, duplicate.transport)).rejects.toThrow('Private Test owner list inventory rejected')
    const f = nativeFixture(1); f.volumes[0].CreatedAt = '  RAW+timezone  '; f.volumes[0].Labels = null as unknown as typeof f.volumes[0]['Labels']
    f.setBody({ Volumes: f.volumes, Warnings: [] })
    const actual = await testOwnerListDockerInventory(undefined, f.transport)
    expect(actual.find(r => r.kind === 'volume')).toMatchObject({ createdAt: '  RAW+timezone  ', labels: {} })
    const empty = nativeFixture(0); empty.setBody({ Volumes: null, Warnings: null })
    expect(await testOwnerListDockerInventory(undefined, empty.transport)).toEqual([])
  })

  it('enforces an absolute 20s request deadline and settles sockets before failure', async () => {
    vi.useFakeTimers(); const f = nativeFixture(0); f.stall()
    let done = false
    const pending = testOwnerListDockerInventory(undefined, f.transport).catch(error => { done = true; expect(String(error)).toBe('Error: Private Test owner list inventory rejected') })
    await vi.advanceTimersByTimeAsync(19999); expect(done).toBe(false)
    await vi.advanceTimersByTimeAsync(1); await pending
    expect(f.sockets[0].destroy).toHaveBeenCalledOnce(); expect(f.requests[0].destroy).toHaveBeenCalledOnce()
  })

  it('shares three total slots with the bulk GET and waits for held CLI work after bulk failure', async () => {
    const f = nativeFixture(257, { containers: 129, volumes: 257, networks: 257 }); f.setRaw('PRIVATE')
    let release!: () => void; const held = new Promise<void>(resolve => { release = resolve })
    const rawRun = f.transport.run.getMockImplementation()!
    let active = 0; let maximum = 0; let finished = 0
    const started: string[] = []
    f.transport.run.mockImplementation(async (file, args) => {
      if (key(args) === key(contextArgs) || args[2] !== 'inspect') return rawRun(file, args)
      started.push(key(args)); maximum = Math.max(maximum, ++active)
      try { await held; return await rawRun(file, args) } finally { active--; finished++ }
    })
    const rawRequest = f.transport.request
    f.transport.request = ((options, callback) => {
      maximum = Math.max(maximum, ++active)
      const req = rawRequest(options, response => {
        f.sockets[0].destroy.mockImplementation(() => {}) // Keep cleanup active after the failure is known.
        callback!(response)
      }); req.once('close', () => { active-- }); return req
    }) as typeof request
    let done = false
    const pending = testOwnerListDockerInventory(undefined, f.transport).catch(error => { done = true; expect(String(error)).toBe('Error: Private Test owner list inventory rejected') })
    await new Promise<void>(resolve => setImmediate(resolve))
    expect(done).toBe(false); expect(started).toHaveLength(2); expect(maximum).toBe(3)
    release(); await new Promise<void>(resolve => setImmediate(resolve))
    expect(done).toBe(false); expect(started).toHaveLength(2)
    expect(f.calls.filter(command => JSON.parse(command)[0] === 'network' && JSON.parse(command)[1] === 'inspect')).toEqual([])
    f.sockets[0].emit('close'); await pending
    expect(started).toHaveLength(2); expect(finished).toBe(2); expect(active).toBe(0)
  })

  it('handles uneven inventories with fresh bulk reads after success and failure', async () => {
    const sizes = { containers: 1, volumes: 641, networks: 1 }
    const f = nativeFixture(1, sizes)
    expect(await testOwnerListDockerInventory(undefined, f.transport)).toEqual(await platform.assignmentListDockerInventory(globalFixture(1, 'synthetic-one', sizes).run))
    f.setRaw('PRIVATE'); await expect(testOwnerListDockerInventory(undefined, f.transport)).rejects.toThrow('Private Test owner list inventory rejected')
    f.volumes.forEach(v => { v.CreatedAt = 'new-raw' }); f.setBody({ Volumes: f.volumes, Warnings: null })
    const actual = await testOwnerListDockerInventory(undefined, f.transport)
    expect(actual.filter(r => r.kind === 'volume').every(r => r.createdAt === 'new-raw')).toBe(true)
    expect(f.requestMock).toHaveBeenCalledTimes(3)
    expect(f.transport.run.mock.calls.filter(([, args]) => key(args) === key(contextArgs))).toHaveLength(3)
  })

  it('bounds the aggregate logical replay map as well as each physical response', async () => {
    const f = nativeFixture(1); const large = 'x'.repeat(33 * 1024 * 1024)
    f.setBody({ Volumes: [{ ...f.volumes[0], Labels: { large } }], Warnings: null })
    f.outputs.set(key(['network', 'inspect', id(10000)]), JSON.stringify([{ ...f.networks[0], Labels: { large } }]))
    await expect(testOwnerListDockerInventory(undefined, f.transport)).rejects.toThrow('Private Test owner list inventory rejected')
    expect(f.sockets[0].destroy).toHaveBeenCalledOnce()
  })

  it.each(['repeat', 'incomplete', 'early-error'])('cleans up the complete native prefetch when parser %s fails', async mode => {
    const f = nativeFixture(1)
    vi.spyOn(platform, 'assignmentListDockerInventory').mockImplementation(async run => {
      await run!('docker', listArgs[0])
      if (mode === 'repeat') await run!('docker', listArgs[0])
      if (mode === 'early-error') throw new Error('PRIVATE')
      return []
    })
    await expect(testOwnerListDockerInventory(undefined, f.transport)).rejects.toThrow('Private Test owner list inventory rejected')
    expect(f.sockets[0].destroy).toHaveBeenCalledOnce(); expect(f.requests[0].destroy).toHaveBeenCalledOnce()
  })

  it.each(['request-error', 'socket-error', 'response-error', 'aborted', 'premature-close', 'constructor', 'end-throw'])('settles transport lifecycle %s without leaking private errors', async kind => {
    const f = nativeFixture(0); f.stall()
    const nativeRequest = f.transport.request
    f.transport.request = ((options, callback) => {
      if (kind === 'constructor') throw new Error('PRIVATE')
      const req = nativeRequest(options, callback)
      if (kind === 'end-throw') req.end = (() => { throw new Error('PRIVATE') }) as typeof req.end
      else queueMicrotask(() => queueMicrotask(() => {
        if (kind === 'request-error') req.emit('error', new Error('PRIVATE'))
        else if (kind === 'socket-error') f.sockets[0].emit('error', new Error('PRIVATE'))
        else { callback!(f.responses[0] as unknown as Parameters<NonNullable<typeof callback>>[0]); f.responses[0].emit(kind === 'response-error' ? 'error' : kind === 'premature-close' ? 'close' : 'aborted', new Error('PRIVATE')) }
      }))
      return req
    }) as typeof request
    await expect(testOwnerListDockerInventory(undefined, f.transport)).rejects.toThrow('Private Test owner list inventory rejected')
    if (kind !== 'constructor') expect(f.requests[0].destroy).toHaveBeenCalledOnce()
    if (kind !== 'constructor' && kind !== 'end-throw') expect(f.sockets[0].destroy).toHaveBeenCalledOnce()
  })

  it.each(['invalid-json', 'oversized', 'status', 'encoding', 'content-type', 'incomplete'])('fails closed and cleans up HTTP %s', async kind => {
    const f = nativeFixture(0)
    if (kind === 'invalid-json') f.setRaw('PRIVATE')
    if (kind === 'oversized') f.setRaw('x'.repeat(64 * 1024 * 1024 + 1))
    const nativeRequest = f.transport.request
    f.transport.request = ((options, callback) => nativeRequest(options, response => {
      if (kind === 'status') response.statusCode = 302
      if (kind === 'encoding') response.headers['content-encoding'] = 'gzip'
      if (kind === 'content-type') response.headers['content-type'] = 'text/plain'
      if (kind === 'incomplete') response.complete = false
      callback!(response)
    })) as typeof request
    await expect(testOwnerListDockerInventory(undefined, f.transport)).rejects.toThrow('Private Test owner list inventory rejected')
    expect(f.requests[0].destroy).toHaveBeenCalledOnce(); expect(f.sockets[0].destroy).toHaveBeenCalledOnce()
  })
})

describe('Test owner list fresh global inventory (offline commands only)', () => {
  it('preserves the sealed complete inventory, including foreign attachments, across 128-sized batches', async () => {
    const original = globalFixture(); const expected = await platform.assignmentListDockerInventory(original.run)
    const optimized = globalFixture(); const actual = await testOwnerListDockerInventory(optimized.run)
    expect(actual).toEqual(expected); expect(actual).toHaveLength(387)
    expect(actual.find(r => r.kind === 'volume' && r.name === 'synthetic_volume_0')?.attachedIds).toEqual([id(1), id(2)])
    expect(actual.find(r => r.kind === 'network' && r.id === id(10000))?.attachedIds).toEqual([id(1), id(2)])
    expect([...optimized.calls].sort()).toEqual([...original.calls].sort()); expect(new Set(optimized.calls).size).toBe(9)
    expect(optimized.calls.every(command => optimized.outputs.has(command))).toBe(true)
  })

  it('uses exactly three global inspection workers, allowing independent batches of the same kind to overlap', async () => {
    const fixture = globalFixture(257); let active = 0; let maximum = 0
    const activeKinds = new Map<string, number>(); const seen = new Set<string>(); let sameKindMaximum = 0
    const run: Run = async (file, args) => {
      const kind = args[0] === 'volume' ? 'volume' : args[0] === 'network' ? 'network' : 'container'
      const inspecting = args[0] === 'inspect' || args[1] === 'inspect'
      if (inspecting) {
        const ownList = listArgs[kind === 'container' ? 0 : kind === 'volume' ? 1 : 2]
        expect(fixture.calls.includes(key(ownList))).toBe(true)
        activeKinds.set(kind, (activeKinds.get(kind) ?? 0) + 1)
        sameKindMaximum = Math.max(sameKindMaximum, activeKinds.get(kind)!)
        expect(args.slice(kind === 'container' ? 3 : 2).length).toBeLessThanOrEqual(128)
      }
      seen.add(kind); maximum = Math.max(maximum, ++active)
      await new Promise<void>(resolve => setImmediate(resolve))
      try { return await fixture.run(file, args) } finally {
        active--; if (inspecting) activeKinds.set(kind, activeKinds.get(kind)! - 1)
      }
    }
    await testOwnerListDockerInventory(run)
    expect(maximum).toBe(3); expect(seen.size).toBe(3); expect(active).toBe(0)
    expect(sameKindMaximum).toBe(3); expect([...activeKinds.values()].every(count => count === 0)).toBe(true)
    expect(fixture.calls).toHaveLength(12); expect(new Set(fixture.calls).size).toBe(12)
  })

  it('uses idle capacity for an uneven volume inventory without changing any global command or sealed resource', async () => {
    const sizes = { containers: 1, volumes: 641, networks: 1 }
    const original = globalFixture(1, 'uneven', sizes)
    const expected = await platform.assignmentListDockerInventory(original.run)
    const fixture = globalFixture(1, 'uneven', sizes)
    let active = 0; let maximum = 0; let volumeActive = 0; let volumeMaximum = 0
    const run: Run = async (file, args) => {
      const volumeInspect = args[0] === 'volume' && args[1] === 'inspect'
      maximum = Math.max(maximum, ++active)
      if (volumeInspect) volumeMaximum = Math.max(volumeMaximum, ++volumeActive)
      await new Promise<void>(resolve => setImmediate(resolve))
      try { return await fixture.run(file, args) } finally { active--; if (volumeInspect) volumeActive-- }
    }
    expect(await testOwnerListDockerInventory(run)).toEqual(expected)
    expect([...fixture.calls].sort()).toEqual([...original.calls].sort())
    expect(fixture.calls).toHaveLength(11); expect(maximum).toBe(3); expect(volumeMaximum).toBe(3)
    expect(active).toBe(0); expect(volumeActive).toBe(0)
  })

  it.each(listArgs.map((args, index) => ({ args, index })))('rejects malformed or duplicate global listing $index before its inspection', async ({ args, index }) => {
    for (const bad of [index === 1 ? '--unsafe' : 'missing-id', index === 1 ? 'private;unsafe' : 'f'.repeat(63), `${index === 1 ? 'safe_volume' : id(1)}\n${index === 1 ? 'safe_volume' : id(1)}`]) {
      const fixture = globalFixture(1); fixture.outputs.set(key(args), bad)
      await expect(testOwnerListDockerInventory(fixture.run)).rejects.toThrow('Private Test owner list inventory rejected')
      const ownInspect = fixture.calls.filter(command => {
        const call = JSON.parse(command) as string[]
        return index === 0 ? call[0] === 'inspect' : call[0] === args[0] && call[1] === 'inspect'
      })
      expect(ownInspect).toEqual([])
    }
  })

  it.each(['container', 'volume', 'network'] as const)('rejects missing or unexpected inspected %s identities through the sealed parser', async kind => {
    for (const missing of [true, false]) {
      const fixture = globalFixture(1)
      const args = kind === 'container' ? ['inspect', '--format', template, id(1)] : kind === 'volume' ? ['volume', 'inspect', 'synthetic_volume_0'] : ['network', 'inspect', id(10000)]
      const rows = kind === 'container' ? fixture.containers : kind === 'volume' ? fixture.volumes : fixture.networks
      const changed = missing ? [] : [{ ...rows[0], ...(kind === 'container' ? { id: id(777) } : kind === 'volume' ? { Name: 'unexpected_volume' } : { Id: id(777) }) }]
      fixture.outputs.set(key(args), kind === 'container' ? changed.map(row => JSON.stringify(row)).join('\n') : JSON.stringify(changed))
      await expect(testOwnerListDockerInventory(fixture.run)).rejects.toThrow('Private Test owner list inventory rejected')
    }
  })

  it('accepts a genuinely empty global listing without inventing inspection commands', async () => {
    const fixture = globalFixture(0)
    expect(await testOwnerListDockerInventory(fixture.run)).toEqual([])
    expect(fixture.calls.sort()).toEqual(listArgs.map(key).sort())
  })

  it('settles every pending pipeline on command failure without exposing errors or unhandled rejections', async () => {
    const fixture = globalFixture(1); const started = new Set<string>(); const settled = new Set<string>()
    const releases: Array<() => void> = []; const unhandled = vi.fn(); process.on('unhandledRejection', unhandled)
    let done = false
    try {
      const run: Run = async (file, args) => {
        const kind = args[0]; started.add(kind)
        try {
          if (kind === 'ps') throw new Error('PRIVATE source failure')
          await new Promise<void>(resolve => releases.push(resolve))
          if (kind === 'volume') throw new Error('PRIVATE delayed failure')
          return await fixture.run(file, args)
        } finally { settled.add(kind) }
      }
      const pending = testOwnerListDockerInventory(run).then(() => { done = true }, error => { done = true; expect(String(error)).toBe('Error: Private Test owner list inventory rejected') })
      await new Promise<void>(resolve => setImmediate(resolve))
      expect(started.size).toBe(3); expect(done).toBe(false)
      releases.splice(0).forEach(resolve => resolve())
      await new Promise<void>(resolve => setImmediate(resolve))
      releases.splice(0).forEach(resolve => resolve())
      await pending; expect(settled.size).toBe(3); expect(unhandled).not.toHaveBeenCalled()
      expect(fixture.calls.every(command => listArgs.map(key).includes(command))).toBe(true)
    } finally { process.off('unhandledRejection', unhandled) }
  })

  it('uses idle workers before a slow independent list finishes, but cannot replay until complete global discovery settles', async () => {
    const fixture = globalFixture(1); let release!: () => void
    const held = new Promise<void>(resolve => { release = resolve }); const inspected = vi.fn()
    const run: Run = async (file, args) => {
      if (key(args) === key(listArgs[2])) await held
      if (!listArgs.some(list => key(list) === key(args))) inspected()
      return fixture.run(file, args)
    }
    let done = false
    const pending = testOwnerListDockerInventory(run).then(rows => { done = true; return rows })
    await new Promise<void>(resolve => setImmediate(resolve))
    const beforeRelease = { done, inspected: inspected.mock.calls.length }
    release(); const actual = await pending
    expect(beforeRelease.done).toBe(false); expect(beforeRelease.inspected).toBeGreaterThan(0)
    expect(actual).toEqual(await platform.assignmentListDockerInventory(globalFixture(1).run))
  })

  it('settles all active inspection workers after failure and does not launch queued batches', async () => {
    const fixture = globalFixture(257); const started: string[] = []; const settled: string[] = []
    let release!: () => void; const held = new Promise<void>(resolve => { release = resolve })
    let threeStarted!: () => void; const readyToFail = new Promise<void>(resolve => { threeStarted = resolve })
    const run: Run = async (file, args) => {
      if (listArgs.some(list => key(list) === key(args))) return fixture.run(file, args)
      const command = key(args); started.push(command)
      const ordinal = started.length; if (ordinal === 3) threeStarted()
      try {
        if (ordinal === 1) { await readyToFail; throw new Error('PRIVATE inspect failure') }
        await held; return await fixture.run(file, args)
      } finally { settled.push(command) }
    }
    let done = false
    const pending = testOwnerListDockerInventory(run).then(() => { done = true }, error => {
      done = true; expect(String(error)).toBe('Error: Private Test owner list inventory rejected')
    })
    await new Promise<void>(resolve => setImmediate(resolve))
    const beforeRelease = { done, started: started.length, settled: settled.length }
    release(); await pending
    expect(beforeRelease).toEqual({ done: false, started: 3, settled: 1 })
    expect(started).toHaveLength(3); expect(settled).toHaveLength(3); expect(done).toBe(true)
  })

  it('discovers changed state afresh on consecutive invocations and after a failed invocation', async () => {
    const first = globalFixture(1, 'first'); const second = globalFixture(1, 'second'); const failed = globalFixture(1)
    expect((await testOwnerListDockerInventory(first.run)).every(row => row.createdAt === 'first')).toBe(true)
    failed.outputs.set(key(listArgs[0]), 'PRIVATE invalid')
    await expect(testOwnerListDockerInventory(failed.run)).rejects.toThrow('Private Test owner list inventory rejected')
    expect((await testOwnerListDockerInventory(second.run)).every(row => row.createdAt === 'second')).toBe(true)
    expect(first.calls).toHaveLength(6); expect(second.calls).toHaveLength(6)
  })

  it.each([['docker', ['rm', '-f', id(1)]], ['sh', ['-c', 'PRIVATE']], ['docker', ['ps', '-aq', '--filter', 'label=own']]] as [string, string[]][])('rejects a nonallowlisted first request %s %# without launching commands', async (file, args) => {
    const fixture = globalFixture(1)
    vi.spyOn(platform, 'assignmentListDockerInventory').mockImplementation(async run => { await run!(file, args); return [] })
    await expect(testOwnerListDockerInventory(fixture.run)).rejects.toThrow('Private Test owner list inventory rejected')
    expect(fixture.calls).toEqual([])
  })

  it('permits each exact prefetched command result to be consumed only once', async () => {
    const fixture = globalFixture(1)
    vi.spyOn(platform, 'assignmentListDockerInventory').mockImplementation(async run => { await run!('docker', listArgs[0]); await run!('docker', listArgs[0]); return [] })
    await expect(testOwnerListDockerInventory(fixture.run)).rejects.toThrow('Private Test owner list inventory rejected')
    expect(fixture.calls).toHaveLength(6); expect(new Set(fixture.calls).size).toBe(6)
  })

  it('fails closed if the parser does not consume the complete prefetched global command set', async () => {
    const fixture = globalFixture(1)
    vi.spyOn(platform, 'assignmentListDockerInventory').mockImplementation(async run => { await run!('docker', listArgs[0]); return [] })
    await expect(testOwnerListDockerInventory(fixture.run)).rejects.toThrow('Private Test owner list inventory rejected')
  })

  it('retains native 20s and 64MiB command bounds and closed command failures', async () => {
    vi.mocked(execFile).mockImplementation((_file, _args, options, callback) => {
      expect(options).toMatchObject({ timeout: 20000, maxBuffer: 64 * 1024 * 1024, encoding: 'utf8' })
      const finish = callback as unknown as (error: Error, stdout: string, stderr: string) => void
      queueMicrotask(() => finish(new Error('PRIVATE native failure'), 'PRIVATE stdout', 'PRIVATE stderr'))
      return {} as ReturnType<typeof execFile>
    })
    await expect(testOwnerListDockerInventory(undefined, { env: {}, readConfig: () => undefined })).rejects.toThrow('Private Test owner list inventory rejected')
    expect(execFile).toHaveBeenCalledOnce() // Context resolution fails before global discovery.
  })

  it('applies the same byte bound to injected command outputs before inspections', async () => {
    const fixture = globalFixture(0)
    const oversized = 'x'.repeat(64 * 1024 * 1024 + 1)
    const run: Run = async (file, args) => key(args) === key(listArgs[0]) ? oversized : fixture.run(file, args)
    await expect(testOwnerListDockerInventory(run)).rejects.toThrow('Private Test owner list inventory rejected')
    expect(fixture.calls.every(command => listArgs.map(key).includes(command))).toBe(true)
  })
})
