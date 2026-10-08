import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { newAssignmentListProofFixture } from '../../scripts/contextual-assignment-list-proof-fixture'
import { newTestOwnerCreateFixture } from '../../scripts/contextual-test-owner-create-proof-fixture'
import { newTestOwnerPublicationFixture } from '../../scripts/contextual-test-publication-proof-fixture'
import { newTestOwnerPristineDiscardFixture } from '../../scripts/contextual-test-pristine-discard-proof-fixture'
import { testOwnerCreateContractsManifest } from '../../scripts/contextual-test-owner-create-db-contracts'
import { testOwnerPublicationDbContractsManifest } from '../../scripts/contextual-test-publication-db-contracts'
import { testOwnerPristineDiscardDbContractsSql } from '../../scripts/contextual-test-pristine-discard-db-contracts'

const base = newAssignmentListProofFixture(new Date('2026-10-06T12:00:00Z'))
const publication = newTestOwnerPublicationFixture(base)
const discard = newTestOwnerPristineDiscardFixture(base)
const migration = readFileSync(resolve(process.cwd(), 'supabase/migrations/253_classroom_test_tier_caps.sql'), 'utf8')
const body = migration.split('as $guard$')[1].split('$guard$;')[0]
const digest = createHash('md5').update(body).digest('hex')
const sources = {
  create: testOwnerCreateContractsManifest(newTestOwnerCreateFixture(base)).contracts,
  publication: testOwnerPublicationDbContractsManifest(publication, `pika_assignment_list_${publication.tag.slice(-12)}`).contracts,
  discard: testOwnerPristineDiscardDbContractsSql(discard, `pika_assignment_list_${discard.tag.slice(-12)}`),
}

describe('migration253 exact Test proof closure', () => {
  for (const [name, sql] of Object.entries(sources)) {
    it(`${name} adds exactly the quota trigger without relaxing earlier closure`, () => {
      expect(sql).toContain("'enforce_classroom_test_quota','private','enforce_classroom_test_quota_v1',23)")
      for (const old of ['delete_test_gradebook_score_overrides', 'removed_academic_parent', 'tests_managed_storage_sync', 'preserve_test_question_lock']) expect(sql).toContain(old)
      expect(sql).toContain('except (')
      expect(sql).toContain('tgattr::text')
      expect(sql).toContain("a.attname='classroom_id'")
    })
    it(`${name} requires the exact dormant setting, private ACL and sealed function body`, () => {
      for (const token of [
        'private.classroom_test_quota_settings', 'private.enforce_classroom_test_quota_v1()',
        'Quota253 function or dormant settings differ', "prorettype::regtype::text<>'trigger'",
        "proconfig is distinct from array['search_path=\"\"']::text[]",
        `pg_catalog.md5(quota_proc.prosrc)<> '${digest}'`, 'quota_proc.prosecdef', 'relrowsecurity',
        'quota_acl.grantee<>quota_proc.proowner', 'settings_acl.grantee<>settings_table.relowner',
        'column_acl.grantee<>settings_table.relowner',
        'singleton and not enabled', "pg_catalog.pg_get_expr(d.adbin,d.adrelid)='false'",
      ]) expect(sql).toContain(token)
    })
  }
})
