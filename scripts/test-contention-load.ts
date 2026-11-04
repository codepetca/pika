/** Class-sized learner load, exclusively against a separately provisioned disposable clone.
 * See test-contention-load.md. No migrations or container lifecycle operations are performed. */
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { createClient } from '@supabase/supabase-js'
import { createContextualTestLearnerWorkflow, type TestLearnerRpcClient } from '../src/lib/server/contextual-test-learner-workflow'
import { createContextualTestOwnerWorkflow } from '../src/lib/server/contextual-test-owner-workflow'
import { isDeepStrictEqual } from 'node:util'

const docker = (...args: string[]) => {
  const p = spawnSync('docker', args, { encoding: 'utf8', timeout: 15000, maxBuffer: 1024 * 1024 })
  assert.equal(p.status, 0, `docker ${args[0]} failed`)
  return p.stdout
}
type Container = { Id: string; Name: string; Config: { Image: string; Labels: Record<string,string>; Env: string[] }; State: { Running: boolean }; NetworkSettings: { Networks: Record<string,{ Aliases: string[] | null }>; Ports: Record<string,{HostIp:string;HostPort:string}[] | null> } }
export function validateTarget(db: Container, api: Container, owner: string) {
  assert.match(owner, /^[a-f0-9]{32}$/)
  for (const [container, role] of [[db,'db'],[api,'api']] as const) {
    assert.match(container.Id, /^[a-f0-9]{64}$/); assert(container.State.Running)
    assert.equal(container.Config.Labels?.['pika.test-load.owner'], owner)
    assert.equal(container.Config.Labels?.['pika.test-load.role'], role)
    assert(!container.Name.includes('supabase_'), 'Shared Supabase containers are forbidden')
  }
  assert.notEqual(db.Id, api.Id)
  assert.match(api.Config.Image, /^(?:docker\.io\/)?postgrest\/postgrest(?::|@)/)
  assert.deepEqual(api.NetworkSettings.Ports['3000/tcp'], [{HostIp:'127.0.0.1',HostPort:'54331'}])
  assert(!api.Config.Env.some(s => /^PG(?!RST_)[A-Z0-9_]+=/.test(s)), 'PostgREST libpq environment overrides are forbidden')
  const uri = api.Config.Env.filter(s => s.startsWith('PGRST_DB_URI=')); assert.equal(uri.length,1)
  const url = new URL(uri[0].slice('PGRST_DB_URI='.length)); assert(['postgres:', 'postgresql:'].includes(url.protocol)); assert.equal(url.pathname, '/postgres')
  assert.equal(url.search, '', 'PostgREST connection URI query options are forbidden'); assert.equal(url.hash, '', 'PostgREST connection URI fragment is forbidden')
  assert(url.port === '' || url.port === '5432', 'Unexpected PostgREST database port')
  assert(Object.entries(db.NetworkSettings.Networks).some(([network, details]) => {
    const other = api.NetworkSettings.Networks[network]
    return other && [db.Name.replace(/^\//,''), ...(details.Aliases ?? [])].includes(url.hostname)
  }), 'PostgREST does not point to the labeled database on a shared network')
}
const quote = (v: string) => `'${v.replaceAll("'", "''")}'`
function inspect(id: string): Container { const result = JSON.parse(docker('inspect', id)); assert.equal(result.length,1); return result[0] }
export function localPsqlArgs(dbId: string): string[] {
  assert.match(dbId,/^[a-f0-9]{64}$/)
  return ['exec','-i',dbId,'env','-i','PATH=/usr/local/bin:/usr/bin:/bin','psql','-X','-q','-t','-A','-v','ON_ERROR_STOP=1','-h','/var/run/postgresql','-p','5432','-U','postgres','-d','postgres']
}
function sql(dbId: string, command: string): string {
  const p = spawnSync('docker', localPsqlArgs(dbId),
    { input: `set statement_timeout='20s';set lock_timeout='3s';\n${command}\n`, encoding:'utf8', timeout:25000, maxBuffer:1024*1024 })
  if (p.status !== 0) throw new Error(`Disposable database operation failed: ${p.stderr.slice(0,1000)}`)
  return p.stdout.trim()
}
async function main() {
  const [dbId,apiId,owner,countArg] = process.argv.slice(2)
  assert(dbId && apiId && owner && countArg, 'Usage: tsx scripts/test-contention-load.ts DB_CONTAINER API_CONTAINER OWNER_TOKEN LEARNERS')
  const count=Number(countArg); assert(Number.isInteger(count) && count >= 2 && count <= 40)
  const key=process.env.TEST_LOAD_SERVICE_KEY; assert(key, 'TEST_LOAD_SERVICE_KEY required')
  assert.match(dbId,/^[a-f0-9]{64}$/); assert.match(apiId,/^[a-f0-9]{64}$/)
  const verify=()=>{const db=inspect(dbId), api=inspect(apiId);assert.equal(db.Id,dbId);assert.equal(api.Id,apiId);validateTarget(db,api,owner)}
  verify()
  const marker=randomUUID(), teacher=randomUUID(), classroom=randomUUID(), test=randomUUID(), question=randomUUID()
  const learners=Array.from({length:count},()=>randomUUID())
  const ids=[teacher,...learners]; const code=`L${marker.replaceAll('-','').slice(0,7).toUpperCase()}`
  const answers=(i:number)=>({[question]:{question_type:'open_response',response_text:`synthetic-${marker}-${i}`}})
  const rpcErrors = new Map<string, {code:string|null;message:string;status:number;count:number}>()
  const recordRpcError = (code:string|null, message:string, status:number) => {
    const key = JSON.stringify([code,message,status]); const current = rpcErrors.get(key)
    if (current) current.count++; else rpcErrors.set(key,{code,message,status,count:1})
  }
  const diagnosticFetch: typeof fetch = async (input, init) => {
    assert.equal(typeof input, 'string'); const url = new URL(input)
    assert.equal(url.origin, 'http://127.0.0.1:54331'); assert(['/rest/v1/rpc/test_learner_workflow_v1','/rest/v1/rpc/test_owner_workflow_v1'].includes(url.pathname))
    url.pathname = url.pathname.replace('/rest/v1/rpc/', '/rpc/')
    const response = await fetch(url, init)
    if (!response.ok) {
      try {
        const body = await response.clone().json() as {code?:unknown;message?:unknown}
        const code = typeof body.code === 'string' && /^(?:PT[0-9]{3}|PGRST[0-9]{3}|[0-9A-Z]{5})$/.test(body.code) ? body.code : null
        const message = body.message === 'test_learner_busy' || body.message === 'test_owner_busy' || body.message === 'Invalid path specified in request URL' ? body.message : '[redacted]'
        recordRpcError(code,message,response.status)
      } catch { recordRpcError(null,'unparseable response',response.status) }
    }
    return response
  }
  const client=createClient('http://127.0.0.1:54331',key,{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:diagnosticFetch}})
  const phase=async<T>(name:string, operation:(id:string,i:number)=>Promise<T>)=>{
    rpcErrors.clear()
    const start=performance.now()
    const teacherRead=()=>createContextualTestOwnerWorkflow({supabase:client as unknown as Parameters<typeof createContextualTestOwnerWorkflow>[0]['supabase'],actorId:teacher,testId:test}).inspect()
    const [outcomes, ownerResult]=await Promise.all([Promise.allSettled(learners.map(operation)),Promise.allSettled([teacherRead()])])
    const errors=outcomes.filter(x=>x.status==='rejected'), ownerFailed=ownerResult[0].status==='rejected'
    console.log(JSON.stringify({phase:name, total:count, succeeded:count-errors.length, failed:errors.length, ownerRead:ownerFailed?'failed':'passed', rpcErrors:[...rpcErrors.values()], elapsedMs:Math.round(performance.now()-start)}))
    if(errors.length || ownerFailed) throw new Error(`${name} failed; see phase counts above`)
    return outcomes.map(x=>(x as PromiseFulfilledResult<T>).value)
  }
  const flow=(id:string)=>createContextualTestLearnerWorkflow({supabase:client as unknown as TestLearnerRpcClient,actorId:id,testId:test})
  let setupAttempted=false
  try {
    assert.equal(sql(dbId,"select (to_regprocedure('public.test_learner_workflow_v1(uuid,uuid,uuid,text,jsonb,timestamp with time zone)') is not null)::text;"),'true')
    verify(); setupAttempted=true
    sql(dbId,`begin;
insert into public.users(id,email,role) values ${ids.map((id,i)=>`(${quote(id)},${quote(`load-${marker}-${i}@example.invalid`)},${quote(i===0?'teacher':'student')})`).join(',')};
insert into public.classrooms(id,teacher_id,title,class_code) values (${quote(classroom)},${quote(teacher)},'Synthetic load',${quote(code)});
insert into public.classroom_enrollments(classroom_id,student_id) values ${learners.map(id=>`(${quote(classroom)},${quote(id)})`).join(',')};
insert into public.tests(id,classroom_id,title,status,points_possible,created_by) values (${quote(test)},${quote(classroom)},'Synthetic load','draft',1,${quote(teacher)});
insert into public.test_questions(id,test_id,question_type,question_text,options,points,position) values (${quote(question)},${quote(test)},'open_response','Synthetic question','[]',1,0);
update public.tests set status='active' where id=${quote(test)};commit;`)
    const prepared=async()=>phase('inspect',async id=>{const f=flow(id);await f.inspect();return f})
    let flows=await prepared()
    await phase('session',async(_id,i)=>flows[i].run('session'))
    flows=await prepared()
    await phase('detail-double-read',async(_id,i)=>{const first=await flows[i].run('detail');const second=await flows[i].run('detail');assert(isDeepStrictEqual(first,second),'Student detail changed between reads');return second})
    flows=await prepared()
    const starts=await phase('start',async(_id,i)=>flows[i].run('start'))
    flows=await prepared()
    const saves=await phase('save',async(_id,i)=>{const result=await flows[i].run('save',{responses:answers(i),expected_revision:starts[i].attempt.draft_revision,trigger:'autosave',paste_word_count:0,keystroke_count:1});assert(!('conflict' in result));return result})
    flows=await prepared()
    await phase('submit',async(_id,i)=>{const result=await flows[i].run('submit',{responses:answers(i),expected_revision:saves[i].attempt.draft_revision});assert(!('conflict' in result));return result})
    verify()
    const rows=JSON.parse(sql(dbId,`select coalesce(json_agg(json_build_object('student',student_id,'responses',responses,'submitted',is_submitted) order by student_id),'[]'::json) from public.test_attempts where test_id=${quote(test)};`)) as {student:string;responses:unknown;submitted:boolean}[]
    assert.equal(rows.length,count);for(const [i,id] of learners.entries()){const row=rows.find(r=>r.student===id);assert(row?.submitted);assert.deepEqual(row.responses,answers(i))}
    console.log(JSON.stringify({phase:'final-answers',verified:count}))
  } finally {
    if(setupAttempted){verify();sql(dbId,`begin;delete from public.classrooms where id=${quote(classroom)} and teacher_id=${quote(teacher)};delete from public.users where id in (${ids.map(quote).join(',')});commit;`)
      assert.equal(sql(dbId,`select (select count(*) from public.users where id in (${ids.map(quote).join(',')}))+(select count(*) from public.classrooms where id=${quote(classroom)})+(select count(*) from public.tests where id=${quote(test)})+(select count(*) from public.test_attempts where test_id=${quote(test)});`),'0');console.log(JSON.stringify({phase:'cleanup',verified:true}))}
  }
}
if (process.argv[1]?.endsWith('/test-contention-load.ts')) main().catch(error=>{console.error(error);process.exitCode=1})
