import { NextRequest, NextResponse } from 'next/server'
import { getServiceRoleClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'
import { assertTeacherOwnsClassroom } from '@/lib/server/classrooms'
import { withErrorHandler } from '@/lib/api-handler'
import { getStudentPurgeEnabledStudentIds } from '@/lib/server/student-purge'

export const dynamic = 'force-dynamic'
export const revalidate = 0

// GET /api/teacher/classrooms/[id]/roster - Get classroom roster
export const GET = withErrorHandler('GetClassroomRoster', async (_request, context) => {
  const user = await requireRole('teacher')
  const { id: classroomId } = await context.params

  const supabase = getServiceRoleClient()

  const ownership = await assertTeacherOwnsClassroom(user.id, classroomId)
  if (!ownership.ok) {
    return NextResponse.json(
      { error: ownership.error },
      { status: ownership.status }
    )
  }

  const rosterResponse = await supabase
    .from('classroom_roster')
    .select('id, email, student_number, first_name, last_name, counselor_email, join_source, created_at, updated_at')
    .eq('classroom_id', classroomId)
  const { data: rosterRows, error: rosterError } = rosterResponse

  if (rosterError) {
    console.error('Error fetching roster:', rosterError)
    return NextResponse.json(
      { error: 'Failed to fetch roster' },
      { status: 500 }
    )
  }

  const { data: enrollments, error: enrollmentsError } = await supabase
    .from('classroom_enrollments')
    .select(`
      student_id,
      created_at,
      users!classroom_enrollments_student_id_fkey(email)
    `)
    .eq('classroom_id', classroomId)

  if (enrollmentsError) {
    console.error('Error fetching enrollments:', enrollmentsError)
    return NextResponse.json(
      { error: 'Failed to fetch roster' },
      { status: 500 }
    )
  }

  const bindingsResponse = await supabase
    .from('classroom_roster_student_bindings')
    .select('roster_id, student_id')
    .eq('classroom_id', classroomId)
  const bindingsUnavailable = bindingsResponse.error
    && ['PGRST205', '42P01'].includes(bindingsResponse.error.code || '')
  if (bindingsResponse.error && !bindingsUnavailable) {
    console.error('Error fetching roster student bindings:', bindingsResponse.error)
    return NextResponse.json(
      { error: 'Failed to fetch roster' },
      { status: 500 }
    )
  }

  const joinedByEmail = new Map<string, { student_id: string; created_at: string }>()
  const joinedByStudentId = new Map<string, { student_id: string; created_at: string }>()
  const studentIdByRosterId = new Map(
    (bindingsResponse.data || []).map((binding) => [binding.roster_id, binding.student_id]),
  )
  for (const e of enrollments || []) {
    const email = (e as any)?.users?.email
    if (!email) continue
    const joined = {
      student_id: (e as any).student_id,
      created_at: (e as any).created_at,
    }
    joinedByEmail.set(String(email).toLowerCase().trim(), joined)
    joinedByStudentId.set(joined.student_id, joined)
  }

  const roster = (rosterRows || []).map((r: any) => {
    const email = String(r.email || '').toLowerCase().trim()
    const boundStudentId = studentIdByRosterId.get(String(r.id))
    const joined = boundStudentId
      ? joinedByStudentId.get(boundStudentId)
      : joinedByEmail.get(email)
    const stableJoinedStudentId = boundStudentId
      ? joined?.student_id
      : bindingsUnavailable ? joined?.student_id : undefined
    return {
      id: r.id,
      email: r.email,
      student_number: r.student_number ?? null,
      first_name: r.first_name ?? null,
      last_name: r.last_name ?? null,
      counselor_email: r.counselor_email ?? null,
      join_source: r.join_source === 'open_join' || r.join_source === 'csv' ? r.join_source : 'manual',
      created_at: r.created_at,
      updated_at: r.updated_at,
      joined: !!joined,
      student_id: stableJoinedStudentId ?? null,
      joined_at: joined?.created_at ?? null,
    }
  })

  const studentPurgeEnabledIds = await getStudentPurgeEnabledStudentIds(
    user.id,
    classroomId,
    roster.flatMap((row) => row.student_id ? [row.student_id] : []),
  )

  return NextResponse.json({ roster, student_purge_enabled_ids: studentPurgeEnabledIds })
})
