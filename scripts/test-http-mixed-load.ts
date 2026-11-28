/** Workload for an owned, disposable HTTP rehearsal. This module does not provision
 * or select targets; its caller must validate ownership and drain requests before
 * tearing down the app and database. See test-http-mixed-load.md. */
import assert from 'node:assert/strict'

export type MixedActor = { cookie: string; studentId: string }
export type MixedFixture = {
  learners: MixedActor[]
  teacherCookie: string
  testId: string
  questionId: string
  /** Optional second Test in the same Classroom and Test in a separate Classroom. */
  sameClassTestId?: string
  otherClassTestId?: string
}
export type MixedDispatch = (request: { method: 'GET' | 'POST' | 'PATCH'; path: string; cookie: string; body?: unknown }) => Promise<{ status: number; body: unknown }>
type Sample = { operation: string; status: number; ms: number; conflict?: 'busy' | 'revision' | 'other' }

export function summarizeMixedSamples(samples: Sample[]) {
  const groups = new Map<string, Sample[]>()
  for (const s of samples) groups.set(s.operation, [...(groups.get(s.operation) ?? []), s])
  return [...groups].map(([operation, rows]) => {
    const times = rows.map(r => r.ms).sort((a, b) => a - b)
    const statuses: Record<string, number> = {}
    const conflicts: Record<string, number> = {}
    for (const row of rows) {
      statuses[String(row.status)] = (statuses[String(row.status)] ?? 0) + 1
      if (row.conflict) conflicts[row.conflict] = (conflicts[row.conflict] ?? 0) + 1
    }
    const percentile = (p: number) => Math.round(times[Math.ceil(times.length * p) - 1])
    return { operation, count: rows.length, statuses, ...(Object.keys(conflicts).length ? { conflicts } : {}),
      p50Ms: percentile(.5), p95Ms: percentile(.95), maxMs: Math.round(times[times.length - 1]) }
  })
}

/** Exercises independent student sequences concurrently, waits for all saves,
 * then releases a synchronized submission wave. No retries hide contention. */
export async function runMixedHttpLoad(fixture: MixedFixture, dispatch: MixedDispatch) {
  assert(fixture.learners.length >= 2 && fixture.learners.length <= 40)
  assert.equal(new Set(fixture.learners.map(l => l.studentId)).size, fixture.learners.length)
  const samples: Sample[] = []
  const request = async (operation: string, cookie: string, method: 'GET' | 'POST' | 'PATCH', path: string, body?: unknown, expected = 200) => {
    const started = performance.now()
    let result: { status: number; body: unknown }
    try { result = await dispatch({ method, path, cookie, body }) }
    catch { samples.push({ operation, status: 0, ms: performance.now() - started }); throw new Error(`${operation}: transport failure`) }
    const sample: Sample = { operation, status: result.status, ms: performance.now() - started }
    if (result.status === 409) {
      const reply = isRecord(result.body) ? result.body : {}
      sample.conflict = reply.error === 'Test is busy. Try again.' ? 'busy'
        : reply.error_code === 'test_attempt_revision_conflict' ? 'revision' : 'other'
    }
    samples.push(sample)
    if (result.status !== expected) throw new Error(`${operation}: HTTP ${result.status}`)
    assert(isRecord(result.body), `${operation}: expected a JSON object`)
    return result.body
  }
  const path = (id: string, suffix: string) => `/api/student/tests/${id}${suffix}`
  const responses = (index: number, revision: number) => ({
    [fixture.questionId]: {
      question_type: 'open_response',
      response_text: `synthetic-${index}-${revision}\n` + 'I check the computed result against the expected boundary case. '.repeat(16),
    },
  })
  const teacherRead = async (testId: string, op: string) => {
    const result = await request(op, fixture.teacherCookie, 'GET', `/api/teacher/tests/${testId}/results`)
    assert(isRecord(result.test) && result.test.id === testId && Array.isArray(result.students) &&
      Array.isArray(result.questions) && isRecord(result.stats) && typeof result.stats.responded === 'number',
    `${op}: missing results for requested test`)
  }
  const student = async (actor: MixedActor, i: number) => {
    const started = await request('start', actor.cookie, 'POST', path(fixture.testId, '/start'))
    let revision = draftRevision(started)
    assert(revision >= 1, 'start response missing revision')
    const status = await request('status', actor.cookie, 'GET', path(fixture.testId, '/session-status'))
    assert(isRecord(status.test) && status.test.id === fixture.testId && typeof status.student_status === 'string' &&
      status.can_continue === true, 'session status missing expected active attempt')
    await request('focus', actor.cookie, 'POST', path(fixture.testId, '/focus-events'), { session_id: `synthetic-${i}`, event_type: 'away_start' })
    for (let n = 1; n <= 2; n++) {
      const saved = await request('autosave', actor.cookie, 'PATCH', path(fixture.testId, '/attempt'), { responses: responses(i, n), expected_revision: revision, trigger: 'autosave', paste_word_count: 0, keystroke_count: 1 })
      const nextRevision = draftRevision(saved)
      assert(nextRevision > revision, 'save response missing new revision')
      revision = nextRevision
    }
    return revision
  }
  // Await every in-flight request even on failure; cleanup must never race them.
  const settle = async <T>(work: Promise<T>[]) => {
    const results = await Promise.allSettled(work)
    if (results.some(r => r.status === 'rejected')) throw new Error('Mixed HTTP workload failed; inspect aggregate statuses')
    return results.map(r => (r as PromiseFulfilledResult<T>).value)
  }
  try {
    const reads = [teacherRead(fixture.testId, 'teacher-results')]
    if (fixture.sameClassTestId) reads.push(teacherRead(fixture.sameClassTestId, 'same-class-results'))
    if (fixture.otherClassTestId) reads.push(teacherRead(fixture.otherClassTestId, 'other-class-results'))
    const concurrent = await Promise.allSettled([settle(fixture.learners.map(student)), settle(reads)] as const)
    if (concurrent[0].status === 'rejected' || concurrent[1].status === 'rejected') throw new Error('Mixed HTTP workload failed')
    const revisions = concurrent[0].value
    await settle([
      ...fixture.learners.map((actor, i) => request('submit', actor.cookie, 'POST', path(fixture.testId, '/respond'), { responses: responses(i, 2), expected_revision: revisions[i] }, 201)),
      teacherRead(fixture.testId, 'teacher-results-during-submit'),
    ])
    await teacherRead(fixture.testId, 'teacher-results-final')
    return { summaries: summarizeMixedSamples(samples), expected: fixture.learners.map((actor, i) => ({ studentId: actor.studentId, responses: responses(i, 2) })) }
  } catch (error) {
    // Only operation/status/timing aggregates leave this module; never log response bodies or identities.
    return { summaries: summarizeMixedSamples(samples), expected: null, failed: true as const }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function draftRevision(response: Record<string, unknown>): number {
  assert(isRecord(response.attempt), 'missing attempt')
  const revision = response.attempt.draft_revision
  assert(typeof revision === 'number' && Number.isSafeInteger(revision), 'missing attempt revision')
  return revision
}
