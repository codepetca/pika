import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const { gradeStudentWork } = vi.hoisted(() => ({
  gradeStudentWork: vi.fn(),
}))

vi.mock('@/lib/supabase', () => ({
  getServiceRoleClient: vi.fn(() => mockSupabaseClient),
}))

vi.mock('@/lib/auth', () => ({
  requireRole: vi.fn(async () => ({
    id: 'teacher-1',
    email: 'teacher@example.com',
    role: 'teacher',
  })),
}))

vi.mock('@/lib/ai-grading', () => ({
  gradeStudentWork,
}))

import { POST } from '@/app/api/teacher/assignments/[id]/auto-grade/route'

const mockSupabaseClient = { from: vi.fn() }

describe('POST /api/teacher/assignments/[id]/auto-grade', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    gradeStudentWork.mockResolvedValue({
      score_completion: 8,
      score_thinking: 7,
      score_workflow: 9,
      feedback: 'Strength: Complete submission. Next Step: Add a short reflection.',
      model: 'gpt-5-nano',
    })
  })

  it('parses legacy stringified assignment doc content before grading', async () => {
    const legacyContent = JSON.stringify({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: 'My portfolio is attached here.',
              marks: [
                {
                  type: 'link',
                  attrs: { href: 'https://student.example.com/portfolio' },
                },
              ],
            },
          ],
        },
      ],
    })

    const updateCalls: Array<Record<string, unknown>> = []

    ;(mockSupabaseClient.from as any) = vi.fn((table: string) => {
      if (table === 'assignments') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              single: vi.fn().mockResolvedValue({
                data: {
                  id: 'assignment-1',
                  title: 'Portfolio Site',
                  instructions_markdown: 'Build and submit your portfolio site.',
                  rich_instructions: null,
                  description: 'Build and submit your portfolio site.',
                  classrooms: { teacher_id: 'teacher-1' },
                },
                error: null,
              }),
            })),
          })),
        }
      }

      if (table === 'assignment_docs') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              in: vi.fn().mockResolvedValue({
                data: [
                  {
                    id: 'doc-1',
                    student_id: 'student-1',
                    content: legacyContent,
                    feedback: 'Earlier feedback',
                    authenticity_score: 42,
                  },
                ],
                error: null,
              }),
            })),
          })),
          update: vi.fn((payload: Record<string, unknown>) => {
            updateCalls.push(payload)
            return {
              eq: vi.fn().mockResolvedValue({ error: null }),
            }
          }),
        }
      }

      throw new Error(`Unexpected table: ${table}`)
    })

    const request = new NextRequest('http://localhost:3000/api/teacher/assignments/assignment-1/auto-grade', {
      method: 'POST',
      body: JSON.stringify({
        student_ids: ['student-1'],
      }),
    })

    const response = await POST(request, { params: Promise.resolve({ id: 'assignment-1' }) })
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data).toEqual({
      graded_count: 1,
      skipped_count: 0,
      errors: undefined,
    })
    expect(gradeStudentWork).toHaveBeenCalledTimes(1)
    expect(gradeStudentWork).toHaveBeenCalledWith({
      assignmentTitle: 'Portfolio Site',
      instructions: 'Build and submit your portfolio site.',
      studentWork: {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              {
                type: 'text',
                text: 'My portfolio is attached here.',
                marks: [
                  {
                    type: 'link',
                    attrs: { href: 'https://student.example.com/portfolio' },
                  },
                ],
              },
            ],
          },
        ],
      },
      previousFeedback: 'Earlier feedback',
    })
    expect(updateCalls).toEqual([
      expect.objectContaining({
        score_completion: 8,
        score_thinking: 7,
        score_workflow: 9,
        ai_feedback_suggestion: 'Strength: Complete submission. Next Step: Add a short reflection.',
        ai_feedback_model: 'gpt-5-nano',
        graded_at: null,
        graded_by: null,
      }),
    ])
  })

  it('skips legacy stringified empty docs without calling the grader', async () => {
    ;(mockSupabaseClient.from as any) = vi.fn((table: string) => {
      if (table === 'assignments') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              single: vi.fn().mockResolvedValue({
                data: {
                  id: 'assignment-1',
                  title: 'Portfolio Site',
                  instructions_markdown: 'Build and submit your portfolio site.',
                  rich_instructions: null,
                  description: 'Build and submit your portfolio site.',
                  classrooms: { teacher_id: 'teacher-1' },
                },
                error: null,
              }),
            })),
          })),
        }
      }

      if (table === 'assignment_docs') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              in: vi.fn().mockResolvedValue({
                data: [
                  {
                    id: 'doc-1',
                    student_id: 'student-1',
                    content: JSON.stringify({ type: 'doc', content: [] }),
                    feedback: null,
                    authenticity_score: 42,
                  },
                ],
                error: null,
              }),
            })),
          })),
          update: vi.fn(() => ({
            eq: vi.fn().mockResolvedValue({ error: null }),
          })),
        }
      }

      throw new Error(`Unexpected table: ${table}`)
    })

    const request = new NextRequest('http://localhost:3000/api/teacher/assignments/assignment-1/auto-grade', {
      method: 'POST',
      body: JSON.stringify({
        student_ids: ['student-1'],
      }),
    })

    const response = await POST(request, { params: Promise.resolve({ id: 'assignment-1' }) })
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data).toEqual({
      graded_count: 0,
      skipped_count: 1,
      errors: undefined,
    })
    expect(gradeStudentWork).not.toHaveBeenCalled()
  })
})
