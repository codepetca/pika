import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/131_attendance_cross_service_smoke.sql'),
  'utf8',
)
const databaseGuard = readFileSync(
  resolve(process.cwd(), 'scripts/check-bara-attendance-database.sh'),
  'utf8',
)

describe('attendance cross-service smoke migration', () => {
  it('keeps smoke state private, canary-scoped, replay-resistant, and rate bounded', () => {
    expect(migration).toContain('create table public.attendance_integration_smoke_runs')
    expect(migration).toContain('create table public.attendance_integration_smoke_nonces')
    expect(migration).toContain('enable row level security')
    expect(migration).toContain('from public, anon, authenticated, service_role')
    expect(migration).toContain('classroom.teacher_id = p_teacher_id')
    expect(migration).toContain('classroom.archived_at is null')
    expect(migration).toContain('v_recent_count >= 5')
    expect(migration).toContain("interval '15 minutes'")
    expect(migration).toContain('primary key (installation_ref, direction, nonce)')
    expect(migration).toContain('unique (installation_ref, challenge_hash)')
    expect(migration).toContain("run.created_at >= clock_timestamp() - interval '5 minutes'")
    expect(migration).toContain('run.callback_consumed_at is null')
    expect(migration).toContain('p_challenge_hash')
    expect(migration).toContain("p_direction <> 'bara_to_pika'")
    expect(migration).toContain("interval '24 hours'")
    expect(migration).toContain('limit 100')
    expect(migration).toContain('to service_role')
  })

  it('stores aggregate results without attendance payload or provider diagnostics', () => {
    expect(migration).toContain('pika_to_bara boolean')
    expect(migration).toContain('bara_to_pika boolean')
    expect(migration).not.toContain('payload json')
    expect(migration).not.toContain('response_payload')
    expect(migration).not.toContain('participant_ref')
    expect(migration).not.toContain('occurrence_ref')
  })

  it('extends the local database guard through migration 131', () => {
    expect(databaseGuard).toContain("version = '131'")
    expect(databaseGuard).toContain('begin_attendance_integration_smoke_v1')
    expect(databaseGuard).toContain('complete_attendance_integration_smoke_v1')
    expect(databaseGuard).toContain('consume_attendance_integration_smoke_nonce_v1')
    expect(databaseGuard).toContain('attendance_integration_smoke_runs')
    expect(databaseGuard).toContain('attendance_integration_smoke_nonces')
  })
})
