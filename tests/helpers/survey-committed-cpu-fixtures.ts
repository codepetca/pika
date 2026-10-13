/** Shared reviewed CPU fixtures. Synthetic data only; no native provenance or execution. */
import {createHash} from 'node:crypto'
import type {SurveyNativeFixture} from '../../scripts/contextual-surveys-native-contracts'
import {verifySurveyCommittedSeed,type SurveyCommittedProofManifest} from '../../scripts/contextual-surveys-committed-proof'
export type SurveyCpuGraph = Record<string,Record<string,unknown>[]>
type Graph = SurveyCpuGraph

export function surveyCommittedCpuFixtures(f:SurveyNativeFixture,stamps:Partial<Record<'seedStamp'|'writeStamp'|'changeStamp'|'archiveStamp'|'endStamp'|'archiveOperationEnd',string>>={}){
const {seedStamp,writeStamp,changeStamp,archiveStamp,endStamp,archiveOperationEnd}= {
 seedStamp:'2026-10-13T02:59:00Z',writeStamp:'2026-10-13T03:00:00Z',changeStamp:'2026-10-13T03:00:01Z',
 archiveStamp:'2026-10-13T03:00:01.250Z',endStamp:'2026-10-13T03:00:02Z',archiveOperationEnd:'2026-10-13T03:00:01.500Z',...stamps
}
function capturedSeed(m:SurveyCommittedProofManifest) {
  let n=1;const generated=()=>`deafbeef-0000-4000-8000-${(n++).toString(16).padStart(12,'0')}`
  const g:Graph=Object.fromEntries(['public.classrooms','public.classroom_archive_revisions','public.classroom_enrollments','public.surveys','public.survey_questions','public.survey_responses','public.gradebook_categories','private.pal_membership_generations','public.untouched'].map(t=>[t,[]]))
  g['public.untouched']=[{id:'unchanged',value:'retain',nested:{left:{a:1,b:2},ordered:[{a:1,b:2},{a:3,b:4}]}}]
  g['public.users']=f.actors.map(a=>({id:a.id,role:a.role,email:a.email}))
  for(const s of m.schedules){const c=s.cohort
    for(const [cid,teacher_id,blueprint_source_revision,revision] of [[c.classroomId,f.actors[0].id,5,15],[c.foreignClassroomId,f.actors[1].id,2,6]] as const){
      g['public.classrooms'].push({id:cid,teacher_id,title:f.tag,class_code:cid,term_label:null,created_at:seedStamp,updated_at:seedStamp,start_date:null,end_date:null,archived_at:null,position:0,allow_enrollment:true,join_policy:'roster',lesson_plan_visibility:'current_week',theme_color:'blue',source_blueprint_id:null,source_blueprint_origin:null,source_blueprint_version_id:null,authoring_guidance_version_id:null,actual_site_slug:null,actual_site_published:false,actual_site_config:{overview:true,outline:true,resources:true,assignments:true,tests:true,lesson_plans:true,announcements:true,lesson_plan_scope:'current_week'},course_overview_markdown:'',course_outline_markdown:'',blueprint_source_revision,manual_attendance_source_mode:'manual',manual_attendance_revision:1,manual_attendance_session_starts_local:null,manual_attendance_session_ends_local:null,feature_visibility:{attendance:true,classwork:true,tests:true,gradebook:true,student_grades:false,calendar:true,syllabus:true,announcements:true,achievements:true}})
      g['public.classroom_archive_revisions'].push({classroom_id:cid,revision,updated_at:seedStamp})
      for(const [name,percentage,position,is_default] of [['Attendance',10,0,false],['Term',65,1,true],['Final',25,2,false]] as const)g['public.gradebook_categories'].push({id:generated(),classroom_id:cid,name,percentage,position,is_default,default_assessment_weight:10,created_at:seedStamp,updated_at:seedStamp})
    }
    for(const [eid,actor] of [[c.enrollmentId,f.actors[1].id],[c.readerEnrollmentId,f.actors[3].id]]){
      g['public.classroom_enrollments'].push({id:eid,classroom_id:c.classroomId,student_id:actor,created_at:seedStamp,manual_attendance_marks:{}})
      // Source-derived scope digest, genuine-shaped but explicitly mocked Pal reference.
      const scope=actor===f.actors[1].id?c.scopeDigest:scopeDigest(c.classroomId,actor)
      g['private.pal_membership_generations'].push({generation_id:eid,scope_digest:scope,pal_reference:'pika-membership-v1-'+(n++).toString(16).padStart(32,'0'),state:'active'})
    }
    for(const [sid,cid,owner,position,dynamic] of [[c.surveyId,c.classroomId,f.actors[0].id,0,s.index===14],[c.foreignSurveyId,c.foreignClassroomId,f.actors[1].id,0,false],[c.resultSurveyId,c.classroomId,f.actors[0].id,1,false]] as const)g['public.surveys'].push({id:sid,classroom_id:cid,created_by:owner,position,dynamic_responses:dynamic,title:f.tag,artifact_id:generated(),source_artifact_id:null,source_blueprint_version_id:null,blueprint_archived_at:null,status:'active',show_results:true,opens_at:null,created_at:seedStamp,updated_at:seedStamp})
    g['public.survey_questions'].push(...[c.question,c.aggregateQuestion].map(r=>({...r,created_at:seedStamp,updated_at:seedStamp})))
    g['public.survey_responses'].push({id:c.aggregateResponseId,survey_id:c.resultSurveyId,question_id:c.aggregateQuestion.id,student_id:f.actors[1].id,selected_option:null,response_text:'Synthetic shared result',submitted_at:seedStamp,updated_at:seedStamp})
  }
  return g
}
const scopeDigest=(cid:string,actor:string)=>createHash('sha256').update(`pika-membership-scope-v1:${cid}:${actor}`).digest('hex')
function seedBefore(g:Graph){return Object.fromEntries(Object.entries(g).map(([t,rows])=>[t,['public.untouched','public.users'].includes(t)?rows:[]]))}
function admitSeed(m:SurveyCommittedProofManifest,g:Graph){const before=seedBefore(g);verifySurveyCommittedSeed(m,before,g,{startedAt:seedStamp,endedAt:seedStamp,seedTimestamp:seedStamp});return before}
function changedCase(s:SurveyCommittedProofManifest['schedules'][number],before:Graph){
  const {index,direction,cohort:c}=s
  const after=structuredClone(before),one=(g:Graph,t:string,key:string,value:string)=>g[t].find(r=>r[key]===value)!
  const cl=one(after,'public.classrooms','id',c.classroomId),ar=one(after,'public.classroom_archive_revisions','classroom_id',c.classroomId),question=one(after,'public.survey_questions','id',c.question.id)
  const timestamp=changeStamp;let delta=0
  if([0,1,8,9,10,11].includes(index)){
    if([0,1,8].includes(index))question.question_text='Concurrent question'
    if(index===9||index===10){question.question_type='multiple_choice';question.options=index===9?['A','B']:['Changed A','Changed B']}
    if(index===11)question.response_max_chars=1
    question.updated_at=timestamp;cl.blueprint_source_revision=6;cl.updated_at=timestamp;delta+=2
  }
  if(index===7){question.survey_id=c.foreignSurveyId;question.updated_at=timestamp;delta++
    const foreign=one(after,'public.classroom_archive_revisions','classroom_id',c.foreignClassroomId);foreign.revision=7;foreign.updated_at=timestamp}
  if(index===2){cl.teacher_id=f.actors[1].id;cl.updated_at=timestamp;delta++}
  const archivedAt=archiveStamp
  if(index===3){cl.archived_at=archivedAt;cl.updated_at=timestamp;delta++}
  if(index===4){after['public.classroom_enrollments']=after['public.classroom_enrollments'].filter(r=>r.id!==c.enrollmentId);one(after,'private.pal_membership_generations','generation_id',c.enrollmentId).state='removed';delta++}
  if(index===12){const survey=one(after,'public.surveys','id',c.surveyId);survey.status='closed';survey.updated_at=timestamp;delta++}
  const responded=index>=13||index>=8&&index<=12&&direction==='reverse'
  const response={id:`cafebabe-0000-4000-8000-${(index*2+(direction==='reverse'?1:0)).toString(16).padStart(12,'0')}`,survey_id:c.surveyId,question_id:c.question.id,student_id:f.actors[1].id,selected_option:null,response_text:'Synthetic response',submitted_at:writeStamp,updated_at:index===14?timestamp:writeStamp}
  if(responded){after['public.survey_responses'].push(response);delta+=index===14?3:1}
  if(delta){ar.revision=15+delta;ar.updated_at=timestamp}
  const times={startedAt:writeStamp,endedAt:endStamp,writerTimestamp:timestamp,responseId:responded?response.id:undefined,responseSubmittedAt:responded?writeStamp:undefined,responseTimestamp:responded?String(response.updated_at):undefined,firstResponse:index===14?{...response,updated_at:writeStamp}:undefined,
    archiveReceipt:index===3?{label:s.label,classroomId:c.classroomId,archivedAt,transactionTimestamp:timestamp,operationStartedAt:timestamp,operationFinishedAt:archiveOperationEnd}:undefined}
  return {after,one,times,delta}
}
function practicalFixture(m:SurveyCommittedProofManifest,s:SurveyCommittedProofManifest['schedules'][number],before:Graph){
  const bootstrap={holder:{pid:101,started:'2026-10-13T03:00:00Z',name:m.projectId+'_draft_holder',database:'postgres' as const,user:'postgres' as const},
    contender:{pid:102,started:'2026-10-13T03:00:01Z',name:m.projectId+'_draft_contender',database:'postgres' as const,user:'postgres' as const}}
  const c=s.cohort,one=(t:string,key:string,value:string)=>before[t].find(r=>r[key]===value)!,cl=one('public.classrooms','id',c.classroomId)
  const detail={classroom:{id:cl.id,teacher_id:cl.teacher_id,archived_at:cl.archived_at},survey:one('public.surveys','id',c.surveyId),
    questions:before['public.survey_questions'].filter(r=>r.survey_id===c.surveyId),responses:[3,4].includes(s.index)?before['public.survey_responses'].filter(r=>r.survey_id===c.surveyId&&r.student_id===f.actors[1].id):[]}
  const survey=one('public.surveys','id',c.resultSurveyId),r=one('public.survey_responses','id',c.aggregateResponseId)
  const aggregate={classroom:detail.classroom,survey:{id:survey.id,title:survey.title,status:survey.status,show_results:survey.show_results,dynamic_responses:survey.dynamic_responses},
    results:[{question_id:c.aggregateQuestion.id,question_type:'short_text',question_text:c.aggregateQuestion.question_text,options:[],counts:[],total_responses:1,responses:[{response_id:r.id,response_text:r.response_text,submitted_at:r.submitted_at,updated_at:r.updated_at}]}]}
  const firstRead=s.index<=7&&([1,5,6].includes(s.index)?s.direction==='reverse':s.direction==='forward')
  const now=Date.parse('2026-10-13T03:00:02Z'),clock={startedAt:now-500,workDeadline:now+100,dispatchedAt:now-10,observedAt:now,contenderPending:s.mode==='wait',poll:1}
  const witness={label:s.label,poll:1,observedAt:'2026-10-13T03:00:02Z',holder:bootstrap.holder,contender:bootstrap.contender,
    contenderDispatch:{backend:bootstrap.contender,sqlSha256:createHash('sha256').update(s.frames.contender).digest('hex'),operationSha256:s.secondOperationSha256},
    held:{criterion:'original-operation-and-owned-backend',backend:bootstrap.holder,transactionStartedAt:'2026-10-13T03:00:01.500Z',sourceSha256:s.firstOperationSha256,
      operationStartedAt:'2026-10-13T03:00:01.600Z',operationFinishedAt:'2026-10-13T03:00:01.700Z',operation:{code:null,result:firstRead?(s.index===5?aggregate:detail):s.index>=13||s.index>=8&&s.direction==='reverse'?{success:true,updated:false}:null}},
    blockers:s.mode==='wait'?[101]:[],waiter:s.mode==='wait'?{wait_event_type:'Lock',wait_event:s.lock.kind==='advisory'?'advisory':'transactionid',state:'active'}:null,
    code:s.mode==='nowait'?'PT409':undefined,immediateMs:s.mode==='nowait'?10:undefined}
  return {bootstrap,clock,witness}
}

function envelopes(s:SurveyCommittedProofManifest['schedules'][number],before:Graph,after:Graph){
const {index,direction,cohort:c}=s
const one=(g:Graph,t:string,key:string,value:string)=>g[t].find(r=>r[key]===value)!
const detail=(g:Graph,member:boolean)=>{const klass=one(g,'public.classrooms','id',c.classroomId);return{classroom:{id:klass.id,teacher_id:klass.teacher_id,archived_at:klass.archived_at},survey:one(g,'public.surveys','id',c.surveyId),questions:g['public.survey_questions'].filter(r=>r.survey_id===c.surveyId),responses:member?g['public.survey_responses'].filter(r=>r.survey_id===c.surveyId&&r.student_id===f.actors[1].id):[]}}
    const aggregate=(g:Graph)=>{const klass=one(g,'public.classrooms','id',c.classroomId),survey=one(g,'public.surveys','id',c.resultSurveyId),r=one(g,'public.survey_responses','id',c.aggregateResponseId);return{classroom:{id:klass.id,teacher_id:klass.teacher_id,archived_at:klass.archived_at},survey:{id:survey.id,title:survey.title,status:survey.status,show_results:survey.show_results,dynamic_responses:survey.dynamic_responses},results:[{question_id:c.aggregateQuestion.id,question_type:'short_text',question_text:c.aggregateQuestion.question_text,options:[],counts:[],total_responses:1,responses:[{response_id:r.id,response_text:r.response_text,submitted_at:r.submitted_at,updated_at:r.updated_at}]}]}}
    const success=(result:unknown)=>({code:null,result}),denied=(code:string)=>({code,result:null})
    const isRead=index<=7,firstRead=isRead&&([1,5,6].includes(index)?direction==='reverse':direction==='forward')
    const read=(g:Graph)=>index===5?aggregate(g):detail(g,[3,4].includes(index))
    const holder=success(firstRead?read(before):index>=13||index>=8&&direction==='reverse'?{success:true,updated:false}:null)
    const secondRead=isRead&&!firstRead,secondRespond=index>=13||index>=8&&direction==='forward'
    const contender=s.mode==='nowait'?denied('PT409'):success(secondRead?read(after):secondRespond?{success:true,updated:false}:null)
    const retry=s.mode==='nowait'?(s.retryCode?denied(s.retryCode):success(secondRead?read(after):secondRespond?{success:true,updated:index===14}:null)):undefined
    const probe=index>=8&&index<=11?'PT409':index===12||index===13?'PT400':null
    const receipts={holder,contender,retry,cachedQuestions:[one(before,'public.survey_questions','id',c.question.id)],freshRead:[2,3,4].includes(index)?denied('PT403'):success(index===5?aggregate(after):detail(after,![0,1,2,6,7].includes(index))),cachedResponseProbe:probe?denied(probe):null}
return receipts
}
return {capturedSeed,seedBefore,admitSeed,changedCase,practicalFixture,envelopes}
}
