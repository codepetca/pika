import { z } from 'zod'
import { canonicalJsonStringify } from '@/lib/server/classroom-archive-format'
import { getServiceRoleClient } from '@/lib/supabase'

export const LEGACY_QUIZ_RESOURCE_TABLES = [
  'quizzes',
  'quiz_questions',
  'quiz_responses',
  'quiz_student_scores',
] as const

type LegacyQuizResourceTable = typeof LEGACY_QUIZ_RESOURCE_TABLES[number]
type LegacyQuizCountTable =
  | LegacyQuizResourceTable
  | 'assessment_drafts'
  | 'course_blueprint_assessments'

const exactCountSchema = z.number().int().nonnegative()
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/)
const archiveRowSchema = z.object({
  id: z.string().uuid(),
  format: z.string().min(1),
  format_version: z.number().int().positive(),
  artifact_sha256: sha256Schema,
  resource_counts: z.record(z.string(), z.number().int().nonnegative()),
}).strict()

const snapshotSchema = z.object({
  row_counts: z.object({
    quizzes: exactCountSchema,
    quiz_questions: exactCountSchema,
    quiz_responses: exactCountSchema,
    quiz_student_scores: exactCountSchema,
    quiz_assessment_drafts: exactCountSchema,
    quiz_blueprint_assessments: exactCountSchema,
  }).strict(),
  archive_rows: z.array(archiveRowSchema),
}).strict()

const resourceEvidenceSchema = z.object({
  archives_with_rows: exactCountSchema,
  total_rows_across_manifests: exactCountSchema,
  max_rows_in_one_manifest: exactCountSchema,
}).strict()

const legacyQuizInventorySchema = z.object({
  generated_at: z.string().datetime({ offset: true }),
  row_counts: snapshotSchema.shape.row_counts,
  archives: z.object({
    total: exactCountSchema,
    formats: z.record(z.string(), exactCountSchema),
    quiz_resource_evidence: z.record(
      z.enum(LEGACY_QUIZ_RESOURCE_TABLES),
      resourceEvidenceSchema,
    ),
  }).strict(),
}).strict()

export type LegacyQuizInventory = z.infer<typeof legacyQuizInventorySchema>

export interface LegacyQuizInventoryReader {
  readExactCount(
    table: LegacyQuizCountTable,
    filters?: Readonly<Record<string, string>>,
  ): Promise<unknown>
  readArchiveRows(): Promise<unknown>
}

async function readSnapshot(reader: LegacyQuizInventoryReader) {
  const [
    quizzes,
    quizQuestions,
    quizResponses,
    quizStudentScores,
    quizAssessmentDrafts,
    quizBlueprintAssessments,
    archiveRows,
  ] = await Promise.all([
    reader.readExactCount('quizzes'),
    reader.readExactCount('quiz_questions'),
    reader.readExactCount('quiz_responses'),
    reader.readExactCount('quiz_student_scores'),
    reader.readExactCount('assessment_drafts', { assessment_type: 'quiz' }),
    reader.readExactCount('course_blueprint_assessments', { assessment_type: 'quiz' }),
    reader.readArchiveRows(),
  ])

  return snapshotSchema.parse({
    row_counts: {
      quizzes,
      quiz_questions: quizQuestions,
      quiz_responses: quizResponses,
      quiz_student_scores: quizStudentScores,
      quiz_assessment_drafts: quizAssessmentDrafts,
      quiz_blueprint_assessments: quizBlueprintAssessments,
    },
    archive_rows: archiveRows,
  })
}

async function readStableSnapshot(reader: LegacyQuizInventoryReader) {
  let previous = await readSnapshot(reader)
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const current = await readSnapshot(reader)
    if (canonicalJsonStringify(previous) === canonicalJsonStringify(current)) {
      return current
    }
    previous = current
  }
  throw new Error('Legacy Quiz inventory did not stabilize across read-only snapshots')
}

export async function inventoryLegacyQuizContracts(
  reader: LegacyQuizInventoryReader,
): Promise<LegacyQuizInventory> {
  const snapshot = await readStableSnapshot(reader)
  const formats: Record<string, number> = {}
  for (const archive of snapshot.archive_rows) {
    const format = `${archive.format}@${archive.format_version}`
    formats[format] = (formats[format] || 0) + 1
  }

  const quizResourceEvidence = Object.fromEntries(
    LEGACY_QUIZ_RESOURCE_TABLES.map((table) => {
      const rowCounts = snapshot.archive_rows.map(
        (archive) => archive.resource_counts[table] || 0,
      )
      return [table, {
        archives_with_rows: rowCounts.filter((count) => count > 0).length,
        total_rows_across_manifests: rowCounts.reduce((total, count) => total + count, 0),
        max_rows_in_one_manifest: rowCounts.reduce((maximum, count) => {
          return Math.max(maximum, count)
        }, 0),
      }]
    }),
  ) as Record<LegacyQuizResourceTable, z.infer<typeof resourceEvidenceSchema>>

  return legacyQuizInventorySchema.parse({
    generated_at: new Date().toISOString(),
    row_counts: snapshot.row_counts,
    archives: {
      total: snapshot.archive_rows.length,
      formats,
      quiz_resource_evidence: quizResourceEvidence,
    },
  })
}

export function createSupabaseLegacyQuizInventoryReader(args: {
  supabase: ReturnType<typeof getServiceRoleClient>
}): LegacyQuizInventoryReader {
  return {
    async readExactCount(table, filters = {}) {
      let query = args.supabase
        .from(table)
        .select('id', { count: 'exact', head: true })
      for (const [column, value] of Object.entries(filters)) {
        query = query.eq(column, value)
      }
      const { count, error } = await query
      if (error) throw new Error(`Legacy Quiz inventory count failed for ${table}`)
      return count
    },

    async readArchiveRows() {
      const rows: Array<z.infer<typeof archiveRowSchema>> = []
      const archiveIds = new Set<string>()
      let expectedCount: number | null = null
      while (expectedCount === null || rows.length < expectedCount) {
        const { data, count, error } = await args.supabase
          .from('classroom_archives')
          .select('id, format, format_version, artifact_sha256, resource_counts', {
            count: 'exact',
          })
          .order('id', { ascending: true })
          .range(rows.length, rows.length + 999)
        if (error) throw new Error('Legacy Quiz archive inventory read failed')
        const parsedCount = exactCountSchema.parse(count)
        if (expectedCount === null) expectedCount = parsedCount
        if (expectedCount !== parsedCount) {
          throw new Error('Legacy Quiz archive count changed during paginated read')
        }
        const page = z.array(archiveRowSchema).parse(data)
        if (page.length === 0 && rows.length !== expectedCount) {
          throw new Error('Legacy Quiz archive inventory ended before its exact count')
        }
        for (const archive of page) {
          if (archiveIds.has(archive.id)) {
            throw new Error('Legacy Quiz archive identity repeated during paginated read')
          }
          archiveIds.add(archive.id)
        }
        rows.push(...page)
        if (rows.length > expectedCount) {
          throw new Error('Legacy Quiz archive inventory exceeded its exact count')
        }
      }
      return rows
    },
  }
}
