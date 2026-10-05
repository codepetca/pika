import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
const mocks = vi.hoisted(() => ({ collect: vi.fn(), spawn: vi.fn() }))
vi.mock('../../scripts/contextual-test-owner-list-proof-inventory', () => ({ testOwnerListDockerInventory: mocks.collect }))
vi.mock('node:child_process', async importOriginal => ({ ...await importOriginal<typeof import('node:child_process')>(), spawn: mocks.spawn }))
import { draftSaveProofDockerInventory } from '../../scripts/contextual-test-draft-save-proof-inventory'
import { readFileSync } from 'node:fs'
import type { statSync, realpathSync } from 'node:fs'
import type { request } from 'node:http'

const context = ['context', 'inspect', '--format', '{"endpoints":{{json .Endpoints}},"tlsMaterial":{{json .TLSMaterial}}}']
const template = [...readFileSync('scripts/contextual-assignment-list-proof-platform.ts', 'utf8').matchAll(/^const containerTemplate = '([^'\r\n]+)'$/gm)][0][1]
const host = ['--host', 'unix:///private/tmp/pika-offline.sock']
const ids = (size: number) => Array.from({ length: size }, (_, n) => (n + 1).toString(16).padStart(64, '0'))
type Child = EventEmitter & { stdout: PassThrough; stderr: PassThrough; kill: ReturnType<typeof vi.fn>; args: string[]; complete: (output: string | Buffer, code?: number) => void }
let children: Child[]; let active: number; let maximum: number
beforeEach(() => {
  children = []; active = 0; maximum = 0; mocks.collect.mockReset(); mocks.spawn.mockReset()
  mocks.spawn.mockImplementation((_file, args) => {
    const child = Object.assign(new EventEmitter(), { args, stdout: new PassThrough(), stderr: new PassThrough(), kill: vi.fn(), complete(output: string | Buffer, code = 0) {
      child.stdout.end(output); child.stderr.end(); active--; child.emit('close', code, null)
    } }) as Child
    active++; maximum = Math.max(maximum, active); children.push(child)
    return child
  })
})
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })
async function flush() { for (let n = 0; n < 20; n++) await Promise.resolve() }
function configured(size = 101) {
  const names = ids(size)
  mocks.collect.mockImplementation(async (run, seams) => {
    expect(run).toBeUndefined(); expect(seams.env).not.toBe(process.env)
    await seams.run('docker', context)
    await seams.run('docker', [...host, 'ps', '-aq', '--no-trunc'])
    return seams.run('docker', [...host, 'inspect', '--format', template, ...names])
  })
  return names
}
async function discovery(names: string[]) {
  await flush(); children[0].complete('{}'); await flush(); children[1].complete(names.join('\n')); await flush()
}
const rows = (child: Child) => child.args.slice(5).map(id => JSON.stringify({ id })).join('\n')

describe('PATCH-only chunked inventory transport (offline)', () => {
  it('splits only a large exact logical container batch, overlaps two children, and reconstructs original order', async () => {
    const names = configured(); const pending = draftSaveProofDockerInventory({ env: {} })
    await discovery(names)
    expect(children.slice(2)).toHaveLength(2); expect(maximum).toBe(2)
    expect(children[2].args.slice(5)).toEqual(names.slice(0, 32))
    expect(children[3].args.slice(5)).toEqual(names.slice(32, 64))
    children[3].complete(rows(children[3])); await flush()
    children[2].complete(rows(children[2])); await flush()
    for (const child of children.slice(4)) child.complete(rows(child))
    expect(await pending).toBe(names.map(id => JSON.stringify({ id })).join('\n'))
    expect(maximum).toBe(2); expect(active).toBe(0)
  })
  it('forwards a small exact logical batch as one child', async () => {
    const names = configured(32); const pending = draftSaveProofDockerInventory({ env: {} })
    await discovery(names); expect(children).toHaveLength(3)
    children[2].complete(rows(children[2])); expect(await pending).toBe(names.map(id => JSON.stringify({ id })).join('\n'))
  })
  it('preserves UTF8 split across stream chunks in the original logical output', async () => {
    const names = configured(33); const pending = draftSaveProofDockerInventory({ env: {} })
    await discovery(names)
    const output = children[2].args.slice(5).map(id => JSON.stringify({ id, label: '☃' })).join('\n')
    const encoded = Buffer.from(output); const split = encoded.indexOf(Buffer.from('☃')) + 1
    children[2].stdout.write(encoded.subarray(0, split)); children[2].complete(encoded.subarray(split))
    children[3].complete(rows(children[3]))
    await expect(pending).resolves.toBe(`${output}\n${rows(children[3])}`)
  })
  it('latches failure, stops queued chunks and waits for every active child close before rejecting privately', async () => {
    const names = configured(); let settled = false
    const pending = draftSaveProofDockerInventory({ env: {} }).catch(error => { settled = true; return error })
    await discovery(names)
    children[2].complete('PRIVATE', 1); await flush()
    expect(children).toHaveLength(4); expect(children[3].kill).toHaveBeenCalledWith('SIGKILL'); expect(settled).toBe(false)
    children[3].complete(''); const error = await pending
    expect(String(error)).toBe('Error: Private Test draft save inventory rejected'); expect(active).toBe(0)
  })
  it('includes queue wait in the logical 20 second deadline and still waits for child reaping', async () => {
    vi.useFakeTimers(); const names = configured(); let settled = false
    const pending = draftSaveProofDockerInventory({ env: {} }).catch(error => { settled = true; return error })
    await discovery(names); await vi.advanceTimersByTimeAsync(19999); expect(settled).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(children).toHaveLength(4); expect(children.slice(2).every(c => c.kill.mock.calls.length === 1)).toBe(true)
    expect(settled).toBe(false)
    children[2].complete(''); children[3].complete(''); await pending
    expect(active).toBe(0)
  })
  it.each([['wrong file', 'sh', context], ['unknown args', 'docker', ['--host', host[1], 'rm', 'unsafe']],
    ['unbound inspect', 'docker', [...host, 'inspect', '--format', template, ...ids(1)]],
    ['remote host', 'docker', ['--host', 'tcp://127.0.0.1:2375', 'ps', '-aq', '--no-trunc']]])('rejects %s before child dispatch', async (_label, file, args) => {
    mocks.collect.mockImplementation(async (_run, seams) => seams.run(file, args))
    await expect(draftSaveProofDockerInventory({ env: {} })).rejects.toThrow('Private Test draft save inventory rejected')
    expect(children).toHaveLength(0)
  })
  it('does not retain a failed invocation or environment capture in a subsequent invocation', async () => {
    mocks.collect.mockRejectedValueOnce(Error('PRIVATE'))
    await expect(draftSaveProofDockerInventory({ env: { OFFLINE: 'first' } })).rejects.toThrow()
    mocks.collect.mockImplementation(async (_run, seams) => { expect(seams.env.OFFLINE).toBe('second'); return [] })
    expect(await draftSaveProofDockerInventory({ env: { OFFLINE: 'second' } })).toEqual([])
  })
  it('settles synchronous spawn failure without hanging already queued logical chunks', async () => {
    const names = configured(); const pending = draftSaveProofDockerInventory({ env: {} }).catch(error => error)
    await flush(); children[0].complete('{}'); await flush()
    mocks.spawn.mockImplementationOnce(() => { throw Error('PRIVATE spawn') })
    children[1].complete(names.join('\n'))
    expect(String(await pending)).toBe('Error: Private Test draft save inventory rejected')
    expect(active).toBe(0)
  })
  it('bounds aggregate retained chunk fragments plus reconstructed output, rather than each chunk independently', async () => {
    const names = configured(); const pending = draftSaveProofDockerInventory({ env: {} }).catch(error => error)
    await discovery(names)
    const large = (child: Child) => child.args.slice(5).map((id, n) => JSON.stringify({ id, pad: n === 0 ? 'x'.repeat(20 * 1024 * 1024) : '' })).join('\n')
    children[2].complete(large(children[2])); await flush()
    children[3].complete(large(children[3])); await flush()
    for (const child of children.slice(4)) child.complete(rows(child))
    expect(String(await pending)).toBe('Error: Private Test draft save inventory rejected')
    expect(active).toBe(0)
  })
  it('rejects mismatched chunk identity and never treats fragment order as authority', async () => {
    const names = configured(33); const pending = draftSaveProofDockerInventory({ env: {} }).catch(error => error)
    await discovery(names)
    children[2].complete(rows(children[2])); children[3].complete(JSON.stringify({ id: 'f'.repeat(64) }))
    expect(String(await pending)).toBe('Error: Private Test draft save inventory rejected')
  })
  it.each(['duplicate', 'malformed'])('rejects %s fresh listing IDs without queuing an inspection', async kind => {
    const names = configured(33); const pending = draftSaveProofDockerInventory({ env: {} }).catch(error => error)
    await flush(); children[0].complete('{}'); await flush()
    children[1].complete(kind === 'duplicate' ? `${names[0]}\n${names[0]}` : '--unsafe')
    expect(String(await pending)).toBe('Error: Private Test draft save inventory rejected')
    expect(children).toHaveLength(2)
  })
  it('replays the real unchanged native collector and sealed parser with complete graph, bulk HTTP and socket closure', async () => {
    const actual = await vi.importActual<typeof import('../../scripts/contextual-test-owner-list-proof-inventory')>('../../scripts/contextual-test-owner-list-proof-inventory')
    const platform = await vi.importActual<typeof import('../../scripts/contextual-assignment-list-proof-platform')>('../../scripts/contextual-assignment-list-proof-platform')
    mocks.collect.mockImplementation(actual.testOwnerListDockerInventory)
    const names = ids(129); const networks = ids(23).map(id => `a${id.slice(1)}`)
    const volumes = Array.from({ length: 617 }, (_, n) => ({ Name: `offline_${n}`, CreatedAt: 'RAW+timezone', Labels: null }))
    const containers = names.map((id, n) => ({ id, name: `/offline_${n}`, labels: null, created: 'RAW+timezone',
      mounts: [{ Type: 'volume', Name: volumes[n].Name }], networks: { offline: { NetworkID: networks[n % networks.length] } }, bindings: {} }))
    const networkRows = networks.map((Id, n) => ({ Id, Name: `offline_network_${n}`, Created: 'RAW+timezone', Labels: null,
      Containers: Object.fromEntries(containers.filter((_, i) => i % networks.length === n).map(c => [c.id, {}])) }))
    function output(args: string[]) {
      if (JSON.stringify(args) === JSON.stringify(context)) return JSON.stringify({ endpoints: { docker: { Host: host[1], SkipTLSVerify: false } }, tlsMaterial: null })
      if (args[0] === '--host') args = args.slice(2)
      if (args[0] === 'ps') return names.join('\n')
      if (args[0] === 'volume' && args[1] === 'ls') return volumes.map(v => v.Name).join('\n')
      if (args[0] === 'network' && args[1] === 'ls') return networks.join('\n')
      if (args[0] === 'inspect') return args.slice(3).map(id => JSON.stringify(containers.find(c => c.id === id))).join('\n')
      if (args[0] === 'network' && args[1] === 'inspect') return JSON.stringify(args.slice(2).map(id => networkRows.find(row => row.Id === id)))
      if (args[0] === 'volume' && args[1] === 'inspect') return JSON.stringify(args.slice(2).map(name => volumes.find(v => v.Name === name)))
      throw Error('Offline unexpected command')
    }
    let httpActive = 0; let combined = 0
    const spawn = mocks.spawn.getMockImplementation()!
    mocks.spawn.mockImplementation((file, args, options) => {
      expect(file).toBe('docker'); expect(options.env).toEqual({ OFFLINE: 'fresh' }); expect(options.stdio).toEqual(['ignore', 'pipe', 'pipe'])
      const child = spawn(file, args, options) as Child; combined = Math.max(combined, active + httpActive)
      queueMicrotask(() => child.complete(output(args))); return child
    })
    const requests: EventEmitter[] = []; const sockets: EventEmitter[] = []
    const requestMock = vi.fn((options, callback) => {
      expect(options.socketPath).toBe('/private/tmp/pika-offline.sock'); expect(options.path).toBe('/v1.45/volumes')
      expect(options.agent).toBe(false); expect(options.headers.Connection).toBe('close')
      httpActive++; combined = Math.max(combined, active + httpActive)
      let requestClosed = false; let socketClosed = false
      const decrement = () => { if (requestClosed && socketClosed) httpActive-- }
      const socket = Object.assign(new EventEmitter(), { destroy: vi.fn(() => queueMicrotask(() => { socketClosed = true; socket.emit('close'); decrement() })) })
      const response = Object.assign(new EventEmitter(), { statusCode: 200, complete: true, headers: { 'content-type': 'application/json' }, destroy: vi.fn(() => queueMicrotask(() => response.emit('close'))) })
      const req = Object.assign(new EventEmitter(), { destroy: vi.fn(() => queueMicrotask(() => { requestClosed = true; req.emit('close'); decrement() })),
        end: vi.fn(() => queueMicrotask(() => { req.emit('socket', socket); callback(response); response.emit('data', Buffer.from(JSON.stringify({ Volumes: volumes, Warnings: null }))); response.emit('end') })) })
      requests.push(req); sockets.push(socket); return req
    }) as unknown as typeof request
    const stat = vi.fn(() => ({ dev: 1, ino: 2, mode: 0o140600, rdev: 0, isSocket: () => true }) as ReturnType<typeof statSync>)
    const result = await draftSaveProofDockerInventory({ env: { OFFLINE: 'fresh' }, readConfig: () => undefined,
      realpath: (() => '/private/tmp/pika-offline.sock') as typeof realpathSync, stat: stat as typeof statSync, request: requestMock })
    expect(result).toEqual(await platform.assignmentListDockerInventory(async (_file, args) => output(args)))
    expect(result.filter(r => r.kind === 'container')).toHaveLength(129)
    expect(result.filter(r => r.kind === 'volume')).toHaveLength(617)
    expect(requestMock).toHaveBeenCalledOnce(); expect(stat).toHaveBeenCalledTimes(2)
    expect(maximum).toBe(2); expect(combined).toBeLessThanOrEqual(3); expect(active + httpActive).toBe(0)
    expect(children.filter(c => c.args[2] === 'inspect').every(c => c.args.length - 5 <= 32)).toBe(true)
    expect(requests).toHaveLength(1); expect(sockets).toHaveLength(1)
  })
})
