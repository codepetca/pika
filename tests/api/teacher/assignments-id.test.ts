/**
 * API tests for GET/PATCH/DELETE /api/teacher/assignments/[id]
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { GET, PATCH, DELETE } from '@/app/api/teacher/assignments/[id]/route'
import { NextRequest } from 'next/server'

vi.mock('@/lib/supabase', () => ({ getServiceRoleClient: vi.fn(() => mockSupabaseClient) }))
vi.mock('@/lib/auth', () => ({ requireRole: vi.fn(async () => ({ id: 'teacher-1' })) }))
vi.mock('@/lib/server/assignment-ai-grading-runs', () => ({
  getActiveAssignmentAiGradingRunSummary: vi.fn(async () => null),
}))

const mockSupabaseClient = {
  from: vi.fn(),
  rpc: vi.fn(),
  storage: { from: vi.fn() },
}

function makeAssignment(overrides: Record<string, unknown> = {}) {
  return {
    id: 'a-1',
    title: 'Assignment 1',
    description: 'Write it up',
    instructions_markdown: 'Write it up',
    rich_instructions: null,
    due_at: '2099-03-10T23:59:00.000Z',
    position: 0,
    is_draft: false,
    released_at: null,
    track_authenticity: true,
    created_by: 'teacher-1',
    created_at: '2026-03-01T00:00:00.000Z',
    updated_at: '2026-03-02T00:00:00.000Z',
    classrooms: { teacher_id: 'teacher-1', archived_at: null },
    ...overrides,
  }
}

function makeRequirement(overrides: Record<string, unknown> = {}) {
  return {
    id: 'req-link',
    assignment_id: 'a-1',
    type: 'link',
    label: 'Public link',
    instructions: '',
    required: true,
    position: 0,
    validation_policy_json: {},
    created_at: '2026-05-01T00:00:00.000Z',
    updated_at: '2026-05-01T00:00:00.000Z',
    ...overrides,
  }
}

function makeAssignmentSelectTable(existing = makeAssignment()) {
  return {
    select: vi.fn(() => ({
      eq: vi.fn(() => ({
        single: vi.fn().mockResolvedValue({ data: existing, error: null }),
      })),
    })),
  }
}

function makeRequirementsTable(requirements: unknown[]) {
  return {
    select: vi.fn(() => ({
      eq: vi.fn(() => ({
        order: vi.fn(() => ({
          order: vi.fn().mockResolvedValue({ data: requirements, error: null }),
        })),
      })),
    })),
  }
}

function makeImageArtifactsTable(paths: string[]) {
  return {
    select: vi.fn(() => ({
      eq: vi.fn(() => ({
        not: vi.fn(() => ({
          in: vi.fn().mockResolvedValue({
            data: paths.map((storage_path) => ({ storage_path })),
            error: null,
          }),
        })),
      })),
    })),
  }
}

type QueryLog = {
  eqCalls: Array<{ table: string; column: string; value: string }>
  inCalls: Array<{ table: string; column: string; values: string[] }>
  orderCalls: Array<{ table: string; column: string }>
  rangeCalls: Array<{ table: string; from: number; to: number }>
}

function createQueryLog(): QueryLog {
  return { eqCalls: [], inCalls: [], orderCalls: [], rangeCalls: [] }
}

function mockPagedTable(
  rows: Array<Record<string, any>>,
  options: {
    table?: string
    log?: QueryLog
    error?: any
  } = {},
) {
  return {
    select: vi.fn(() => {
      const filters: Array<{ column: string; values: string[] }> = []
      const filteredRows = () => rows.filter((row) =>
        filters.every((filter) => {
          if (!(filter.column in row)) return false
          return filter.values.includes(String(row[filter.column]))
        })
      )
      const query: any = {
        eq: vi.fn((column: string, value: string) => {
          filters.push({ column, values: [String(value)] })
          if (options.table) {
            options.log?.eqCalls.push({ table: options.table, column, value: String(value) })
          }
          return query
        }),
        in: vi.fn((column: string, values: string[]) => {
          filters.push({ column, values: values.map(String) })
          if (options.table) {
            options.log?.inCalls.push({ table: options.table, column, values: values.map(String) })
          }
          return query
        }),
        order: vi.fn((column: string) => {
          if (options.table) {
            options.log?.orderCalls.push({ table: options.table, column })
          }
          return query
        }),
        range: vi.fn((from: number, to: number) => {
          if (options.table) {
            options.log?.rangeCalls.push({ table: options.table, from, to })
          }
          if (options.error) {
            return Promise.resolve({ data: null, error: options.error })
          }
          return Promise.resolve({
            data: filteredRows().slice(from, to + 1),
            error: null,
          })
        }),
      }
      return query
    }),
  }
}

function makeAssignmentDoc(overrides: Record<string, unknown> = {}) {
  return {
    id: 'doc-1',
    assignment_id: 'a-1',
    student_id: 'student-1',
    content: { type: 'doc', content: [] },
    is_submitted: false,
    submitted_at: null,
    updated_at: '2026-03-10T09:30:00.000Z',
    score_completion: null,
    score_thinking: null,
    score_workflow: null,
    graded_at: null,
    returned_at: null,
    ...overrides,
  }
}

function mockAssignmentDetailTables(options: {
  assignment?: Record<string, any>
  enrollments?: Array<Record<string, any>>
  profiles?: Array<Record<string, any>>
  docs?: Array<Record<string, any>>
  requirements?: unknown[]
  artifacts?: Array<Record<string, any>>
  historyRows?: Array<Record<string, any>>
  errors?: Record<string, any>
  log?: QueryLog
} = {}) {
  const assignment = options.assignment ?? makeAssignment({
    classroom_id: 'classroom-1',
    classrooms: {
      id: 'classroom-1',
      teacher_id: 'teacher-1',
      title: 'Test Classroom',
      archived_at: null,
    },
  })
  const enrollments = options.enrollments ?? [
    {
      id: 'enrollment-1',
      classroom_id: 'classroom-1',
      student_id: 'student-1',
      users: { id: 'student-1', email: 'student1@example.com' },
    },
  ]
  const profiles = options.profiles ?? [
    { user_id: 'student-1', first_name: 'Alex', last_name: 'Lee' },
  ]
  const docs = options.docs ?? [makeAssignmentDoc()]
  const requirements = options.requirements ?? []
  const artifacts = options.artifacts ?? []
  const historyRows = options.historyRows ?? []

  return vi.fn((table: string) => {
    if (table === 'assignments') return makeAssignmentSelectTable(assignment)
    if (table === 'classroom_enrollments') {
      return mockPagedTable(enrollments, { table, log: options.log, error: options.errors?.[table] })
    }
    if (table === 'student_profiles') {
      return mockPagedTable(profiles, { table, log: options.log, error: options.errors?.[table] })
    }
    if (table === 'assignment_docs') {
      return mockPagedTable(docs, { table, log: options.log, error: options.errors?.[table] })
    }
    if (table === 'assignment_submission_requirements') {
      return makeRequirementsTable(requirements)
    }
    if (table === 'assignment_submission_artifacts') {
      return mockPagedTable(artifacts, { table, log: options.log, error: options.errors?.[table] })
    }
    if (table === 'assignment_doc_history') {
      return mockPagedTable(historyRows, { table, log: options.log, error: options.errors?.[table] })
    }
    throw new Error(`Unexpected table: ${table}`)
  })
}

describe('GET /api/teacher/assignments/[id]', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('should return 404 when assignment does not exist', async () => {
    const mockFrom = vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          single: vi.fn().mockResolvedValue({ data: null, error: { code: 'PGRST116' } }),
        })),
      })),
    }))
    ;(mockSupabaseClient.from as any) = mockFrom

    const request = new NextRequest('http://localhost:3000/api/teacher/assignments/a-999')
    const response = await GET(request, { params: { id: 'a-999' } })
    expect(response.status).toBe(404)
  })

  it('returns artifacts and trimmed doc fields for each student row', async () => {
    const historyCreatedAt = '2026-03-10T10:00:00.000Z'
    const submittedAt = '2026-03-10T09:00:00.000Z'
    const updatedAt = '2026-03-10T09:30:00.000Z'

    ;(mockSupabaseClient.from as any) = vi.fn((table: string) => {
      if (table === 'assignments') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              single: vi.fn().mockResolvedValue({
                data: {
                  id: 'a-1',
                  classroom_id: 'classroom-1',
                  title: 'Assignment 1',
                  description: 'Desc',
                  instructions_markdown: 'Desc',
                  rich_instructions: null,
                  due_at: '2099-03-10T23:59:00.000Z',
                  position: 0,
                  is_draft: false,
                  released_at: null,
                  track_authenticity: true,
                  created_by: 'teacher-1',
                  created_at: '2026-03-01T00:00:00.000Z',
                  updated_at: '2026-03-02T00:00:00.000Z',
                  classrooms: {
                    id: 'classroom-1',
                    teacher_id: 'teacher-1',
                    title: 'Test Classroom',
                    archived_at: null,
                  },
                },
                error: null,
              }),
            })),
          })),
        }
      }

      if (table === 'classroom_enrollments') {
        return mockPagedTable([
          {
            id: 'enrollment-1',
            classroom_id: 'classroom-1',
            student_id: 'student-1',
            users: { id: 'student-1', email: 'student1@example.com' },
          },
        ])
      }

      if (table === 'student_profiles') {
        return mockPagedTable([
          {
            user_id: 'student-1',
            first_name: 'Alex',
            last_name: 'Lee',
          },
        ])
      }

      if (table === 'assignment_docs') {
        return mockPagedTable([
          {
            id: 'doc-1',
            assignment_id: 'a-1',
            student_id: 'student-1',
            content: {
              type: 'doc',
              content: [
                {
                  type: 'paragraph',
                  content: [
                    {
                      type: 'text',
                      text: 'Source https://example.com/resource',
                      marks: [{ type: 'link', attrs: { href: 'mailto:nope@example.com' } }],
                    },
                  ],
                },
                {
                  type: 'image',
                  attrs: { src: 'https://cdn.example.com/submission-images/shot.png' },
                },
              ],
            },
            is_submitted: true,
            submitted_at: submittedAt,
            updated_at: updatedAt,
            score_completion: 9,
            score_thinking: 8,
            score_workflow: 7,
            graded_at: '2026-03-10T12:00:00.000Z',
            returned_at: null,
          },
        ])
      }

      if (table === 'assignment_doc_history') {
        return mockPagedTable([{ assignment_doc_id: 'doc-1', created_at: historyCreatedAt }])
      }

      if (table === 'assignment_submission_requirements') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              order: vi.fn(() => ({
                order: vi.fn().mockResolvedValue({
                  data: [
                    makeRequirement({
                      id: 'req-1',
                      type: 'link',
                      label: 'Project page',
                      position: 0,
                    }),
                    makeRequirement({
                      id: 'req-2',
                      type: 'link',
                      label: 'Backup page',
                      position: 1,
                    }),
                    makeRequirement({
                      id: 'req-3',
                      type: 'repo_link',
                      label: 'Source repo',
                      position: 2,
                    }),
                  ],
                  error: null,
                }),
              })),
            })),
          })),
        }
      }

      if (table === 'assignment_submission_artifacts') {
        return mockPagedTable([
          {
            id: 'artifact-1',
            assignment_doc_id: 'doc-1',
            requirement_id: 'req-1',
            student_id: 'student-1',
            type: 'link',
            url: 'https://example.com/resource',
            storage_path: null,
            metadata_json: {},
            validation_status: 'valid',
            validation_message: null,
            validated_at: '2026-03-10T09:35:00.000Z',
            created_at: '2026-03-10T09:35:00.000Z',
            updated_at: '2026-03-10T09:35:00.000Z',
          },
          {
            id: 'artifact-2',
            assignment_doc_id: 'doc-1',
            requirement_id: 'req-2',
            student_id: 'student-1',
            type: 'link',
            url: 'https://example.com/resource',
            storage_path: null,
            metadata_json: {},
            validation_status: 'valid',
            validation_message: null,
            validated_at: '2026-03-10T09:35:00.000Z',
            created_at: '2026-03-10T09:35:00.000Z',
            updated_at: '2026-03-10T09:35:00.000Z',
          },
          {
            id: 'artifact-3',
            assignment_doc_id: 'doc-1',
            requirement_id: 'req-3',
            student_id: 'student-1',
            type: 'repo_link',
            url: 'https://github.com/codepetca/pika',
            storage_path: null,
            metadata_json: {
              repo_owner: 'codepetca',
              repo_name: 'pika',
              normalized_url: 'https://github.com/codepetca/pika',
            },
            validation_status: 'valid',
            validation_message: null,
            validated_at: '2026-03-10T09:35:00.000Z',
            created_at: '2026-03-10T09:35:00.000Z',
            updated_at: '2026-03-10T09:35:00.000Z',
          },
        ])
      }

      throw new Error(`Unexpected table: ${table}`)
    })

    const request = new NextRequest('http://localhost:3000/api/teacher/assignments/a-1')
    const response = await GET(request, { params: { id: 'a-1' } })
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.students).toHaveLength(1)
    expect(data.students[0].student_updated_at).toBe(historyCreatedAt)
    expect(data.students[0].artifacts).toEqual([
      {
        type: 'link',
        url: 'https://example.com/resource',
        title: 'Project page',
        is_required_submission: true,
        requirement_id: 'req-1',
        requirement_required: true,
        validation_status: 'valid',
        validation_message: null,
      },
      {
        type: 'link',
        url: 'https://example.com/resource',
        title: 'Backup page',
        is_required_submission: true,
        requirement_id: 'req-2',
        requirement_required: true,
        validation_status: 'valid',
        validation_message: null,
      },
      {
        type: 'repo',
        url: 'https://github.com/codepetca/pika',
        title: 'Source repo',
        is_required_submission: true,
        requirement_id: 'req-3',
        requirement_required: true,
        validation_status: 'valid',
        validation_message: null,
        repo_owner: 'codepetca',
        repo_name: 'pika',
        normalized_url: 'https://github.com/codepetca/pika',
      },
      { type: 'image', url: 'https://cdn.example.com/submission-images/shot.png' },
    ])
    expect(data.students[0].submission_completion).toEqual({
      required_count: 3,
      completed_required_count: 3,
      can_submit: true,
      blocking_count: 0,
    })
    expect(data.students[0].doc).toEqual({
      is_submitted: true,
      submitted_at: submittedAt,
      updated_at: updatedAt,
      score_completion: 9,
      score_thinking: 8,
      score_workflow: 7,
      graded_at: '2026-03-10T12:00:00.000Z',
      returned_at: null,
    })
    expect(data.students[0].doc).not.toHaveProperty('content')
    expect(data.active_ai_grading_run).toBeNull()
  })

  it('pages and chunks detail reads while ignoring unenrolled assignment docs', async () => {
    const studentIds = Array.from({ length: 1001 }, (_, index) => `student-${index}`)
    const enrollments = studentIds.map((studentId, index) => ({
      id: `enrollment-${index.toString().padStart(4, '0')}`,
      classroom_id: 'classroom-1',
      student_id: studentId,
      users: { id: studentId, email: `${studentId}@example.com` },
    }))
    const profiles = studentIds.map((studentId, index) => ({
      user_id: studentId,
      first_name: 'Student',
      last_name: index.toString().padStart(4, '0'),
    }))
    const docs = [
      ...studentIds.map((studentId, index) =>
        makeAssignmentDoc({
          id: `doc-${index}`,
          student_id: studentId,
          updated_at: `2026-03-10T09:${String(index % 60).padStart(2, '0')}:00.000Z`,
        })
      ),
      makeAssignmentDoc({
        id: 'removed-doc',
        student_id: 'removed-student',
        updated_at: '2026-03-10T10:00:00.000Z',
      }),
    ]
    const historyRows = Array.from({ length: 1001 }, (_, index) => ({
      assignment_doc_id: 'doc-0',
      created_at: `2026-03-10T10:${String(index % 60).padStart(2, '0')}:00.000Z`,
    }))
    const log = createQueryLog()
    ;(mockSupabaseClient.from as any) = mockAssignmentDetailTables({
      enrollments,
      profiles,
      docs,
      historyRows,
      log,
    })

    const request = new NextRequest('http://localhost:3000/api/teacher/assignments/a-1')
    const response = await GET(request, { params: { id: 'a-1' } })
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.students).toHaveLength(1001)
    expect(data.students.some((student: any) => student.student_id === 'removed-student')).toBe(false)
    expect(data.students.find((student: any) => student.student_id === 'student-1000')?.doc?.updated_at)
      .toBe('2026-03-10T09:40:00.000Z')

    expect(log.rangeCalls.filter((call) => call.table === 'classroom_enrollments')).toEqual([
      { table: 'classroom_enrollments', from: 0, to: 999 },
      { table: 'classroom_enrollments', from: 1000, to: 1999 },
    ])

    const profileInCalls = log.inCalls.filter((call) => call.table === 'student_profiles')
    expect(profileInCalls).toHaveLength(21)
    expect(profileInCalls[0].values).toHaveLength(50)
    expect(profileInCalls[20].values).toHaveLength(1)

    const docStudentIds = log.inCalls
      .filter((call) => call.table === 'assignment_docs')
      .flatMap((call) => call.values)
    expect(docStudentIds).toContain('student-1000')
    expect(docStudentIds).not.toContain('removed-student')

    expect(log.rangeCalls.filter((call) => call.table === 'assignment_doc_history').slice(0, 2)).toEqual([
      { table: 'assignment_doc_history', from: 0, to: 999 },
      { table: 'assignment_doc_history', from: 1000, to: 1999 },
    ])
  })

  it.each([
    ['student_profiles', 'Failed to fetch student profiles'],
    ['assignment_docs', 'Failed to fetch assignment docs'],
    ['assignment_doc_history', 'Failed to fetch assignment doc history'],
  ])('returns 500 when %s cannot be read', async (failingTable, expectedError) => {
    ;(mockSupabaseClient.from as any) = mockAssignmentDetailTables({
      errors: {
        [failingTable]: { message: `${failingTable} failed` },
      },
    })

    const request = new NextRequest('http://localhost:3000/api/teacher/assignments/a-1')
    const response = await GET(request, { params: { id: 'a-1' } })
    const data = await response.json()

    expect(response.status).toBe(500)
    expect(data.error).toBe(expectedError)
  })
})

describe('PATCH /api/teacher/assignments/[id]', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('should return 400 when no fields to update', async () => {
    const mockFrom = vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          single: vi.fn().mockResolvedValue({
            data: {
              id: 'a-1',
              created_by: 'teacher-1',
              classrooms: { teacher_id: 'teacher-1' },
            },
            error: null,
          }),
        })),
      })),
    }))
    ;(mockSupabaseClient.from as any) = mockFrom

    const request = new NextRequest('http://localhost:3000/api/teacher/assignments/a-1', {
      method: 'PATCH',
      body: JSON.stringify({}),
    })

    const response = await PATCH(request, { params: { id: 'a-1' } })
    expect(response.status).toBe(400)
  })

  it('accepts a basic assignment patch without repo review mode', async () => {
    ;(mockSupabaseClient.from as any) = vi.fn((table: string) => {
      if (table === 'assignments') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              single: vi.fn().mockResolvedValue({
                data: {
                  id: 'a-1',
                  title: 'Assignment 1',
                  classrooms: { teacher_id: 'teacher-1', archived_at: null },
                },
                error: null,
              }),
            })),
          })),
          update: vi.fn(() => ({
            eq: vi.fn(() => ({
              select: vi.fn(() => ({
                single: vi.fn().mockResolvedValue({
                  data: {
                    id: 'a-1',
                    title: 'Updated title',
                    classrooms: { teacher_id: 'teacher-1', archived_at: null },
                  },
                  error: null,
                }),
              })),
            })),
          })),
        }
      }

      throw new Error(`Unexpected table: ${table}`)
    })

    const request = new NextRequest('http://localhost:3000/api/teacher/assignments/a-1', {
      method: 'PATCH',
      body: JSON.stringify({
        title: 'Updated title',
      }),
    })

    const response = await PATCH(request, { params: { id: 'a-1' } })
    expect(response.status).toBe(200)
  })

  it('rejects rescheduling a scheduled assignment after the due date', async () => {
    let updateCalled = false
    ;(mockSupabaseClient.from as any) = vi.fn((table: string) => {
      if (table === 'assignments') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              single: vi.fn().mockResolvedValue({
                data: {
                  id: 'a-1',
                  is_draft: false,
                  released_at: '2099-03-01T14:00:00.000Z',
                  due_at: '2099-03-01T23:59:00.000Z',
                  classrooms: { teacher_id: 'teacher-1', archived_at: null },
                },
                error: null,
              }),
            })),
          })),
          update: vi.fn(() => {
            updateCalled = true
            return {
              eq: vi.fn(() => ({
                select: vi.fn(() => ({
                  single: vi.fn().mockResolvedValue({ data: null, error: null }),
                })),
              })),
            }
          }),
        }
      }

      throw new Error(`Unexpected table: ${table}`)
    })

    const request = new NextRequest('http://localhost:3000/api/teacher/assignments/a-1', {
      method: 'PATCH',
      body: JSON.stringify({ released_at: '2099-03-02T00:00:00.000Z' }),
    })

    const response = await PATCH(request, { params: { id: 'a-1' } })
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toBe('Scheduled release must be on or before the due date.')
    expect(updateCalled).toBe(false)
  })

  it('rejects moving the due date before an existing scheduled release', async () => {
    ;(mockSupabaseClient.from as any) = vi.fn((table: string) => {
      if (table === 'assignments') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              single: vi.fn().mockResolvedValue({
                data: {
                  id: 'a-1',
                  is_draft: false,
                  released_at: '2099-03-02T14:00:00.000Z',
                  due_at: '2099-03-03T23:59:00.000Z',
                  classrooms: { teacher_id: 'teacher-1', archived_at: null },
                },
                error: null,
              }),
            })),
          })),
          update: vi.fn(() => {
            throw new Error('Update should not be called')
          }),
        }
      }

      throw new Error(`Unexpected table: ${table}`)
    })

    const request = new NextRequest('http://localhost:3000/api/teacher/assignments/a-1', {
      method: 'PATCH',
      body: JSON.stringify({ due_at: '2099-03-01T23:59:00.000Z' }),
    })

    const response = await PATCH(request, { params: { id: 'a-1' } })
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toBe('Scheduled release must be on or before the due date.')
  })

  it('allows clearing a scheduled release back to draft', async () => {
    let capturedUpdate: any = null
    ;(mockSupabaseClient.from as any) = vi.fn((table: string) => {
      if (table === 'assignments') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              single: vi.fn().mockResolvedValue({
                data: {
                  id: 'a-1',
                  is_draft: false,
                  released_at: '2099-03-02T14:00:00.000Z',
                  due_at: '2099-03-01T23:59:00.000Z',
                  classrooms: { teacher_id: 'teacher-1', archived_at: null },
                },
                error: null,
              }),
            })),
          })),
          update: vi.fn((updateData) => {
            capturedUpdate = updateData
            return {
              eq: vi.fn(() => ({
                select: vi.fn(() => ({
                  single: vi.fn().mockResolvedValue({
                    data: { id: 'a-1', ...updateData },
                    error: null,
                  }),
                })),
              })),
            }
          }),
        }
      }

      throw new Error(`Unexpected table: ${table}`)
    })

    const request = new NextRequest('http://localhost:3000/api/teacher/assignments/a-1', {
      method: 'PATCH',
      body: JSON.stringify({ is_draft: true, released_at: null }),
    })

    const response = await PATCH(request, { params: { id: 'a-1' } })

    expect(response.status).toBe(200)
    expect(capturedUpdate).toEqual({ is_draft: true, released_at: null })
  })

  it('removes image artifact storage after an image requirement is removed', async () => {
    const remove = vi.fn(async () => ({ error: null }))
    const remainingRequirement = makeRequirement({ id: 'req-link', type: 'link', label: 'Demo link' })
    ;(mockSupabaseClient.rpc as any) = vi.fn(async () => ({
      data: [remainingRequirement],
      error: null,
    }))
    ;(mockSupabaseClient.storage as any) = {
      from: vi.fn(() => ({ remove })),
    }
    ;(mockSupabaseClient.from as any) = vi.fn((table: string) => {
      if (table === 'assignments') return makeAssignmentSelectTable()
      if (table === 'assignment_submission_requirements') {
        return makeRequirementsTable([
          makeRequirement({ id: 'req-image', type: 'image', label: 'Screenshot', position: 0 }),
          makeRequirement({ id: 'req-link', type: 'link', label: 'Demo link', position: 1 }),
        ])
      }
      if (table === 'assignment_submission_artifacts') {
        return makeImageArtifactsTable(['student-1/a-1/req-image.png'])
      }

      throw new Error(`Unexpected table: ${table}`)
    })

    const request = new NextRequest('http://localhost:3000/api/teacher/assignments/a-1', {
      method: 'PATCH',
      body: JSON.stringify({
        submission_requirements: [
          { id: 'req-link', type: 'link', label: 'Demo link', position: 0 },
        ],
      }),
    })

    const response = await PATCH(request, { params: { id: 'a-1' } })

    expect(response.status).toBe(200)
    expect(remove).toHaveBeenCalledWith(['student-1/a-1/req-image.png'])
  })

  it('preserves image artifact storage when the image requirement id is kept', async () => {
    const remove = vi.fn(async () => ({ error: null }))
    const updatedRequirement = makeRequirement({ id: 'req-image', type: 'image', label: 'Updated screenshot' })
    ;(mockSupabaseClient.rpc as any) = vi.fn(async () => ({
      data: [updatedRequirement],
      error: null,
    }))
    ;(mockSupabaseClient.storage as any) = {
      from: vi.fn(() => ({ remove })),
    }
    ;(mockSupabaseClient.from as any) = vi.fn((table: string) => {
      if (table === 'assignments') return makeAssignmentSelectTable()
      if (table === 'assignment_submission_requirements') {
        return makeRequirementsTable([
          makeRequirement({ id: 'req-image', type: 'image', label: 'Screenshot', position: 0 }),
        ])
      }

      throw new Error(`Unexpected table: ${table}`)
    })

    const request = new NextRequest('http://localhost:3000/api/teacher/assignments/a-1', {
      method: 'PATCH',
      body: JSON.stringify({
        submission_requirements: [
          { id: 'req-image', type: 'image', label: 'Updated screenshot', position: 1 },
        ],
      }),
    })

    const response = await PATCH(request, { params: { id: 'a-1' } })

    expect(response.status).toBe(200)
    expect(remove).not.toHaveBeenCalled()
    expect(mockSupabaseClient.from).not.toHaveBeenCalledWith('assignment_submission_artifacts')
  })
})

describe('DELETE /api/teacher/assignments/[id]', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('should return 403 when not creator', async () => {
    const mockFrom = vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          single: vi.fn().mockResolvedValue({
            data: {
              id: 'a-1',
              created_by: 'other',
              classrooms: { teacher_id: 'other' },
            },
            error: null,
          }),
        })),
      })),
    }))
    ;(mockSupabaseClient.from as any) = mockFrom

    const request = new NextRequest('http://localhost:3000/api/teacher/assignments/a-1', {
      method: 'DELETE',
    })

    const response = await DELETE(request, { params: { id: 'a-1' } })
    expect(response.status).toBe(403)
  })

  it('removes related image artifact storage after deleting an assignment', async () => {
    const remove = vi.fn(async () => ({ error: null }))
    const deleteEq = vi.fn(async () => ({ error: null }))
    ;(mockSupabaseClient.storage as any) = {
      from: vi.fn(() => ({ remove })),
    }
    ;(mockSupabaseClient.from as any) = vi.fn((table: string) => {
      if (table === 'assignments') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              single: vi.fn().mockResolvedValue({ data: makeAssignment(), error: null }),
            })),
          })),
          delete: vi.fn(() => ({
            eq: deleteEq,
          })),
        }
      }
      if (table === 'assignment_submission_requirements') {
        return makeRequirementsTable([
          makeRequirement({ id: 'req-image', type: 'image', label: 'Screenshot' }),
          makeRequirement({ id: 'req-link', type: 'link', label: 'Demo link' }),
        ])
      }
      if (table === 'assignment_submission_artifacts') {
        return makeImageArtifactsTable(['student-1/a-1/req-image.png'])
      }

      throw new Error(`Unexpected table: ${table}`)
    })

    const request = new NextRequest('http://localhost:3000/api/teacher/assignments/a-1', {
      method: 'DELETE',
    })

    const response = await DELETE(request, { params: { id: 'a-1' } })

    expect(response.status).toBe(200)
    expect(deleteEq).toHaveBeenCalledWith('id', 'a-1')
    expect(remove).toHaveBeenCalledWith(['student-1/a-1/req-image.png'])
    expect(remove.mock.invocationCallOrder[0]).toBeGreaterThan(deleteEq.mock.invocationCallOrder[0])
  })

  it('logs storage removal failures without failing a successful assignment delete', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const removeError = { message: 'storage unavailable' }
    const remove = vi.fn(async () => ({ error: removeError }))
    const deleteEq = vi.fn(async () => ({ error: null }))
    ;(mockSupabaseClient.storage as any) = {
      from: vi.fn(() => ({ remove })),
    }
    ;(mockSupabaseClient.from as any) = vi.fn((table: string) => {
      if (table === 'assignments') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              single: vi.fn().mockResolvedValue({ data: makeAssignment(), error: null }),
            })),
          })),
          delete: vi.fn(() => ({
            eq: deleteEq,
          })),
        }
      }
      if (table === 'assignment_submission_requirements') {
        return makeRequirementsTable([
          makeRequirement({ id: 'req-image', type: 'image', label: 'Screenshot' }),
        ])
      }
      if (table === 'assignment_submission_artifacts') {
        return makeImageArtifactsTable(['student-1/a-1/req-image.png'])
      }

      throw new Error(`Unexpected table: ${table}`)
    })

    const request = new NextRequest('http://localhost:3000/api/teacher/assignments/a-1', {
      method: 'DELETE',
    })

    const response = await DELETE(request, { params: { id: 'a-1' } })

    expect(response.status).toBe(200)
    expect(remove).toHaveBeenCalledWith(['student-1/a-1/req-image.png'])
    expect(consoleError).toHaveBeenCalledWith(
      'Failed to remove assignment artifact storage objects:',
      expect.objectContaining({
        context: 'assignment:a-1:delete',
        error: removeError,
        paths: ['student-1/a-1/req-image.png'],
      })
    )
    consoleError.mockRestore()
  })
})
