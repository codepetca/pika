import { afterEach, describe, expect, it, vi } from 'vitest'
import { execFile } from 'node:child_process'
import * as platform from '../../scripts/contextual-assignment-list-proof-platform'
import { testOwnerListDockerInventory } from '../../scripts/contextual-test-owner-list-proof-inventory'

vi.mock('node:child_process', async importOriginal => ({ ...await importOriginal<typeof import('node:child_process')>(), execFile: vi.fn() }))

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

afterEach(() => { vi.restoreAllMocks(); vi.mocked(execFile).mockReset() })

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
        expect(listArgs.every(list => fixture.calls.includes(key(list)))).toBe(true)
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

  it('waits for every fresh global list before inspection and rejects a failed list without starting inspections', async () => {
    const fixture = globalFixture(1); let release!: () => void
    const held = new Promise<void>(resolve => { release = resolve }); const inspected = vi.fn()
    const run: Run = async (file, args) => {
      if (key(args) === key(listArgs[1])) { await held; throw new Error('PRIVATE delayed invalid listing') }
      if (!listArgs.some(list => key(list) === key(args))) inspected()
      return fixture.run(file, args)
    }
    const pending = testOwnerListDockerInventory(run)
    const rejected = expect(pending).rejects.toThrow('Private Test owner list inventory rejected')
    await new Promise<void>(resolve => setImmediate(resolve))
    const inspectedBeforeRelease = inspected.mock.calls.length
    release(); await rejected
    expect(inspectedBeforeRelease).toBe(0); expect(inspected).not.toHaveBeenCalled()
  })

  it('settles all active inspection workers after failure and does not launch queued batches', async () => {
    const fixture = globalFixture(257); const started: string[] = []; const settled: string[] = []
    let release!: () => void; const held = new Promise<void>(resolve => { release = resolve })
    const run: Run = async (file, args) => {
      if (listArgs.some(list => key(list) === key(args))) return fixture.run(file, args)
      const command = key(args); started.push(command)
      try {
        if (started.length === 1) throw new Error('PRIVATE inspect failure')
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
    await expect(testOwnerListDockerInventory()).rejects.toThrow('Private Test owner list inventory rejected')
    expect(execFile).toHaveBeenCalledTimes(3)
  })

  it('applies the same byte bound to injected command outputs before inspections', async () => {
    const fixture = globalFixture(0)
    const oversized = 'x'.repeat(64 * 1024 * 1024 + 1)
    const run: Run = async (file, args) => key(args) === key(listArgs[0]) ? oversized : fixture.run(file, args)
    await expect(testOwnerListDockerInventory(run)).rejects.toThrow('Private Test owner list inventory rejected')
    expect(fixture.calls.every(command => listArgs.map(key).includes(command))).toBe(true)
  })
})
