import { NextRequest } from 'next/server'
import { describe, it, vi } from 'vitest'
import {
  API, FORCED, NORMAL_PASS, assertContainers, containedFetch, databaseProof,
  demand, newFixture, q, same, validateLaunch, type Actor,
} from '../../../scripts/shared-assignment-write-proof'

// Only authentication selection is replaced. Routes, admission readers, access
// evidence queries, service-client construction and transactional RPCs are real.
const auth = vi.hoisted(() => ({ actor: null as Actor | null }))
vi.mock('@/lib/auth', async importOriginal => {
  const original = await importOriginal<typeof import('@/lib/auth')>()
  return { ...original,
    requireAuth: async () => {
      if (!auth.actor) throw new original.AuthenticationError('Missing local proof actor')
      return auth.actor
    },
    requireRole: async (role: Actor['role']) => {
      if (!auth.actor) throw new original.AuthenticationError('Missing local proof actor')
      if (auth.actor.role !== role) throw new original.AuthorizationError('Local proof role denied')
      return auth.actor
    },
  }
})

const enabled = process.env.PIKA_SHARED_ASSIGNMENT_WRITE_WRAPPER === 'local-status-v1'
const localDescribe = enabled ? describe.sequential : describe.skip
localDescribe('LOCAL ONLY: shared Assignment actual mutation routes → installed RPCs', () => {
  it('proves both owner/member role values and exact synthetic cleanup', async () => {
    const launch = validateLaunch(process.env)
    assertContainers()
    const fixture = newFixture(), db = databaseProof(fixture)
    const baseline = db.prepare()
    const originalFetch = globalThis.fetch, observed: string[] = []
    const originalEnv = { ...process.env }
    const originalError = console.error, originalWarn = console.warn
    let captured: Record<string, unknown> = {}
    let failure: string | undefined
    try {
      process.env.NEXT_PUBLIC_SUPABASE_URL = API
      process.env.SUPABASE_SECRET_KEY = launch.secret
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = launch.publicKey
      process.env.PAL_ENABLED = 'false'
      process.env.PAL_CLASSROOM_ENABLED = 'false'
      process.env.PAL_MEMBERSHIP_IDENTITY_ENABLED = 'false'
      for (const key of Object.keys(process.env)) {
        if (/^PIKA_CLASSROOM_.*ACCESS_ENABLED$/.test(key)) process.env[key] = 'false'
        if (/^PIKA_CLASSROOM_.*ACCESS_PAIRS$/.test(key)) delete process.env[key]
      }
      process.env.PIKA_CLASSROOM_EXPERIENCE_ADMISSION = JSON.stringify({
        version: 1, admittedUserIds: fixture.people.map(p => p.id),
      })
      globalThis.fetch = containedFetch(originalFetch, observed)
      // Route diagnostics must never print synthetic work, credentials or rows.
      console.error = () => undefined
      console.warn = () => undefined
      // Setup is INSIDE try/finally: a lost COMMIT response still attempts exact
      // independent cleanup, including when no generation capture is available.
      db.setup()
      if (launch.mode === 'before-capture') throw new Error(FORCED['before-capture'])
      captured = db.capture()
      demand(Object.keys(captured).length === fixture.enrollments.length, 'Generation capture cardinality differs')
      if (launch.mode === 'after-fixture') throw new Error(FORCED['after-fixture'])

      const routes = {
        create: (await import('@/app/api/teacher/assignments/route')).POST,
        edit: (await import('@/app/api/teacher/assignments/[id]/route')).PATCH,
        release: (await import('@/app/api/teacher/assignments/[id]/release/route')).POST,
        save: (await import('@/app/api/assignment-docs/[id]/route')).PATCH,
        submit: (await import('@/app/api/assignment-docs/[id]/submit/route')).POST,
        unsubmit: (await import('@/app/api/assignment-docs/[id]/unsubmit/route')).POST,
        history: (await import('@/app/api/assignment-docs/[id]/history/route')).GET,
        restore: (await import('@/app/api/assignment-docs/[id]/restore/route')).POST,
        artifact: (await import('@/app/api/assignment-docs/[id]/artifacts/[requirementId]/route')).PUT,
        grade: (await import('@/app/api/teacher/assignments/[id]/grade/route')).POST,
        feedback: (await import('@/app/api/teacher/assignments/[id]/feedback-return/route')).POST,
        return: (await import('@/app/api/teacher/assignments/[id]/return/route')).POST,
        bulk: (await import('@/app/api/teacher/assignments/bulk/route')).POST,
        reorder: (await import('@/app/api/teacher/assignments/reorder/route')).POST,
        resetRepo: (await import('@/app/api/teacher/assignments/[id]/repo-targets/[studentId]/route')).PUT,
      }
      type Handler = typeof routes.save
      async function call(handler: Handler, actor: Actor | null, method: string, path: string,
        body: unknown, params: Record<string, string>, status = 200) {
        auth.actor = actor
        const response = await handler(new NextRequest(`http://localhost${path}`, {
          method, ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }),
        }), { params: Promise.resolve(params) })
        demand(response.status === status, 'Actual route returned an unexpected status (response withheld)')
        return response.json() as Promise<Record<string, any>>
      }
      const content = (text: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] })
      const assignmentIds: string[] = []
      const historyIds: string[] = []
      const due = '2099-10-10T20:00:00.000Z'
      const forbidden = fixture.people[2]
      for (let i = 0; i < fixture.classes.length; i++) {
        const classroom = fixture.classes[i], owner = fixture.people[i], member = fixture.people[1 - i]
        const assignmentPath = '/api/teacher/assignments'
        const created = await call(routes.create, owner, 'POST', assignmentPath, {
          classroom_id: classroom.id, title: `${fixture.tag}_assignment_${i}`, due_at: due,
          instructions_markdown: 'Synthetic write proof.', submission_requirements: [{
            id: fixture.requirementIds[i], type: 'link', label: 'Local format-only evidence', required: false,
            validation_policy_json: { mode: 'format_only' },
          }],
        }, {}, 201)
        const assignmentId = created.assignment?.id
        demand(typeof assignmentId === 'string' && /^[a-f0-9-]{36}$/.test(assignmentId), 'Create response identity missing')
        assignmentIds.push(assignmentId)
        same(created.assignment.classroom_id, classroom.id, 'Create response classroom binding differs')
        same(created.assignment.created_by, owner.id, 'Create response owner binding differs')
        // The unchanged replacement RPC allocates a fresh requirement UUID for
        // new drafts; request IDs are only existing-row update identities.
        const requirement = created.assignment.submission_requirements?.[0]
        demand(typeof requirement?.id === 'string' && requirement.assignment_id === assignmentId
          && requirement.type === 'link', 'Created requirement binding differs')
        const params = { id: assignmentId }, teacherPath = `${assignmentPath}/${assignmentId}`
        const docPath = `/api/assignment-docs/${assignmentId}`
        await call(routes.edit, owner, 'PATCH', teacherPath, { instructions_markdown: 'Edited synthetic instructions.' }, params)
        await call(routes.release, owner, 'POST', `${teacherPath}/release`, {}, params)
        // GET/open admission is deliberately out of scope. Seed an exact
        // preallocated document only after the real create/release handlers.
        db.sql(`insert into public.assignment_docs(id,assignment_id,student_id,content) values
          (${q(fixture.docIds[i])},${q(assignmentId)},${q(member.id)},'{"type":"doc","content":[]}'::jsonb);`)
        const readDoc = () => JSON.parse(db.sql(`select to_jsonb(d) from public.assignment_docs d where id=${q(fixture.docIds[i])};`)) as Record<string, any>
        const work = content(`Synthetic ${fixture.tag} learner ${i}.`)
        const saveBody = { content: work, expected_updated_at: readDoc().updated_at,
          save_session_id: fixture.sessionIds[i], save_sequence: 1, metric_session_id: fixture.sessionIds[i],
          paste_word_count: 0, keystroke_count: 5 }
        const saved = await call(routes.save, member, 'PATCH', docPath, saveBody, params)
        same(saved.doc.student_id, member.id, 'Save response learner binding differs')
        same(saved.doc.content, work, 'Save content differs')
        same(readDoc().save_sequence, 1, 'Stored save sequence differs')
        const beforeReplay = db.fingerprint()
        await call(routes.save, member, 'PATCH', docPath, saveBody, params)
        same(db.fingerprint(), beforeReplay, 'Identical save replay changed database state')
        await call(routes.save, member, 'PATCH', docPath, { ...saveBody, content: content('Same sequence, changed content.') }, params, 409)
        same(db.fingerprint(), beforeReplay, 'Rejected save replay changed database state')
        await call(routes.artifact, member, 'PUT', `${docPath}/artifacts/${requirement.id}`,
          { url: 'https://example.invalid/synthetic-format-only' }, { ...params, requirementId: requirement.id })
        const submit = () => call(routes.submit, member, 'POST', `${docPath}/submit`, {
          content: work, expected_updated_at: readDoc().updated_at, allow_missing_attachments: false, acknowledged_missing_attachment_ids: [],
        }, params)
        same((await submit()).doc.is_submitted, true, 'Submission state differs')
        same((await call(routes.unsubmit, member, 'POST', `${docPath}/unsubmit`, undefined, params)).doc.is_submitted, false, 'Unsubmission state differs')
        const history = await call(routes.history, member, 'GET', `${docPath}/history`, undefined, params)
        demand(history.docId === fixture.docIds[i] && Array.isArray(history.history) && history.history.length > 0
          && history.history.every((row: Record<string, unknown>) => row.assignment_doc_id === fixture.docIds[i]), 'History document binding differs')
        historyIds.push(history.history[0].id)
        await call(routes.restore, member, 'POST', `${docPath}/restore`, { history_id: history.history[0].id }, params)
        await call(routes.restore, member, 'POST', `${docPath}/restore`, { history_id: i === 1 ? historyIds[0] : fixture.docIds[1] }, params, 404)
        await submit()
        const grade = { student_id: member.id, expected_doc_updated_at: readDoc().updated_at,
          score_completion: 8, score_thinking: 7, score_workflow: 9, feedback: 'Synthetic manual feedback.', apply_target: 'grade-and-comments' }
        const graded = await call(routes.grade, owner, 'POST', `${teacherPath}/grade`, grade, params)
        same(graded.doc.student_id, member.id, 'Manual grading learner binding differs')
        same(readDoc().score_completion, 8, 'Stored manual grade differs')
        await call(routes.feedback, owner, 'POST', `${teacherPath}/feedback-return`, {
          student_id: member.id, feedback: 'Synthetic returned comments.', expected_doc_updated_at: readDoc().updated_at,
        }, params)
        const returned = await call(routes.return, owner, 'POST', `${teacherPath}/return`, { student_ids: [member.id] }, params)
        same(returned.returned_student_ids, [member.id], 'Return recipient binding differs')
        demand(Boolean(readDoc().returned_at), 'Stored return revision missing')
        await call(routes.unsubmit, member, 'POST', `${docPath}/unsubmit`, undefined, params, 409)
        await call(routes.resetRepo, owner, 'PUT', `${teacherPath}/repo-targets/${member.id}`,
          { selection_mode: 'auto', selected_repo_url: '', override_github_username: '' }, { ...params, studentId: member.id })
        // Every denial checks whole-row equality, so a response alone is not proof.
        const denied = async (fn: () => Promise<unknown>) => {
          const before = db.fingerprint();await fn();same(db.fingerprint(), before, 'Denied route changed database state')
        }
        await denied(() => call(routes.grade, forbidden, 'POST', `${teacherPath}/grade`, grade, params, 403))
        await denied(() => call(routes.grade, owner, 'POST', `${teacherPath}/grade`, { ...grade, student_id: forbidden.id }, params, 400))
        await denied(async () => {
          const excluded = await call(routes.return, owner, 'POST', `${teacherPath}/return`, { student_ids: [forbidden.id] }, params)
          same(excluded.not_enrolled_student_ids, [forbidden.id], 'Foreign return target was not classified as unenrolled')
          same(excluded.returned_count, 0, 'Foreign return target was mutated')
        })
        await denied(() => call(routes.save, forbidden, 'PATCH', docPath, { content: work }, params, 403))
        await denied(() => call(routes.save, member, 'PATCH', `/api/assignment-docs/${fixture.docIds[i]}`,
          { content: work }, { id: fixture.docIds[i] }, 404)) // A doc ID cannot substitute for its Assignment parent.
        await denied(() => call(routes.edit, member, 'PATCH', teacherPath, { title: 'Forbidden member mutation' }, params, 403))
        if (i === 1) {
          await denied(() => call(routes.save, owner, 'PATCH', docPath, { content: work }, params, 403))
          await denied(() => call(routes.submit, owner, 'POST', `${docPath}/submit`, {
            content: work, expected_updated_at: readDoc().updated_at,
          }, params, 403)) // Owner precedence despite historical self enrollment.
        }
        db.sql(`update public.classrooms set archived_at=clock_timestamp() where id=${q(classroom.id)};`)
        await denied(() => call(routes.edit, owner, 'PATCH', teacherPath, { instructions_markdown: 'Archived write' }, params, 403))
        await denied(() => call(routes.unsubmit, member, 'POST', `${docPath}/unsubmit`, undefined, params, 404))
        // Both preallocated owners have setup-only creation capacity; the
        // outsider deliberately remains Free and is never granted a plan.
        db.sql(`update public.classrooms set archived_at=null,teacher_id=${q(member.id)} where id=${q(classroom.id)};`)
        await denied(() => call(routes.grade, owner, 'POST', `${teacherPath}/grade`, grade, params, 403))
        db.sql(`update public.classrooms set teacher_id=${q(owner.id)} where id=${q(classroom.id)};`)
      }
      const owner = fixture.people[1], member = fixture.people[0], classroom = fixture.classes[1]
      const assignmentId = assignmentIds[1], params = { id: assignmentId }
      const bulkBody = { classroom_id: classroom.id, assignments: [{ id: assignmentId,
        title: `${fixture.tag}_assignment_1`, due_at: due, instructions: 'Bulk updated synthetic instructions.', is_draft: false, position: 0 }] }
      await call(routes.bulk, owner, 'POST', '/api/teacher/assignments/bulk', bulkBody, {})
      await call(routes.reorder, owner, 'POST', '/api/teacher/assignments/reorder', { classroom_id: classroom.id, assignment_ids: [assignmentId] }, {})
      const crossClassBefore = db.fingerprint()
      await call(routes.bulk, owner, 'POST', '/api/teacher/assignments/bulk', { ...bulkBody, assignments: [{ ...bulkBody.assignments[0], id: assignmentIds[0] }] }, {}, 400)
      await call(routes.reorder, owner, 'POST', '/api/teacher/assignments/reorder', { classroom_id: classroom.id, assignment_ids: [assignmentIds[0]] }, {}, 400)
      same(db.fingerprint(), crossClassBefore, 'Cross-class resource rejection changed database state')
      db.sql(`delete from public.classroom_enrollments where id=${q(fixture.enrollments[1].id)} and classroom_id=${q(classroom.id)} and student_id=${q(member.id)};`)
      const removedBefore = db.fingerprint()
      await call(routes.history, member, 'GET', `/api/assignment-docs/${assignmentId}/history`, undefined, params, 403)
      await call(routes.unsubmit, member, 'POST', `/api/assignment-docs/${assignmentId}/unsubmit`, undefined, params, 403)
      same(db.fingerprint(), removedBefore, 'Removed membership rejection changed database state')
      // Malformed shared config must fail after authentication and before params,
      // body, SDK discovery or legacy fallback. No current GET/open is invoked.
      process.env.PIKA_CLASSROOM_EXPERIENCE_ADMISSION = '{'
      auth.actor = owner
      const pathBefore = observed.length
      const forbiddenParams = { then() { throw new Error('Shared config consumed forbidden params') } }
      const configResponse = await routes.edit(new NextRequest('http://localhost/api/teacher/assignments/ignored', { method: 'PATCH', body: '{' }),
        { params: forbiddenParams as unknown as Promise<Record<string, string>> })
      demand(configResponse.status === 503 && observed.length === pathBefore, 'Malformed shared admission ordering differs')
      auth.actor = null
      const authResponse = await routes.edit(new NextRequest('http://localhost/api/teacher/assignments/ignored', { method: 'PATCH', body: '{' }),
        { params: forbiddenParams as unknown as Promise<Record<string, string>> })
      demand(authResponse.status === 401 && observed.length === pathBefore, 'Authentication did not precede malformed shared admission')
      for (const rpc of ['create_assignment_for_owner_v1', 'update_assignment_for_owner_v1', 'release_assignment_for_owner_v1',
        'save_assignment_doc_for_member_v1', 'submit_assignment_doc_for_member_v1', 'unsubmit_assignment_doc_for_member_v1',
        'get_assignment_doc_history_for_actor_v1', 'restore_assignment_doc_for_member_v1', 'save_assignment_grades_for_owner_v1',
        'prepare_assignment_artifact_for_member_v1', 'upsert_assignment_artifact_for_member_v1',
        'return_assignment_feedback_for_owner_v1', 'return_assignment_docs_for_owner_v1', 'save_assignments_bulk_for_owner_v1',
        'reorder_assignments_for_owner_v1', 'save_assignment_repo_target_for_owner_v1']) {
        demand(observed.includes(`/rest/v1/rpc/${rpc}`), 'Required real contextual RPC was not observed')
      }
      demand(!observed.some(path => /open_assignment_doc|grading.*usage|entitlement/.test(path)), 'Unexpected open or paid-enforcement SDK evidence')
      demand(Object.entries(process.env).every(([key, value]) => !/^PIKA_CLASSROOM_.*ACCESS_ENABLED$/.test(key) || value === 'false'), 'Old pair gate unexpectedly enabled')
      process.stdout.write(`${NORMAL_PASS}\n`)
    } catch (error) {
      failure = error instanceof Error && Object.values(FORCED).some(value => value === error.message)
        ? error.message : 'FAIL shared-assignment proof (captured data withheld)'
    } finally {
      try { await db.cleanup(baseline, captured) }
      catch { failure = 'FAIL shared-assignment cleanup (captured data withheld)' }
      globalThis.fetch = originalFetch
      console.error = originalError;console.warn = originalWarn
      for (const key of Object.keys(process.env)) if (!(key in originalEnv)) delete process.env[key]
      Object.assign(process.env, originalEnv)
      auth.actor = null
    }
    if (failure) { process.stdout.write(`${failure}\n`);throw new Error(failure) }
  }, 480_000)
})
