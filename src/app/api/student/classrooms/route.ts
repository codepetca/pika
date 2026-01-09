import { NextResponse } from 'next/server'
import { getServiceRoleClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'

export const dynamic = 'force-dynamic'
export const revalidate = 0

// GET /api/student/classrooms - List student's enrolled classrooms
export async function GET() {
  try {
    const user = await requireRole('student')
    const supabase = getServiceRoleClient()

    const { data: enrollments, error } = await supabase
      .from('classroom_enrollments')
      .select(`
        id,
        created_at,
        classrooms!inner(
          id,
          title,
          class_code,
          term_label,
          updated_at
        )
      `)
      .eq('student_id', user.id)
      .is('classrooms.archived_at', null)
      .order('created_at', { ascending: false })

    if (error) {
      console.error('Error fetching classrooms:', error)
      return NextResponse.json(
        { error: 'Failed to fetch classrooms' },
        { status: 500 }
      )
    }

    const classrooms = (enrollments ?? []).map(e => ({
      ...e.classrooms,
      enrollmentId: e.id,
      enrolledAt: e.created_at,
    }))

    return NextResponse.json({ classrooms })
  } catch (error: any) {
    // Authentication error (401)
    if (error.name === 'AuthenticationError') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Authorization error (403)
    if (error.name === 'AuthorizationError') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // All other errors (500)
    console.error('Get student classrooms error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
