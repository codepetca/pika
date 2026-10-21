import {describe,expect,it} from 'vitest'
import {newClassroomAuthoringGuidanceFixture,classroomAuthoringGuidanceSdkInventory,classroomAuthoringGuidanceSqlDescriptors,assertClassroomAuthoringGuidanceSqlDescriptor,
  classroomAuthoringGuidanceExpectedWire,classroomAuthoringGuidanceExpectedView,CLASSROOM_AUTHORING_GUIDANCE_CAPS,CLASSROOM_AUTHORING_GUIDANCE_ACCOUNTING} from '../../scripts/contextual-classroom-authoring-guidance-native-fixture'
describe('inert frozen authoring guidance fixture (CPU only)',()=>{
  const fixture=()=>newClassroomAuthoringGuidanceFixture('assignmentlist_012345abcdef')
  it('freezes five actors/six classes/four immutable versions without cross-owner authorization',()=>{
    const f=fixture();expect(f).toEqual(fixture());expect(Object.isFrozen(f.versions)).toBe(true);expect(f.classes).toHaveLength(6);expect(f.enrollments).toHaveLength(3)
    expect(f.blueprint.owner).toBe(f.actors[4].id);expect(f.classes[0].owner).toBe(f.actors[0].id)
    expect(new Set(f.allocatedIds).size).toBe(f.allocatedIds.length);expect(()=>newClassroomAuthoringGuidanceFixture('real-user')).toThrow()
    expect(classroomAuthoringGuidanceSdkInventory(f).map(c=>c.status)).toEqual([200,200,200,200,200,200,403,403,403,404,503,200])
  })
  it('binds complete500/200 title lists, selected provenance, inherited/null rules and missing pointers',()=>{
    const f=fixture(),calls=classroomAuthoringGuidanceSdkInventory(f),adopted=classroomAuthoringGuidanceExpectedView(f,calls[0])!.context!
    expect(adopted.course.assignment_titles).toHaveLength(500);expect(adopted.course.test_titles).toHaveLength(200)
    expect(adopted.course.assignment_titles[0]).toBe(' \t ');expect(adopted.course.assignment_titles[1]).toBe('  Frozen Assignment 002  ')
    expect(adopted.content_version_id).toBe(f.versions[0].id);expect(adopted.source_blueprint_version_id).toBe(f.versions[1].id)
    expect(adopted.guidance.unit_exceptions[0].unit_label).toBe('\u00a0Unit\u00a0')
    for(const n of[1,2])expect(classroomAuthoringGuidanceExpectedView(f,calls[n])!.context!.guidance.unit_exceptions).toEqual([])
    for(const n of[3,4,5,11])expect(classroomAuthoringGuidanceExpectedView(f,calls[n])).toEqual({context:null})
    const wire=classroomAuthoringGuidanceExpectedWire(f,calls[0]);expect(wire).toMatchObject({version_parents:{content:f.blueprint.id,guidance:f.blueprint.id}})
    expect(Buffer.byteLength(JSON.stringify(wire))).toBeGreaterThan(16384);expect(Buffer.byteLength(JSON.stringify(wire))).toBeLessThanOrEqual(65536)
    for(const sentinel of f.forbiddenSentinels)expect(JSON.stringify(adopted)).not.toContain(sentinel)
  })
  it('closes18 frames below65536 bytes and no numeric-keyword boundary gluing',()=>{
    const f=fixture(),rows=classroomAuthoringGuidanceSqlDescriptors(f);expect(rows).toHaveLength(18)
    for(const row of rows){assertClassroomAuthoringGuidanceSqlDescriptor(f,row);expect(Buffer.byteLength(row.sql)).toBeLessThanOrEqual(65536);expect(row.nativeVerified).toBe(false)}
    rows.filter(r=>r.name.startsWith('observe-')).forEach((r,n)=>{expect(r.sql).toContain(`<> ${n-1} or `);expect(r.sql).not.toMatch(/\d(?:or|and|then)\b/i)})
    expect(()=>assertClassroomAuthoringGuidanceSqlDescriptor(f,{...rows[0],sql:'select 1;'})).toThrow()
    expect(CLASSROOM_AUTHORING_GUIDANCE_ACCOUNTING).toEqual({sqlFrames:18,http:12,fullGuards:60,leafActions:90})
    expect(CLASSROOM_AUTHORING_GUIDANCE_CAPS).toMatchObject({responseBytes:65536,bytes:1048576,sessions:1,controls:2048,requestMs:8000})
  })
  it('seeds genuine JSONB hashes and normal triggers before baseline, preserving complete Blueprint/history graphs',()=>{
    const rows=classroomAuthoringGuidanceSqlDescriptors(fixture()),setup=rows.find(r=>r.name==='setup')!.sql,observe=rows.find(r=>r.name==='observe-0')!.sql
    expect(setup).toContain('generate_series(1,500)');expect(setup).toContain('generate_series(1,200)');expect(setup).toContain("extensions.digest(snapshot::text,'sha256')")
    expect(setup).not.toMatch(/disable trigger|session_replication_role|insert into private\.pal_membership_generations/i)
    for(const table of['course_blueprints','course_blueprint_versions','course_blueprint_assignments','course_blueprint_assessments','course_blueprint_authoring_guidance_revisions','course_blueprint_draft_admissions','classroom_guided_draft_provenance','course_blueprint_purge_fences','classroom_archives','pal_membership_generations'])expect(observe).toContain(table)
    expect(observe).toContain('to_jsonb(r)');expect(observe).toContain('where not (');expect(rows.find(r=>r.name==='restore-baseline')!.sql).toContain('guidance_partial_setup')
  })
})
