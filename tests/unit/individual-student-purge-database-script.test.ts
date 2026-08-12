import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const script = readFileSync(resolve(
  process.cwd(), 'scripts/check-individual-student-purge-database.sh',
), 'utf8')

describe('individual-student purge database fixture', () => {
  it('refuses unexpected targets and requires migration 123', () => {
    expect(script).toContain('com.supabase.cli.project')
    expect(script).toContain('PROJECT_LABEL" != "pika"')
    expect(script).toContain("version = '123'")
  })

  it('is destructive only inside a rollback-only transaction', () => {
    expect(script).toContain('begin;')
    expect(script).toContain('rollback;')
    expect(script).not.toMatch(/\bcommit\s*;/i)
  })

  it('covers provider blocking, writer fences, target deletion, and cross-class preservation', () => {
    expect(script).toContain('Pal-backed student did not fail closed')
    expect(script).toContain('Target student write bypassed the purge fence')
    expect(script).toContain('Target row reassignment bypassed the purge fence')
    expect(script).toContain('Managed object delete bypassed student purge lease authority')
    expect(script).toContain('Student purge accepted storage completion while bytes remained')
    expect(script).toContain('Target Classroom student data remained')
    expect(script).toContain('User, other Classroom, or classmate data was removed')
  })
})
