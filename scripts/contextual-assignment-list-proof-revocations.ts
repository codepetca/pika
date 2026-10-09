/** Pure scoped transition plans plus an injected installed-SDK observer. No execution at import. */
import assert from 'node:assert/strict'
import { createClient } from '@supabase/supabase-js'
import { readContextualAssignmentList } from '../src/lib/server/contextual-assignment-list-read'
import { ApiError } from '../src/lib/api-error'
import { containedAssignmentListProofFetch, validateAssignmentListProofTarget } from './check-contextual-assignment-list-reads'
import type { AssignmentListProofFixture } from './contextual-assignment-list-proof-fixture'
import type { Database } from '../src/types/database'

const q = (value: string) => `'${value.replaceAll("'", "''")}'`
type Boundary = 'first' | 'later' | 'terminal' | 'returned-grade' | 'released-feedback'
type Transition = 'owner-transfer' | 'member-remove' | 'archive' | 'visibility' | 'grade-withdraw' | 'feedback-withdraw'
export type AssignmentListRevocationPlan = {
  transition: Transition; boundary: Boundary; actorId: string; classroomId: string; permission: 'owner' | 'member';
  expectedStatus: 403 | 503; revokeSql: string; restoreSql: string; permittedFixtureEffects: string[];
}
// Proof-only metadata, keyed by the original failure; never copy error text,
// request/response bodies, identities or SQL into lifecycle diagnostics.
const failureDiagnostics = new WeakMap<object, string>()
export function assignmentListRevocationDiagnostic(error: unknown): string | undefined {
  return error !== null && typeof error === 'object' ? failureDiagnostics.get(error) : undefined
}
export function assignmentListRevocationPlans(f: AssignmentListProofFixture): AssignmentListRevocationPlan[] {
  const classroom = f.classes[0]; const member = f.manifest.actors[2]; const returned = f.docs.find(d => d.returned)!
  const project = `pika_assignment_list_${f.manifest.syntheticTag.slice(-12)}`
  const wrap = (sql: string) => `begin;set local statement_timeout='15s';set local lock_timeout='4s';
select 1 from private.pal_classroom_signal_settings where singleton for share nowait;
select 1 from private.pal_membership_settings where singleton for share nowait;
select 1 from private.student_provider_cleanup_settings where singleton for share nowait;
do $guard$ begin
  if current_setting('application_name')<>${q(project + '_fixture')}
    or (select tgenabled from pg_trigger where tgrelid='private.pal_membership_generations'::regclass and tgname='guard_pal_membership_evidence' and not tgisinternal) is distinct from 'O'
    or coalesce((select enabled from private.pal_classroom_signal_settings where singleton),true)
    or coalesce((select enabled from private.pal_membership_settings where singleton),true)
    or coalesce((select enabled or live_enabled or automatic_enabled from private.student_provider_cleanup_settings where singleton),true)
    then raise exception 'Isolated transition guard differs';end if;
end;$guard$;
${sql}
commit;`
  const update = (table: 'classrooms' | 'assignment_docs', id: string, set: string, expected: string) => wrap(`do $change$ declare changed integer;begin
  update public.${table} set ${set} where id=${q(id)} and (${expected});
  get diagnostics changed=row_count;if changed<>1 then raise exception 'Scoped transition row mismatch';end if;
end;$change$;`)
  const rootEffects = ['exact target classroom fields and trigger-owned revisions/timestamps']
  const plans: AssignmentListRevocationPlan[] = []
  let generation = f.enrollments.find(e => e.classroom === classroom.id && e.student === member.id)!.id
  for (const [n, boundary] of (['first', 'later', 'terminal'] as const).entries()) {
    const common = { boundary, classroomId: classroom.id, expectedStatus: 403 as const }
    plans.push({ ...common, transition: 'owner-transfer', actorId: classroom.owner, permission: 'owner',
      revokeSql: update('classrooms', classroom.id, `teacher_id=${q(f.manifest.actors[4].id)}`, `teacher_id=${q(classroom.owner)}`),
      restoreSql: update('classrooms', classroom.id, `teacher_id=${q(classroom.owner)}`, `teacher_id=${q(f.manifest.actors[4].id)}`), permittedFixtureEffects: rootEffects })
    const replacement = f.replacementEnrollments[n]
    const old = generation
    plans.push({ ...common, transition: 'member-remove', actorId: member.id, permission: 'member',
      revokeSql: wrap(`do $remove$ declare changed integer;begin
delete from public.classroom_enrollments where id=${q(old)} and classroom_id=${q(classroom.id)} and student_id=${q(member.id)};
get diagnostics changed=row_count;if changed<>1 then raise exception 'Scoped enrollment removal mismatch';end if;end;$remove$;`),
      restoreSql: wrap(`insert into public.classroom_enrollments(id,classroom_id,student_id) values (${q(replacement.id)},${q(classroom.id)},${q(member.id)});
do $generation$ begin
if not exists(select 1 from private.pal_membership_generations where generation_id=${q(old)} and state='removed'
  and scope_digest=private.pal_membership_scope(${q(classroom.id)},${q(member.id)}))
or not exists(select 1 from private.pal_membership_generations where generation_id=${q(replacement.id)} and state='active'
  and scope_digest=private.pal_membership_scope(${q(classroom.id)},${q(member.id)})) then raise exception 'Scoped generation transition differs';end if;end;$generation$;`),
      permittedFixtureEffects: ['exact removed generation active→removed; exact replacement generation active; exact replacement enrollment', ...rootEffects] })
    generation = replacement.id
    plans.push({ ...common, transition: 'archive', actorId: member.id, permission: 'member',
      revokeSql: update('classrooms', classroom.id, `archived_at=${q(f.manifest.now)}`, 'archived_at is null'),
      restoreSql: update('classrooms', classroom.id, 'archived_at=null', `archived_at=${q(f.manifest.now)}`), permittedFixtureEffects: rootEffects })
    plans.push({ ...common, transition: 'visibility', actorId: member.id, permission: 'member',
      revokeSql: update('classrooms', classroom.id, `feature_visibility=jsonb_set(feature_visibility,'{classwork}','false'::jsonb)`, `feature_visibility->'classwork'='true'::jsonb`),
      restoreSql: update('classrooms', classroom.id, `feature_visibility=jsonb_set(feature_visibility,'{classwork}','true'::jsonb)`, `feature_visibility->'classwork'='false'::jsonb`), permittedFixtureEffects: rootEffects })
  }
  plans.push({ transition: 'grade-withdraw', boundary: 'returned-grade', actorId: member.id, classroomId: classroom.id, permission: 'member', expectedStatus: 503,
    revokeSql: update('assignment_docs', returned.id, 'returned_at=null', `assignment_id=${q(returned.assignment)} and student_id=${q(member.id)} and returned_at=${q(f.manifest.now)}`),
    restoreSql: update('assignment_docs', returned.id, `returned_at=${q(f.manifest.now)}`, `assignment_id=${q(returned.assignment)} and student_id=${q(member.id)} and returned_at is null`),
    permittedFixtureEffects: ['exact target document return marker and trigger-owned revisions/timestamps'] })
  plans.push({ transition: 'feedback-withdraw', boundary: 'released-feedback', actorId: member.id, classroomId: classroom.id, permission: 'member', expectedStatus: 503,
    revokeSql: update('assignment_docs', returned.id, 'feedback=null,feedback_returned_at=null', `assignment_id=${q(returned.assignment)} and student_id=${q(member.id)} and feedback_returned_at=${q(f.manifest.now)}`),
    restoreSql: update('assignment_docs', returned.id, `feedback='Synthetic feedback',feedback_returned_at=${q(f.manifest.now)}`, `assignment_id=${q(returned.assignment)} and student_id=${q(member.id)} and feedback_returned_at is null`),
    permittedFixtureEffects: ['exact target document released feedback fields and trigger-owned revisions/timestamps'] })
  return plans
}

/** Execute only inside the separately reviewed isolated root lifecycle. */
export async function observeAssignmentListRevocation(input: {
  fixture: AssignmentListProofFixture; plan: AssignmentListRevocationPlan;
  target: { API_URL: string; DB_URL: string; SERVICE_ROLE_KEY: string };
  originalFetch: typeof fetch;
  // Coordinator supplies exact ephemeral SQL execution and independently checks
  // approved changed-row closure/nontarget equality. Neither is inferred here.
  transition: (sql: string) => Promise<void>;
  verifyRestoration: (plan: AssignmentListRevocationPlan) => Promise<void>;
}) {
  const { fixture, plan } = input
  const project = `pika_assignment_list_${fixture.manifest.syntheticTag.slice(-12)}`
  const target = validateAssignmentListProofTarget(input.target, project)
  const all = fixture.assignments.filter(a => a.classroom === plan.classroomId && (plan.permission === 'owner' || (!a.isDraft && a.releasedAt === null))).map(a => a.id).sort()
  const safeFetch = containedAssignmentListProofFetch(input.originalFetch, project)
  let fired = false; let attempted = false
  const startedAt = Date.now()
  let readSignal: AbortSignal | null | undefined
  let pendingRevocation: Promise<void> | undefined
  let revokeStartedAt: number | undefined; let revokeSettledAt: number | undefined
  let revokeState: 'none' | 'pending' | 'settled' | 'failed' = 'none'
  const client = createClient<Database>(target.API_URL, target.SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false }, global: {
    fetch: async (request, init) => {
      readSignal = init?.signal ?? (request instanceof Request ? request.signal : undefined)
      const url = new URL(request instanceof Request ? request.url : String(request)); const select = url.searchParams.get('select') ?? ''
      assert.equal(url.pathname, '/rest/v1/classrooms'); assert.equal(url.searchParams.get('id'), `eq.${plan.classroomId}`)
      const list = select.includes('assignments:') && select.includes('instructions_markdown')
      const cursor = url.searchParams.getAll('assignments.id').find(v => v.startsWith('gt.'))?.slice(3)
      const boundary = plan.boundary === 'first' ? list && cursor === undefined
        : plan.boundary === 'later' ? list && cursor !== undefined && cursor !== all.at(-1)
        : plan.boundary === 'terminal' ? list && cursor === all.at(-1)
        : plan.boundary === 'returned-grade' ? select.includes('score_completion')
        : select.includes(',feedback)')
      if (!fired && boundary) {
        attempted = true; revokeStartedAt = Date.now(); revokeState = 'pending'
        // Capture even a synchronous throw as a settled rejection. The read's
        // abort race must not let finally restore ahead of this mutation.
        pendingRevocation = Promise.resolve().then(() => input.transition(plan.revokeSql)).then(
          () => { revokeState = 'settled'; revokeSettledAt = Date.now() },
          error => { revokeState = 'failed'; revokeSettledAt = Date.now(); throw error },
        )
        await pendingRevocation; fired = true
      }
      return safeFetch(request, init)
    },
  } })
  try {
    await assert.rejects(() => readContextualAssignmentList({ supabase: client, actorId: plan.actorId, classroomId: plan.classroomId,
      permission: plan.permission, now: new Date(fixture.manifest.now) }), error => error instanceof ApiError && error.statusCode === plan.expectedStatus)
    assert(fired, 'Required live revocation boundary not reached')
  } catch (error) {
    if (error !== null && typeof error === 'object') {
      const elapsed = (from: number, to = Date.now()) => Math.min(900_000, Math.max(0, Math.floor(to - from)))
      failureDiagnostics.set(error, `read_abort=${readSignal?.aborted ? 'yes' : 'no'} revoke=${revokeState} elapsed_ms=${elapsed(startedAt)} transition_ms=${revokeStartedAt === undefined ? 0 : elapsed(revokeStartedAt, revokeSettledAt)}`)
    }
    throw error
  } finally {
    // An ambiguous COMMIT response still causes a scoped restore attempt. Root
    // restoration executor must reconcile exact expected state, never retry a
    // mutation blindly or suppress restoration errors.
    if (attempted) {
      // Join settlement, including an ambiguous failed response, before the
      // exact restore. The original assertion remains failed; this is not a
      // retry or a suppression of restoration/verification errors.
      await pendingRevocation?.catch(() => undefined)
      await input.transition(plan.restoreSql); await input.verifyRestoration(plan)
    }
  }
  return { transition: plan.transition, boundary: plan.boundary, expectedStatus: plan.expectedStatus }
}
