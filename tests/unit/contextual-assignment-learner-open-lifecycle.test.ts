import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { newAssignmentListProofFixture } from '../../scripts/contextual-assignment-list-proof-fixture'
import { assignmentListRevocationPlans } from '../../scripts/contextual-assignment-list-proof-revocations'
import { parseAssignmentListLifecycleArgs } from '../../scripts/check-contextual-assignment-list-lifecycle'
import { ApiError } from '../../src/lib/api-error'
import { boundedAssignmentListJson } from '../../src/lib/validations/contextual-assignment-list-read'
import {
  assignmentLearnerOpenProofCases, assignmentLearnerOpenProofExpectation, assignmentLearnerOpenRevocationBoundary,
  observeAssignmentLearnerOpenTransition, createAssignmentLearnerOpenProofClient, assignmentLearnerOpenProofDiagnostic,
  assignmentLearnerOpenForcedReceipt,
} from '../../scripts/check-contextual-assignment-learner-open-lifecycle'
import { AssignmentListLifecycleError } from '../../scripts/contextual-assignment-list-proof-lifecycle'

function target(f: ReturnType<typeof newAssignmentListProofFixture>) {
  const token = `${Buffer.from('{}').toString('base64url')}.${Buffer.from(JSON.stringify({ iss: 'supabase-demo', role: 'service_role' })).toString('base64url')}.synthetic`
  return { API_URL: 'http://127.0.0.1:54331', DB_URL: 'postgresql://postgres:synthetic@127.0.0.1:54332/postgres', SERVICE_ROLE_KEY: token }
}
describe('read-only learner-open projection observer', () => {
  it('maps only real fixture resources without creating missing documents or assignments', () => {
    const f = newAssignmentListProofFixture(); const before = JSON.stringify(f)
    const cases = assignmentLearnerOpenProofCases(f)
    expect(cases).toHaveLength(9); expect(cases.filter(c => c.status === 200)).toHaveLength(3)
    expect(cases.filter(c => c.status === 403)).toHaveLength(4); expect(cases.filter(c => c.status === 404)).toHaveLength(2)
    const successes = cases.filter(c => c.status === 200)
    expect(successes.map(c => f.people.find(p => p.id === c.actorId)!.role)).toContain('teacher')
    expect(successes.map(c => f.people.find(p => p.id === c.actorId)!.role)).toContain('student')
    for (const c of successes) expect(f.docs.some(d => d.id === c.docId && d.student === c.actorId && d.assignment === c.assignmentId)).toBe(true)
    for (const c of f.manifest.cases.filter(c => ['archived_member', 'hidden_member'].includes(c.label))) expect(assignmentLearnerOpenProofExpectation(f, c)).toBeNull()
    expect(assignmentLearnerOpenProofExpectation(f, f.manifest.cases.find(c => c.label === 'member_teacher')!)).toBeNull()
    expect(JSON.stringify(f)).toBe(before)
  })
  it('rejects substituted manifest cases', () => {
    const f = newAssignmentListProofFixture()
    expect(() => assignmentLearnerOpenProofExpectation(f, { ...f.manifest.cases[0], actorId: f.manifest.actors[4].id })).toThrow()
  })
  it('uses a sealed cold nonmutating RPC stub with exact args and no network', async () => {
    const f = newAssignmentListProofFixture(); const c = assignmentLearnerOpenProofCases(f).find(c => c.status === 200)!
    const fetcher = vi.fn(async () => { throw new Error('Network forbidden') })
    const proof = createAssignmentLearnerOpenProofClient(f, c, target(f), fetcher)
    const before = JSON.stringify(f); const signal = new AbortController().signal
    const request = proof.client.rpc('open_assignment_doc_for_member_v1', { p_actor_id: c.actorId, p_assignment_id: c.assignmentId, p_viewed_at: f.manifest.now, p_pal_event: null }).abortSignal(signal)
    expect(proof.counts.controlledRpcStubs).toBe(0)
    const result = await request
    expect(result.error).toBeNull(); expect(result.data).toMatchObject({ created: false, viewed_at_changed: false, doc: { id: c.docId, student_id: c.actorId, assignment_id: c.assignmentId } })
    // The real learner reader bounds RPC content before its existing parser.
    // A missing content field must not make this controlled projection fail.
    expect(boundedAssignmentListJson((result.data as any).doc.content, 2 * 1024 * 1024)).toBe(true)
    expect((result.data as any).doc.content).toEqual({ type: 'doc', content: [] })
    expect(proof.counts.controlledRpcStubs).toBe(1); expect(proof.counts.networkRpc).toBe(0); expect(proof.counts.storage).toBe(0); expect(proof.counts.provider).toBe(0)
    expect(fetcher).not.toHaveBeenCalled(); expect(JSON.stringify(f)).toBe(before)
    expect(Object.getOwnPropertyDescriptor(proof.client, 'rpc')).toMatchObject({ writable: false, configurable: false })
  })
  it('rejects wrong RPC, arguments, Pal events and repeat consumption before network', async () => {
    const f = newAssignmentListProofFixture(); const c = assignmentLearnerOpenProofCases(f).find(c => c.status === 200)!
    const fetcher = vi.fn(async () => { throw new Error('Must not fetch') }); const proof = createAssignmentLearnerOpenProofClient(f, c, target(f), fetcher)
    const args = { p_actor_id: c.actorId, p_assignment_id: c.assignmentId, p_viewed_at: f.manifest.now, p_pal_event: null }
    for (const invalid of [{ ...args, p_actor_id: f.manifest.actors[4].id }, { ...args, p_assignment_id: f.assignments[1].id }, { ...args, p_pal_event: {} }, { ...args, extra: true }]) expect(() => proof.client.rpc('open_assignment_doc_for_member_v1', invalid)).toThrow()
    expect(() => (proof.client.rpc as any)('another_rpc', args)).toThrow()
    const request = proof.client.rpc('open_assignment_doc_for_member_v1', args).abortSignal(new AbortController().signal)
    await request; await expect(Promise.resolve(request)).rejects.toThrow()
    expect(fetcher).not.toHaveBeenCalled()
  })
  it('fails a missing fixture document lookup rather than manufacturing a document ID', () => {
    const f = newAssignmentListProofFixture(); const c = assignmentLearnerOpenProofCases(f).find(c => c.status === 200)!
    const fetcher = vi.fn(async () => { throw Error('Must not fetch') }); const proof = createAssignmentLearnerOpenProofClient(f, c, target(f), fetcher)
    f.docs = f.docs.filter(doc => doc.id !== c.docId)
    expect(() => proof.client.rpc('open_assignment_doc_for_member_v1', { p_actor_id: c.actorId, p_assignment_id: c.assignmentId, p_viewed_at: f.manifest.now, p_pal_event: null })).toThrow()
    expect(fetcher).not.toHaveBeenCalled(); expect(proof.counts.controlledRpcStubs).toBe(0)
  })
  it.each(['/rest/v1/rpc/open_assignment_doc_for_member_v1', '/storage/v1/object/sign/assignment-artifacts/x', '/auth/v1/user', '/rest/v1/users'])('contains forbidden network endpoint %s', async path => {
    const f = newAssignmentListProofFixture(); const c = assignmentLearnerOpenProofCases(f).find(c => c.status === 200)!
    const fetcher = vi.fn(async () => new Response('{}'))
    const proof = createAssignmentLearnerOpenProofClient(f, c, target(f), fetcher)
    await expect(proof.fetch(`http://127.0.0.1:54331${path}`, { method: 'GET', signal: new AbortController().signal })).rejects.toThrow()
    expect(fetcher).not.toHaveBeenCalled()
  })
  it('contains foreign origins, widening and actual DML', async () => {
    const f = newAssignmentListProofFixture(); const c = assignmentLearnerOpenProofCases(f).find(c => c.status === 200)!
    const fetcher = vi.fn(async () => new Response('{}')); const proof = createAssignmentLearnerOpenProofClient(f, c, target(f), fetcher)
    for (const [origin, method, select] of [['https://private.invalid', 'GET', 'id'], ['http://127.0.0.1:54331', 'POST', 'id'], ['http://127.0.0.1:54331', 'GET', '*']]) {
      await expect(proof.fetch(`${origin}/rest/v1/assignments?id=eq.${c.assignmentId}&select=${select}`, { method, signal: new AbortController().signal })).rejects.toThrow()
    }
    expect(fetcher).not.toHaveBeenCalled()
  })
  it('injects the same original transition once and delegates the sole restore', async () => {
    const f = newAssignmentListProofFixture(); const plan = assignmentListRevocationPlans(f).find(p => p.transition === 'member-remove' && p.boundary === 'first')!
    const url = new URL('http://127.0.0.1:54331/rest/v1/assignments?select=id,instructions_markdown')
    const calls: string[] = []
    expect(await observeAssignmentLearnerOpenTransition(f, plan, plan.revokeSql, async sql => { calls.push(sql) }, async hook => {
      await hook(url); await hook(url); throw new ApiError(503, 'Unavailable')
    })).toBe(true)
    expect(calls).toEqual([plan.revokeSql])
    expect(await observeAssignmentLearnerOpenTransition(f, plan, plan.restoreSql, async sql => { calls.push(sql) }, async () => { throw Error('No read on restore') })).toBe(false)
    expect(calls).toEqual([plan.revokeSql, plan.restoreSql])
  })
  it('maps exactly six supported original revocation boundaries', () => {
    const f = newAssignmentListProofFixture(); const ids = f.requirements.map(r => r.id).sort()
    const plans = assignmentListRevocationPlans(f).filter(p => ['owner-transfer', 'member-remove'].includes(p.transition)); expect(plans).toHaveLength(6)
    for (const plan of plans) {
      const url = new URL('http://127.0.0.1:54331/rest/v1/assignments?select=id,instructions_markdown')
      if (plan.boundary !== 'first') { url.searchParams.set('select', 'id,requirements:assignment_submission_requirements(id)'); url.searchParams.set('requirements.id', `gt.${plan.boundary === 'later' ? ids.at(-2) : ids.at(-1)}`) }
      expect(assignmentLearnerOpenRevocationBoundary(f, plan, url)).toBe(true)
    }
  })
  it('never retries an ambiguous transition or invents a missed boundary', async () => {
    const f = newAssignmentListProofFixture(); const plan = assignmentListRevocationPlans(f)[0]; const calls: string[] = []
    await expect(observeAssignmentLearnerOpenTransition(f, plan, plan.revokeSql, async sql => { calls.push(sql); throw Error('Ambiguous') }, async hook => {
      const url = new URL('http://127.0.0.1:54331/rest/v1/assignments?select=instructions_markdown'); await hook(url).catch(() => undefined); await hook(url); throw new ApiError(503, 'Unavailable')
    })).rejects.toThrow(); expect(calls).toEqual([plan.revokeSql])
  })
  it('prints only closed bounded diagnostics', () => {
    expect(assignmentLearnerOpenProofDiagnostic({ case: 'member_student', phase: 'requirements', statement: 10, http: 200, code: 'PGRST108' })).toBe('case=member_student phase=requirements statement=10 http=200 code=PGRST108')
    expect(assignmentLearnerOpenProofDiagnostic({ case: 'private row', phase: 'https://private', statement: Infinity, http: 999, code: 'secret' })).toBe('case=none phase=none statement=0 http=0 code=none')
  })
  it.each(['after-fixture', 'before-capture'] as const)('requires exact successful cleanup for forced receipt %s', mode => {
    const error = new AssignmentListLifecycleError({ stage: mode, error: new Error('Forced isolated lifecycle failure') }, [])
    const receipt = assignmentLearnerOpenForcedReceipt(mode, error)!
    expect(receipt).toEqual({ exitCode: 1, stdout: 'PASS isolated assignment-learner-open projection exact teardown and unchanged canonical baseline.\n', stderr: `FAIL forced isolated assignment-learner-open projection lifecycle: ${mode}.\n` })
    expect((receipt.stdout + receipt.stderr).trim().split('\n')).toHaveLength(2)
    expect(assignmentLearnerOpenForcedReceipt(mode, new AssignmentListLifecycleError({ stage: mode, error: new Error('Unexpected private error') }, []))).toBeNull()
    expect(assignmentLearnerOpenForcedReceipt(mode, new AssignmentListLifecycleError({ stage: mode, error: new Error('Forced isolated lifecycle failure') }, [{ stage: 'cleanup', error: Error('Private') }]))).toBeNull()
    expect(assignmentLearnerOpenForcedReceipt('normal', error)).toBeNull()
  })
  it('keeps strict CLI and source-only scope', () => {
    expect(parseAssignmentListLifecycleArgs(['--reviewed-head', 'a'.repeat(40), '--mode', 'normal'])).toEqual({ head: 'a'.repeat(40), mode: 'normal' })
    for (const args of [[], ['--reviewed-head', 'short', '--mode', 'normal'], ['--reviewed-head', 'a'.repeat(40), '--mode', 'other']]) expect(() => parseAssignmentListLifecycleArgs(args)).toThrow()
    const source = readFileSync('scripts/check-contextual-assignment-learner-open-lifecycle.ts', 'utf8')
    expect(source).toContain('controlled non-network, nonmutating RPC stub')
    expect(source).not.toMatch(/\.from\(|\.insert\(|\.delete\(|shared-assignment-write-proof|disable.*168|console\.log/)
    expect(source).toContain('native.runCase(request)'); expect(source).toContain('native.runRevocation(')
  })
})
