import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { publishContextualTest } from '@/lib/server/contextual-test-publication'
import { newAssignmentListProofFixture } from '../../scripts/contextual-assignment-list-proof-fixture'
import { newTestOwnerPublicationFixture, TEST_OWNER_PUBLICATION_SNAPSHOT_TABLES } from '../../scripts/contextual-test-publication-proof-fixture'
import { createTestOwnerPublicationProofTransport, testOwnerPublicationRequestManifest } from '../../scripts/contextual-test-publication-proof-transport'

const f = newTestOwnerPublicationFixture(newAssignmentListProofFixture(new Date('2026-10-06T12:00:00Z')))
const project = `pika_assignment_list_${f.tag.slice(-12)}`
const key = `e30.${Buffer.from(JSON.stringify({ iss: 'supabase-demo', role: 'service_role' })).toString('base64url')}.synthetic`
const target = { API_URL: 'http://127.0.0.1:54331', DB_URL: 'postgresql://postgres:synthetic@127.0.0.1:54332/postgres', SERVICE_ROLE_KEY: key }
const snapshotPath = target.API_URL + '/rest/v1/rpc/snapshot_test_draft_for_owner_v1'
const finalPath = target.API_URL + '/rest/v1/rpc/publish_test_from_draft_for_owner_v1'
const sha = 'a'.repeat(64)
const first = f.cases[0]
const headers = () => ({ authorization: `Bearer ${key}`, apikey: key, 'content-type': 'application/json', 'x-client-info': 'supabase-js-node/2.93.3', 'content-profile': 'public' })
function snapshot(label: string = first.label) {
  const c = [...f.cases, ...f.privilegeProbes].find(c => c.label === label)!
  const t = f.tests.find(t => t.id === c.testId)!; const classroom = f.classes.find(r => r.id === t.classroom_id)!
  return { version: 1, actor_id: c.actorId, classroom: { id: classroom.id, teacher_id: classroom.owner, archived_at: classroom.archived ? f.now : null },
    test: { id: t.id, classroom_id: t.classroom_id, title: t.title, show_results: t.show_results, status: t.status, blueprint_archived_at: t.blueprint_archived_at, questions_locked_at: t.questions_locked_at },
    draft: f.drafts.find(d => d.assessment_id === t.id) ?? null, question_count: f.questions.filter(q => q.test_id === t.id).length,
    questions: f.questions.filter(q => q.test_id === t.id).map(q => ({ id: q.id, test_id: q.test_id, artifact_id: q.artifact_id, source_artifact_id: q.source_artifact_id,
      question_type: q.question_type, question_text: q.question_text, options: q.options, correct_option: q.correct_option, answer_key: q.answer_key,
      sample_solution: q.sample_solution, points: q.points, response_max_chars: q.response_max_chars, response_monospace: q.response_monospace, position: q.position })), source_sha256: sha }
}
function witness(label: string = first.label) {
  const s = snapshot(label); const d = s.draft!
  return { version: 1, actor_id: s.actor_id, classroom_id: s.classroom.id, test_id: s.test.id, source_sha256: sha, draft_version: d.version,
    test: { ...f.tests.find(t => t.id === s.test.id)!, status: 'closed', title: d.content.title, show_results: d.content.show_results } }
}
const args = () => ({ p_actor_id: first.actorId, p_test_id: first.testId, p_deadline: new Date(Date.now() + 20000).toISOString() })
type Row = Record<string, unknown>
type Whole = Record<string, Row[]>
function baseline(): Whole {
  const s: Whole = Object.fromEntries(TEST_OWNER_PUBLICATION_SNAPSHOT_TABLES.map(t => [t, []]))
  s['public.users'] = f.actors.map(r => ({ ...r, preserved: true }))
  s['public.classrooms'] = f.classes.map(c => ({ id: c.id, teacher_id: c.owner, title: c.title, class_code: c.code,
    archived_at: c.archived ? f.now : null, blueprint_source_revision: 203, updated_at: f.now, untouched: 'keep' }))
  s['public.classroom_archive_revisions'] = f.classes.map(c => ({ classroom_id: c.id, revision: 411, updated_at: f.now }))
  s['public.gradebook_categories'] = f.classes.flatMap((c, ci) => [0, 1, 2].map(i => ({ id: `99999999-9999-4999-8999-${String(ci * 3 + i).padStart(12, '0')}`,
    classroom_id: c.id, position: i, is_default: i === 0, default_assessment_weight: 10 })))
  s['public.tests'] = f.tests.map(t => ({ ...structuredClone(t), gradebook_category_id: s['public.gradebook_categories'].find(c => c.classroom_id === t.classroom_id)!.id }))
  s['public.test_questions'] = structuredClone(f.questions); s['public.assessment_drafts'] = structuredClone(f.drafts)
  s['public.classroom_enrollments'] = f.enrollments.map(r => ({ ...r, created_at: f.now }))
  s['public.course_blueprints'] = [{ ...f.blueprint, unchanged: true }]; s['public.course_blueprint_versions'] = [structuredClone(f.blueprintVersion)]
  s['public.managed_storage_settings'] = [{ singleton: true, active_version: 0, updated_at: f.now }]
  s.__nontarget_fingerprints = [...TEST_OWNER_PUBLICATION_SNAPSHOT_TABLES, 'storage.objects', 'storage.buckets'].map(table => ({ table, fingerprint: 'unchanged' }))
  return s
}
function postimage(before: Whole, label: string, tx = new Date().toISOString()) {
  const c = [...f.cases, ...f.transitions].find(c => c.label === label)!; const after = structuredClone(before)
  const draft = f.drafts.find(d => d.assessment_id === c.testId)!; const content = draft.content
  const t = after['public.tests'].find(t => t.id === c.testId)!
  Object.assign(t, { title: content.title, show_results: content.show_results, status: 'closed', updated_at: tx })
  const prior = before['public.test_questions'].filter(q => q.test_id === c.testId)
  const questions = content.questions.map((q, position) => {
    const old = prior.find(r => (r.source_artifact_id ?? r.artifact_id) === q.id)
    const { id, ...authored } = q; const fields = { ...authored, position }
    if (old) {
      const changed = Object.entries(fields).some(([k, v]) => JSON.stringify(v) !== JSON.stringify(old[k]))
      return { ...old, ...fields, updated_at: changed ? tx : old.updated_at }
    }
    return { id: '88888888-8888-4888-8888-888888888888', test_id: c.testId, artifact_id: id, source_artifact_id: null,
      source_blueprint_version_id: null, ...fields, created_at: tx, updated_at: tx, ai_reference_cache_key: null,
      ai_reference_cache_answers: null, ai_reference_cache_model: null, ai_reference_cache_generated_at: null }
  })
  after['public.test_questions'] = [...after['public.test_questions'].filter(q => q.test_id !== c.testId), ...questions]
  const classroom = after['public.classrooms'].find(r => r.id === t.classroom_id)!
  const archive = after['public.classroom_archive_revisions'].find(r => r.classroom_id === t.classroom_id)!
  classroom.blueprint_source_revision = Number(classroom.blueprint_source_revision) + c.T + c.Q
  if (c.T + c.Q > 0) classroom.updated_at = tx
  archive.revision = Number(archive.revision) + 2 + c.T + 2 * c.Q; archive.updated_at = tx
  return { after, envelope: { version: 1, actor_id: c.actorId, classroom_id: t.classroom_id, test_id: c.testId,
    source_sha256: sha, draft_version: draft.version, test: { ...t } } }
}
function harness(fetcher = vi.fn<typeof fetch>(async url => new Response(JSON.stringify(String(url) === snapshotPath ? snapshot() : witness())))) {
  const guard = vi.fn(async () => {})
  const transport = createTestOwnerPublicationProofTransport(f, target, project, fetcher, guard)
  const client = createClient<Database>(target.API_URL, key, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: transport.fetch } })
  return { transport, client, fetcher, guard, invoke(label: string = first.label, signal?: AbortSignal) {
    const c = [...f.cases, ...f.privilegeProbes].find(c => c.label === label)!; const start = Date.now(); transport.readContext(label, start)
    return publishContextualTest({ supabase: client, actorId: c.actorId, testId: c.testId, input: c.input, deadline: start + 20000, signal })
  } }
}
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime('2026-10-06T12:10:00Z') })
afterEach(() => vi.useRealTimers())
describe('sealed publication installed SDK transport', () => {
  it('freezes exactly14 contexts/20 planned RPCs and never changes old caps', () => {
    const m = testOwnerPublicationRequestManifest(f)
    expect(m.cases).toHaveLength(10); expect(m.privilegeProbes).toHaveLength(4)
    expect(m.cases.reduce((n, c) => n + c.expectedRPCs, 0)).toBe(13)
    expect(m.privilegeProbes.reduce((n, c) => n + c.expectedRPCs, 0)).toBe(7)
    expect(m.caps).toMatchObject({ networkRequests: 24, rpcRequests: 24, storageRequests: 0, requestBytes: 8388608, totalBytes: 67108864 })
    expect(Object.isFrozen(m.privilegeProbes[0])).toBe(true)
  })
  it('uses actual SDK snapshot→publication and exposes only an issued provisional witness', async () => {
    const h = harness(); expect(await h.invoke()).toEqual({ test: { ...witness().test, assessment_type: 'test' } })
    expect(h.fetcher.mock.calls.map(([url]) => String(url))).toEqual([snapshotPath, finalPath])
    expect(h.guard).toHaveBeenCalledTimes(4); expect(h.transport.counts).toMatchObject({ network: 2, rpc: 2, storage: 0 })
    expect(h.transport.getPendingWitness()?.ledger.at(-1)?.state).toBe('provisional'); expect(h.transport.getPendingWitness()).toBeUndefined()
    expect(h.transport.getVerifiedLedger()).toHaveLength(0); expect(h.transport).not.toHaveProperty('installVerifiedLedger')
    expect(vi.getTimerCount()).toBe(0)
  })
  it.each(['https://example.invalid', target.API_URL + '/rest/v1/tests', target.API_URL + '/storage/v1/object/x', snapshotPath + '?q=1', snapshotPath + '#x'])('rejects unsealed path %s', async url => {
    const h = harness(); h.transport.readContext(first.label)
    await expect(h.transport.fetch(url, { method: 'POST', headers: headers(), body: JSON.stringify(args()) })).rejects.toThrow()
    expect(h.fetcher).not.toHaveBeenCalled()
  })
  it.each(['cookie', 'prefer', 'range', 'x-forwarded-host', 'x-arbitrary'])('rejects extra header %s', async header => {
    const h = harness(); h.transport.readContext(first.label)
    await expect(h.transport.fetch(snapshotPath, { method: 'POST', headers: { ...headers(), [header]: 'synthetic' }, body: JSON.stringify(args()) })).rejects.toThrow()
    expect(h.fetcher).not.toHaveBeenCalled()
  })
  it.each(['authorization', 'apikey', 'x-client-info', 'content-profile', 'content-type'])('requires exact SDK header %s', async header => {
    const h = harness(); h.transport.readContext(first.label); const hs = new Headers(headers()); hs.delete(header)
    await expect(h.transport.fetch(snapshotPath, { method: 'POST', headers: hs, body: JSON.stringify(args()) })).rejects.toThrow(); expect(h.fetcher).not.toHaveBeenCalled()
  })
  it('rejects phase2 before any verified snapshot', async () => {
    const h = harness(); h.transport.readContext(first.label)
    await expect(h.transport.fetch(finalPath, { method: 'POST', headers: headers(), body: JSON.stringify(args()) })).rejects.toThrow(); expect(h.fetcher).not.toHaveBeenCalled()
  })
  it('rejects duplicate escaped request keys before dispatch', async () => {
    const h = harness(); h.transport.readContext(first.label)
    const body = JSON.stringify(args()).replace('{', '{"p_\\u0061ctor_id":"forged",')
    await expect(h.transport.fetch(snapshotPath, { method: 'POST', headers: headers(), body })).rejects.toThrow(); expect(h.fetcher).not.toHaveBeenCalled()
  })
  it('rejects a fake SDK success instead of issuing a witness', async () => {
    const h = harness(vi.fn(async () => new Response(JSON.stringify({ test: witness().test }))))
    await expect(h.invoke()).rejects.toMatchObject({ statusCode: 503 }); expect(h.transport.getPendingWitness()).toBeUndefined()
  })
  it('physically aborts active dispatch when forbidden reentry poisons the sealed run', async () => {
    let signal: AbortSignal | undefined
    const h = harness(vi.fn((_, init) => { signal = init?.signal ?? undefined; return new Promise(() => {}) }))
    const result = expect(h.invoke()).rejects.toMatchObject({ statusCode: 503 })
    await vi.advanceTimersByTimeAsync(1)
    expect(() => h.transport.readContext(f.cases[1].label)).toThrow()
    expect(signal?.aborted).toBe(true)
    await result; expect(h.fetcher).toHaveBeenCalledTimes(1); expect(vi.getTimerCount()).toBe(0)
  })
  it.each(['p_actor_id', 'p_test_id', 'p_classroom_id', 'p_expected_authoring_sha256', 'p_expected_draft_version', 'p_validated_content', 'p_deadline'])('rejects sealed phase2 %s drift before dispatch', async field => {
    const h = harness(); h.transport.readContext(first.label); const initial = args()
    await h.transport.fetch(snapshotPath, { method: 'POST', headers: headers(), body: JSON.stringify(initial) })
    const s = snapshot(); const request = { ...initial, p_classroom_id: s.classroom.id, p_expected_authoring_sha256: sha,
      p_expected_draft_version: first.input.draft_version, p_validated_content: s.draft!.content }
    const bad: Record<string, unknown> = { p_actor_id: f.actors[1].id, p_test_id: f.cases[1].testId, p_classroom_id: f.classes[1].id,
      p_expected_authoring_sha256: 'b'.repeat(64), p_expected_draft_version: 4, p_validated_content: { ...s.draft!.content, title: 'Forged' },
      p_deadline: new Date(Date.now() + 19000).toISOString() }
    await expect(h.transport.fetch(finalPath, { method: 'POST', headers: headers(), body: JSON.stringify({ ...request, [field]: bad[field] }) })).rejects.toThrow()
    expect(h.fetcher).toHaveBeenCalledTimes(1); expect(h.transport.getPendingWitness()).toBeUndefined()
  })
  it('rejects duplicate nested response keys and invalid UTF8', async () => {
    for (const raw of [JSON.stringify(snapshot()).replace('"classroom":{', '"classroom":{"\\u0069d":"forged",'), new Uint8Array([255])]) {
      const h = harness(vi.fn(async () => new Response(raw)))
      await expect(h.invoke()).rejects.toMatchObject({ statusCode: 503 }); expect(h.transport.getPendingWitness()).toBeUndefined()
    }
  })
  it.each(['redirect', 'length', 'oversize', 'depth'])('rejects bounded response %s', async mode => {
    const h = harness(vi.fn(async () => mode === 'redirect' ? new Response('{}', { status: 302, headers: { location: 'https://example.invalid' } })
      : mode === 'length' ? new Response('{}', { headers: { 'content-length': '8388609' } })
      : mode === 'depth' ? new Response('['.repeat(65) + '0' + ']'.repeat(65)) : new Response(' '.repeat(8388609))))
    await expect(h.invoke()).rejects.toMatchObject({ statusCode: 503 }); expect(h.fetcher).toHaveBeenCalledTimes(1); expect(h.transport.getPendingWitness()).toBeUndefined()
  })
  it('requires a complete effects sink and pins continuity before another context', async () => {
    const before = baseline(); const p = postimage(before, first.label)
    const h = harness(vi.fn(async url => new Response(JSON.stringify(String(url) === snapshotPath ? snapshot() : p.envelope))))
    const result = await h.invoke(); h.transport.verifyEffects(before, p.after, result)
    expect(h.transport.getVerifiedLedger()).toHaveLength(1); expect(h.transport.getVerifiedLedger()[0].state).toBe('verified')
    const changed = structuredClone(p.after); changed.__nontarget_fingerprints[0].fingerprint = 'changed'
    h.fetcher.mockImplementation(async () => new Response(JSON.stringify(snapshot(f.cases[7].label))))
    await expect(h.invoke(f.cases[7].label)).rejects.toMatchObject({ statusCode: 404 })
    expect(() => h.transport.verifyEffects(changed, changed)).toThrow(); expect(h.transport.completion().complete).toBe(false)
  })
  it('never recognizes55000 as one of the four raw42501 probes', async () => {
    const c = f.privilegeProbes[2]
    const h = harness(vi.fn(async url => String(url) === snapshotPath ? new Response(JSON.stringify(snapshot(c.label)))
      : new Response(JSON.stringify({ code: '55000', message: 'synthetic wrong error' }), { status: 500 })))
    await expect(h.invoke(c.label)).rejects.toMatchObject({ statusCode: 503 })
    expect(h.transport.evidence.rawPrivilegeFailures).toBe(0); expect(h.transport.evidence.rawPrivilegeContexts).toEqual([])
    expect(() => h.transport.readContext(first.label)).toThrow()
  })
  it('cancels stalled response reading on caller abort without waiting for cancel', async () => {
    const cancel = vi.fn(() => new Promise<void>(() => {}))
    const h = harness(vi.fn(async () => new Response(new ReadableStream({ pull() { return new Promise(() => {}) }, cancel }))))
    const controller = new AbortController(); const result = expect(h.invoke(first.label, controller.signal)).rejects.toMatchObject({ statusCode: 503 })
    await vi.advanceTimersByTimeAsync(1); controller.abort(); await result
    expect(cancel).toHaveBeenCalledTimes(1); expect(h.fetcher).toHaveBeenCalledTimes(1); expect(vi.getTimerCount()).toBe(0)
  })
  it('does not dispatch or renew a never-settling guard', async () => {
    const h = harness(); h.guard.mockImplementation(() => new Promise(() => {}))
    const result = expect(h.invoke()).rejects.toMatchObject({ statusCode: 503 })
    await vi.advanceTimersByTimeAsync(20000); await result
    expect(h.fetcher).not.toHaveBeenCalled(); expect(h.transport.counts.rpc).toBe(0); expect(vi.getTimerCount()).toBe(0)
  })
  it('captures checked primitives across a guard that mutates caller objects', async () => {
    const h = harness(); h.transport.readContext(first.label); const resource = new URL(snapshotPath); const hs = new Headers(headers())
    const body = JSON.stringify(args()); const init: RequestInit = { method: 'POST', headers: hs, body }
    h.guard.mockImplementationOnce(async () => { resource.href = 'https://example.invalid'; init.body = 'forged'; hs.set('cookie', 'forged') })
    await h.transport.fetch(resource, init)
    expect(h.fetcher.mock.calls[0][0]).toBe(snapshotPath); expect(h.fetcher.mock.calls[0][1]?.body).toBe(body)
    expect(new Headers(h.fetcher.mock.calls[0][1]?.headers).has('cookie')).toBe(false)
  })
  it('refuses arbitrary transition labels and all state/ledger setters', () => {
    const h = harness(); const before = baseline()
    expect(() => h.transport.verifyTransitionEffects(before, before, before, 'arbitrary', {})).toThrow()
    expect(h.transport).not.toHaveProperty('installVerifiedLedger'); expect(h.transport).not.toHaveProperty('setState')
    expect(Object.isFrozen(h.transport.counts)).toBe(true)
    expect(h.transport.diagnostic()).not.toContain(first.testId); expect(h.transport.diagnostic()).not.toContain(key)
  })
  it.each([Infinity, NaN, 0, Date.parse('2099-01-01T00:00:00Z')])('rejects invalid rooted context start %s', start => {
    const h = harness(); expect(() => h.transport.readContext(first.label, start)).toThrow(); expect(h.fetcher).not.toHaveBeenCalled()
  })
  it.each(['GET', 'PATCH', 'DELETE'])('rejects method %s', async method => {
    const h = harness(); h.transport.readContext(first.label)
    await expect(h.transport.fetch(snapshotPath, { method, headers: headers(), body: JSON.stringify(args()) })).rejects.toThrow(); expect(h.fetcher).not.toHaveBeenCalled()
  })
  it('rejects request objects, arbitrary contexts and unsafe native targets', async () => {
    const h = harness(); h.transport.readContext(first.label)
    await expect(h.transport.fetch(new Request(snapshotPath, { method: 'POST', headers: headers(), body: JSON.stringify(args()) }))).rejects.toThrow()
    expect(h.fetcher).not.toHaveBeenCalled()
    expect(() => harness().transport.readContext('arbitrary-context')).toThrow()
    for (const t of [{ ...target, API_URL: 'http://127.0.0.1:54321' }, { ...target, DB_URL: 'postgresql://postgres:x@localhost:54332/postgres' }, { ...target, SERVICE_ROLE_KEY: 'invalid' }]) {
      expect(() => createTestOwnerPublicationProofTransport(f, t, project, vi.fn(), async () => {})).toThrow()
    }
    expect(() => createTestOwnerPublicationProofTransport(f, target, 'production', vi.fn(), async () => {})).toThrow()
  })
  describe.sequential('one complete issued chain: probes, transitions and normal SDK matrix', () => {
    let current = baseline(); let label: string = first.label; let next: ReturnType<typeof postimage> | undefined
    const h = harness(vi.fn(async url => {
      const c = [...f.cases, ...f.privilegeProbes].find(c => c.label === label)!
      const probe = f.privilegeProbes.find(c => c.label === label)
      if (String(url) === snapshotPath) {
        if (probe?.expectedRPCs === 1) return new Response(JSON.stringify({ code: '42501', message: 'synthetic probe' }), { status: 403 })
        if (['student-member-denied', 'unrelated-owner-denied', 'archived-class-denied'].includes(label)) return new Response(JSON.stringify({ code: 'PT403', message: 'synthetic denial' }), { status: 403 })
        return new Response(JSON.stringify(snapshot(label)))
      }
      if (probe) return new Response(JSON.stringify({ code: '42501', message: 'synthetic probe' }), { status: 403 })
      next = postimage(current, label); return new Response(JSON.stringify(next.envelope))
    }))
    it.each(f.privilegeProbes.map(c => [c.label, c] as const))('verifies unchanged whole state for %s', async (_, c) => {
      label = c.label; const before = structuredClone(current)
      await expect(h.invoke(label)).rejects.toMatchObject({ statusCode: 503 })
      h.transport.verifyEffects(before, current)
      expect(h.transport.getVerifiedLedger()).toHaveLength(0)
    })
    it.each(f.transitions.map(c => [c.label, c] as const))('retains source-sealed committed transition %s without SDK access', (_, c) => {
      const before = structuredClone(current); const writer = structuredClone(before); const stamp = new Date().toISOString()
      const t = writer['public.tests'].find(t => t.id === c.testId)!; const q = writer['public.test_questions'].find(q => q.id === c.questionId)!
      const classroom = writer['public.classrooms'].find(r => r.id === c.classroomId)!; const archive = writer['public.classroom_archive_revisions'].find(r => r.classroom_id === c.classroomId)!
      let b = 0; let a = 0
      if (c.label === 'stale-draft') {
        const d = writer['public.assessment_drafts'].find(d => d.assessment_id === c.testId)!
        d.content = { ...f.drafts.find(d => d.assessment_id === c.testId)!.content, title: c.authoredTitle }; d.version = Number(d.version) + 1; d.updated_at = stamp; b = 1; a = 2
      } else if (c.label === 'stale-authoring') { q.question_text = c.authoredText; q.updated_at = stamp; b = 1; a = 2 }
      else if (c.label === 'metadata-preserved') {
        t.documents = structuredClone(c.documents); t.updated_at = stamp
        Object.assign(q, { ai_reference_cache_key: c.cacheKey, ai_reference_cache_answers: [...c.cacheAnswers], ai_reference_cache_model: c.cacheModel,
          ai_reference_cache_generated_at: stamp, updated_at: stamp }); b = 1; a = 3
      } else if (c.label === 'owner-transfer') { classroom.teacher_id = c.nextOwnerId; a = 1 }
      if (c.label !== 'publication-start') {
        if (b || c.label === 'owner-transfer') classroom.updated_at = stamp
        classroom.blueprint_source_revision = Number(classroom.blueprint_source_revision) + b; archive.revision = Number(archive.revision) + a; archive.updated_at = stamp
      }
      if (c.expectedHTTP === 200) {
        const p = postimage(writer, c.label)
        h.transport.verifyTransitionEffects(before, writer, p.after, c.label, { ...(c.label === 'publication-start' ? {} : { writerTimestamp: stamp }),
          publicationTimestamp: stamp, sourceSha256: sha, envelope: p.envelope }); current = p.after
      } else {
        h.transport.verifyTransitionEffects(before, writer, writer, c.label, { writerTimestamp: stamp, code: c.expectedHTTP === 403 ? 'PT403' : 'PT409' }); current = writer
      }
      expect(h.transport.counts.rpc).toBe(7)
    })
    it.each(f.cases.map(c => [c.label, c] as const))('verifies full normal graph %s', async (_, c) => {
      label = c.label; next = undefined; const before = structuredClone(current); let publicResult: unknown
      if (c.expectedHTTP === 200) { publicResult = await h.invoke(label); current = next!.after }
      else await expect(h.invoke(label)).rejects.toMatchObject({ statusCode: c.expectedHTTP })
      h.transport.verifyEffects(before, current, publicResult)
    })
    it('completes only14 verified contexts +5 transitions +8 issued entries and20 actual RPCs', () => {
      expect(h.transport.counts).toMatchObject({ network: 20, rpc: 20, storage: 0 })
      expect(h.guard).toHaveBeenCalledTimes(40)
      expect(h.transport.counts.totalBytes).toBeLessThanOrEqual(67108864)
      expect(h.transport.evidence.rawPrivilegeFailures).toBe(4)
      expect(h.transport.evidence.rawPrivilegeContexts).toEqual(['activation134', 'legacy139', 'publication252', 'snapshot247'])
      expect(h.transport.getVerifiedLedger()).toHaveLength(8)
      expect(h.transport.getVerifiedLedger().filter(w => w.kind === 'publication')).toHaveLength(3)
      expect(h.transport.getVerifiedLedger().filter(w => w.kind === 'transition')).toHaveLength(5)
      expect(h.transport.getVerifiedLedger().every(w => w.state === 'verified')).toBe(true)
      expect(h.transport.completion()).toEqual({ complete: true, verifiedContextLabels: [...f.privilegeProbes, ...f.cases].map(c => c.label),
        verifiedTransitionLabels: f.transitions.map(t => t.label) })
      expect(Object.isFrozen(h.transport.completion().verifiedContextLabels)).toBe(true)
    })
  })
})
