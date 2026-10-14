import { createRequire } from 'node:module'
import { describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { mkdtempSync, realpathSync, rmSync, writeFileSync, chmodSync, readFileSync, renameSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const require = createRequire(import.meta.url)
const { createContextualTestEgressPolicy, validateContextualTestNextFork, createContextualTestSharedLedger, boundContextualTestHttpRequest, createContextualTestBoundedFetch } = require('../../scripts/contextual-test-rehearsal-egress.cjs')

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
