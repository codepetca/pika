import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto'
import { z } from 'zod'
import { createRepoLightClient, canonicalRepoLightJson } from './repolight-client'
import { parseRepoLightConfig, type RepoLightConnection } from './repolight-config'

const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
const ref = z.string().regex(/^[A-Za-z0-9._~-]{1,128}$/)
const keyBytes = z.string().regex(/^[A-Za-z0-9_-]{43}$/).refine(value => Buffer.from(value, 'base64url').toString('base64url') === value)
const encryptedSchema = z.object({ version: z.literal(1), keyId: ref, iv: z.string().regex(/^[A-Za-z0-9_-]{16}$/), tag: z.string().regex(/^[A-Za-z0-9_-]{22}$/), ciphertext: z.string().min(1).max(512).regex(/^[A-Za-z0-9_-]+$/) }).strict()
export const managedRepoLightRecordSchema = z.object({
  teacherId: uuid, tenantRef: ref, operationRef: uuid, keyId: uuid, secretHash: z.string().regex(/^[a-f0-9]{64}$/),
  connectionRef: ref, apiOrigin: z.string(), installationRef: ref, encryptedKey: encryptedSchema,
  operationKind: z.enum(['provision', 'rotate']), expectedKeyId: uuid.nullable(),
  state: z.enum(['pending', 'ready', 'retired']), workspaceRef: ref.nullable(),
}).strict().refine(row => ((row.operationKind === 'provision' && row.state === 'pending') === (row.workspaceRef === null))
  && (row.operationKind === 'rotate') === (row.expectedKeyId !== null)
  && (row.operationKind !== 'rotate' || row.workspaceRef !== null))
export type ManagedRepoLightRecord = z.infer<typeof managedRepoLightRecordSchema>
export type ManagedRepoLightConfig = {
  enabled: boolean; apiOrigin: string; installationRef: string; controlSecret: string;
  activeEncryptionKeyId: string; encryptionKeys: Record<string, string>
}
export type ManagedRepoLightKeyring = Pick<ManagedRepoLightConfig, 'activeEncryptionKeyId' | 'encryptionKeys'>
export class ManagedRepoLightError extends Error {
  constructor(readonly code: string, readonly retryable = false) { super('Managed repository reports are unavailable.'); this.name = 'ManagedRepoLightError' }
}
const failure = (code: string, retryable = false) => new ManagedRepoLightError(code, retryable)

/** Saved report/cleanup credentials need only retained encryption keys, not
 * provisioning control credentials or the current service installation. */
export function parseManagedRepoLightKeyring(env: Record<string, string | undefined> = process.env): ManagedRepoLightKeyring {
  try {
    const activeEncryptionKeyId = ref.parse(env.REPOLIGHT_MANAGED_ACTIVE_ENCRYPTION_KEY_ID)
    const raw = env.REPOLIGHT_MANAGED_ENCRYPTION_KEYS_JSON ?? '{}'
    if (Buffer.byteLength(raw) > 16384) throw new Error()
    const encryptionKeys = z.record(ref, keyBytes).parse(JSON.parse(raw))
    if (!Object.hasOwn(encryptionKeys, activeEncryptionKeyId) || Object.keys(encryptionKeys).length > 20) throw new Error()
    return { activeEncryptionKeyId, encryptionKeys }
  } catch { throw failure('repolight_managed_not_configured') }
}

export function parseManagedRepoLightConfig(env: Record<string, string | undefined> = process.env): ManagedRepoLightConfig {
  try {
    const enabled = env.PIKA_REPOLIGHT_MANAGED_ENABLED ?? 'false'
    if (!['true', 'false'].includes(enabled)) throw new Error()
    const apiOrigin = parseRepoLightConfig({ NODE_ENV: env.NODE_ENV, REPOLIGHT_API_URL: env.REPOLIGHT_API_URL }).apiOrigin
    const installationRef = ref.parse(env.REPOLIGHT_MANAGED_INSTALLATION_REF)
    const controlSecret = keyBytes.parse(env.REPOLIGHT_MANAGED_CONTROL_SECRET)
    const keyring = parseManagedRepoLightKeyring(env)
    if (!apiOrigin) throw new Error()
    return { enabled: enabled === 'true', apiOrigin, installationRef, controlSecret, ...keyring }
  } catch { throw failure('repolight_managed_not_configured') }
}

type KeyBinding = Omit<ManagedRepoLightRecord, 'encryptedKey' | 'state' | 'workspaceRef'>
function aad(row: KeyBinding) {
  const { teacherId, tenantRef, operationRef, keyId, secretHash, connectionRef, apiOrigin, installationRef, operationKind, expectedKeyId } = row
  return Buffer.from(canonicalRepoLightJson({ teacherId, tenantRef, operationRef, keyId, secretHash, connectionRef, apiOrigin, installationRef, operationKind, expectedKeyId }))
}
function encryptionKey(config: ManagedRepoLightKeyring, id: string) {
  if (!Object.hasOwn(config.encryptionKeys, id)) throw failure('repolight_managed_encryption_key_missing')
  return Buffer.from(keyBytes.parse(config.encryptionKeys[id]), 'base64url')
}
export function prepareManagedRepoLightRecord(teacherId: string, config: ManagedRepoLightConfig, previous?: ManagedRepoLightRecord): ManagedRepoLightRecord {
  try {
    uuid.parse(teacherId)
    const secret = randomBytes(32).toString('base64url'), keyId = randomUUID(), operationRef = randomUUID()
    const binding: KeyBinding = {
      teacherId, tenantRef: previous?.tenantRef ?? `pika_tenant_${randomUUID()}`, operationRef, keyId,
      secretHash: createHash('sha256').update(secret).digest('hex'), connectionRef: `pika_managed_${operationRef}`,
      apiOrigin: config.apiOrigin, installationRef: config.installationRef,
      operationKind: previous ? 'rotate' : 'provision', expectedKeyId: previous?.keyId ?? null,
    }
    const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', encryptionKey(config, config.activeEncryptionKeyId), iv)
    cipher.setAAD(aad(binding))
    const ciphertext = Buffer.concat([cipher.update(`rl_v2_${keyId}.${secret}`, 'utf8'), cipher.final()])
    return managedRepoLightRecordSchema.parse({ ...binding, state: 'pending', workspaceRef: previous?.workspaceRef ?? null,
      encryptedKey: { version: 1, keyId: config.activeEncryptionKeyId, iv: iv.toString('base64url'), tag: cipher.getAuthTag().toString('base64url'), ciphertext: ciphertext.toString('base64url') } })
  } catch (error) { if (error instanceof ManagedRepoLightError) throw error; throw failure('repolight_managed_invalid_storage') }
}
export function decryptManagedRepoLightKey(row: ManagedRepoLightRecord, config: ManagedRepoLightKeyring): string {
  try {
    const record = managedRepoLightRecordSchema.parse(row), encrypted = record.encryptedKey
    const decipher = createDecipheriv('aes-256-gcm', encryptionKey(config, encrypted.keyId), Buffer.from(encrypted.iv, 'base64url'))
    decipher.setAAD(aad(record)); decipher.setAuthTag(Buffer.from(encrypted.tag, 'base64url'))
    const token = Buffer.concat([decipher.update(Buffer.from(encrypted.ciphertext, 'base64url')), decipher.final()]).toString('utf8')
    const prefix = `rl_v2_${record.keyId}.`, secret = token.slice(prefix.length)
    if (!token.startsWith(prefix) || !keyBytes.safeParse(secret).success || createHash('sha256').update(secret).digest('hex') !== record.secretHash) throw new Error()
    return token
  } catch (error) { if (error instanceof ManagedRepoLightError) throw error; throw failure('repolight_managed_invalid_storage') }
}

/** Server-only dependencies. prepare and activate must perform the database
 * entitlement check under the account-plan lock; a browser boolean is not proof. */
export type ManagedRepoLightStore = {
  access(teacherId: string): Promise<unknown>
  read(teacherId: string, connectionRef?: string): Promise<unknown>
  prepare(candidate: ManagedRepoLightRecord): Promise<unknown>
  prepareRotation(candidate: ManagedRepoLightRecord): Promise<unknown>
  activate(record: ManagedRepoLightRecord, workspaceRef: string): Promise<unknown>
}
const accessSchema = z.object({ allowed: z.boolean() }).passthrough()
const provisionResponseSchema = z.object({ schemaVersion: z.literal('1.0'), workspaceRef: ref, installationRef: ref, keyId: uuid }).strict()
const same = (left: unknown, right: unknown) => canonicalRepoLightJson(left) === canonicalRepoLightJson(right)

export function createManagedRepoLightRegistry(store: ManagedRepoLightStore, options: {
  config: () => ManagedRepoLightConfig; fetchImpl?: typeof fetch; timeoutMs?: number;
  keyring?: () => ManagedRepoLightKeyring;
  clientFactory?: typeof createRepoLightClient
}) {
  const timeoutMs = options.timeoutMs ?? 8000
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 15000) throw failure('repolight_managed_not_configured')
  async function allowed(teacherId: string) {
    try { if (!accessSchema.parse(await store.access(teacherId)).allowed) throw failure('repolight_managed_ineligible') }
    catch (error) { if (error instanceof ManagedRepoLightError) throw error; throw failure('repolight_managed_access_unavailable', true) }
  }
  function record(value: unknown, teacherId: string, connectionRef?: string) {
    const parsed = managedRepoLightRecordSchema.safeParse(value)
    if (!parsed.success || parsed.data.teacherId !== teacherId || (connectionRef && parsed.data.connectionRef !== connectionRef)) throw failure('repolight_managed_invalid_storage')
    return parsed.data
  }
  function connection(row: ManagedRepoLightRecord, config: ManagedRepoLightKeyring): RepoLightConnection {
    if (row.state !== 'ready' || row.workspaceRef === null) throw failure('repolight_managed_pending', true)
    return { teacherId: row.teacherId, connectionRef: row.connectionRef, workspaceRef: row.workspaceRef, installationRef: row.installationRef, apiKey: decryptManagedRepoLightKey(row, config), active: true }
  }
  async function provision(row: ManagedRepoLightRecord, config: ManagedRepoLightConfig) {
    // Never transfer a saved operation to a new host/installation after rotation.
    if (row.apiOrigin !== config.apiOrigin || row.installationRef !== config.installationRef) throw failure('repolight_managed_configuration_changed')
    // Ensure the durably saved ciphertext is usable before the first egress.
    decryptManagedRepoLightKey(row, config)
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      return await Promise.race([new Promise<never>((_, reject) => { timer = setTimeout(() => { reject(failure('repolight_managed_timeout', true)); controller.abort() }, timeoutMs) }), (async () => {
        const body = canonicalRepoLightJson({ schemaVersion: '1.0', tenantRef: row.tenantRef, operationRef: row.operationRef, keyId: row.keyId, secretHash: row.secretHash,
          ...(row.operationKind === 'rotate' ? { expectedKeyId: row.expectedKeyId } : {}) })
        const response = await (options.fetchImpl ?? fetch)(row.apiOrigin + `/api/v2/managed/${row.operationKind}`, { method: 'POST', body, redirect: 'error', cache: 'no-store', signal: controller.signal,
          headers: { Authorization: `Bearer ${config.controlSecret}`, Accept: 'application/json', 'Content-Type': 'application/json' } })
        if (!response.ok) { await response.body?.cancel().catch(() => {}); throw failure('repolight_managed_provision_failed', response.status === 429 || response.status >= 500) }
        const length = response.headers.get('content-length')
        if (response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json' || (length !== null && (!/^\d+$/.test(length) || Number(length) > 8192))) { await response.body?.cancel(); throw failure('repolight_managed_invalid_response') }
        const reader = response.body?.getReader()
        if (!reader) throw failure('repolight_managed_invalid_response')
        const chunks: Uint8Array[] = []; let bytes = 0
        const abort = () => { void reader.cancel().catch(() => {}) }; controller.signal.addEventListener('abort', abort, { once: true })
        try {
          while (true) { const next = await reader.read(); if (next.done) break; bytes += next.value.byteLength; if (bytes > 8192) { await reader.cancel(); throw failure('repolight_managed_invalid_response') }; chunks.push(next.value) }
          const parsed = provisionResponseSchema.safeParse(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))))
          if (!parsed.success || parsed.data.keyId !== row.keyId || parsed.data.installationRef !== row.installationRef
            || (row.workspaceRef !== null && row.workspaceRef !== parsed.data.workspaceRef)) throw failure('repolight_managed_invalid_response')
          return parsed.data
        } finally { controller.signal.removeEventListener('abort', abort); reader.releaseLock() }
      })()])
    } catch (error) { if (error instanceof ManagedRepoLightError) throw error; throw failure('repolight_managed_unavailable', true) }
    finally { controller.abort(); if (timer) clearTimeout(timer) }
  }
  async function finish(row: ManagedRepoLightRecord, config: ManagedRepoLightConfig) {
    const provisioned = await provision(row, config)
    const ready: ManagedRepoLightRecord = { ...row, workspaceRef: provisioned.workspaceRef, state: 'ready' }
    const resolved = connection(ready, config)
    await (options.clientFactory ?? createRepoLightClient)(resolved, { apiOrigin: row.apiOrigin, fetchImpl: options.fetchImpl, timeoutMs }).verifyConnection()
    if (row.operationKind === 'provision') await allowed(row.teacherId)
    const activated = record(await store.activate(row, provisioned.workspaceRef), row.teacherId)
    if (!same(ready, activated)) throw failure('repolight_managed_invalid_storage')
    return { connection: resolved, apiOrigin: row.apiOrigin }
  }
  return {
    async ensure(teacherId: string): Promise<{ connection: RepoLightConnection; apiOrigin: string }> {
      if (!uuid.safeParse(teacherId).success) throw failure('repolight_managed_invalid_request')
      const config = options.config()
      if (!config.enabled) throw failure('repolight_managed_disabled')
      await allowed(teacherId)
      const existing = await store.read(teacherId)
      const row = record(existing ?? await store.prepare(prepareManagedRepoLightRecord(teacherId, config)), teacherId)
      if (row.apiOrigin !== config.apiOrigin || row.installationRef !== config.installationRef) throw failure('repolight_managed_configuration_changed')
      if (row.state === 'ready') { await allowed(teacherId); return { connection: connection(row, config), apiOrigin: row.apiOrigin } }
      await allowed(teacherId)
      const resolved = await finish(row, config)
      await allowed(teacherId)
      return resolved
    },
    /** Server maintenance operation: caller must authorize owner recovery before
     * invocation. It grants no analysis eligibility and may restore cleanup for
     * expired teachers. Exact durable pending operations are resumed first. */
    async rotate(teacherId: string): Promise<{ connection: RepoLightConnection; apiOrigin: string }> {
      if (!uuid.safeParse(teacherId).success) throw failure('repolight_managed_invalid_request')
      const config = options.config()
      const current = record(await store.read(teacherId), teacherId)
      if (current.apiOrigin !== config.apiOrigin || current.installationRef !== config.installationRef) throw failure('repolight_managed_configuration_changed')
      if (current.state === 'pending') {
        if (current.operationKind !== 'rotate') throw failure('repolight_managed_pending', true)
        return finish(current, config)
      }
      if (current.state !== 'ready') throw failure('repolight_managed_invalid_storage')
      const pending = record(await store.prepareRotation(prepareManagedRepoLightRecord(teacherId, config, current)), teacherId)
      if (pending.operationKind !== 'rotate') throw failure('repolight_managed_invalid_storage')
      return finish(pending, config)
    },
    /** Saved locator lookup retains erasure access after entitlement or rollout
     * loss. After parent lifecycle authorization it may resume an existing saved
     * rotation, but never allocates a rotation or provisions a new workspace. */
    async resolveSaved(teacherId: string, connectionRef: string): Promise<{ connection: RepoLightConnection; apiOrigin: string }> {
      if (!uuid.safeParse(teacherId).success || !ref.safeParse(connectionRef).success) throw failure('repolight_managed_invalid_request')
      const saved = record(await store.read(teacherId, connectionRef), teacherId, connectionRef)
      const row = record(await store.read(teacherId), teacherId)
      if (saved.workspaceRef === null || row.workspaceRef !== saved.workspaceRef || row.installationRef !== saved.installationRef || row.apiOrigin !== saved.apiOrigin || row.tenantRef !== saved.tenantRef) throw failure('repolight_managed_invalid_storage')
      if (row.state === 'pending') {
        if (row.operationKind !== 'rotate' || !['ready', 'retired'].includes(saved.state)) throw failure('repolight_managed_pending', true)
        let config: ManagedRepoLightConfig
        try { config = options.config() }
        catch { throw failure('repolight_managed_recovery_unavailable', true) }
        const recovered = await finish(row, config)
        return { connection: { ...recovered.connection, connectionRef: saved.connectionRef }, apiOrigin: recovered.apiOrigin }
      }
      const resolved = connection(row, (options.keyring ?? options.config)())
      return { connection: { ...resolved, connectionRef: saved.connectionRef }, apiOrigin: row.apiOrigin }
    },
  }
}
