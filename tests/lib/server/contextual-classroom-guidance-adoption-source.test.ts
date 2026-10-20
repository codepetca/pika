import {createHash} from 'node:crypto'
import {readFileSync} from 'node:fs'
import ts from 'typescript'
import type {CourseBlueprintDetail} from '@/types'
import {describe,expect,it} from 'vitest'
import {buildCourseBlueprintSnapshot,canonicalizeCourseBlueprintSnapshot,hashCourseBlueprintSnapshot,type CourseBlueprintSnapshotSource} from '@/lib/server/course-blueprint-versions'
import {contextualClassroomGuidanceAdoptionInputSchema,contextualClassroomGuidanceAdoptionQuerySchema,contextualClassroomGuidanceAdoptionParamsSchema,contextualClassroomGuidanceAdoptionSourceSuccessSchema,contextualClassroomGuidanceAdoptionWriteSuccessSchema,contextualClassroomGuidanceAdoptionFailureSchema,sourceToSnapshotInput} from '@/lib/validations/contextual-classroom-guidance-adoption'
const id=(n:number)=>`10000000-0000-4000-8000-${n.toString(16).padStart(12,'0')}`
function raw(){
  const blueprint={id:id(1),teacher_id:id(2),content_revision:7,title:' Course ',subject:' CS ',grade_level:'11',course_code:'ICS3U',term_template:'Semester',overview_markdown:'Overview\r\n',outline_markdown:'Outline',resources_markdown:'Resources',authoring_guidance:{course_expectations_markdown:' Rules ',assignment_guidance_markdown:'',test_guidance_markdown:'',unit_exceptions:[{id:id(30),unit_label:' \t\u00a0Unit\u00a0\n ',assignment_guidance_markdown:'',test_guidance_markdown:''}]},gradebook_use_weights:true,gradebook_assignments_weight:70,gradebook_tests_weight:30,planned_site_slug:'course',planned_site_published:false,planned_site_config:{overview:false,legacy_extra:{keep:true}}}
  const row={actor_id:id(2),classroom_id:id(3),classroom:{id:id(3),teacher_id:id(2),archived_at:null,source_blueprint_id:id(1),source_blueprint_version_id:id(4),authoring_guidance_version_id:id(5)},versions:{content:{id:id(4),course_blueprint_id:id(1)},guidance:{id:id(5),course_blueprint_id:id(1),version_number:2}},source:{blueprint,
    assignments:[{id:id(6),course_blueprint_id:id(1),artifact_id:id(7),title:' Assignment ',instructions_markdown:' Instructions ',submission_requirements_json:[{id:id(8),type:'link',label:' Label ',instructions:' Instructions ',required:null,position:-3,validation_policy_json:{mode:'expected_domain',expected_domains:[' HTTPS://Example.COM/path '],retained_extra:{value:true}},retained_extra:'raw'}],default_due_days:-3,default_due_time:'23:59',points_possible:0,gradebook_weight:0,include_in_final:true,is_draft:true,track_authenticity:false,position:-5}],
    assessments:[{id:id(9),course_blueprint_id:id(1),artifact_id:id(10),assessment_type:'test',title:' Test ',content:{title:' Raw title ',show_results:true,questions:[{id:id(11),question_type:'open_response',question_text:' Question ',options:[],correct_option:null,answer_key:' Key ',sample_solution:null,points:1.25,response_max_chars:20000,response_monospace:true,retained_extra:{nested:['keep',1]}}],source_format:'markdown',source_markdown:'a\r\nb',retained_extra:'content raw'},documents:[{id:id(12),title:' Document ',source:'link',url:' https://example.invalid/a ',snapshot_path:'private/snapshot',snapshot_content_type:'text/html',retained_extra:{keep:true}}],points_possible:2.5,gradebook_weight:999,include_in_final:true,position:-2}],
    lesson_templates:[{id:id(13),course_blueprint_id:id(1),artifact_id:id(14),title:'Lesson',content_markdown:'Lesson markdown',position:-4}],materials:[{id:id(15),course_blueprint_id:id(1),artifact_id:id(16),title:'Material',content_markdown:'Material markdown',position:-4}],surveys:[{id:id(17),course_blueprint_id:id(1),artifact_id:id(18),title:'Survey',show_results:true,dynamic_responses:false,questions_json:[{id:id(19),question_type:'short_text',question_text:' Survey question ',options:[],response_max_chars:5000,position:-1,retained_extra:{keep:true}}],position:-3}]},counts:{assignments:1,assessments:1,lesson_templates:1,materials:1,surveys:1},source_sha256:'a'.repeat(64)}
  return{data:row,error:null,status:200,statusText:'OK',count:null}
}
describe('guidance adoption persisted source codec and unchanged builder',()=>{
  it('retains raw nested JSON until the canonical builder and supplies only consumed input fields',()=>{
    const input=raw(),before=structuredClone(input),parsed=contextualClassroomGuidanceAdoptionSourceSuccessSchema.parse(input),source:CourseBlueprintSnapshotSource=sourceToSnapshotInput(parsed.data)
    expect(input).toEqual(before);expect(parsed.data.source).toEqual(before.data.source)
    expect(source).not.toHaveProperty('teacher_id');expect(source).not.toHaveProperty('linked_classrooms');expect(source.assignments[0]).not.toHaveProperty('created_at')
    const oldDetailStillAssignable:CourseBlueprintDetail extends CourseBlueprintSnapshotSource?true:false=true;expect(oldDetailStillAssignable).toBe(true)
    expect(Object.keys(source).sort()).toEqual(['id','content_revision','title','subject','grade_level','course_code','term_template','overview_markdown','outline_markdown','resources_markdown','authoring_guidance','gradebook_use_weights','gradebook_assignments_weight','gradebook_tests_weight','planned_site_slug','planned_site_published','planned_site_config','assignments','assessments','lesson_templates','materials','surveys'].sort())
    expect(Object.keys(source.assignments[0]).sort()).toEqual(['artifact_id','title','instructions_markdown','submission_requirements_json','default_due_days','default_due_time','points_possible','gradebook_weight','include_in_final','is_draft','track_authenticity','position'].sort())
    expect(Object.keys(source.assessments[0]).sort()).toEqual(['artifact_id','assessment_type','title','content','documents','points_possible','gradebook_weight','include_in_final','position'].sort())
    expect(source.assessments[0].documents).toEqual(before.data.source.assessments[0].documents)
    const snapshot=buildCourseBlueprintSnapshot(source)
    expect(snapshot.authoring_guidance.unit_exceptions[0].unit_label).toBe('\u00a0Unit\u00a0');expect(snapshot.assignments[0].submission_requirements[0]).toMatchObject({label:'Label',instructions:'Instructions',required:true,position:-3,validation_policy_json:{mode:'expected_domain',expected_domains:['example.com']}})
    expect(snapshot.assessments[0].content.questions[0]).toHaveProperty('retained_extra',{nested:['keep',1]});expect(snapshot.assessments[0].content.source_markdown).toBe('a\r\nb')
    expect(snapshot.assessments[0].documents[0]).toMatchObject({title:'Document',url:'https://example.invalid/a'});expect(snapshot.assessments[0].documents[0]).not.toHaveProperty('snapshot_path')
    expect(snapshot.planned_site.config).toMatchObject({overview:false,outline:true});expect(hashCourseBlueprintSnapshot(snapshot)).toBe(createHash('sha256').update(canonicalizeCourseBlueprintSnapshot(snapshot)).digest('hex'))
  })
  it('binds every owner/parent/count and rejects duplicate identity or artifact facts',()=>{
    const edits=[(r:ReturnType<typeof raw>)=>r.data.actor_id=id(90),(r:ReturnType<typeof raw>)=>r.data.classroom.id=id(90),(r:ReturnType<typeof raw>)=>r.data.source.blueprint.teacher_id=id(90),(r:ReturnType<typeof raw>)=>r.data.versions.content.course_blueprint_id=id(90),(r:ReturnType<typeof raw>)=>r.data.versions.guidance.id=id(90),(r:ReturnType<typeof raw>)=>r.data.source.materials[0].course_blueprint_id=id(90),(r:ReturnType<typeof raw>)=>r.data.counts.surveys=2,(r:ReturnType<typeof raw>)=>r.data.source.assignments.push({...r.data.source.assignments[0]}),(r:ReturnType<typeof raw>)=>r.data.source.materials[0].artifact_id=r.data.source.assignments[0].artifact_id]
    for(const edit of edits){const r=raw();edit(r);expect(contextualClassroomGuidanceAdoptionSourceSuccessSchema.safeParse(r).success).toBe(false)}
  })
  it.each(['1',NaN,Infinity,-Infinity,Number.MAX_SAFE_INTEGER+1])('does not coerce unsafe revision %s',value=>{
    const r=raw();expect(contextualClassroomGuidanceAdoptionSourceSuccessSchema.safeParse({...r,data:{...r.data,source:{...r.data.source,blueprint:{...r.data.source.blueprint,content_revision:value}}}}).success).toBe(false)
  })
  it('validates int32 negative positions, finite domain bounds and malformed preserved JSON',()=>{
    for(const patch of[{position:-2147483649},{position:2147483648},{position:'1'},{gradebook_weight:-1},{gradebook_weight:1000},{points_possible:10000},{points_possible:NaN},{submission_requirements_json:[{id:id(8),type:'link',label:7}]}]){const r=raw();expect(contextualClassroomGuidanceAdoptionSourceSuccessSchema.safeParse({...r,data:{...r.data,source:{...r.data.source,assignments:[{...r.data.source.assignments[0],...patch}]}}}).success).toBe(false)}
    const r=raw();r.data.source.assignments[0].position=-2147483648;expect(contextualClassroomGuidanceAdoptionSourceSuccessSchema.safeParse(r).success).toBe(true)
    const bad=raw();expect(contextualClassroomGuidanceAdoptionSourceSuccessSchema.safeParse({...bad,data:{...bad.data,source:{...bad.data.source,assessments:[{...bad.data.source.assessments[0],content:{...bad.data.source.assessments[0].content,questions:[{...bad.data.source.assessments[0].content.questions[0],points:'2'}]}}]}}}).success).toBe(false)
    for(const points of[-9999.99,-0.29,0,0.29,9999.99]){const value=raw();value.data.source.assignments[0].points_possible=points;expect(contextualClassroomGuidanceAdoptionSourceSuccessSchema.safeParse(value).success).toBe(true)}
    for(const points of[-10000,1.234]){const value=raw();value.data.source.assignments[0].points_possible=points;expect(contextualClassroomGuidanceAdoptionSourceSuccessSchema.safeParse(value).success).toBe(false)}
  })
  it('leaves canonical normalizer-supported documents/site/guidance raw and handles legacy empty content',()=>{
    for(const documents of[null,false,17,'legacy',{},[{unexpected:'legacy document'}]]){const r=raw(),source=r.data.source;const parsed=contextualClassroomGuidanceAdoptionSourceSuccessSchema.parse({...r,data:{...r.data,source:{...source,blueprint:{...source.blueprint,authoring_guidance:null,planned_site_config:17},assessments:[{...source.assessments[0],content:{},documents}]}}})
      const input=sourceToSnapshotInput(parsed.data);expect(input.assessments[0].documents).toEqual(documents);expect(input.planned_site_config).toBe(17);expect(input.authoring_guidance).toBeNull()
      const snapshot=buildCourseBlueprintSnapshot(input);expect(snapshot.assessments[0].content).toMatchObject({title:' Test ',show_results:false,questions:[]});expect(snapshot.assessments[0].documents).toEqual([]);expect(snapshot.authoring_guidance.unit_exceptions).toEqual([])
    }
    const r=raw();expect(contextualClassroomGuidanceAdoptionSourceSuccessSchema.safeParse({...r,data:{...r.data,source:{...r.data.source,blueprint:{...r.data.source.blueprint,authoring_guidance:{invalid:true}}}}}).success).toBe(false)
  })
  it('retains more than20 raw documents and rejects non-JSON nested data without prestripping',()=>{
    const r=raw(),documents=Array.from({length:21},(_,n)=>({...r.data.source.assessments[0].documents[0],id:id(500+n)})),parsed=contextualClassroomGuidanceAdoptionSourceSuccessSchema.parse({...r,data:{...r.data,source:{...r.data.source,assessments:[{...r.data.source.assessments[0],documents}]}}})
    const input=sourceToSnapshotInput(parsed.data);expect(input.assessments[0].documents).toEqual(documents);expect(buildCourseBlueprintSnapshot(input).assessments[0].documents).toHaveLength(20)
    const invalid={...r,data:{...r.data,source:{...r.data.source,assessments:[{...r.data.source.assessments[0],content:{...r.data.source.assessments[0].content,unknown:{notJson:()=>true}}}]}}};expect(contextualClassroomGuidanceAdoptionSourceSuccessSchema.safeParse(invalid).success).toBe(false)
  })
  it('normalizes identity only; strict inputs/envelopes expose no caller snapshot authority',()=>{
    const input={blueprint_id:id(0xabcdef).toUpperCase(),expected_content_version_id:id(4),expected_guidance_version_id:id(5),expected_draft_revision:7}
    expect(contextualClassroomGuidanceAdoptionInputSchema.parse(input).blueprint_id).toBe(id(0xabcdef));expect(contextualClassroomGuidanceAdoptionParamsSchema.parse({id:id(0xabcdef).toUpperCase()})).toEqual({id:id(0xabcdef)})
    expect(contextualClassroomGuidanceAdoptionQuerySchema.parse({actorId:id(2),classroomId:id(3),...input})).toMatchObject({actorId:id(2),classroomId:id(3)})
    expect(contextualClassroomGuidanceAdoptionInputSchema.safeParse({...input,snapshot:{}}).success).toBe(false)
    const failure={data:null,error:{code:'PT409',message:'class_guidance_adoption_changed',details:null,hint:null},status:409,statusText:'Conflict',count:null};expect(contextualClassroomGuidanceAdoptionFailureSchema.safeParse(failure).success).toBe(true);expect(contextualClassroomGuidanceAdoptionFailureSchema.safeParse({...failure,extra:true}).success).toBe(false)
    const write={data:{actor_id:id(2),classroom_id:id(3),blueprint_id:id(1),content_version_id:id(4),previous_guidance_version_id:id(5),source_sha256:'a'.repeat(64),guidance_version:{id:id(20),course_blueprint_id:id(1),version_number:3,source_draft_revision:7,snapshot_sha256:'b'.repeat(64)}},error:null,status:200,statusText:'OK',count:1}
    expect(contextualClassroomGuidanceAdoptionWriteSuccessSchema.safeParse(write).success).toBe(true);expect(contextualClassroomGuidanceAdoptionWriteSuccessSchema.safeParse({...write,data:{...write.data,guidance_version:{...write.data.guidance_version,course_blueprint_id:id(90)}}}).success).toBe(false)
  })
  it('preserves complete collections above editor caps with a deterministic full canonical digest',()=>{
    const r=raw();r.data.source.assignments=Array.from({length:1001},(_,n)=>({...r.data.source.assignments[0],id:id(10000+n),artifact_id:id(20000+n),position:n,submission_requirements_json:[]}))
    r.data.source.assessments=Array.from({length:1001},(_,n)=>({...r.data.source.assessments[0],id:id(30000+n),artifact_id:id(40000+n),position:n,content:{...r.data.source.assessments[0].content,questions:[]},documents:[]}))
    r.data.source.lesson_templates=Array.from({length:1001},(_,n)=>({...r.data.source.lesson_templates[0],id:id(50000+n),artifact_id:id(60000+n),position:n}))
    r.data.source.materials=Array.from({length:1001},(_,n)=>({...r.data.source.materials[0],id:id(70000+n),artifact_id:id(80000+n),position:1001+n}))
    r.data.source.surveys=Array.from({length:1001},(_,n)=>({...r.data.source.surveys[0],id:id(90000+n),artifact_id:id(100000+n),position:2002+n,questions_json:[]}))
    for(const key of['assignments','assessments','lesson_templates','materials','surveys']as const)r.data.counts[key]=1001
    const snapshot=buildCourseBlueprintSnapshot(sourceToSnapshotInput(contextualClassroomGuidanceAdoptionSourceSuccessSchema.parse(r).data));for(const key of['assignments','assessments','lesson_templates','materials','surveys']as const)expect(snapshot[key]).toHaveLength(1001)
    expect(hashCourseBlueprintSnapshot(snapshot)).toBe(hashCourseBlueprintSnapshot(buildCourseBlueprintSnapshot(sourceToSnapshotInput(contextualClassroomGuidanceAdoptionSourceSuccessSchema.parse(r).data))))
    expect(hashCourseBlueprintSnapshot(snapshot)).toBe('ac478bdc34e06baabebff4712f560d3686c660527d9e22d63b95790f97ffda16')
  })
  it('keeps the builder/canonical/hash implementation bodies byte-identical',()=>{
    const source=readFileSync(new URL('../../../src/lib/server/course-blueprint-versions.ts',import.meta.url),'utf8')
    expect(source).toContain('detail: CourseBlueprintSnapshotSource');expect(source).not.toContain('linked_classrooms: []')
    const ast=ts.createSourceFile('versions.ts',source,ts.ScriptTarget.Latest,true),expected={buildCourseBlueprintSnapshot:'4e076d74e3bc44249d23c687d866684185ded093193472f4a92ce906b6e38a11',canonicalize:'e58e05f57138b4d7ed8a75c1c5475b8896bfee3529c718c425be2c3bfb39504b',canonicalizeCourseBlueprintSnapshot:'726ea5a5f79fdd0ff14f3e801fdfdd9338029d26e53aa0983c8de8575931f0f4',hashCanonicalJson:'5ad509c5d7a82d60e597c5132ab793f4996661db8f1475411aa2f9bd30c434a5',hashCourseBlueprintSnapshot:'d1fecc71b915f808c7b93f57c69b18e4c3f8af984df03760c947f4e2d7433a84'}
    for(const[name,digest]of Object.entries(expected)){const fn=ast.statements.find((node):node is ts.FunctionDeclaration=>ts.isFunctionDeclaration(node)&&node.name?.text===name);expect(fn?.body).toBeDefined();expect(createHash('sha256').update(fn!.body!.getText(ast)).digest('hex')).toBe(digest)}
  })
})
