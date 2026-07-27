import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/111_pal_pilot_transactional_outbox.sql'),
  'utf8',
).toLowerCase()

describe('Pal pilot transactional outbox migration', () => {
  it('creates a private, durable outbox with idempotency and retry state', () => {
    expect(migration).toContain('create table public.pal_event_outbox')
    expect(migration).toContain('idempotency_key text not null unique')
    expect(migration).toContain("'pending', 'processing', 'delivered', 'non_retryable'")
    expect(migration).toContain('for update skip locked')
    expect(migration).toContain('lease_token uuid')
  })

  it('keeps every learner action and its event in one database transaction', () => {
    for (const functionName of [
      'create_classroom_enrollment_with_pal_event_atomic',
      'upsert_student_entry_with_pal_event_atomic',
      'create_assignment_doc_with_pal_event_atomic',
      'submit_assignment_doc_with_pal_event_atomic',
      'record_pal_daily_log_week_configuration_atomic',
    ]) {
      const start = migration.indexOf(`function public.${functionName}`)
      expect(start, functionName).toBeGreaterThan(-1)
      const body = migration.slice(start, migration.indexOf('$$;', start) + 3)
      expect(body, functionName).toContain('private.enqueue_pal_event')
    }
  })

  it('prevents browser roles from reading or invoking the adapter ledger', () => {
    expect(migration).toContain('alter table public.pal_event_outbox enable row level security')
    expect(migration).toContain(
      'revoke all on table public.pal_event_outbox from public, anon, authenticated',
    )
    expect(migration).toMatch(
      /revoke all on function public\.enqueue_pal_event[\s\S]+from public, anon, authenticated/,
    )
    expect(migration).toMatch(
      /grant execute on function public\.enqueue_pal_event[\s\S]+to service_role/,
    )
    expect(migration).toContain(
      'grant execute on function public.claim_pal_event_outbox(integer, integer)\n  to service_role',
    )
    expect(migration).toContain(
      'grant execute on function public.requeue_pal_event_outbox(uuid)\n  to service_role',
    )
  })

  it('stores monotonic weekly opportunity revisions and terminal closure', () => {
    expect(migration).toContain('create table public.pal_daily_log_week_configurations')
    expect(migration).toContain('pal weekly configuration version must be monotonic')
    expect(migration).toContain('pal weekly configuration is already closed')
  })
})
