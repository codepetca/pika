import { NextRequest, NextResponse } from 'next/server'
import { getServiceRoleClient } from '@/lib/supabase'
import { withErrorHandler } from '@/lib/api-handler'
import { decideClassroomJoin, type ClassroomJoinDecision } from '@/lib/access/classroom-enrollment-policy'
import {
  authenticateClassroomEnrollmentRequest,
  selectAuthenticatedClassroomEnrollmentMode,
} from '@/lib/server/classroom-enrollment-access'
import {
  consumeClassroomJoinGuess,
  buildPostgrestExactTextFilter,
  joinClassroomByCodeAtomic,
  normalizeClassroomJoinCode,
  type ContextualClassroomJoinGuessResult,
  type ContextualClassroomJoinResult,
} from '@/lib/server/contextual-classroom-enrollment'
import { isPalEnabled } from '@/lib/server/pal-config'
import { buildClassroomJoinedEvent } from '@/lib/server/pal-events'
import {
  attemptImmediatePalEventDelivery,
  type PalImmediateDeliveryStatus,
} from '@/lib/server/pal-outbox'
import {
  classroomJoinRequestSchema,
  type ClassroomJoinRequest,
} from '@/lib/validations/classroom-enrollment'
import type { AuthenticatedUser } from '@/types'

export const dynamic = 'force-dynamic'
export const revalidate = 0

type ContextualAuthentication = Extract<
  Awaited<ReturnType<typeof authenticateClassroomEnrollmentRequest>>,
  { mode: 'contextual_lookup' }
>

type ContextualClassroom = {
  id: string
  title: string
  class_code: string
  term_label: string | null
  teacher_id: string
  allow_enrollment: boolean
  join_policy: string | null
  archived_at: string | null
}

function cleanOptionalString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function looksLikeUuid(value: unknown): value is string {
  return typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}

function contextualClassroomResponse(classroom: Pick<ContextualClassroom, 'id' | 'title' | 'term_label'>) {
  return {
    id: classroom.id,
    title: classroom.title,
    term_label: classroom.term_label,
  }
}

function contextualPolicyDenial(decision: Extract<ClassroomJoinDecision, { allowed: false }>) {
  switch (decision.reason) {
    case 'archived':
    case 'invalid_evidence':
      return NextResponse.json({ error: 'Classroom not found' }, { status: 404 })
    case 'own_classroom':
      return NextResponse.json(
        { error: 'You cannot join a classroom you own.', code: 'owner_self_join' },
        { status: 403 },
      )
    case 'code_required':
      return NextResponse.json(
        { error: 'A class code is required to join this classroom.', code: 'code_required' },
        { status: 403 },
      )
    case 'enrollment_closed':
      return NextResponse.json(
        { error: 'Enrollment is closed for this classroom.', code: 'enrollment_closed' },
        { status: 403 },
      )
    case 'not_on_roster':
      return NextResponse.json(
        { error: 'Your email is not on the roster for this classroom.', code: 'not_on_roster' },
        { status: 403 },
      )
    case 'profile_required':
      return NextResponse.json(
        {
          error: 'First name and last name are required to join this classroom.',
          code: 'profile_required',
          requiredFields: ['firstName', 'lastName'],
        },
        { status: 400 },
      )
  }
}

function contextualRateLimitResponse(
  result: Extract<ContextualClassroomJoinGuessResult, { ok: false }>,
) {
  return NextResponse.json(
    {
      error: 'Too many attempts. Try again later.',
      code: result.error_code,
      retryAfterSeconds: result.retry_after_seconds,
    },
    {
      status: result.status,
      headers: { 'Retry-After': String(result.retry_after_seconds) },
    },
  )
}

function contextualRpcFailure(result: Extract<ContextualClassroomJoinResult, { ok: false }>) {
  switch (result.error_code) {
    case 'rate_limited':
      return contextualRateLimitResponse(result)
    case 'actor_not_found':
    case 'classroom_not_found':
      return NextResponse.json({ error: 'Classroom not found' }, { status: 404 })
    case 'owner_self_join':
      return NextResponse.json(
        { error: 'You cannot join a classroom you own.', code: result.error_code },
        { status: result.status },
      )
    case 'enrollment_closed':
      return NextResponse.json(
        { error: 'Enrollment is closed for this classroom.', code: result.error_code },
        { status: result.status },
      )
    case 'not_on_roster':
      return NextResponse.json(
        { error: 'Your email is not on the roster for this classroom.', code: result.error_code },
        { status: result.status },
      )
    case 'profile_required':
      return NextResponse.json(
        {
          error: 'First name and last name are required to join this classroom.',
          code: result.error_code,
          requiredFields: result.required_fields,
        },
        { status: result.status },
      )
    case 'roster_ambiguous':
    case 'roster_binding_conflict':
      return NextResponse.json(
        { error: 'Failed to join classroom', code: result.error_code },
        { status: result.status },
      )
    case 'join_failed':
      return NextResponse.json({ error: 'Failed to join classroom' }, { status: 500 })
  }
}

async function joinClassroomContextually(args: {
  authenticated: ContextualAuthentication
  body: ClassroomJoinRequest
}) {
  const { authenticated, body } = args
  const { user, allowedClassroomIds } = authenticated
  const { classCode, classroomId } = body
  const firstName = cleanOptionalString(body.firstName)
  const lastName = cleanOptionalString(body.lastName)
  const studentNumber = cleanOptionalString(body.studentNumber)

  const isDirectId = looksLikeUuid(classroomId)
  const normalizedCode = cleanOptionalString(classCode)
  if (!isDirectId && !normalizedCode) {
    return NextResponse.json({ error: 'Classroom not found' }, { status: 404 })
  }

  const supabase = getServiceRoleClient()
  const chargeRejectedCode = async () => {
    const guessResult = await consumeClassroomJoinGuess({
      actorId: user.id,
      classCode: normalizedCode!,
      supabase,
    })
    return guessResult.ok ? null : contextualRateLimitResponse(guessResult)
  }
  const query = supabase
    .from('classrooms')
    .select('id, title, class_code, term_label, teacher_id, allow_enrollment, join_policy, archived_at')
    .in('id', [...allowedClassroomIds])
  let classroom: ContextualClassroom | null
  if (isDirectId) {
    const result = await query.eq('id', classroomId).single()
    if (result.error && result.error.code !== 'PGRST116') {
      console.error('Error resolving contextual classroom ID:', result.error)
      return NextResponse.json({ error: 'Failed to join classroom' }, { status: 500 })
    }
    classroom = result.data as ContextualClassroom | null
  } else {
    const result = await query
    if (result.error) {
      console.error('Error resolving contextual classroom invitation:', result.error)
      return NextResponse.json({ error: 'Failed to join classroom' }, { status: 500 })
    }
    const matchingClassrooms = ((result.data ?? []) as ContextualClassroom[]).filter(
      (candidate) => normalizeClassroomJoinCode(candidate.class_code) ===
        normalizeClassroomJoinCode(normalizedCode!),
    )
    classroom = matchingClassrooms.length === 1 ? matchingClassrooms[0] : null
  }
  if (!classroom) {
    if (!isDirectId && normalizedCode) {
      const rateLimitResponse = await chargeRejectedCode()
      if (rateLimitResponse) return rateLimitResponse
    }
    return NextResponse.json({ error: 'Classroom not found' }, { status: 404 })
  }

  const selected = selectAuthenticatedClassroomEnrollmentMode(authenticated, classroom.id)
  if (selected.mode !== 'contextual_candidate') {
    return NextResponse.json({ error: 'Classroom not found' }, { status: 404 })
  }

  const { data: existingEnrollment, error: enrollmentError } = await supabase
    .from('classroom_enrollments')
    .select('id, created_at')
    .eq('classroom_id', classroom.id)
    .eq('student_id', user.id)
    .single()
  if (enrollmentError && enrollmentError.code !== 'PGRST116') {
    console.error('Error checking contextual classroom enrollment:', enrollmentError)
    return NextResponse.json({ error: 'Failed to join classroom' }, { status: 500 })
  }

  const relationship = classroom.teacher_id === user.id
    ? 'owner'
    : existingEnrollment
      ? 'member'
      : 'none'

  if (isDirectId) {
    const decision = decideClassroomJoin({
      context: {
        userId: user.id,
        classroomId: classroom.id,
        ownerId: classroom.teacher_id,
        relationship,
        archived: Boolean(classroom.archived_at),
      },
      invitation: { kind: 'classroom_id', classroomId: classroom.id },
      enrollmentOpen: classroom.allow_enrollment,
      joinPolicy: classroom.join_policy === 'open_join' ? 'open_join' : 'roster',
      rosterMatch: false,
      profileComplete: false,
    })
    if (!decision.allowed) return contextualPolicyDenial(decision)
    if (decision.action !== 'already_enrolled' || !existingEnrollment) {
      return NextResponse.json({ error: 'Classroom not found' }, { status: 404 })
    }
    return NextResponse.json({
      success: true,
      classroom: contextualClassroomResponse(classroom),
      alreadyEnrolled: true,
    })
  }

  const normalizedEmail = user.email.toLowerCase().trim()
  const { data: rosterEntry, error: rosterError } = await supabase
    .from('classroom_roster')
    .select('id')
    .eq('classroom_id', classroom.id)
    .eq('email', normalizedEmail)
    .single()
  if (rosterError && rosterError.code !== 'PGRST116') {
    console.error('Error checking contextual classroom roster:', rosterError)
    return NextResponse.json({ error: 'Failed to join classroom' }, { status: 500 })
  }

  const decision = decideClassroomJoin({
    context: {
      userId: user.id,
      classroomId: classroom.id,
      ownerId: classroom.teacher_id,
      relationship,
      archived: Boolean(classroom.archived_at),
    },
    invitation: { kind: 'verified_code', classroomId: classroom.id },
    enrollmentOpen: classroom.allow_enrollment,
    joinPolicy: classroom.join_policy === 'open_join' ? 'open_join' : 'roster',
    rosterMatch: Boolean(rosterEntry),
    profileComplete: Boolean(firstName && lastName),
  })
  if (!decision.allowed) {
    const rateLimitResponse = await chargeRejectedCode()
    if (rateLimitResponse) return rateLimitResponse
    return contextualPolicyDenial(decision)
  }

  const occurredAt = new Date()
  const result = await joinClassroomByCodeAtomic({
    actorId: user.id,
    expectedClassroomId: classroom.id,
    classCode: normalizedCode!,
    firstName,
    lastName,
    studentNumber,
    occurredAt,
    supabase,
  })
  if (!result.ok) return contextualRpcFailure(result)

  let palDelivery: PalImmediateDeliveryStatus | undefined
  if (result.created && isPalEnabled()) {
    palDelivery = await attemptImmediatePalEventDelivery({
      event: buildClassroomJoinedEvent({
        learnerId: user.id,
        classroomId: classroom.id,
        occurredAt,
      }),
      supabase,
    })
  }

  return NextResponse.json({
    success: true,
    classroom: result.classroom,
    enrollment: result.enrollment,
    ...(result.already_enrolled ? { alreadyEnrolled: true } : {}),
    pal_delivery: palDelivery,
  }, { status: result.status })
}

async function joinClassroomByRosterMatchedCode(user: AuthenticatedUser, classCode: string) {
  const supabase = getServiceRoleClient()
  const normalizedCode = normalizeClassroomJoinCode(classCode)
  const lookupCandidates = async (candidateCode: string) => {
    const filter = buildPostgrestExactTextFilter(candidateCode)
    const query = supabase
      .from('classrooms')
      .select('id')
    const filteredQuery = filter.operator === 'eq'
      ? query.eq('class_code', filter.value)
      : query.ilike('class_code', filter.value)
    const { data, error } = await filteredQuery.limit(2)
    if (error) throw error
    return (data ?? []).filter(
      (candidate: { id: string }) => typeof candidate.id === 'string',
    )
  }

  let matchingClassrooms: Array<{ id: string }>
  try {
    matchingClassrooms = await lookupCandidates(normalizedCode)
    // Existing custom codes may predate normalized writes. A teacher-generated
    // link retains that stored whitespace, so make one additional bounded exact
    // lookup while the atomic RPC still validates the canonical pair under lock.
    if (classCode !== normalizedCode) {
      const rawMatches = await lookupCandidates(classCode)
      matchingClassrooms = [...new Map(
        [...matchingClassrooms, ...rawMatches].map((candidate) => [candidate.id, candidate]),
      ).values()]
    }
  } catch (error) {
    console.error('Error resolving roster-matched classroom invitation:', error)
    return NextResponse.json({ error: 'Failed to join classroom' }, { status: 500 })
  }
  const classroom = matchingClassrooms.length === 1 ? matchingClassrooms[0] : null
  if (!classroom) {
    const guessResult = await consumeClassroomJoinGuess({
      actorId: user.id,
      classCode: normalizedCode,
      supabase,
    })
    if (!guessResult.ok) return contextualRateLimitResponse(guessResult)
    return NextResponse.json({ error: 'Classroom not found' }, { status: 404 })
  }

  const occurredAt = new Date()
  const result = await joinClassroomByCodeAtomic({
    actorId: user.id,
    expectedClassroomId: classroom.id,
    classCode: normalizedCode,
    firstName: null,
    lastName: null,
    studentNumber: null,
    occurredAt,
    supabase,
  })
  if (!result.ok) {
    // A roster-only join deliberately supplies no profile fields. In an
    // open-join classroom, profile_required therefore means there was no
    // existing roster identity match.
    if (result.error_code === 'profile_required') {
      return NextResponse.json(
        { error: 'Your account is not on the roster for this classroom.', code: 'not_on_roster' },
        { status: 403 },
      )
    }
    return contextualRpcFailure(result)
  }

  let palDelivery: PalImmediateDeliveryStatus | undefined
  if (result.created && isPalEnabled()) {
    palDelivery = await attemptImmediatePalEventDelivery({
      event: buildClassroomJoinedEvent({
        learnerId: user.id,
        classroomId: result.classroom.id,
        occurredAt,
      }),
      supabase,
    })
  }

  return NextResponse.json({
    success: true,
    classroom: result.classroom,
    enrollment: result.enrollment,
    ...(result.already_enrolled ? { alreadyEnrolled: true } : {}),
    pal_delivery: palDelivery,
  }, { status: result.status })
}

async function joinClassroomLegacy(user: AuthenticatedUser, body: ClassroomJoinRequest) {
  const { classCode, classroomId } = body
  const firstName = cleanOptionalString(body.firstName)
  const lastName = cleanOptionalString(body.lastName)
  const studentNumber = cleanOptionalString(body.studentNumber)

  if (!classCode && !classroomId) {
    return NextResponse.json(
      { error: 'Class code or classroom ID is required' },
      { status: 400 }
    )
  }

  if (classCode && !looksLikeUuid(classroomId)) {
    return joinClassroomByRosterMatchedCode(user, classCode)
  }

  const supabase = getServiceRoleClient()
  const normalizedEmail = user.email.toLowerCase().trim()

  // Find classroom by code or ID
  let query = supabase
    .from('classrooms')
    .select('id, title, class_code, term_label, allow_enrollment, join_policy, archived_at')

  if (classroomId && looksLikeUuid(classroomId)) {
    query = query.eq('id', classroomId)
  } else {
    query = query.eq('class_code', classCode as string)
  }

  const { data: classroom, error: fetchError } = await query.single()

  if (fetchError || !classroom) {
    return NextResponse.json(
      { error: 'Classroom not found' },
      { status: 404 }
    )
  }

  if (classroom.archived_at) {
    return NextResponse.json(
      { error: 'Classroom not found' },
      { status: 404 }
    )
  }

  // Check if already enrolled
  const { data: existingEnrollment } = await supabase
    .from('classroom_enrollments')
    .select('id')
    .eq('classroom_id', classroom.id)
    .eq('student_id', user.id)
    .single()

  if (existingEnrollment) {
    // Best-effort sync: keep student profile aligned with roster entry.
    const { data: rosterEntry } = await supabase
      .from('classroom_roster')
      .select('student_number, first_name, last_name')
      .eq('classroom_id', classroom.id)
      .eq('email', normalizedEmail)
      .single()

    if (rosterEntry?.first_name && rosterEntry?.last_name) {
      await supabase
        .from('student_profiles')
        .upsert(
          {
            user_id: user.id,
            student_number: rosterEntry.student_number || null,
            first_name: rosterEntry.first_name,
            last_name: rosterEntry.last_name,
          },
          { onConflict: 'user_id' }
        )
    }

    // Already enrolled, return success
    return NextResponse.json({
      success: true,
      classroom,
      alreadyEnrolled: true,
    })
  }

  const occurredAt = new Date()
  const result = await joinClassroomByCodeAtomic({
    actorId: user.id,
    expectedClassroomId: classroom.id,
    classCode: classroom.class_code,
    firstName,
    lastName,
    studentNumber,
    occurredAt,
    supabase,
  })
  if (!result.ok) return contextualRpcFailure(result)

  let palDelivery: PalImmediateDeliveryStatus | undefined
  if (result.created && isPalEnabled()) {
    palDelivery = await attemptImmediatePalEventDelivery({
      event: buildClassroomJoinedEvent({
        learnerId: user.id,
        classroomId: result.classroom.id,
        occurredAt,
      }),
      supabase,
    })
  }

  return NextResponse.json({
    success: true,
    classroom: result.classroom,
    enrollment: result.enrollment,
    ...(result.already_enrolled ? { alreadyEnrolled: true } : {}),
    pal_delivery: palDelivery,
  }, { status: result.status })
}

// POST /api/student/classrooms/join - Join classroom by code or ID
export const POST = withErrorHandler('PostStudentJoinClassroom', async (request: NextRequest) => {
  const authenticated = await authenticateClassroomEnrollmentRequest()
  const body = classroomJoinRequestSchema.parse(await request.json())

  if (!body.classCode && !body.classroomId) {
    return NextResponse.json(
      { error: 'Class code or classroom ID is required' },
      { status: 400 },
    )
  }

  if (authenticated.mode === 'legacy') {
    return joinClassroomLegacy(authenticated.user, body)
  }
  return joinClassroomContextually({
    authenticated,
    body,
  })
})
