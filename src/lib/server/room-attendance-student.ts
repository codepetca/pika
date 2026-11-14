import { z } from 'zod'
import { postBaraRoomCommand } from '@/lib/server/bara-attendance-client'
import { sealAttendanceEntryToken } from '@/lib/server/bara-attendance-entry-token'
import { executeStudentAttendanceCheckIn, type StudentAttendanceCheckInView } from '@/lib/server/bara-attendance-student'
import { getBaraAttendanceClassroomIdAccess } from '@/lib/server/bara-attendance-scope'
import { assertStudentRosterBoundary, ClassroomAttendanceQrError } from '@/lib/server/classroom-attendance-qr'

export const roomCookieName = 'pika_room_attendance'
export const roomIdSchema = z.string().regex(/^[A-Za-z0-9]{16,64}$/)
export const roomCookieSchema = z.object({
  roomId: roomIdSchema,
  scanId: z.string().uuid(),
  continuation: z.string().regex(/^[A-Za-z0-9_-]{40}$/),
  browserKey: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
}).strict()

export async function checkInRoom(input: {
  supabase: any
  pikaUser: { id: string; email: string; role: string }
  roomId: string
  continuation: string
  browserKey: string
  attemptId: string
}) {
  const result = await postBaraRoomCommand({ operation: 'candidates', room_id: input.roomId,
    continuation: input.continuation, browser_key: input.browserKey })
  if (!result.candidates) return null
  const unique = new Map(result.candidates.map(candidate =>
    [`${candidate.roster_ref}\0${candidate.occurrence_ref}`, candidate]))
  const results = await Promise.allSettled([...unique.values()].map(async (candidate): Promise<StudentAttendanceCheckInView | null> => {
    const { data, error } = await input.supabase.from('attendance_roster_mappings')
      .select('classroom_id').eq('roster_ref', candidate.roster_ref).maybeSingle()
    if (error) throw new Error('Attendance unavailable')
    const mapping = z.object({ classroom_id: z.string().uuid() }).strict().safeParse(data)
    if (!mapping.success) return null
    const access = await getBaraAttendanceClassroomIdAccess({ supabase: input.supabase, classroomId: mapping.data.classroom_id })
    if (access.state !== 'ready') return null
    try {
      await assertStudentRosterBoundary({ supabase: input.supabase, classroomId: mapping.data.classroom_id,
        studentId: input.pikaUser.id, studentEmail: input.pikaUser.email })
    } catch (error) {
      if (error instanceof ClassroomAttendanceQrError && ['not_enrolled', 'not_on_roster', 'roster_ambiguous'].includes(error.code)) return null
      throw error
    }
    const entryToken = sealAttendanceEntryToken({ classroomId: mapping.data.classroom_id,
      rosterRef: candidate.roster_ref, occurrenceRef: candidate.occurrence_ref,
      checkInToken: `room_${input.continuation}.${input.browserKey}`,
      expiresAt: new Date(Date.now() + 60_000).toISOString() })
    try {
      return await executeStudentAttendanceCheckIn({ supabase: input.supabase, pikaUser: input.pikaUser,
        entryToken, attemptId: input.attemptId, requireActiveMembership: true })
    } catch (error) {
      const { data } = await input.supabase.from('classrooms').select('title').eq('id', mapping.data.classroom_id).maybeSingle()
      if (typeof data?.title !== 'string') throw error
      return { state: 'needs_staff', title: 'Could not confirm check-in',
        description: 'Try again or ask your teacher to check your attendance.', classroomName: data.title }
    }
  }))
  const confirmed = results.flatMap(result => result.status === 'fulfilled' && result.value ? [result.value] : [])
  const failure = results.find(result => result.status === 'rejected')
  if (failure && confirmed.length === 0) throw failure.reason
  return failure ? [...confirmed, {
    state: 'needs_staff' as const, title: 'Could not confirm every class',
    description: 'Try again to confirm the rest of your attendance.',
  }] : confirmed
}
