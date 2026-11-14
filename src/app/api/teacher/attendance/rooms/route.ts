import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole } from '@/lib/auth'
import { ApiError, withErrorHandler } from '@/lib/api-handler'
import { getServiceRoleClient } from '@/lib/supabase'
import { assertTeacherCanMutateClassroom } from '@/lib/server/classrooms'
import { assertBaraAttendanceClassroomAccess } from '@/lib/server/bara-attendance-scope'
import { resolveVerifiedPikaAttendanceTeacher } from '@/lib/server/bara-attendance-teacher'
import { BaraAttendanceClientError, isBaraRoomAttendanceConfigured, postBaraRoomCommand, type BaraRoomCommand } from '@/lib/server/bara-attendance-client'

const ref = z.string().regex(/^[A-Za-z0-9._~-]{1,128}$/)
const commandSchema = z.object({
  classroom_id: z.string().uuid(), date: z.string().date().optional(),
  operation: z.enum(['list', 'create', 'pair', 'revoke', 'default', 'move', 'undo', 'notices']),
  room_id: ref.nullable().optional(), label: z.string().trim().min(1).max(80).optional(),
  revision: z.number().int().nonnegative().optional(), save_default: z.boolean().optional(),
  notices: z.array(z.string().trim().min(1).max(200)).max(10).optional(),
}).strict().superRefine((input, ctx) => {
  const bad = (path: string) => ctx.addIssue({ code: 'custom', path: [path], message: 'Required for this operation' })
  if (['pair', 'revoke', 'move', 'notices'].includes(input.operation) && !input.room_id) bad('room_id')
  if (input.operation === 'default' && input.room_id === undefined) bad('room_id')
  if (input.operation === 'create' && !input.label) bad('label')
  if (['move', 'undo'].includes(input.operation) && !input.date) bad('date')
  if (input.operation === 'undo' && input.revision === undefined) bad('revision')
  if (input.operation === 'notices' && !input.notices) bad('notices')
})

export const POST = withErrorHandler('TeacherAttendanceRooms', async request => {
  const user = await requireRole('teacher')
  if (!isBaraRoomAttendanceConfigured()) throw new ApiError(404, 'Room attendance is not available')
  const input = commandSchema.parse(await request.json())
  const supabase = getServiceRoleClient()
  const ownership = await assertTeacherCanMutateClassroom(user.id, input.classroom_id, { supabase })
  if (!ownership.ok) throw new ApiError(ownership.status, ownership.error)
  await assertBaraAttendanceClassroomAccess({ supabase, teacherId: user.id, classroomId: input.classroom_id })
  const actor = await resolveVerifiedPikaAttendanceTeacher({ supabase, pikaUser: user })
  const [principal, roster, occurrence] = await Promise.all([
    supabase.from('attendance_principal_mappings').select('principal_ref').eq('user_id', user.id).maybeSingle(),
    supabase.from('attendance_roster_mappings').select('roster_ref').eq('classroom_id', input.classroom_id).maybeSingle(),
    input.date ? supabase.from('attendance_occurrence_mappings').select('occurrence_ref').eq('classroom_id', input.classroom_id).eq('class_date', input.date).maybeSingle() : Promise.resolve({ data: null, error: null }),
  ])
  if (principal.error || roster.error || occurrence.error) throw new ApiError(503, 'Attendance is temporarily unavailable')
  const principalRef = ref.safeParse(principal.data?.principal_ref)
  const rosterRef = ref.safeParse(roster.data?.roster_ref)
  const occurrenceRef = ref.safeParse(occurrence.data?.occurrence_ref)
  if (!principalRef.success || !rosterRef.success) throw new ApiError(409, 'Attendance setup is still syncing')
  if (['move', 'undo'].includes(input.operation) && !occurrenceRef.success) throw new ApiError(409, 'Attendance is not scheduled for this date')
  const staff = { roster_ref: rosterRef.data, actor_principal_ref: principalRef.data, actor_display_name: actor.displayName }
  let command: BaraRoomCommand
  switch (input.operation) {
    case 'list': command = { ...staff, operation: 'list', ...(occurrenceRef.success ? { occurrence_ref: occurrenceRef.data } : {}) }; break
    case 'create': command = { ...staff, operation: 'create', label: input.label! }; break
    case 'pair': command = { ...staff, operation: 'pair', room_id: input.room_id! }; break
    case 'revoke': command = { ...staff, operation: 'revoke', room_id: input.room_id! }; break
    case 'default': command = { ...staff, operation: 'default', room_id: input.room_id! }; break
    case 'move': command = { ...staff, operation: 'move', room_id: input.room_id!, occurrence_ref: occurrenceRef.data!, ...(input.save_default !== undefined ? { save_default: input.save_default } : {}) }; break
    case 'undo': command = { ...staff, operation: 'undo', occurrence_ref: occurrenceRef.data!, revision: input.revision! }; break
    case 'notices': command = { ...staff, operation: 'notices', room_id: input.room_id!, notices: input.notices! }; break
  }
  let result
  try { result = await postBaraRoomCommand(command) }
  catch (error) {
    if (error instanceof BaraAttendanceClientError) {
      if (error.code === 'room_unpaired') throw new ApiError(409, 'Pair the room display before assigning this room')
      if (error.status === 409) throw new ApiError(409, 'Attendance changed or this meeting is not open. Refresh and try again')
      if (error.status === 403 || error.status === 404) throw new ApiError(403, 'This room is not available to this class')
      throw new ApiError(503, 'Room attendance is temporarily unavailable')
    }
    throw error
  }
  return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } })
})
