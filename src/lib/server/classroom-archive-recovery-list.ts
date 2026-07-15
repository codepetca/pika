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

export type TeacherArchivedClassroomListResult =
  | {
      ok: true
      hot_classrooms: Record<string, unknown>[]
      cold_archives: ClassroomColdArchiveSummary[]
      cold_archive_restore_enabled: boolean
    }
  | {
      ok: false
      error_code:
        | 'hot_archive_list_failed'
        | 'cold_archive_list_failed'
        | 'cold_archive_list_contract_invalid'
        | 'classroom_archive_state_unstable'
    }

const STABLE_ARCHIVE_READ_MAX_ATTEMPTS = 2

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

function coldArchiveSnapshot(archives: ClassroomColdArchiveSummary[]): string {
  return archives
    .map((archive) => `${archive.classroom_id}:${archive.archive_id}:${archive.compacted_at}`)
    .sort()
    .join('\n')
}

async function listTeacherHotClassroomArchives(args: {
  supabase: SupabaseClient
  teacherId: string
}) {
  return args.supabase
    .from('classrooms')
    .select('*')
    .eq('teacher_id', args.teacherId)
    .not('archived_at', 'is', null)
    .order('archived_at', { ascending: false })
}

export async function listTeacherArchivedClassrooms(args: {
  supabase: SupabaseClient
  teacherId: string
}): Promise<TeacherArchivedClassroomListResult> {
  const teacherId = z.string().uuid().parse(args.teacherId)

  for (let attempt = 0; attempt < STABLE_ARCHIVE_READ_MAX_ATTEMPTS; attempt += 1) {
    const coldBefore = await listTeacherColdClassroomArchives({
      supabase: args.supabase,
      teacherId,
    })
    if (!coldBefore.ok) return coldBefore

    const hot = await listTeacherHotClassroomArchives({
      supabase: args.supabase,
      teacherId,
    })
    if (hot.error) return { ok: false, error_code: 'hot_archive_list_failed' }

    if (!coldBefore.migration_ready) {
      return {
        ok: true,
        hot_classrooms: (hot.data || []) as Record<string, unknown>[],
        cold_archives: [],
        cold_archive_restore_enabled: false,
      }
    }

    // A lifecycle transition inserts or deletes a tombstone atomically with the hot row.
    // Bracketing the hot query prevents one response from mixing opposite sides of that commit.
    const coldAfter = await listTeacherColdClassroomArchives({
      supabase: args.supabase,
      teacherId,
    })
    if (!coldAfter.ok) return coldAfter

    if (
      coldArchiveSnapshot(coldBefore.cold_archives)
      === coldArchiveSnapshot(coldAfter.cold_archives)
    ) {
      return {
        ok: true,
        hot_classrooms: (hot.data || []) as Record<string, unknown>[],
        cold_archives: coldAfter.cold_archives,
        cold_archive_restore_enabled: coldAfter.cold_archive_restore_enabled,
      }
    }
  }

  return { ok: false, error_code: 'classroom_archive_state_unstable' }
}
