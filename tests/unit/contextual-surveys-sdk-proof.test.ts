import { describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { newAssignmentListProofFixture } from '../../scripts/contextual-assignment-list-proof-fixture'
import { newSurveyNativeFixture } from '../../scripts/contextual-surveys-native-contracts'
import { createSurveySdkProofTransport, SURVEY_SDK_PROOF_CAPS, verifySurveySdkTerminalEffects,
  verifySurveyMembershipRestoration, surveyMembershipRestoreSql } from '../../scripts/contextual-surveys-sdk-proof'
import { runContextualSurveysSdkContracts } from '../../scripts/contextual-surveys-sdk-contracts'
import { Survey263UnjoinedChildError } from '../../scripts/contextual-assignment-list-proof-platform'

const f = newSurveyNativeFixture(newAssignmentListProofFixture(new Date('2026-10-12T12:00:00Z')))
const owner = f.actors[0].id, member = f.actors[1].id, sid = f.surveys[0].id, cid = f.classes[0].id
const id = (suffix: string) => `00000000-0000-4000-8000-${suffix.padStart(12, '0')}`
const at = '2026-10-12T21:00:01Z', earlier = '2026-10-12T21:00:00Z', later = '2026-10-12T21:00:02Z'
const window = { startedAt: earlier, endedAt: later }
const target = { API_URL: 'http://127.0.0.1:54331', DB_URL: 'postgresql://postgres:offline@127.0.0.1:54332/postgres',
  SERVICE_ROLE_KEY: `header.${Buffer.from(JSON.stringify({ iss: 'supabase-demo', role: 'service_role' })).toString('base64url')}.signature` }
const headers = { authorization: `Bearer ${target.SERVICE_ROLE_KEY}`, apikey: target.SERVICE_ROLE_KEY,
  'x-client-info': 'supabase-js-node/2.93.3', 'content-type': 'application/json' }
const survey = () => ({ id: sid, classroom_id: cid, title: f.tag, status: 'active', show_results: true, dynamic_responses: false,
  opens_at: '2026-10-12T00:00:00+00:00', created_by: owner, created_at: earlier, updated_at: earlier, position: 0,
  artifact_id: id('88'), source_artifact_id: null, source_blueprint_version_id: null, blueprint_archived_at: null })
const classroom = { id: cid, teacher_id: owner, archived_at: null }
const reply = (value: unknown, status = 200, extra: Record<string, string> = {}) => new Response(JSON.stringify(value), {
  status, headers: { 'content-type': 'application/json', ...extra },
})
function server() {
  let calls = 0
  const created = { ...f.question, id: id('91'), artifact_id: id('92'), question_text: 'Added?', position: 1,
    created_at: at, updated_at: at }
  const summary = { id: sid, title: f.tag, status: 'active', show_results: true, dynamic_responses: false }
  const response = { response_id: id('93'), response_text: 'SDK response', submitted_at: at, updated_at: at }
  const result = { question_id: f.question.id, question_type: 'short_text', question_text: f.question.question_text,
    options: [], counts: [], total_responses: 1, responses: [response] }
  return vi.fn<typeof fetch>(async (_resource, init) => {
    expect(init?.redirect).toBe('error'); expect(init?.signal).toBeInstanceOf(AbortSignal)
    const index = calls++
    if (index === 0 || index === 4) return reply({ classroom, survey: survey(), questions: [f.question], responses: [] })
    if (index === 1 || index === 5) return reply({ classroom, surveys: [survey(), { ...survey(), id: f.surveys[2].id }] })
    if (index === 2 || index === 3) return reply({ code: 'PT403', details: null, hint: null, message: 'Synthetic denial' }, 403)
    if (index === 6) return reply({ success: true, updated: false })
    if (index === 7) return reply({ classroom, survey: summary, results: [result] })
    if (index === 8) return reply({ classroom, survey: summary, questions: [{ id: f.question.id, question_type: 'short_text',
      question_text: f.question.question_text, options: [], response_max_chars: 500, position: 0 }],
    results: [{ ...result, responses: [{ ...response, student_id: member, name: null, email: f.actors[1].email }] }],
    responders: [{ student_id: member, name: null, email: f.actors[1].email }], stats: { total_students: 2, responded: 1 } })
    if (index === 9) return reply({ survey: { ...survey(), title: 'SDK renamed', updated_at: at } })
    if (index === 10) return reply({ question: created })
    if (index === 11) return reply({ question: { ...created, question_type: 'link', question_text: 'URL?', response_max_chars: 2048 } })
    return reply({ success: true })
  })
}
const firstRequest = () => ({ method: 'POST', headers, body: JSON.stringify({ p_actor_id: owner, p_survey_id: sid }) })
const firstUrl = 'http://127.0.0.1:54331/rest/v1/rpc/get_survey_for_owner_v1'

describe('finite installed-SDK Survey transport (offline only)', () => {
  it.each(['late-response','body','never-response','never-cancel'] as const)('joins actual %s cancellation by the original cleanup cutoff',async mode=>{
    vi.useFakeTimers()
    try{
      let replyLate:((response:Response)=>void)|undefined,closeCancel:(()=>void)|undefined,cancelled=false
      const response=()=>new Response(new ReadableStream({cancel(){cancelled=true;return new Promise<void>(resolve=>{closeCancel=resolve})}}),{headers:{'content-type':'application/json'}})
      const wire=vi.fn<typeof fetch>(()=>mode==='body'||mode==='never-cancel' ? Promise.resolve(response()) : new Promise<Response>(resolve=>{replyLate=resolve}))
      const transport=createSurveySdkProofTransport(f,target,wire,async()=>{},()=>{},{cleanupDeadline:Date.now()+300})
      transport.start(Date.now()+100)
      const request=transport.fetch(firstUrl,firstRequest()).catch(error=>error)
      await vi.advanceTimersByTimeAsync(101)
      expect(await request).toBeInstanceOf(Error)
      let settled=false
      const settlement=transport.settle().then(()=>undefined,error=>error).finally(()=>{settled=true})
      await Promise.resolve();expect(settled).toBe(false)
      if(mode==='late-response'){
        replyLate!(response());for(let n=0;n<10;n++)await Promise.resolve()
        expect(cancelled).toBe(true);expect(settled).toBe(false);closeCancel!()
        expect(await settlement).toBeUndefined()
      }else if(mode==='body'){
        expect(cancelled).toBe(true);closeCancel!();expect(await settlement).toBeUndefined()
      }else{
        await vi.advanceTimersByTimeAsync(200)
        expect(await settlement).toBeInstanceOf(Survey263UnjoinedChildError)
        expect(transport.diagnostic()).toContain(`settlement=${mode==='never-response'?'http':'cancel'}`)
        await expect(transport.settle()).rejects.toBeInstanceOf(Survey263UnjoinedChildError)
      }
      expect(wire).toHaveBeenCalledOnce();expect(()=>transport.complete()).toThrow()
    }finally{vi.useRealTimers()}
  })
  it('charges every actual request and response byte into the component ledger and fails closed on overflow', async () => {
    let charged = 0
    const wire = server(), transport = createSurveySdkProofTransport(f, target, wire, async () => {}, n => { charged += n })
    transport.start(Date.now() + 20000)
    await runContextualSurveysSdkContracts(transport.client, { ownerId: owner, memberId: member, outsiderId: f.actors[2].id, classroomId: cid, surveyId: sid }, async () => {})
    expect(charged).toBe(transport.complete().bytes)
    const stopped = server(), refused = createSurveySdkProofTransport(f, target, stopped, async () => {}, () => { throw new Error('shared cap') })
    refused.start(Date.now() + 20000)
    await expect(refused.fetch(firstUrl, firstRequest())).rejects.toThrow()
    expect(stopped).not.toHaveBeenCalled(); expect(() => refused.complete()).toThrow()
    let charges=0
    const responseWire=server(), responseRefused=createSurveySdkProofTransport(f,target,responseWire,async()=>{},()=>{if(++charges===2)throw new Error('shared cap')})
    responseRefused.start(Date.now()+20000)
    await expect(responseRefused.fetch(firstUrl,firstRequest())).rejects.toThrow()
    expect(responseWire).toHaveBeenCalledOnce();expect(()=>responseRefused.complete()).toThrow()
  })
  it('runs actual installed SDK encoding through all14 frozen requests with byte receipts', async () => {
    const wire = server(), guard = vi.fn(async () => {}), transport = createSurveySdkProofTransport(f, target, wire, guard)
    transport.start(Date.now() + 20000)
    await runContextualSurveysSdkContracts(transport.client, { ownerId: owner, memberId: member, outsiderId: f.actors[2].id,
      classroomId: cid, surveyId: sid }, guard)
    const evidence = transport.complete()
    expect(wire).toHaveBeenCalledTimes(14); expect(evidence.calls).toBe(14); expect(evidence.receipts).toHaveLength(14)
    expect(evidence.nativeVerified).toBe(false); expect(transport.manifest.executionEnabled).toBe(false)
    for (const row of evidence.receipts) expect(row.requestSha256).toMatch(/^[a-f0-9]{64}$/)
    await expect(transport.fetch(firstUrl, firstRequest())).rejects.toThrow()
    expect(wire).toHaveBeenCalledTimes(14)
  })
  it.each(['host', 'query', 'path', 'method', 'header', 'body', 'duplicate-key', 'size'] as const)('rejects substituted %s before network dispatch', async defect => {
    const wire = server(), transport = createSurveySdkProofTransport(f, target, wire, async () => {})
    transport.start(Date.now() + 20000)
    let url = firstUrl; const init = firstRequest()
    if (defect === 'host') url = url.replace('127.0.0.1', 'localhost')
    if (defect === 'query') url += '?select=*'
    if (defect === 'path') url = url.replace('get_survey_for_owner_v1', 'get_survey_for_member_v1')
    if (defect === 'method') init.method = 'GET'
    if (defect === 'header') init.headers = { ...headers, 'x-client-info': 'unknown-sdk' }
    if (defect === 'body') init.body = JSON.stringify({ p_actor_id: member, p_survey_id: sid })
    if (defect === 'duplicate-key') init.body = `{"p_actor_id":"${member}","p_actor_id":"${owner}","p_survey_id":"${sid}"}`
    if (defect === 'size') init.body = 'x'.repeat(SURVEY_SDK_PROOF_CAPS.requestBytes + 1)
    await expect(transport.fetch(url, init)).rejects.toThrow('private details withheld')
    expect(wire).not.toHaveBeenCalled(); expect(() => transport.complete()).toThrow()
  })
  it.each(['redirect', 'declared-size', 'stream-size', 'duplicate-reply', 'wrong-parent'] as const)('refuses malformed %s replies', async defect => {
    const wire = vi.fn<typeof fetch>(async () => {
      if (defect === 'declared-size') return reply({}, 200, { 'content-length': String(SURVEY_SDK_PROOF_CAPS.responseBytes + 1) })
      if (defect === 'stream-size') return new Response(new Uint8Array(SURVEY_SDK_PROOF_CAPS.responseBytes + 1), { headers: { 'content-type': 'application/json' } })
      if (defect === 'redirect') return reply({}, 302, { location: 'https://example.invalid' })
      if (defect === 'duplicate-reply') return new Response('{"classroom":{},"classroom":{}}', { headers: { 'content-type': 'application/json' } })
      return reply({ classroom: { ...classroom, id: f.classes[1].id }, survey: survey(), questions: [f.question], responses: [] })
    })
    const transport = createSurveySdkProofTransport(f, target, wire, async () => {})
    transport.start(Date.now() + 20000)
    await expect(transport.fetch(firstUrl, firstRequest())).rejects.toThrow('private details withheld')
    expect(() => transport.complete()).toThrow()
  })
  it('uses one absolute20s deadline and rejects replay/extra requests after completion', async () => {
    vi.useFakeTimers()
    try {
      const wire = vi.fn<typeof fetch>(() => new Promise<Response>(() => {})), transport = createSurveySdkProofTransport(f, target, wire, async () => {})
      transport.start(Date.now() + 60000)
      const pending = transport.fetch(firstUrl, firstRequest()).then(() => undefined, error => error)
      await vi.advanceTimersByTimeAsync(20001)
      expect(await pending).toBeInstanceOf(Error); expect(wire.mock.calls[0][1]?.signal?.aborted).toBe(true)
      await expect(transport.fetch(firstUrl, firstRequest())).rejects.toThrow()
    } finally { vi.useRealTimers() }
  })
  it('rejects expired root binding before guard/network and preserves caller cancellation', async () => {
    const wire = server(), guard = vi.fn(async () => {}), transport = createSurveySdkProofTransport(f, target, wire, guard)
    expect(() => transport.start(Date.now() - 1)).toThrow()
    transport.start(Date.now() + 20000)
    const controller = new AbortController(); controller.abort()
    await expect(transport.fetch(firstUrl, { ...firstRequest(), signal: controller.signal })).rejects.toThrow()
    expect(wire).not.toHaveBeenCalled(); expect(guard).not.toHaveBeenCalled()
  })
})

function baseline() {
  const enrollment = f.enrollments[1], scope = createHash('sha256').update(`pika-membership-scope-v1:${cid}:${member}`).digest('hex')
  return {
    'public.surveys': [survey()], 'public.survey_questions': [f.question], 'public.survey_responses': [],
    'public.classrooms': [{ ...classroom, title: f.tag, blueprint_source_revision: 4, updated_at: earlier }],
    'public.classroom_archive_revisions': [{ classroom_id: cid, revision: 10, updated_at: earlier }],
    'public.classroom_enrollments': [{ id: enrollment.id, classroom_id: cid, student_id: member, created_at: earlier, manual_attendance_marks: {} }],
    'private.pal_membership_generations': [{ generation_id: enrollment.id, scope_digest: scope, state: 'active', pal_reference: 'pika-membership-v1-' + 'a'.repeat(32) }],
    'private.pal_membership_settings': [{ singleton: true, enabled: false }],
    'storage.objects': [{ id: id('98'), bucket_id: 'unrelated', name: 'unrelated' }],
  }
}
describe('explicit committed Survey graph effects', () => {
  it('accepts the exact terminal cascade and11/5 bookkeeping; denies every unrelated change', () => {
    const before = baseline(), after = structuredClone(before)
    after['public.surveys'] = []; after['public.survey_questions'] = []; after['public.survey_responses'] = []
    after['public.classrooms'][0].blueprint_source_revision += 5; after['public.classrooms'][0].updated_at = at
    after['public.classroom_archive_revisions'][0].revision += 11; after['public.classroom_archive_revisions'][0].updated_at = at
    expect(verifySurveySdkTerminalEffects(f, before, after, window).nativeVerified).toBe(false)
    for (const defect of ['settings', 'storage', 'extra-revision', 'owner', 'missing-table', 'leaked-child'] as const) {
      const bad = structuredClone(after)
      if (defect === 'settings') bad['private.pal_membership_settings'][0].enabled = true
      if (defect === 'storage') bad['storage.objects'][0].name = 'changed'
      if (defect === 'extra-revision') bad['public.classroom_archive_revisions'][0].revision++
      if (defect === 'owner') bad['public.classrooms'][0].teacher_id = member
      if (defect === 'missing-table') delete (bad as Record<string, unknown>)['storage.objects']
      if (defect === 'leaked-child') bad['public.survey_questions'] = [f.question]
      expect(() => verifySurveySdkTerminalEffects(f, before, bad, window)).toThrow()
    }
  })
  it('restores membership only with a fresh enrollment/epoch and exactly two revision events', () => {
    const before = baseline(), after = structuredClone(before)
    after['public.classroom_enrollments'][0] = { ...after['public.classroom_enrollments'][0], id: f.replacementEnrollment.id, created_at: at }
    after['private.pal_membership_generations'][0].state = 'removed'
    after['private.pal_membership_generations'].push({ ...after['private.pal_membership_generations'][0],
      generation_id: f.replacementEnrollment.id, state: 'active', pal_reference: 'pika-membership-v1-' + 'b'.repeat(32) })
    after['public.classroom_archive_revisions'][0].revision += 2; after['public.classroom_archive_revisions'][0].updated_at = at
    expect(verifySurveyMembershipRestoration(f, before, after, window).freshGenerationVerified).toBe(true)
    const sql = surveyMembershipRestoreSql(f, before)
    expect(sql).toContain('insert into public.classroom_enrollments')
    expect(sql).not.toMatch(/(?:update|delete from|insert into) private\.pal_membership_generations/i)
    for (const defect of ['reactivation', 'reference-reuse', 'scope', 'manual-marks', 'extra-generation', 'unrelated'] as const) {
      const bad = structuredClone(after)
      if (defect === 'reactivation') bad['private.pal_membership_generations'][0].state = 'active'
      if (defect === 'reference-reuse') bad['private.pal_membership_generations'][1].pal_reference = bad['private.pal_membership_generations'][0].pal_reference
      if (defect === 'scope') bad['private.pal_membership_generations'][1].scope_digest = 'f'.repeat(64)
      if (defect === 'manual-marks') bad['public.classroom_enrollments'][0].manual_attendance_marks = { changed: true }
      if (defect === 'extra-generation') bad['private.pal_membership_generations'].push({ ...bad['private.pal_membership_generations'][1], generation_id: id('99') })
      if (defect === 'unrelated') bad['private.pal_membership_settings'][0].enabled = true
      expect(() => verifySurveyMembershipRestoration(f, before, bad, window)).toThrow()
    }
  })
})
