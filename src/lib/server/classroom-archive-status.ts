import { z } from 'zod'
import {
  classroomHotArchiveRecoverySummarySchema,
  type ClassroomHotArchiveRecoverySummary,
} from '@/lib/contracts/classroom-lifecycle'
import { isClassroomArchiveExportAllowed } from '@/lib/server/classroom-archive-operations'
import { getServiceRoleClient } from '@/lib/supabase'

type SupabaseClient = ReturnType<typeof getServiceRoleClient>

const archiveRowSchema = z.object({
  id: z.string().uuid(),
  classroom_id: z.string().uuid(),
  created_at: z.string().datetime({ offset: true }),
  verified_at: z.string().datetime({ offset: true }),
  compressed_byte_size: z.number().int().positive(),
  retention: z.json(),
}).strict()

const operationRowSchema = z.object({
  id: z.string().uuid(),
  classroom_id: z.string().uuid(),
  status: z.enum(['snapshot_ready', 'completed', 'failed']),
  retryable: z.boolean().nullable(),
  updated_at: z.string().datetime({ offset: true }),
}).strict()

export type TeacherHotArchiveRecoveryResult =
  | { ok: true; summaries: ClassroomHotArchiveRecoverySummary[] }
  | { ok: false; error_code: 'hot_archive_recovery_list_failed' | 'hot_archive_recovery_contract_invalid' }

function isMissingArchiveTable(error: { code?: string } | null | undefined): boolean {
  return error?.code === 'PGRST205' || error?.code === '42P01'
}

function unavailableSummaries(classroomIds: string[]): ClassroomHotArchiveRecoverySummary[] {
  return classroomIds.map((classroomId) => ({
    classroom_id: classroomId,
    export_available: false,
    latest_archive: null,
    latest_operation: null,
  }))
}

export async function listTeacherHotArchiveRecovery(args: {
  supabase: SupabaseClient
  teacherId: string
  classroomIds: string[]
}): Promise<TeacherHotArchiveRecoveryResult> {
  const teacherId = z.string().uuid().parse(args.teacherId)
  const classroomIds = z.array(z.string().uuid()).parse([...new Set(args.classroomIds)])
  if (classroomIds.length === 0) return { ok: true, summaries: [] }

  const [archivesResponse, operationsResponse] = await Promise.all([
    args.supabase
      .from('classroom_archives')
      .select('id,classroom_id,created_at,verified_at,compressed_byte_size,retention')
      .eq('teacher_id', teacherId)
      .in('classroom_id', classroomIds)
      .order('created_at', { ascending: false }),
    args.supabase
      .from('classroom_archive_operations')
      .select('id,classroom_id,status,retryable,updated_at')
      .eq('teacher_id', teacherId)
      .eq('operation_type', 'export')
      .in('classroom_id', classroomIds)
      .order('snapshot_created_at', { ascending: false }),
  ])

  if (archivesResponse.error || operationsResponse.error) {
    const archivesCompatible = !archivesResponse.error || isMissingArchiveTable(archivesResponse.error)
    const operationsCompatible = !operationsResponse.error || isMissingArchiveTable(operationsResponse.error)
    if (archivesCompatible && operationsCompatible) {
      return { ok: true, summaries: unavailableSummaries(classroomIds) }
    }
    return { ok: false, error_code: 'hot_archive_recovery_list_failed' }
  }

  const archives = z.array(archiveRowSchema).safeParse(archivesResponse.data || [])
  const operations = z.array(operationRowSchema).safeParse(operationsResponse.data || [])
  if (!archives.success || !operations.success) {
    return { ok: false, error_code: 'hot_archive_recovery_contract_invalid' }
  }

  const latestArchiveByClassroom = new Map<string, z.infer<typeof archiveRowSchema>>()
  for (const archive of archives.data) {
    if (!latestArchiveByClassroom.has(archive.classroom_id)) {
      latestArchiveByClassroom.set(archive.classroom_id, archive)
    }
  }
  const latestOperationByClassroom = new Map<string, z.infer<typeof operationRowSchema>>()
  for (const operation of operations.data) {
    if (!latestOperationByClassroom.has(operation.classroom_id)) {
      latestOperationByClassroom.set(operation.classroom_id, operation)
    }
  }

  for (const [classroomId, operation] of latestOperationByClassroom) {
    if (operation.status === 'completed' && !latestArchiveByClassroom.has(classroomId)) {
      return { ok: false, error_code: 'hot_archive_recovery_contract_invalid' }
    }
  }

  const parsed = z.array(classroomHotArchiveRecoverySummarySchema).safeParse(
    classroomIds.map((classroomId) => {
      const archive = latestArchiveByClassroom.get(classroomId)
      const operation = latestOperationByClassroom.get(classroomId)
      return {
        classroom_id: classroomId,
        export_available: isClassroomArchiveExportAllowed(teacherId),
        latest_archive: archive
          ? {
              archive_id: archive.id,
              created_at: archive.created_at,
              verified_at: archive.verified_at,
              compressed_byte_size: archive.compressed_byte_size,
              retention: archive.retention,
            }
          : null,
        latest_operation: operation
          ? {
              operation_id: operation.id,
              status: operation.status,
              retryable: operation.retryable,
              updated_at: operation.updated_at,
            }
          : null,
      }
    }),
  )

  return parsed.success
    ? { ok: true, summaries: parsed.data }
    : { ok: false, error_code: 'hot_archive_recovery_contract_invalid' }
}
