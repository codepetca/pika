import { describe, expect, it, vi } from 'vitest'
import { fallbackMirror, installBrowser } from '../../scripts/ci-install-browser.mjs'

const base = { environment: 'github-hosted', osRelease: 'VERSION_ID="24.04"', sources: 'URIs: mirror+file:/etc/apt/apt-mirrors.txt', mirrors: 'http://azure.archive.ubuntu.com/ubuntu/\nhttp://security.ubuntu.com/ubuntu/\n', azureResolvable: false, officialResolvable: true }
describe('browser dependency mirror fallback', () => {
  it('replaces only the unavailable Azure mirror on the proven hosted image', () => {
    expect(fallbackMirror(base)).toBe('http://archive.ubuntu.com/ubuntu/\nhttp://security.ubuntu.com/ubuntu/\n')
  })
  it.each([
    { environment: 'self-hosted' }, { osRelease: 'VERSION_ID="22.04"' }, { sources: 'URIs: http://archive.ubuntu.com/ubuntu' },
    { mirrors: 'http://example.invalid/ubuntu/\n' }, { azureResolvable: true }, { officialResolvable: false },
  ])('does not alter unproven environments: %o', change => {
    expect(fallbackMirror({ ...base, ...change })).toBeNull()
  })
  it('restores the mirror on install failure and propagates the failure', () => {
    const install = vi.fn(() => { throw new Error('install failed') })
    const restore = vi.fn(), replace = vi.fn()
    expect(() => installBrowser({ plan: () => 'replacement', replace, install, restore })).toThrow('install failed')
    expect(replace).toHaveBeenCalledWith('replacement')
    expect(restore).toHaveBeenCalledOnce()
  })
  it('restores after a successful install and fails if restoration fails', () => {
    const restore = vi.fn(() => { throw new Error('restore failed') })
    expect(() => installBrowser({ plan: () => 'replacement', replace: vi.fn(), install: vi.fn(), restore })).toThrow('restore failed')
    expect(restore).toHaveBeenCalledOnce()
  })
  it('never writes without a fallback and still runs the install', () => {
    const replace = vi.fn(), restore = vi.fn(), install = vi.fn()
    installBrowser({ plan: () => null, replace, install, restore })
    expect(install).toHaveBeenCalledOnce()
    expect(replace).not.toHaveBeenCalled()
    expect(restore).not.toHaveBeenCalled()
  })
})
