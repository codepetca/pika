import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import {
  assertForbiddenGraphUnchanged, assertNondisclosure, assertRestoredMembership,
  assertWorkflowBaseline, contextualTestWorkflowContract,
  runContextualTestWorkflow,
  assertRestoredClass,
  consumeCreatedTestAcknowledgement,
} from '../../e2e/helpers/contextual-test-workflow'

const witness = () => ({ version: 1, work_graph_sha256: 'a'.repeat(64), tests: [
  { id: 'retired-a', classroom_id: 'a', status: 'draft', position: 0, retired: true },
  { id: 'retired-b', classroom_id: 'b', status: 'draft', position: 0, retired: true },
], attempts: [], memberships: [{ classroom_id: 'a', student_id: 'member', generation_id: 'old', ledger_state: 'active' }],
generations: [{ generation_id: 'old', state: 'active' }], question_counts: [], classes: [], response_count: 0, history_count: 0, objects: [] })

describe('contextual Tests workflow CPU contract (not browser evidence)', () => {
  it('is import-safe and declares the complete finite acceptance slices', () => {
    expect(contextualTestWorkflowContract).toMatchObject({ createdTests: 6, retiredTests: 2, uploadObjects: 2, screenshots: 16, automaticRetries: 0 })
    expect(contextualTestWorkflowContract.stages).toEqual(['baseline', 'owner-authoring', 'member-participation', 'grading-return', 'scratch-recovery', 'foreign-denials', 'revoke-restore', 'archive-restore', 'visual-matrix', 'final'])
    expect(Object.isFrozen(contextualTestWorkflowContract)).toBe(true)
  })
  it('rejects nonempty/changed baseline rather than silently adopting old work', () => {
    expect(() => assertWorkflowBaseline(witness(), ['retired-a', 'retired-b'])).not.toThrow()
    const bad = witness(); bad.attempts.push({} as never)
    expect(() => assertWorkflowBaseline(bad, ['retired-a', 'retired-b'])).toThrow('Contextual Tests workflow assertion failed')
    expect(() => assertWorkflowBaseline(witness(), ['other', 'retired-b'])).toThrow()
  })
  it('requires exact forbidden-work graph equality and well-formed digest', () => {
    expect(() => assertForbiddenGraphUnchanged(witness(), witness())).not.toThrow()
    expect(() => assertForbiddenGraphUnchanged(witness(), { ...witness(), work_graph_sha256: 'b'.repeat(64) })).toThrow()
    expect(() => assertForbiddenGraphUnchanged({ ...witness(), work_graph_sha256: '' }, witness())).toThrow()
  })
  it('rejects nested pre-return keys, feedback and grades, including null fields', () => {
    expect(() => assertNondisclosure({ questions: [{ id: 'q', question_text: 'Prompt' }], attempt: { responses: {} } })).not.toThrow()
    for (const key of ['answer_key', 'correct_option', 'sample_solution', 'feedback', 'score', 'draft_grade', 'question_results']) {
      expect(() => assertNondisclosure({ nested: [{ [key]: null }] })).toThrow()
    }
  })
  it('bounds nondisclosure traversal and rejects getters without invoking them', () => {
    let reads = 0
    const value = Object.defineProperty({}, 'answer_key', { enumerable: true, get() { reads++; return 'secret' } })
    expect(() => assertNondisclosure(value)).toThrow(); expect(reads).toBe(0)
    const cyclic: Record<string, unknown> = {}; cyclic.self = cyclic
    expect(() => assertNondisclosure(cyclic)).toThrow()
  })
  it('requires fresh active membership and retained removed old generation', () => {
    const before = witness(), after = witness()
    after.memberships[0].generation_id = 'fresh'
    after.generations = [{ generation_id: 'old', state: 'removed' }, { generation_id: 'fresh', state: 'active' }]
    expect(() => assertRestoredMembership(before, after, 'a', 'member')).not.toThrow()
    expect(() => assertRestoredMembership(before, before, 'a', 'member')).toThrow()
    after.generations[0].state = 'active'
    expect(() => assertRestoredMembership(before, after, 'a', 'member')).toThrow()
  })
  it('enumerates class restoration without requiring fictional whole-fixture equality', () => {
    const before = { classes: [{ id: 'a', archived_at: null, updated_at: '2026-10-14T00:00:00Z' }, { id: 'b', archived_at: null, updated_at: '2026-10-14T00:00:00Z' }] }
    const after = { classes: [{ ...before.classes[0], updated_at: '2026-10-14T00:01:00Z' }, before.classes[1]] }
    expect(() => assertRestoredClass(before, after, 'a')).not.toThrow()
    expect(() => assertRestoredClass(before, { classes: [{ ...after.classes[0], archived_at: '2026-10-14T00:00:30Z' }, after.classes[1]] }, 'a')).toThrow()
    expect(() => assertRestoredClass(before, { classes: [after.classes[0], { ...after.classes[1], updated_at: '2026-10-14T00:02:00Z' }] }, 'a')).toThrow()
  })
  it('executes the actual workflow baseline before any actor/UI dispatch', async () => {
    let actors = 0, witnesses = 0
    const bad = witness(); bad.attempts.push({} as never)
    const runtime = { check() {}, plan: { retiredTestIds: ['retired-a', 'retired-b'] }, async witness() { witnesses++; return bad }, async withActor() { actors++ } }
    await expect(runContextualTestWorkflow(runtime as never)).rejects.toThrow('Contextual Tests workflow assertion failed')
    expect(witnesses).toBe(1); expect(actors).toBe(0)
  })
  it('executes the original runtime cutoff before any witness or actor dispatch', async () => {
    let calls = 0
    const runtime = { check() { throw new Error('cutoff') }, async witness() { calls++ }, async withActor() { calls++ } }
    await expect(runContextualTestWorkflow(runtime as never)).rejects.toThrow('cutoff')
    expect(calls).toBe(0)
  })
  it('consumes only the runtime-cached original create acknowledgement', async () => {
    const page = {}, response = { status: () => 201, json() { throw Error('second reader') }, body() { throw Error('second reader') } }
    let calls = 0
    const row = { id: '50000000-0000-4000-8000-000000000099', classroom_id: 'class', title: 'Test', status: 'draft' }
    const runtime = { async response(actualPage: unknown, actualResponse: unknown) { calls++; expect(actualPage).toBe(page); expect(actualResponse).toBe(response); return { test: row } } }
    expect(await consumeCreatedTestAcknowledgement(runtime as never, page as never, response as never, 'class')).toBe(row)
    expect(calls).toBe(1)
    await expect(consumeCreatedTestAcknowledgement(runtime as never, page as never, response as never, 'foreign')).rejects.toThrow()
    await expect(consumeCreatedTestAcknowledgement({ response: async () => { throw Error('original task failed') } } as never, page as never, response as never, 'class')).rejects.toThrow('original task failed')
  })
  for (const mode of ['passed', 'flow-failed', 'close-failed', 'disabled'] as const) it(`executes actual compiled spec safe-close path: ${mode}`, async () => {
    const source = readFileSync(new URL('../../e2e/contextual-test-lifecycle.spec.ts', import.meta.url), 'utf8')
    const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
    let body: ((browser: unknown, info: unknown) => Promise<void>) | undefined, factory = 0, flows = 0, bindingReads = 0, skipped = false
    const closed: string[] = []
    const test = Object.assign((_name: string, fn: typeof body) => { body = fn }, { skip(condition: boolean) { skipped = condition }, setTimeout() {} })
    const require = (id: string) => {
      if (id === '@playwright/test') return { test }
      if (id === './helpers/contextual-test-workflow') return { async runContextualTestWorkflow() { flows++; if (mode === 'flow-failed') throw Error('private raw value') } }
      if (id === './helpers/contextual-test-runtime') return { async createContextualTestRuntime() { factory++; return { runtime: {}, async close(outcome: string) { closed.push(outcome); if (mode === 'close-failed') throw Error('private raw value') } } } }
      if (id === './helpers/contextual-test-startup') return {
        contextualTestStartupBinding() { bindingReads++; return {} },
        createContextualTestStartup() { return { stage() {}, failure() {} } },
      }
      throw Error('CPU fixture rejected unexpected import')
    }
    runInNewContext(compiled, { exports: {}, require, process: { env: { PIKA_CONTEXTUAL_TEST_REHEARSAL: mode === 'disabled' ? 'false' : 'true' } } })
    expect(factory).toBe(0); expect(flows).toBe(0); expect(body).toBeTypeOf('function')
    expect(skipped).toBe(mode === 'disabled')
    expect(bindingReads).toBe(mode === 'disabled' ? 0 : 1)
    // Playwright returns before resolving fixtures for this collection-time skip.
    // Do not invoke the skipped body as though the old in-body guard still ran.
    if (mode === 'disabled') { expect(closed).toEqual([]); return }
    const execute = body!({ browser: {} }, {})
    if (mode === 'passed') await expect(execute).resolves.toBeUndefined()
    else await expect(execute).rejects.toThrow('Isolated contextual Tests rehearsal failed; consult sanitized owned receipt')
    expect(closed).toEqual([mode === 'flow-failed' ? 'failed' : 'passed'])
    expect(factory).toBe(1)
  })
  it('keeps new carrier collection inert and has no legacy publication or persistence mocks', () => {
    const flow = readFileSync(new URL('../../e2e/helpers/contextual-test-workflow.ts', import.meta.url), 'utf8')
    const spec = readFileSync(new URL('../../e2e/contextual-test-lifecycle.spec.ts', import.meta.url), 'utf8')
    expect(flow).not.toMatch(/page\.route\(|route\.fulfill|requestFullscreen\s*=|Object\.defineProperty|createClient\(|child_process/)
    expect(flow).toContain('/publish')
    expect(flow).not.toContain("{ status: 'closed', draft_version:")
    expect(spec).toContain("PIKA_CONTEXTUAL_TEST_REHEARSAL === 'true'")
    expect(spec.indexOf('test.skip(!optedIn')).toBeLessThan(spec.indexOf("test('isolated contextual Tests:"))
    expect(spec).toContain('finally')
    expect(spec).not.toContain('createIsolatedLifecycleFixture')
  })
  it('uses actual owner grading controls for the first grade before peer conflict', () => {
    const flow = readFileSync(new URL('../../e2e/helpers/contextual-test-workflow.ts', import.meta.url), 'utf8')
    expect(flow.includes('test-grading-student-row-${student}')).toBe(true)
    expect(flow.includes("getByRole('spinbutton', { name: 'Q2 score', exact: true })")).toBe(true)
    expect(flow.includes("getByPlaceholder('Leave a comment...', { exact: true })")).toBe(true)
    expect(flow.includes('await initialGradeThroughUi(r, ownerPage, exam, student, original)')).toBe(true)
    expect(flow).not.toContain("r.api(ownerPage, 'PATCH', `/api/teacher/tests/${exam.id}/students/${student}/grades`, grade(original, 4))")
  })
})
