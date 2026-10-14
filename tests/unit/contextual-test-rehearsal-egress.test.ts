import { createRequire } from 'node:module'
import { describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import vm from 'node:vm'
import { mkdtempSync, realpathSync, rmSync, writeFileSync, chmodSync, readFileSync, renameSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const require = createRequire(import.meta.url)
const { createContextualTestEgressPolicy, validateContextualTestNextFork, createContextualTestSharedLedger, boundContextualTestHttpRequest, createContextualTestBoundedFetch, createContextualTestStaticWorkerFork, disableContextualTestNextTelemetry } = require('../../scripts/contextual-test-rehearsal-egress.cjs')

describe('disabled installed Next telemetry stays disabled before native dispatch', () => {
  const file = realpathSync(require.resolve('next/dist/telemetry/storage'))
  function telemetry() {
    type Instance = { flushDetached(mode: string, directory: string): void; record(event: unknown, deferred: boolean): unknown }
    const module = { exports: {} as { Telemetry: new (options: { distDir: string }) => Instance } }
    const spawn = vi.fn(), mkdir = vi.fn(), write = vi.fn(), env = { NEXT_TELEMETRY_DISABLED: '1' }
    const forbidden = () => { throw Error('No telemetry network in CPU test') }
    const modules: Record<string, unknown> = {
      '../lib/picocolors': {}, 'next/dist/compiled/conf': class { get() { return false }; set() {} },
      crypto: require('node:crypto'), 'next/dist/compiled/is-docker': () => false, path: require('node:path'),
      './anonymous-meta': { getAnonymousMeta: forbidden }, '../server/ci-info': { isCI: false },
      './post-telemetry-payload': { postNextTelemetryPayload: forbidden }, './project-id': { getRawProjectId: forbidden },
      'next/dist/compiled/@edge-runtime/ponyfill': { AbortController }, fs: { mkdirSync: mkdir, writeFileSync: write },
      child_process: { spawn, spawnSync: forbidden },
    }
    const nativeRequire = Object.assign((id: string) => {
      if (!Object.hasOwn(modules, id)) throw Error('Unapproved CPU dependency')
      return modules[id]
    }, { resolve: () => '/cpu/next/detached-flush.js' })
    vm.runInNewContext(readFileSync(file, 'utf8'), { module, exports: module.exports, require: nativeRequire,
      process: { env, execPath: '/cpu/node' }, Buffer, console }, { filename: file, timeout: 1000 })
    const loader = Object.assign(vi.fn(() => module.exports), { cache: { [file]: module } })
    return { module, loader, spawn, mkdir, write, env }
  }
  it('demonstrates the real disabled-telemetry shutdown spawn and prevents it at the exact optional API', () => {
    const before = telemetry(), old = new before.module.exports.Telemetry({ distDir: '/cpu/dist' })
    old.record({ eventName: 'CPU', payload: {} }, true); old.flushDetached('dev', '/cpu/app')
    expect(before.spawn).toHaveBeenCalledOnce(); expect(before.write).toHaveBeenCalledOnce()
    const after = telemetry(), original = after.module.exports.Telemetry
    disableContextualTestNextTelemetry(file, after.loader, after.env)
    expect(Object.getOwnPropertyDescriptor(after.module.exports, '__esModule')).toMatchObject({ value: true, enumerable: false, configurable: false })
    const fixed = new after.module.exports.Telemetry({ distDir: '/cpu/dist' })
    expect(fixed).toBeInstanceOf(original)
    fixed.record({ eventName: 'CPU', payload: {} }, true); fixed.flushDetached('dev', '/cpu/app')
    expect(after.spawn).not.toHaveBeenCalled(); expect(after.mkdir).not.toHaveBeenCalled(); expect(after.write).not.toHaveBeenCalled()
    expect(Object.getOwnPropertyDescriptor(fixed, 'flushDetached')).toMatchObject({ writable: false, configurable: false })
  })
  it('refuses an enabled environment, dependency drift or a mismatched module cache', () => {
    const h = telemetry()
    expect(() => disableContextualTestNextTelemetry(file, h.loader, { NEXT_TELEMETRY_DISABLED: '0' })).toThrow()
    expect(() => disableContextualTestNextTelemetry(realpathSync(require.resolve('next/package.json')), h.loader, h.env)).toThrow()
    expect(h.loader).not.toHaveBeenCalled()
    expect(() => disableContextualTestNextTelemetry(file, Object.assign(() => h.module.exports, { cache: {} }), h.env)).toThrow()
  })
  it('fails closed if the explicit disabled environment changes after installation', () => {
    const h = telemetry(); disableContextualTestNextTelemetry(file, h.loader, h.env)
    const fixed = new h.module.exports.Telemetry({ distDir: '/cpu/dist' }); h.env.NEXT_TELEMETRY_DISABLED = '0'
    expect(() => fixed.flushDetached('dev', '/cpu/app')).toThrow()
    expect(() => new h.module.exports.Telemetry({ distDir: '/cpu/dist' })).toThrow()
    expect(h.spawn).not.toHaveBeenCalled(); expect(h.write).not.toHaveBeenCalled()
  })
})

describe('installed Next static-path workers with CPU-only fork doubles', () => {
  const jestFile = realpathSync(require.resolve('next/dist/compiled/jest-worker'))
  const processChildPath = join(jestFile.slice(0, jestFile.lastIndexOf('/')), 'processChild.js')
  const staticPathsWorkerPath = realpathSync(require.resolve('next/dist/server/dev/static-paths-worker'))
  const parentEnv = { NEXT_PRIVATE_WORKER: '1', NEXT_DISABLE_MEM_OVERRIDE: '1', NODE_OPTIONS: '--require=/private/guard.cjs --enable-source-maps', PIKA_CONTEXTUAL_TEST_BINDING_FILE: '/private/binding.json', PIKA_CONTEXTUAL_TEST_BINDING_SHA256: 'a'.repeat(64) }
  const cwd = '/private/disposable/app'
  function harness() {
    const children: Array<EventEmitter & { send: (message: unknown, ...rest: unknown[]) => boolean; originalSend: ReturnType<typeof vi.fn<(...args: unknown[]) => boolean>>; stdout: PassThrough; stderr: PassThrough; kill: ReturnType<typeof vi.fn> }> = []
    const note = vi.fn()
    const fork = vi.fn(() => {
      const send = vi.fn((_message: unknown, ..._rest: unknown[]) => true)
      const c = Object.assign(new EventEmitter(), { send, originalSend: send, stdout: new PassThrough(), stderr: new PassThrough(), kill: vi.fn() })
      children.push(c); return c
    })
    const guard = createContextualTestStaticWorkerFork({ processChildPath, staticPathsWorkerPath, parentEnv, parentExecArgv: [], appDir: cwd,
      preloadPath: '/private/guard.cjs', deadline: Date.now() + 120000, ledger: { note }, fork })
    const call = (change: Record<string, unknown> = {}, module = processChildPath, args: unknown[] = []) => guard(module, args, {
      cwd, env: { ...parentEnv }, execArgv: [], silent: true, ...change,
    })
    const payload = { dir: cwd, distDir: join(cwd, '.next'), pathname: '/classrooms/[classroomId]', page: '/classrooms/[classroomId]/page', isAppPath: true }
    const initialize = (c: (typeof children)[number]) => c.send([0, false, staticPathsWorkerPath, []])
    const work = (c: (typeof children)[number]) => c.send([1, true, 'loadStaticPaths', [payload]], () => {})
    const finish = (c: (typeof children)[number]) => { c.emit('message', [0, { prerenderedRoutes: [] }]); c.send([2, false], () => {}); c.emit('exit', 0, null); c.emit('close', 0, null) }
    return { guard, call, children, fork, note, payload, initialize, work, finish }
  }
  it('accepts successive one-shot workers and retains active identity until positive close', () => {
    const h = harness(), first = h.call(); h.initialize(first); h.work(first)
    first.emit('message', [0, { prerenderedRoutes: [] }]); first.send([2, false], () => {}); first.emit('exit', 0, null)
    expect(h.guard.snapshot()).toMatchObject({ launched: 1, active: 1, failed: false })
    first.emit('close', 0, null)
    const second = h.call(); h.initialize(second); h.work(second); h.finish(second)
    expect(h.guard.snapshot()).toMatchObject({ launched: 2, active: 0, failed: false })
    expect(h.note).not.toHaveBeenCalled()
  })
  it('uses the actual installed jest-worker fork and IPC call shapes without any native child', async () => {
    const h = harness(), module = { exports: {} as { Worker: new (file: string, options: unknown) => { loadStaticPaths(value: unknown): Promise<unknown>; end(): Promise<unknown> } } }
    const nativeRequire = (id: string) => {
      if (id === 'child_process') return { fork: h.guard }
      if (id === staticPathsWorkerPath) return { loadStaticPaths: () => {} }
      if (['os','path','stream','tty'].includes(id)) return require(id)
      if (id === 'worker_threads') return { Worker: () => { throw Error('Worker threads forbidden') } }
      throw new Error(`Unapproved CPU dependency: ${id}`)
    }
    vm.runInNewContext(readFileSync(jestFile, 'utf8'), { module, exports: module.exports, require: nativeRequire, __dirname: jestFile.slice(0, jestFile.lastIndexOf('/')),
      process: { env: { ...parentEnv }, cwd: () => cwd, execArgv: [], argv: ['node'], platform: process.platform, stdout: { isTTY: false }, stderr: { isTTY: false } },
      setTimeout, clearTimeout, Buffer, console }, { filename: jestFile, timeout: 1000 })
    const worker = new module.exports.Worker(staticPathsWorkerPath, { numWorkers: 1, maxRetries: 1, enableWorkerThreads: false,
      forkOptions: { env: { ...parentEnv } } })
    const result = worker.loadStaticPaths(h.payload)
    expect(h.fork).toHaveBeenCalledOnce(); expect(h.children[0].originalSend).toHaveBeenCalledTimes(2)
    h.children[0].emit('message', [0, { prerenderedRoutes: [] }]); await result
    const ended = worker.end(); h.children[0].emit('exit', 0, null); h.children[0].emit('close', 0, null); await ended
    expect(h.guard.snapshot()).toMatchObject({ launched: 1, active: 0, failed: false })
  })
  it.each(['env','preload','execArgv','cwd','module','args'] as const)('rejects %s drift before child creation', kind => {
    const h = harness()
    const changes = kind === 'env' ? { env: { ...parentEnv, OPENAI_API_KEY: 'forbidden' } } : kind === 'preload' ? { env: { ...parentEnv, NODE_OPTIONS: '' } }
      : kind === 'execArgv' ? { execArgv: ['--inspect'] } : kind === 'cwd' ? { cwd: '/foreign' } : {}
    expect(() => h.call(changes, kind === 'module' ? staticPathsWorkerPath : processChildPath, kind === 'args' ? ['--other'] : [])).toThrow()
    expect(h.fork).not.toHaveBeenCalled(); expect(h.note).toHaveBeenCalledWith('denied')
  })
  it('rejects foreign work initialization and repeated work in the same child', () => {
    const foreign = harness(), c = foreign.call()
    expect(() => c.send([0, false, '/foreign/module.js', []])).toThrow()
    const repeat = harness(), second = repeat.call(); repeat.initialize(second); repeat.work(second)
    expect(() => repeat.work(second)).toThrow(); expect(repeat.note).toHaveBeenCalledWith('denied')
  })
  it('latches abnormal exit before jest can respawn and rejects extra workers', () => {
    const h = harness(), c = h.call(); h.initialize(c); h.work(c)
    const retry = vi.fn(() => expect(() => h.call()).toThrow())
    c.on('exit', retry); c.emit('exit', 1, null)
    expect(retry).toHaveBeenCalledOnce(); expect(h.fork).toHaveBeenCalledOnce()
    expect(h.guard.snapshot()).toMatchObject({ launched: 1, active: 1, failed: true })
  })
  it('allows at most the existing 1000-request-derived one-shot worker ceiling', () => {
    const h = harness()
    for (let i = 0; i < 1000; i++) { const c = h.call(); h.initialize(c); h.work(c); h.finish(c) }
    expect(h.guard.snapshot()).toMatchObject({ launched: 1000, active: 0, failed: false })
    expect(() => h.call()).toThrow(); expect(h.fork).toHaveBeenCalledTimes(1000)
  })
  it.each(['pathname','dir','distDir','isAppPath','method'] as const)('rejects static work %s drift', field => {
    const h = harness(), c = h.call(); h.initialize(c)
    const work = { ...h.payload, [field]: field === 'isAppPath' ? false : '/foreign' }
    expect(() => c.send([1, true, field === 'method' ? 'otherMethod' : 'loadStaticPaths', [work]])).toThrow()
    expect(h.note).toHaveBeenCalledWith('denied')
  })
  it('closes worker admission at its original operation deadline', () => {
    vi.useFakeTimers()
    try {
      const h = harness(), c = h.call(); h.initialize(c); h.work(c)
      vi.advanceTimersByTime(30000)
      expect(h.note).toHaveBeenCalledWith('uncertain'); expect(() => h.call()).toThrow()
      expect(h.fork).toHaveBeenCalledOnce()
    } finally { vi.useRealTimers() }
  })
  it('the actual preload installer forbids processChild from creating any descendant', () => {
    const nativeFork = vi.fn(), note = vi.fn(), child = { fork: nativeFork }
    const Socket = function () {}; Socket.prototype.connect = () => {}
    const modules: Record<string, unknown> = {
      'node:assert/strict': require('node:assert/strict'), 'node:fs': require('node:fs'), 'node:path': require('node:path'), 'node:crypto': require('node:crypto'),
      'node:net': { Socket, _normalizeArgs: () => [] }, 'node:tls': {}, 'node:http': { request: () => { throw Error('No HTTP in CPU test') } }, 'node:https': {},
      'node:child_process': child, 'node:http2': {}, 'node:worker_threads': {}, 'node:module': { syncBuiltinESMExports() {} },
    }
    const module = { exports: {} as { installContextualTestEgress(options: unknown): unknown } }
    const sourceFile = require.resolve('../../scripts/contextual-test-rehearsal-egress.cjs')
    vm.runInNewContext(readFileSync(sourceFile, 'utf8'), { module, exports: module.exports, require: (id: string) => {
      if (!Object.hasOwn(modules, id)) throw Error('Unapproved CPU require'); return modules[id]
    }, __filename: sourceFile, process: { env: { NEXT_PRIVATE_WORKER: '1' }, argv: ['node', processChildPath], execArgv: [], platform: process.platform },
    setTimeout, clearTimeout, Buffer, console }, { filename: sourceFile, timeout: 1000 })
    module.exports.installContextualTestEgress({ nextServerPath: realpathSync(require.resolve('next/dist/server/lib/start-server')),
      processChildPath, staticPathsWorkerPath, appDir: cwd, deadline: Date.now() + 10000, ledger: { note } })
    expect(() => (child as unknown as { fork(...args: unknown[]): unknown }).fork(processChildPath, [], {})).toThrow()
    expect(() => (child as unknown as { spawn(...args: unknown[]): unknown }).spawn('/unapproved', [])).toThrow()
    expect(note).toHaveBeenCalledWith('denied')
    expect(nativeFork).not.toHaveBeenCalled()
  })
})

describe('bounded original server transports (no network dispatch)', () => {
  it('enforces an absolute HTTP body deadline even with regular data', () => {
    vi.useFakeTimers()
    try {
      const note = vi.fn(), req = Object.assign(new EventEmitter(), { destroy: vi.fn() }), res = new EventEmitter()
      boundContextualTestHttpRequest(req, { deadline: Date.now() + 100000, ledger: { note } })
      req.emit('response', res)
      for (let i = 0; i < 5; i++) { vi.advanceTimersByTime(5000); res.emit('data', Buffer.from('x')) }
      expect(req.destroy).not.toHaveBeenCalled()
      vi.advanceTimersByTime(5000)
      expect(req.destroy).toHaveBeenCalledOnce(); expect(note).toHaveBeenCalledWith('uncertain')
    } finally { vi.useRealTimers() }
  })
  it('retains HTTP size and premature-close failures', () => {
    const note = vi.fn(), req = Object.assign(new EventEmitter(), { destroy: vi.fn() }), res = new EventEmitter()
    boundContextualTestHttpRequest(req, { deadline: Date.now() + 10000, ledger: { note } })
    req.emit('response', res); res.emit('data', Buffer.alloc(1048577)); req.emit('close')
    expect(note).toHaveBeenCalledWith('capExceeded'); expect(note).toHaveBeenCalledWith('uncertain')
  })
  it('does not misclassify a complete HTTP response as uncertain', () => {
    const note = vi.fn(), req = Object.assign(new EventEmitter(), { destroy: vi.fn() }), res = new EventEmitter()
    boundContextualTestHttpRequest(req, { deadline: Date.now() + 10000, ledger: { note } })
    req.emit('response', res); res.emit('data', Buffer.from('{}')); res.emit('end'); req.emit('close')
    expect(note).not.toHaveBeenCalled()
  })
  it('reads the original fetch body and permanently records overflow without raw errors', async () => {
    const note = vi.fn(), original = vi.fn(async (_input: string, _init: RequestInit) => new Response(Buffer.alloc(1048577)))
    const bounded = createContextualTestBoundedFetch(original, { deadline: Date.now() + 10000, ledger: { note } }, { admit: vi.fn(), check: vi.fn() })
    await expect(bounded('http://127.0.0.1:54331/rest/v1/x')).rejects.toThrow('Tests server bounded fetch failed')
    expect(original).toHaveBeenCalledOnce(); expect(note).toHaveBeenCalledWith('capExceeded')
    expect(note).toHaveBeenCalledWith('uncertain')
    expect(original.mock.calls[0][1]).toMatchObject({ redirect: 'error' })
  })
})

describe('Tests server egress allocation', () => {
  it('permits only the exact app and isolated API origins', () => {
    const policy = createContextualTestEgressPolicy({ deadline: Date.now() + 10000 })
    expect(policy.admit('http://localhost:3117/api/auth/me')).toBe('app')
    expect(policy.admit('http://127.0.0.1:54331/rest/v1/users')).toBe('api')
    expect(policy.admit('http://127.0.0.1:54331/storage/v1/object/x')).toBe('storage')
    for (const u of ['https://api.openai.com/v1', 'http://127.0.0.1:54321', 'http://localhost:54331', 'http://localhost:3117@evil.test', 'http://localhost:3117/#x', 'http://127.0.0.1:54331/auth/v1/token', 'http://127.0.0.1:54331/rest/v10/users']) expect(() => policy.admit(u)).toThrow()
  })
  it('enforces the reserved 50 app and 20 Storage server requests', () => {
    const policy = createContextualTestEgressPolicy({ deadline: Date.now() + 10000 })
    for (let i = 0; i < 100; i++) policy.admit('http://127.0.0.1:54331/rest/v1/users')
    expect(policy.counts().app).toBe(0)
    for (let i = 0; i < 50; i++) policy.admit('http://localhost:3117/api/auth/me')
    expect(() => policy.admit('http://localhost:3117/api/auth/me')).toThrow()
    for (let i = 0; i < 20; i++) policy.admit('http://127.0.0.1:54331/storage/v1/object/x')
    expect(() => policy.admit('http://127.0.0.1:54331/storage/v1/object/x')).toThrow()
  })
  it('fails closed on any expiry or unsupported socket', () => {
    const policy = createContextualTestEgressPolicy({ deadline: Date.now() - 1 })
    expect(() => policy.socket({ host: 'localhost', port: 3117 })).toThrow()
    const live = createContextualTestEgressPolicy({ deadline: Date.now() + 10000 })
    expect(() => live.socket({ path: '/var/run/docker.sock' })).toThrow()
    expect(() => live.socket({ host: '169.254.169.254', port: 80 })).toThrow()
    expect(() => live.socket({ host: '127.0.0.1', port: 3117 })).toThrow()
    expect(live.socket({ host: '127.0.0.1', port: 54331 })).toBeUndefined()
  })
  it('allows only the installed Next fork shape with the same preload and hermetic environment', () => {
    const parent = { NEXT_DISABLE_MEM_OVERRIDE: '1', NODE_OPTIONS: '--require=/private/guard.cjs', SESSION_SECRET: 'synthetic' }
    const args = { stdio: 'inherit', env: { ...parent, NEXT_PRIVATE_WORKER: '1', NEXT_PRIVATE_TRACE_ID: 'a'.repeat(16), WATCHPACK_WATCHER_LIMIT: '20', NODE_OPTIONS: `${parent.NODE_OPTIONS} --enable-source-maps` } }
    const call = (overrides: Record<string, unknown> = {}) => validateContextualTestNextFork('/exact/start-server.js', '/exact/start-server.js', { ...args, ...overrides }, undefined, parent, '/private/guard.cjs', 'darwin')
    expect(() => call()).not.toThrow()
    expect(() => call({ env: { ...args.env, OPENAI_API_KEY: 'never-inherit' } })).toThrow()
    expect(() => call({ env: { ...args.env, NODE_OPTIONS: '--inspect' } })).toThrow()
    expect(() => call({ env: { ...args.env, NODE_EXTRA_CA_CERTS: '/unreviewed.pem' } })).toThrow()
    expect(() => call({ args: ['--unreviewed'] })).toThrow()
    expect(() => validateContextualTestNextFork('/exact/start-server.js', '/other/script.js', args, undefined, parent, '/private/guard.cjs', 'darwin')).toThrow()
  })
})

describe('shared Next parent/child request ledger', () => {
  function fixture() {
    const outputDir = realpathSync(mkdtempSync(join(tmpdir(), 'contextual-egress-ledger-cpu-')))
    const binding = { outputDir, nonce: 'a'.repeat(32), deadline: Date.now() + 10000 }
    const ledger = createContextualTestSharedLedger(binding, { create: true })
    return { binding, ledger, close: () => rmSync(outputDir, { recursive: true }) }
  }
  it('shares app and Storage counters across two policy instances without charging REST/RPC as app', () => {
    const f = fixture()
    try {
      const other = createContextualTestSharedLedger(f.binding)
      const parent = createContextualTestEgressPolicy({ ...f.binding, ledger: f.ledger })
      const child = createContextualTestEgressPolicy({ ...f.binding, ledger: other })
      for (let i = 0; i < 150; i++) child.admit('http://127.0.0.1:54331/rest/v1/rpc/private_read')
      for (let i = 0; i < 25; i++) { parent.admit('http://localhost:3117/a'); child.admit('http://localhost:3117/b') }
      expect(other.snapshot()).toMatchObject({ app: 50, storage: 0, api: 150 })
      expect(() => child.admit('http://localhost:3117/51')).toThrow()
      expect(f.ledger.snapshot()).toMatchObject({ app: 50, flags: { capExceeded: true } })
      expect(() => parent.admit('http://127.0.0.1:54331/rest/v1/users')).toThrow()
    } finally { f.close() }
  })
  it('shares exactly twenty Storage operations and never doubles the child allowance', () => {
    const f = fixture()
    try {
      const other = createContextualTestSharedLedger(f.binding)
      for (let i = 0; i < 10; i++) { f.ledger.charge('storage'); other.charge('storage') }
      expect(() => other.charge('storage')).toThrow()
      expect(f.ledger.snapshot()).toMatchObject({ storage: 20, flags: { capExceeded: true } })
    } finally { f.close() }
  })
  it('refuses recreation, nonce/deadline drift and insecure files without overwriting them', () => {
    const f = fixture()
    try {
      const original = readFileSync(f.ledger.paths.ledger, 'utf8')
      expect(() => createContextualTestSharedLedger(f.binding, { create: true })).toThrow()
      expect(() => createContextualTestSharedLedger({ ...f.binding, nonce: 'b'.repeat(32) })).toThrow()
      expect(() => createContextualTestSharedLedger({ ...f.binding, deadline: f.binding.deadline + 1 })).toThrow()
      expect(readFileSync(f.ledger.paths.ledger, 'utf8')).toBe(original)
      chmodSync(f.ledger.paths.ledger, 0o644)
      expect(() => f.ledger.charge('app')).toThrow()
      expect(readFileSync(f.ledger.paths.ledger, 'utf8')).toBe(original)
    } finally { f.close() }
  })
  it('does not adopt an existing lock and leaves a durable uncertainty marker', () => {
    const f = fixture()
    try {
      writeFileSync(f.ledger.paths.lock, 'foreign lock', { mode: 0o600, flag: 'wx' })
      const start = Date.now()
      expect(() => f.ledger.charge('app')).toThrow()
      expect(Date.now() - start).toBeLessThan(500)
      expect(readFileSync(f.ledger.paths.lock, 'utf8')).toBe('foreign lock')
      expect(JSON.parse(readFileSync(f.ledger.paths.poison, 'utf8'))).toMatchObject({ nonce: f.binding.nonce, uncertain: true })
    } finally { f.close() }
  })
  it.each(['replacement','symlink'] as const)('refuses a %s ledger without touching the replacement', kind => {
    const f = fixture()
    try {
      const original = readFileSync(f.ledger.paths.ledger, 'utf8')
      const moved = join(f.binding.outputDir, 'original.json')
      renameSync(f.ledger.paths.ledger, moved)
      if (kind === 'replacement') writeFileSync(f.ledger.paths.ledger, original, { mode: 0o600, flag: 'wx' })
      else symlinkSync(moved, f.ledger.paths.ledger)
      expect(() => f.ledger.charge('app')).toThrow()
      expect(readFileSync(f.ledger.paths.ledger, 'utf8')).toBe(original)
    } finally { f.close() }
  })
  it('retains denial and expiry flags for the final receipt', () => {
    const f = fixture()
    try {
      const policy = createContextualTestEgressPolicy({ ...f.binding, ledger: f.ledger })
      expect(() => policy.admit('https://provider.example.test/')).toThrow()
      expect(f.ledger.snapshot()).toMatchObject({ flags: { denied: true } })
      const expired = createContextualTestEgressPolicy({ deadline: Date.now() - 1, ledger: f.ledger })
      expect(() => expired.admit('http://localhost:3117/a')).toThrow()
      expect(f.ledger.snapshot()).toMatchObject({ flags: { denied: true, expired: true } })
    } finally { f.close() }
  })
})
