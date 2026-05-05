import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { withErrorHandler } from '@/lib/api-handler'
import {
  assertTeacherOwnsTest,
  isMissingTestAttemptClosureColumnsError,
  isMissingTestStudentAvailabilityError,
} from '@/lib/server/tests'
import { finalizeUnsubmittedTestAttemptsOnClose } from '@/lib/server/finalize-test-attempts'
import { getServiceRoleClient } from '@/lib/supabase'
import type { TestStudentAvailabilityState } from '@/types'

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

async function unlockTeacherClosedAttemptsForAccessOpen(
  supabase: ReturnType<typeof getServiceRoleClient>,
  testId: string,
  studentIds: string[]
): Promise<{ ok: true; unlockedCount: number } | { ok: false; status: number; error: string }> {
  const { data: lockedAttempts, error: lockedAttemptsError } = await supabase
    .from('test_attempts')
    .select('student_id')
    .eq('test_id', testId)
    .eq('is_submitted', false)
    .not('closed_for_grading_at', 'is', null)
    .in('student_id', studentIds)

  if (lockedAttemptsError) {
    console.error('Error loading teacher-closed test attempts:', lockedAttemptsError)
    return { ok: false, status: 500, error: 'Failed to open selected student access' }
  }

  const lockedStudentIds = Array.from(
    new Set((lockedAttempts || []).map((attempt) => attempt.student_id).filter(Boolean))
  )
  if (lockedStudentIds.length === 0) {
    return { ok: true, unlockedCount: 0 }
  }

  const { error: deleteResponsesError } = await supabase
    .from('test_responses')
    .delete()
    .eq('test_id', testId)
    .in('student_id', lockedStudentIds)

  if (deleteResponsesError) {
    console.error('Error clearing finalized responses while opening selected student access:', deleteResponsesError)
    return { ok: false, status: 500, error: 'Failed to open selected student access' }
  }

  const { error: unlockError } = await supabase
    .from('test_attempts')
    .update({
      closed_for_grading_at: null,
      closed_for_grading_by: null,
      returned_at: null,
      returned_by: null,
    })
    .eq('test_id', testId)
    .eq('is_submitted', false)
    .in('student_id', lockedStudentIds)

  if (unlockError) {
    if (isMissingTestAttemptClosureColumnsError(unlockError)) {
      return { ok: false, status: 400, error: 'Opening teacher-closed test attempts requires migration 061 to be applied' }
    }
    console.error('Error unlocking teacher-closed test attempts:', unlockError)
    return { ok: false, status: 500, error: 'Failed to open selected student access' }
  }

  return { ok: true, unlockedCount: lockedStudentIds.length }
}

// POST /api/teacher/tests/[id]/student-access - Open/close selected students' test access
export const POST = withErrorHandler('UpdateTeacherTestStudentAccess', async (request, context) => {
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

  let lockedCount = 0
  let unlockedCount = 0
  if (state === 'closed') {
    const finalizeResult = await finalizeUnsubmittedTestAttemptsOnClose(supabase, testId, {
      studentIds: eligibleStudentIds,
      closedBy: user.id,
    })
    if (!finalizeResult.ok) {
      return NextResponse.json({ error: finalizeResult.error }, { status: finalizeResult.status })
    }
    lockedCount = finalizeResult.finalized_attempts
  } else {
    const unlockResult = await unlockTeacherClosedAttemptsForAccessOpen(supabase, testId, eligibleStudentIds)
    if (!unlockResult.ok) {
      return NextResponse.json({ error: unlockResult.error }, { status: unlockResult.status })
    }
    unlockedCount = unlockResult.unlockedCount
  }

  const now = new Date().toISOString()
  const rows = eligibleStudentIds.map((studentId) => ({
    test_id: testId,
    student_id: studentId,
    state,
    updated_by: user.id,
    updated_at: now,
  }))

  const { error: upsertError } = await supabase
    .from('test_student_availability')
    .upsert(rows, {
      onConflict: 'test_id,student_id',
    })

  if (upsertError) {
    if (isMissingTestStudentAvailabilityError(upsertError)) {
      return NextResponse.json(
        { error: 'Selected-student exam access requires migration 060 to be applied' },
        { status: 400 }
      )
    }
    console.error('Error updating selected student test access:', upsertError)
    return NextResponse.json({ error: 'Failed to update selected student access' }, { status: 500 })
  }

  return NextResponse.json({
    updated_count: eligibleStudentIds.length,
    skipped_count: skippedStudentIds.length,
    locked_count: lockedCount,
    unlocked_count: unlockedCount,
    state,
  })
})
