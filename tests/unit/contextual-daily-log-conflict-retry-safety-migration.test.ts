import { createHash } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const original = readFileSync('supabase/migrations/224_contextual_daily_log_save.sql', 'utf8')
const correction = readFileSync('supabase/migrations/225_daily_log_conflict_retry_safety.sql', 'utf8')

describe('Daily Log conflict retry safety', () => {
  it('preserves already-applied 224 and uniquely allocates the additive correction', () => {
    expect(createHash('sha256').update(original).digest('hex')).toBe(
      '338fb8b314ae278944575369eef8841aba5dc873c72b6d42d4937af179f88767',
    )
    expect(readdirSync('supabase/migrations').filter(name => name.startsWith('225_'))).toEqual([
      '225_daily_log_conflict_retry_safety.sql',
    ])
  })

  it('changes only the function replacement declaration and defensive conflict code', () => {
    const definition = (sql: string) => sql.slice(sql.indexOf('create '), sql.indexOf('\n$function$;') + '\n$function$;'.length)
    expect(definition(correction)).toBe(definition(original)
      .replace('create function ', 'create or replace function ')
      .replace("errcode = '40001'", "errcode = 'PT409'"))
    expect(correction).not.toContain("errcode = '40001'")
    expect(correction.match(/create or replace function/g)).toHaveLength(1)
  })

  it('reasserts the unchanged service-only privilege and metadata contract transactionally', () => {
    expect(correction.slice(correction.indexOf('revoke all'))).toBe(original.slice(original.indexOf('revoke all')))
    expect(correction).toMatch(/begin;\s+create or replace function/)
    expect(correction.trim()).toMatch(/commit;$/)
    expect(correction).not.toMatch(/drop function|alter table|create policy|disable trigger/i)
  })

  it('exercises the defensive PT409 path in the existing rollback-only CI harness', () => {
    const harness = readFileSync('scripts/check-contextual-daily-log-save-database.sh', 'utf8')
    expect(harness).toContain('Migration 225 is required; this harness never applies it')
    expect(harness).toContain("exception when sqlstate 'PT409' then null;")
    expect(harness).toContain('Binding conflict changed the entry')
    expect(harness).toMatch(/reset role;\s+create or replace function public\.upsert_student_entry_with_pal_event_atomic/)
    expect(harness).toMatch(/\$fault\$;\s+set local role service_role;\s+do \$binding_conflict\$/)
    expect(harness).toMatch(/\$binding_conflict\$;\s+rollback;/)
  })
})
