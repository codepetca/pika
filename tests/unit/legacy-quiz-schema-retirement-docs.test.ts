import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = process.cwd()

describe('legacy Quiz schema retirement docs', () => {
  it('records the destructive decision and migration-application boundary', () => {
    const plan = readFileSync(
      resolve(root, 'docs/guidance/legacy-quiz-schema-retirement-plan.md'),
      'utf8',
    )

    expect(plan).toContain('existing Quiz rows and Quiz-format archive')
    expect(plan).toContain('disposable production experiments')
    expect(plan).toContain('does not authorize applying a migration')
    expect(plan).toContain('target and exact')
    expect(plan).toContain('migration filename')
    expect(plan).toContain('No migration in this sequence has been applied to a')
    expect(plan).toContain('hosted target during this work')
  })

  it('defines strict v2 activation and the hard-removal exit path', () => {
    const plan = readFileSync(
      resolve(root, 'docs/guidance/legacy-quiz-schema-retirement-plan.md'),
      'utf8',
    )

    expect(plan).toContain('`107_classroom_archive_v2_direct_source.sql`')
    expect(plan).toContain('no runtime fallback to the v1 RPCs')
    expect(plan).toContain('v1 artifact discards its Quiz resources')
    expect(plan).toContain('`108_drop_legacy_quiz_schema.sql`')
    expect(plan).toContain('drop `quiz_responses`, `quiz_student_scores`')
    expect(plan).toContain('backup restoration or a forward schema')
  })
})
