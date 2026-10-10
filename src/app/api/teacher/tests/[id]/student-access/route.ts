import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { withErrorHandler } from '@/lib/api-handler'
import {
  assertTeacherOwnsTest,
  isMissingTestAttemptClosureColumnsError,
  isMissingTestStudentAvailabilityError,
} from '@/lib/server/tests'
import { getServiceRoleClient } from '@/lib/supabase'
import type { TestStudentAvailabilityState } from '@/types'
import { authorizeSharedTestDetailReadActor } from '@/lib/server/contextual-test-detail-read'
import { updateContextualTestOwnerStudentAccess } from '@/lib/server/contextual-test-owner-materials'
import { resolveContextualTestOwnerParams } from '@/lib/validations/contextual-test-owner-workflow'
import { contextualTestOwnerQuerySchema, contextualTestOwnerStudentAccessSchema, readContextualTestOwnerBody, TEST_OWNER_WORKFLOW_DEADLINE_MS } from '@/lib/validations/contextual-test-owner-workflow'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const MAX_STUDENTS_PER_REQUEST = 100

function parseStudentIds(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return Array.from(
    new Set(
      value
        .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
        .map((item) => item.trim())
    )
  )
}

function isMissingStudentAccessRpcError(error: {
  code?: string
  message?: string
  details?: string | null
  hint?: string | null
} | null | undefined): boolean {
  if (!error) return false
  const combined = `${error.message || ''} ${error.details || ''} ${error.hint || ''}`.toLowerCase()
  return (
    isMissingTestAttemptClosureColumnsError(error) ||
    isMissingTestStudentAvailabilityError(error) ||
    error.code === '42883' ||
    error.code === 'PGRST202' ||
    combined.includes('update_test_student_access_atomic')
  )
}

// POST /api/teacher/tests/[id]/student-access - Open/close selected students' test access
export const POST = withErrorHandler('UpdateTeacherTestStudentAccess', async (request, context) => {
  const shared = await authorizeSharedTestDetailReadActor()
  if (shared.mode === 'shared') {
    const deadline = Date.now() + TEST_OWNER_WORKFLOW_DEADLINE_MS
    const { testId } = contextualTestOwnerQuerySchema.parse({ testId: (await resolveContextualTestOwnerParams(request, context.params, deadline)).id })
    const body = contextualTestOwnerStudentAccessSchema.parse(await readContextualTestOwnerBody(request, deadline))
    return NextResponse.json(await updateContextualTestOwnerStudentAccess({ supabase: getServiceRoleClient(), actorId: shared.user.id, testId, body, deadline, signal: request.signal }))
  }
  const user = await requireRole('teacher')
  const { id: testId } = await context.params
  const body = await request.json()
  const state = body?.state as TestStudentAvailabilityState
  const studentIds = parseStudentIds(body?.student_ids)

  if (state !== 'open' && state !== 'closed') {
    return NextResponse.json({ error: "state must be 'open' or 'closed'" }, { status: 400 })
  }
  if (studentIds.length === 0) {
    return NextResponse.json({ error: 'student_ids array is required' }, { status: 400 })
  }
  if (studentIds.length > MAX_STUDENTS_PER_REQUEST) {
    return NextResponse.json(
      { error: `Cannot update access for more than ${MAX_STUDENTS_PER_REQUEST} students at once` },
      { status: 400 }
    )
  }

  const access = await assertTeacherOwnsTest(user.id, testId, { checkArchived: true })
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }
  if (access.test.status === 'draft') {
    return NextResponse.json({ error: 'Cannot open or close students for a draft test' }, { status: 400 })
  }

  const supabase = getServiceRoleClient()
  const { data: enrollmentRows, error: enrollmentError } = await supabase
    .from('classroom_enrollments')
    .select('student_id')
    .eq('classroom_id', access.test.classroom_id)
    .in('student_id', studentIds)

  if (enrollmentError) {
    console.error('Error validating student access enrollment:', enrollmentError)
    return NextResponse.json({ error: 'Failed to validate selected students' }, { status: 500 })
  }

  const enrolledStudentIds = new Set((enrollmentRows || []).map((row) => row.student_id))
  const eligibleStudentIds = studentIds.filter((studentId) => enrolledStudentIds.has(studentId))
  const skippedStudentIds = studentIds.filter((studentId) => !enrolledStudentIds.has(studentId))

  if (eligibleStudentIds.length === 0) {
    return NextResponse.json({ error: 'No selected students are enrolled in this classroom' }, { status: 400 })
  }

  const { data: mutationResult, error: mutationError } = await supabase.rpc(
    'update_test_student_access_atomic',
    {
      p_test_id: testId,
      p_student_ids: eligibleStudentIds,
      p_state: state,
      p_updated_by: user.id,
    }
  )

  if (mutationError) {
    // Domain refusals can name the RPC in Postgres details. Handle them before
    // the legacy broad missing-function compatibility detector.
    if (mutationError.code === 'PT409' || mutationError.code === '40001') {
      return NextResponse.json({ error: 'Selected students changed; reload and retry' }, { status: 409 })
    }
    if (mutationError.code === '42501') {
      return NextResponse.json({ error: 'Test access update is not allowed' }, { status: 403 })
    }
    if (mutationError.code === 'P0002') {
      return NextResponse.json({ error: 'Test not found' }, { status: 404 })
    }
    if (mutationError.code === '22023') {
      return NextResponse.json({ error: mutationError.message || 'Invalid test access update' }, { status: 400 })
    }
    if (isMissingStudentAccessRpcError(mutationError)) {
      return NextResponse.json(
        { error: 'Selected-student exam access requires migrations 060-062 to be applied' },
        { status: 400 }
      )
    }
    console.error('Error updating selected student test access:', mutationError)
    return NextResponse.json({ error: 'Failed to update selected student access' }, { status: 500 })
  }

  return NextResponse.json({
    updated_count: eligibleStudentIds.length,
    skipped_count: skippedStudentIds.length,
    locked_count: Number(mutationResult?.locked_count ?? 0),
    unlocked_count: Number(mutationResult?.unlocked_count ?? 0),
    state,
  })
})
