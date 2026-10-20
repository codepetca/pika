import {describe,expect,it} from 'vitest'
import {newClassroomListReorderFixture,classroomListReorderSdkInventory,classroomListReorderSqlDescriptors,assertClassroomListReorderSqlDescriptor,CLASSROOM_LIST_REORDER_ACCOUNTING} from '../../scripts/contextual-classroom-list-reorder-native-fixture'
describe('inert classroom-list reorder fixture (CPU only)',()=>{
  const f=()=>newClassroomListReorderFixture('assignmentlist_012345abcdef')
  it('freezes deterministic synthetic identities and exact12 actual-adapter calls',()=>{
    expect(f()).toEqual(f());expect(Object.isFrozen(f().classes)).toBe(true)
    expect(()=>newClassroomListReorderFixture('real-account')).toThrow()
    const calls=classroomListReorderSdkInventory(f())
    expect(calls).toHaveLength(12);expect(calls.map(c=>c.status)).toEqual([200,200,200,200,400,400,400,400,400,200,503,200])
    expect(calls[0].args).toEqual(calls[1].args);expect(calls[3].args.p_classroom_ids).toEqual([])
    expect(calls.every(c=>new Set(c.args.p_classroom_ids).size===c.args.p_classroom_ids.length)).toBe(true)
  })
  it('closes18 exact frames under65536 bytes and original90-action leaf accounting',()=>{
    const rows=classroomListReorderSqlDescriptors(f())
    expect(rows).toHaveLength(18);expect(Math.max(...rows.map(r=>Buffer.byteLength(r.sql)))).toBeLessThanOrEqual(65536)
    for(const row of rows){assertClassroomListReorderSqlDescriptor(f(),row);expect(row.nativeVerified).toBe(false)}
    expect(()=>assertClassroomListReorderSqlDescriptor(f(),{...rows[0],sql:'select 1;'})).toThrow()
    expect(CLASSROOM_LIST_REORDER_ACCOUNTING).toEqual({sqlFrames:18,http:12,fullGuards:60,leafActions:90})
  })
  it('preserves complete graphs, exact revision deltas, timestamp windows and semantic-only restoration',()=>{
    const rows=classroomListReorderSqlDescriptors(f()),observe=rows.find(r=>r.name==='observe-0')!.sql,restore=rows.find(r=>r.name==='restore-baseline')!.sql
    for(const marker of ['to_jsonb(r)','account_plan_audit','pal_membership_generations','attendance_check_in_facts','student_profiles'])expect(observe).toContain(marker)
    expect(observe).toContain("-'position'-'updated_at'");expect(observe).toContain("-'revision'-'updated_at'")
    expect(observe).toContain("::bigint+1");expect(observe).toContain('window_start');expect(observe).toContain('statement_timestamp()')
    expect(restore).toContain('set position=');expect(restore).not.toMatch(/set\s+(?:updated_at|revision)|disable\s+trigger|session_replication_role/i)
    expect(restore).toContain('c.position is distinct from r.position')
    expect(rows.find(r=>r.name==='setup')!.sql).toContain("set enabled=false")
    expect(rows.filter(r=>r.name!=='setup').every(r=>!r.sql.includes('set enabled='))).toBe(true)
    const negative=rows.find(r=>r.name==='observe-4')!.sql
    expect(negative).toContain("v_order:='{}'::jsonb")
    expect(negative).toContain('reorder_untargeted_class_changed');expect(negative).toContain('reorder_untargeted_revision_changed')
    expect(rows.find(r=>r.name==='preservation')!.sql).toContain('checkpoint')
  })
  it('has no numeric-keyword token gluing in any observation frame',()=>{
    const observations=classroomListReorderSqlDescriptors(f()).filter(r=>r.name.startsWith('observe-'))
    expect(observations).toHaveLength(12)
    observations.forEach((row,n)=>{expect(row.sql).toContain(`<> ${n-1} or `);expect(row.sql).not.toMatch(/\d(?:or|and|then)\b/i)})
  })
})
