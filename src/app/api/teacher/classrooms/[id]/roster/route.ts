import { NextRequest, NextResponse } from 'next/server'
import { getServiceRoleClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'
import { assertTeacherOwnsClassroom } from '@/lib/server/classrooms'

export const dynamic = 'force-dynamic'
export const revalidate = 0

// GET /api/teacher/classrooms/[id]/roster - Get classroom roster
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const user = await requireRole('teacher')
    const classroomId = params.id

    const supabase = getServiceRoleClient()

    const ownership = await assertTeacherOwnsClassroom(user.id, classroomId)
    if (!ownership.ok) {
      return NextResponse.json(
        { error: ownership.error },
        { status: ownership.status }
      )
    }

    const { data: rosterRows, error: rosterError } = await supabase
      .from('classroom_roster')
      .select('id, email, student_number, first_name, last_name, counselor_email, created_at, updated_at')
      .eq('classroom_id', classroomId)

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

    const joinedByEmail = new Map<string, { student_id: string; created_at: string }>()
    for (const e of enrollments || []) {
      const email = (e as any)?.users?.email
      if (!email) continue
      joinedByEmail.set(String(email).toLowerCase().trim(), {
        student_id: (e as any).student_id,
        created_at: (e as any).created_at,
      })
    }

    const roster = (rosterRows || []).map((r: any) => {
      const email = String(r.email || '').toLowerCase().trim()
      const joined = joinedByEmail.get(email)
      return {
        id: r.id,
        email: r.email,
        student_number: r.student_number ?? null,
        first_name: r.first_name ?? null,
        last_name: r.last_name ?? null,
        counselor_email: r.counselor_email ?? null,
        created_at: r.created_at,
        updated_at: r.updated_at,
        joined: !!joined,
        student_id: joined?.student_id ?? null,
        joined_at: joined?.created_at ?? null,
      }
    })

    return NextResponse.json({ roster })
  } catch (error: any) {
    if (error.name === 'AuthenticationError') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (error.name === 'AuthorizationError') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    console.error('Get roster error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
