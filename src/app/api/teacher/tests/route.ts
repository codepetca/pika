import { NextResponse } from 'next/server'
import { getServiceRoleClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'
import { assertTeacherCanMutateClassroom, assertTeacherOwnsClassroom } from '@/lib/server/classrooms'
import { normalizeTestDocuments } from '@/lib/test-documents'
import { hasMeaningfulTestResponse } from '@/lib/test-responses'
import {
  buildTestDraftContentFromRows,
  createAssessmentDraft,
  isMissingAssessmentDraftsError,
  validateTestDraftContent,
  type TestDraftContent,
} from '@/lib/server/assessment-drafts'
import {
  getEffectiveStudentTestAccess,
  isMissingTestStudentAvailabilityError,
} from '@/lib/server/tests'
import { withErrorHandler } from '@/lib/api-handler'
import { getFallbackAssessmentTitle } from '@/lib/assessment-titles'
import type { TestStudentAvailabilityState } from '@/types'

export const dynamic = 'force-dynamic'
export const revalidate = 0

// GET /api/teacher/tests?classroom_id=xxx - List tests for a classroom
export const GET = withErrorHandler('GetTeacherTests', async (request) => {
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
    .order('position', { ascending: false })
    .order('created_at', { ascending: false })

  if (testsError) {
    if (testsError.code === 'PGRST205') {
      return NextResponse.json({ quizzes: [], migration_required: true })
    }
    console.error('Error fetching tests:', testsError)
    return NextResponse.json({ error: 'Failed to fetch tests' }, { status: 500 })
  }

  const { data: enrollmentRows, count: totalStudents } = await supabase
    .from('classroom_enrollments')
    .select('student_id', { count: 'exact' })
    .eq('classroom_id', classroomId)
  const enrolledStudentIds = new Set((enrollmentRows || []).map((row) => row.student_id))

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
  const submittedCountMap: Record<string, number> = {}
  if (testIds.length > 0) {
    const seen: Record<string, Set<string>> = {}
    const submittedSeen: Record<string, Set<string>> = {}

    const { data: attemptRows, error: attemptRowsError } = await supabase
      .from('test_attempts')
      .select('test_id, student_id, is_submitted')
      .in('test_id', testIds)

    if (attemptRowsError && attemptRowsError.code !== 'PGRST205') {
      console.error('Error fetching test attempts:', attemptRowsError)
      return NextResponse.json({ error: 'Failed to fetch tests' }, { status: 500 })
    }

    for (const row of attemptRows || []) {
      if (!row.is_submitted) continue
      if (!enrolledStudentIds.has(row.student_id)) continue
      if (!seen[row.test_id]) seen[row.test_id] = new Set()
      seen[row.test_id].add(row.student_id)
      if (!submittedSeen[row.test_id]) submittedSeen[row.test_id] = new Set()
      submittedSeen[row.test_id].add(row.student_id)
    }

    const { data: responseRows, error: responseRowsError } = await supabase
      .from('test_responses')
      .select('test_id, student_id, selected_option, response_text')
      .in('test_id', testIds)

    if (responseRowsError) {
      console.error('Error fetching test responses:', responseRowsError)
      return NextResponse.json({ error: 'Failed to fetch tests' }, { status: 500 })
    }

    for (const row of responseRows || []) {
      if (!hasMeaningfulTestResponse(row)) continue
      if (!enrolledStudentIds.has(row.student_id)) continue
      if (!seen[row.test_id]) seen[row.test_id] = new Set()
      seen[row.test_id].add(row.student_id)
    }
    for (const [testId, students] of Object.entries(seen)) {
      respondentCountMap[testId] = students.size
    }
    for (const [testId, students] of Object.entries(submittedSeen)) {
      submittedCountMap[testId] = students.size
    }
  }

  const availabilityByTestId = new Map<string, Map<string, TestStudentAvailabilityState>>()
  const enrolledStudentIdList = Array.from(enrolledStudentIds)
  if (testIds.length > 0 && enrolledStudentIdList.length > 0) {
    let availabilityRows: Array<{ test_id: string; student_id: string; state: unknown }> | null = null
    let availabilityError: any = null

    try {
      const result = await supabase
        .from('test_student_availability')
        .select('test_id, student_id, state')
        .in('test_id', testIds)
        .in('student_id', enrolledStudentIdList)
      availabilityRows = result.data
      availabilityError = result.error
    } catch (error) {
      availabilityError = error
    }

    const isMissingAvailabilityTable =
      isMissingTestStudentAvailabilityError(availabilityError) ||
      `${availabilityError?.message || availabilityError || ''}`.includes('Unexpected table: test_student_availability')

    if (availabilityError && !isMissingAvailabilityTable) {
      console.error('Error fetching test student availability:', availabilityError)
      return NextResponse.json({ error: 'Failed to fetch tests' }, { status: 500 })
    }

    for (const row of availabilityRows || []) {
      if (row.state !== 'open' && row.state !== 'closed') continue
      const states = availabilityByTestId.get(row.test_id) ?? new Map<string, TestStudentAvailabilityState>()
      states.set(row.student_id, row.state)
      availabilityByTestId.set(row.test_id, states)
    }
  }

  const draftByTestId: Record<string, TestDraftContent> = {}
  if (testIds.length > 0) {
    try {
      const { data: draftRows, error: draftError } = await supabase
        .from('assessment_drafts')
        .select('assessment_id, content')
        .eq('assessment_type', 'test')
        .in('assessment_id', testIds)

      if (draftError && !isMissingAssessmentDraftsError(draftError)) {
        console.error('Error fetching test draft overlays:', draftError)
      }

      for (const row of draftRows || []) {
        const parsed = validateTestDraftContent(row.content, {
          allowEmptyQuestionText: true,
        })
        if (!parsed.valid) continue
        draftByTestId[row.assessment_id] = parsed.value
      }
    } catch {
      // Older test mocks may not implement this table query yet.
    }
  }

  const testsWithStats = (tests || []).map((test) => {
    const totalStudentCount = totalStudents || 0
    let openAccessCount = 0
    let closedAccessCount = 0

    if (enrolledStudentIdList.length > 0) {
      const availabilityStates = availabilityByTestId.get(test.id)
      for (const studentId of enrolledStudentIdList) {
        const access = getEffectiveStudentTestAccess({
          testStatus: test.status,
          accessState: availabilityStates?.get(studentId) ?? null,
        })
        if (access.effective_access === 'open') {
          openAccessCount += 1
        } else {
          closedAccessCount += 1
        }
      }
    } else {
      openAccessCount = test.status === 'active' ? totalStudentCount : 0
      closedAccessCount = Math.max(totalStudentCount - openAccessCount, 0)
    }

    return {
      ...test,
      title: draftByTestId[test.id]?.title ?? test.title,
      show_results: draftByTestId[test.id]?.show_results ?? test.show_results,
      assessment_type: 'test' as const,
      documents: normalizeTestDocuments((test as { documents?: unknown }).documents),
      stats: {
        total_students: totalStudentCount,
        responded: respondentCountMap[test.id] || 0,
        submitted: submittedCountMap[test.id] || 0,
        open_access: openAccessCount,
        closed_access: closedAccessCount,
        questions_count: (draftByTestId[test.id]?.questions.length ?? questionCountMap[test.id]) || 0,
      },
    }
  })

  // Keep response key as `quizzes` for current UI component compatibility.
  return NextResponse.json({ quizzes: testsWithStats })
})

// POST /api/teacher/tests - Create a new test
export const POST = withErrorHandler('CreateTeacherTest', async (request) => {
  const user = await requireRole('teacher')
  const body = await request.json()
  const { classroom_id, title } = body

  if (!classroom_id) {
    return NextResponse.json({ error: 'classroom_id is required' }, { status: 400 })
  }
  const cleanTitle = title?.trim() || getFallbackAssessmentTitle()

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
      title: cleanTitle,
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

  const initialDraftContent = buildTestDraftContentFromRows(
    {
      title: test.title,
      show_results: test.show_results,
    },
    []
  )

  const { draft: createdDraft, error: draftError } = await createAssessmentDraft<TestDraftContent>(
    supabase,
    {
      assessmentType: 'test',
      assessmentId: test.id,
      classroomId: classroom_id,
      userId: user.id,
      content: initialDraftContent,
    }
  )

  if (draftError || !createdDraft) {
    console.error('Error creating initial test draft:', draftError)

    const { error: cleanupError } = await supabase.from('tests').delete().eq('id', test.id)
    if (cleanupError) {
      console.error('Error cleaning up test after draft creation failure:', cleanupError)
    }

    if (isMissingAssessmentDraftsError(draftError)) {
      return NextResponse.json(
        { error: 'Assessment drafts require migration 045 to be applied' },
        { status: 400 }
      )
    }

    return NextResponse.json({ error: 'Failed to create test draft' }, { status: 500 })
  }

  return NextResponse.json(
    {
      quiz: {
        ...test,
        documents: normalizeTestDocuments((test as { documents?: unknown }).documents),
        assessment_type: 'test',
      },
    },
    { status: 201 }
  )
})
