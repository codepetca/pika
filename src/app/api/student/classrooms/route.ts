import { NextResponse} from 'next/server'
import { getServiceRoleClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'

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
      .order('created_at', { ascending: false })

    if (error) {
      console.error('Error fetching classrooms:', error)
      return NextResponse.json(
        { error: 'Failed to fetch classrooms' },
        { status: 500 }
      )
    }

    const classrooms = enrollments.map(e => ({
      ...e.classrooms,
      enrollmentId: e.id,
      enrolledAt: e.created_at,
    }))

    return NextResponse.json({ classrooms })
  } catch (error: any) {
    console.error('Get student classrooms error:', error)
    return NextResponse.json(
      { error: error.message || 'Unauthorized' },
      { status: 401 }
    )
  }
}
