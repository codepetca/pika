import { describe, expect, it } from 'vitest'
import { newAssignmentListProofFixture } from '../../scripts/contextual-assignment-list-proof-fixture'
import { newTestOwnerCreateFixture } from '../../scripts/contextual-test-owner-create-proof-fixture'
import { testOwnerCreateContractsManifest } from '../../scripts/contextual-test-owner-create-db-contracts'
import { newTestOwnerPublicationFixture } from '../../scripts/contextual-test-publication-proof-fixture'
import { testOwnerPublicationDbContractsManifest } from '../../scripts/contextual-test-publication-db-contracts'
import { newTestOwnerPristineDiscardFixture } from '../../scripts/contextual-test-pristine-discard-proof-fixture'
import { testOwnerPristineDiscardDbContractsSql } from '../../scripts/contextual-test-pristine-discard-db-contracts'

const original = newAssignmentListProofFixture(new Date('2026-10-07T22:00:00Z'))
const create = newTestOwnerCreateFixture(original)
const publication = newTestOwnerPublicationFixture(original)
const discard = newTestOwnerPristineDiscardFixture(original)
const project = `pika_assignment_list_${original.manifest.syntheticTag.slice(-12)}`

describe('embedded classroom Test quota catalog scope', () => {
  // Source coverage supplements actual PostgreSQL execution of the whole bundles.
  it.each([
    ['create', testOwnerCreateContractsManifest(create).contracts],
    ['publication', testOwnerPublicationDbContractsManifest(publication, project).contracts],
    ['discard', testOwnerPristineDiscardDbContractsSql(discard, project)],
  ])('avoids the enclosing record variable in the %s catalog', (_label, sql) => {
    expect(sql.includes('select quota_catalog_proc.* into quota_proc from pg_catalog.pg_proc quota_catalog_proc')).toBe(true)
    expect(sql.includes("where quota_catalog_proc.oid='private.enforce_classroom_test_quota_v1()'::regprocedure")).toBe(true)
    expect(/select p\.\* into quota_proc from pg_catalog\.pg_proc p\b/.test(sql)).toBe(false)
  })
})
