import { describe, expect, it } from 'vitest'
import { runMixedHttpLoad, summarizeMixedSamples, type MixedDispatch } from '../../scripts/test-http-mixed-load'

const fixture = { learners: [{ studentId: 'a', cookie: 'one' }, { studentId: 'b', cookie: 'two' }], teacherCookie: 'teacher', testId: 'test', questionId: 'question', sameClassTestId: 'same', otherClassTestId: 'other' }

describe('mixed HTTP rehearsal', () => {
  it('waits for both learners to finish saving before submitting and reports aggregated requests', async () => {
    const saves: Record<string, number> = {}, operations: string[] = []
    const dispatch: MixedDispatch = async r => {
      operations.push(`${r.method} ${r.path}`)
      if (r.path.endsWith('/start')) return { status: 200, body: { attempt: { draft_revision: 1 } } }
      if (r.path.endsWith('/session-status')) return { status: 200, body: { test: { id: fixture.testId }, student_status: 'can_respond', can_continue: true } }
      if (r.path.endsWith('/results')) return { status: 200, body: { test: { id: r.path.split('/')[4] }, students: [], questions: [], stats: { responded: 0 } } }
      if (r.method === 'PATCH') {
        saves[r.cookie] = (saves[r.cookie] ?? 0) + 1
        return { status: 200, body: { attempt: { draft_revision: saves[r.cookie] + 1 } } }
      }
      if (r.path.endsWith('/respond')) {
        expect(saves).toEqual({ one: 2, two: 2 })
        return { status: 201, body: {} }
      }
      return { status: 200, body: {} }
    }
    const result = await runMixedHttpLoad(fixture, dispatch)
    expect(result.expected).toHaveLength(2)
    expect(result.summaries.find(s => s.operation === 'autosave')?.count).toBe(4)
    expect(result.summaries.find(s => s.operation === 'teacher-results-during-submit')?.count).toBe(1)
    expect(operations).toContain('GET /api/teacher/tests/same/results')
    expect(operations).toContain('GET /api/teacher/tests/other/results')
    expect(JSON.stringify(result.summaries)).not.toContain('synthetic-')
  })
  it('rejects a successful HTTP status with an invalid teacher results response', async () => {
    const result = await runMixedHttpLoad(fixture, async r => {
      if (r.path.endsWith('/results')) return { status: 200, body: null }
      if (r.path.endsWith('/start') || r.method === 'PATCH') {
        return { status: 200, body: { attempt: { draft_revision: r.method === 'PATCH' ? 1 + (r.body as { expected_revision: number }).expected_revision : 1 } } }
      }
      if (r.path.endsWith('/session-status')) return { status: 200, body: { test: { id: fixture.testId }, student_status: 'can_respond', can_continue: true } }
      return { status: 200, body: {} }
    })
    expect(result.failed).toBe(true)
    expect(result.summaries.find(s => s.operation === 'autosave')?.count).toBe(4)
    expect(result.summaries.some(s => s.operation === 'submit')).toBe(false)
  })
  it('drains concurrent work and reports sanitized failure without submitting', async () => {
    const operations: string[] = []
    const result = await runMixedHttpLoad(fixture, async r => {
      operations.push(r.path)
      if (r.path.endsWith('/start')) return { status: 503, body: { secret: 'never-log' } }
      return { status: 200, body: {} }
    })
    expect(result.failed).toBe(true)
    expect(result.expected).toBeNull()
    expect(operations.some(path => path.endsWith('/respond'))).toBe(false)
    expect(JSON.stringify(result)).not.toContain('never-log')
  })
  it('uses nearest-rank percentiles and status counts', () => {
    expect(summarizeMixedSamples([{ operation: 'x', status: 200, ms: 1 }, { operation: 'x', status: 503, ms: 10 }])).toEqual([{ operation: 'x', count: 2, statuses: { 200: 1, 503: 1 }, p50Ms: 1, p95Ms: 10, maxMs: 10 }])
  })
  it('reports recognized busy responses without distributing error bodies', async () => {
    const result = await runMixedHttpLoad(fixture, async () => ({ status: 409, body: { error: 'Test is busy. Try again.', secret: 'never-log' } }))
    expect(result.summaries.find(s => s.operation === 'start')).toMatchObject({ statuses: { 409: 2 }, conflicts: { busy: 2 } })
    expect(JSON.stringify(result)).not.toContain('never-log')
  })
})
