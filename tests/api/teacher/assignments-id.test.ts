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

const mockSupabaseClient = { from: vi.fn() }

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
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockResolvedValue({
              data: [
                {
                  student_id: 'student-1',
                  users: { id: 'student-1', email: 'student1@example.com' },
                },
              ],
              error: null,
            }),
          })),
        }
      }

      if (table === 'student_profiles') {
        return {
          select: vi.fn(() => ({
            in: vi.fn().mockResolvedValue({
              data: [
                {
                  user_id: 'student-1',
                  first_name: 'Alex',
                  last_name: 'Lee',
                },
              ],
              error: null,
            }),
          })),
        }
      }

      if (table === 'assignment_docs') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockResolvedValue({
              data: [
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
              ],
              error: null,
            }),
          })),
        }
      }

      if (table === 'assignment_doc_history') {
        return {
          select: vi.fn(() => ({
            in: vi.fn().mockResolvedValue({
              data: [{ assignment_doc_id: 'doc-1', created_at: historyCreatedAt }],
              error: null,
            }),
          })),
        }
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
      { type: 'link', url: 'https://example.com/resource' },
      { type: 'image', url: 'https://cdn.example.com/submission-images/shot.png' },
    ])
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
})
