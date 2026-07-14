import { z } from 'zod'
import {
  classroomColdArchiveSummarySchema,
  type ClassroomColdArchiveSummary,
} from '@/lib/contracts/classroom-lifecycle'
import {
  isClassroomArchiveRestoreAllowed,
  resolveClassroomArchiveRestoreDatabaseBudget,
} from '@/lib/server/classroom-archive-restore-operations'
import { getServiceRoleClient } from '@/lib/supabase'

type SupabaseClient = ReturnType<typeof getServiceRoleClient>

export type TeacherColdArchiveListResult =
  | {
      ok: true
      cold_archives: ClassroomColdArchiveSummary[]
      cold_archive_restore_enabled: boolean
      migration_ready: boolean
    }
  | {
      ok: false
      error_code: 'cold_archive_list_failed' | 'cold_archive_list_contract_invalid'
    }

function isMissingColdArchiveTable(error: { code?: string } | null | undefined): boolean {
  return error?.code === 'PGRST205' || error?.code === '42P01'
}

function isRestoreConfiguredForTeacher(teacherId: string): boolean {
  if (!isClassroomArchiveRestoreAllowed(teacherId)) return false
  try {
    resolveClassroomArchiveRestoreDatabaseBudget()
    return true
  } catch {
    return false
  }
}

export async function listTeacherColdClassroomArchives(args: {
  supabase: SupabaseClient
  teacherId: string
}): Promise<TeacherColdArchiveListResult> {
  const teacherId = z.string().uuid().parse(args.teacherId)
  const response = await args.supabase
    .from('classroom_cold_tombstones')
    .select('classroom_id,archive_id,title,archived_at,compacted_at')
    .eq('teacher_id', teacherId)
    .order('compacted_at', { ascending: false })

  if (response.error) {
    if (isMissingColdArchiveTable(response.error)) {
      return {
        ok: true,
        cold_archives: [],
        cold_archive_restore_enabled: false,
        migration_ready: false,
      }
    }
    return { ok: false, error_code: 'cold_archive_list_failed' }
  }

  const parsed = z.array(classroomColdArchiveSummarySchema).safeParse(response.data || [])
  if (!parsed.success) {
    return { ok: false, error_code: 'cold_archive_list_contract_invalid' }
  }

  return {
    ok: true,
    cold_archives: parsed.data,
    cold_archive_restore_enabled: isRestoreConfiguredForTeacher(teacherId),
    migration_ready: true,
  }
}
