import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { AuthenticationError, requireAuth } from '@/lib/auth'
import { getServiceRoleClient } from '@/lib/supabase'
import { GET } from '@/app/api/teacher/assignments/[id]/route'
import { getActiveAssignmentAiGradingRunSummary } from '@/lib/server/assignment-ai-grading-runs'
import type { AuthenticatedUser } from '@/types'

vi.mock('@/lib/auth', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/auth')>(),
  requireAuth: vi.fn(),
  requireRole: vi.fn(),
}))
vi.mock('@/lib/supabase', () => ({ getServiceRoleClient: vi.fn() }))
vi.mock('@/lib/server/assignment-ai-grading-runs', () => ({
  getActiveAssignmentAiGradingRunSummary: vi.fn(async () => null),
}))

const actorId = '11111111-1111-4111-8111-111111111111'
const classroomId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const assignmentId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'

const actor = {
  id: actorId,
  role: 'student',
  email: 'owner@example.com',
} as AuthenticatedUser

function assignmentRow(overrides: Record<string, unknown> = {}) {
  return {
    id: assignmentId,
    classroom_id: classroomId,
    title: 'Contextual assignment',
    description: 'Read only',
    instructions_markdown: 'Read only',
    rich_instructions: null,
    due_at: '2026-10-01T23:59:00.000Z',
    position: 0,
    is_draft: true,
    released_at: null,
    track_authenticity: true,
    created_by: actorId,
    created_at: '2026-09-01T00:00:00.000Z',
    updated_at: '2026-09-02T00:00:00.000Z',
    classrooms: {
      id: classroomId,
      teacher_id: actorId,
      title: 'Owned classroom',
      archived_at: null,
    },
    ...overrides,
  }
}

function makeClient(options: { assignment?: unknown; rosterData?: unknown; assignmentError?: unknown } = {}) {
  const from = vi.fn((table: string) => {
    if (table === 'assignments') {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            single: vi.fn().mockResolvedValue({
              data: options.assignment === undefined ? assignmentRow() : options.assignment,
              error: options.assignmentError ?? null,
            }),
          })),
        })),
      }
    }
    if (table === 'classroom_enrollments') {
      const query: any = {
        eq: vi.fn(() => query),
        order: vi.fn(() => query),
        range: vi.fn().mockResolvedValue({
          data: options.rosterData === undefined ? [] : options.rosterData,
          error: null,
        }),
      }
      return { select: vi.fn(() => query) }
    }
    if (table === 'assignment_submission_requirements') {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            order: vi.fn(() => ({
              order: vi.fn().mockResolvedValue({ data: [], error: null }),
            })),
          })),
        })),
      }
    }
    throw new Error(`Unexpected table: ${table}`)
  })
  return { from, storage: { from: vi.fn() } }
}

describe('contextual assignment detail route', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.stubEnv('PIKA_CLASSROOM_ASSIGNMENT_DETAILS_ACCESS_ENABLED', 'true')
    vi.stubEnv('PIKA_CLASSROOM_ASSIGNMENT_DETAILS_ACCESS_PAIRS', JSON.stringify([{
      userId: actorId,
      assignmentId,
    }]))
    vi.mocked(requireAuth).mockResolvedValue(actor)
    vi.mocked(getActiveAssignmentAiGradingRunSummary).mockResolvedValue(null)
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it('authenticates before resolving route params or creating a service client', async () => {
    vi.mocked(requireAuth).mockRejectedValue(new AuthenticationError())
    let paramsResolved = false
    const params = {
      then(resolve: (value: { id: string }) => unknown) {
        paramsResolved = true
        return Promise.resolve(resolve({ id: assignmentId }))
      },
    } as Promise<{ id: string }>

    const response = await GET(new NextRequest(`http://localhost/api/teacher/assignments/${assignmentId}`), {
      params,
    })

    expect(response.status).toBe(401)
    expect(paramsResolved).toBe(false)
    expect(getServiceRoleClient).not.toHaveBeenCalled()
  })

  it('lets a student-valued owner read aggregate assignment detail without enabling writes', async () => {
    const client = makeClient()
    vi.mocked(getServiceRoleClient).mockReturnValue(client as never)

    const response = await GET(new NextRequest(`http://localhost/api/teacher/assignments/${assignmentId}`), {
      params: Promise.resolve({ id: assignmentId }),
    })
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.assignment).toMatchObject({ id: assignmentId, classroom_id: classroomId, is_draft: true })
    expect(body.classroom).toMatchObject({ id: classroomId, teacher_id: actorId })
    expect(body.students).toEqual([])
    expect(client.from).not.toHaveBeenCalledWith('assignment_docs')
  })

  it('uses the canonical assignment UUID for active-run evidence after uppercase admission', async () => {
    const client = makeClient()
    vi.mocked(getServiceRoleClient).mockReturnValue(client as never)
    vi.mocked(getActiveAssignmentAiGradingRunSummary).mockResolvedValueOnce({
      assignment_id: assignmentId,
    } as any)

    const uppercaseAssignmentId = assignmentId.toUpperCase()
    const response = await GET(
      new NextRequest(`http://localhost/api/teacher/assignments/${uppercaseAssignmentId}`),
      { params: Promise.resolve({ id: uppercaseAssignmentId }) },
    )

    expect(response.status).toBe(200)
    expect(getActiveAssignmentAiGradingRunSummary).toHaveBeenCalledWith(assignmentId, expect.objectContaining({
      requireEvidence: true,
    }))
  })

  it('fails closed on an assignment substituted after exact-pair admission', async () => {
    const client = makeClient({ assignment: assignmentRow({ id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd' }) })
    vi.mocked(getServiceRoleClient).mockReturnValue(client as never)

    const response = await GET(new NextRequest(`http://localhost/api/teacher/assignments/${assignmentId}`), {
      params: Promise.resolve({ id: assignmentId }),
    })

    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ error: 'Unable to verify assignment detail access' })
  })

  it('fails closed when a contextual roster returns null without an error', async () => {
    const client = makeClient({ rosterData: null })
    vi.mocked(getServiceRoleClient).mockReturnValue(client as never)

    const response = await GET(new NextRequest(`http://localhost/api/teacher/assignments/${assignmentId}`), {
      params: Promise.resolve({ id: assignmentId }),
    })

    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ error: 'Unable to verify assignment detail roster' })
  })

  it('maps unavailable active grading-run evidence to 503', async () => {
    const client = makeClient()
    vi.mocked(getServiceRoleClient).mockReturnValue(client as never)
    vi.mocked(getActiveAssignmentAiGradingRunSummary).mockRejectedValueOnce(
      new Error('Failed to verify active assignment AI grading run'),
    )

    const response = await GET(new NextRequest(`http://localhost/api/teacher/assignments/${assignmentId}`), {
      params: Promise.resolve({ id: assignmentId }),
    })

    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ error: 'Unable to verify assignment detail grading run' })
  })

  it('preserves wrong-role denial for an unmatched assignment without database reads', async () => {
    const client = makeClient()
    vi.mocked(getServiceRoleClient).mockReturnValue(client as never)

    const otherAssignmentId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
    const response = await GET(new NextRequest(`http://localhost/api/teacher/assignments/${otherAssignmentId}`), {
      params: Promise.resolve({ id: otherAssignmentId }),
    })

    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({ error: 'Forbidden' })
    expect(getServiceRoleClient).not.toHaveBeenCalled()
  })
})
