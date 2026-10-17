import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { createContextualTestPlan } from '../../e2e/helpers/contextual-test-rehearsal'
import {
  assertVerticalDraftReadback,
  assertVerticalPublishedGraph,
  assertVerticalSubmittedGraph,
  contextualTestVerticalContract,
  contextualTestVerticalStages,
  runContextualTestVerticalWorkflow,
  verticalWorkflowFailureStage,
} from '../../e2e/helpers/contextual-test-vertical-workflow'

const id = (n: number) => `60000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const published = () => ({ test: { id: id(1), classroom_id: id(2), title: 'Vertical Test', status: 'closed', documents: [] },
  questions: [{ id: id(3), question_type: 'multiple_choice' }, { id: id(4), question_type: 'open_response' }] })
const submitted = () => ({ questions: published().questions, students: [{ student_id: id(5), status: 'submitted',
  returned_at: null, answers: { [id(3)]: { response_id: id(6), response_revision: 1, selected_option: 1, response_text: null, is_draft: false },
    [id(4)]: { response_id: id(7), response_revision: 1, selected_option: null, response_text: 'Synthetic reasoning.', is_draft: false } } }] })

describe('narrow contextual Test graph assertions (CPU only)', () => {
  it('reads documents from the Test while accepting the actual draft content shape', () => {
    const detail = published(); detail.test.status = 'draft'
    const draft = { draft: { version: 2, content: { title: 'Vertical Test', questions: detail.questions } } }
    expect(Object.hasOwn(draft.draft.content, 'documents')).toBe(false)
    expect(() => assertVerticalDraftReadback(draft, detail, id(1), id(2), 'Vertical Test')).not.toThrow()
  })
  it.each(['document', 'missing-documents', 'wrong-test', 'wrong-class', 'wrong-title', 'not-draft', 'zero-version', 'missing-question'])('rejects invalid saved readback: %s', defect => {
    const detail = published(); detail.test.status = 'draft'
    const draft = { draft: { version: 2, content: { title: 'Vertical Test', questions: [...detail.questions] } } }
    if (defect === 'document') (detail.test.documents as unknown[]).push({ type: 'link' })
    if (defect === 'missing-documents') delete (detail.test as { documents?: unknown[] }).documents
    if (defect === 'wrong-test') detail.test.id = id(9)
    if (defect === 'wrong-class') detail.test.classroom_id = id(9)
    if (defect === 'wrong-title') draft.draft.content.title = 'Wrong title'
    if (defect === 'not-draft') detail.test.status = 'closed'
    if (defect === 'zero-version') draft.draft.version = 0
    if (defect === 'missing-question') draft.draft.content.questions.pop()
    expect(() => assertVerticalDraftReadback(draft, detail, id(1), id(2), 'Vertical Test')).toThrow('owner-reload-draft-proof')
  })
  it('accepts exactly two distinct, published questions without documents', () => {
    expect(assertVerticalPublishedGraph(published(), id(1), id(2), 'Vertical Test')).toEqual({ mcId: id(3), openId: id(4) })
  })
  it('derives learner IDs from results when detail exposes distinct portable authoring IDs', () => {
    const results = [{ id: id(8), question_type: 'multiple_choice' }, { id: id(9), question_type: 'open_response' }]
    expect(assertVerticalPublishedGraph(published(), id(1), id(2), 'Vertical Test', results)).toEqual({ mcId: id(8), openId: id(9) })
    expect(() => assertVerticalPublishedGraph(published(), id(1), id(2), 'Vertical Test', results.slice(0, 1))).toThrow('published-readback')
  })
  it.each(['wrong-class', 'draft', 'extra-question', 'duplicate-id', 'upload'])('rejects %s before learner work', defect => {
    const graph = published()
    if (defect === 'wrong-class') graph.test.classroom_id = id(9)
    if (defect === 'draft') graph.test.status = 'draft'
    if (defect === 'extra-question') graph.questions.push({ id: id(8), question_type: 'open_response' })
    if (defect === 'duplicate-id') graph.questions[1].id = id(3)
    if (defect === 'upload') (graph.test.documents as unknown[]).push({ source: 'upload' })
    expect(() => assertVerticalPublishedGraph(graph, id(1), id(2), 'Vertical Test')).toThrow('published-readback')
  })
  it('corroborates the submitted member response and both finalized identities', () => {
    expect(() => assertVerticalSubmittedGraph(submitted(), id(5), { mcId: id(3), openId: id(4) }, 'Synthetic reasoning.')).not.toThrow()
  })
  it.each(['draft', 'wrong-member', 'wrong-text', 'wrong-choice', 'missing-response', 'extra-answer', 'duplicate-response'])('rejects %s without accepting UI success alone', defect => {
    const graph = submitted(), row = graph.students[0]
    if (defect === 'draft') row.answers[id(4)].is_draft = true
    if (defect === 'wrong-member') row.student_id = id(8)
    if (defect === 'wrong-text') row.answers[id(4)].response_text = 'Other text'
    if (defect === 'wrong-choice') row.answers[id(3)].selected_option = 0
    if (defect === 'missing-response') row.answers[id(4)].response_id = ''
    if (defect === 'extra-answer') row.answers[id(8)] = row.answers[id(4)]
    if (defect === 'duplicate-response') row.answers[id(4)].response_id = id(6)
    expect(() => assertVerticalSubmittedGraph(graph, id(5), { mcId: id(3), openId: id(4) }, 'Synthetic reasoning.')).toThrow('owner-results-readback')
  })
  it('checks the runtime fence before opening any actor session', async () => {
    const withActor = vi.fn()
    await expect(runContextualTestVerticalWorkflow({ plan: createContextualTestPlan('pika_assignment_list_123456abcdef'),
      check() { throw Error('cutoff') }, withActor } as never)).rejects.toThrow('admission')
    expect(withActor).not.toHaveBeenCalled()
  })
  it.each(['status', 'wrong-class', 'retired-id', 'malformed-id'])('stops at an invalid create acknowledgement: %s', async defect => {
    const plan = createContextualTestPlan('pika_assignment_list_123456abcdef')
    const api = vi.fn(), snapshot = vi.fn(), response = vi.fn(async () => ({ test: {
      id: defect === 'retired-id' ? plan.retiredTestIds[0] : defect === 'malformed-id' ? 'invalid' : id(1),
      classroom_id: defect === 'wrong-class' ? plan.classrooms.classA.id : plan.classrooms.classB.id,
    } }))
    const click = vi.fn(async () => {}), actors: string[] = []
    const page = { waitForResponse: vi.fn(async () => ({ status: () => defect === 'status' ? 500 : 201 })),
      getByRole: vi.fn(() => ({ click })) }
    const runtime = { plan, check() {}, api, response, snapshot, navigate: vi.fn(async () => {}),
      async withActor(actor: string, work: (page: unknown) => Promise<void>) { actors.push(actor); await work(page) } }
    await expect(runContextualTestVerticalWorkflow(runtime as never)).rejects.toThrow('Contextual Test vertical failed: owner-create')
    expect(actors).toEqual(['ownerStudent'])
    expect(click).toHaveBeenCalledTimes(1)
    expect(api).not.toHaveBeenCalled()
    expect(snapshot).not.toHaveBeenCalled()
    if (defect === 'status') expect(response).not.toHaveBeenCalled()
  })
  it('keeps a fixed one-Test, zero-upload, three-shot contract and no hidden execution dependencies', () => {
    expect(contextualTestVerticalContract).toMatchObject({ createdTests: 1, questions: 2, uploadObjects: 0, screenshots: 3, automaticRetries: 0 })
    const source = readFileSync(new URL('../../e2e/helpers/contextual-test-vertical-workflow.ts', import.meta.url), 'utf8')
    expect(source).not.toMatch(/from ['"].*(?:contextual-test-workflow|witness|browser-start|supabase)/)
    expect(source).not.toMatch(/\.evaluate\(|\.goto\(|\.reload\(|setInputFiles|\.request\.|\.route\(/)
    // API is corroboration/denial only. All successful mutations are app UI gestures.
    expect(source.match(/r\.api[^\n]*'POST'/g)).toHaveLength(1)
    expect(source).not.toMatch(/r\.api[^\n]*'(?:PATCH|DELETE|PUT)'/)
  })
  it('extracts only an exact own data message with one finite stage', () => {
    for (const stage of contextualTestVerticalStages) expect(verticalWorkflowFailureStage(new Error(`Contextual Test vertical failed: ${stage}`))).toBe(stage)
    for (const error of [null, 'Contextual Test vertical failed: admission', new Error('Contextual Test vertical failed: admission\nprivate'),
      new Error('Contextual Test vertical failed: unknown'), Object.create({ message: 'Contextual Test vertical failed: admission' })]) {
      expect(verticalWorkflowFailureStage(error)).toBeNull()
    }
  })
  it('does not invoke message getters or proxy traps', () => {
    let accessed = 0
    const accessor = Object.defineProperty({}, 'message', { get() { accessed++; throw Error('private') } })
    const proxy = new Proxy({}, { getOwnPropertyDescriptor() { accessed++; throw Error('private') }, get() { accessed++; throw Error('private') } })
    expect(verticalWorkflowFailureStage(accessor)).toBeNull()
    expect(verticalWorkflowFailureStage(proxy)).toBeNull()
    expect(accessed).toBe(0)
  })
  it('registers every assigned workflow stage without arbitrary text', () => {
    const source = readFileSync(new URL('../../e2e/helpers/contextual-test-vertical-workflow.ts', import.meta.url), 'utf8')
    const assigned = [...source.matchAll(/stage(?:: VerticalStage)? = '([^']+)'/g)].map(match => match[1])
    expect([...new Set(assigned)].sort()).toEqual([...contextualTestVerticalStages].sort())
  })
})
