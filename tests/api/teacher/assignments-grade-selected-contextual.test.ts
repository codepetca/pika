import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

import { POST as gradeOne } from '@/app/api/teacher/assignments/[id]/grade/route'
import { POST as gradeSelected } from '@/app/api/teacher/assignments/[id]/grade-selected/route'
import { authorizeContextualAssignmentGradingRequest } from '@/lib/server/contextual-assignment-grading-access'
import { saveAssignmentGradesAtomic, saveAssignmentGradesForOwner } from '@/lib/server/assignment-grades'

vi.mock('@/lib/supabase', () => ({ getServiceRoleClient: vi.fn(() => ({ rpc: vi.fn() })) }))
vi.mock('@/lib/server/contextual-assignment-grading-access', () => ({
  authorizeContextualAssignmentGradingRequest: vi.fn(),
}))
vi.mock('@/lib/server/assignment-grades', () => ({
  saveAssignmentGradesAtomic: vi.fn(),
  saveAssignmentGradesForOwner: vi.fn(),
}))

const actorId = '11111111-1111-4111-8111-111111111111'
const assignmentId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const studentOne = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1'
const studentTwo = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2'
const revisionOne = '2026-09-20T18:00:00.000Z'
const revisionTwo = '2026-09-20T18:00:01.000Z'

function makeDoc(studentId: string) {
  return {
    id: `doc-${studentId}`,
    assignment_id: assignmentId,
    student_id: studentId,
  }
}

describe('contextual manual Assignment grading routes', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.mocked(authorizeContextualAssignmentGradingRequest).mockResolvedValue({
      mode: 'contextual',
      user: { id: actorId, role: 'student', email: 'owner@example.com' } as never,
      assignmentId,
    })
  })

  it('routes a student-valued exact owner through the fenced single-grade boundary', async () => {
    vi.mocked(saveAssignmentGradesForOwner).mockResolvedValue([makeDoc(studentOne)] as never)
    const request = new NextRequest(`http://localhost/api/teacher/assignments/${assignmentId}/grade`, {
      method: 'POST',
      body: JSON.stringify({
        student_id: studentOne,
        expected_doc_updated_at: revisionOne,
        score_completion: 7,
        score_thinking: 8,
        score_workflow: 9,
        feedback: 'Strong work',
      }),
    })

    const response = await gradeOne(request, { params: Promise.resolve({ id: assignmentId }) })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ doc: makeDoc(studentOne) })
    expect(saveAssignmentGradesForOwner).toHaveBeenCalledWith(expect.objectContaining({
      actorId,
      assignmentId,
      studentIds: [studentOne],
      expectedDocUpdatedAtByStudent: { [studentOne]: revisionOne },
    }))
    expect(saveAssignmentGradesAtomic).not.toHaveBeenCalled()
  })

  it('routes selected students through the same fenced owner boundary', async () => {
    const docs = [makeDoc(studentOne), makeDoc(studentTwo)]
    vi.mocked(saveAssignmentGradesForOwner).mockResolvedValue(docs as never)
    const request = new NextRequest(`http://localhost/api/teacher/assignments/${assignmentId}/grade-selected`, {
      method: 'POST',
      body: JSON.stringify({
        student_ids: [studentOne, studentTwo],
        expected_doc_updated_at_by_student: {
          [studentOne]: revisionOne,
          [studentTwo]: revisionTwo,
        },
        score_completion: 7,
        score_thinking: 8,
        score_workflow: 9,
        feedback: 'Shared feedback',
      }),
    })

    const response = await gradeSelected(request, { params: Promise.resolve({ id: assignmentId }) })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      updated_count: 2,
      updated_student_ids: [studentOne, studentTwo],
      docs,
    })
    expect(saveAssignmentGradesForOwner).toHaveBeenCalledWith(expect.objectContaining({
      actorId,
      assignmentId,
      studentIds: [studentOne, studentTwo],
    }))
    expect(saveAssignmentGradesAtomic).not.toHaveBeenCalled()
  })

  it('keeps an unmatched teacher on the legacy grading boundary', async () => {
    vi.mocked(authorizeContextualAssignmentGradingRequest).mockResolvedValue({
      mode: 'legacy',
      user: { id: actorId, role: 'teacher', email: 'owner@example.com' } as never,
      assignmentId,
    })
    vi.mocked(saveAssignmentGradesAtomic).mockResolvedValue([makeDoc(studentOne)] as never)
    const request = new NextRequest(`http://localhost/api/teacher/assignments/${assignmentId}/grade`, {
      method: 'POST',
      body: JSON.stringify({
        student_id: studentOne,
        expected_doc_updated_at: revisionOne,
        score_completion: 7,
        score_thinking: 8,
        score_workflow: 9,
        feedback: 'Strong work',
      }),
    })

    const response = await gradeOne(request, { params: Promise.resolve({ id: assignmentId }) })

    expect(response.status).toBe(200)
    expect(saveAssignmentGradesAtomic).toHaveBeenCalledWith(expect.objectContaining({
      teacherId: actorId,
      assignmentId,
    }))
    expect(saveAssignmentGradesForOwner).not.toHaveBeenCalled()
  })
})
