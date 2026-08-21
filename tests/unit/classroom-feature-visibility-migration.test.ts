import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CLASSROOM_FEATURE_KEYS } from '@/lib/classroom-feature-visibility'

const migration = readFileSync(
  join(process.cwd(), 'supabase/migrations/128_classroom_feature_visibility.sql'),
  'utf8',
)

describe('classroom feature visibility migration', () => {
  it('adds a non-null default-on JSON object without modifying classroom content', () => {
    expect(migration).toMatch(/add column feature_visibility jsonb not null default/i)
    expect(migration).toContain('classrooms_feature_visibility_shape_check')
    expect(migration).not.toMatch(/\b(delete|truncate|drop)\b/i)

    for (const key of CLASSROOM_FEATURE_KEYS) {
      expect(migration).toContain(`"${key}": true`)
      expect(migration).toContain(`feature_visibility -> '${key}'`)
    }
  })

  it('adapts pre-128 cold archive roots without dropping later restore adapters', () => {
    expect(migration).toContain('create or replace function public.normalize_classroom_archive_restore_row(')
    expect(migration).toContain("if p_table_name = 'classrooms' then")
    expect(migration).toContain("if not (p_row ? 'feature_visibility') then")
    expect(migration).toContain("'feature_visibility',")
    expect(migration).toContain("if p_table_name = 'assignment_docs' then")
    expect(migration).toContain("if p_table_name = 'test_ai_grading_runs'")
  })
})
