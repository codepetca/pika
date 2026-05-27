import { NextRequest, NextResponse } from 'next/server'
import { getServiceRoleClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'
import { withErrorHandler } from '@/lib/api-handler'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/**
 * GET /api/teacher/entry/[id]
 * Fetches a specific entry (for teacher to view)
 */
export const GET = withErrorHandler('GetTeacherEntry', async (_request, context) => {
  const user = await requireRole('teacher')

  const { id } = await context.params
  const supabase = getServiceRoleClient()

  const { data: entry, error } = await supabase
    .from('entries')
    .select(`
      *,
      student:users!student_id(email),
      classroom:classrooms!inner(teacher_id)
    `)
    .eq('id', id)
    .single()

  if (error) {
    if (error.code === 'PGRST116') {
      return NextResponse.json(
        { error: 'Entry not found' },
        { status: 404 }
      )
    }

    console.error('Error fetching entry:', error)
    return NextResponse.json(
      { error: 'Failed to fetch entry' },
      { status: 500 }
    )
  }

  const classroom = Array.isArray(entry.classroom) ? entry.classroom[0] : entry.classroom
  if (!classroom || classroom.teacher_id !== user.id) {
    return NextResponse.json(
      { error: 'Forbidden' },
      { status: 403 }
    )
  }

  const { classroom: _classroom, ...safeEntry } = entry
  return NextResponse.json({ entry: safeEntry })
})
