import {describe,expect,it} from 'vitest'
import {newClassroomGuidanceAdoptionFixture,classroomGuidanceAdoptionFlows,classroomGuidanceAdoptionSnapshot,classroomGuidanceAdoptionCanonical,classroomGuidanceAdoptionSnapshotHash,classroomGuidanceAdoptionSource,classroomGuidanceAdoptionSqlDescriptors,assertClassroomGuidanceAdoptionSqlDescriptor,classroomGuidanceAdoptionGraphSql,CLASSROOM_GUIDANCE_ADOPTION_CAPS,CLASSROOM_GUIDANCE_ADOPTION_ACCOUNTING} from '../../scripts/contextual-classroom-guidance-adoption-native-fixture'
import {classroomGuidancePreviewGraphScopes} from '../../scripts/contextual-classroom-guidance-preview-native-fixture'
import {buildCourseBlueprintSnapshot,canonicalizeCourseBlueprintSnapshot} from '../../src/lib/server/course-blueprint-versions'
import {contextualClassroomGuidanceAdoptionSourceSuccessSchema,sourceToSnapshotInput} from '../../src/lib/validations/contextual-classroom-guidance-adoption'
describe('inert atomic guidance adoption fixture (CPU only)',()=>{
  const make=()=>newClassroomGuidanceAdoptionFixture('assignmentlist_012345abcdef')
  it('freezes6 fixed two-RPC flows with3 success DTOs and only2 new random Versions',()=>{
    const f=make();expect(f).toEqual(make());expect(Object.isFrozen(f.blueprints)).toBe(true);expect(f.actors).toHaveLength(3);expect(f.classes).toHaveLength(3);expect(f.enrollments).toEqual([])
    expect(classroomGuidanceAdoptionFlows(f).map(c=>c.status)).toEqual([200,200,200,409,403,403]);expect(new Set(f.allocatedIds).size).toBe(f.allocatedIds.length)
    expect(classroomGuidanceAdoptionFlows(f).slice(3).every(c=>c.input.expected_guidance_version_id===f.dedupVersionId)).toBe(true)
  })
  it('independently models complete1001×5 source and canonical snapshot with deterministic identities',()=>{
    const f=make(),source=classroomGuidanceAdoptionSource(f,1,'a'.repeat(64)),row=contextualClassroomGuidanceAdoptionSourceSuccessSchema.parse({data:source,error:null,status:200,statusText:'OK',count:null}).data
    for(const key of['assignments','assessments','lesson_templates','materials','surveys']as const){expect(row.source[key]).toHaveLength(1001);expect(classroomGuidanceAdoptionSnapshot(f,1)[key]).toHaveLength(1001)}
    expect(row.source.blueprint.content_revision).toBe(5006);expect(classroomGuidanceAdoptionCanonical(f,1)).toBe(canonicalizeCourseBlueprintSnapshot(buildCourseBlueprintSnapshot(sourceToSnapshotInput(row))))
    expect(f.blueprints.map((_,n)=>classroomGuidanceAdoptionSnapshotHash(f,n))).toEqual(['d89924310973dabd1bcbbd489adc4308df463ea33f8a4375f7c9d218b27294f7','481b303df40f526f392a6e70dbcf180de8aa3b5c1ca0cac43422403e66ca192c','92a54374a937f06bb40074bfe0b4b74565f50efbcf420c3124bc1ccb5f445cfc'])
    expect(Buffer.byteLength(JSON.stringify(source))).toBeGreaterThan(1048576)
    expect(Buffer.byteLength(classroomGuidanceAdoptionCanonical(f,1))).toBeLessThan(8*1048576)
  })
  it('reuses all63 full-row scope predicates and exact NULL-complement partition with explicit empty enrollment set',()=>{
    const f=make(),scopes=classroomGuidancePreviewGraphScopes();expect(scopes).toHaveLength(63)
    for(const s of scopes){expect(classroomGuidanceAdoptionGraphSql(f,true)).toContain(`from ${s.table} r where (coalesce((${s.predicate}),false))`);expect(classroomGuidanceAdoptionGraphSql(f,false)).toContain(`from ${s.table} r where not (coalesce((${s.predicate}),false))`)}
    expect(classroomGuidanceAdoptionGraphSql(f,true)).toContain('fixture_enrollments(id) as(select null::uuid where false)');expect(classroomGuidanceAdoptionGraphSql(f,true)).toContain('fixture_classes c cross join fixture_actors a')
  })
  it('closes17 SQL frames below65536 and locks the intended-write/temporary-history oracles',()=>{
    const f=make(),rows=classroomGuidanceAdoptionSqlDescriptors(f);expect(rows.map(r=>r.name)).toEqual(['prepare','setup','witness',...Array.from({length:6},(_,n)=>[`source-${n}`,`observe-${n}`]).flat(),'restore-temporary','preservation'])
    for(const r of rows){expect(Buffer.byteLength(r.sql)).toBeLessThanOrEqual(65536);assertClassroomGuidanceAdoptionSqlDescriptor(f,r);expect(r.nativeVerified).toBe(false);expect(r.sql).not.toMatch(/\d(?:or|and|then)\b/i)}
    const setup=rows.find(r=>r.name==='setup')!.sql;expect(setup).toContain('generate_series(1,1001)');expect(setup).toContain('on conflict(subject_user_id,feature_key) do update');expect(setup).not.toMatch(/disable trigger|session_replication_role|set content_revision|insert into private\.pal_membership_generations/i)
    const all=rows.map(r=>r.sql).join('\n');expect(all).not.toMatch(/delete from public\.course_blueprint_versions|set updated_at|set revision/i)
    for(const marker of['adoption_other_graph_changed','adoption_old_version_changed','adoption_new_version_mismatch','adoption_denied_rpc_changed_graph','adoption_transition_mismatch','adoption_restore_semantic_mismatch','adoption_partial_setup'])expect(all).toContain(marker)
    expect(()=>assertClassroomGuidanceAdoptionSqlDescriptor(f,{...rows[0],sql:'select 1;'})).toThrow()
    expect(CLASSROOM_GUIDANCE_ADOPTION_ACCOUNTING).toEqual({sqlFrames:17,http:12,fullGuards:58,leafActions:87,outerActions:10,contentionReserve:45,totalPlannedActions:142})
    expect(CLASSROOM_GUIDANCE_ADOPTION_CAPS).toMatchObject({requests:12,requestBytes:8388608,responseBytes:8388608,bytes:33554432,sessions:1,controls:2048,requestMs:8000})
  })
})
