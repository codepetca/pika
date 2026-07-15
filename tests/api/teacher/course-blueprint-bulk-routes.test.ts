import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { POST as POST_ASSIGNMENTS } from '@/app/api/teacher/course-blueprints/[id]/assignments/bulk/route'
import { POST as POST_ASSESSMENTS } from '@/app/api/teacher/course-blueprints/[id]/assessments/bulk/route'
import { POST as POST_LESSONS } from '@/app/api/teacher/course-blueprints/[id]/lesson-templates/bulk/route'

const mockRequireRole = vi.fn()
const mockSyncAssignments = vi.fn()
const mockSyncAssessments = vi.fn()
const mockSyncLessons = vi.fn()

vi.mock('@/lib/auth', () => ({
  requireRole: (...args: unknown[]) => mockRequireRole(...args),
}))

vi.mock('@/lib/server/course-blueprints', () => ({
  syncCourseBlueprintAssignments: (...args: unknown[]) => mockSyncAssignments(...args),
  syncCourseBlueprintAssessments: (...args: unknown[]) => mockSyncAssessments(...args),
  syncCourseBlueprintLessonTemplates: (...args: unknown[]) => mockSyncLessons(...args),
}))

const context = { params: Promise.resolve({ id: 'blueprint-1' }) } as any

function post(path: string, body: unknown) {
  return new NextRequest(`http://localhost:3000${path}`, {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

describe('teacher course blueprint bulk routes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRequireRole.mockResolvedValue({ id: 'teacher-1' })
    mockSyncAssignments.mockResolvedValue({ ok: true })
    mockSyncAssessments.mockResolvedValue({ ok: true })
    mockSyncLessons.mockResolvedValue({ ok: true })
  })

  it('passes validated blueprint payloads to application services', async () => {
    const assignment = {
      title: 'Diagnostic',
      instructions_markdown: 'Complete before class.',
      default_due_days: -2,
      default_due_time: '08:30',
      points_possible: 12.5,
      include_in_final: true,
      is_draft: true,
      position: 0,
    }
    const assessment = {
      assessment_type: 'test',
      title: 'Unit test',
      content: {
        title: 'Unit test',
        show_results: false,
        questions: [{
          id: '22222222-2222-4222-8222-222222222222',
          question_type: 'open_response',
          question_text: 'Explain recursion.',
          options: [],
          correct_option: null,
          answer_key: 'A function calls itself.',
          sample_solution: null,
          points: 5,
          response_max_chars: 1000,
          response_monospace: false,
        }],
      },
      documents: [],
      position: 0,
    }
    const lesson = { title: 'Lesson 1', content_markdown: 'Introduction', position: 0 }

    await expect(POST_ASSIGNMENTS(post('/assignments', { assignments: [assignment] }), context))
      .resolves.toHaveProperty('status', 200)
    await expect(POST_ASSESSMENTS(post('/assessments', {
      assessmentType: 'test',
      assessments: [assessment],
    }), context)).resolves.toHaveProperty('status', 200)
    await expect(POST_LESSONS(post('/lessons', { lesson_templates: [lesson] }), context))
      .resolves.toHaveProperty('status', 200)

    expect(mockSyncAssignments).toHaveBeenCalledWith('teacher-1', 'blueprint-1', [assignment])
    expect(mockSyncAssessments).toHaveBeenCalledWith('teacher-1', 'blueprint-1', [assessment], {
      replaceTypes: ['test'],
    })
    expect(mockSyncLessons).toHaveBeenCalledWith('teacher-1', 'blueprint-1', [lesson])
  })

  it('rejects malformed nested payloads before calling application services', async () => {
    const assignmentResponse = await POST_ASSIGNMENTS(post('/assignments', {
      assignments: [{ title: 'Broken', default_due_time: '99:99' }],
    }), context)
    const assessmentResponse = await POST_ASSESSMENTS(post('/assessments', {
      assessments: [{
        assessment_type: 'test',
        title: 'Broken',
        content: { title: 'Broken', show_results: false, questions: [{}] },
        documents: [],
        position: 0,
      }],
    }), context)
    const lessonResponse = await POST_LESSONS(post('/lessons', {
      lesson_templates: [{ title: 'Broken', content_markdown: '', position: -1 }],
    }), context)

    expect(assignmentResponse.status).toBe(400)
    expect(assessmentResponse.status).toBe(400)
    expect(lessonResponse.status).toBe(400)
    expect(mockSyncAssignments).not.toHaveBeenCalled()
    expect(mockSyncAssessments).not.toHaveBeenCalled()
    expect(mockSyncLessons).not.toHaveBeenCalled()
  })
})
