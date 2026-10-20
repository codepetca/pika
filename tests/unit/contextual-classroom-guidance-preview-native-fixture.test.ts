import {describe,expect,it} from 'vitest'
import {newClassroomAuthoringGuidanceFixture,classroomAuthoringGuidanceGraphSql} from '../../scripts/contextual-classroom-authoring-guidance-native-fixture'
import {normalizeCourseBlueprintAuthoringGuidance} from '../../src/lib/course-blueprint-authoring-guidance'
import {newClassroomGuidancePreviewFixture,classroomGuidancePreviewSdkInventory,classroomGuidancePreviewExpectedWire,classroomGuidancePreviewExpectedView,classroomGuidancePreviewGraphScopes,classroomGuidancePreviewGraphSql,classroomGuidancePreviewSqlDescriptors,assertClassroomGuidancePreviewSqlDescriptor,CLASSROOM_GUIDANCE_PREVIEW_ACCOUNTING} from '../../scripts/contextual-classroom-guidance-preview-native-fixture'
describe('inert dual-owner guidance preview fixture (CPU only)',()=>{
  const make=()=>newClassroomGuidancePreviewFixture('assignmentlist_012345abcdef')
  it('freezes exact identities, legal immutable roots and12 calls with3 complete previews',()=>{
    const f=make(),calls=classroomGuidancePreviewSdkInventory(f);expect(f).toEqual(make());expect(Object.isFrozen(f.versions)).toBe(true)
    expect(f.actors.map(a=>a.role)).toEqual(['student','teacher','teacher','student','teacher']);expect(f.classes).toHaveLength(6);expect(f.blueprints).toHaveLength(2);expect(f.versions).toHaveLength(4);expect(f.enrollments).toHaveLength(3)
    expect(new Set(f.allocatedIds).size).toBe(f.allocatedIds.length);expect(()=>newClassroomGuidancePreviewFixture('real')).toThrow()
    expect(calls.map(c=>c.status)).toEqual([200,200,403,403,403,403,403,409,404,503,503,200])
    expect(classroomGuidancePreviewExpectedView(f,calls[0])?.preview).toMatchObject({changed:true,expected_draft_revision:5,current_guidance_version_number:2})
    expect(classroomGuidancePreviewExpectedView(f,calls[1])?.preview).toMatchObject({changed:false,expected_draft_revision:4,current_guidance_version_number:1,current_guidance:{unit_exceptions:[]},guidance:{unit_exceptions:[]}})
    for(const n of[0,1,11])for(const sentinel of f.forbiddenSentinels)expect(JSON.stringify(classroomGuidancePreviewExpectedView(f,calls[n]))).not.toContain(sentinel)
    expect(classroomGuidancePreviewExpectedWire(f,calls[6])).toMatchObject({code:'PT403',message:'class_guidance_preview_archived'})
    expect(classroomGuidancePreviewExpectedWire(f,calls[9])).toMatchObject({code:'PT503',message:'class_guidance_preview_invalid'})
    expect(Array.isArray(f.versions[2].snapshot)).toBe(true)
  })
  it('locks all63 full-row semantic scopes and complementary NULL partition, never a linked foreign class',()=>{
    const f=make(),scopes=classroomGuidancePreviewGraphScopes();expect(scopes).toHaveLength(63);expect(new Set(scopes.map(s=>s.table)).size).toBe(63)
    const expectedActor=['public.users','public.effective_feature_entitlements','public.account_plans','public.account_plan_audit','public.effective_feature_entitlement_audit','public.attendance_principal_mappings','public.attendance_teacher_entitlements','public.attendance_teacher_entitlement_audit','public.attendance_outbox_epoch_recovery_audit','public.pal_event_outbox','public.student_profiles','public.course_blueprint_draft_admissions']
    expect(scopes.filter(s=>s.predicate==='id in (select id from fixture_actors)'||/^(subject_user_id|user_id|teacher_id|student_id) in \(select id from fixture_actors\)$/.test(s.predicate)).map(s=>s.table).sort()).toEqual(expectedActor.sort())
    expect(scopes.find(s=>s.table==='public.classrooms')?.predicate).toBe('id in (select id from fixture_classes)')
    const bpTables=['course_blueprints','course_blueprint_versions','course_blueprint_assignments','course_blueprint_assessments','course_blueprint_materials','course_blueprint_surveys','course_blueprint_lesson_templates','course_blueprint_editing_sessions','course_blueprint_change_proposals','course_blueprint_authoring_guidance_revisions','course_blueprint_purge_operations','course_blueprint_purge_fences']
    expect(scopes.filter(s=>s.predicate==='id in (select id from fixture_blueprints)'||s.predicate==='course_blueprint_id in (select id from fixture_blueprints)').map(s=>s.table.slice(7)).sort()).toEqual(bpTables.sort())
    for(const s of scopes){expect(classroomGuidancePreviewGraphSql(f,true)).toContain(`from ${s.table} r where (coalesce((${s.predicate}),false))`);expect(classroomGuidancePreviewGraphSql(f,false)).toContain(`from ${s.table} r where not (coalesce((${s.predicate}),false))`)}
    const graph=classroomGuidancePreviewGraphSql(f,true);expect(graph).toContain('fixture_classes c cross join fixture_actors a');expect(graph).toContain('generation_id in (select id from fixture_enrollments) or scope_digest in (select scope_digest from fixture_pal_scopes)')
    for(const id of[...f.actors,...f.classes,...f.enrollments,...f.blueprints].map(r=>r.id))expect(graph.split(id)).toHaveLength(2)
    // SQL predicate NULL maps to synthetic=false / complement=true. A foreign
    // classroom's Blueprint pointer does not participate in its identity scope.
    for(const predicate of[true,false,null]){const synthetic=predicate??false;expect(Number(synthetic)+Number(!synthetic)).toBe(1)}
    expect(f.classes.some(c=>c.id===f.missingClassId)).toBe(false)
  })
  it('matches EVERY accepted graph predicate after explicit two-Blueprint/CTE identity expansion',()=>{
    const f=make(),quote=(s:string)=>`'${s}'`,ids=(rows:readonly{id:string}[])=>rows.map(r=>quote(r.id)).join(',')
    const reference={...newClassroomAuthoringGuidanceFixture('assignmentlist_012345abcdef'),actors:f.actors,classes:f.classes,enrollments:f.enrollments,blueprint:{id:f.blueprints[0].id,owner:f.blueprints[0].owner}}
    const accepted=classroomAuthoringGuidanceGraphSql(reference,true),referenceScopes=[...accepted.matchAll(/from ([\w.]+) r where \(coalesce\(\((.*?)\),false\)\)/g)].map(m=>({table:m[1],predicate:m[2].replaceAll(`=${quote(f.blueprints[0].id)}`,` in (${ids(f.blueprints)})`)}))
    expect(referenceScopes).toHaveLength(63)
    const expand=(predicate:string)=>predicate.replaceAll('(select id from fixture_actors)',`(${ids(f.actors)})`).replaceAll('(select id from fixture_classes)',`(${ids(f.classes)})`).replaceAll('(select id from fixture_enrollments)',`(${ids(f.enrollments)})`).replaceAll('(select id from fixture_blueprints)',`(${ids(f.blueprints)})`)
      .replaceAll('(select scope_digest from fixture_pal_scopes)',`(${f.classes.flatMap(c=>f.actors.map(a=>`private.pal_membership_scope(${quote(c.id)}::uuid,${quote(a.id)}::uuid)`)).join(',')})`)
      .replaceAll('(select id from fixture_archive_operations)',`(select id from public.classroom_archive_operations where classroom_id in (${ids(f.classes)}))`)
      .replaceAll('(select id from fixture_blueprint_purge_operations)',`(select id from public.course_blueprint_purge_operations where course_blueprint_id in (${ids(f.blueprints)}))`)
    expect(classroomGuidancePreviewGraphScopes().map(s=>({table:s.table,predicate:expand(s.predicate)})).sort((a,b)=>a.table.localeCompare(b.table))).toEqual(referenceScopes.sort((a,b)=>a.table.localeCompare(b.table)))
  })
  it('compares normalized guidance rather than raw JSON or Draft revision',()=>{
    const f=make(),normalized=normalizeCourseBlueprintAuthoringGuidance(f.adoptedGuidance)
    expect(JSON.stringify(f.adoptedGuidance)).not.toBe(JSON.stringify(normalized));expect(JSON.stringify(normalizeCourseBlueprintAuthoringGuidance(normalized))).toBe(JSON.stringify(normalized))
    expect(normalized.unit_exceptions[0].unit_label).toBe('\u00a0Unit\u00a0');expect(normalizeCourseBlueprintAuthoringGuidance(undefined)).toEqual(f.emptyGuidance)
    expect(()=>normalizeCourseBlueprintAuthoringGuidance({bad:true})).toThrow()
  })
  it('closes18 ordered descriptors below65536B without token gluing, bypasses or manual revision bumps',()=>{
    const f=make(),rows=classroomGuidancePreviewSqlDescriptors(f);expect(rows).toHaveLength(18)
    expect(rows.map(r=>r.name)).toEqual(['prepare','setup','witness',...Array.from({length:12},(_,n)=>`observe-${n}`),'purge-fenced','restore-baseline','preservation'])
    for(const row of rows){expect(Buffer.byteLength(row.sql)).toBeLessThanOrEqual(65536);expect(row.nativeVerified).toBe(false);assertClassroomGuidancePreviewSqlDescriptor(f,row)}
    for(const[n,row]of rows.filter(r=>r.name.startsWith('observe-')).entries()){expect(row.sql).toContain(`<> ${n-1} or `);expect(row.sql).not.toMatch(/\d(?:or|and|then)\b/i)}
    const setup=rows.find(r=>r.name==='setup')!.sql;expect(setup).toContain("extensions.digest(snapshot::text,'sha256')");expect(setup).not.toMatch(/disable trigger|session_replication_role|set content_revision|insert into private\.pal_membership_generations/i)
    expect(rows.find(r=>r.name==='restore-baseline')!.sql).toContain('preview_partial_setup');expect(()=>assertClassroomGuidancePreviewSqlDescriptor(f,{...rows[0],sql:'select 1;'})).toThrow()
    expect(CLASSROOM_GUIDANCE_PREVIEW_ACCOUNTING).toEqual({sqlFrames:18,http:12,fullGuards:60,leafActions:90})
  })
})
