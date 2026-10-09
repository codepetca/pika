import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { classroomTestQuotaProofCatalog } from '../../scripts/classroom-test-quota-proof-catalog'
import { TEST_OWNER_CREATE_SNAPSHOT_TABLES } from '../../scripts/contextual-test-owner-create-proof-fixture'
import { TEST_OWNER_PUBLICATION_SNAPSHOT_TABLES } from '../../scripts/contextual-test-publication-proof-fixture'
import { TEST_OWNER_PRISTINE_DISCARD_SNAPSHOT_TABLES } from '../../scripts/contextual-test-pristine-discard-proof-fixture'
import { validateTestOwnerCreateSnapshotCatalog, verifyTestOwnerCreatePrivilegeRestoration } from '../../scripts/check-contextual-test-owner-create-lifecycle'
import { validateTestOwnerPublicationSnapshotCatalog, verifyTestOwnerPublicationPrivilegeRestoration } from '../../scripts/check-contextual-test-owner-publication-lifecycle'
import { validateTestOwnerPristineDiscardSnapshotCatalog, verifyTestOwnerPristineDiscardPrivilegeRestoration } from '../../scripts/check-contextual-test-owner-pristine-discard-lifecycle'

const name = '253_classroom_test_tier_caps.sql'
const sql = readFileSync(resolve(process.cwd(), 'supabase/migrations', name), 'utf8')
const sha256 = createHash('sha256').update(sql).digest('hex')
const migrations = [{ name, sql, sha256 }]
const quota = 'private.classroom_test_quota_settings'
type Rows = Record<string, Record<string, unknown>[]>
const restored = { privilegeRestored: true, fixtureUnchanged: true }
const profiles = [
  { name: 'create', scopes: TEST_OWNER_CREATE_SNAPSHOT_TABLES, validate: validateTestOwnerCreateSnapshotCatalog,
    restore: (before: Rows, snapshot: () => Promise<Rows>) => verifyTestOwnerCreatePrivilegeRestoration(before, snapshot, async () => ({ ...restored, createAclSha256: sha256 })) },
  { name: 'publication', scopes: TEST_OWNER_PUBLICATION_SNAPSHOT_TABLES, validate: validateTestOwnerPublicationSnapshotCatalog,
    restore: (before: Rows, snapshot: () => Promise<Rows>) => verifyTestOwnerPublicationPrivilegeRestoration(before, snapshot, async () => ({ ...restored, snapshotAclSha256: sha256 })) },
  { name: 'discard', scopes: TEST_OWNER_PRISTINE_DISCARD_SNAPSHOT_TABLES, validate: validateTestOwnerPristineDiscardSnapshotCatalog,
    restore: (before: Rows, snapshot: () => Promise<Rows>) => verifyTestOwnerPristineDiscardPrivilegeRestoration(before, snapshot, async () => ({ ...restored, discardAclSha256: sha256 })) },
]

describe('externally sealed Test quota proof table addition', () => {
  it('requires exact reviewed migration bytes, not metadata alone', () => {
    for (const unreviewed of [[], [...migrations, ...migrations], [{ ...migrations[0], name: '254_unknown.sql' }],
      [{ ...migrations[0], sha256: 'a'.repeat(64) }], [{ ...migrations[0], sql: `${sql}\n` }]]) {
      expect(() => classroomTestQuotaProofCatalog(['public.tests'], unreviewed)).toThrow()
    }
  })
  it('rejects malformed, duplicate and over-bound canonical catalogs', () => {
    for (const catalog of [[], ['public.tests', 'public.tests'], ['vault.secrets'], Array.from({ length: 1024 }, (_, i) => `public.t_${i}`)]) {
      expect(() => classroomTestQuotaProofCatalog(catalog, migrations)).toThrow()
    }
  })
  describe.each(profiles)('$name', profile => {
    const canonical = [...new Set([...profile.scopes, 'storage.objects', 'storage.buckets'])].sort()
    const expected = classroomTestQuotaProofCatalog(canonical, migrations)
    const graph = (): Rows => ({ ...Object.fromEntries(profile.scopes.map(table => [table, []])),
      __nontarget_fingerprints: expected.map(table => ({ table, fingerprint: 'unchanged' })) })
    it('adds only the source-defined table, leaves canonical unchanged, and works after253 is applied', () => {
      expect(expected).toEqual([...canonical, quota].sort())
      expect(canonical).not.toContain(quota)
      expect(Object.isFrozen(expected)).toBe(true)
      expect(classroomTestQuotaProofCatalog(expected, migrations)).toEqual(expected)
      expect(profile.validate(graph(), expected)).toEqual(graph())
    })
    it.each(['quota', 'inherited', 'unexpected', 'duplicate'])('rejects %s catalog mismatch without exemptions', fault => {
      const changed = graph()
      if (fault === 'quota') changed.__nontarget_fingerprints = changed.__nontarget_fingerprints.filter(row => row.table !== quota)
      if (fault === 'inherited') changed.__nontarget_fingerprints = changed.__nontarget_fingerprints.filter(row => row.table !== 'public.tests')
      if (fault === 'unexpected') changed.__nontarget_fingerprints.push({ table: 'private.unreviewed', fingerprint: 'unexpected' })
      if (fault === 'duplicate') changed.__nontarget_fingerprints.push({ table: quota, fingerprint: 'duplicate' })
      expect(() => profile.validate(changed, expected)).toThrow()
    })
    it('requires the quota table whole fingerprint to survive restoration', async () => {
      await expect(profile.restore(graph(), async () => graph())).resolves.toBeDefined()
      const changed = graph()
      changed.__nontarget_fingerprints.find(row => row.table === quota)!.fingerprint = 'changed'
      await expect(profile.restore(graph(), async () => changed)).rejects.toThrow()
    })
    it('binds the isolated catalog separately from unchanged canonical comparison in the real lifecycle', () => {
      const path = `scripts/check-contextual-test-owner-${profile.name === 'discard' ? 'pristine-discard' : profile.name}-lifecycle.ts`
      const source = readFileSync(resolve(process.cwd(), path), 'utf8')
      expect(source).toContain('if (canonicalTables) assert.deepEqual(catalog, canonicalTables)')
      expect(source).toContain('expectedTables = classroomTestQuotaProofCatalog(catalog, migrations)')
      expect(source).not.toContain('expectedTables = catalog;')
    })
  })
})
