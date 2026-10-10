import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const sql = () => readFileSync('supabase/migrations/256_contextual_test_owner_workflow.sql', 'utf8')
describe('dormant owner Test workflow additive transaction', () => {
  it('keeps new capability service-only without changing inherited capability bodies', () => {
    expect(sql()).toContain('create function public.test_owner_workflow_v1(')
    expect(sql()).toContain('from public, anon, authenticated')
    expect(sql()).toContain('to service_role')
    expect(sql()).not.toMatch(/create (?:or replace )?function public\.(?:update_test_documents_atomic|begin_managed_storage_upload|update_test_student_access_atomic)\(/)
    expect(sql()).not.toContain('auth.uid()')
  })
  it('reuses lifecycle, storage and selected-access algorithms behind one owner boundary', () => {
    for (const name of ['classroom_purge_try_lock', 'try_lock_classroom_membership_change', 'lock_managed_storage_protocol',
      'update_test_documents_atomic', 'update_test_student_access_atomic', 'begin_managed_storage_upload', 'verify_managed_storage_upload', 'sync_test_document_snapshot_managed_atomic']) {
      expect(sql()).toContain(name)
    }
    expect(sql()).toContain("errcode = 'PT409'")
    expect(sql()).toMatch(/when serialization_failure then[\s\S]*errcode = 'PT409'/)
  })
  it('fences retired/archive mutations and owner self-participation, and binds cancellation before state checks', () => {
    expect(sql()).toContain('v_classroom.teacher_id is distinct from p_actor_id')
    expect(sql()).toContain('v_test.blueprint_archived_at is not null')
    expect(sql()).toContain('student_id <> p_actor_id')
    expect(sql()).toContain('v_object.resource_id is distinct from p_test_id')
    expect(sql()).toContain('v_object.created_by_user_id is distinct from p_actor_id')
    expect(sql()).toContain("v_object.status = 'reserved'")
    expect(sql()).toContain("v_object.content_type not in ('image/png', 'image/jpeg')")
  })
  it('bounds delegated lock waits and proves exact sync postimages', () => {
    expect(sql()).toContain("set lock_timeout = '1s'")
    expect(sql()).toContain("interval '8 seconds'")
    expect(sql()).toContain("p_operation = 'sync' and (pg_catalog.to_jsonb(v_after)")
    expect(sql()).toContain('else document end order by ordinal')
  })
  it('parenthesizes CASE comparison operands so PL/pgSQL IF parsing reaches its actual THEN', () => {
    // Native replay rejected the document-purpose condition at the CASE's THEN.
    // This is a guard for that known syntax trap, not a substitute for replay.
    expect(sql()).not.toMatch(/is distinct from\s+case\s+when/i)
  })
  it('extracts the rollback witness before subtracting allowed metadata fields', () => {
    const contract = readFileSync('scripts/check-contextual-test-owner-workflow.sql', 'utf8')
    expect(contract).not.toMatch(/\bresult\s*->\s*'test'\s*-/)
  })
  it('uses the existing Storage URL identity for retained legacy uploads and delivery', () => {
    // Supported persisted URL-only documents must survive canonical editor
    // replay. Native SQL/Storage regressions prove behavior; this catches loss
    // of the inherited resolver at either boundary without duplicating it.
    expect(sql().match(/public\.managed_storage_public_url_identity\(/g)).toHaveLength(3)
    expect(sql()).toContain("existing->>'managed_object_id' is not distinct from v_document->>'managed_object_id'")
    expect(sql()).toContain('reference.test_id = p_test_id and reference.managed_object_id = v_object.id')
  })
})
