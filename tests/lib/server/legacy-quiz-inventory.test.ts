import { describe, expect, it } from 'vitest'
import {
  inventoryLegacyQuizContracts,
  type LegacyQuizInventoryReader,
} from '@/lib/server/legacy-quiz-inventory'

function reader(
  overrides: Partial<LegacyQuizInventoryReader> = {},
): LegacyQuizInventoryReader {
  const counts = {
    quizzes: 1,
    quiz_questions: 3,
    quiz_responses: 60,
    quiz_student_scores: 0,
    assessment_drafts: 0,
    course_blueprint_assessments: 0,
  }
  return {
    readExactCount: async (table) => counts[table],
    readArchiveRows: async () => [{
      format: 'pika.classroom-archive',
      format_version: 1,
      resource_counts: {
        quizzes: 1,
        quiz_questions: 3,
        quiz_responses: 60,
        quiz_student_scores: 0,
      },
    }],
    ...overrides,
  }
}

describe('legacy Quiz contract inventory', () => {
  it('reports only aggregate live-row and verified archive evidence', async () => {
    const inventory = await inventoryLegacyQuizContracts(reader())

    expect(inventory.row_counts).toEqual({
      quizzes: 1,
      quiz_questions: 3,
      quiz_responses: 60,
      quiz_student_scores: 0,
      quiz_assessment_drafts: 0,
      quiz_blueprint_assessments: 0,
    })
    expect(inventory.archives).toEqual({
      total: 1,
      formats: { 'pika.classroom-archive@1': 1 },
      quiz_resource_evidence: {
        quizzes: {
          archives_with_rows: 1,
          total_rows_across_manifests: 1,
          max_rows_in_one_manifest: 1,
        },
        quiz_questions: {
          archives_with_rows: 1,
          total_rows_across_manifests: 3,
          max_rows_in_one_manifest: 3,
        },
        quiz_responses: {
          archives_with_rows: 1,
          total_rows_across_manifests: 60,
          max_rows_in_one_manifest: 60,
        },
        quiz_student_scores: {
          archives_with_rows: 0,
          total_rows_across_manifests: 0,
          max_rows_in_one_manifest: 0,
        },
      },
    })
  })

  it('requires two matching snapshots before accepting hosted evidence', async () => {
    let reads = 0
    const inventoryReader = reader({
      readExactCount: async (table) => {
        reads += 1
        if (table === 'quizzes' && reads <= 6) return 2
        return table === 'quizzes' ? 1 : 0
      },
      readArchiveRows: async () => [],
    })

    const inventory = await inventoryLegacyQuizContracts(inventoryReader)

    expect(inventory.row_counts.quizzes).toBe(1)
    expect(reads).toBe(18)
  })

  it('fails closed when aggregate evidence does not stabilize', async () => {
    let reads = 0
    const inventoryReader = reader({
      readExactCount: async (table) => {
        reads += 1
        return table === 'quizzes' ? reads : 0
      },
      readArchiveRows: async () => [],
    })

    await expect(inventoryLegacyQuizContracts(inventoryReader))
      .rejects.toThrow('did not stabilize')
  })

  it('rejects malformed or negative archive resource counts', async () => {
    await expect(inventoryLegacyQuizContracts(reader({
      readArchiveRows: async () => [{
        format: 'pika.classroom-archive',
        format_version: 1,
        resource_counts: { quizzes: -1 },
      }],
    }))).rejects.toThrow()
  })
})
