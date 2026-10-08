import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const sql = readFileSync('supabase/migrations/197_contextual_classwork_reorder.sql', 'utf8')
const ci = readFileSync('.github/workflows/ci.yml', 'utf8')

describe('contextual classwork reorder migration', () => {
  it.each([
    'reorder_assignments_for_owner_v1',
    'reorder_classwork_items_for_owner_v1',
  ])('keeps %s service-only with an empty search path', (name) => {
    expect(sql).toContain(`create function public.${name}`)
    expect(sql).toMatch(new RegExp(`${name}\\([\\s\\S]*?security definer[\\s\\S]*?set search_path = ''`))
    expect(sql).toMatch(new RegExp(`revoke all on function public\\.${name}\\([\\s\\S]*?from public, anon, authenticated`))
    expect(sql).toMatch(new RegExp(`grant execute on function public\\.${name}\\([\\s\\S]*?to service_role`))
  })

  it('locks the Classroom operation and row before checking ownership and lifecycle', () => {
    const start = sql.indexOf('create function private.lock_classwork_reorder_context_v1')
    const end = sql.indexOf('$function$;', start)
    const body = sql.slice(start, end)
    const operationLock = body.indexOf("'pika-classroom-operation:'")
    const rowLock = body.indexOf('for update')
    const ownerCheck = body.indexOf('v_owner_id is distinct from p_actor_id')
    const archiveCheck = body.indexOf('v_archived_at is not null')
    expect(operationLock).toBeGreaterThan(0)
    expect(operationLock).toBeLessThan(rowLock)
    expect(rowLock).toBeLessThan(ownerCheck)
    expect(ownerCheck).toBeLessThan(archiveCheck)
    expect(body).toContain("message = 'classwork_reorder_archived'")
  })

  it.each([
    ['reorder_assignments_for_owner_v1', 'perform public.reorder_assignments_preserve_materials'],
    ['reorder_classwork_items_for_owner_v1', 'perform public.reorder_classwork_items'],
  ])('authorizes before delegating from %s', (name, delegate) => {
    const start = sql.indexOf(`create function public.${name}`)
    const end = sql.indexOf('$function$;', start)
    const body = sql.slice(start, end)
    expect(body.indexOf('private.lock_classwork_reorder_context_v1'))
      .toBeLessThan(body.indexOf(delegate))
    expect(body).toContain("'actor_id', p_actor_id")
    expect(body).toContain("'classroom_id', p_classroom_id")
  })

  it('runs rollback and multi-connection checks in database CI', () => {
    expect(ci).toContain('bash scripts/check-contextual-classwork-reorder-database.sh')
    expect(ci).toContain('node scripts/check-contextual-classwork-reorder-concurrency.mjs')
  })
})
