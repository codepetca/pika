import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const sql = readFileSync('supabase/migrations/198_contextual_assignment_bulk.sql', 'utf8')
const hardeningSql = readFileSync('supabase/migrations/199_harden_contextual_assignment_bulk_scope.sql', 'utf8')
const ci = readFileSync('.github/workflows/ci.yml', 'utf8')

describe('contextual Assignment bulk migration', () => {
  it('keeps the RPC service-only with an empty search path', () => {
    expect(sql).toContain('create function public.save_assignments_bulk_for_owner_v1')
    expect(sql).toMatch(/save_assignments_bulk_for_owner_v1\([\s\S]*?security definer[\s\S]*?set search_path = ''/)
    expect(sql).toMatch(/revoke all on function public\.save_assignments_bulk_for_owner_v1\([\s\S]*?from public, anon, authenticated/)
    expect(sql).toMatch(/grant execute on function public\.save_assignments_bulk_for_owner_v1\([\s\S]*?to service_role/)
  })

  it('takes sorted Assignment fences before the Classroom fence and row lock', () => {
    const assignmentFence = sql.indexOf("'assignment_submission:'")
    const classroomFence = sql.indexOf("'pika-classroom-operation:'")
    const classroomRowLock = sql.indexOf('where classroom.id = p_classroom_id\n  for update')
    const ownerCheck = sql.indexOf('v_owner_id is distinct from p_actor_id')
    expect(sql).toContain('select distinct')
    expect(assignmentFence).toBeGreaterThan(0)
    expect(assignmentFence).toBeLessThan(classroomFence)
    expect(classroomFence).toBeLessThan(classroomRowLock)
    expect(classroomRowLock).toBeLessThan(ownerCheck)
  })

  it('validates the complete batch before any Assignment insert or update', () => {
    const missingCheck = sql.indexOf("'Assignment ID not found: %s'")
    const liveCheck = sql.indexOf("'Cannot un-release assignment: %s'")
    const insert = sql.indexOf('insert into public.assignments')
    const update = sql.indexOf('update public.assignments')
    expect(missingCheck).toBeLessThan(insert)
    expect(liveCheck).toBeLessThan(insert)
    expect(insert).toBeLessThan(update)
  })

  it('runs rollback and multi-connection checks in database CI', () => {
    expect(ci).toContain('bash scripts/check-contextual-assignment-bulk-database.sh')
    expect(ci).toContain('node scripts/check-contextual-assignment-bulk-concurrency.mjs')
  })

  it('moves the original implementation private and preflights scope before request-supplied locks', () => {
    expect(hardeningSql).toContain('set schema private')
    expect(hardeningSql).toContain('rename to save_assignments_bulk_unscoped_v1')
    expect(hardeningSql).toMatch(/revoke all on function private\.save_assignments_bulk_unscoped_v1\([\s\S]*?service_role/)
    const foreignCheck = hardeningSql.indexOf('Reject missing or foreign IDs')
    const assignmentFence = hardeningSql.indexOf("'assignment_submission:'")
    const scopedRowLock = hardeningSql.indexOf('and assignment.classroom_id = p_classroom_id\n  order by assignment.id\n  for update')
    const delegate = hardeningSql.lastIndexOf('return private.save_assignments_bulk_unscoped_v1')
    expect(foreignCheck).toBeGreaterThan(0)
    expect(foreignCheck).toBeLessThan(assignmentFence)
    expect(assignmentFence).toBeLessThan(scopedRowLock)
    expect(scopedRowLock).toBeLessThan(delegate)
  })
})
