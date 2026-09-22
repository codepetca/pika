import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useTeacherStudentWorkController } from '@/components/assignment-workspace/useTeacherStudentWorkController'

afterEach(() => vi.unstubAllGlobals())

function work(studentId: string, graded = false) {
  return { assignment: { id: 'assignment-1' }, student: { id: studentId },
    doc: { id: `doc-${studentId}`, student_id: studentId, score_completion: graded ? 8 : null,
      score_thinking: graded ? 7 : null, score_workflow: graded ? 9 : null,
      content: { type: 'doc', content: [] }, teacher_feedback_draft: graded ? 'Completed feedback' : '',
      graded_at: graded ? '2026-09-22T12:00:00Z' : null }, feedback_entries: [] }
}
const queued = { id: 'run-1', status: 'queued', completed_count: 0, failed_count: 0, next_retry_at: null }
const completed = { ...queued, status: 'completed', completed_count: 1 }
const response = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body })
function setup(tick: () => Promise<unknown> = async () => completed, admissionStatus = 202) {
  let graded = false
  const fetcher = vi.fn(async (input: unknown) => {
    const url = String(input)
    if (url.endsWith('/auto-grade')) return response(admissionStatus === 202
      ? { mode: 'background', run: queued } : { error: 'AI grading limit reached' }, admissionStatus)
    if (url.endsWith('/tick')) { const run = await tick(); graded = true; return response({ run }) }
    if (url.includes('/auto-grade-runs/')) return response({ run: queued })
    if (url.includes('/history')) return response({ history: [] })
    return response(work(url.endsWith('student-2') ? 'student-2' : 'student-1', graded))
  })
  vi.stubGlobal('fetch', fetcher)
  const hook = renderHook(({ studentId }) => useTeacherStudentWorkController({
    classroomId: 'classroom-1', assignmentId: 'assignment-1', studentId,
  }), { initialProps: { studentId: 'student-1' } })
  return { ...hook, fetcher }
}

describe('single-student durable grading', () => {
  it('accepts 202, reads and ticks the run, then refreshes student work', async () => {
    const { result, fetcher } = setup()
    await waitFor(() => expect(result.current.data?.doc?.id).toBe('doc-student-1'))
    await act(async () => { await result.current.handleAutoGrade() })
    expect(fetcher).toHaveBeenCalledWith('/api/teacher/assignments/assignment-1/auto-grade-runs/run-1', undefined)
    expect(fetcher).toHaveBeenCalledWith('/api/teacher/assignments/assignment-1/auto-grade-runs/run-1/tick', { method: 'POST' })
    expect(result.current.scoreCompletion).toBe('8')
    expect(result.current.gradeError).toBe('')
    expect(result.current.autoGrading).toBe(false)
  })
  it('keeps the existing generic quota error without polling', async () => {
    const { result, fetcher } = setup(undefined, 429)
    await waitFor(() => expect(result.current.data).not.toBeNull())
    await act(async () => { await result.current.handleAutoGrade() })
    expect(result.current.gradeError).toBe('AI grading limit reached')
    expect(fetcher.mock.calls.some(([url]) => String(url).includes('/auto-grade-runs/'))).toBe(false)
  })
  it('reports a terminal failed run in the existing error location', async () => {
    const { result } = setup(async () => ({ ...queued, status: 'failed', failed_count: 1 }))
    await waitFor(() => expect(result.current.data).not.toBeNull())
    await act(async () => { await result.current.handleAutoGrade() })
    expect(result.current.gradeError).toBe('Auto-grade failed')
    expect(result.current.autoGrading).toBe(false)
  })
  it('ignores a late tick after switching students and clears busy state', async () => {
    let finish!: (value: unknown) => void
    const tick = new Promise((resolve) => { finish = resolve })
    const { result, rerender, fetcher } = setup(() => tick)
    await waitFor(() => expect(result.current.data).not.toBeNull())
    let grading!: Promise<void>
    act(() => { grading = result.current.handleAutoGrade() })
    await waitFor(() => expect(fetcher.mock.calls.some(([url]) => String(url).endsWith('/tick'))).toBe(true))
    expect(result.current.autoGrading).toBe(true)
    rerender({ studentId: 'student-2' })
    await waitFor(() => expect(result.current.data?.doc?.id).toBe('doc-student-2'))
    await act(async () => { finish(completed); await grading })
    expect(result.current.data?.doc?.id).toBe('doc-student-2')
    expect(result.current.scoreCompletion).toBe('')
    expect(result.current.gradeError).toBe('')
    expect(result.current.autoGrading).toBe(false)
  })
})
