import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CLASSROOM_PURGE_ONLY_RELATIONAL_RESOURCES } from '@/lib/contracts/classroom-data'

const migration = readFileSync(
  join(process.cwd(), 'supabase/migrations/125_ordered_lesson_plan_mutations.sql'),
  'utf8',
)

describe('ordered lesson-plan mutations migration', () => {
  it('advances a durable per-session head only for a newer sequence', () => {
    expect(migration).toContain('create table public.lesson_plan_mutation_heads')
    expect(migration).toContain('primary key (classroom_id, date, client_id)')
    expect(migration).toContain('on conflict (classroom_id, date, client_id) do update')
    expect(migration).toContain(
      'where public.lesson_plan_mutation_heads.last_sequence < excluded.last_sequence',
    )
  })

  it('applies the ordering fence and lesson write in one database function', () => {
    expect(migration).toContain('function public.apply_ordered_lesson_plan_mutation')
    expect(migration).toContain("'applied', false")
    expect(migration).toContain('delete from public.lesson_plans')
    expect(migration).toContain('on conflict (classroom_id, date) do update')
    expect(migration).toContain('grant execute on function public.apply_ordered_lesson_plan_mutation')
  })

  it('tracks mutation heads as purge-only classroom operational state', () => {
    expect(CLASSROOM_PURGE_ONLY_RELATIONAL_RESOURCES).toContainEqual(expect.objectContaining({
      table: 'lesson_plan_mutation_heads',
      primary_key: ['classroom_id', 'date', 'client_id'],
      privacy: ['operations'],
    }))
  })
})
