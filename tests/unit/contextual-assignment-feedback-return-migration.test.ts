import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const sql = readFileSync('supabase/migrations/196_contextual_assignment_feedback_return.sql', 'utf8')

describe('contextual Assignment feedback-return migration', () => {
  it.each([
    'return_assignment_feedback_for_owner_v1',
    'return_assignment_docs_for_owner_v1',
  ])('keeps %s service-only with an empty search path', (name) => {
    expect(sql).toContain(`create or replace function public.${name}`)
    expect(sql).toMatch(new RegExp(`${name}\\([\\s\\S]*?security definer[\\s\\S]*?set search_path = ''`))
    expect(sql).toMatch(new RegExp(`revoke all on function public\\.${name}\\([\\s\\S]*?from public, anon, authenticated`))
    expect(sql).toMatch(new RegExp(`grant execute on function public\\.${name}\\([\\s\\S]*?to service_role`))
  })

  it.each([
    ['return_assignment_feedback_for_owner_v1', 'return public.return_assignment_feedback_atomic'],
    ['return_assignment_docs_for_owner_v1', 'return public.return_assignment_docs_with_feedback_atomic'],
  ])('orders lifecycle fences before delegation in %s', (name, delegateText) => {
    const start = sql.indexOf(`create or replace function public.${name}`)
    const end = sql.indexOf('$function$;', start)
    const body = sql.slice(start, end)
    const assignmentLock = body.indexOf('pg_advisory_xact_lock(hashtextextended(p_assignment_id::text, 0))')
    const classroomLock = body.indexOf("'pika-classroom-operation:'")
    const purgeLock = body.indexOf('private.try_lock_classroom_membership_change(')
    const rowLock = body.indexOf('for update of classroom, assignment')
    const delegate = body.indexOf(delegateText)
    expect(assignmentLock).toBeGreaterThan(0)
    expect(assignmentLock).toBeLessThan(classroomLock)
    expect(classroomLock).toBeLessThan(purgeLock)
    expect(purgeLock).toBeLessThan(rowLock)
    expect(rowLock).toBeLessThan(delegate)
    expect(body).toContain("message = 'assignment_feedback_return_archived'")
  })
})
