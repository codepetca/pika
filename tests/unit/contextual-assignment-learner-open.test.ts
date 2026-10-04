import { afterEach, describe, expect, it, vi } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import { openSharedAssignmentLearnerDoc } from '@/lib/server/contextual-assignment-learner-open'
import type { Database } from '@/types/database'

const actorId = '11111111-1111-4111-8111-111111111111'
const ownerId = '22222222-2222-4222-8222-222222222222'
const classroomId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const assignmentId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const stamp = '2026-10-01T12:00:00Z'
const pal = vi.hoisted(() => ({ enabled: vi.fn(() => false), classroom: vi.fn(() => true), delivery: vi.fn(async () => 'delivered') }))
vi.mock('@/lib/server/pal-config', async original => ({ ...await original<typeof import('@/lib/server/pal-config')>(), isPalEnabled: pal.enabled, isClassroomPalRequested: pal.classroom }))
vi.mock('@/lib/server/pal-outbox', () => ({ attemptImmediatePalEventDelivery: pal.delivery }))
const classroom = { id: classroomId, teacher_id: ownerId, archived_at: null, feature_visibility: { student_grades: false } }
const membership = { id: uuid(1), classroom_id: classroomId, student_id: actorId }
const assignment = { id: assignmentId, classroom_id: classroomId, is_draft: false, released_at: stamp, created_at: stamp,
  title: 'Essay', description: '', due_at: stamp, position: 0, created_by: ownerId, updated_at: stamp, instructions_markdown: 'Write', rich_instructions: null,
  artifact_id: uuid(2), source_artifact_id: null, source_blueprint_version_id: null, blueprint_archived_at: null, points_possible: 3,
  gradebook_category_id: null, gradebook_maximum_override: null, gradebook_score_scale: 1, gradebook_weight: 1, include_in_final: true, track_authenticity: false }
const doc = { id: uuid(3), assignment_id: assignmentId, student_id: actorId, content: JSON.stringify({ type: 'doc', content: [] }), content_legacy: '',
  is_submitted: false, submitted_at: null, returned_at: null, feedback_returned_at: null, teacher_cleared_at: null,
  created_at: stamp, updated_at: stamp, viewed_at: stamp, github_username: null, repo_url: null, save_sequence: null, save_session_id: null }
const grade = { id: doc.id, assignment_id: assignmentId, student_id: actorId, returned_at: stamp, score_completion: 0, score_thinking: 1, score_workflow: 2,
  graded_at: stamp, graded_by: ownerId, authenticity_score: 90, authenticity_flags: [] }
const releasedFeedback = { id: doc.id, assignment_id: assignmentId, student_id: actorId, returned_at: null, feedback_returned_at: stamp, feedback: 'Released' }
const requirement = (n: number) => ({ id: uuid(10000 + n), assignment_id: assignmentId, artifact_id: uuid(20000 + n), type: 'link', label: 'Evidence', instructions: '',
  required: true, position: n, created_at: stamp, updated_at: stamp, source_artifact_id: null, source_blueprint_version_id: null, validation_policy_json: {} })
const artifact = (n: number) => ({ id: uuid(30000 + n), assignment_doc_id: doc.id, requirement_id: requirement(n).id, student_id: actorId, type: 'link',
  url: 'https://example.test/', storage_path: null, managed_object_id: null, metadata_json: {}, validation_status: 'valid', validation_message: null,
  validated_at: stamp, created_at: stamp, updated_at: stamp, requirement: { id: requirement(n).id, assignment_id: assignmentId, type: 'link' }, managed_object: null })
const feedback = (n: number) => ({ id: uuid(40000 + n), assignment_id: assignmentId, student_id: actorId, entry_kind: 'teacher_feedback', author_type: 'teacher',
  body: 'Returned history', returned_at: stamp, created_at: stamp, created_by: ownerId })
const identity = { id: uuid(5), user_id: actorId, github_login: 'learner', commit_emails: ['learner@example.test'], validation_status: 'valid', validation_message: null,
  validated_at: stamp, created_at: stamp, updated_at: stamp }
const imageRequirement = (n: number) => ({ ...requirement(n), type: 'image' })
const imageArtifact = (n: number, path?: string, managed = true) => {
  const objectId = uuid(50000 + n)
  const storagePath = path ?? `classrooms/${classroomId}/students/${actorId}/assignment-docs/${doc.id}/artifacts/${objectId}.png`
  return { ...artifact(n), type: 'image', storage_path: storagePath, managed_object_id: managed ? objectId : null,
    requirement: { ...artifact(n).requirement, type: 'image' }, managed_object: managed ? { id: objectId, classroom_id: classroomId,
      data_subject_user_id: actorId, resource_type: 'assignment_doc', resource_id: doc.id, purpose: 'student_assignment_artifact', status: 'verified',
      storage_bucket: 'assignment-artifacts', storage_path: storagePath } : null }
}

function fixture(options: { doc?: typeof doc; requirements?: any[]; artifacts?: any[]; feedback?: any[]; identity?: any; cap?: number;
  rpcError?: string; rpcChange?: (result: any) => any; intercept?: (row: any, url: URL, index: number) => any;
  signing?: (paths: string[]) => unknown; storageError?: 'network' | 'api' | 'invalid-json'; holdAt?: number } = {}) {
  const urls: URL[] = []; const methods: string[] = []; const bodies: any[] = []; const rpcBodies: any[] = []; let rpcCalls = 0
  const baseDoc = options.doc ?? doc
  const fetcher = vi.fn(async (request: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(request)); urls.push(url); methods.push(init?.method ?? 'GET')
    if (urls.length - 1 === options.holdAt) return new Promise<Response>(() => {})
    if (url.pathname.includes('/storage/')) {
      const body = JSON.parse(String(init?.body)); bodies.push(body)
      if (options.storageError === 'network') throw new Error('Private network error')
      if (options.storageError === 'api') return new Response(JSON.stringify({ message: 'Private provider error' }), { status: 503 })
      if (options.storageError === 'invalid-json') return new Response('{bad', { status: 200 })
      const result = options.signing ? options.signing(body.paths) : body.paths.map((path: string) => ({ path, error: null, signedURL: `/object/sign/assignment-artifacts/${path}?token=test` }))
      return new Response(JSON.stringify(result), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    if (url.pathname.includes('/rpc/')) {
      rpcCalls++
      if (options.rpcError) return new Response(JSON.stringify({ code: options.rpcError, message: 'Private error' }), { status: 400 })
      const body = JSON.parse(String(init?.body))
      rpcBodies.push(body)
      const result = { ok: true, created: true, viewed_at_changed: true, assignment: { ...assignment, private_rpc: 'never serialize' },
        doc: { ...baseDoc, viewed_at: body.p_viewed_at, teacher_feedback_draft: 'Secret', ai_grading_provenance: { secret: true } } }
      return new Response(JSON.stringify(options.rpcChange ? options.rpcChange(result) : result), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    const select = url.searchParams.get('select') ?? ''
    const page = (kind: string, rows: any[]) => rows.filter(r => {
      const filter = url.searchParams.get(`${kind}.id`) ?? ''
      return filter.startsWith('in.') ? filter.slice(4, -1).split(',').includes(r.id) : r.id > filter.slice(3)
    })
      .slice(0, Math.min(options.cap ?? Infinity, Number(url.searchParams.get(`${kind}.limit`) ?? 1000)))
    let row: any = { id: assignmentId, classroom_id: classroomId, is_draft: false, released_at: stamp, created_at: stamp, classrooms: { ...classroom } }
    if (select.includes('membership:')) row.classrooms.membership = [{ ...membership }]
    if (select.includes('title')) row = { ...assignment, classrooms: row.classrooms }
    if (select.includes('users!')) row.classrooms.membership[0].users = { id: actorId, github_identity: Object.hasOwn(options, 'identity') ? options.identity : identity }
    if (select.includes('docs:')) row.docs = [select.includes('content,') ? { ...baseDoc } : { id: baseDoc.id, assignment_id: baseDoc.assignment_id,
      student_id: baseDoc.student_id, returned_at: baseDoc.returned_at, feedback_returned_at: baseDoc.feedback_returned_at }]
    if (select.includes('grades:')) row.grades = [{ ...grade, returned_at: baseDoc.returned_at }]
    if (select.includes('released_feedback:')) row.released_feedback = [{ ...releasedFeedback, returned_at: baseDoc.returned_at, feedback_returned_at: baseDoc.feedback_returned_at }]
    if (select.includes('requirements:')) row.requirements = page('requirements', options.requirements ?? [])
    if (select.includes('feedback:assignment_feedback')) row.feedback = page('feedback', options.feedback ?? [])
    if (select.includes('artifacts:')) row.docs = [{ id: doc.id, assignment_id: assignmentId, student_id: actorId, artifacts: page('docs.artifacts', options.artifacts ?? []) }]
    if (options.intercept) row = options.intercept(structuredClone(row), url, urls.length - 1)
    return new Response(JSON.stringify(row), { status: 200, headers: { 'content-type': 'application/json' } })
  })
  const supabase = createClient<Database>('http://127.0.0.1:54321', 'fake-key', { global: { fetch: fetcher }, auth: { persistSession: false, autoRefreshToken: false } })
  return { urls, methods, bodies, rpcBodies, fetcher, rpcCalls: () => rpcCalls, read: () => openSharedAssignmentLearnerDoc({ supabase, actorId, assignmentId }) }
}
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); vi.useRealTimers(); pal.enabled.mockReturnValue(false); pal.classroom.mockReturnValue(true); pal.delivery.mockClear() })
describe('statement-bound own learner open', () => {
  it('returns only fresh explicit fields and retains transactional flags', async () => {
    const f = fixture(); const result = await f.read()
    expect(result).toMatchObject({ assignment: { title: 'Essay', instructions_markdown: 'Write' }, doc: { id: doc.id, content: { type: 'doc', content: [] }, score_completion: null, feedback: null }, wasFirstView: true })
    expect(JSON.stringify(result)).not.toMatch(/Secret|private_rpc|ai_grading_provenance|teacher_feedback_draft/)
    expect(f.rpcCalls()).toBe(1)
    for (const url of f.urls.filter(u => !u.pathname.includes('/rpc/')).slice(1)) {
      expect(url.pathname).toBe('/rest/v1/assignments')
      expect(url.searchParams.get('classrooms.membership.student_id')).toBe(`eq.${actorId}`)
      expect(url.searchParams.getAll('classrooms.teacher_id')).toContain(`neq.${actorId}`)
      expect(url.searchParams.get('is_draft')).toBe('eq.false')
      expect(url.searchParams.get('select')).not.toMatch(/\*|teacher_feedback_draft|ai_grading_provenance/)
    }
  })
  it.each([null, { ...classroom, archived_at: stamp }, { ...classroom, feature_visibility: { classwork: false } }])('conceals initial missing/archive/hidden before RPC %#', async control => {
    const f = fixture({ intercept: (row, _url, index) => index === 0 ? control === null ? null : { ...row, classrooms: control } : row })
    await expect(f.read()).rejects.toMatchObject({ statusCode: 404 }); expect(f.rpcCalls()).toBe(0)
  })
  it.each([{ is_draft: true }, { released_at: '2099-01-01T00:00:00Z' }])('conceals initial unpublished assignment %#', async change => {
    const f = fixture({ intercept: (row, _url, index) => index === 0 ? { ...row, ...change } : row })
    await expect(f.read()).rejects.toMatchObject({ statusCode: 404 }); expect(f.rpcCalls()).toBe(0)
  })
  it('denies current owner before historical self enrollment', async () => {
    const f = fixture({ intercept: row => ({ ...row, classrooms: { ...row.classrooms, teacher_id: actorId } }) })
    await expect(f.read()).rejects.toMatchObject({ statusCode: 403 }); expect(f.urls).toHaveLength(1)
  })
  it('denies absent enrollment before RPC', async () => {
    const f = fixture({ intercept: (row, _url, index) => index === 1 ? { ...row, classrooms: { ...row.classrooms, membership: [] } } : row })
    await expect(f.read()).rejects.toMatchObject({ statusCode: 403 }); expect(f.rpcCalls()).toBe(0)
  })
  it.each([{ returned_at: stamp, feedback_returned_at: null }, { returned_at: null, feedback_returned_at: stamp }])('discloses grades and feedback independently %#', async returns => {
    const result = await fixture({ doc: { ...doc, ...returns }, feedback: [feedback(0)] }).read()
    expect(result.doc.score_completion).toBe(returns.returned_at ? 0 : null); expect(result.doc.feedback).toBe('Released')
    expect(result.feedback_entries).toEqual([feedback(0)])
  })
  it('retains nonempty supplements and exact object/null GitHub FK', async () => {
    const result = await fixture({ requirements: [requirement(0)], artifacts: [artifact(0)], feedback: [feedback(0)] }).read()
    expect(result.submission_requirements).toEqual([requirement(0)]); expect(result.github_identity).toEqual(identity)
    expect(result.submission_artifacts[0]).not.toHaveProperty('requirement')
    expect((await fixture({ identity: null }).read()).github_identity).toBeNull()
    await expect(fixture({ identity: [identity] }).read()).rejects.toMatchObject({ statusCode: 503 })
  })
  it('paginates all collections through empty terminal pages, even shortened pages', async () => {
    const rows = Array.from({ length: 1001 }, (_, n) => requirement(n))
    const f = fixture({ requirements: rows, artifacts: rows.map((_, n) => artifact(n)), feedback: rows.map((_, n) => feedback(n)), cap: 400 })
    const result = await f.read(); expect(result.submission_requirements).toHaveLength(1001); expect(result.submission_artifacts).toHaveLength(1001); expect(result.feedback_entries).toHaveLength(1001)
    expect(f.urls.filter(u => u.searchParams.has('requirements.id'))).toHaveLength(3)
  })
  it.each([3, 4, 5, 6, 7, 8, 9])('fails closed on authority loss at read index %s', async index => {
    const f = fixture({ intercept: (row, _url, i) => i === index ? null : row })
    await expect(f.read()).rejects.toMatchObject({ statusCode: 503 }); expect(f.rpcCalls()).toBe(1)
  })
  it.each(['40001', 'PGRST202', 'XX000'])('never retries RPC error %s or writes directly', async rpcError => {
    const f = fixture({ rpcError }); await expect(f.read()).rejects.toMatchObject({ statusCode: rpcError === '40001' ? 409 : 503 })
    expect(f.rpcCalls()).toBe(1); expect(f.urls.filter((_, i) => f.methods[i] !== 'GET')).toHaveLength(1)
  })
  it.each([(r: any) => ({ ...r, doc: { ...r.doc, student_id: ownerId } }), (r: any) => ({ ...r, created: true, viewed_at_changed: false })])('rejects malformed RPC identities/flags %#', async rpcChange => {
    await expect(fixture({ rpcChange }).read()).rejects.toMatchObject({ statusCode: 503 })
  })
  it.each(['docs', 'requirements', 'feedback'])('rejects substituted or duplicate %s evidence', async kind => {
    const f = fixture({ requirements: [requirement(0)], feedback: [feedback(0)], intercept: row => row[kind]?.length ? { ...row, [kind]: [...row[kind], row[kind][0]] } : row })
    await expect(f.read()).rejects.toMatchObject({ statusCode: 503 })
  })
  it.each(['transfer', 'member', 'archive', 'visibility', 'publication', 'assignment', 'classroom'])('detects %s drift at every post-RPC statement', async kind => {
    const baseline = fixture(); await baseline.read()
    for (let index = 3; index < baseline.urls.length; index++) {
      const f = fixture({ intercept: (row, _url, i) => {
        if (i !== index) return row
        if (kind === 'transfer') row.classrooms.teacher_id = uuid(70000)
        if (kind === 'member') row.classrooms.membership = []
        if (kind === 'archive') row.classrooms.archived_at = stamp
        if (kind === 'visibility') row.classrooms.feature_visibility.classwork = false
        if (kind === 'publication') row.released_at = '2099-01-01T00:00:00Z'
        if (kind === 'assignment') row.id = uuid(70001)
        if (kind === 'classroom') row.classrooms.id = uuid(70002)
        return row
      } })
      await expect(f.read()).rejects.toMatchObject({ statusCode: 503 }); expect(f.rpcCalls()).toBe(1)
    }
  })
  it.each(['array-classroom', 'duplicate-member', 'wrong-member', 'extra-field', 'wrong-document', 'null-document', 'private-document'])('rejects malformed or widened %s evidence', async kind => {
    const f = fixture({ intercept: row => {
      if (kind === 'array-classroom') row.classrooms = [row.classrooms]
      if (kind === 'duplicate-member' && row.classrooms.membership) row.classrooms.membership.push(row.classrooms.membership[0])
      if (kind === 'wrong-member' && row.classrooms.membership) row.classrooms.membership[0].student_id = ownerId
      if (kind === 'extra-field') row.private = 'secret'
      if (kind === 'wrong-document' && row.docs) row.docs[0].student_id = ownerId
      if (kind === 'null-document' && row.docs) row.docs = []
      if (kind === 'private-document' && row.docs) row.docs[0].teacher_feedback_draft = 'secret'
      return row
    } })
    await expect(f.read()).rejects.toMatchObject({ statusCode: 503 })
  })
  it.each(['returned_at', 'feedback_returned_at'])('detects withdrawal of %s before response', async field => {
    const f = fixture({ doc: { ...doc, returned_at: stamp, feedback_returned_at: stamp }, intercept: (row, url) => {
      if (url.searchParams.get('select')?.includes('docs:') && !url.searchParams.get('select')?.includes('content,')) row.docs[0][field] = null
      return row
    } })
    await expect(f.read()).rejects.toMatchObject({ statusCode: 503 })
  })
  it('preserves immediate Pal creation delivery before supplementary failure', async () => {
    pal.enabled.mockReturnValue(true)
    const f = fixture({ intercept: (row, _url, index) => index === 3 ? null : row })
    await expect(f.read()).rejects.toMatchObject({ statusCode: 503 })
    expect(pal.delivery).toHaveBeenCalledOnce(); expect(pal.delivery.mock.calls[0][0]).toMatchObject({ membership: { studentId: actorId, classroomId }, event: null })
  })
  it('uses the existing pseudonymous Toronto event for legacy Pal delivery', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-05T02:00:00Z'))
    vi.stubEnv('PAL_PSEUDONYM_SECRET', 'test-pseudonym-secret-with-at-least-thirty-two-characters')
    pal.enabled.mockReturnValue(true); pal.classroom.mockReturnValue(false)
    const f = fixture(); const result = await f.read()
    expect(result.pal_delivery).toBe('delivered')
    expect(f.rpcBodies[0]).toMatchObject({ p_actor_id: actorId, p_assignment_id: assignmentId, p_viewed_at: '2026-10-05T02:00:00.000Z',
      p_pal_event: { event_type: 'learning_item.viewed', occurred_at: '2026-10-05T02:00:00.000Z', metadata: { period_key: 'pika-week-2026-09-28', timing: 'later', kind: 'assignment' } } })
    expect(JSON.stringify(f.rpcBodies[0].p_pal_event)).not.toContain(actorId)
    expect(pal.delivery.mock.calls[0][0].event).toEqual(f.rpcBodies[0].p_pal_event)
  })
  it.each([null, false, [], { classwork: 'false' }, { classwork: null }])('retains default-visible Classwork normalization for %j', async visibility => {
    const f = fixture({ intercept: row => ({ ...row, classrooms: { ...row.classrooms, feature_visibility: visibility } }) })
    expect((await f.read()).assignment.id).toBe(assignmentId)
  })
  it('requires real current membership even when the caller owns some other classroom', async () => {
    const f = fixture({ intercept: (row, _url, index) => index === 1 ? { ...row, classrooms: { ...row.classrooms, membership: [] } } : row })
    await expect(f.read()).rejects.toMatchObject({ statusCode: 403 })
    expect(f.urls[1].searchParams.get('select')).toContain('membership:classroom_enrollments!classroom_enrollments_classroom_id_fkey(')
    expect(f.rpcCalls()).toBe(0)
  })
  it.each([false, true])('preserves view flags without delivering an existing doc (changed=%s)', async changed => {
    pal.enabled.mockReturnValue(true)
    const result = await fixture({ rpcChange: row => ({ ...row, created: false, viewed_at_changed: changed }) }).read()
    expect(result.wasFirstView).toBe(changed); expect(pal.delivery).not.toHaveBeenCalled()
  })
  it('signs only freshly proven exact images with one-hour lifetime and no joined fields', async () => {
    const f = fixture({ requirements: [imageRequirement(0)], artifacts: [imageArtifact(0)] })
    const result = await f.read()
    expect(f.bodies).toEqual([{ paths: [imageArtifact(0).storage_path], expiresIn: 3600 }])
    expect(result.submission_artifacts[0].url).toBe(`http://127.0.0.1:54321/storage/v1/object/sign/assignment-artifacts/${imageArtifact(0).storage_path}?token=test`)
    const signingIndex = f.urls.findIndex(url => url.pathname.includes('/storage/'))
    expect(f.urls[signingIndex - 1].searchParams.get('docs.artifacts.id')).toBe(`in.(${imageArtifact(0).id})`)
  })
  it('uses deterministic batches of at most50 and a current final statement', async () => {
    const f = fixture({ requirements: Array.from({ length: 51 }, (_, n) => imageRequirement(n)), artifacts: Array.from({ length: 51 }, (_, n) => imageArtifact(n)) })
    expect((await f.read()).submission_artifacts).toHaveLength(51); expect(f.bodies.map(body => body.paths.length)).toEqual([50, 1])
    expect(f.urls.at(-1)!.searchParams.get('docs.returned_at')).toBe('is.null')
  })
  it.each(['foreign-doc', 'foreign-requirement', 'wrong-object', 'wrong-subject', 'foreign-path', 'traversal', 'duplicate'])('rejects %s image proof before signing', async kind => {
    const bad = imageArtifact(0)
    if (kind === 'foreign-doc') bad.assignment_doc_id = uuid(7)
    if (kind === 'foreign-requirement') bad.requirement.assignment_id = uuid(7)
    if (kind === 'wrong-object') bad.managed_object!.id = uuid(7)
    if (kind === 'wrong-subject') bad.managed_object!.data_subject_user_id = ownerId
    if (kind === 'foreign-path') { bad.storage_path = 'foreign.png'; bad.managed_object!.storage_path = bad.storage_path }
    if (kind === 'traversal') { bad.storage_path += '/../foreign.png'; bad.managed_object!.storage_path = bad.storage_path }
    const f = fixture({ requirements: [imageRequirement(0)], artifacts: kind === 'duplicate' ? [bad, bad] : [bad] })
    await expect(f.read()).rejects.toMatchObject({ statusCode: 503 }); expect(f.bodies).toHaveLength(0)
  })
  it('accepts exact legacy and restored namespaces', async () => {
    const legacy = imageArtifact(0, `${actorId}/${assignmentId}/${requirement(0).id}-123-${uuid(8)}.png`, false)
    const restored = imageArtifact(0, `restores/${classroomId}/${uuid(8)}/${'a'.repeat(64)}-${'b'.repeat(64)}`)
    for (const image of [legacy, restored]) expect((await fixture({ requirements: [imageRequirement(0)], artifacts: [image] }).read()).submission_artifacts).toHaveLength(1)
  })
  it('rejects a changed signing proof before Storage starts', async () => {
    const f = fixture({ requirements: [imageRequirement(0)], artifacts: [imageArtifact(0)], intercept: (row, url) => {
      if (url.searchParams.get('docs.artifacts.id')?.startsWith('in.')) row.docs[0].artifacts[0].url = 'https://changed.test/'
      return row
    } })
    await expect(f.read()).rejects.toMatchObject({ statusCode: 503 }); expect(f.bodies).toHaveLength(0)
  })
  it('does not start a late signing POST after proof exhausts the statement budget', async () => {
    const f = fixture({ requirements: Array.from({ length: 1014 }, (_, n) => n === 0 ? imageRequirement(n) : requirement(n)), artifacts: [imageArtifact(0)], cap: 1 })
    await expect(f.read()).rejects.toMatchObject({ statusCode: 503 })
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(f.urls).toHaveLength(1024); expect(f.bodies).toHaveLength(0)
    expect(f.urls.at(-1)!.searchParams.get('docs.artifacts.id')).toBe(`in.(${imageArtifact(0).id})`)
  })
  it('does not start a late signing POST when the deadline expires during proof', async () => {
    const started = Date.now(); const clock = vi.spyOn(Date, 'now').mockReturnValue(started)
    const f = fixture({ requirements: [imageRequirement(0)], artifacts: [imageArtifact(0)], intercept: (row, url) => {
      if (url.searchParams.get('docs.artifacts.id')?.startsWith('in.')) clock.mockReturnValue(started + 20001)
      return row
    } })
    await expect(f.read()).rejects.toMatchObject({ statusCode: 503 })
    await new Promise(resolve => setTimeout(resolve, 0)); expect(f.bodies).toHaveLength(0)
  })
  it.each(['network', 'api', 'invalid-json'] as const)('fails closed on signing %s failure without retry', async storageError => {
    const f = fixture({ requirements: [imageRequirement(0)], artifacts: [imageArtifact(0)], storageError })
    await expect(f.read()).rejects.toMatchObject({ statusCode: 503 }); expect(f.bodies).toHaveLength(1)
  })
  it.each(['missing', 'duplicate', 'foreign-path', 'null-url', 'foreign-url', 'extra-param', 'credentials', 'fragment', 'per-path-error', 'extra-field'])('rejects malformed signing %s evidence', async kind => {
    const f = fixture({ requirements: [imageRequirement(0)], artifacts: [imageArtifact(0)], signing: paths => {
      const row: any = { path: paths[0], error: null, signedURL: `/object/sign/assignment-artifacts/${paths[0]}?token=test` }
      if (kind === 'missing') return []
      if (kind === 'duplicate') return [row, row]
      if (kind === 'foreign-path') row.path = 'foreign.png'
      if (kind === 'null-url') row.signedURL = null
      if (kind === 'foreign-url') row.signedURL = 'https://foreign.test/?token=test'
      if (kind === 'extra-param') row.signedURL += '&extra=1'
      if (kind === 'credentials') row.signedURL = 'http://user:pass@127.0.0.1:54321/'
      if (kind === 'fragment') row.signedURL += '#fragment'
      if (kind === 'per-path-error') row.error = 'Private error'
      if (kind === 'extra-field') row.secret = true
      return [row]
    } })
    await expect(f.read()).rejects.toMatchObject({ statusCode: 503 }); expect(f.bodies).toHaveLength(1)
  })
  it('rejects final relationship loss after a signing request with no DTO', async () => {
    const f = fixture({ requirements: [imageRequirement(0)], artifacts: [imageArtifact(0)], intercept: (row, url) => {
      if (url.searchParams.has('docs.returned_at')) row.classrooms.membership = []
      return row
    } })
    await expect(f.read()).rejects.toMatchObject({ statusCode: 503 }); expect(f.bodies).toHaveLength(1)
  })
  it('times out a hung REST statement after20seconds and stops further reads', async () => {
    vi.useFakeTimers()
    const f = fixture({ holdAt: 3 }); const assertion = expect(f.read()).rejects.toMatchObject({ statusCode: 503 })
    await vi.advanceTimersByTimeAsync(20000); await assertion
    expect(f.urls).toHaveLength(4); expect(f.rpcCalls()).toBe(1)
  })
  it('times out an ambiguous RPC without retry or any later operation', async () => {
    vi.useFakeTimers()
    const f = fixture({ holdAt: 2 }); const assertion = expect(f.read()).rejects.toMatchObject({ statusCode: 503 })
    await vi.advanceTimersByTimeAsync(20000); await assertion
    expect(f.urls).toHaveLength(3); expect(f.methods.filter(method => method !== 'GET')).toHaveLength(1)
  })
  it.each(['unvalidated', 'inaccessible'])('preserves current GitHub validation state %s', async validation_status => {
    expect((await fixture({ identity: { ...identity, validation_status } }).read()).github_identity?.validation_status).toBe(validation_status)
  })
  it('binds supplement FK identities to the authenticated actor', async () => {
    await expect(fixture({ identity: { ...identity, user_id: ownerId } }).read()).rejects.toMatchObject({ statusCode: 503 })
    await expect(fixture({ feedback: [{ ...feedback(0), student_id: ownerId }] }).read()).rejects.toMatchObject({ statusCode: 503 })
    await expect(fixture({ requirements: [{ ...requirement(0), assignment_id: uuid(90000) }] }).read()).rejects.toMatchObject({ statusCode: 503 })
  })
  it('rejects collection overflow instead of truncating', async () => {
    const f = fixture({ requirements: Array.from({ length: 10001 }, (_, n) => requirement(n)) })
    await expect(f.read()).rejects.toMatchObject({ statusCode: 503 })
  })
  it('rejects oversized rich resource and response DTO', async () => {
    await expect(fixture({ doc: { ...doc, content: 'a'.repeat(2 * 1024 * 1024) } }).read()).rejects.toMatchObject({ statusCode: 503 })
    const rows = Array.from({ length: 9 }, (_, n) => ({ ...feedback(n), body: 'a'.repeat(1024 * 1024) }))
    await expect(fixture({ feedback: rows, cap: 1 }).read()).rejects.toMatchObject({ statusCode: 503 })
  })
  it('rejects JSON depth and nonfinite recursive data before rendering', async () => {
    let nested: any = {}
    for (let n = 0; n < 101; n++) nested = { child: nested }
    await expect(fixture({ rpcChange: row => ({ ...row, doc: { ...row.doc, content: nested } }) }).read()).rejects.toMatchObject({ statusCode: 503 })
  })
})
