import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { readFileSync, type statSync } from 'node:fs'
import type { request } from 'node:http'
const mocks = vi.hoisted(() => ({ collect: vi.fn(), spawn: vi.fn() }))
vi.mock('../../scripts/contextual-test-owner-list-proof-inventory', () => ({ testOwnerListDockerInventory: mocks.collect }))
vi.mock('node:child_process', async importOriginal => ({ ...await importOriginal<typeof import('node:child_process')>(), spawn: mocks.spawn }))
vi.mock('node:fs', async importOriginal => { const original = await importOriginal<typeof import('node:fs')>(); return { ...original, readFileSync: vi.fn(original.readFileSync) } })
import { draftSaveProofDockerInventory } from '../../scripts/contextual-test-draft-save-proof-inventory'

const context = ['context', 'inspect', '--format', '{"endpoints":{{json .Endpoints}},"tlsMaterial":{{json .TLSMaterial}}}']
const template = [...readFileSync('scripts/contextual-assignment-list-proof-platform.ts', 'utf8').matchAll(/^const containerTemplate = '([^'\r\n]+)'$/gm)][0][1]
const host = ['--host', 'unix:///private/tmp/pika-offline.sock']
const ids = (size: number) => Array.from({ length: size }, (_, n) => (n + 1).toString(16).padStart(64, '0'))
const raw = (id: string) => ({ Id: id, Name: `/offline_${id}`, Config: { Labels: null, Env: ['PRIVATE_SECRET=never_return'] }, Mounts: [],
  NetworkSettings: { Networks: null }, HostConfig: { PortBindings: null }, Created: '  RAW+timezone  ' })
const projection = (value: ReturnType<typeof raw>) => ({ id: value.Id, name: value.Name, labels: value.Config.Labels, mounts: value.Mounts,
  networks: value.NetworkSettings.Networks, bindings: value.HostConfig.PortBindings, created: value.Created })
type Child = EventEmitter & { stdout: PassThrough; stderr: PassThrough; args: string[]; kill: ReturnType<typeof vi.fn>; complete: (output: string | Buffer, code?: number) => void }
type Http = { options: Record<string, any>; closed: boolean; req: EventEmitter & { destroy: ReturnType<typeof vi.fn> }; socket: EventEmitter & { destroy: ReturnType<typeof vi.fn> };
  response: EventEmitter & { destroy: ReturnType<typeof vi.fn>; statusCode: number; headers: Record<string, string>; complete: boolean };
  begin: () => void; respond: (body: string | Buffer, status?: number, headers?: Record<string, string>) => void; close: () => void }
let children: Child[]; let calls: Http[]; let active: number; let httpActive: number; let maximum: number; let ownMaximum: number
let holdClose: boolean; let socketAtEnd: boolean; let onRequest: ((call: Http) => void) | undefined
const requestMock = vi.fn()
beforeEach(() => {
  children = []; calls = []; active = 0; httpActive = 0; maximum = 0; ownMaximum = 0; holdClose = false; socketAtEnd = true; onRequest = undefined
  mocks.collect.mockReset(); mocks.spawn.mockReset(); requestMock.mockReset()
  mocks.spawn.mockImplementation((_file, args) => {
    const child = Object.assign(new EventEmitter(), { args, stdout: new PassThrough(), stderr: new PassThrough(), kill: vi.fn(), complete(output: string | Buffer, code = 0) {
      child.stdout.end(output); child.stderr.end(); active--; child.emit('close', code, null)
    } }) as Child
    active++; maximum = Math.max(maximum, active + httpActive); ownMaximum = Math.max(ownMaximum, active + calls.filter(c => c.options.path !== '/v1.45/volumes' && !c.closed).length)
    children.push(child); return child
  })
  requestMock.mockImplementation((options, callback) => {
    let reqClosed = false; let socketClosed = false; let counted = true
    const decrement = () => { if (reqClosed && socketClosed && counted) { counted = false; httpActive--; call.closed = true } }
    const socket = Object.assign(new EventEmitter(), { destroy: vi.fn(() => { if (!holdClose) queueMicrotask(() => { if (!socketClosed) { socketClosed = true; decrement(); socket.emit('close') } }) }) })
    const response = Object.assign(new EventEmitter(), { statusCode: 200, headers: { 'content-type': 'application/json' }, complete: true,
      destroy: vi.fn(() => queueMicrotask(() => response.emit('close'))) })
    const req = Object.assign(new EventEmitter(), { destroy: vi.fn(() => { if (!holdClose) queueMicrotask(() => { if (!reqClosed) { reqClosed = true; decrement(); req.emit('close') } }) }),
      end: vi.fn(() => queueMicrotask(() => { if (socketAtEnd) req.emit('socket', socket); onRequest?.(call) })) })
    const call: Http = { options, req, socket, response, closed: false, begin() { callback(response) }, respond(body, status = 200, headers = { 'content-type': 'application/json' }) {
      response.statusCode = status; response.headers = headers; callback(response); response.emit('data', Buffer.from(body)); response.emit('end')
    }, close() { if (!reqClosed) { reqClosed = true; req.emit('close') }; if (!socketClosed) { socketClosed = true; socket.emit('close') }; decrement() } }
    calls.push(call); httpActive++; maximum = Math.max(maximum, active + httpActive)
    ownMaximum = Math.max(ownMaximum, active + calls.filter(c => c.options.path !== '/v1.45/volumes' && !c.closed).length)
    return req
  })
})
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })
async function flush() { for (let n = 0; n < 30; n++) await Promise.resolve() }
function configured(size = 3) {
  const names = ids(size)
  mocks.collect.mockImplementation(async (run, seams) => {
    expect(run).toBeUndefined(); expect(seams.env).not.toBe(process.env)
    await seams.run('docker', context); await seams.run('docker', [...host, 'ps', '-aq', '--no-trunc'])
    return seams.run('docker', [...host, 'inspect', '--format', template, ...names])
  }); return names
}
const options = () => ({ env: {}, request: requestMock as unknown as typeof request })
async function discovery(names: string[]) { await flush(); children[0].complete('{}'); await flush(); children[1].complete(names.join('\n')); await flush() }
const requestedId = (call: Http) => String(call.options.path).split('/')[3]

describe('PATCH-only full HTTP inventory (offline)', () => {
  it('uses two exact HTTP readers, original logical order and no container CLI child, stripping private fields', async () => {
    const names = configured(); const pending = draftSaveProofDockerInventory(options()); await discovery(names)
    expect(children).toHaveLength(2); expect(calls).toHaveLength(2)
    expect(calls[0].options).toEqual({ socketPath: '/private/tmp/pika-offline.sock', path: `/v1.45/containers/${names[0]}/json`, method: 'GET', agent: false,
      headers: { Accept: 'application/json', 'Accept-Encoding': 'identity', Connection: 'close' } })
    calls[1].respond(JSON.stringify(raw(names[1]))); await flush(); calls[0].respond(JSON.stringify(raw(names[0]))); await flush()
    calls[2].respond(JSON.stringify(raw(names[2])))
    const result = await pending
    expect(result).toBe(names.map(id => JSON.stringify(projection(raw(id)))).join('\n')); expect(result).not.toContain('PRIVATE')
    expect(ownMaximum).toBe(2); expect(active + httpActive).toBe(0)
  })
  it('latches HTTP failure immediately, cancels queued/active resources and awaits late closure privately', async () => {
    const names = configured(); holdClose = true; let done = false
    const pending = draftSaveProofDockerInventory(options()).catch(e => { done = true; return e }); await discovery(names)
    calls[0].respond('PRIVATE', 500); await flush()
    expect(calls).toHaveLength(2); expect(calls[1].req.destroy).toHaveBeenCalled(); expect(done).toBe(false)
    calls[0].close(); await flush(); expect(done).toBe(false); calls[1].close()
    expect(String(await pending)).toBe('Error: Private Test draft save inventory rejected'); expect(active + httpActive).toBe(0)
  })
  it('includes queue wait in the logical20s deadline and awaits reaping after expiry', async () => {
    vi.useFakeTimers(); const names = configured(); holdClose = true; let done = false
    const pending = draftSaveProofDockerInventory(options()).catch(e => { done = true; return e }); await discovery(names)
    await vi.advanceTimersByTimeAsync(19999); expect(done).toBe(false); await vi.advanceTimersByTimeAsync(1)
    expect(calls).toHaveLength(2); expect(calls.every(c => c.req.destroy.mock.calls.length)).toBe(true); expect(done).toBe(false)
    calls.forEach(c => c.close()); await pending; expect(active + httpActive).toBe(0)
  })
  it.each([['wrong file', 'sh', context], ['unknown args', 'docker', ['--host', host[1], 'rm', 'unsafe']],
    ['unbound inspect', 'docker', [...host, 'inspect', '--format', template, ...ids(1)]],
    ['remote host', 'docker', ['--host', 'tcp://127.0.0.1:2375', 'ps', '-aq', '--no-trunc']]])('rejects %s before dispatch', async (_label, file, args) => {
    mocks.collect.mockImplementation(async (_run, seams) => seams.run(file, args))
    await expect(draftSaveProofDockerInventory(options())).rejects.toThrow('Private Test draft save inventory rejected')
    expect(children).toHaveLength(0); expect(calls).toHaveLength(0)
  })
  it('does not reuse failure or environment capture across invocations', async () => {
    mocks.collect.mockRejectedValueOnce(Error('PRIVATE')); await expect(draftSaveProofDockerInventory(options())).rejects.toThrow()
    mocks.collect.mockImplementation(async (_run, seams) => { expect(seams.env.OFFLINE).toBe('fresh'); return [] })
    expect(await draftSaveProofDockerInventory({ ...options(), env: { OFFLINE: 'fresh' } })).toEqual([])
  })
  it.each(['duplicate', 'malformed'])('rejects %s fresh IDs without inspection', async kind => {
    const names = configured(); const pending = draftSaveProofDockerInventory(options()).catch(e => e)
    await flush(); children[0].complete('{}'); await flush(); children[1].complete(kind === 'duplicate' ? `${names[0]}\n${names[0]}` : '--unsafe')
    expect(String(await pending)).toBe('Error: Private Test draft save inventory rejected'); expect(calls).toHaveLength(0)
  })
  it.each(['status', 'content-type', 'encoding', 'json', 'identity', 'missing', 'incomplete', 'utf8', 'bom', 'aggregate'])('rejects private %s responses and closes every active reader', async kind => {
    const names = configured(); const pending = draftSaveProofDockerInventory(options()).catch(e => e); await discovery(names)
    const value = raw(names[0]); if (kind === 'identity') value.Id = ids(5)[4]
    const body = kind === 'json' ? 'PRIVATE invalid' : kind === 'missing' ? '{}' : kind === 'utf8' ? Buffer.from([0xff]) :
      kind === 'bom' ? `\ufeff${JSON.stringify(value)}` : kind === 'aggregate' ? JSON.stringify({ ...value, UnneededPrivatePadding: 'x'.repeat(4 * 1024 * 1024) }) : JSON.stringify(value)
    if (kind === 'incomplete') calls[0].response.complete = false
    calls[0].respond(body, kind === 'status' ? 500 : 200, kind === 'content-type' ? { 'content-type': 'text/plain' } :
      kind === 'encoding' ? { 'content-type': 'application/json', 'content-encoding': 'gzip' } : undefined)
    expect(String(await pending)).toBe('Error: Private Test draft save inventory rejected')
    expect(calls).toHaveLength(2); expect(calls.every(call => call.closed)).toBe(true); expect(active + httpActive).toBe(0)
  })
  it('preserves nulls, raw Created and fragmented Unicode without exposing Env', async () => {
    const names = configured(1); const pending = draftSaveProofDockerInventory(options()); await discovery(names)
    const value = raw(names[0]); value.Name = '/雪😀'; const bytes = Buffer.from(JSON.stringify(value)); const split = bytes.indexOf(Buffer.from('雪')) + 1
    calls[0].begin(); calls[0].response.emit('data', bytes.subarray(0, split)); calls[0].response.emit('data', bytes.subarray(split)); calls[0].response.emit('end')
    expect(await pending).toBe(JSON.stringify(projection(value)))
    expect(active + httpActive).toBe(0)
  })
  it('destroys a socket assigned after a pre-socket error and awaits its close', async () => {
    const names = configured(1); holdClose = true; socketAtEnd = false; let done = false
    const pending = draftSaveProofDockerInventory(options()).catch(e => { done = true; return e }); await discovery(names)
    calls[0].req.emit('error', Error('PRIVATE')); await flush(); expect(done).toBe(false)
    calls[0].req.emit('socket', calls[0].socket); expect(calls[0].socket.destroy).toHaveBeenCalled()
    calls[0].close(); expect(String(await pending)).not.toContain('PRIVATE_SECRET'); expect(active + httpActive).toBe(0)
  })
  it.each(['aborted', 'response error', 'socket error'])('latches %s privately and settles active sockets', async kind => {
    const names = configured(); const pending = draftSaveProofDockerInventory(options()).catch(e => e); await discovery(names)
    calls[0].begin()
    if (kind === 'socket error') calls[0].socket.emit('error', Error('PRIVATE'))
    else calls[0].response.emit(kind === 'aborted' ? 'aborted' : 'error', Error('PRIVATE'))
    expect(String(await pending)).toBe('Error: Private Test draft save inventory rejected'); expect(calls).toHaveLength(2); expect(active + httpActive).toBe(0)
  })
  it('fails a changed projection source before CLI or HTTP', async () => {
    vi.mocked(readFileSync).mockReturnValueOnce(`const containerTemplate = '{}'`)
    await expect(draftSaveProofDockerInventory(options())).rejects.toThrow('Private Test draft save inventory rejected')
    expect(children).toHaveLength(0); expect(calls).toHaveLength(0)
  })
  it.each(['ambiguous', 'missing'])('rejects %s source declarations before dispatch', async kind => {
    vi.mocked(readFileSync).mockReturnValueOnce(kind === 'missing' ? '' : `const containerTemplate = '${template}'\nconst containerTemplate = '${template}'`)
    await expect(draftSaveProofDockerInventory(options())).rejects.toThrow('Private Test draft save inventory rejected')
    expect(children).toHaveLength(0); expect(calls).toHaveLength(0)
  })
  it.each(['host swap', 'template swap', 'batch swap'])('rejects %s after fresh listing without inspection', async kind => {
    const names = ids(2)
    mocks.collect.mockImplementation(async (_run, seams) => {
      await seams.run('docker', context); await seams.run('docker', [...host, 'ps', '-aq', '--no-trunc'])
      return seams.run('docker', ['--host', kind === 'host swap' ? 'unix:///private/tmp/other.sock' : host[1], 'inspect', '--format',
        kind === 'template swap' ? '{}' : template, ...(kind === 'batch swap' ? [...names].reverse() : names)])
    })
    const pending = draftSaveProofDockerInventory(options()).catch(e => e); await discovery(names)
    expect(String(await pending)).toBe('Error: Private Test draft save inventory rejected'); expect(children).toHaveLength(2); expect(calls).toHaveLength(0)
  })
  it('settles synchronous request construction failure without dispatching queued IDs', async () => {
    const names = configured(); requestMock.mockImplementationOnce(() => { throw Error('PRIVATE constructor') })
    const pending = draftSaveProofDockerInventory(options()).catch(e => e); await discovery(names)
    expect(String(await pending)).toBe('Error: Private Test draft save inventory rejected'); expect(calls).toHaveLength(0); expect(active).toBe(0)
  })
  it('settles synchronous CLI spawn failure privately', async () => {
    configured(); mocks.spawn.mockImplementationOnce(() => { throw Error('PRIVATE spawn') })
    await expect(draftSaveProofDockerInventory(options())).rejects.toThrow('Private Test draft save inventory rejected')
    expect(children).toHaveLength(0); expect(calls).toHaveLength(0)
  })
  it('cancels an exact active CLI child and waits for reaping after peer failure', async () => {
    mocks.collect.mockImplementation(async (_run, seams) => {
      await seams.run('docker', context)
      return Promise.all([seams.run('docker', [...host, 'ps', '-aq', '--no-trunc']), seams.run('docker', [...host, 'network', 'ls', '-q', '--no-trunc'])])
    })
    let done = false; const pending = draftSaveProofDockerInventory(options()).catch(e => { done = true; return e })
    await flush(); children[0].complete('{}'); await flush(); expect(children).toHaveLength(3)
    children[1].complete('PRIVATE', 1); await flush(); expect(children[2].kill).toHaveBeenCalledWith('SIGKILL'); expect(done).toBe(false)
    children[2].complete(''); expect(String(await pending)).toBe('Error: Private Test draft save inventory rejected'); expect(active).toBe(0)
  })
  it('retains CLI UTF8 decoder carry across fragments', async () => {
    mocks.collect.mockImplementation(async (_run, seams) => seams.run('docker', context))
    const pending = draftSaveProofDockerInventory(options()); await flush()
    const bytes = Buffer.from('雪😀'); children[0].stdout.write(bytes.subarray(0, 1)); children[0].complete(bytes.subarray(1))
    expect(await pending).toBe('雪😀'); expect(active).toBe(0)
  })
  it.each(['DOCKER_HOST', 'HTTPS_PROXY'])('runs native %s denial before CLI/HTTP', async name => {
    const shared = await vi.importActual<typeof import('../../scripts/contextual-test-owner-list-proof-inventory')>('../../scripts/contextual-test-owner-list-proof-inventory')
    mocks.collect.mockImplementation(shared.testOwnerListDockerInventory)
    await expect(draftSaveProofDockerInventory({ ...options(), env: { [name]: '' }, readConfig: () => undefined })).rejects.toThrow('Private Test draft save inventory rejected')
    expect(children).toHaveLength(0); expect(calls).toHaveLength(0)
  })
  it('replays the real unchanged export/parser on 129 containers,617 volumes,23 networks with full parity and three total slots', async () => {
    const shared = await vi.importActual<typeof import('../../scripts/contextual-test-owner-list-proof-inventory')>('../../scripts/contextual-test-owner-list-proof-inventory')
    const platform = await import('../../scripts/contextual-assignment-list-proof-platform')
    mocks.collect.mockImplementation(shared.testOwnerListDockerInventory)
    const names = ids(129); const networks = ids(23).map((id, n) => ({ Id: (10000 + n).toString(16).padStart(64, '0'), Name: `network_${n}`, Created: 'RAW', Labels: null,
      Containers: n === 0 ? { [names[0]]: {}, [names[1]]: {}, [ids(999)[998]]: {} } : null }))
    const volumes = Array.from({ length: 617 }, (_, n) => ({ Name: `volume_${n}`, CreatedAt: '  RAW+timezone  ', Labels: null }))
    const containers = names.map((id, n) => ({ ...projection(raw(id)), labels: n ? { foreign: 'yes' } : null,
      mounts: [{ Type: 'volume', Name: volumes[n].Name }, ...(n === 1 ? [{ Type: 'volume', Name: volumes[0].Name }] : [])],
      networks: n < 2 ? { shared: { NetworkID: networks[0].Id } } : null,
      bindings: n === 0 ? { '5432/tcp': [{ HostPort: '54332' }], 'null/tcp': null } : null }))
    const command = (args: string[]) => {
      if (JSON.stringify(args) === JSON.stringify(context)) return JSON.stringify({ endpoints: { docker: { Host: host[1], SkipTLSVerify: false } }, tlsMaterial: {} })
      if (args[0] === 'ps') return names.join('\n')
      if (args[0] === 'volume' && args[1] === 'ls') return volumes.map(v => v.Name).join('\n')
      if (args[0] === 'network' && args[1] === 'ls') return networks.map(n => n.Id).join('\n')
      if (args[0] === 'network' && args[1] === 'inspect') return JSON.stringify(networks.filter(n => args.slice(2).includes(n.Id)))
      if (args[0] === 'volume' && args[1] === 'inspect') return JSON.stringify(volumes.filter(v => args.slice(2).includes(v.Name)))
      if (args[0] === 'inspect') return containers.filter(c => args.slice(3).includes(c.id)).map(c => JSON.stringify(c)).join('\n')
      throw Error('offline unexpected command')
    }
    const spawn = mocks.spawn.getMockImplementation()!
    mocks.spawn.mockImplementation((file, args, opts) => {
      const child = spawn(file, args, opts) as Child
      queueMicrotask(() => child.complete(command(args[0] === '--host' ? args.slice(2) : args))); return child
    })
    onRequest = call => {
      if (call.options.path === '/v1.45/volumes') call.respond(JSON.stringify({ Volumes: volumes, Warnings: null }))
      else {
        const projected = containers.find(c => c.id === requestedId(call))!
        call.respond(JSON.stringify({ ...raw(projected.id), Config: { Labels: projected.labels, Env: ['PRIVATE_SECRET=never_return'] }, Mounts: projected.mounts,
          NetworkSettings: { Networks: projected.networks }, HostConfig: { PortBindings: projected.bindings } }))
      }
    }
    const stat = vi.fn(() => ({ dev: 1, ino: 2, mode: 0o140600, rdev: 0, isSocket: () => true }) as ReturnType<typeof statSync>)
    const actual = await draftSaveProofDockerInventory({ ...options(), readConfig: () => undefined, realpath: () => host[1].slice(7), stat })
    const expected = await platform.assignmentListDockerInventory(async (_file, args) => command(args))
    expect(actual).toEqual(expected); expect(actual).toHaveLength(769); expect(JSON.stringify(actual)).not.toContain('PRIVATE_SECRET')
    expect(children).toHaveLength(5); expect(calls).toHaveLength(130); expect(calls.filter(c => c.options.path === '/v1.45/volumes')).toHaveLength(1)
    expect(ownMaximum).toBeLessThanOrEqual(2); expect(maximum).toBeLessThanOrEqual(3); expect(active + httpActive).toBe(0); expect(stat).toHaveBeenCalledTimes(2)
  })
})
