import { NextRequest, NextResponse } from 'next/server'
import { getServiceRoleClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'
import { withErrorHandler, ApiError } from '@/lib/api-handler'
import { createClassroomSchema } from '@/lib/validations/teacher'
import { listActiveTeacherClassrooms } from '@/lib/server/classroom-order'
import { hydrateClassroomRecord, hydrateClassroomRecords } from '@/lib/server/classrooms'
import { listTeacherArchivedClassrooms } from '@/lib/server/classroom-archive-recovery-list'
import { listTeacherHotArchiveRecovery } from '@/lib/server/classroom-archive-status'
import {
  listColdClassroomPurgeEnabledIds,
  listHotClassroomPurgeEnabledIds,
} from '@/lib/server/classroom-purge-availability'
import { getLeastUsedClassroomThemeColor } from '@/lib/classroom-theme'
import { observeClassroomCreationShadow } from '@/lib/server/classroom-access-shadow'
import {
  createClassroomAtomic,
  mapClassroomCreationDatabaseError,
  resolveClassroomCreationOperationId,
} from '@/lib/server/classroom-creation-entitlement'

export const dynamic = 'force-dynamic'
export const revalidate = 0

// Generate a random 6-character alphanumeric class code
function generateClassCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // Exclude ambiguous chars
  let code = ''
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return code
}

// GET /api/teacher/classrooms - List teacher's classrooms
export const GET = withErrorHandler('GetTeacherClassrooms', async (request: NextRequest) => {
  const user = await requireRole('teacher')
  const supabase = getServiceRoleClient()
  const { searchParams } = new URL(request.url)
  const archivedParam = searchParams.get('archived')

  if (archivedParam === 'true') {
    const archived = await listTeacherArchivedClassrooms({ supabase, teacherId: user.id })
    if (!archived.ok) {
      console.error('Error fetching archived classroom state:', archived.error_code)
      const status = archived.error_code === 'classroom_archive_state_unstable' ? 503 : 500
      throw new ApiError(status, 'Failed to fetch classroom archives')
    }

    const hotClassroomIds = archived.hot_classrooms.flatMap((classroom) =>
      typeof classroom.id === 'string' ? [classroom.id] : [],
    )
    const [hotClassroomPurgeEnabledIds, coldClassroomPurgeEnabledIds, hotArchiveRecovery] = await Promise.all([
      listHotClassroomPurgeEnabledIds({
        supabase,
        teacherId: user.id,
        hotClassroomIds,
      }),
      listColdClassroomPurgeEnabledIds({
        supabase,
        teacherId: user.id,
        coldClassroomIds: archived.cold_archives.map((archive) => archive.classroom_id),
      }),
      listTeacherHotArchiveRecovery({
        supabase,
        teacherId: user.id,
        classroomIds: hotClassroomIds,
      }),
    ])
    if (!hotArchiveRecovery.ok) {
      console.error('Error fetching hot classroom archive recovery state:', hotArchiveRecovery.error_code)
    }

    return NextResponse.json({
      classrooms: hydrateClassroomRecords(archived.hot_classrooms as Record<string, any>[]),
      cold_archives: archived.cold_archives,
      cold_archive_restore_enabled: archived.cold_archive_restore_enabled,
      hot_classroom_purge_enabled_ids: hotClassroomPurgeEnabledIds,
      cold_classroom_purge_enabled_ids: coldClassroomPurgeEnabledIds,
      hot_archive_recovery: hotArchiveRecovery.summaries,
      hot_archive_recovery_status_available: hotArchiveRecovery.ok,
    })
  }

  const { data: classrooms, error } = await listActiveTeacherClassrooms(supabase, user.id)
  if (error) {
    console.error('Error fetching classrooms:', error)
    throw new ApiError(500, 'Failed to fetch classrooms')
  }

  return NextResponse.json({
    classrooms: hydrateClassroomRecords((classrooms || []) as Record<string, any>[]),
  })
})

// POST /api/teacher/classrooms - Create classroom
export const POST = withErrorHandler('CreateClassroom', async (request: NextRequest) => {
  const user = await requireRole('teacher')
  observeClassroomCreationShadow(user)
  const { title, classCode, termLabel, themeColor } = createClassroomSchema.parse(await request.json())

  const supabase = getServiceRoleClient()

  const finalClassCode = classCode || generateClassCode()
  const activeClassroomsResult = themeColor ? null : await listActiveTeacherClassrooms(supabase, user.id)
  const defaultThemeColor = getLeastUsedClassroomThemeColor(
    (activeClassroomsResult?.data || []).map((classroom: any) => classroom.theme_color),
    `${user.id}:${title}`
  )
  const operationId = resolveClassroomCreationOperationId(
    request.headers.get('idempotency-key'),
  )
  const outcome = await createClassroomAtomic({
    operationId,
    teacherId: user.id,
    request: { title, classCode, termLabel, themeColor },
    resolvedClassCode: finalClassCode,
    resolvedThemeColor: themeColor || defaultThemeColor,
    supabase,
  })

  if (outcome.kind === 'database_error') {
    const denial = mapClassroomCreationDatabaseError(outcome.error)
    if (denial) {
      return NextResponse.json({
        error: denial.message,
        error_code: denial.errorCode,
        retryable: denial.retryable,
      }, { status: denial.status })
    }
    console.error('Error creating classroom:', outcome.error)
    throw new ApiError(500, 'Failed to create classroom')
  }

  if (outcome.kind === 'contract_unavailable') {
    return NextResponse.json({
      error: 'Classroom creation is temporarily unavailable. Please try again.',
      error_code: 'classroom_creation_contract_unavailable',
      retryable: true,
    }, { status: 503 })
  }

  if (!outcome.result.ok) {
    const message = outcome.result.error_code === 'classroom_creation_idempotency_conflict'
      ? 'This classroom creation request conflicts with an earlier attempt.'
      : 'The original classroom creation result is no longer available.'
    return NextResponse.json({
      error: message,
      error_code: outcome.result.error_code,
      retryable: outcome.result.retryable,
      operation_id: outcome.result.operation_id,
    }, { status: outcome.result.status })
  }

  return NextResponse.json({
    classroom: hydrateClassroomRecord(outcome.result.classroom),
    operation_id: outcome.result.operation_id,
    replayed: outcome.result.replayed,
  }, { status: 201 })
})
