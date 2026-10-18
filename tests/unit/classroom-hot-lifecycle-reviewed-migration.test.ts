import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { describe,it,expect,vi } from 'vitest'
import * as fs from 'node:fs'
import * as platform from '../../scripts/contextual-assignment-list-proof-platform'
import { createOfflineTestLearnerRepository } from '../helpers/test-learner-native-repository'
import { CLASSROOM_HOT_LIFECYCLE_REVIEWED_MIGRATION,validateClassroomHotLifecycleReviewedMigration } from '../../scripts/classroom-hot-lifecycle-reviewed-migration'
vi.mock('node:fs',async original=>{const actual=await original<typeof import('node:fs')>();return {...actual,copyFileSync:vi.fn(actual.copyFileSync)}})
const sql=readFileSync('supabase/migrations/268_contextual_classroom_hot_lifecycle.sql','utf8')
const evidence={...CLASSROOM_HOT_LIFECYCLE_REVIEWED_MIGRATION,sql}
describe('exact reviewed268 source seal; no execution authority',()=>{
  it('admits only the reviewed filename, stored digest and raw bytes',()=>{
    expect(()=>validateClassroomHotLifecycleReviewedMigration(evidence)).not.toThrow()
  })
  it('admits exact268 before explicitly copying the historical257 prefix',()=>{
    const offline=createOfflineTestLearnerRepository(process.cwd())
    try {expect(platform.loadAssignmentListReviewedMigrations(offline.repository)).toHaveLength(257)}finally{offline.dispose()}
  })
  it.each(['name','digest','bytes','self-hashed-bytes'])('rejects changed %s',defect=>{
    const candidate:{name:string;sql:string;sha256:string}={...evidence}
    if(defect==='name')candidate.name='268_unknown.sql'
    if(defect==='digest')candidate.sha256='f'.repeat(64)
    if(defect==='bytes'||defect==='self-hashed-bytes')candidate.sql+='\n'
    if(defect==='self-hashed-bytes')candidate.sha256=createHash('sha256').update(candidate.sql).digest('hex')
    expect(()=>validateClassroomHotLifecycleReviewedMigration(candidate)).toThrow()
  })
  it.each(['name','digest','bytes','self-hashed-bytes','unknown269'])('validates full tail %s before copying a historical prefix',defect=>{
    const inventory=platform.loadAssignmentListReviewedMigrations(process.cwd()).map(m=>({...m})),tail=inventory[267]
    if(defect==='name')tail.name='268_unknown.sql'
    if(defect==='digest')tail.sha256='f'.repeat(64)
    if(defect==='bytes'||defect==='self-hashed-bytes')tail.sql+='\n'
    if(defect==='self-hashed-bytes')tail.sha256=createHash('sha256').update(tail.sql).digest('hex')
    if(defect==='unknown269')inventory.push({name:'269_unknown.sql',sql:'select 1;',sha256:createHash('sha256').update('select 1;').digest('hex')})
    const loader=vi.spyOn(platform,'loadAssignmentListReviewedMigrations').mockReturnValue(inventory),copy=vi.spyOn(fs,'copyFileSync')
    copy.mockClear()
    try {expect(()=>createOfflineTestLearnerRepository(process.cwd())).toThrow();expect(copy).not.toHaveBeenCalled()}
    finally {loader.mockRestore();copy.mockRestore()}
  })
})
