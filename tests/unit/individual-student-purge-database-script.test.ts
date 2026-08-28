import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const script = readFileSync(resolve(
  process.cwd(), 'scripts/check-individual-student-purge-database.sh',
), 'utf8')
const concurrencyScript = readFileSync(resolve(
  process.cwd(), 'scripts/check-individual-student-purge-failure-concurrency.sh',
), 'utf8')

describe('individual-student purge database fixture', () => {
  it('refuses unexpected targets and requires migration 123', () => {
    expect(script).toContain('com.supabase.cli.project')
    expect(script).toContain('STUDENT_PURGE_DB_PROJECT_LABEL:-pika')
    expect(script).toContain('STUDENT_PURGE_DB_PORT:-54322')
    expect(script).toContain('STUDENT_PURGE_DB_NAME:-postgres')
    expect(script).toContain('PROJECT_LABEL" != "$EXPECTED_PROJECT_LABEL"')
    expect(script).toContain('grep -q ":${EXPECTED_DB_PORT}$"')
    expect(script).toContain("version = '123'")
  })

  it('races an expired failure against reclaim in a disposable database', () => {
    expect(concurrencyScript).toContain('STUDENT_PURGE_DB_PROJECT_LABEL:-pika')
    expect(concurrencyScript).toContain('STUDENT_PURGE_DB_PORT:-54322')
    expect(concurrencyScript).toContain('dropdb -U postgres --if-exists --force "$TMP_DB"')
    expect(concurrencyScript).toContain('for migration in "$ROOT"/supabase/migrations/*.sql')
    expect(concurrencyScript).toContain('student_purge_expired_claimer')
    expect(concurrencyScript).toContain('student_purge_expired_failure')
    expect(concurrencyScript).toContain("wait_event_type = 'Lock'")
    expect(concurrencyScript).toContain('student_purge_object_lease_lost')
    expect(concurrencyScript).toContain('Stale failure mutated the replacement object lease')
  })

  it('is destructive only inside a rollback-only transaction', () => {
    expect(script).toContain('begin;')
    expect(script).toContain('rollback;')
    expect(script).not.toMatch(/\bcommit\s*;/i)
  })

  it('covers provider blocking, writer fences, target deletion, and cross-class preservation', () => {
    expect(script).toContain('Pal-backed student did not fail closed')
    expect(script).toContain('Target student write bypassed the purge fence')
    expect(script).toContain('Target row reassignment bypassed the purge fence')
    expect(script).toContain('Managed object delete bypassed student purge lease authority')
    expect(script).toContain('Student purge accepted storage completion while bytes remained')
    expect(script).toContain('Student purge storage failure was not recorded as retryable')
    expect(script).toContain('Student purge object bypassed deletion retry backoff')
    expect(script).toContain('Student purge retry did not issue a clean second lease')
    expect(script).toContain('Target Classroom student data remained')
    expect(script).toContain('User, other Classroom, or classmate data was removed')
  })
})
