import { describe, expect, it, vi } from 'vitest'
import { fallbackMirror, installBrowser } from '../../scripts/ci-install-browser.mjs'

const base = { environment: 'github-hosted', osRelease: 'VERSION_ID="24.04"', sources: 'URIs: mirror+file:/etc/apt/apt-mirrors.txt', mirrors: 'http://azure.archive.ubuntu.com/ubuntu/\tpriority:1\nhttps://archive.ubuntu.com/ubuntu/\tpriority:2\nhttps://security.ubuntu.com/ubuntu/\tpriority:3\n' }
describe('browser dependency mirror fallback', () => {
  it('replaces only the unavailable Azure mirror on the proven hosted image', () => {
    expect(fallbackMirror(base)).toBe('https://archive.ubuntu.com/ubuntu/\tpriority:1\nhttps://archive.ubuntu.com/ubuntu/\tpriority:2\nhttps://security.ubuntu.com/ubuntu/\tpriority:3\n')
  })
  it.each([
    { environment: 'self-hosted' }, { osRelease: 'VERSION_ID="22.04"' }, { sources: 'URIs: http://archive.ubuntu.com/ubuntu' },
    { mirrors: 'http://example.invalid/ubuntu/\n' },
  ])('does not alter unproven environments: %o', change => {
    expect(fallbackMirror({ ...base, ...change })).toBeNull()
  })
  it('does not inspect or alter mirrors when the first install succeeds', () => {
    const install = vi.fn(), plan = vi.fn(), replace = vi.fn(), restore = vi.fn()
    installBrowser({ plan, replace, install, restore })
    expect(install).toHaveBeenCalledOnce()
    expect(plan).not.toHaveBeenCalled()
    expect(replace).not.toHaveBeenCalled()
    expect(restore).not.toHaveBeenCalled()
  })
  it('retries once using the fallback and restores it after success', () => {
    const install = vi.fn().mockImplementationOnce(() => { throw new Error('first failed') }).mockImplementationOnce(() => 'ok')
    const restore = vi.fn(), replace = vi.fn()
    expect(installBrowser({ plan: () => 'replacement', replace, install, restore })).toBe('ok')
    expect(install).toHaveBeenCalledTimes(2)
    expect(replace).toHaveBeenCalledWith('replacement')
    expect(restore).toHaveBeenCalledOnce()
  })
  it('restores the mirror and propagates the retry failure', () => {
    const install = vi.fn().mockImplementationOnce(() => { throw new Error('first failed') }).mockImplementationOnce(() => { throw new Error('retry failed') })
    const restore = vi.fn()
    expect(() => installBrowser({ plan: () => 'replacement', replace: vi.fn(), install, restore })).toThrow('retry failed')
    expect(install).toHaveBeenCalledTimes(2)
    expect(restore).toHaveBeenCalledOnce()
  })
  it('propagates a restoration failure', () => {
    const restore = vi.fn(() => { throw new Error('restore failed') })
    const install = vi.fn().mockImplementationOnce(() => { throw new Error('first failed') }).mockImplementationOnce(() => 'ok')
    expect(() => installBrowser({ plan: () => 'replacement', replace: vi.fn(), install, restore })).toThrow('restore failed')
  })
  it('fails without retry or mutation on a self-hosted runner', () => {
    const replace = vi.fn(), restore = vi.fn(), install = vi.fn(() => { throw new Error('install failed') })
    expect(() => installBrowser({ plan: () => fallbackMirror({ ...base, environment: 'self-hosted' }), replace, install, restore })).toThrow('install failed')
    expect(install).toHaveBeenCalledOnce()
    expect(replace).not.toHaveBeenCalled()
    expect(restore).not.toHaveBeenCalled()
  })
})
