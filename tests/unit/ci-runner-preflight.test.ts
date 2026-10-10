import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { preflightCiRunner, validateCiWorkspace, validateCiDockerInventory } from '../../scripts/ci-runner-preflight.mjs'

const mocks = vi.hoisted(() => ({ workspace: vi.fn(), docker: vi.fn(), server: vi.fn(), ports: [] as number[], blockedPort: 0 }))
vi.mock('node:fs', () => ({ readdirSync: mocks.workspace }))
vi.mock('node:child_process', () => ({ execFileSync: mocks.docker }))
vi.mock('node:net', () => ({ createServer: mocks.server }))

describe('SDK shard full runner preflight without Docker or sockets', () => {
  beforeEach(() => {
    vi.stubGlobal('process', { ...process, platform: 'linux', env: {} })
    mocks.workspace.mockReset().mockReturnValue(['.env.example', 'package.json'])
    mocks.docker.mockReset().mockReturnValue('')
    mocks.ports.length = 0
    mocks.blockedPort = 0
    mocks.server.mockReset().mockImplementation(() => {
      let error: (() => void) | undefined
      const server = {
        once: vi.fn((_event: string, callback: () => void) => { error = callback; return server }),
        listen: vi.fn(({ port }: { port: number }, callback: () => void) => {
          mocks.ports.push(port)
          if (port === mocks.blockedPort) error?.()
          else callback()
          return server
        }),
        close: vi.fn((callback: () => void) => callback()),
      }
      return server
    })
  })
  afterEach(() => vi.unstubAllGlobals())

  it.each(['database-lifecycle', 'test-owner-sdk', 'test-owner-sdk-lifecycle', 'browser-dark'])('requires the complete inventory and canonical/sibling port checks for %s', async lane => {
    await expect(preflightCiRunner(lane)).resolves.toBeUndefined()
    expect(mocks.docker.mock.calls.map(([binary, args]) => [binary, args])).toEqual([
      ['docker', ['ps', '-aq']], ['docker', ['volume', 'ls', '-q']],
      ['docker', ['network', 'ls', '--filter', 'type=custom', '--format', '{{.ID}}']],
    ])
    expect(mocks.ports).toEqual([3000, 54320, 54321, 54322, 54323, 54324, 54327, 54329, 54331, 54332, 54340])
  })

  it.each(['database-lifecycle', 'test-owner-sdk', 'test-owner-sdk-lifecycle', 'browser-dark'])('refuses %s credentials before inspecting the daemon', async lane => {
    mocks.workspace.mockReturnValue(['.env.local'])
    await expect(preflightCiRunner(lane)).rejects.toThrow('environment file')
    expect(mocks.docker).not.toHaveBeenCalled()
  })

  it.each(['database-lifecycle', 'test-owner-sdk', 'test-owner-sdk-lifecycle', 'browser-dark'].flatMap(lane => [0, 1, 2].map(kind => [lane, kind] as const)))('refuses %s existing inventory kind %s without cleanup', async (lane, kind) => {
    for (let index = 0; index < 3; index++) mocks.docker.mockReturnValueOnce(index === kind ? 'existing-resource' : '')
    await expect(preflightCiRunner(lane)).rejects.toThrow('dedicated empty Docker daemon')
    expect(mocks.docker).toHaveBeenCalledTimes(3)
    expect(mocks.server).not.toHaveBeenCalled()
  })

  it.each(['database-lifecycle', 'test-owner-sdk', 'test-owner-sdk-lifecycle', 'browser-dark'])('refuses %s uninspectable daemon without attempting cleanup', async lane => {
    mocks.docker.mockImplementation(() => { throw new Error('private daemon diagnostic') })
    await expect(preflightCiRunner(lane)).rejects.toThrow('no cleanup was attempted')
    expect(mocks.docker).toHaveBeenCalledTimes(1)
    expect(mocks.server).not.toHaveBeenCalled()
  })

  it.each(['database-lifecycle', 'test-owner-sdk', 'test-owner-sdk-lifecycle', 'browser-dark'])('refuses %s busy sibling proof port', async lane => {
    mocks.blockedPort = 54331
    await expect(preflightCiRunner(lane)).rejects.toThrow('unused loopback port 54331')
  })

  it('requires Linux for SDK execution and rejects unknown lanes', async () => {
    vi.stubGlobal('process', { ...process, platform: 'darwin', env: {} })
    await expect(preflightCiRunner('test-owner-sdk')).rejects.toThrow('isolated Linux VM')
    await expect(preflightCiRunner('test-owner-sdk-lifecycle')).rejects.toThrow('isolated Linux VM')
    await expect(preflightCiRunner('browser-dark')).rejects.toThrow('isolated Linux VM')
    await expect(preflightCiRunner('unknown')).rejects.toThrow('Unknown CI lane')
    expect(mocks.docker).not.toHaveBeenCalled()
  })
})

describe('CI runner isolation', () => {
  it('allows the tracked example environment but refuses local credentials', () => {
    expect(() => validateCiWorkspace(['.env.example', 'package.json'])).not.toThrow()
    for (const name of ['.env', '.env.local', '.env.production', '.env.test']) {
      expect(() => validateCiWorkspace(['.env.example', name])).toThrow(/environment/)
    }
  })
  it('refuses existing resources before any stack startup or cleanup', () => {
    expect(() => validateCiDockerInventory({ containers: '', volumes: '', networks: '' })).not.toThrow()
    for (const kind of ['containers', 'volumes', 'networks']) {
      expect(() => validateCiDockerInventory({ containers: '', volumes: '', networks: '', [kind]: 'existing' })).toThrow(/dedicated/)
    }
  })
})
