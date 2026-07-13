import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/084_gradex_extract_operations.sql'),
  'utf8',
)

describe('Gradex extract operations migration', () => {
  it('keeps immutable artifact metadata separate from mutable cleanup state', () => {
    expect(migration).toContain('create table public.classroom_gradex_extracts')
    expect(migration).toContain('create table public.classroom_gradex_extract_cleanup')
    expect(migration).toContain('Verified Gradex extract metadata is immutable')
    expect(migration).toContain("status in ('pending', 'processing', 'failed', 'deleted')")
  })

  it('enforces bounded retention, idempotency, concurrency, and strict evidence', () => {
    expect(migration).toContain("p_delete_after > v_now + interval '90 days'")
    expect(migration).toContain("'idempotency_conflict'")
    expect(migration).toContain("'gradex_extract_already_in_progress'")
    expect(migration).toContain("'gradex_finalization_conflict'")
    expect(migration).toContain('direct_identifier_findings')
    expect(migration).toContain("jsonb_typeof(p_verification->required.key) <> 'boolean'")
    expect(migration).toContain("v_verified_at > v_now + interval '5 minutes'")
    expect(migration).toContain('p_compressed_byte_size > 52428800')
  })

  it('uses leased cleanup with retry and stale-lease protection', () => {
    expect(migration).toContain('for update skip locked')
    expect(migration).toContain('lease_expires_at')
    expect(migration).toContain('power(2, least(attempt_count, 10))')
    expect(migration).toContain('status = \'processing\' and lease_token = p_lease_token')
    expect(migration).toContain('p_lease_token is null')
  })

  it('keeps every operation RPC service-role-only', () => {
    for (const signature of [
      'begin_classroom_gradex_extract(uuid, uuid, uuid, uuid, text, timestamptz)',
      'complete_classroom_gradex_extract(uuid, uuid, text, text, bigint, bigint, jsonb, jsonb)',
      'fail_classroom_gradex_extract(uuid, uuid, text, boolean)',
      'claim_due_classroom_gradex_extract_cleanup(uuid, integer, integer)',
      'complete_classroom_gradex_extract_cleanup(uuid, uuid)',
      'fail_classroom_gradex_extract_cleanup(uuid, uuid, text)',
    ]) {
      expect(migration).toContain(`revoke all on function public.${signature} from public, anon, authenticated`)
      expect(migration).toContain(`grant execute on function public.${signature} to service_role`)
    }
  })
})
