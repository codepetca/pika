import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/108_drop_legacy_quiz_schema.sql'),
  'utf8',
)

describe('legacy Quiz schema drop migration', () => {
  it('fails closed unless migration 107 purge invariants hold', () => {
    expect(migration).toContain("set local lock_timeout = '5s';")
    expect(migration).toContain('in access exclusive mode nowait;')
    expect(migration).toContain('Migration 107 Quiz purge invariants are not satisfied')
    expect(migration).toContain('Live archive registry still contains a Quiz resource')
    expect(migration).toContain(
      'Live archive registry does not exactly match source contract 2',
    )
    expect(migration).toContain('where format_version = 2\n  ) <> 40')
    expect(migration.match(/\bexcept\b/g)).toHaveLength(2)
    expect(migration).toContain('Current Tests schema is incomplete')
    expect(migration).toContain('Current Tests schema depends on the retired Quiz graph')
  })

  it('drops the retired graph explicitly without cascade', () => {
    for (const statement of [
      'drop table public.quiz_responses;',
      'drop table public.quiz_student_scores;',
      'drop table public.quiz_questions;',
      'drop table public.quizzes;',
      'drop column quizzes_weight;',
      'drop table private.legacy_quiz_backfill_ledger;',
    ]) {
      expect(migration).toContain(statement)
    }

    expect(migration).toContain('drop policy "Students can view quizzes" on public.quizzes;')
    expect(migration).toContain(
      'drop policy "Students can view quiz questions" on public.quiz_questions;',
    )
    expect(migration).not.toMatch(/\bdrop\b[^;]*\bcascade\b/i)
  })

  it('retires v1 database contracts while preserving Tests', () => {
    expect(migration).toContain(
      'delete from public.classroom_archive_resource_contract_versions',
    )
    expect(migration).toContain(
      'drop function if exists public.begin_classroom_archive_export(',
    )
    expect(migration).toContain(
      'drop function if exists public.complete_classroom_archive_export(',
    )
    expect(migration).not.toMatch(
      /\b(?:drop|delete from|update)\s+public\.(?:tests|test_questions|test_responses|test_attempts)\b/i,
    )
  })

  it('strips site configuration and verifies the final catalog', () => {
    expect(migration).toContain("planned_site_config - 'quizzes'")
    expect(migration).toContain("actual_site_config - 'quizzes'")
    expect(migration).toContain('Retired Quiz catalog objects remain')
    expect(migration).toContain('Retired Quiz site configuration remains')
    expect(migration).toContain('Retired archive source contract remains active')
    expect(migration.trimEnd()).toMatch(/commit;$/)
  })
})
