import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// Structural ratchet only. The rollback/concurrency database harness is the
// behavioral authority and must run against the applied migration before rollout.
const migration = () => readFileSync('supabase/migrations/152_contextual_classroom_calendar_writes.sql', 'utf8')

describe('contextual calendar migration contract', () => {
  it.each(['create_classroom_calendar_v1', 'set_classroom_calendar_day_v1'])(
    'restricts %s to server execution with a fixed search path', (name) => {
      const sql = migration()
      expect(sql).toContain(`function public.${name}(`)
      expect(sql).toMatch(new RegExp(`revoke all on function public\\.${name}\\([^;]+from public, anon, authenticated`, 's'))
      expect(sql).toMatch(new RegExp(`grant execute on function public\\.${name}\\([^;]+to service_role`, 's'))
      const body = sql.split(`function public.${name}(`)[1].split('$function$;')[0]
      expect(body).toContain('security definer')
      expect(body).toContain("set search_path = ''")
      expect(body).toContain('for update')
      expect(body.indexOf('for update')).toBeLessThan(body.indexOf('v_owner_id is distinct from p_actor_id'))
      expect(body.indexOf('v_archived_at is not null')).toBeLessThan(body.indexOf('insert into public.class_days'))
      expect(body).not.toMatch(/users\.role|p_role|p_plan/)
    },
  )

  it('keeps range and child writes in one function and rejects existing calendars', () => {
    const body = migration().split('function public.create_classroom_calendar_v1(')[1].split('$function$;')[0]
    expect(body).toContain('update public.classrooms')
    expect(body).toContain('insert into public.class_days')
    expect(body).toContain("errcode = '23505'")
    expect(body).toContain('cardinality(p_dates) > 367')
    expect(body).toContain('p_end_date - p_start_date > 366')
    expect(body).not.toMatch(/exception\s+when/i)
  })

  it('checks Toronto time after the classroom lock and scopes idempotent day updates', () => {
    const body = migration().split('function public.set_classroom_calendar_day_v1(')[1].split('$function$;')[0]
    expect(body.indexOf('for update')).toBeLessThan(body.indexOf('clock_timestamp()'))
    expect(body).toContain("clock_timestamp() at time zone 'America/Toronto'")
    expect(body).toContain('on conflict (classroom_id, date) do update')
    expect(body).toContain('is distinct from excluded.is_class_day')
    expect(body).toContain('where day.classroom_id = p_classroom_id and day.date = p_date')
  })
})
