import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { ApiError, withErrorHandler } from '@/lib/api-handler'
import { getServiceRoleClient } from '@/lib/supabase'
import { assertTeacherCanMutateClassroom, assertTeacherOwnsClassroom } from '@/lib/server/classrooms'
import {
  loadManualAttendanceView,
  ManualAttendanceStoreError,
  saveManualAttendanceMarks,
  saveManualAttendanceSettings,
} from '@/lib/server/manual-attendance'
import {
  manualAttendanceMarksSchema,
  manualAttendanceSettingsSchema,
  manualAttendanceViewQuerySchema,
} from '@/lib/validations/manual-attendance'

export const dynamic = 'force-dynamic'
export const revalidate = 0

function mapStoreError(error: unknown): never {
  if (error instanceof ManualAttendanceStoreError) {
    if (error.code === 'migration_required') {
      throw new ApiError(503, 'Manual attendance is not available until its Pika migration is applied')
    }
    if (error.code === 'roster_changed') {
      throw new ApiError(409, 'The roster changed; refresh and try again')
    }
    if (error.code === 'stale_revision') {
      throw new ApiError(409, 'Manual attendance settings changed; refresh and try again')
    }
    throw new ApiError(503, 'Manual attendance is temporarily unavailable')
  }
  throw error
}

export const GET = withErrorHandler('GetTeacherManualAttendance', async (request) => {
  const user = await requireRole('teacher')
  const input = manualAttendanceViewQuerySchema.parse(
    Object.fromEntries(new URL(request.url).searchParams),
  )
  const supabase = getServiceRoleClient()
  const ownership = await assertTeacherOwnsClassroom(user.id, input.classroom_id, { supabase })
  if (!ownership.ok) throw new ApiError(ownership.status, ownership.error)

  try {
    return NextResponse.json(await loadManualAttendanceView({
      supabase,
      classroomId: input.classroom_id,
      classDate: input.date,
    }))
  } catch (error) {
    mapStoreError(error)
  }
})

export const PUT = withErrorHandler('PutTeacherManualAttendanceSettings', async (request) => {
  const user = await requireRole('teacher')
  const input = manualAttendanceSettingsSchema.parse(await request.json())
  const supabase = getServiceRoleClient()
  const ownership = await assertTeacherCanMutateClassroom(user.id, input.classroom_id, { supabase })
  if (!ownership.ok) throw new ApiError(ownership.status, ownership.error)

  try {
    const settings = await saveManualAttendanceSettings({
      supabase,
      teacherId: user.id,
      classroomId: input.classroom_id,
      expectedRevision: input.expected_revision,
      sourceMode: input.source_mode,
      sessionStartsLocal: input.session_starts_local,
      sessionEndsLocal: input.session_ends_local,
    })
    return NextResponse.json({ settings })
  } catch (error) {
    mapStoreError(error)
  }
})

export const POST = withErrorHandler('PostTeacherManualAttendanceMarks', async (request) => {
  const user = await requireRole('teacher')
  const input = manualAttendanceMarksSchema.parse(await request.json())
  const supabase = getServiceRoleClient()
  const ownership = await assertTeacherCanMutateClassroom(user.id, input.classroom_id, { supabase })
  if (!ownership.ok) throw new ApiError(ownership.status, ownership.error)

  try {
    await saveManualAttendanceMarks({
      supabase,
      teacherId: user.id,
      classroomId: input.classroom_id,
      classDate: input.date,
      studentIds: input.student_ids,
      status: input.status,
    })
    return NextResponse.json({ ok: true })
  } catch (error) {
    mapStoreError(error)
  }
})
