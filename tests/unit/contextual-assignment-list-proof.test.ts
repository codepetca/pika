import { describe, expect, it, vi } from 'vitest'
import {
  decodeAssignmentListProofManifest, validateAssignmentListProofTarget, containedAssignmentListProofFetch,
  assignmentListProofDiagnostic,
} from '../../scripts/check-contextual-assignment-list-reads'

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const token = (claims: unknown) => `header.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.signature`
const target = () => ({ API_URL: 'http://127.0.0.1:54321', DB_URL: 'postgresql://postgres:private@127.0.0.1:54322/postgres', SERVICE_ROLE_KEY: token({ iss: 'supabase-demo', role: 'service_role' }) })
const manifest = () => {
  const actors = Array.from({ length: 5 }, (_, n) => ({ id: uuid(n + 1), email: `assignmentlist_abcdef123456_${n}@example.invalid`, role: n % 2 ? 'teacher' : 'student' }))
  const classrooms = [6, 7].map(n => ({ id: uuid(n), title: `assignmentlist_abcdef123456 ${n}` }))
  const labels = ['owner_student', 'owner_teacher', 'member_student', 'member_teacher', 'outsider', 'self_owner', 'archived_member', 'hidden_member']
  return { version: 1, syntheticTag: 'assignmentlist_abcdef123456', now: '2026-10-03T12:00:00Z', actors, classrooms,
    cases: labels.map((label, n) => ({ label, actorId: actors[n % 5].id, classroomId: classrooms[n % 2].id, permission: n < 2 ? 'owner' : 'member', expectedStatus: n < 4 ? '200' : '403',
      assignmentIds: n === 0 ? Array.from({ length: 1001 }, (_, i) => uuid(i + 10)) : [],
      ...(n === 0 ? { stats: [{ id: uuid(10), totalStudents: 1001, submitted: 1001, requirementIds: Array.from({ length: 1001 }, (_, i) => uuid(i + 2000)) }] } : {}) })) }
}

describe('assignment-list proof contracts (no commands, database or network)', () => {
  it('accepts only the exact local target and demo service identity', () => {
    expect(validateAssignmentListProofTarget(target())).toMatchObject({ API_URL: 'http://127.0.0.1:54321' })
  })
  it('binds isolated projects to explicit disjoint ports and rejects canonical crossover', async () => {
    const project = 'pika_assignment_list_abcdef123456'
    const isolated = { ...target(), API_URL: 'http://127.0.0.1:54331', DB_URL: 'postgresql://postgres:private@127.0.0.1:54332/postgres' }
    expect(validateAssignmentListProofTarget(isolated, project)).toEqual(isolated)
    expect(() => validateAssignmentListProofTarget(target(), project)).toThrow('Local assignment-list target guard failed')
    expect(() => validateAssignmentListProofTarget(isolated)).toThrow('Local assignment-list target guard failed')
    const original = vi.fn()
    await expect(containedAssignmentListProofFetch(original as typeof fetch, project)('http://127.0.0.1:54321/rest/v1/classrooms')).rejects.toThrow('Local assignment-list transport rejected')
    expect(original).not.toHaveBeenCalled()
  })
  it.each([
    { API_URL: 'https://hosted.supabase.co' }, { API_URL: 'http://localhost:54321' }, { API_URL: 'http://127.0.0.1:54321/' },
    { DB_URL: 'postgresql://postgres:p@hosted.example:54322/postgres' }, { DB_URL: 'postgresql://postgres:p@127.0.0.1:5432/postgres' },
    { DB_URL: 'postgresql://postgres:p@127.0.0.1:54322/postgres?options=x' }, { DB_URL: 'postgresql://postgres:p@127.0.0.1:54322/postgres#x' },
    { SERVICE_ROLE_KEY: token({ iss: 'hosted', role: 'service_role' }) }, { SERVICE_ROLE_KEY: token({ iss: 'supabase-demo', role: 'anon' }) },
    { SERVICE_ROLE_KEY: 'sb_secret_private' },
  ])('rejects wrong-target or credential substitutions %# with private diagnostics', patch => {
    expect(() => validateAssignmentListProofTarget({ ...target(), ...patch })).toThrow('Local assignment-list target guard failed')
    try { validateAssignmentListProofTarget({ ...target(), ...patch }) } catch (error) { expect(String(error)).not.toContain('private') }
  })
  it('decodes the scoped large-collection fixture contract', () => {
    expect(decodeAssignmentListProofManifest(manifest()).cases).toHaveLength(8)
  })
  it.each([
    (f: any) => ({ ...f, version: 2 }), (f: any) => ({ ...f, extra: true }),
    (f: any) => ({ ...f, actors: [...f.actors, f.actors[0]] }),
    (f: any) => ({ ...f, actors: f.actors.map((a: any, n: number) => n ? a : { ...a, email: 'real@example.com' }) }),
    (f: any) => ({ ...f, cases: f.cases.map((c: any, n: number) => n ? c : { ...c, actorId: uuid(9000) }) }),
    (f: any) => ({ ...f, cases: f.cases.map((c: any, n: number) => n ? c : { ...c, assignmentIds: [uuid(10), uuid(10)] }) }),
    (f: any) => ({ ...f, cases: f.cases.map((c: any) => ({ ...c, assignmentIds: [] })) }),
    (f: any) => ({ ...f, cases: f.cases.map((c: any) => ({ ...c, stats: [] })) }),
  ])('fails closed on malformed, unscoped, duplicate or incomplete fixture %#', mutate => {
    expect(() => decodeAssignmentListProofManifest(mutate(manifest()))).toThrow('Reviewed assignment-list fixture rejected')
  })
  it.each(['https://provider.example/api', 'http://127.0.0.1:54321/storage/v1/object/x', 'http://127.0.0.1:54321/auth/v1/token', 'http://user:private@127.0.0.1:54321/rest/v1/classrooms', 'http://127.0.0.1:54321/rest/v1/classrooms#private'])('blocks out-of-scope fetch before transport: %s', async url => {
    const original = vi.fn()
    await expect(containedAssignmentListProofFetch(original as typeof fetch)(url)).rejects.toThrow('Local assignment-list transport rejected')
    expect(original).not.toHaveBeenCalled()
  })
  it('denies redirects, bounds the transport and preserves reader cancellation', async () => {
    const controller = new AbortController(); const original = vi.fn<typeof fetch>(async () => new Response('{}'))
    await containedAssignmentListProofFetch(original as typeof fetch)('http://127.0.0.1:54321/rest/v1/classrooms', { signal: controller.signal })
    const init = original.mock.calls[0][1] as RequestInit
    expect(init.redirect).toBe('error'); expect(init.signal?.aborted).toBe(false)
    controller.abort(); expect(init.signal?.aborted).toBe(true)
  })
  it('renders diagnostics from closed vocabularies only', () => {
    expect(assignmentListProofDiagnostic('private@example.com', 'postgresql://private', 999)).toBe('DIAG assignment-list stage=unknown category=unexpected status=none')
    expect(assignmentListProofDiagnostic('cleanup', 'assertion', 503)).toBe('DIAG assignment-list stage=cleanup category=assertion status=503')
  })
})
