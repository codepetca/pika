import { randomUUID } from 'node:crypto'

import { createClient } from '@supabase/supabase-js'
import { NextRequest } from 'next/server'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import {
  CLASSROOM_ARCHIVE_RECOVERY_DRILL_ACK,
  assertLocalClassroomArchiveRecoveryDrillTarget,
} from '@/lib/server/classroom-archive-recovery-drill'

const auth = vi.hoisted(() => ({
  user: null as { id: string; email: string; role: 'student' | 'teacher' } | null,
  requireAuth: vi.fn(),
  requireRole: vi.fn(),
}))

vi.mock('@/lib/auth', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/auth')>(),
  requireAuth: auth.requireAuth,
  requireRole: auth.requireRole,
}))

import { POST as createAssignment } from '@/app/api/teacher/assignments/route'
import { POST as releaseAssignment } from '@/app/api/teacher/assignments/[id]/release/route'
import { GET as inspectStudentWork } from '@/app/api/teacher/assignments/[id]/students/[studentId]/route'
import { POST as gradeAssignment } from '@/app/api/teacher/assignments/[id]/grade/route'
import { POST as returnAssignment } from '@/app/api/teacher/assignments/[id]/return/route'
import { GET as openAssignmentDoc, PATCH as saveAssignmentDoc } from '@/app/api/assignment-docs/[id]/route'
import { POST as submitAssignmentDoc } from '@/app/api/assignment-docs/[id]/submit/route'

type Actor = { id: string; email: string; role: 'student' | 'teacher' }

const suffix = randomUUID().replaceAll('-', '')
const localRun = process.env.PIKA_CONTEXTUAL_ASSIGNMENT_REHEARSAL === 'isolated-only'
const fixture = {
  owner: { id: randomUUID(), email: `assignment-owner-${suffix}@local.invalid`, role: 'student' as const },
  member: { id: randomUUID(), email: `assignment-member-${suffix}@local.invalid`, role: 'teacher' as const },
  outsider: { id: randomUUID(), email: `assignment-outsider-${suffix}@local.invalid`, role: 'teacher' as const },
  ownerClassroomId: randomUUID(),
  memberClassroomId: randomUUID(),
  assignmentId: '',
}

function requireEnvironment(name: string) {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`Missing ${name}; run through the local rehearsal wrapper`)
  return value
}

function localUrl() {
  const url = new URL(requireEnvironment('PIKA_REHEARSAL_LOCAL_SUPABASE_URL'))
  if (!['127.0.0.1', 'localhost'].includes(url.hostname)) {
    throw new Error('Contextual Assignment rehearsal refuses a non-local Supabase URL')
  }
  return url.toString()
}

let supabase: ReturnType<typeof createClient> | null = null
let localOrigin: string | null = null
let originalFetch: typeof fetch | null = null
const observedFetchOrigins = new Set<string>()
const created = {
  userIds: [] as string[],
  classroomIds: [] as string[],
  enrollments: [] as Array<{ classroomId: string; studentId: string }>,
}

function rehearsalSupabase() {
  if (!supabase) throw new Error('Local rehearsal fixture was not initialized')
  return supabase
}

function useActor(actor: Actor) {
  auth.user = actor
  auth.requireAuth.mockImplementation(async () => {
    if (!auth.user) throw new Error('Missing rehearsal actor')
    return auth.user
  })
  auth.requireRole.mockImplementation(async (role: Actor['role']) => {
    if (!auth.user || auth.user.role !== role) throw new Error(`Unexpected role request: ${role}`)
    return auth.user
  })
}

function routeParams(id: string) {
  return { params: Promise.resolve({ id }) }
}

function studentRouteParams(id: string, studentId: string) {
  return { params: Promise.resolve({ id, studentId }) }
}

function configureAssignmentGates(assignmentId: string) {
  const ownerPair = JSON.stringify([{ userId: fixture.owner.id, assignmentId }])
  const memberAndOwnerPairs = JSON.stringify([
    { userId: fixture.member.id, assignmentId },
    { userId: fixture.owner.id, assignmentId },
  ])
  const ownerAndOutsiderPairs = JSON.stringify([
    { userId: fixture.owner.id, assignmentId },
    { userId: fixture.outsider.id, assignmentId },
  ])
  process.env.PIKA_CLASSROOM_ASSIGNMENT_OWNER_MUTATION_ACCESS_ENABLED = 'true'
  process.env.PIKA_CLASSROOM_ASSIGNMENT_OWNER_MUTATION_ACCESS_PAIRS = ownerPair
  process.env.PIKA_CLASSROOM_ASSIGNMENT_DOC_OPEN_ACCESS_ENABLED = 'true'
  process.env.PIKA_CLASSROOM_ASSIGNMENT_DOC_OPEN_ACCESS_PAIRS = memberAndOwnerPairs
  process.env.PIKA_CLASSROOM_ASSIGNMENT_DOC_SAVE_ACCESS_ENABLED = 'true'
  process.env.PIKA_CLASSROOM_ASSIGNMENT_DOC_SAVE_ACCESS_PAIRS = memberAndOwnerPairs
  process.env.PIKA_CLASSROOM_ASSIGNMENT_DOC_SUBMISSION_ACCESS_ENABLED = 'true'
  process.env.PIKA_CLASSROOM_ASSIGNMENT_DOC_SUBMISSION_ACCESS_PAIRS = memberAndOwnerPairs
  process.env.PIKA_CLASSROOM_ASSIGNMENT_DETAILS_ACCESS_ENABLED = 'true'
  process.env.PIKA_CLASSROOM_ASSIGNMENT_DETAILS_ACCESS_PAIRS = ownerPair
  process.env.PIKA_CLASSROOM_ASSIGNMENT_GRADING_ACCESS_ENABLED = 'true'
  process.env.PIKA_CLASSROOM_ASSIGNMENT_GRADING_ACCESS_PAIRS = ownerAndOutsiderPairs
  process.env.PIKA_CLASSROOM_ASSIGNMENT_FEEDBACK_RETURN_ACCESS_ENABLED = 'true'
  process.env.PIKA_CLASSROOM_ASSIGNMENT_FEEDBACK_RETURN_ACCESS_PAIRS = ownerPair
  process.env.PAL_ENABLED = 'false'
  process.env.PAL_CLASSROOM_ENABLED = 'false'
  process.env.PAL_MEMBERSHIP_IDENTITY_ENABLED = 'false'
}

async function responseBody(response: Response) {
  return response.json() as Promise<Record<string, any>>
}

const localDescribe = localRun ? describe.sequential : describe.skip

localDescribe('LOCAL ONLY: contextual Assignment route lifecycle', () => {
  beforeAll(async () => {
    const url = localUrl()
    const secret = requireEnvironment('PIKA_REHEARSAL_LOCAL_SUPABASE_SECRET_KEY')
    const target = assertLocalClassroomArchiveRecoveryDrillTarget({
      acknowledgement: CLASSROOM_ARCHIVE_RECOVERY_DRILL_ACK,
      serviceRoleKey: secret,
      supabaseUrl: url,
    })
    localOrigin = target.supabaseUrl
    // Vite may load a shared .env.local after the launcher. Route imports read
    // these values only when invoked, so force them to this launcher's local
    // status target before any fixture or route operation.
    process.env.NEXT_PUBLIC_SUPABASE_URL = target.supabaseUrl
    process.env.SUPABASE_SECRET_KEY = secret
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = requireEnvironment(
      'PIKA_REHEARSAL_LOCAL_SUPABASE_PUBLISHABLE_KEY',
    )
    originalFetch = globalThis.fetch
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const targetUrl = input instanceof Request
        ? new URL(input.url)
        : new URL(input instanceof URL ? input.toString() : input)
      if (targetUrl.origin !== localOrigin) {
        throw new Error(`Contextual Assignment rehearsal blocked non-local fetch: ${targetUrl.origin}`)
      }
      observedFetchOrigins.add(targetUrl.origin)
      return originalFetch!(input, { ...init, redirect: 'error' })
    }) as typeof fetch
    supabase = createClient(target.supabaseUrl, secret, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
    process.env.PIKA_CLASSROOM_CLASSWORK_CREATION_ACCESS_ENABLED = 'true'
    process.env.PIKA_CLASSROOM_CLASSWORK_CREATION_ACCESS_PAIRS = JSON.stringify([{
      userId: fixture.owner.id,
      classroomId: fixture.memberClassroomId,
    }])

    const client = rehearsalSupabase()
    const [{ count: userCount, error: userCountError }, { count: classroomCount, error: classroomCountError }] = await Promise.all([
      client.from('users').select('*', { count: 'exact', head: true }).in('id', [fixture.owner.id, fixture.member.id, fixture.outsider.id]),
      client.from('classrooms').select('*', { count: 'exact', head: true }).in('id', [fixture.ownerClassroomId, fixture.memberClassroomId]),
    ])
    if (userCountError || classroomCountError || userCount !== 0 || classroomCount !== 0) {
      throw new Error('Refusing to reuse an existing contextual Assignment rehearsal fixture')
    }

    for (const user of [fixture.owner, fixture.member, fixture.outsider]) {
      const { error } = await client.from('users').insert(user)
      if (error) throw error
      created.userIds.push(user.id)
    }

    for (const classroom of [
      {
        id: fixture.ownerClassroomId,
        teacher_id: fixture.member.id,
        title: `Rehearsal owner A ${suffix}`,
        class_code: `RA${suffix.slice(0, 6).toUpperCase()}`,
      },
      {
        id: fixture.memberClassroomId,
        teacher_id: fixture.owner.id,
        title: `Rehearsal member B ${suffix}`,
        class_code: `RB${suffix.slice(0, 6).toUpperCase()}`,
      },
    ]) {
      const { error } = await client.from('classrooms').insert(classroom)
      if (error) throw error
      created.classroomIds.push(classroom.id)
    }

    for (const enrollment of [fixture.member, fixture.owner]) {
      const { error } = await client.from('classroom_enrollments').insert({
        classroom_id: fixture.memberClassroomId,
        student_id: enrollment.id,
      })
      if (error) throw error
      created.enrollments.push({ classroomId: fixture.memberClassroomId, studentId: enrollment.id })
    }
  })

  afterAll(async () => {
    try {
      if (!supabase) return
      const client = rehearsalSupabase()
      for (const enrollment of created.enrollments) {
        const { error } = await client.from('classroom_enrollments').delete()
          .eq('classroom_id', enrollment.classroomId).eq('student_id', enrollment.studentId)
        if (error) throw error
      }
      if (created.classroomIds.length > 0) {
        const { error } = await client.from('classrooms').delete().in('id', created.classroomIds)
        if (error) throw error
      }
      if (created.userIds.length > 0) {
        const { error } = await client.from('users').delete().in('id', created.userIds)
        if (error) throw error
      }

      const [{ count: classrooms, error: classroomError }, { count: users, error: userError }] = await Promise.all([
        created.classroomIds.length === 0
          ? Promise.resolve({ count: 0, error: null })
          : client.from('classrooms').select('*', { count: 'exact', head: true }).in('id', created.classroomIds),
        created.userIds.length === 0
          ? Promise.resolve({ count: 0, error: null })
          : client.from('users').select('*', { count: 'exact', head: true }).in('id', created.userIds),
      ])
      if (classroomError || userError || classrooms !== 0 || users !== 0) {
        throw new Error('Contextual Assignment rehearsal fixture cleanup was incomplete')
      }
      if (observedFetchOrigins.size === 0 || Array.from(observedFetchOrigins).some((origin) => origin !== localOrigin)) {
        throw new Error('Contextual Assignment rehearsal fetch containment was not proven')
      }
    } finally {
      if (originalFetch) globalThis.fetch = originalFetch
    }
  })

  it('lets a student-valued Classroom owner create and release in B while the teacher-valued identity owns A and is only a B member', async () => {
    useActor(fixture.owner)
    const created = await createAssignment(new NextRequest('http://localhost/api/teacher/assignments', {
      method: 'POST',
      body: JSON.stringify({
        classroom_id: fixture.memberClassroomId,
        title: 'Local contextual lifecycle',
        instructions_markdown: 'Write two complete sentences.',
        due_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        submission_requirements: [],
      }),
    }))
    const createdBody = await responseBody(created)
    expect(created.status).toBe(201)
    expect(createdBody.assignment.classroom_id).toBe(fixture.memberClassroomId)
    expect(createdBody.assignment.created_by).toBe(fixture.owner.id)
    fixture.assignmentId = createdBody.assignment.id
    configureAssignmentGates(fixture.assignmentId)

    const released = await releaseAssignment(new NextRequest(
      `http://localhost/api/teacher/assignments/${fixture.assignmentId}/release`,
      { method: 'POST', body: JSON.stringify({}) },
    ), routeParams(fixture.assignmentId))
    const releasedBody = await responseBody(released)
    expect(released.status).toBe(200)
    expect(releasedBody.assignment).toMatchObject({ id: fixture.assignmentId, is_draft: false })
  })

  it('lets the teacher-valued B member open, save, and submit only their document', async () => {
    useActor(fixture.member)
    const opened = await openAssignmentDoc(
      new NextRequest(`http://localhost/api/assignment-docs/${fixture.assignmentId}`),
      routeParams(fixture.assignmentId),
    )
    const openedBody = await responseBody(opened)
    expect(opened.status).toBe(200)
    expect(openedBody.doc.student_id).toBe(fixture.member.id)

    const savedContent = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'My submitted lifecycle work.' }] }],
    }
    const saved = await saveAssignmentDoc(new NextRequest(
      `http://localhost/api/assignment-docs/${fixture.assignmentId}`,
      {
        method: 'PATCH',
        body: JSON.stringify({
          content: savedContent,
          expected_updated_at: openedBody.doc.updated_at,
          save_session_id: randomUUID(),
          save_sequence: 1,
          metric_session_id: randomUUID(),
        }),
      },
    ), routeParams(fixture.assignmentId))
    const savedBody = await responseBody(saved)
    expect(saved.status).toBe(200)
    expect(savedBody.doc.content).toEqual(savedContent)

    const submitted = await submitAssignmentDoc(new NextRequest(
      `http://localhost/api/assignment-docs/${fixture.assignmentId}/submit`,
      {
        method: 'POST',
        body: JSON.stringify({
          content: savedContent,
          expected_updated_at: savedBody.doc.updated_at,
          allow_missing_attachments: false,
          acknowledged_missing_attachment_ids: [],
        }),
      },
    ), routeParams(fixture.assignmentId))
    const submittedBody = await responseBody(submitted)
    expect(submitted.status).toBe(200)
    expect(submittedBody.doc).toMatchObject({ student_id: fixture.member.id, is_submitted: true })
  })

  it('denies the Classroom owner from opening learner work despite historical self-enrollment', async () => {
    useActor(fixture.owner)
    const response = await openAssignmentDoc(
      new NextRequest(`http://localhost/api/assignment-docs/${fixture.assignmentId}`),
      routeParams(fixture.assignmentId),
    )
    expect(response.status).toBe(403)
  })

  it('denies the Classroom owner from submitting as an unenrolled member', async () => {
    const client = rehearsalSupabase()
    const { error: removalError } = await client.from('classroom_enrollments').delete()
      .eq('classroom_id', fixture.memberClassroomId).eq('student_id', fixture.owner.id)
    if (removalError) throw removalError
    created.enrollments = created.enrollments.filter((enrollment) => enrollment.studentId !== fixture.owner.id)
    useActor(fixture.owner)
    const response = await submitAssignmentDoc(new NextRequest(
      `http://localhost/api/assignment-docs/${fixture.assignmentId}/submit`,
      {
        method: 'POST',
        body: JSON.stringify({
          content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'forbidden' }] }] },
          expected_updated_at: new Date().toISOString(),
          allow_missing_attachments: false,
          acknowledged_missing_attachment_ids: [],
        }),
      },
    ), routeParams(fixture.assignmentId))
    expect(response.status).toBe(403)
  })

  it('does not disclose feedback to the member before the owner returns it', async () => {
    useActor(fixture.member)
    const response = await openAssignmentDoc(
      new NextRequest(`http://localhost/api/assignment-docs/${fixture.assignmentId}`),
      routeParams(fixture.assignmentId),
    )
    const body = await responseBody(response)
    expect(response.status).toBe(200)
    expect(body.doc.feedback).toBeNull()
    expect(body.doc.returned_at).toBeNull()
  })

  it('lets the student-valued owner inspect, manually grade, and fully return grades to the B member', async () => {
    useActor(fixture.owner)
    const inspected = await inspectStudentWork(
      new NextRequest(`http://localhost/api/teacher/assignments/${fixture.assignmentId}/students/${fixture.member.id}`),
      studentRouteParams(fixture.assignmentId, fixture.member.id),
    )
    const inspectedBody = await responseBody(inspected)
    expect(inspected.status).toBe(200)
    expect(inspectedBody.doc).toMatchObject({ assignment_id: fixture.assignmentId, student_id: fixture.member.id })

    const graded = await gradeAssignment(new NextRequest(
      `http://localhost/api/teacher/assignments/${fixture.assignmentId}/grade`,
      {
        method: 'POST',
        body: JSON.stringify({
          student_id: fixture.member.id,
          expected_doc_updated_at: inspectedBody.doc.updated_at,
          score_completion: 8,
          score_thinking: 7,
          score_workflow: 9,
          feedback: 'Clear and complete work.',
          apply_target: 'grade-and-comments',
        }),
      },
    ), routeParams(fixture.assignmentId))
    const gradedBody = await responseBody(graded)
    expect(graded.status).toBe(200)
    expect(gradedBody.doc).toMatchObject({ student_id: fixture.member.id, score_completion: 8 })

    useActor(fixture.member)
    const unreturned = await openAssignmentDoc(
      new NextRequest(`http://localhost/api/assignment-docs/${fixture.assignmentId}`),
      routeParams(fixture.assignmentId),
    )
    const unreturnedBody = await responseBody(unreturned)
    expect(unreturned.status).toBe(200)
    expect(unreturnedBody.doc).toMatchObject({
      feedback: null,
      score_completion: null,
      score_thinking: null,
      score_workflow: null,
      returned_at: null,
    })
    useActor(fixture.owner)

    const returned = await returnAssignment(new NextRequest(
      `http://localhost/api/teacher/assignments/${fixture.assignmentId}/return`,
      {
        method: 'POST',
        body: JSON.stringify({
          student_ids: [fixture.member.id],
        }),
      },
    ), routeParams(fixture.assignmentId))
    const returnedBody = await responseBody(returned)
    expect(returned.status).toBe(200)
    expect(returnedBody).toMatchObject({ returned_count: 1, returned_student_ids: [fixture.member.id] })

    useActor(fixture.member)
    const feedback = await openAssignmentDoc(
      new NextRequest(`http://localhost/api/assignment-docs/${fixture.assignmentId}`),
      routeParams(fixture.assignmentId),
    )
    const feedbackBody = await responseBody(feedback)
    expect(feedback.status).toBe(200)
    expect(feedbackBody.doc).toMatchObject({
      feedback: 'Clear and complete work.',
      score_completion: 8,
      score_thinking: 7,
      score_workflow: 9,
    })
  })

  it('denies a teacher-valued cross-class outsider from grading the B member', async () => {
    useActor(fixture.outsider)
    const response = await gradeAssignment(new NextRequest(
      `http://localhost/api/teacher/assignments/${fixture.assignmentId}/grade`,
      {
        method: 'POST',
        body: JSON.stringify({
          student_id: fixture.member.id,
          expected_doc_updated_at: new Date().toISOString(),
          score_completion: 1,
          score_thinking: 1,
          score_workflow: 1,
          feedback: 'forbidden',
          apply_target: 'grade-and-comments',
        }),
      },
    ), routeParams(fixture.assignmentId))
    expect(response.status).toBe(403)
  })
})
