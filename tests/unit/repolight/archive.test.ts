import { describe, expect, it } from 'vitest'
import { detachRepoLightArchiveResources } from '@/lib/server/repolight-archive'
import { CLASSROOM_ARCHIVE_V1_RESOURCES, CLASSROOM_ARCHIVE_V2_RESOURCES, resolveClassroomArchiveV2Resources } from '@/lib/contracts/classroom-archive-resources'

describe('portable RepoLight reports', () => {
  it('adapts old archives to empty additive tables without changing v1', () => {
    const before={assignments:[{id:'assignment'}]}
    const result=detachRepoLightArchiveResources(before)
    expect(result.assignment_repolight_runs).toEqual([])
    expect(result.assignment_repolight_reports).toEqual([])
    expect(result.assignment_repolight_feedback_imports).toEqual([])
    expect(before).not.toHaveProperty('assignment_repolight_runs')
    expect(CLASSROOM_ARCHIVE_V1_RESOURCES.some(row=>String(row.table).startsWith('assignment_repolight'))).toBe(false)
  })
  it('preserves immutable report facts but never restores a live provider binding or lease', () => {
    const original={assignment_repolight_runs:[{id:'run',subject_binding_id:'private',detached:false,status:'running',lease_token:'token',lease_generation:3,lease_expires_at:'future',next_retry_at:'future',source_json:{retained:'historical'}}],assignment_repolight_reports:[{run_id:'run',result_json:{bundle:{facts:'immutable'}},report_digest:'digest'}],assignment_repolight_feedback_imports:[{id:'receipt'}]}
    const result=detachRepoLightArchiveResources(original)
    expect(result.assignment_repolight_runs[0]).toMatchObject({subject_binding_id:null,detached:true,status:'stale',lease_token:null,lease_expires_at:null,next_retry_at:null})
    expect(result.assignment_repolight_reports).toEqual(original.assignment_repolight_reports)
    expect(result.assignment_repolight_feedback_imports).toEqual(original.assignment_repolight_feedback_imports)
    expect(original.assignment_repolight_runs[0].detached).toBe(false)
  })
  it('keeps completed reports complete while detaching all control authority', () => {
    expect(detachRepoLightArchiveResources({assignment_repolight_runs:[{status:'completed'}]}).assignment_repolight_runs[0]).toMatchObject({status:'completed',detached:true,subject_binding_id:null})
  })
  it('defaults only a missing legacy poll failure counter before typed restore staging', () => {
    const result = detachRepoLightArchiveResources({ assignment_repolight_runs: [
      { id: 'legacy', status: 'completed' }, { id: 'current', status: 'failed', poll_failure_count: 2 },
      { id: 'invalid', status: 'failed', poll_failure_count: null },
    ] })
    expect(result.assignment_repolight_runs.map(row => row.poll_failure_count)).toEqual([0, 2, null])
  })
  it('requires an entire additive report resource family, retaining strict manifest inventory', () => {
    const all=CLASSROOM_ARCHIVE_V2_RESOURCES.map(row=>row.table)
    expect(resolveClassroomArchiveV2Resources(all)).toHaveLength(all.length)
    expect(()=>resolveClassroomArchiveV2Resources(all.filter(name=>name!=='assignment_repolight_reports'))).toThrow()
    expect(resolveClassroomArchiveV2Resources(all.filter(name=>!name.startsWith('assignment_repolight'))).some(row=>row.table.startsWith('assignment_repolight'))).toBe(false)
  })
})
