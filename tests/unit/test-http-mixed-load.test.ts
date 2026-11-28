import { describe, expect, it } from 'vitest'
import { runMixedHttpLoad, summarizeMixedSamples, type MixedDispatch } from '../../scripts/test-http-mixed-load'

const fixture = { learners: [{ studentId: 'a', cookie: 'one' }, { studentId: 'b', cookie: 'two' }], teacherCookie: 'teacher', testId: 'test', questionId: 'question', sameClassTestId: 'same', otherClassTestId: 'other' }

describe('mixed HTTP rehearsal', () => {
  it('waits for both learners to finish saving before submitting and reports aggregated requests', async () => {
    const saves: Record<string, number> = {}, operations: string[] = []
    const dispatch: MixedDispatch = async r => {
      operations.push(`${r.method} ${r.path}`)
      if (r.path.endsWith('/start')) return { status: 200, body: { attempt: { draft_revision: 1 } } }
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
    expect(operations).toContain('GET /api/teacher/tests/same/results')
    expect(operations).toContain('GET /api/teacher/tests/other/results')
    expect(JSON.stringify(result.summaries)).not.toContain('synthetic-')
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
})
