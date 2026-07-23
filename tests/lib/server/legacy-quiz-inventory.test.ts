import { describe, expect, it } from 'vitest'
import {
  createSupabaseLegacyQuizInventoryReader,
  inventoryLegacyQuizContracts,
  type LegacyQuizInventoryReader,
} from '@/lib/server/legacy-quiz-inventory'

const ARCHIVE_ID = '11111111-1111-4111-8111-111111111111'
const ARTIFACT_SHA256 = 'a'.repeat(64)

function archiveRow(overrides: Record<string, unknown> = {}) {
  return {
    id: ARCHIVE_ID,
    format: 'pika.classroom-archive',
    format_version: 1,
    artifact_sha256: ARTIFACT_SHA256,
    resource_counts: {
      quizzes: 1,
      quiz_questions: 3,
      quiz_responses: 60,
      quiz_student_scores: 0,
    },
    ...overrides,
  }
}

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
    readArchiveRows: async () => [archiveRow()],
    ...overrides,
  }
}

function supabaseWithArchivePages(
  pages: Array<{ data: unknown[]; count: number | null; error: unknown }>,
) {
  let pageIndex = 0
  return {
    from(table: string) {
      expect(table).toBe('classroom_archives')
      return {
        select() {
          return {
            order() {
              return {
                range() {
                  const page = pages[pageIndex]
                  pageIndex += 1
                  return Promise.resolve(page)
                },
              }
            },
          }
        },
      }
    },
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

  it('uses private archive identity and checksum when stabilizing equal counts', async () => {
    let archiveReads = 0
    const inventoryReader = reader({
      readArchiveRows: async () => {
        archiveReads += 1
        return [archiveRow({
          artifact_sha256: (archiveReads === 1 ? 'b' : 'c').repeat(64),
        })]
      },
    })

    const inventory = await inventoryLegacyQuizContracts(inventoryReader)

    expect(archiveReads).toBe(3)
    expect(inventory.archives.total).toBe(1)
    expect(inventory).not.toHaveProperty('archive_rows')
    expect(JSON.stringify(inventory)).not.toContain(ARCHIVE_ID)
    expect(JSON.stringify(inventory)).not.toContain('c'.repeat(64))
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
      readArchiveRows: async () => [archiveRow({
        resource_counts: { quizzes: -1 },
      })],
    }))).rejects.toThrow()
  })

  it('rejects a repeated archive identity during a same-count paginated read', async () => {
    const inventoryReader = createSupabaseLegacyQuizInventoryReader({
      supabase: supabaseWithArchivePages([
        { data: [archiveRow()], count: 2, error: null },
        { data: [archiveRow()], count: 2, error: null },
      ]) as never,
    })

    await expect(inventoryReader.readArchiveRows())
      .rejects.toThrow('identity repeated')
  })

  it('rejects an archive page count change', async () => {
    const inventoryReader = createSupabaseLegacyQuizInventoryReader({
      supabase: supabaseWithArchivePages([
        { data: [archiveRow()], count: 2, error: null },
        {
          data: [archiveRow({ id: '22222222-2222-4222-8222-222222222222' })],
          count: 1,
          error: null,
        },
      ]) as never,
    })

    await expect(inventoryReader.readArchiveRows())
      .rejects.toThrow('count changed')
  })

  it('rejects an archive read that ends before its exact count', async () => {
    const inventoryReader = createSupabaseLegacyQuizInventoryReader({
      supabase: supabaseWithArchivePages([
        { data: [archiveRow()], count: 2, error: null },
        { data: [], count: 2, error: null },
      ]) as never,
    })

    await expect(inventoryReader.readArchiveRows())
      .rejects.toThrow('ended before its exact count')
  })
})
