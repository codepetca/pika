import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

import { GET } from '@/app/api/assignment-docs/[id]/route'
import { requireAuth } from '@/lib/auth'
import { getServiceRoleClient } from '@/lib/supabase'
import { assertStudentCanAccessClassroom } from '@/lib/server/classrooms'

const { mockAttemptImmediatePalEventDelivery } = vi.hoisted(() => ({
  mockAttemptImmediatePalEventDelivery: vi.fn(async () => 'delivered'),
}))

vi.mock('@/lib/auth', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/auth')>(),
  requireAuth: vi.fn(),
  requireRole: vi.fn(),
}))
vi.mock('@/lib/supabase', () => ({ getServiceRoleClient: vi.fn() }))
vi.mock('@/lib/server/classrooms', () => ({
  assertStudentCanAccessClassroom: vi.fn(),
}))
vi.mock('@/lib/server/pal-outbox', () => ({
  attemptImmediatePalEventDelivery: mockAttemptImmediatePalEventDelivery,
}))

const actorId = '11111111-1111-4111-8111-111111111111'
const otherActorId = '22222222-2222-4222-8222-222222222222'
const assignmentId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const classroomId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const docId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const requirementId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
const artifactId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
const identityId = 'ffffffff-ffff-4fff-8fff-ffffffffffff'
const feedbackId = '99999999-9999-4999-8999-999999999999'
const viewedAt = '2026-09-19T18:00:00.000Z'

const actor = {
  id: actorId,
  role: 'teacher',
  email: 'member@example.com',
}

function assignmentRow() {
  return {
    id: assignmentId,
    classroom_id: classroomId,
    title: 'Contextual assignment',
    description: 'A live assignment',
    instructions_markdown: 'Complete the work.',
    rich_instructions: null,
    due_at: '2026-10-01T23:59:00.000Z',
    is_draft: false,
    released_at: '2026-09-19T12:00:00.000Z',
    created_at: '2026-09-01T12:00:00.000Z',
    classrooms: { id: classroomId, teacher_id: otherActorId },
  }
}

function documentRow(overrides: Record<string, unknown> = {}) {
  return {
    id: docId,
    assignment_id: assignmentId,
    student_id: actorId,
    content: JSON.stringify({ type: 'doc', content: [] }),
    viewed_at: viewedAt,
    returned_at: null,
    feedback_returned_at: null,
    teacher_feedback_draft: 'private teacher note',
    authenticity_score: 99,
    ...overrides,
  }
}

function makeClient(options: {
  feedback?: unknown
  requirements?: unknown
  artifacts?: unknown
  identities?: unknown
  created?: boolean
  viewedAtChanged?: boolean
} = {}) {
  const assignment = assignmentRow()
  const doc = documentRow()
  const from = vi.fn((table: string) => {
    if (table === 'assignments') {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            single: vi.fn().mockResolvedValue({ data: assignment, error: null }),
          })),
        })),
      }
    }
    if (table === 'assignment_feedback_entries') {
      const query: any = {
        eq: vi.fn(() => query),
        order: vi.fn(() => query),
        then: (resolve: (value: unknown) => unknown) => resolve({
          data: options.feedback ?? [{
            id: feedbackId,
            assignment_id: assignmentId,
            student_id: actorId,
          }],
          error: null,
        }),
      }
      return { select: vi.fn(() => query) }
    }
    if (table === 'assignment_submission_requirements') {
      const query: any = {
        eq: vi.fn(() => query),
        order: vi.fn(() => query),
        then: (resolve: (value: unknown) => unknown) => resolve({
          data: options.requirements ?? [{
            id: requirementId,
            assignment_id: assignmentId,
          }],
          error: null,
        }),
      }
      return { select: vi.fn(() => query) }
    }
    if (table === 'assignment_submission_artifacts') {
      const query: any = {
        eq: vi.fn(() => query),
        then: (resolve: (value: unknown) => unknown) => resolve({
          data: options.artifacts ?? [{
            id: artifactId,
            assignment_doc_id: docId,
            requirement_id: requirementId,
            student_id: actorId,
            type: 'link',
            storage_path: null,
          }],
          error: null,
        }),
      }
      return { select: vi.fn(() => query) }
    }
    if (table === 'user_github_identities') {
      const query: any = {
        eq: vi.fn(() => query),
        limit: vi.fn().mockResolvedValue({
          data: options.identities ?? [{ id: identityId, user_id: actorId }],
          error: null,
        }),
      }
      return { select: vi.fn(() => query) }
    }
    throw new Error(`Unexpected legacy table: ${table}`)
  })
  const rpc = vi.fn().mockResolvedValue({
    data: {
      ok: true,
      created: options.created ?? true,
      viewed_at_changed: options.viewedAtChanged ?? true,
      assignment,
      doc,
    },
    error: null,
  })
  return {
    from,
    rpc,
    storage: { from: vi.fn() },
  }
}

describe('contextual GET /api/assignment-docs/[id]', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(viewedAt))
    vi.resetAllMocks()
    vi.stubEnv('PIKA_CLASSROOM_ASSIGNMENT_DOC_OPEN_ACCESS_ENABLED', 'true')
    vi.stubEnv('PIKA_CLASSROOM_ASSIGNMENT_DOC_OPEN_ACCESS_PAIRS', JSON.stringify([{
      userId: actorId,
      assignmentId,
    }]))
    vi.stubEnv('PAL_ENABLED', 'false')
    vi.mocked(requireAuth).mockResolvedValue(actor as any)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it('opens the authenticated member document regardless of legacy role and binds response evidence', async () => {
    const client = makeClient()
    vi.mocked(getServiceRoleClient).mockReturnValue(client as never)

    const response = await GET(
      new NextRequest(`http://localhost/api/assignment-docs/${assignmentId}`),
      { params: Promise.resolve({ id: assignmentId }) },
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.assignment).toMatchObject({ id: assignmentId, classroom_id: classroomId })
    expect(body.doc).toMatchObject({ assignment_id: assignmentId, student_id: actorId })
    expect(body.doc.content).toEqual({ type: 'doc', content: [] })
    expect(body.doc.teacher_feedback_draft).toBeNull()
    expect(body.doc.authenticity_score).toBeNull()
    expect(body.wasFirstView).toBe(true)
    expect(client.rpc).toHaveBeenCalledWith('open_assignment_doc_for_member_v1', {
      p_actor_id: actorId,
      p_assignment_id: assignmentId,
      p_viewed_at: viewedAt,
      p_pal_event: null,
    })
    expect(assertStudentCanAccessClassroom).not.toHaveBeenCalled()
    expect(client.from).not.toHaveBeenCalledWith('assignment_docs')
    expect(client.from).not.toHaveBeenCalledWith('classroom_enrollments')
  })

  it('rejects teacher-projection student substitution on the member path', async () => {
    const client = makeClient()
    vi.mocked(getServiceRoleClient).mockReturnValue(client as never)

    const response = await GET(
      new NextRequest(`http://localhost/api/assignment-docs/${assignmentId}?student_id=${otherActorId}`),
      { params: Promise.resolve({ id: assignmentId }) },
    )

    expect(response.status).toBe(400)
    expect(client.rpc).not.toHaveBeenCalled()
  })

  it('fails closed on malformed enabled cohort configuration before creating a service client', async () => {
    vi.stubEnv('PIKA_CLASSROOM_ASSIGNMENT_DOC_OPEN_ACCESS_PAIRS', 'not-json')

    const response = await GET(
      new NextRequest(`http://localhost/api/assignment-docs/${assignmentId}`),
      { params: Promise.resolve({ id: assignmentId }) },
    )

    expect(response.status).toBe(503)
    expect(getServiceRoleClient).not.toHaveBeenCalled()
  })

  it.each([
    ['feedback', { feedback: [{ id: feedbackId, assignment_id: assignmentId, student_id: otherActorId }] }],
    ['requirements', { requirements: [{ id: requirementId, assignment_id: '77777777-7777-4777-8777-777777777777' }] }],
    ['artifacts', { artifacts: [{
      id: artifactId,
      assignment_doc_id: docId,
      requirement_id: requirementId,
      student_id: otherActorId,
      type: 'link',
      storage_path: null,
    }] }],
    ['GitHub identity', { identities: [{ id: identityId, user_id: otherActorId }] }],
  ])('fails closed on substituted %s evidence', async (_label, overrides) => {
    const client = makeClient(overrides)
    vi.mocked(getServiceRoleClient).mockReturnValue(client as never)

    const response = await GET(
      new NextRequest(`http://localhost/api/assignment-docs/${assignmentId}`),
      { params: Promise.resolve({ id: assignmentId }) },
    )

    expect(response.status).toBe(503)
  })

  it('preserves immediate global-Pal delivery only when the transaction creates the doc', async () => {
    vi.stubEnv('PAL_ENABLED', 'true')
    vi.stubEnv('PAL_CLASSROOM_ENABLED', 'false')
    vi.stubEnv('PAL_API_URL', 'https://pal.example.test')
    vi.stubEnv('PAL_INTEGRATION_SECRET', 'integration-secret-32-characters-long')
    vi.stubEnv('PAL_PSEUDONYM_SECRET', 'pseudonym-secret-32-characters-long')
    const client = makeClient({ created: true })
    vi.mocked(getServiceRoleClient).mockReturnValue(client as never)

    const response = await GET(
      new NextRequest(`http://localhost/api/assignment-docs/${assignmentId}`),
      { params: Promise.resolve({ id: assignmentId }) },
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.pal_delivery).toBe('delivered')
    expect(client.rpc).toHaveBeenCalledWith(
      'open_assignment_doc_for_member_v1',
      expect.objectContaining({
        p_pal_event: expect.objectContaining({ event_type: 'learning_item.viewed' }),
      }),
    )
    expect(mockAttemptImmediatePalEventDelivery).toHaveBeenCalledWith({
      membership: { studentId: actorId, classroomId },
      event: expect.objectContaining({ event_type: 'learning_item.viewed' }),
      supabase: client,
    })
  })
})
