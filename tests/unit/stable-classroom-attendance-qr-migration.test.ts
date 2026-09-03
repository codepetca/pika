import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const sql = readFileSync(
  'supabase/migrations/151_stable_classroom_attendance_qr.sql',
  'utf8',
)

describe('stable classroom attendance QR migration', () => {
  it('stores only a random rotatable handle behind service-role-only access', () => {
    expect(sql).toContain('create table public.attendance_classroom_qr_handles')
    expect(sql).toContain('handle_id uuid not null unique default gen_random_uuid()')
    expect(sql).toContain('generation bigint not null default 1')
    expect(sql).toContain('enable row level security')
    expect(sql).toMatch(/revoke all on table public\.attendance_classroom_qr_handles[\s\S]*anon, authenticated, service_role/)
    expect(sql).toMatch(/grant select, insert, update[\s\S]*to service_role/)
    expect(sql).not.toMatch(/roster_ref|occurrence_ref|check_in_token|source_token/)
  })
})
