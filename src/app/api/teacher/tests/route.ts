import { NextRequest, NextResponse } from 'next/server'
import { getServiceRoleClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'
import { assertTeacherCanMutateClassroom, assertTeacherOwnsClassroom } from '@/lib/server/classrooms'

export const dynamic = 'force-dynamic'
export const revalidate = 0

// GET /api/teacher/tests?classroom_id=xxx - List tests for a classroom
export async function GET(request: NextRequest) {
  try {
    const user = await requireRole('teacher')
    const { searchParams } = new URL(request.url)
    const classroomId = searchParams.get('classroom_id')

    if (!classroomId) {
      return NextResponse.json(
        { error: 'classroom_id is required' },
        { status: 400 }
      )
    }

    const ownership = await assertTeacherOwnsClassroom(user.id, classroomId)
    if (!ownership.ok) {
      return NextResponse.json(
        { error: ownership.error },
        { status: ownership.status }
      )
    }

    const supabase = getServiceRoleClient()

    const { data: tests, error: testsError } = await supabase
      .from('tests')
      .select('*')
      .eq('classroom_id', classroomId)
      .order('position', { ascending: true })
      .order('created_at', { ascending: true })

    if (testsError) {
      if (testsError.code === 'PGRST205') {
        return NextResponse.json({ quizzes: [], migration_required: true })
      }
      console.error('Error fetching tests:', testsError)
      return NextResponse.json({ error: 'Failed to fetch tests' }, { status: 500 })
    }

    const { count: totalStudents } = await supabase
      .from('classroom_enrollments')
      .select('*', { count: 'exact', head: true })
      .eq('classroom_id', classroomId)

    const testIds = (tests || []).map((t) => t.id)

    const questionCountMap: Record<string, number> = {}
    if (testIds.length > 0) {
      const { data: questionRows } = await supabase
        .from('test_questions')
        .select('test_id')
        .in('test_id', testIds)

      for (const row of questionRows || []) {
        questionCountMap[row.test_id] = (questionCountMap[row.test_id] || 0) + 1
      }
    }

    const respondentCountMap: Record<string, number> = {}
    if (testIds.length > 0) {
      const { data: responseRows } = await supabase
        .from('test_responses')
        .select('test_id, student_id')
        .in('test_id', testIds)

      const seen: Record<string, Set<string>> = {}
      for (const row of responseRows || []) {
        if (!seen[row.test_id]) seen[row.test_id] = new Set()
        seen[row.test_id].add(row.student_id)
      }
      for (const [testId, students] of Object.entries(seen)) {
        respondentCountMap[testId] = students.size
      }
    }

    const testsWithStats = (tests || []).map((test) => ({
      ...test,
      assessment_type: 'test' as const,
      stats: {
        total_students: totalStudents || 0,
        responded: respondentCountMap[test.id] || 0,
        questions_count: questionCountMap[test.id] || 0,
      },
    }))

    // Keep response key as `quizzes` for current UI component compatibility.
    return NextResponse.json({ quizzes: testsWithStats })
  } catch (error: any) {
    if (error.name === 'AuthenticationError') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (error.name === 'AuthorizationError') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    console.error('Get tests error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// POST /api/teacher/tests - Create a new test
export async function POST(request: NextRequest) {
  try {
    const user = await requireRole('teacher')
    const body = await request.json()
    const { classroom_id, title } = body

    if (!classroom_id) {
      return NextResponse.json({ error: 'classroom_id is required' }, { status: 400 })
    }
    if (!title || !title.trim()) {
      return NextResponse.json({ error: 'Title is required' }, { status: 400 })
    }

    const ownership = await assertTeacherCanMutateClassroom(user.id, classroom_id)
    if (!ownership.ok) {
      return NextResponse.json(
        { error: ownership.error },
        { status: ownership.status }
      )
    }

    const supabase = getServiceRoleClient()

    const { data: lastTest } = await supabase
      .from('tests')
      .select('position')
      .eq('classroom_id', classroom_id)
      .order('position', { ascending: false })
      .limit(1)
      .maybeSingle()

    const nextPosition = typeof lastTest?.position === 'number' ? lastTest.position + 1 : 0

    const { data: test, error } = await supabase
      .from('tests')
      .insert({
        classroom_id,
        title: title.trim(),
        created_by: user.id,
        position: nextPosition,
      })
      .select()
      .single()

    if (error) {
      if (error.code === 'PGRST205') {
        return NextResponse.json(
          { error: 'Tests require migration 038 to be applied' },
          { status: 400 }
        )
      }
      console.error('Error creating test:', error)
      return NextResponse.json({ error: 'Failed to create test' }, { status: 500 })
    }

    return NextResponse.json({ quiz: { ...test, assessment_type: 'test' } }, { status: 201 })
  } catch (error: any) {
    if (error.name === 'AuthenticationError') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (error.name === 'AuthorizationError') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    console.error('Create test error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
