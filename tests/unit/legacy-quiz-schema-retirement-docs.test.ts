import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = process.cwd()

describe('legacy Quiz schema retirement docs', () => {
  it('records production evidence and preserves the archive-v1 migration gate', () => {
    const plan = readFileSync(
      resolve(root, 'docs/guidance/legacy-quiz-schema-retirement-plan.md'),
      'utf8',
    )

    expect(plan).toContain('`quizzes` | 1 | 1')
    expect(plan).toContain('`quiz_questions` | 3 | 3')
    expect(plan).toContain('`quiz_responses` | 60 | 60')
    expect(plan).toContain('`quiz_student_scores` | 0 | 0')
    expect(plan).toContain('pika.classroom-archive` format version 2')
    expect(plan).toContain('unchanged v1 reader')
    expect(plan).toContain('`CLASSROOM_ARCHIVE_CONTRACTS` registry keyed by version')
    expect(plan).toContain('(format_version, table_name)')
    expect(plan).toContain('classroom_archives.format_version = 1')
    expect(plan).toContain('non-empty quiz, question, response, manual')
    expect(plan).toContain('The drop is not rollback-safe')
    expect(plan).toContain('exact migration filename and target approval')
  })

  it('keeps retired Quiz rows out of the active Tests graph', () => {
    const plan = readFileSync(
      resolve(root, 'docs/guidance/legacy-quiz-schema-retirement-plan.md'),
      'utf8',
    )

    expect(plan).toContain('Do not backfill legacy Quiz rows into active `tests`')
    expect(plan).toContain('classroom_retired_assessment_records')
    expect(plan).toContain('no active API, gradebook query, Test component')
    expect(plan).toContain('access-exclusive lock on')
    expect(plan).toContain('fail if any Quiz row exists')
    expect(plan).toContain('Test-only constraint')
  })
})
