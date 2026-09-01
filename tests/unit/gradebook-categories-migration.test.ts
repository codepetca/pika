import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  join(process.cwd(), 'supabase/migrations/147_gradebook_categories.sql'),
  'utf8',
)

describe('gradebook categories migration', () => {
  it('seeds Attendance, Term, and Final with Term as the default', () => {
    expect(migration).toContain("('Attendance'::text, 10::numeric, 0)")
    expect(migration).toContain("('Term'::text, 65::numeric, 1)")
    expect(migration).toContain("('Final'::text, 25::numeric, 2)")
    expect(migration).toContain("defaults.name = 'Term'")
  })

  it('leaves assessments uncategorized when a category is deleted', () => {
    expect(migration).toContain('references public.gradebook_categories (id) on delete set null')
  })

  it('defaults new assessments while validating category changes', () => {
    expect(migration).toContain("if tg_op = 'INSERT' and new.gradebook_category_id is null then")
    expect(migration).toContain('before insert or update of gradebook_category_id, classroom_id on public.assignments')
    expect(migration).toContain('before insert or update of gradebook_category_id, classroom_id on public.tests')
    expect(migration).toContain('gradebook category must belong to the assessment classroom')
  })

  it('validates one default and category percentages totaling 100 atomically', () => {
    expect(migration).toContain('create or replace function public.replace_gradebook_categories')
    expect(migration).toContain('if default_count <> 1 then')
    expect(migration).toContain('if percentage_total <> 100 then')
    expect(migration).toContain('gradebook category ids must be unique')
    expect(migration).toContain("scale((category.value->>'percentage')::numeric) > 2")
  })
})
