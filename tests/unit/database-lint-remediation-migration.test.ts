import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const sql = readFileSync(resolve(
  process.cwd(),
  'supabase/migrations/135_resolve_database_lint_findings.sql',
), 'utf8').toLowerCase()

describe('migration 135 database lint remediation', () => {
  it('qualifies student-purge object retry backoff in the joined update', () => {
    expect(sql).toContain('least(object.attempt_count, 8)')
    expect(sql).not.toContain('least(attempt_count, 8)')
    expect(sql).toContain('returning object.attempt_count into v_attempt')
  })

  it('serializes failure behind claims and rejects expired leases', () => {
    const operationLock = sql.indexOf('from public.student_purge_operations operation')
    const objectUpdate = sql.indexOf('update public.student_purge_objects object')

    expect(operationLock).toBeGreaterThan(-1)
    expect(objectUpdate).toBeGreaterThan(operationLock)
    expect(sql).toContain('for update;')
    expect(sql).toContain('object.lease_expires_at > v_now')
  })

  it('resolves the archive actor temp relation only after runtime creation', () => {
    expect(sql).toContain('create temporary table if not exists classroom_archive_actor_ids')
    expect(sql).toContain("v_actor_relation := format('%i.%i', 'pg_temp', 'classroom_archive_actor_ids')")
    expect(sql).toContain("execute 'truncate table ' || v_actor_relation")
    expect(sql).toContain('from %s selected_actor')
    expect(sql).not.toContain('from classroom_archive_actor_ids selected_actor')
  })
})
