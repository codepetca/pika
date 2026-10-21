import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const sql = readFileSync('supabase/migrations/271_contextual_archive_recovery.sql', 'utf8')

describe('contextual owner archive recovery SQL source contract', () => {
  it('is a single stable service-only snapshot without DML, storage access or legacy role grants', () => {
    expect(sql).toMatch(/language sql stable security invoker/)
    expect(sql).toContain("set search_path = ''")
    expect(sql).toContain("set lock_timeout = '1s'")
    expect(sql).toContain("set statement_timeout = '8s'")
    expect(sql).toMatch(/revoke all[\s\S]*from public, anon, authenticated/)
    expect(sql).toMatch(/grant execute[\s\S]*to service_role/)
    expect(sql).not.toMatch(/\b(insert|update|delete|storage\.objects|users\.role)\b/i)
    expect(sql.match(/create function/g)).toHaveLength(1)
  })

  it('binds both current hot and cold owners and exact completed export identity in the same snapshot', () => {
    for (const predicate of ['c.teacher_id = p_actor_id and c.archived_at is not null',
      't.teacher_id = p_actor_id', 'a.id = o.archive_id', 'o.teacher_id = p_actor_id',
      'a.teacher_id = p_actor_id', 'a.classroom_id = h.id', "o.status = 'completed'",
      'o.source_revision = h.current_revision', 'a.source_revision = h.current_revision',
      'a.storage_path = o.storage_path', 'a.artifact_sha256 = o.artifact_sha256',
      'a.verification = o.verification']) expect(sql).toContain(predicate)
    expect(sql).not.toMatch(/select\s+\*/i)
  })

  it('rejects oversized complete results instead of truncating rows or making a second snapshot', () => {
    expect(sql).toContain('payload as materialized')
    expect(sql).toContain("jsonb_array_length(result->'hot_classrooms') > 5000")
    expect(sql).toContain("jsonb_array_length(result->'cold_archives') > 5000")
    expect(sql).toContain("octet_length(pg_catalog.convert_to(result::text, 'UTF8')) > 16777216")
    expect(sql).toMatch(/then null\s+else result\s+end from payload/)
  })
})
