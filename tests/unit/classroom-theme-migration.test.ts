import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

function readMigration() {
  return readFileSync(resolve(process.cwd(), 'supabase/migrations/079_classroom_theme_color.sql'), 'utf8')
}

describe('classroom theme color migration', () => {
  it('backfills existing classrooms with per-teacher ordered palette positions', () => {
    const migration = readMigration()

    expect(migration).toContain('row_number() over')
    expect(migration).toContain('partition by teacher_id')
    expect(migration).toContain('order by position asc nulls last, updated_at desc nulls last, created_at asc, id asc')
    expect(migration).toContain('((ordered_classrooms.theme_position - 1) % 8) + 1')
    expect(migration).not.toContain('md5(')
  })
})
