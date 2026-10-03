// Root-run local synthetic SDK proof only. No migration/provider/Storage calls.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { z } from 'zod'
import { ApiError } from '../src/lib/api-error'
import { readContextualCourseGuide } from '../src/lib/server/contextual-course-guide-read'
import { isAssignmentVisibleToStudents } from '../src/lib/assignments'
import { normalizeActualCourseSiteConfig } from '../src/lib/course-site-publishing'
import { toCourseGuideVisibility } from '../src/lib/course-guide'
import type { Database } from '../src/types/database'

type WireRow = Record<string, unknown>
type Stage = 'preflight' | 'enrollment' | 'control' | 'header' | 'final' | `assignments:${number}` | `tests:${number}`
const container = 'supabase_db_pika'
const tag = `guideread_${randomUUID().replaceAll('-', '').slice(0, 12)}`
const people = [['owner_student','student'],['owner_teacher','teacher'],['member_student','student'],
  ['member_teacher','teacher'],['outsider','teacher']].map(([label,role]) => ({label,role,id:randomUUID(),email:`${tag}_${label}@example.invalid`}))
function person(label: string) { const p=people.find(p=>p.label===label); assert(p); return p.id }
const ownerStudent=person('owner_student'), ownerTeacher=person('owner_teacher')
const memberStudent=person('member_student'), memberTeacher=person('member_teacher'), outsider=person('outsider')
const classA=randomUUID(), classB=randomUUID(), classC=randomUUID(), resource=randomUUID()
const classes=[{id:classA,owner:ownerStudent,label:'A'},{id:classB,owner:ownerTeacher,label:'B'},{id:classC,owner:ownerTeacher,label:'C'}]
const baseEnrollments=[[classA,ownerStudent],[classA,memberStudent],[classA,memberTeacher],
  [classB,ownerTeacher],[classB,memberStudent],[classB,memberTeacher],[classC,memberStudent]]
  .map(([classroom,student])=>({id:randomUUID(),classroom,student}))
// Every removal-race replacement uses a new preallocated168 generation UUID.
// Historical generations are never reactivated or reused.
const replacementEnrollments=Array.from({length:8},()=>({id:randomUUID(),classroom:classA,student:memberTeacher}))
const enrollments=[...baseEnrollments,...replacementEnrollments]
const grants=[ownerStudent,ownerTeacher].map(subject=>({subject,operation:randomUUID()}))
const now=new Date(), releaseExclusive=new Date(now.getTime()+1).toISOString()
const withinMillisecond=now.toISOString().replace('Z','999Z')
const nextMillisecond=releaseExclusive.replace('Z','001Z')
const assignmentRows=Array.from({length:1005},(_,i)=>({id:randomUUID(),title:i===0?'':i%7===0?'Duplicate assignment':`Assignment ${i}`,
  position:Math.floor(i/3)-4,is_draft:false,released_at:null as string|null}))
assignmentRows.push({id:randomUUID(),title:'Within captured millisecond',position:-6,is_draft:false,released_at:withinMillisecond},
  {id:randomUUID(),title:'Exact captured millisecond',position:-6,is_draft:false,released_at:now.toISOString()},
  {id:randomUUID(),title:'Next millisecond denied',position:-6,is_draft:false,released_at:nextMillisecond},
  {id:randomUUID(),title:'Draft denied',position:-6,is_draft:true,released_at:null})
const testRows=Array.from({length:1005},(_,i)=>({id:randomUUID(),title:i===0?'':i%7===0?'Duplicate test':`Test ${i}`,
  position:Math.floor(i/3)-4,status:i%2===0?'active':'closed'}))
testRows.push({id:randomUUID(),title:'Draft test denied',position:-6,status:'draft'})
const content={type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'Exact synthetic course resources'}]}]}
const q=(value:string)=>`'${value.replaceAll("'","''")}'`
const ids=(values:readonly string[])=>values.map(q).join(',')
const userIds=people.map(p=>p.id),classIds=classes.map(c=>c.id),generationIds=enrollments.map(e=>e.id)
const allFixtureIds=[...userIds,...classIds,...generationIds,resource,...assignmentRows.map(a=>a.id),...testRows.map(t=>t.id),...grants.map(g=>g.operation)]
const peopleValues=people.map(p=>`(${q(p.id)}::uuid,${q(p.email)},${q(p.role)})`).join(',')
const grantValues=grants.map(g=>`(${q(g.operation)}::uuid,${q(g.subject)}::uuid)`).join(',')
const classValues=classes.map(c=>`(${q(c.id)}::uuid,${q(`${tag} ${c.label}`)},${q(`${tag}_${c.label}`)})`).join(',')
const forcedAfterFixture='Forced course guide post-fixture cleanup proof'
const forcedBeforeCapture='Forced course guide post-commit pre-capture cleanup proof'
let capturedGenerations:WireRow={}

function command(binary:string,args:string[],input?:string):string {
  try { return execFileSync(binary,args,{input,encoding:'utf8',stdio:['pipe','pipe','pipe'],timeout:55_000,maxBuffer:12_000_000}).trim() }
  catch { throw new Error('Local course guide command failed') } // Captured stderr/status may hold secrets.
}
function sql(statement:string) {
  return command('docker',['exec','-i',container,'psql','-U','postgres','-d','postgres','-XqAt','-v','ON_ERROR_STOP=1'],
    `set statement_timeout='50s';set lock_timeout='4s';${statement}`)
}
function fingerprintSql() {
  return `create or replace function pg_temp.guide_fingerprint() returns jsonb language plpgsql as $f$
    declare t record; result jsonb:='{}'; value jsonb;
    begin
      for t in select n.nspname,c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
        where c.relkind in ('r','p') and n.nspname in ('public','private','storage') order by n.nspname,c.relname
      loop
        execute format('select jsonb_build_object(''count'',count(*),''digest'',md5(coalesce(string_agg(md5(to_jsonb(r)::text),'''' order by md5(to_jsonb(r)::text)),''''))) from %I.%I r',t.nspname,t.relname) into value;
        result:=result||jsonb_build_object(t.nspname||'.'||t.relname,value);
      end loop;return result;
    end;$f$;`
}
function fingerprint():unknown {return JSON.parse(sql(`${fingerprintSql()}select pg_temp.guide_fingerprint();`))}
// Full candidate zero across every table, including descendants whose allocated
// parent IDs are known. Original global equality separately covers any unknown
// trigger-generated descendants. No candidate rows are generically deleted.
function residualSql() {
  return `create or replace function pg_temp.guide_residual() returns bigint language plpgsql as $r$
    declare t record; amount bigint; total bigint:=0;
    begin
      for t in select n.nspname,c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
        where c.relkind in ('r','p') and n.nspname in ('public','private','storage')
      loop
        execute format('select count(*) from %I.%I r where exists(select 1 from jsonb_each_text(to_jsonb(r)) e join pg_temp.guide_fixture_ids i on e.value=i.id::text)',t.nspname,t.relname) into amount;
        total:=total+amount;
      end loop;return total;
    end;$r$;`
}
const statusIs=(status:number)=>(error:unknown)=>error instanceof ApiError&&error.statusCode===status
function row(value:unknown):WireRow{return z.record(z.string(),z.unknown()).parse(value)}
function fields(select:string):string[] {
  const parts:string[]=[];let depth=0,start=0
  for(let i=0;i<select.length;i++){if(select[i]==='(')depth++;if(select[i]===')')depth--;if(select[i]===','&&depth===0){parts.push(select.slice(start,i));start=i+1}}
  parts.push(select.slice(start));assert.equal(depth,0);return parts
}
const ordering=(a:{position:number;id:string},b:{position:number;id:string})=>a.position-b.position||(a.id<b.id?-1:a.id>b.id?1:0)
const expectedAssignments=assignmentRows.filter(a=>isAssignmentVisibleToStudents(a,now)).sort(ordering)
const expectedTests=testRows.filter(t=>t.status!=='draft').sort(ordering)
function expectedKeys(list:readonly {title:string}[],kind:'assignment'|'test') {
  return list.map((item,i)=>({key:`${kind}:${i}`,title:item.title||`Untitled ${kind}`}))
}

async function main() {
  assert.equal(command('docker',['inspect',container,'--format','{{ index .Config.Labels "com.supabase.cli.project" }}']),'pika')
  assert.match(command('docker',['port',container,'5432/tcp']),/:54322\s*$/m)
  const local=z.object({API_URL:z.literal('http://127.0.0.1:54321'),SERVICE_ROLE_KEY:z.string().min(20),DB_URL:z.string().refine(value=>{
    try{const u=new URL(value);return ['postgres:','postgresql:'].includes(u.protocol)&&['127.0.0.1','localhost'].includes(u.hostname)&&u.port==='54322'&&u.pathname==='/postgres'}catch{return false}
  })}).safeParse(JSON.parse(command('supabase',['status','-o','json'])))
  if(!local.success)throw new Error('Local course guide target guard failed')
  const {API_URL,SERVICE_ROLE_KEY}=local.data
  const installed=createClient<Database>(API_URL,SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}})
  const read=(actorId:string,classroomId=classA,supabase=installed)=>readContextualCourseGuide({supabase,actorId,classroomId,now})
  type TraceOptions={before?:(stage:Stage)=>void;tamper?:(stage:Stage,body:unknown[],root:WireRow)=>void;fail?:Stage;throwAt?:Stage;expectEmptyAt?:Stage}
  function trace(actorId:string,classroomId=classA,options:TraceOptions={}) {
    const counts=new Map<Stage,number>();let controls=0,preflights=0,assignmentPages=0,testPages=0
    let rawConfig:unknown,rawFeatures:unknown,visibility:ReturnType<typeof toCourseGuideVisibility>|undefined
    let signal:AbortSignal|undefined;const pageSizes:{assignments:number[];tests:number[]}={assignments:[],tests:[]}
    const owner=classes.find(c=>c.id===classroomId)?.owner===actorId
    const client=createClient<Database>(API_URL,SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:async(input,init)=>{
      const url=new URL(input instanceof Request?input.url:String(input));assert.equal(url.origin,API_URL)
      const selected=(url.searchParams.get('select')??'').replaceAll(/\s/g,'')
      assert(!selected.includes('*'));assert(!/(questions|answers|documents|grading|instructions|lessons|announcements|assignment_docs|test_attempts)/.test(selected))
      assert(init?.signal instanceof AbortSignal);if(signal)assert.equal(init.signal,signal);else signal=init.signal
      let stage:Stage
      if(url.pathname==='/rest/v1/classroom_enrollments') {
        stage='enrollment';assert(!owner);assert.equal(selected,'classroom_id,student_id')
        assert.equal(url.searchParams.get('classroom_id'),`eq.${classroomId}`);assert.equal(url.searchParams.get('student_id'),`eq.${actorId}`)
      } else {
        assert.equal(url.pathname,'/rest/v1/classrooms');assert.equal(url.searchParams.get('id'),`eq.${classroomId}`)
        const top=fields(selected)
        if(selected==='id,teacher_id,archived_at'){stage='preflight';preflights++;assert.equal(preflights,1)}
        else {
          const assignment=top.includes('assignments:assignments!assignments_classroom_id_fkey(id,classroom_id,title,position,is_draft,released_at)')
          const test=top.includes('tests:tests!tests_classroom_id_fkey(id,classroom_id,title,position,status)')
          stage=assignment?`assignments:${++assignmentPages}`:test?`tests:${++testPages}`:top.includes('title')?'header':++controls===1?'control':'final'
          assert.equal(url.searchParams.get('teacher_id'),`${owner?'eq':'neq'}.${actorId}`)
          const keys=['id','teacher_id','archived_at','actual_site_config','feature_visibility']
          if(!owner){keys.push('membership:classroom_enrollments!classroom_enrollments_classroom_id_fkey!inner(classroom_id,student_id)')
            assert.equal(url.searchParams.get('archived_at'),'is.null');assert.equal(url.searchParams.get('membership.student_id'),`eq.${actorId}`)
            assert.equal(url.searchParams.get('membership.classroom_id'),`eq.${classroomId}`)}
          else assert.equal(url.searchParams.get('archived_at'),null)
          if(stage!=='control') {
            assert(visibility);assert.deepEqual(JSON.parse((url.searchParams.get('actual_site_config')??'').replace(/^eq\./,'')),rawConfig)
            if(!owner)assert.deepEqual(JSON.parse((url.searchParams.get('feature_visibility')??'').replace(/^eq\./,'')),rawFeatures)
            if(stage==='header') {
              keys.push('title');if(visibility.overview)keys.push('course_overview_markdown')
              if(visibility.resources)keys.push('resources:classroom_resources!classroom_materials_classroom_id_fkey(id,classroom_id,content)')
            } else if(assignment||test) {
              const kind=assignment?'assignments':'tests';assert(visibility[kind]);keys.push(assignment?
                'assignments:assignments!assignments_classroom_id_fkey(id,classroom_id,title,position,is_draft,released_at)':
                'tests:tests!tests_classroom_id_fkey(id,classroom_id,title,position,status)')
              assert.equal(url.searchParams.get(`${kind}.limit`),'1000');assert.equal(url.searchParams.get(`${kind}.order`),'position.asc,id.asc')
              assert.equal(url.searchParams.getAll(`${kind}.or`).length,assignment||Number(stage.split(':')[1])>1?1:0)
              if(assignment){assert.equal(url.searchParams.get('assignments.is_draft'),'eq.false');const or=url.searchParams.get('assignments.or')??''
                assert(or.includes(`released_at.is.null,released_at.lt.${releaseExclusive}`));assert(!or.includes('released_at.lte.'))
                if(assignmentPages>1)assert(or.startsWith('(and(or('))}
              else assert.equal(url.searchParams.get('tests.status'),'neq.draft')
              if(Number(stage.split(':')[1])>1)assert((url.searchParams.get(`${kind}.or`)??'').includes('position.gt.'))
            }
          } else assert.equal(url.searchParams.get('actual_site_config'),null)
          assert.deepEqual(top.sort(),keys.sort(),'Exact projection; hidden data never selected')
        }
      }
      counts.set(stage,(counts.get(stage)??0)+1);assert.equal(counts.get(stage),1,'No query retries/fallback')
      options.before?.(stage)
      if(options.throwAt===stage)throw new Error('Synthetic rejected transport')
      if(options.fail===stage)return new Response(JSON.stringify({code:'PGRST205',message:'Synthetic unavailable query'}),{status:503,headers:{'content-type':'application/json'}})
      const response=await fetch(url,init);if(!response.ok)return response
      const body:unknown=await response.json();assert(Array.isArray(body),'Actual maybeSingle SDK wire array')
      if(options.expectEmptyAt===stage)assert.deepEqual(body,[],'Revoked statement returns no root or unauthorized payload at the actual wire boundary')
      if(body.length){assert.equal(body.length,1);const root=row(body[0]);body[0]=root // Zod clone explicitly rebound into wire.
        if(stage==='control'){rawConfig=structuredClone(root.actual_site_config);rawFeatures=structuredClone(root.feature_visibility)
          visibility=toCourseGuideVisibility(normalizeActualCourseSiteConfig(root.actual_site_config))}
        if(!owner&&!['preflight','enrollment'].includes(stage))assert.deepEqual(root.membership,[{classroom_id:classroomId,student_id:actorId}])
        if(stage==='header'&&visibility?.resources){assert(root.resources===null||(!Array.isArray(root.resources)&&typeof root.resources==='object'))}
        if(stage.startsWith('assignments:')||stage.startsWith('tests:')){
          const kind=stage.startsWith('assignments:')?'assignments':'tests';const children=root[kind];assert(Array.isArray(children));assert(children.length<=1000)
          pageSizes[kind].push(children.length)
          for(const child of children){const record=row(child);assert.deepEqual(Object.keys(record).sort(),kind==='assignments'?
            ['classroom_id','id','is_draft','position','released_at','title']:['classroom_id','id','position','status','title'])}
        }
        options.tamper?.(stage,body,root)
      }
      const headers=new Headers(response.headers);headers.delete('content-length')
      return new Response(JSON.stringify(body),{status:response.status,headers})
    }}})
    return {client,counts,pageSizes}
  }
  assert.equal(sql(`select tgenabled from pg_trigger where tgrelid='private.pal_membership_generations'::regclass and tgname='guard_pal_membership_evidence' and not tgisinternal;`),'O')
  const baseline=fingerprint()
  assert.equal(sql(`select count(*) from private.pal_membership_generations where generation_id in (${ids(generationIds)});`),'0')
  const fixtureIds=`create temp table guide_fixture_ids(id uuid primary key);insert into guide_fixture_ids values ${allFixtureIds.map(id=>`(${q(id)}::uuid)`).join(',')};`
  assert.equal(sql(`${fixtureIds}${residualSql()}select pg_temp.guide_residual();`),'0','All allocated fixture UUIDs must be absent before setup')
  try {
    sql(`begin;
      insert into public.users(id,email,role) values ${people.map(p=>`(${q(p.id)},${q(p.email)},${q(p.role)})`).join(',')};
      set local role service_role;
      select public.set_effective_feature_entitlement_v1(op,u,'classrooms.create','manual',true,clock_timestamp(),null,3,'test:course-guide-read',${q(tag)},
        coalesce((select revision from public.effective_feature_entitlements where subject_user_id=u and feature_key='classrooms.create'),0)) from (values ${grantValues}) f(op,u);
      reset role;
      insert into public.classrooms(id,teacher_id,title,class_code,actual_site_config,feature_visibility,course_overview_markdown)
        values ${classes.map(c=>`(${q(c.id)},${q(c.owner)},${q(`${tag} ${c.label}`)},${q(`${tag}_${c.label}`)},'{}'::jsonb,'{}'::jsonb,'Synthetic overview')`).join(',')};
      insert into public.classroom_enrollments(id,classroom_id,student_id) values ${baseEnrollments.map(e=>`(${q(e.id)},${q(e.classroom)},${q(e.student)})`).join(',')};
      insert into public.classroom_resources(id,classroom_id,content) values(${q(resource)},${q(classA)},${q(JSON.stringify(content))}::jsonb);
      insert into public.assignments(id,classroom_id,title,position,is_draft,released_at,due_at,created_by)
        values ${assignmentRows.map(a=>`(${q(a.id)},${q(classA)},${q(a.title)},${a.position},${a.is_draft},${a.released_at?q(a.released_at):'null'},'2027-01-01T00:00:00Z',${q(ownerStudent)})`).join(',')};
      insert into public.tests(id,classroom_id,title,position,status,created_by)
        values ${testRows.map(t=>`(${q(t.id)},${q(classA)},${q(t.title)},${t.position},${q(t.status)},${q(ownerStudent)})`).join(',')};
      commit;`)
    if(process.argv.includes('--verify-cleanup-after-commit-before-capture'))throw new Error(forcedBeforeCapture)
    capturedGenerations=row(JSON.parse(sql(`select coalesce(jsonb_object_agg(generation_id::text,to_jsonb(g)),'{}') from private.pal_membership_generations g where generation_id in (${ids(generationIds)});`)))
    assert.equal(Object.keys(capturedGenerations).length,baseEnrollments.length)
    if(process.argv.includes('--verify-cleanup-after-fixture'))throw new Error(forcedAfterFixture)
    const readBaseline=fingerprint()
    for(const actor of [ownerStudent,memberStudent,memberTeacher]){
      const observed=trace(actor);const guide=await read(actor,classA,observed.client)
      assert.deepEqual(Object.keys(guide).sort(),['assignments','classroom','overviewMarkdown','resourcesContent','tests','visibility'])
      assert.deepEqual(guide.assignments,expectedKeys(expectedAssignments,'assignment'));assert.deepEqual(guide.tests,expectedKeys(expectedTests,'test'))
      assert.deepEqual(guide.resourcesContent,content);assert.equal(guide.overviewMarkdown,'Synthetic overview')
      assert.deepEqual(observed.pageSizes,{assignments:[1000,7,0],tests:[1000,5,0]})
      assert.equal(observed.counts.get('final'),1)
    }
    for(const actor of [ownerTeacher,memberStudent,memberTeacher]){
      const observed=trace(actor,classB);const guide=await read(actor,classB,observed.client)
      assert.equal(guide.resourcesContent,null);assert.deepEqual(guide.assignments,[]);assert.deepEqual(guide.tests,[])
      assert.deepEqual(observed.pageSizes,{assignments:[0],tests:[0]})
    }
    await assert.rejects(read(outsider),statusIs(403));await assert.rejects(read(memberStudent,randomUUID()),statusIs(404))
    assert(isAssignmentVisibleToStudents({is_draft:false,released_at:withinMillisecond},now))
    assert(!isAssignmentVisibleToStudents({is_draft:false,released_at:nextMillisecond},now))
    assert.deepEqual(fingerprint(),readBaseline)
    process.stdout.write('PASS course guide actual SDK mixed-role authority, genuine resource FK, both collections beyond 1000, terminal pages and millisecond release precision\n')

    const tampering:Array<{stage:Stage;actor?:string;status?:number;change:(body:unknown[],root:WireRow)=>void}>=[
      {stage:'preflight',change:(_b,r)=>{r.id=classB}}, {stage:'control',change:(_b,r)=>{r.teacher_id=outsider}},
      {stage:'header',change:(_b,r)=>{r.id=classB}}, {stage:'header',change:(_b,r)=>{r.actual_site_config={overview:false}}},
      {stage:'header',change:(_b,r)=>{r.resources=[r.resources]}}, {stage:'header',change:(_b,r)=>{row(r.resources);const changed=row(r.resources);changed.classroom_id=classB;r.resources=changed}},
      {stage:'header',change:(_b,r)=>{r.course_outline_markdown='Forbidden extra field'}},
      {stage:'header',change:(_b,r)=>{const changed=row(r.resources);changed.content='x'.repeat(2*1024*1024+1);r.resources=changed}},
      {stage:'header',change:(b,r)=>{b.push(structuredClone(r))}}, {stage:'header',status:403,change:b=>{b[0]=null}},
      {stage:'control',actor:memberTeacher,change:(_b,r)=>{r.membership=[]}},
      {stage:'header',actor:memberTeacher,change:(_b,r)=>{r.membership=[{classroom_id:classA,student_id:outsider}]}},
      {stage:'assignments:1',change:(_b,r)=>{const a=z.array(z.unknown()).parse(r.assignments);a.push(a[0]);r.assignments=a}},
      {stage:'assignments:1',change:(_b,r)=>{const a=z.array(z.unknown()).parse(r.assignments);const c=row(a[0]);c.classroom_id=classB;a[0]=c;r.assignments=a}},
      {stage:'assignments:1',change:(_b,r)=>{const a=z.array(z.unknown()).parse(r.assignments);const c=row(a[0]);c.released_at=nextMillisecond;a[0]=c;r.assignments=a}},
      {stage:'assignments:2',change:(_b,r)=>{const a=z.array(z.unknown()).parse(r.assignments);a.reverse();r.assignments=a}},
      {stage:'tests:1',change:(_b,r)=>{const a=z.array(z.unknown()).parse(r.tests);const c=row(a[0]);c.status='draft';a[0]=c;r.tests=a}},
      {stage:'final',change:(_b,r)=>{delete r.feature_visibility}},
    ]
    for(const test of tampering){const observed=trace(test.actor??ownerStudent,classA,{tamper:(stage,body,root)=>{if(stage===test.stage)test.change(body,root)}})
      await assert.rejects(read(test.actor??ownerStudent,classA,observed.client),statusIs(test.status??503));assert.equal(observed.counts.get(test.stage),1)}
    for(const stage of ['control','header','assignments:2','tests:3','final'] as const){
      for(const failure of ['fail','throwAt'] as const){const observed=trace(ownerStudent,classA,{[failure]:stage});await assert.rejects(read(ownerStudent,classA,observed.client),statusIs(503));assert.equal(observed.counts.get(stage),1)}}
    assert.deepEqual(fingerprint(),readBaseline)
    process.stdout.write('PASS course guide real SDK wire tampering, cardinality, cursor, resource/config bounds and transport failures deny without retries or partial DTO\n')

    // Persisted JSONB null/scalar/default values, key-order independence and
    // independently hidden projections use actual PostgREST equality filters.
    process.stdout.write('CHECK course guide persisted actual-site configuration\n')
    for(const config of [null,true,7,'historical scalar',{}, {overview:'nonboolean',resources:null},
      {overview:false},{resources:false},{assignments:false},{tests:false},
      {overview:false,resources:false,assignments:false,tests:false}]){
      sql(`update public.classrooms set actual_site_config=${q(JSON.stringify(config))}::jsonb where id=${q(classA)};`)
      const observed=trace(memberStudent);const guide=await read(memberStudent,classA,observed.client)
      const visibility=toCourseGuideVisibility(normalizeActualCourseSiteConfig(config));assert.deepEqual(guide.visibility,visibility)
      assert.equal(guide.overviewMarkdown,visibility.overview?'Synthetic overview':'');assert.deepEqual(guide.resourcesContent,visibility.resources?content:null)
      assert.deepEqual(guide.assignments,visibility.assignments?expectedKeys(expectedAssignments,'assignment'):[])
      assert.deepEqual(guide.tests,visibility.tests?expectedKeys(expectedTests,'test'):[])
      assert.equal(observed.counts.get('final'),1)
      if(!visibility.assignments)assert.equal(observed.pageSizes.assignments.length,0)
      if(!visibility.tests)assert.equal(observed.pageSizes.tests.length,0)
    }
    sql(`update public.classrooms set actual_site_config='{"overview":true,"resources":true,"assignments":true,"tests":true}'::jsonb where id=${q(classA)};`)
    const reordered=trace(ownerStudent,classA,{before:stage=>{if(stage==='header')sql(`update public.classrooms set actual_site_config='{"tests":true,"assignments":true,"resources":true,"overview":true}'::jsonb where id=${q(classA)};`)},
      tamper:(stage,_body,root)=>{if(stage!=='preflight')root.actual_site_config={tests:true,assignments:true,resources:true,overview:true}}})
    assert.deepEqual((await read(ownerStudent,classA,reordered.client)).assignments,expectedKeys(expectedAssignments,'assignment'))
    sql(`update public.classrooms set actual_site_config='{}'::jsonb where id=${q(classA)};`)
    //205 constrains feature_visibility, unlike actual_site_config. Missing
    //known keys yield SQL UNKNOWN and retain legacy defaults; present known
    //keys must be booleans. Unknown extra keys are not authorization controls.
    for(const rawFeature of [{}, {syllabus:true},
      {attendance:true,classwork:true,tests:true,gradebook:true,student_grades:false,
        calendar:true,syllabus:true,announcements:true,achievements:true},
      {syllabus:true,historical_extra:{value:'non-authorizing'}},
      {extra_flag:null,extra_scalar:7}]){
      sql(`update public.classrooms set feature_visibility=${q(JSON.stringify(rawFeature))}::jsonb where id=${q(classA)};`)
      const observed=trace(memberTeacher);assert.deepEqual((await read(memberTeacher,classA,observed.client)).assignments,expectedKeys(expectedAssignments,'assignment'))
      assert.equal(observed.counts.get('final'),1)
    }
    sql(`update public.classrooms set feature_visibility='{}'::jsonb where id=${q(classA)};`)
    process.stdout.write('CHECK course guide feature constraint denial\n')
    const featureBaseline=fingerprint()
    const featureRowBefore=row(JSON.parse(sql(`select to_jsonb(c) from public.classrooms c where id=${q(classA)};`)))
    for(const forbiddenFeature of [null,true,7,'historical feature scalar',{syllabus:'nonboolean'},{syllabus:null}]){
      const denialBaseline=fingerprint();assert.deepEqual(denialBaseline,featureBaseline)
      // The inner EXCEPTION block is a PostgreSQL subtransaction: only the
      // exact23514 constraint failure is accepted, and all UPDATE/trigger work
      // rolls back. No schema alteration, trigger suppression or retry occurs.
      sql(`do $feature_denial$ declare rejected boolean:=false; violated text; failure_state text; original jsonb; begin
        select to_jsonb(c) into original from public.classrooms c where id=${q(classA)} and teacher_id=${q(ownerStudent)} for update of c nowait;
        if original is null then raise exception 'Exact feature fixture is absent'; end if;
        begin
          update public.classrooms set feature_visibility=${q(JSON.stringify(forbiddenFeature))}::jsonb
            where id=${q(classA)} and teacher_id=${q(ownerStudent)};
        exception when check_violation then
          get stacked diagnostics violated=constraint_name,failure_state=returned_sqlstate;
          if violated is distinct from 'classrooms_feature_visibility_shape_check' or failure_state is distinct from '23514'
            then raise exception 'Unexpected feature constraint failure'; end if;
          rejected:=true;
        end;
        if not rejected then raise exception using errcode='ZX205',message='Invalid persisted feature shape unexpectedly accepted'; end if;
        if (select to_jsonb(c) from public.classrooms c where id=${q(classA)}) is distinct from original
          then raise exception 'Feature denial changed fixture row'; end if;
      end;$feature_denial$;`)
      assert.deepEqual(row(JSON.parse(sql(`select to_jsonb(c) from public.classrooms c where id=${q(classA)};`))),featureRowBefore)
      assert.deepEqual(fingerprint(),denialBaseline,'Expected feature constraint denial must preserve every whole row')
    }
    process.stdout.write('CHECK course guide persisted resource compatibility\n')
    for(const raw of [null,'not valid JSON',JSON.stringify(content),{type:'doc',content:[]},{type:'doc',content:[{type:'image',attrs:{src:'https://example.invalid/image'}}]}]){
      sql(`update public.classroom_resources set content=${q(JSON.stringify(raw))}::jsonb where id=${q(resource)} and classroom_id=${q(classA)};`)
      const guide=await read(ownerStudent);assert.deepEqual(guide.resourcesContent,typeof raw==='string'&&raw===JSON.stringify(content)?content:null)
    }
    sql(`update public.classroom_resources set content=${q(JSON.stringify(content))}::jsonb where id=${q(resource)} and classroom_id=${q(classA)};`)
    sql(`update public.classrooms set archived_at=clock_timestamp(),feature_visibility='{"syllabus":false}'::jsonb where id=${q(classB)};`)
    await read(ownerTeacher,classB) // Owner precedence despite actual self-enrollment, archive and hidden syllabus.
    for(const actor of [memberStudent,memberTeacher])await assert.rejects(read(actor,classB),statusIs(403))
    sql(`update public.classrooms set archived_at=null where id=${q(classB)};`)
    await assert.rejects(read(memberTeacher,classB),statusIs(403));await read(ownerTeacher,classB)
    sql(`update public.classrooms set feature_visibility='{}'::jsonb where id=${q(classB)};`)
    process.stdout.write('PASS course guide actual-site JSONB null/scalar/default/semantic equality, legal member feature controls and constraint denial, hidden projections, resource compatibility and current member syllabus\n')

    process.stdout.write('CHECK course guide committed revocation boundaries\n')
    const boundaries:Stage[]=['header','assignments:1','assignments:2','assignments:3','tests:1','tests:2','tests:3','final']
    for(const boundary of boundaries){
      for(const kind of ['owner','archive','config','syllabus'] as const){
        const actor=kind==='owner'?ownerStudent:memberTeacher;let hit=false
        const changed=kind==='owner'?`teacher_id=${q(outsider)}`:kind==='archive'?'archived_at=clock_timestamp()':kind==='config'?`actual_site_config='{"overview":false}'::jsonb`:`feature_visibility='{"syllabus":false}'::jsonb`
        const observed=trace(actor,classA,{expectEmptyAt:boundary,before:stage=>{if(stage===boundary){hit=true;sql(`update public.classrooms set ${changed} where id=${q(classA)};`)}}})
        await assert.rejects(read(actor,classA,observed.client),statusIs(403));assert(hit);assert.equal(observed.counts.get(boundary),1)
        sql(`update public.classrooms set teacher_id=${q(ownerStudent)},archived_at=null,actual_site_config='{}'::jsonb,feature_visibility='{}'::jsonb where id=${q(classA)};`)
      }
    }
    let active=baseEnrollments.find(e=>e.classroom===classA&&e.student===memberTeacher);assert(active)
    for(const [index,boundary] of boundaries.entries()){
      const current=active;let hit=false
      const observed=trace(memberTeacher,classA,{expectEmptyAt:boundary,before:stage=>{if(stage===boundary){hit=true;sql(`delete from public.classroom_enrollments where id=${q(current.id)} and classroom_id=${q(classA)} and student_id=${q(memberTeacher)};`)}}})
      await assert.rejects(read(memberTeacher,classA,observed.client),statusIs(403));assert(hit);assert.equal(observed.counts.get(boundary),1)
      active=replacementEnrollments[index];sql(`insert into public.classroom_enrollments(id,classroom_id,student_id) values(${q(active.id)},${q(classA)},${q(memberTeacher)});`)
    }
    const deleted=trace(memberStudent,classC,{expectEmptyAt:'final',before:stage=>{if(stage==='final')sql(`delete from public.classrooms where id=${q(classC)} and teacher_id=${q(ownerTeacher)};`)}})
    await assert.rejects(read(memberStudent,classC,deleted.client),statusIs(403));assert.equal(deleted.counts.get('final'),1)
    process.stdout.write('PASS course guide committed owner/archive/enrollment/config/visibility/syllabus revocations before header, first/later/terminal pages and final control deny all partial output\n')
  } finally {
    // Exact cleanup must also succeed when fixture COMMIT completed but reference
    // capture never happened. UUID absence was verified before setup; fallback
    // refs are independently bound by exact class/user scope under exclusive lock.
    const generations=enrollments.map(e=>{const p=z.object({generation_id:z.literal(e.id),pal_reference:z.string().regex(/^pika-membership-v1-[a-f0-9]{32}$/)}).safeParse(capturedGenerations[e.id]);return `(${q(e.id)}::uuid,${q(e.classroom)}::uuid,${q(e.student)}::uuid,${p.success?q(p.data.pal_reference):'null::text'})`}).join(',')
    sql(`begin;
      lock table private.pal_membership_generations in access exclusive mode nowait;
      create temp table guide_generation_snapshot on commit drop as select g.* from private.pal_membership_generations g join (values ${generations}) f(id,c,u,ref) on g.generation_id=f.id;
      create temp table guide_user_snapshot on commit drop as select u.* from public.users u where id in (${ids(userIds)}) for update of u nowait;
      create temp table guide_class_snapshot on commit drop as select c.* from public.classrooms c where id in (${ids(classIds)}) for update of c nowait;
      ${fixtureIds}
      do $guard$ begin
        if (select tgenabled from pg_trigger where tgrelid='private.pal_membership_generations'::regclass and tgname='guard_pal_membership_evidence' and not tgisinternal) is distinct from 'O' then raise exception 'Generation guard differs'; end if;
        if exists(select 1 from guide_generation_snapshot g join (values ${generations}) f(id,c,u,ref) on g.generation_id=f.id
          where g.scope_digest is distinct from private.pal_membership_scope(f.c,f.u) or g.state not in ('active','removed') or g.pal_reference !~ '^pika-membership-v1-[a-f0-9]{32}$'
            or (f.ref is not null and g.pal_reference is distinct from f.ref)) then raise exception 'Fixture generation identity differs'; end if;
        if exists(select 1 from guide_user_snapshot u join (values ${peopleValues}) f(id,email,role) on u.id=f.id where u.email is distinct from f.email or u.role::text is distinct from f.role)
          or exists(select 1 from guide_class_snapshot c join (values ${classValues}) f(id,title,code) on c.id=f.id where c.title is distinct from f.title or c.class_code is distinct from f.code or c.teacher_id not in (${ids(userIds)})) then raise exception 'Exact fixture identities differ'; end if;
        if exists(select 1 from public.pal_event_outbox where student_id in (${ids(userIds)})) or exists(select 1 from private.removed_student_cleanup_jobs where classroom_id in (${ids(classIds)}))
          or exists(select 1 from private.student_provider_cleanup_bindings where generation_id in (${ids(generationIds)}))
          or exists(select 1 from private.attendance_membership_generations where generation_id in (${ids(generationIds)}))
          or exists(select 1 from (values ${classIds.map(id=>`(${q(id)}::uuid)`).join(',')}) f(id) where public.attendance_classroom_has_state_v1(f.id)) then raise exception 'Unexpected provider/attendance fixture state'; end if;
      end;$guard$;
      -- No provider/private/Storage fixtures were created. Refuse any such
      -- candidates BEFORE cascades; never treat their destruction as cleanup.
      do $private$ declare t record; found boolean; begin
        for t in select n.nspname,c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
          where c.relkind in ('r','p') and n.nspname in ('private','storage')
            and not(n.nspname='private' and c.relname='pal_membership_generations')
        loop
          execute format('select exists(select 1 from %I.%I r where exists(select 1 from jsonb_each_text(to_jsonb(r)) e join pg_temp.guide_fixture_ids i on e.value=i.id::text))',t.nspname,t.relname) into found;
          if found then raise exception 'Unexpected private/Storage fixture dependency'; end if;
        end loop;
      end;$private$;
      create temp table guide_provision_ops(operation_id uuid,subject_user_id uuid,primary key(operation_id,subject_user_id)) on commit drop;
      insert into guide_provision_ops select a.operation_id,a.subject_user_id from public.account_plan_audit a join guide_user_snapshot u on u.id=a.subject_user_id
        where a.actor_ref='system:user-provisioning' and a.reason_code='default_free_account_provisioning' and a.new_plan_key='free' and a.previous_plan_key is null;
      delete from public.effective_feature_entitlement_audit a using (values ${grantValues}) f(op,u) where a.operation_id=f.op and a.subject_user_id=f.u
        and a.actor_ref='test:course-guide-read' and a.reason_code=${q(tag)} and a.feature_key='classrooms.create';
      delete from public.effective_feature_entitlement_audit a using guide_provision_ops p where a.operation_id=p.operation_id and a.subject_user_id=p.subject_user_id
        and a.actor_ref='system:user-provisioning' and a.reason_code='default_free_account_provisioning';
      delete from public.account_plan_audit a using guide_provision_ops p where a.operation_id=p.operation_id and a.subject_user_id=p.subject_user_id
        and a.actor_ref='system:user-provisioning' and a.reason_code='default_free_account_provisioning';
      delete from public.classrooms c using guide_class_snapshot s where c.id=s.id and to_jsonb(c)=to_jsonb(s);
      delete from public.users u using guide_user_snapshot s where u.id=s.id and to_jsonb(u)=to_jsonb(s);
      do $transition$ begin
        if exists(select 1 from guide_generation_snapshot s left join private.pal_membership_generations g on g.generation_id=s.generation_id
          where g.generation_id is null or (to_jsonb(g)-'state') is distinct from (to_jsonb(s)-'state') or not(g.state=s.state or(s.state='active' and g.state='removed'))) then raise exception 'Generation transition differs'; end if;
      end;$transition$;
      update guide_generation_snapshot s set state=g.state from private.pal_membership_generations g where g.generation_id=s.generation_id;
      alter table private.pal_membership_generations disable trigger guard_pal_membership_evidence;
      delete from private.pal_membership_generations g using guide_generation_snapshot s where g.generation_id=s.generation_id and to_jsonb(g)=to_jsonb(s);
      alter table private.pal_membership_generations enable trigger guard_pal_membership_evidence;
      ${fingerprintSql()}${residualSql()}
      do $complete$ begin
        if pg_temp.guide_residual()<>0 or pg_temp.guide_fingerprint() is distinct from ${q(JSON.stringify(baseline))}::jsonb
          or (select tgenabled from pg_trigger where tgrelid='private.pal_membership_generations'::regclass and tgname='guard_pal_membership_evidence' and not tgisinternal) is distinct from 'O'
          then raise exception 'Cleanup residue/full baseline/guard differs; rollback entire cleanup'; end if;
      end;$complete$;commit;`)
    assert.equal(sql(`${fixtureIds}${residualSql()}select pg_temp.guide_residual();`),'0')
    assert.equal(sql(`select tgenabled from pg_trigger where tgrelid='private.pal_membership_generations'::regclass and tgname='guard_pal_membership_evidence' and not tgisinternal;`),'O')
    assert.deepEqual(fingerprint(),baseline)
    process.stdout.write('PASS exact synthetic course guide cleanup, zero residual rows and global whole-row baseline counts\n')
  }
}
main().catch((error:unknown)=>{
  process.stderr.write(error instanceof Error&&error.message===forcedAfterFixture?
    'FAIL Forced course guide post-fixture cleanup proof (expected for --verify-cleanup-after-fixture)\n':
    error instanceof Error&&error.message===forcedBeforeCapture?
      'FAIL Forced course guide post-commit pre-capture cleanup proof (expected for --verify-cleanup-after-commit-before-capture)\n':
      'FAIL local course guide SDK proof (captured command/status data withheld; no automatic retry)\n')
  process.exitCode=1
})
