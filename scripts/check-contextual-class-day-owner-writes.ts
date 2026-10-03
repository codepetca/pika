// Root-run local SDK proof for already-installed152; no migrations or rollout changes.
// Serialized SQL/trigger/lock races remain in the existing calendar harnesses.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { ApiError } from '../src/lib/api-error'
import { getServiceRoleClient } from '../src/lib/supabase'
import { getTodayInToronto } from '../src/lib/timezone'
import { createContextualClassDayCalendar, setContextualClassDay,
  type ContextualClassDayMutationClient } from '../src/lib/server/contextual-class-day-mutation'
import { createClassroomCalendarSchema, setClassroomCalendarDaySchema, classroomCalendarRowsSchema,
  type CreateClassroomCalendarInput } from '../src/lib/validations/classroom-calendar'

const container = 'supabase_db_pika'
const tag = `calwrite_${randomUUID().slice(0, 8)}`
const owner = randomUUID(), teacher = randomUUID(), member = randomUUID(), outsider = randomUUID()
const classroom = randomUUID(), otherClassroom = randomUUID()
const people = [[owner, 'owner', 'student'], [teacher, 'teacher', 'teacher'], [member, 'member', 'teacher'],
  [outsider, 'outsider', 'student']] as const
const classes = [[classroom, owner, 'primary', 'p'], [otherClassroom, teacher, 'other', 'o']] as const
const grants = [owner, teacher].map(subject => ({ subject, operation: randomUUID() }))
const q = (value: string) => `'${value.replaceAll("'", "''")}'`
const ids = (values: readonly string[]) => values.map(q).join(',')
const email = (label: string) => `${tag}_${label}@example.invalid`
const personIds = people.map(([id]) => id), classIds = classes.map(([id]) => id)
const peopleValues = people.map(([id, label]) => `(${q(id)}::uuid,${q(email(label))})`).join(',')
const grantValues = grants.map(({ subject, operation }) => `(${q(operation)}::uuid,${q(subject)}::uuid)`).join(',')
const tables = ['users', 'classrooms', 'class_days', 'classroom_enrollments', 'classroom_archive_revisions',
  'account_plans', 'account_plan_audit', 'effective_feature_entitlements', 'effective_feature_entitlement_audit'] as const
function command(binary: string, args: string[], input?: string) {
  try { return execFileSync(binary, args, { input, encoding: 'utf8', stdio: ['pipe','pipe','pipe'],
    timeout: 35_000, maxBuffer: 5_000_000 }).trim() }
  catch { throw new Error('Local calendar proof command failed; captured output withheld') }
}
function sql(statement: string) {
  return command('docker', ['exec','-i',container,'psql','-U','postgres','-d','postgres','-XqAt','-v','ON_ERROR_STOP=1'],
    `set statement_timeout='25s'; set lock_timeout='5s'; ${statement}`)
}
const baseline = (): unknown => JSON.parse(sql(`select jsonb_build_object(${tables.map(table => `${q(table)},(select count(*) from public.${table})`).join(',')});`))
const enrollmentState = () => sql(`select coalesce(jsonb_agg(to_jsonb(e) order by id),'[]') from public.classroom_enrollments e where classroom_id in (${ids(classIds)});`)
const snapshot = (): unknown => JSON.parse(sql(`select jsonb_build_object(
  'classes',(select jsonb_agg(to_jsonb(c) order by id) from public.classrooms c where id in (${ids(classIds)})),
  'days',(select coalesce(jsonb_agg(to_jsonb(d) order by id),'[]') from public.class_days d where classroom_id in (${ids(classIds)})),
  'revisions',(select jsonb_agg(to_jsonb(r) order by classroom_id) from public.classroom_archive_revisions r where classroom_id in (${ids(classIds)})));`))
const calendarState = (): unknown => JSON.parse(sql(`select jsonb_build_object(
  'classes',(select jsonb_agg(to_jsonb(c) order by id) from public.classrooms c where id in (${ids(classIds)})),
  'days',(select coalesce(jsonb_agg(to_jsonb(d) order by id),'[]') from public.class_days d where classroom_id in (${ids(classIds)})));`))
const archiveRevision = (target: string) => Number(sql(`select revision from public.classroom_archive_revisions where classroom_id=${q(target)};`))
const apiStatus = (statusCode: number) => (error: unknown) => error instanceof ApiError && error.statusCode === statusCode
const shiftDate = (date: string, offset: number) => new Date(Date.parse(`${date}T12:00:00Z`) + offset * 86_400_000).toISOString().slice(0, 10)
function futureMonday(today: string) {
  let date = shiftDate(today, 14)
  while (new Date(`${date}T12:00:00Z`).getUTCDay() !== 1) date = shiftDate(date, 1)
  return date
}
function storedDay(date: string, target = classroom) {
  return classroomCalendarRowsSchema.parse(JSON.parse(sql(`select coalesce(jsonb_agg(to_jsonb(d)),'[]') from public.class_days d
    where classroom_id=${q(target)} and date=${q(date)};`)))[0]
}
async function main() {
  assert.equal(command('docker', ['inspect',container,'--format','{{ index .Config.Labels "com.supabase.cli.project" }}']), 'pika')
  assert.match(command('docker', ['port',container,'5432/tcp']), /:54322\s*$/m)
  let rawStatus: unknown
  try { rawStatus = JSON.parse(command('supabase',['status','-o','json'])) } catch { throw new Error('Local calendar proof status unavailable') }
  const status = z.object({ API_URL: z.literal('http://127.0.0.1:54321'), ANON_KEY: z.string().min(1), SERVICE_ROLE_KEY: z.string().min(1) }).safeParse(rawStatus)
  if (!status.success) throw new Error('Local calendar proof target guard failed')
  process.env.NEXT_PUBLIC_SUPABASE_URL = status.data.API_URL
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = status.data.ANON_KEY
  process.env.SUPABASE_SECRET_KEY = status.data.SERVICE_ROLE_KEY
  const supabase: ContextualClassDayMutationClient = getServiceRoleClient()
  assert.equal(sql("select exists(select 1 from supabase_migrations.schema_migrations where version='152');"), 't', 'Installed152 required; proof never applies migrations')
  const initialBaseline = baseline()
  const today = getTodayInToronto(), start = futureMonday(today), end = shiftDate(start, 4)
  const input = createClassroomCalendarSchema.parse({ start_date: start, end_date: end })
  const toggle = (date = start, is_class_day = false, actorId = owner, classroomId = classroom,
    client: ContextualClassDayMutationClient = supabase) => setContextualClassDay({ supabase: client, actorId, classroomId,
      input: setClassroomCalendarDaySchema.parse({ date, is_class_day }) })
  const create = (actorId = owner, classroomId = classroom, calendar: CreateClassroomCalendarInput = input) =>
    createContextualClassDayCalendar({ supabase, actorId, classroomId, input: calendar })
  try {
    sql(`begin;
      insert into public.users(id,email,role) values ${people.map(([id,label,role]) => `(${q(id)},${q(email(label))},${q(role)})`).join(',')};
      set local role service_role;
      select public.set_effective_feature_entitlement_v1(operation,u,'classrooms.create','manual',true,clock_timestamp(),null,3,
        'test:calendar-sdk',${q(tag)},coalesce((select revision from public.effective_feature_entitlements where subject_user_id=u and feature_key='classrooms.create'),0))
        from (values ${grantValues}) fixture(operation,u);
      reset role;
      insert into public.classrooms(id,teacher_id,title,class_code) values ${classes.map(([id,actor,label,suffix]) => `(${q(id)},${q(actor)},${q(`${tag} ${label}`)},${q(`${tag}_${suffix}`)})`).join(',')};
      insert into public.classroom_enrollments(classroom_id,student_id) values(${q(classroom)},${q(member)});
      commit;`)
    if (process.argv.includes('--verify-cleanup-after-fixture')) throw new Error('Forced calendar post-fixture cleanup proof')
    const initialEnrollments = enrollmentState()
    for (const [actor, target] of [[owner,classroom],[teacher,otherClassroom]]) {
      const result = await create(actor,target)
      assert.equal(result.success,true); assert.equal(result.count,5); assert.equal(result.class_days.length,5)
      assert.deepEqual(result.class_days.map(day => day.date).sort(), Array.from({ length: 5 }, (_, index) => shiftDate(start,index)))
      for (const day of result.class_days) {
        assert.equal(day.classroom_id,target); assert.equal(day.is_class_day,true); assert.equal(day.prompt_text,null)
        assert.deepEqual(Object.keys(day).sort(), ['id','classroom_id','date','is_class_day','prompt_text'].sort())
      }
      assert.equal(sql(`select start_date=${q(start)}::date and end_date=${q(end)}::date from public.classrooms where id=${q(target)};`),'t')
      const before = snapshot()
      await assert.rejects(create(actor,target),apiStatus(409)); assert.deepEqual(snapshot(),before)
    }
    assert.equal((await toggle(start,false,teacher,otherClassroom)).class_day.is_class_day,false)
    for (const actor of [member,outsider]) {
      const before = snapshot()
      await assert.rejects(create(actor),apiStatus(403)); await assert.rejects(toggle(start,false,actor),apiStatus(403))
      assert.deepEqual(snapshot(),before)
    }
    const missing = randomUUID()
    await assert.rejects(create(owner,missing),apiStatus(404)); await assert.rejects(toggle(start,false,owner,missing),apiStatus(404))
    sql(`update public.classrooms set archived_at=clock_timestamp() where id=${q(classroom)};`)
    const archived = snapshot()
    await assert.rejects(create(),apiStatus(403)); await assert.rejects(toggle(),apiStatus(403)); assert.deepEqual(snapshot(),archived)
    sql(`update public.classrooms set archived_at=null,teacher_id=${q(teacher)} where id=${q(classroom)};`)
    const transferred = snapshot()
    await assert.rejects(create(),apiStatus(403)); await assert.rejects(toggle(),apiStatus(403)); assert.deepEqual(snapshot(),transferred)
    assert.equal((await toggle(start,false,teacher)).class_day.is_class_day,false)
    sql(`update public.classrooms set teacher_id=${q(owner)} where id=${q(classroom)};`)

    sql(`update public.class_days set prompt_text='Synthetic prompt preserved' where classroom_id=${q(classroom)} and date=${q(start)};`)
    const changed = await toggle(start,true)
    assert.equal(changed.class_day.prompt_text,'Synthetic prompt preserved')
    const ctid = sql(`select ctid::text from public.class_days where id=${q(changed.class_day.id)};`)
    const beforeIdentical = calendarState()
    const beforeRevision = archiveRevision(classroom), beforeOtherRevision = archiveRevision(otherClassroom)
    const repeated = await toggle(start,true)
    assert.deepEqual(repeated,changed)
    assert.equal(sql(`select ctid::text from public.class_days where id=${q(changed.class_day.id)};`),ctid)
    assert.deepEqual(calendarState(),beforeIdentical)
    // Installed082/095 BEFORE INSERT triggers run even when152's conflict branch
    // does not update an identical row. Row/CTID idempotency is not revision idempotency.
    assert.equal(archiveRevision(classroom),beforeRevision+1)
    assert.equal(archiveRevision(otherClassroom),beforeOtherRevision)
    assert.equal((await toggle()).class_day.is_class_day,false)
    const newDay = shiftDate(end,3)
    assert.equal((await toggle(newDay,false)).class_day.is_class_day,false)
    const beforePast = snapshot(), past = shiftDate(today,-1)
    await assert.rejects(toggle(past,true),apiStatus(400)); assert.deepEqual(snapshot(),beforePast)
    assert.equal(sql(`select count(*) from public.class_days where classroom_id=${q(classroom)} and date=${q(past)};`),'0')
    const beforeInvalid = snapshot()
    for (const bad of [{ date:start,is_class_day:'false' },{ date:'2026-02-30',is_class_day:false },{ date:start }]) {
      assert.equal(setClassroomCalendarDaySchema.safeParse(bad).success,false)
    }
    for (const bad of [{ start_date:start,end_date:start },{ start_date:start,end_date:shiftDate(start,367) },{ start_date:'bad',end_date:end }]) {
      assert.equal(createClassroomCalendarSchema.safeParse(bad).success,false)
    }
    // Exact maximum range is accepted by the named boundary, not a caller-supplied date array.
    assert.deepEqual(createClassroomCalendarSchema.parse({ start_date:start,end_date:shiftDate(start,366) }),
      { start_date:start,end_date:shiftDate(start,366) })
    const excessive = await supabase.rpc('create_classroom_calendar_v1',{ p_actor_id:owner,p_classroom_id:classroom,
      p_start_date:start,p_end_date:shiftDate(start,366),p_dates:Array.from({ length:368 },(_, index) => shiftDate(start,index)) })
    assert.equal(excessive.status,400); assert.equal(excessive.error?.code,'22023')
    assert.deepEqual(snapshot(),beforeInvalid)
    process.stdout.write('PASS actual calendar SDK owners/member denial, exact weekday projection, bounds, Toronto dates and identical toggle preservation\n')

    // Each facade first performs the REAL installed RPC, then changes only its HTTP
    // response. A generic503 here is uncertain postcommit transport, not rollback.
    const originalFetch = globalThis.fetch
    for (const fault of ['foreign','duplicate','null','malformed-row','object-envelope'] as const) {
      await toggle(start,true)
      let rpcCalls=0
      const facade: typeof fetch = async (request,init) => {
        const url = new URL(typeof request === 'string' ? request : request instanceof URL ? request.href : request.url)
        assert.equal(url.origin,status.data.API_URL)
        assert.equal(url.pathname,'/rest/v1/rpc/set_classroom_calendar_day_v1')
        rpcCalls++
        const response = await originalFetch(request,init)
        assert.equal(response.status,200)
        const days = classroomCalendarRowsSchema.parse(await response.json())
        assert.equal(days.length,1); assert.equal(days[0].is_class_day,false)
        const payload: unknown = fault === 'foreign' ? [{ ...days[0],classroom_id:otherClassroom }]
          : fault === 'duplicate' ? [days[0],days[0]] : fault === 'null' ? null
            : fault === 'malformed-row' ? [{ ...days[0],is_class_day:'false' }]
              : { data:days,error:null }
        const headers = new Headers(response.headers); headers.delete('content-length')
        return new Response(JSON.stringify(payload),{ status:response.status,statusText:response.statusText,headers })
      }
      const facadeClient: ContextualClassDayMutationClient = getServiceRoleClient({ fetch:facade })
      await assert.rejects(toggle(start,false,owner,classroom,facadeClient),apiStatus(503))
      assert.equal(rpcCalls,1,'No retry or legacy fallback after uncertain transport')
      assert.equal(storedDay(start).is_class_day,false,'The real RPC committed before the response was substituted')
      assert.equal(storedDay(start).prompt_text,'Synthetic prompt preserved')
    }
    assert.equal(enrollmentState(),initialEnrollments)
    process.stdout.write('PASS installed calendar SDK malformed-response503 with committed database value and exactly one RPC; no rollback claim\n')
  } finally {
    // All child commands above are synchronous and bounded; no SQL sessions remain open.
    sql(`begin;
      create temp table calendar_write_provision_ops(operation_id uuid,subject_user_id uuid,primary key(operation_id,subject_user_id)) on commit drop;
      insert into calendar_write_provision_ops select distinct a.operation_id,a.subject_user_id from public.account_plan_audit a
        join (values ${peopleValues}) identity(id,email) on identity.id=a.subject_user_id
        join public.users u on u.id=identity.id and u.email=identity.email
        where a.actor_ref='system:user-provisioning' and a.reason_code='default_free_account_provisioning';
      delete from public.effective_feature_entitlement_audit a using (values ${grantValues}) fixture(operation,u)
        where a.operation_id=fixture.operation and a.subject_user_id=fixture.u and a.actor_ref='test:calendar-sdk' and a.reason_code=${q(tag)};
      delete from public.effective_feature_entitlement_audit a using calendar_write_provision_ops operation
        where a.operation_id=operation.operation_id and a.subject_user_id=operation.subject_user_id
          and a.actor_ref='system:user-provisioning' and a.reason_code='default_free_account_provisioning';
      delete from public.account_plan_audit a using calendar_write_provision_ops operation
        where a.operation_id=operation.operation_id and a.subject_user_id=operation.subject_user_id
          and a.actor_ref='system:user-provisioning' and a.reason_code='default_free_account_provisioning';
      delete from public.classrooms c using (values ${classes.map(([id,,label,suffix]) => `(${q(id)}::uuid,${q(`${tag} ${label}`)},${q(`${tag}_${suffix}`)})`).join(',')}) fixture(id,title,class_code)
        where c.id=fixture.id and c.title=fixture.title and c.class_code=fixture.class_code and c.teacher_id in (${ids([owner,teacher])});
      delete from public.users u using (values ${peopleValues}) identity(id,email) where u.id=identity.id and u.email=identity.email;
      commit;`)
    assert.equal(sql(`select (select count(*) from public.users where id in (${ids(personIds)}))+
      (select count(*) from public.classrooms where id in (${ids(classIds)}))+
      ${tables.filter(table => !['users','classrooms'].includes(table)).map(table => {
        const key = ['account_plans','account_plan_audit','effective_feature_entitlements','effective_feature_entitlement_audit'].includes(table) ? 'subject_user_id' : 'classroom_id'
        return `(select count(*) from public.${table} where ${key} in (${ids(key === 'subject_user_id' ? personIds : classIds)}))`
      }).join('+')};`),'0')
    assert.deepEqual(baseline(),initialBaseline)
    process.stdout.write('PASS exact synthetic calendar owner-write cleanup, zero residual rows and global baseline counts\n')
  }
}
main().catch((error: unknown) => {
  const diagnostic = error instanceof ApiError ? `api-status=${error.statusCode}`
    : error instanceof z.ZodError ? `schema=${error.issues.map(issue => `${issue.code}:${issue.path.join('.')}`).join(',')}`
      : error instanceof assert.AssertionError ? `assertion=${error.operator};actual-type=${typeof error.actual};expected-type=${typeof error.expected}`
        : 'unexpected failure'
  const location = error instanceof Error
    ? error.stack?.split('\n').find(line => line.includes('scripts/check-contextual-class-day-owner-writes.ts:'))?.match(/:(\d+):(\d+)/)?.slice(1).join(':')
    : undefined
  process.stderr.write(error instanceof Error && error.message === 'Forced calendar post-fixture cleanup proof'
    ? 'FAIL Forced calendar post-fixture cleanup proof (expected for --verify-cleanup-after-fixture)\n'
    : `FAIL local calendar owner-write proof (${diagnostic}; line=${location ?? 'unknown'}; captured status and command output withheld)\n`)
  process.exitCode=1
})
