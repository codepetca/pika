import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

function readMigration() {
  return readFileSync(resolve(process.cwd(), 'supabase/migrations/075_auth_rls_hardening.sql'), 'utf8')
}

describe('auth RLS hardening migration', () => {
  it('adds a unique WorkOS mapping while keeping the local Pika user id', () => {
    const migration = readMigration()

    expect(migration).toContain('add column if not exists workos_user_id text')
    expect(migration).toContain('create unique index if not exists users_workos_user_id_unique')
    expect(migration).toContain('public.users.id remains Pika')
  })

  it('enables no-direct-access RLS on server-managed announcement and gradebook tables', () => {
    const migration = readMigration()

    for (const tableName of [
      'announcements',
      'announcement_reads',
      'gradebook_settings',
      'quiz_student_scores',
      'report_cards',
      'report_card_rows',
    ]) {
      expect(migration).toContain(`alter table public.${tableName} enable row level security;`)
      expect(migration).toContain(`No direct access to ${tableName}`)
      expect(migration).toContain('using (false)')
      expect(migration).toContain('with check (false)')
    }
  })

  it('revokes direct Data API and RPC grants from anon and authenticated roles', () => {
    const migration = readMigration()

    expect(migration).toContain(
      'revoke all privileges on all tables in schema public from public, anon, authenticated;',
    )
    expect(migration).toContain(
      'revoke all privileges on all sequences in schema public from public, anon, authenticated;',
    )
    expect(migration).toContain(
      'revoke all privileges on all functions in schema public from public, anon, authenticated;',
    )
    expect(migration).toContain('grant all privileges on all tables in schema public to service_role;')
    expect(migration).toContain('grant execute on all functions in schema public to service_role;')
  })

  it('sets stable search paths on public functions surfaced by Supabase advisors', () => {
    const migration = readMigration()

    expect(migration).toContain('alter function public.update_announcements_updated_at() set search_path = public;')
    expect(migration).toContain(
      'alter function public.return_assignment_docs_atomic(p_assignment_id uuid, p_student_ids uuid[], p_teacher_id uuid, p_now timestamp with time zone) set search_path = public;',
    )
    expect(migration).toContain('alter function public.validate_test_response_shape() set search_path = public;')
  })

  it('keeps legacy public storage reads but removes direct client writes', () => {
    const migration = readMigration()

    expect(migration).toContain('drop policy if exists "Allow authenticated uploads" on storage.objects;')
    expect(migration).toContain('drop policy if exists "Allow owner deletes" on storage.objects;')
    expect(migration).toContain(
      'drop policy if exists "Allow authenticated uploads for test documents" on storage.objects;',
    )
    expect(migration).toContain(
      'drop policy if exists "Allow owner deletes for test documents" on storage.objects;',
    )
    expect(migration).not.toContain('drop policy if exists "Allow public read access"')
    expect(migration).not.toContain('drop policy if exists "Allow public read access for test documents"')
  })
})
