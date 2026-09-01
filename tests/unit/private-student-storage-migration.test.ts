import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('private student and Test Storage migration', () => {
  const migration = readFileSync(
    join(process.cwd(), 'supabase/migrations/146_private_student_and_test_storage.sql'),
    'utf8',
  )

  it('makes both student-sensitive buckets private', () => {
    expect(migration).toContain("where id in ('submission-images', 'test-documents')")
    expect(migration).toMatch(/set public = false/i)
  })

  it('removes both legacy anonymous read policies', () => {
    expect(migration).toContain('drop policy if exists "Allow public read access"')
    expect(migration).toContain(
      'drop policy if exists "Allow public read access for test documents"',
    )
  })

  it('refuses to privatize unreconciled existing objects', () => {
    expect(migration).toContain('private_student_storage_requires_managed_storage_enforcement')
    expect(migration).toContain('private_student_storage_contains_unsettled_legacy_objects')
    expect(migration).toContain("settings.mode = 'enforced'")
    expect(migration).toContain("managed.status not in ('verified', 'ready')")
    expect(migration).toContain("managed.status <> 'ready'")
  })

  it('removes every obsolete direct authenticated write policy', () => {
    expect(migration).toContain('drop policy if exists "Allow authenticated uploads"')
    expect(migration).toContain('drop policy if exists "Allow owner deletes"')
    expect(migration).toContain(
      'drop policy if exists "Allow authenticated uploads for test documents"',
    )
    expect(migration).toContain(
      'drop policy if exists "Allow owner deletes for test documents"',
    )
  })
})
