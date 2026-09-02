import { NextResponse } from 'next/server'
import { ApiError, withErrorHandler } from '@/lib/api-handler'
import { requireRole } from '@/lib/auth'
import { getServiceRoleClient } from '@/lib/supabase'
import { assertTeacherCanMutateClassroom } from '@/lib/server/classrooms'
import { assertBaraAttendanceClassroomAccess } from '@/lib/server/bara-attendance-scope'
import { BaraAttendanceCanaryError } from '@/lib/server/bara-attendance-canary'
import {
  ClassroomAttendanceQrError,
  loadTeacherClassroomQrPresentation,
  rotateTeacherClassroomQrPresentation,
} from '@/lib/server/classroom-attendance-qr'
import {
  rotateTeacherClassroomQrSchema,
  teacherClassroomQrQuerySchema,
} from '@/lib/validations/classroom-attendance-qr'

export const dynamic = 'force-dynamic'
export const revalidate = 0

function mapError(error: unknown): never {
  if (error instanceof BaraAttendanceCanaryError) {
    throw new ApiError(error.code === 'disabled' ? 404 : 503, error.code === 'disabled'
      ? 'Attendance is not enabled for this classroom'
      : 'Attendance is temporarily unavailable')
  }
  if (error instanceof ClassroomAttendanceQrError) {
    if (error.code === 'conflict') {
      throw new ApiError(409, 'The classroom QR changed. Reload it before rotating again')
    }
    if (error.code === 'migration_required') {
      throw new ApiError(503, 'Permanent classroom QR setup is not available yet')
    }
    throw new ApiError(503, 'Permanent classroom QR is temporarily unavailable')
  }
  throw error
}

async function authorize(userId: string, classroomId: string, supabase: any) {
  const ownership = await assertTeacherCanMutateClassroom(userId, classroomId, { supabase })
  if (!ownership.ok) throw new ApiError(ownership.status, ownership.error)
  await assertBaraAttendanceClassroomAccess({
    supabase,
    teacherId: userId,
    classroomId,
  })
}

export const GET = withErrorHandler('GetTeacherClassroomAttendanceQr', async (request) => {
  const user = await requireRole('teacher')
  const { classroom_id: classroomId } = teacherClassroomQrQuerySchema.parse(
    Object.fromEntries(new URL(request.url).searchParams),
  )
  const supabase = getServiceRoleClient()
  try {
    await authorize(user.id, classroomId, supabase)
    const presentation = await loadTeacherClassroomQrPresentation({ supabase, classroomId })
    return NextResponse.json(presentation, {
      headers: { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' },
    })
  } catch (error) {
    mapError(error)
  }
})

export const POST = withErrorHandler('RotateTeacherClassroomAttendanceQr', async (request) => {
  const user = await requireRole('teacher')
  const input = rotateTeacherClassroomQrSchema.parse(await request.json())
  const supabase = getServiceRoleClient()
  try {
    await authorize(user.id, input.classroom_id, supabase)
    const presentation = await rotateTeacherClassroomQrPresentation({
      supabase,
      classroomId: input.classroom_id,
      expectedGeneration: input.expected_generation,
    })
    return NextResponse.json(presentation, {
      headers: { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' },
    })
  } catch (error) {
    mapError(error)
  }
})
