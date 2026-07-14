import { NextResponse } from 'next/server'
import { getServiceRoleClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'
import {
  assertTeacherCanMutateClassroom,
  assertTeacherOwnsClassroom,
  getClassroomStudentIds,
} from '@/lib/server/classrooms'
import { normalizeTestDocuments } from '@/lib/test-documents'
import { hasMeaningfulTestResponse } from '@/lib/test-responses'
import {
  buildTestDraftContentFromRows,
  createAssessmentDraft,
  isMissingAssessmentDraftsError,
} from '@/lib/server/assessment-drafts'
import { validateTestDraftContent } from '@/lib/validations/assessment-drafts'
import {
  getEffectiveStudentTestAccess,
  isMissingTestStudentAvailabilityError,
} from '@/lib/server/tests'
import { withErrorHandler } from '@/lib/api-handler'
import { getFallbackAssessmentTitle } from '@/lib/assessment-titles'
import type { TestDraftContent, TestStudentAvailabilityState } from '@/types'
import { chunkValues, loadChunkedRows } from '@/lib/server/query-chunks'
import { withLegacyQuizKey, withLegacyQuizListKey } from '@/lib/test-api-contract'

export const dynamic = 'force-dynamic'
export const revalidate = 0

type TestAttemptStatsRow = {
  test_id: string
  student_id: string
  is_submitted: boolean
}

type TestQuestionStatsRow = {
  test_id: string
}

type TestResponseStatsRow = {
  test_id: string
  student_id: string
  selected_option: unknown
  response_text: unknown
}

type TestAvailabilityStatsRow = {
  test_id: string
  student_id: string
  state: unknown
}

async function loadStudentScopedTestRows<T>(
  supabase: any,
  options: {
    table: string
    columns: string
    testIds: string[]
    studentIds: string[]
  }
): Promise<{ rows: T[]; error: any }> {
  const { table, columns, testIds, studentIds } = options
  return loadChunkedRows<T>({
    supabase,
    table,
    select: columns,
    filters: [
      { column: 'test_id', values: testIds },
      { column: 'student_id', values: studentIds },
    ],
  })
}

async function loadTestQuestionRows(
  supabase: any,
  testIds: string[]
): Promise<{ rows: TestQuestionStatsRow[]; error: any }> {
  return loadChunkedRows<TestQuestionStatsRow>({
    supabase,
    table: 'test_questions',
    select: 'test_id',
    filters: [{ column: 'test_id', values: testIds }],
  })
}

async function loadTestAvailabilityRows(
  supabase: any,
  testIds: string[],
  studentIds: string[]
): Promise<{ rows: TestAvailabilityStatsRow[]; error: any }> {
  try {
    return await loadChunkedRows<TestAvailabilityStatsRow>({
      supabase,
      table: 'test_student_availability',
      select: 'test_id, student_id, state',
      filters: [
        { column: 'test_id', values: testIds },
        { column: 'student_id', values: studentIds },
      ],
    })
  } catch (error) {
    return { rows: [], error }
  }
}

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
      return NextResponse.json({ ...withLegacyQuizListKey([]), migration_required: true })
    }
    console.error('Error fetching tests:', testsError)
    return NextResponse.json({ error: 'Failed to fetch tests' }, { status: 500 })
  }

  const classroomStudentsResult = await getClassroomStudentIds(supabase, classroomId)
  if (classroomStudentsResult.error) {
    console.error('Error fetching classroom enrollments:', classroomStudentsResult.error)
    return NextResponse.json({ error: 'Failed to fetch classroom enrollments' }, { status: 500 })
  }

  const testIds = (tests || []).map((t) => t.id)
  const enrolledStudentIdList = classroomStudentsResult.studentIds

  const questionCountMap: Record<string, number> = {}
  if (testIds.length > 0) {
    const { rows: questionRows, error: questionRowsError } = await loadTestQuestionRows(supabase, testIds)

    if (questionRowsError) {
      console.error('Error fetching test question stats:', questionRowsError)
      return NextResponse.json({ error: 'Failed to fetch tests' }, { status: 500 })
    }

    for (const row of questionRows || []) {
      questionCountMap[row.test_id] = (questionCountMap[row.test_id] || 0) + 1
    }
  }

  const respondentCountMap: Record<string, number> = {}
  const submittedCountMap: Record<string, number> = {}
  if (testIds.length > 0 && enrolledStudentIdList.length > 0) {
    const seen: Record<string, Set<string>> = {}
    const submittedSeen: Record<string, Set<string>> = {}

    const {
      rows: attemptRows,
      error: attemptRowsError,
    } = await loadStudentScopedTestRows<TestAttemptStatsRow>(supabase, {
      table: 'test_attempts',
      columns: 'test_id, student_id, is_submitted',
      testIds,
      studentIds: enrolledStudentIdList,
    })

    if (attemptRowsError && attemptRowsError.code !== 'PGRST205') {
      console.error('Error fetching test attempts:', attemptRowsError)
      return NextResponse.json({ error: 'Failed to fetch tests' }, { status: 500 })
    }

    for (const row of attemptRows || []) {
      if (!row.is_submitted) continue
      if (!classroomStudentsResult.studentIdSet.has(row.student_id)) continue
      if (!seen[row.test_id]) seen[row.test_id] = new Set()
      seen[row.test_id].add(row.student_id)
      if (!submittedSeen[row.test_id]) submittedSeen[row.test_id] = new Set()
      submittedSeen[row.test_id].add(row.student_id)
    }

    const {
      rows: responseRows,
      error: responseRowsError,
    } = await loadStudentScopedTestRows<TestResponseStatsRow>(supabase, {
      table: 'test_responses',
      columns: 'test_id, student_id, selected_option, response_text',
      testIds,
      studentIds: enrolledStudentIdList,
    })

    if (responseRowsError) {
      console.error('Error fetching test responses:', responseRowsError)
      return NextResponse.json({ error: 'Failed to fetch tests' }, { status: 500 })
    }

    for (const row of responseRows || []) {
      if (!hasMeaningfulTestResponse(row)) continue
      if (!classroomStudentsResult.studentIdSet.has(row.student_id)) continue
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
  if (testIds.length > 0 && enrolledStudentIdList.length > 0) {
    const {
      rows: availabilityRows,
      error: availabilityError,
    } = await loadTestAvailabilityRows(supabase, testIds, enrolledStudentIdList)

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
    for (const testIdChunk of chunkValues(testIds)) {
      try {
        const { data: draftRows, error: draftError } = await supabase
          .from('assessment_drafts')
          .select('assessment_id, content')
          .eq('assessment_type', 'test')
          .in('assessment_id', testIdChunk)

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
  }

  const testsWithStats = (tests || []).map((test) => {
    const totalStudentCount = classroomStudentsResult.totalStudents
    const draft = test.status === 'draft' ? draftByTestId[test.id] : undefined
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
      title: draft?.title ?? test.title,
      show_results: draft?.show_results ?? test.show_results,
      assessment_type: 'test' as const,
      documents: normalizeTestDocuments((test as { documents?: unknown }).documents),
      stats: {
        total_students: totalStudentCount,
        responded: respondentCountMap[test.id] || 0,
        submitted: submittedCountMap[test.id] || 0,
        open_access: openAccessCount,
        closed_access: closedAccessCount,
        questions_count: (draft?.questions.length ?? questionCountMap[test.id]) || 0,
      },
    }
  })

  return NextResponse.json(withLegacyQuizListKey(testsWithStats))
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

  const responseTest = {
    ...test,
    documents: normalizeTestDocuments((test as { documents?: unknown }).documents),
    assessment_type: 'test',
  }

  return NextResponse.json(
    {
      ...withLegacyQuizKey(responseTest),
    },
    { status: 201 }
  )
})
