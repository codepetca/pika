import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { createManagedRepoLightRegistry, decryptManagedRepoLightKey, parseManagedRepoLightConfig, parseManagedRepoLightKeyring, prepareManagedRepoLightRecord, type ManagedRepoLightConfig, type ManagedRepoLightRecord, type ManagedRepoLightStore } from '@/lib/server/repolight-managed'
import { createManagedRepoLightDatabase } from '@/lib/server/repolight-managed-database'

const teacher = '11111111-1111-4111-8111-111111111111', other = '22222222-2222-4222-8222-222222222222'
const key = Buffer.alloc(32, 1).toString('base64url'), control = Buffer.alloc(32, 2).toString('base64url')
const config = (): ManagedRepoLightConfig => ({ enabled: true, apiOrigin: 'https://reports.example.test', installationRef: 'pika-installation', controlSecret: control, activeEncryptionKeyId: 'key-1', encryptionKeys: { 'key-1': key } })
const json = (value: unknown) => new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } })
function fixture() {
  let eligible = true
  const rows: ManagedRepoLightRecord[] = []
  const store: ManagedRepoLightStore = {
    access: vi.fn(async () => ({ enforced: false, allowed: eligible })),
    read: vi.fn(async (id, ref) => rows.find(row => row.teacherId === id && (ref ? row.connectionRef === ref : row.state === 'pending')) ?? rows.find(row => row.teacherId === id && row.state === 'ready') ?? null),
    prepare: vi.fn(async candidate => { const previous = rows.find(row => row.teacherId === candidate.teacherId && row.state !== 'retired'); if (previous) return previous; rows.push(candidate); return candidate }),
    prepareRotation: vi.fn(async candidate => { const pending = rows.find(row => row.teacherId === candidate.teacherId && row.state === 'pending'); if (pending) return pending; rows.push(candidate); return candidate }),
    activate: vi.fn(async (expected, workspaceRef) => {
      if (expected.operationKind === 'provision' && !eligible) throw new Error('denied')
      const row = rows.find(row => row.operationRef === expected.operationRef)!
      if (row.operationKind === 'rotate') for (const old of rows) if (old.teacherId === row.teacherId && old.state === 'ready') old.state = 'retired'
      row.state = 'ready'; row.workspaceRef = workspaceRef; return { ...row }
    }),
  }
  const requests: { url: string; body?: string; authorization: string }[] = []
  const fetchImpl = vi.fn(async (input: unknown, init?: RequestInit) => {
    const url = String(input), authorization = (init?.headers as Record<string, string>).Authorization
    requests.push({ url, body: init?.body as string | undefined, authorization })
    if (url.endsWith('/connection')) return json({ schemaVersion: '1.0', workspaceRef: 'workspace-1', installationRef: 'pika-installation', scopes: ['analyses:create', 'analyses:read', 'analyses:erase'] })
    const body = JSON.parse(init!.body as string)
    return json({ schemaVersion: '1.0', workspaceRef: 'workspace-1', installationRef: 'pika-installation', keyId: body.keyId })
  }) as unknown as typeof fetch
  const registry = createManagedRepoLightRegistry(store, { config, fetchImpl })
  return { store, rows, requests, fetchImpl, registry, eligibility: (value: boolean) => { eligible = value } }
}
describe('managed RepoLight credentials', () => {
  it('uses canonical random256 secrets, encrypted authenticated storage and opaque tenants', () => {
    const row = prepareManagedRepoLightRecord(teacher, config()), token = decryptManagedRepoLightKey(row, config()), secret = token.split('.')[1]
    expect(token).toMatch(/^rl_v2_[a-f0-9-]{36}\.[A-Za-z0-9_-]{43}$/)
    expect(createHash('sha256').update(secret).digest('hex')).toBe(row.secretHash)
    expect(JSON.stringify(row)).not.toContain(secret)
    expect(row.tenantRef).not.toContain(teacher)
    for (const changed of [{ teacherId: other }, { tenantRef: 'foreign' }, { keyId: other }, { installationRef: 'foreign' }, { apiOrigin: 'https://foreign.test' }, { secretHash: '0'.repeat(64) }]) {
      expect(() => decryptManagedRepoLightKey({ ...row, ...changed }, config())).toThrow('Managed repository reports are unavailable.')
    }
    expect(() => decryptManagedRepoLightKey(row, { ...config(), encryptionKeys: {} })).toThrow()
  })
  it('parses dedicated keyring and rejects unsafe origins and noncanonical key bytes without reflecting secrets', () => {
    const env = { PIKA_REPOLIGHT_MANAGED_ENABLED: 'true', REPOLIGHT_API_URL: config().apiOrigin, REPOLIGHT_MANAGED_INSTALLATION_REF: config().installationRef, REPOLIGHT_MANAGED_CONTROL_SECRET: control, REPOLIGHT_MANAGED_ACTIVE_ENCRYPTION_KEY_ID: 'key-1', REPOLIGHT_MANAGED_ENCRYPTION_KEYS_JSON: JSON.stringify({ 'key-1': key }) }
    expect(parseManagedRepoLightConfig(env)).toEqual(config())
    for (const changed of [{ REPOLIGHT_API_URL: 'https://a:b@reports.example.test' }, { REPOLIGHT_API_URL: 'http://reports.example.test' }, { REPOLIGHT_MANAGED_CONTROL_SECRET: 'x'.repeat(43) }, { REPOLIGHT_MANAGED_ENCRYPTION_KEYS_JSON: '{}' }, { PIKA_REPOLIGHT_MANAGED_ENABLED: 'TRUE' }]) {
      expect(() => parseManagedRepoLightConfig({ ...env, ...changed })).toThrow('Managed repository reports are unavailable.')
    }
  })
  it('parses retained encryption keys without control credentials, origin, or installation configuration', () => {
    expect(parseManagedRepoLightKeyring({ REPOLIGHT_MANAGED_ACTIVE_ENCRYPTION_KEY_ID: 'key-1', REPOLIGHT_MANAGED_ENCRYPTION_KEYS_JSON: JSON.stringify({ 'key-1': key }) }))
      .toEqual({ activeEncryptionKeyId: 'key-1', encryptionKeys: { 'key-1': key } })
    expect(() => parseManagedRepoLightKeyring({ REPOLIGHT_MANAGED_ACTIVE_ENCRYPTION_KEY_ID: 'missing', REPOLIGHT_MANAGED_ENCRYPTION_KEYS_JSON: JSON.stringify({ 'key-1': key }) })).toThrow()
  })
  it('persists before egress and sends only strict provision hash fields then attests before activating', async () => {
    const f = fixture(), result = await f.registry.ensure(teacher), row = f.rows[0]
    expect(f.store.prepare).toHaveBeenCalledOnce(); expect(f.store.activate).toHaveBeenCalledOnce()
    expect(f.requests[0].url).toBe(config().apiOrigin + '/api/v2/managed/provision')
    const body = JSON.parse(f.requests[0].body!)
    expect(Object.keys(body).sort()).toEqual(['keyId', 'operationRef', 'schemaVersion', 'secretHash', 'tenantRef'])
    expect(f.requests[0].authorization).toBe(`Bearer ${control}`)
    expect(f.requests[0].body).not.toContain(result.connection.apiKey)
    expect(f.requests[1].authorization).toBe(`Bearer ${result.connection.apiKey}`)
    expect(result.connection.connectionRef).toBe(row.connectionRef)
    await f.registry.ensure(teacher)
    expect(f.requests).toHaveLength(2)
  })
  it('replays the same saved identity after an unknown provisioning outcome', async () => {
    const f = fixture(), original = f.fetchImpl
    let first = true
    const fetchImpl = vi.fn(async (...args: Parameters<typeof fetch>) => { if (first) { first = false; await original(...args); throw new Error('unknown secret upstream body') }; return original(...args) }) as typeof fetch
    const registry = createManagedRepoLightRegistry(f.store, { config, fetchImpl })
    await expect(registry.ensure(teacher)).rejects.toMatchObject({ code: 'repolight_managed_unavailable' })
    expect(f.rows[0].state).toBe('pending')
    await registry.ensure(teacher)
    expect(f.requests[0].body).toBe(f.requests[1].body)
    expect(f.store.prepare).toHaveBeenCalledOnce()
  })
  it('requires allowed independently of the dormant enforcement flag and makes no external calls when denied', async () => {
    const f = fixture(); f.eligibility(false)
    await expect(f.registry.ensure(teacher)).rejects.toMatchObject({ code: 'repolight_managed_ineligible' })
    expect(f.requests).toHaveLength(0); expect(f.rows).toHaveLength(0)
  })
  it('rechecks delayed response entitlement before activation', async () => {
    const f = fixture(), original = f.fetchImpl
    const registry = createManagedRepoLightRegistry(f.store, { config, fetchImpl: (async (...args: Parameters<typeof fetch>) => { const result = await original(...args); f.eligibility(false); return result }) as typeof fetch })
    await expect(registry.ensure(teacher)).rejects.toMatchObject({ code: 'repolight_managed_ineligible' })
    expect(f.rows[0].state).toBe('pending'); expect(f.store.activate).not.toHaveBeenCalled()
  })
  it('preserves a pending operation rather than sending it to a changed host', async () => {
    const f = fixture(); f.rows.push(prepareManagedRepoLightRecord(teacher, config()))
    const registry = createManagedRepoLightRegistry(f.store, { config: () => ({ ...config(), apiOrigin: 'https://new.example.test' }), fetchImpl: f.fetchImpl })
    await expect(registry.ensure(teacher)).rejects.toMatchObject({ code: 'repolight_managed_configuration_changed' })
    expect(f.requests).toHaveLength(0)
  })
  it('rejects a foreign saved owner before egress', async () => {
    const f = fixture(); f.store.read = vi.fn(async () => prepareManagedRepoLightRecord(other, config()))
    const registry = createManagedRepoLightRegistry(f.store, { config, fetchImpl: f.fetchImpl })
    await expect(registry.ensure(teacher)).rejects.toMatchObject({ code: 'repolight_managed_invalid_storage' }); expect(f.requests).toHaveLength(0)
  })
  it.each(['wrong-key', 'wrong-installation', 'extra', 'html', 'oversize', 'connection-mismatch'])('rejects invalid provision/attestation response %s without activation', async kind => {
    const f = fixture(), row = prepareManagedRepoLightRecord(teacher, config()); f.rows.push(row)
    const registry = createManagedRepoLightRegistry(f.store, { config, fetchImpl: (async input => {
      if (String(input).endsWith('/connection')) return json({ schemaVersion: '1.0', workspaceRef: 'foreign', installationRef: row.installationRef, scopes: ['analyses:create', 'analyses:read', 'analyses:erase'] })
      if (kind === 'html') return new Response('<html>secret</html>', { headers: { 'content-type': 'text/html' } })
      if (kind === 'oversize') return new Response(' '.repeat(8193), { headers: { 'content-type': 'application/json' } })
      return json({ schemaVersion: '1.0', workspaceRef: 'workspace-1', installationRef: kind === 'wrong-installation' ? 'foreign' : row.installationRef, keyId: kind === 'wrong-key' ? other : row.keyId, ...(kind === 'extra' ? { key: 'do not log' } : {}) })
    }) as typeof fetch })
    await expect(registry.ensure(teacher)).rejects.toThrow(); expect(f.store.activate).not.toHaveBeenCalled()
  })
  it('bounds a hung request and retains its exact pending operation', async () => {
    const f = fixture(), registry = createManagedRepoLightRegistry(f.store, { config, timeoutMs: 5, fetchImpl: (() => new Promise(() => {})) as typeof fetch })
    await expect(registry.ensure(teacher)).rejects.toMatchObject({ code: 'repolight_managed_timeout', retryable: true })
    expect(f.rows[0].state).toBe('pending')
  })
  it('rotates with persisted expectedKeyId, retains history, and resolves an old report locator with the new key after downgrade', async () => {
    const f = fixture(), first = await f.registry.ensure(teacher), old = { ...f.rows[0] }; f.eligibility(false)
    const rotated = await f.registry.rotate(teacher), request = f.requests.find(entry => entry.url.endsWith('/rotate'))!
    expect(JSON.parse(request.body!)).toMatchObject({ expectedKeyId: old.keyId, tenantRef: old.tenantRef })
    expect(f.rows).toHaveLength(2); expect(f.rows[0].state).toBe('retired'); expect(f.rows[1].state).toBe('ready')
    expect(rotated.connection.apiKey).not.toBe(first.connection.apiKey)
    const disabled = createManagedRepoLightRegistry(f.store, { config: () => { throw new Error('control credentials removed') }, keyring: config })
    const saved = await disabled.resolveSaved(teacher, old.connectionRef)
    expect(saved.connection.connectionRef).toBe(old.connectionRef)
    expect(saved.connection.apiKey).toBe(rotated.connection.apiKey)
    expect(saved.connection.workspaceRef).toBe(first.connection.workspaceRef)
    await expect(f.registry.ensure(teacher)).rejects.toMatchObject({ code: 'repolight_managed_ineligible' })
  })
  it('retries an uncertain rotation with identical bytes and blocks old-key lookup while rotation is pending', async () => {
    const f = fixture(), first = await f.registry.ensure(teacher), original = f.fetchImpl
    let fail = true
    const registry = createManagedRepoLightRegistry(f.store, { config, fetchImpl: (async (...args: Parameters<typeof fetch>) => { const response = await original(...args); if (String(args[0]).endsWith('/rotate') && fail) { fail = false; throw new Error('uncertain') }; return response }) as typeof fetch })
    await expect(registry.rotate(teacher)).rejects.toThrow()
    await expect(registry.resolveSaved(teacher, first.connection.connectionRef)).rejects.toMatchObject({ code: 'repolight_managed_pending' })
    await registry.rotate(teacher)
    const attempts = f.requests.filter(entry => entry.url.endsWith('/rotate'))
    expect(attempts).toHaveLength(2); expect(attempts[0].body).toBe(attempts[1].body)
  })
  it('maps database failure to a safe category without exposing provider or storage details', async () => {
    const call = vi.fn(async () => ({ data: null, error: { code: '42501', message: 'secret upstream details' } }))
    await expect(createManagedRepoLightDatabase(call).access(teacher)).rejects.toMatchObject({ code: 'repolight_managed_ineligible' })
  })
})
