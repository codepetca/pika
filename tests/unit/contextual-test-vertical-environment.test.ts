import { describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { runInNewContext } from 'node:vm'
import { contextualTestVerticalProfile, contextualTestVerticalCommands, contextualTestVerticalNetworkProbe } from '../../scripts/contextual-test-vertical-environment'

describe('narrow Test environment boundary', () => {
  it('confines app egress to its API gateway and inbound to its private listener', () => {
    const p = contextualTestVerticalProfile('app', ['/private/dependencies'], '/private/fixture', '/private/evidence')
    expect(p).toContain('(deny network*)')
    expect(p).toContain('(remote tcp4 "localhost:54340")')
    expect(p).toContain('(local tcp4 "localhost:3118")')
    expect(p).not.toMatch(/\((?:remote|local) tcp /)
    expect(p).not.toContain('54331'); expect(p).not.toContain('54322')
    expect(p).toContain('(deny file-write* (subpath "/private/dependencies"))')
  })
  it('gives the browser only the public gateway, never database or Docker access', () => {
    const p = contextualTestVerticalProfile('browser', ['/private/dependencies'], '/private/fixture', '/private/evidence')
    expect(p).toContain('(remote tcp4 "localhost:3117")')
    expect(p).not.toMatch(/\((?:remote|local) tcp /)
    expect(p).not.toContain('54340'); expect(p).not.toContain('3118')
    expect(p).toContain('(local unix-socket (subpath "/private/fixture/tmp"))')
    expect(p).toContain('(remote unix-socket (subpath "/private/fixture/tmp"))')
    expect(p).not.toContain('(remote unix-socket)')
    expect(p).not.toContain('(local unix-socket)')
    expect(p).not.toContain('(subpath "/private/tmp")')
    expect(contextualTestVerticalProfile('app', ['/private/dependencies'], '/private/fixture', '/private/evidence')).not.toContain('unix-socket')
  })
  it('does not grant IPC outside this exact attempt or accept broad working directories', () => {
    const p = contextualTestVerticalProfile('browser', ['/private/dependencies'], '/private/fixture', '/private/evidence')
    expect(p.match(/unix-socket/g)).toHaveLength(2)
    expect(p).not.toContain('/private/evidence/tmp')
    for (const root of ['/', '/Users', '/private/tmp', '/private/../private/target', '/private/target\n']) {
      expect(() => contextualTestVerticalProfile('browser', ['/private/dependencies'], root, '/private/evidence')).toThrow()
    }
  })
  it('does not load framework interception into either ordinary process', () => {
    const commands = contextualTestVerticalCommands('/private/runner', '/private/dependencies')
    expect(commands.app).toEqual(['/private/runner/scripts/contextual-test-vertical-app.cjs', '/private/dependencies/next'])
    expect(commands.runner.join(' ')).not.toMatch(/preload|redirect-guard|--require/)
    expect(commands.runner).toContain('contextual-test-vertical.spec.ts')
  })
  it('rejects profile injection and broad filesystem roots', () => {
    for (const root of ['/', '/Users', '/private/tmp', '/private/../private/target', '/private/target\n']) {
      expect(() => contextualTestVerticalProfile('app', [root], '/private/fixture', '/private/evidence')).toThrow()
    }
  })
})

describe('generated network denial probe (fake I/O only)', () => {
  async function run(role: 'app' | 'browser', code = 'EPERM', childCode = code, childCloseDelay = 0) {
    const targets: Array<{ child: boolean; kind: string; target: unknown }> = [], outputs: string[] = []
    let spawned = 0, payloads = 0
    function execute(source: string, child: boolean): Promise<{ output: string; exitCode: number }> {
      const proc = { execPath: '/pinned/node', exitCode: 0, stdout: { write(text: string) { if (child) childOutput += text; else outputs.push(text) } } }
      let childOutput = ''
      class Socket extends EventEmitter {
        closed = false
        connect(...args: unknown[]) {
          targets.push({ child, kind: this instanceof Datagram ? 'udp' : 'tcp', target: args.length > 1 ? args.slice(0, 2) : args[0] })
          const errorCode = child ? childCode : code
          if (errorCode !== 'NO_EVENT') queueMicrotask(() => this.emit('error', { code: errorCode }))
          return this
        }
        destroy() { if (!this.closed) { this.closed = true; queueMicrotask(() => this.emit('close')) }; return this }
        close() { this.destroy() }
        send() { payloads++ }
        write() { payloads++ }
      }
      class Datagram extends Socket {}
      const requireBuiltin = (name: string) => {
        if (name === 'node:net') return { Socket }
        if (name === 'node:dgram') return { createSocket: () => new Datagram() }
        if (name === 'node:child_process') return { spawn(_path: string, args: string[], options: unknown) {
          expect(child).toBe(false); expect(args[0]).toBe('-e'); expect(options).toMatchObject({ env: { NODE_ENV: 'test' }, stdio: ['ignore','pipe','ignore'] })
          spawned++
          const emitter = Object.assign(new EventEmitter(), { stdout: new EventEmitter() })
          void execute(args[1], true).then(result => {
            emitter.stdout.emit('data', result.output)
            if (childCloseDelay) setTimeout(() => emitter.emit('close', result.exitCode, null), childCloseDelay)
            else emitter.emit('close', result.exitCode, null)
          })
          return emitter
        } }
        throw Error(`Unexpected built-in ${name}`)
      }
      return Promise.resolve(runInNewContext(source, { require: requireBuiltin, process: proc, Date, setTimeout, clearTimeout, Buffer }))
        .then(() => ({ output: childOutput, exitCode: proc.exitCode }))
    }
    await execute(contextualTestVerticalNetworkProbe(role, '/private/docker.sock'), false)
    return { targets, outputs, spawned, payloads }
  }
  it.each(['app','browser'] as const)('checks every forbidden destination in %s and its one inherited child', async role => {
    const result = await run(role)
    expect(result.spawned).toBe(1); expect(result.payloads).toBe(0)
    expect(result.outputs).toEqual(['vertical-network-denied-v1'])
    for (const child of [false, true]) {
      const targets = result.targets.filter(row => row.child === child)
      for (const host of ['127.0.0.1', '::1']) for (const port of [54321,54322,54331,54332,role === 'browser' ? 3118 : 3117]) {
        expect(targets).toContainEqual({ child, kind: 'tcp', target: { host, port } })
      }
      for (const host of ['::1', '::ffff:127.0.0.1']) {
        expect(targets).toContainEqual({ child, kind: 'tcp', target: { host, port: role === 'browser' ? 3117 : 54340 } })
      }
      expect(targets).toHaveLength(16)
      expect(targets).toContainEqual({ child, kind: 'tcp', target: { host: '192.0.2.1', port: 80 } })
      expect(targets).toContainEqual({ child, kind: 'tcp', target: { path: '/private/docker.sock' } })
      expect(targets.filter(row => row.kind === 'udp')).toHaveLength(2)
    }
  })
  it('accepts EACCES but rejects ECONNREFUSED and child-only failures', async () => {
    expect((await run('browser', 'EACCES')).outputs).toEqual(['vertical-network-denied-v1'])
    expect((await run('browser', 'ECONNREFUSED')).outputs).toEqual([])
    expect((await run('browser', 'EPERM', 'ECONNREFUSED')).outputs).toEqual([])
  })
  it('waits for child close even after its success token arrives', async () => {
    vi.useFakeTimers()
    try {
      let completed = false
      const pending = run('browser', 'EPERM', 'EPERM', 50).then(result => { completed = true; return result })
      await vi.advanceTimersByTimeAsync(0)
      expect(completed).toBe(false)
      await vi.advanceTimersByTimeAsync(50)
      expect((await pending).outputs).toEqual(['vertical-network-denied-v1'])
      expect(vi.getTimerCount()).toBe(0)
    } finally { vi.useRealTimers() }
  })
  it('closes silent sockets at the 7s shared work deadline and never prints success', async () => {
    vi.useFakeTimers()
    try {
      const pending = run('app', 'NO_EVENT')
      await vi.advanceTimersByTimeAsync(7000)
      expect((await pending).outputs).toEqual([])
      expect(vi.getTimerCount()).toBe(0)
    } finally { vi.useRealTimers() }
  })
  it('rejects a late child close without signaling any PID or forcing process exit', async () => {
    vi.useFakeTimers()
    try {
      const pending = run('app', 'EPERM', 'EPERM', 9000)
      await vi.advanceTimersByTimeAsync(9000)
      expect((await pending).outputs).toEqual([])
      expect(vi.getTimerCount()).toBe(0)
      const source = contextualTestVerticalNetworkProbe('app', '/private/docker.sock')
      expect(source).not.toMatch(/\.kill\(|process\.exit\(|__name|__require/)
      expect(source).toContain('.catch(() => { process.exitCode = 1 })')
    } finally { vi.useRealTimers() }
  })
  it('rejects invalid roles and Docker socket paths without generating executable source', () => {
    expect(() => contextualTestVerticalNetworkProbe('other' as never, '/private/docker.sock')).toThrow()
    for (const path of ['/', 'relative.sock', '/private/../docker.sock', '/private/a\n.sock']) {
      expect(() => contextualTestVerticalNetworkProbe('app', path)).toThrow()
    }
  })
})
