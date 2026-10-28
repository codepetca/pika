import { CLASSROOM_ADMISSION_REGISTRY_REVIEWED_TABLES } from '../../scripts/classroom-admission-registry-reviewed-migration'
import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { REPOLIGHT_REPORT_SERVICE_REVIEWED_TABLES } from '../../scripts/repolight-report-service-reviewed-migration'
import { classroomTestQuotaProofCatalog } from '../../scripts/classroom-test-quota-proof-catalog'
import { loadAssignmentListReviewedMigrations } from '../../scripts/contextual-assignment-list-proof-platform'
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
  it('includes all four sealed294 tables and preserves the explicit historical293 catalog', async () => {
    const current = loadAssignmentListReviewedMigrations(process.cwd())
    const introduced = [...current[293].sql.matchAll(/^create table ((?:public|private)\.[a-z_]+)/gm)].map(match => match[1]).sort()
    expect(introduced).toEqual([...CLASSROOM_ADMISSION_REGISTRY_REVIEWED_TABLES].sort())
    expect(introduced).toHaveLength(4)
    const before = classroomTestQuotaProofCatalog(['public.tests'], current.slice(0, 293))
    const expected = [...before, ...introduced].sort()
    expect(classroomTestQuotaProofCatalog(['public.tests'], current)).toEqual(expected)
    expect(classroomTestQuotaProofCatalog(['public.tests'], current.slice(0,294))).toEqual(expected)
    for (const index of [293,294]) {
      const changed = current.map((row, at) => at === index ? { ...row, sql: row.sql + '\n', sha256: createHash('sha256').update(row.sql + '\n').digest('hex') } : row)
      expect(() => classroomTestQuotaProofCatalog(before, changed)).toThrow()
    }
    expect(classroomTestQuotaProofCatalog(expected, current)).toEqual(expected)
    expect(classroomTestQuotaProofCatalog(['public.tests'], current.slice(0, 293))).toEqual(before)
    for (const changed of [
      current.slice(0, 293).concat({ ...current[293], name: '294_unknown.sql' }),
      current.map((row, index) => index === 293 ? { ...row, sql: row.sql + '\n' } : row),
      current.map((row, index) => index === 293 ? { ...row, sql: row.sql + '\n', sha256: createHash('sha256').update(row.sql + '\n').digest('hex') } : row),
      [current[252], current[293]],
      [...current, { name: '296_unknown.sql', sql: 'select 1;', sha256: createHash('sha256').update('select 1;').digest('hex') }],
    ]) expect(() => classroomTestQuotaProofCatalog(before, changed)).toThrow()
    for (const profile of profiles) {
      const complete = [...new Set([...profile.scopes, ...expected])].sort()
      const graph = (): Rows => ({ ...Object.fromEntries(profile.scopes.map(table => [table, []])),
        __nontarget_fingerprints: complete.map(table => ({ table, fingerprint: 'unchanged' })) })
      await expect(profile.restore(graph(), async () => graph())).resolves.toBeDefined()
      for (const table of introduced) {
        const missing = graph()
        missing.__nontarget_fingerprints = missing.__nontarget_fingerprints.filter(row => row.table !== table)
        expect(() => profile.validate(missing, complete)).toThrow()
        const changed = graph()
        changed.__nontarget_fingerprints.find(row => row.table === table)!.fingerprint = 'changed'
        await expect(profile.restore(graph(), async () => changed)).rejects.toThrow()
      }
    }
  })

  it('includes all ten sealed293 tables and rejects incomplete or substituted source profiles', async () => {
    const current = loadAssignmentListReviewedMigrations(process.cwd()).slice(0, 293)
    const introduced = [...current[292].sql.matchAll(/^create table ((?:public|private)\.[a-z_]+)/gm)].map(match => match[1]).sort()
    expect(introduced).toEqual([...REPOLIGHT_REPORT_SERVICE_REVIEWED_TABLES].sort())
    expect(introduced).toHaveLength(10)
    const before = classroomTestQuotaProofCatalog(['public.tests'], current.slice(0, 292))
    const expected = [...before, ...introduced].sort()
    expect(classroomTestQuotaProofCatalog(['public.tests'], current)).toEqual(expected)
    expect(classroomTestQuotaProofCatalog(expected, current)).toEqual(expected)
    expect(classroomTestQuotaProofCatalog(before, current.slice(0, 292))).toEqual(before)
    for (const changed of [
      current.slice(0, 292).concat({ ...current[292], name: '293_unknown.sql' }),
      current.map((row, index) => index === 292 ? { ...row, sql: row.sql + '\n' } : row),
      current.map((row, index) => index === 292 ? { ...row, sql: row.sql + '\n', sha256: createHash('sha256').update(row.sql + '\n').digest('hex') } : row),
      [current[252], current[292]],
      [...current, { name: '294_unknown.sql', sql: 'select 1;', sha256: createHash('sha256').update('select 1;').digest('hex') }],
    ]) expect(() => classroomTestQuotaProofCatalog(before, changed)).toThrow()
    for (const profile of profiles) {
      const complete = [...new Set([...profile.scopes, ...expected])].sort()
      const graph = (): Rows => ({ ...Object.fromEntries(profile.scopes.map(table => [table, []])),
        __nontarget_fingerprints: complete.map(table => ({ table, fingerprint: 'unchanged' })) })
      await expect(profile.restore(graph(), async () => graph())).resolves.toBeDefined()
      for (const table of introduced) {
        const missing = graph()
        missing.__nontarget_fingerprints = missing.__nontarget_fingerprints.filter(row => row.table !== table)
        expect(() => profile.validate(missing, complete)).toThrow()
        const changed = graph()
        changed.__nontarget_fingerprints.find(row => row.table === table)!.fingerprint = 'changed'
        await expect(profile.restore(graph(), async () => changed)).rejects.toThrow()
      }
    }
  })
  it('includes every reviewed292 table in whole-row preservation rather than excluding the home preference', () => {
    const current = loadAssignmentListReviewedMigrations(process.cwd()).slice(0, 292)
    const introduced = [...current[291].sql.matchAll(/create table (private\.[a-z_]+)/g)].map(match => match[1])
    expect(introduced).toEqual(['private.classroom_home_hidden_enrollments'])
    const before = classroomTestQuotaProofCatalog(['public.tests'], current.slice(0, 291))
    const expected = [...before, ...introduced].sort()
    expect(classroomTestQuotaProofCatalog(['public.tests'], current)).toEqual(expected)
    expect(classroomTestQuotaProofCatalog(expected, current)).toEqual(expected)
    for (const modified of [current.map((row, index) => index === 291 ? { ...row, sql: row.sql + '\n' } : row),
      current.map((row, index) => index === 291 ? { ...row, sql: row.sql + '\n', sha256: createHash('sha256').update(row.sql + '\n').digest('hex') } : row)]) {
      expect(() => classroomTestQuotaProofCatalog(['public.tests'], modified)).toThrow()
    }
  })
  it('includes the exact281 private capability table in complete preservation fingerprints', () => {
    const current = loadAssignmentListReviewedMigrations(process.cwd()).slice(0, 292)
    const capability = 'private.attendance_decommission_delete_capabilities'
    const before = ['public.tests']
    const additions = ['private.attendance_participant_associations', 'private.attendance_override_event_generations']
    const adoption = 'private.attendance_pointer_mutations'
    const historical = [capability, quota, ...additions, ...before].sort()
    const learner = 'private.attendance_override_mutations'
    const authoring = 'public.teacher_authoring_image_references'
    const home = 'private.classroom_home_hidden_enrollments'
    const expected = [...historical, adoption, learner, authoring, home].sort()
    expect(classroomTestQuotaProofCatalog(before, current)).toEqual(expected)
    expect(classroomTestQuotaProofCatalog(expected, current)).toEqual(expected)
    expect(classroomTestQuotaProofCatalog(before, current.slice(0, 283))).toEqual(historical)
    expect(classroomTestQuotaProofCatalog(before, current.slice(0, 284))).toEqual(historical)
    expect(classroomTestQuotaProofCatalog(before, current.slice(0, 285))).toEqual([...historical, adoption].sort())
    expect(classroomTestQuotaProofCatalog(before, current.slice(0, 290))).toEqual([...historical, adoption, learner].sort())
    expect(classroomTestQuotaProofCatalog(before, current.slice(0, 290))).not.toContain(authoring)
    expect(classroomTestQuotaProofCatalog(before, current.slice(0, 291))).toEqual(expected.filter(table => table !== home))
    expect(historical).not.toContain(adoption)
    const futureSql = 'select 1;'
    expect(() => classroomTestQuotaProofCatalog(before, [...current, { name: '289_unknown.sql',
      sql: futureSql, sha256: createHash('sha256').update(futureSql).digest('hex') }])).toThrow()
    expect(classroomTestQuotaProofCatalog(before, current.slice(0, 280))).toEqual([quota, ...before].sort())
    expect(classroomTestQuotaProofCatalog(before, current.slice(0, 281))).toEqual([capability, quota, ...before].sort())
    expect(classroomTestQuotaProofCatalog(before, current.slice(0, 282))).toEqual([capability, quota, ...before].sort())
    for (const table of additions) {
      expect(expected).toContain(table)
      expect(classroomTestQuotaProofCatalog(before, current.slice(0, 281))).not.toContain(table)
      expect(classroomTestQuotaProofCatalog(before, current.slice(0, 282))).not.toContain(table)
    }
    expect(() => classroomTestQuotaProofCatalog(before, [current[252], current[282]])).toThrow()
    for (const incomplete of [[current[252], current[280]], [...current, current[280]]]) {
      expect(() => classroomTestQuotaProofCatalog(before, incomplete)).toThrow()
    }
    const changed = current.map(row => ({ ...row }))
    changed[280].sql += '\n'
    changed[280].sha256 = createHash('sha256').update(changed[280].sql).digest('hex')
    expect(() => classroomTestQuotaProofCatalog(before, changed)).toThrow()
    const changedAdoption = current.map(row => ({ ...row }))
    changedAdoption[284].sql += '\n'
    changedAdoption[284].sha256 = createHash('sha256').update(changedAdoption[284].sql).digest('hex')
    expect(() => classroomTestQuotaProofCatalog(before, changedAdoption)).toThrow()
    expect(() => classroomTestQuotaProofCatalog(before, [current[252], current[284]])).toThrow()
  })
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
  describe.each(profiles)('$name complete292 preservation', profile => {
    const current = loadAssignmentListReviewedMigrations(process.cwd()).slice(0, 292)
    const canonical = [...new Set([...profile.scopes, 'storage.objects', 'storage.buckets'])].sort()
    const expected = classroomTestQuotaProofCatalog(canonical, current)
    const graph = (): Rows => ({ ...Object.fromEntries(profile.scopes.map(table => [table, []])),
      __nontarget_fingerprints: expected.map(table => ({ table, fingerprint: 'unchanged' })) })
    it.each(['public.teacher_authoring_image_references', 'private.classroom_home_hidden_enrollments'])('requires the complete new table fingerprint: %s', adoption => {
      expect(expected).toContain(adoption)
      expect(profile.validate(graph(), expected)).toEqual(graph())
      const missing = graph()
      missing.__nontarget_fingerprints = missing.__nontarget_fingerprints.filter(row => row.table !== adoption)
      expect(() => profile.validate(missing, expected)).toThrow()
    })
    it.each(['public.teacher_authoring_image_references', 'private.classroom_home_hidden_enrollments'])('rejects table drift during privilege restoration: %s', async adoption => {
      await expect(profile.restore(graph(), async () => graph())).resolves.toBeDefined()
      const changed = graph()
      changed.__nontarget_fingerprints.find(row => row.table === adoption)!.fingerprint = 'changed'
      await expect(profile.restore(graph(), async () => changed)).rejects.toThrow()
    })
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
