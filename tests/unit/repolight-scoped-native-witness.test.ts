import { createHash, randomUUID } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import * as platform from '../../scripts/contextual-assignment-list-proof-platform'
import { newAssignmentListProofFixture } from '../../scripts/contextual-assignment-list-proof-fixture'
import { newTestLearnerWorkflowFixture } from '../../scripts/contextual-test-learner-proof-fixture'
import { newTestOwnerGradingFixture } from '../../scripts/contextual-test-owner-grading-proof-fixture'
import { newTestOwnerRecoveryFixture } from '../../scripts/contextual-test-owner-recovery-proof-fixture'
import { testLearnerNativePlan, validateTestLearnerNativePlanSql } from '../../scripts/contextual-test-learner-native-contracts'
import { testOwnerGradingNativePlan, validateTestOwnerGradingNativePlanSql } from '../../scripts/contextual-test-owner-grading-native-contracts'
import { testOwnerRecoveryNativePlan, validateTestOwnerRecoveryNativePlanSql } from '../../scripts/contextual-test-owner-recovery-native-contracts'
import { testOwnerDeletionNativePlan, validateTestOwnerDeletionNativePlanSql } from '../../scripts/contextual-test-owner-deletion-native-contracts'
import { testOwnerUnpublicationNativePlan, validateTestOwnerUnpublicationNativePlanSql } from '../../scripts/contextual-test-owner-unpublication-native-contracts'
import { repoLight300PresenceSql, repoLight300WitnessSql, withRepoLight300Witness } from '../../scripts/repolight-300-proof-witness'

const repository=process.cwd(), head='a'.repeat(40), original=newAssignmentListProofFixture(new Date('2026-10-07T03:00:00Z'))
const chain=platform.loadAssignmentListReviewedMigrations(repository), hash=(sql:string)=>createHash('sha256').update(sql).digest('hex')
const observed=(f:{actors:readonly {id:string}[]})=>Object.freeze([1,2].map(i=>Object.freeze({actorId:f.actors[i].id,attemptId:randomUUID(),revision:1})))
const learner=observed(newTestLearnerWorkflowFixture(original)), grading=observed(newTestOwnerGradingFixture(original)), recovery=observed(newTestOwnerRecoveryFixture(original))
const profiles = [
  ['learner',()=>testLearnerNativePlan(original,learner,head,repository)],
  ['grading',()=>testOwnerGradingNativePlan(original,grading,head,repository)],
  ['recovery',()=>testOwnerRecoveryNativePlan(original,recovery,head,repository)],
  ['deletion',()=>testOwnerDeletionNativePlan(original,head,repository)],
  ['unpublication',()=>testOwnerUnpublicationNativePlan(original,head,repository)],
] as const

describe('fixed sealed300 witness in scoped native plans',()=>{
  it('binds full rows and named trigger/function metadata without changing historical expressions',()=>{
    const witness=repoLight300WitnessSql(),presence=repoLight300PresenceSql()
    for (const table of ['private.repolight_settings','private.repolight_managed_connections','private.repolight_provision_control',
      'private.repolight_provision_outbox','private.stripe_billing_settings','public.account_plans','public.billing_account_access']) expect(witness).toContain(`from ${table} r`)
    for (const name of ['repolight_provision_billing_hint','repolight_provision_plan_hint','repolight_provision_access_gate_hint',
      'repolight_provision_billing_gate_hint','repolight_provision_account_hint_v1','repolight_provision_gate_hint_v1']) {
      expect(witness).toContain(name);expect(presence).toContain(name)
    }
    for (const token of ['pg_get_triggerdef','t.tgenabled','t.tgdeferrable','t.tginitdeferred','pg_get_functiondef','p.proacl']) expect(witness).toContain(token)
    for (const token of ['epoch=1','not managed_provisioning_enabled','not plan_enforcement_enabled','not billing_access_enabled',
      'not legacy_plan_access_enabled',"t.tgenabled='O'",'t.tgtype=expected.kind','t.tgqual is null','t.tgnargs=0','p.proconfig','expected.attrs']) expect(presence).toContain(token)
    expect(presence).toContain("array['provider_mode','sandbox_enabled']::text[]")
    expect(withRepoLight300Witness('original',false)).toBe('original')
  })
  it.each(profiles)('%s binds witness to snapshot and contention with sealed source300',(_name,make)=>{
    const plan=make();expect(plan.migrations).toHaveLength(301);expect(plan.nativeVerified).toBe(false)
    expect(plan.setup).toContain('$repolight300$')
    expect(plan.snapshot).toContain('__repolight300')
    for(const schedule of plan.concurrency.schedules) {
      expect(schedule.rejectSql.split('__repolight300').length).toBeGreaterThanOrEqual(3)
      expect(schedule.rejectSql).toContain('is distinct from baseline')
    }
  })
  it.each(profiles)('%s preserves the source300 witness in the historical sealed profile',(_name,make)=>{
    const loader=vi.spyOn(platform,'loadAssignmentListReviewedMigrations').mockReturnValue(chain.slice(0,300))
    try {const plan=make();expect(plan.migrations).toHaveLength(300);expect(plan.snapshot).toContain('__repolight300');expect(plan.setup).toContain('$repolight300$')}
    finally{loader.mockRestore()}
  })
  it('rejects snapshot SQL that removes the 300 witness from any native plan',()=>{
    const plans = [testLearnerNativePlan(original,learner,head,repository),testOwnerGradingNativePlan(original,grading,head,repository),
      testOwnerRecoveryNativePlan(original,recovery,head,repository),testOwnerDeletionNativePlan(original,head,repository),
      testOwnerUnpublicationNativePlan(original,head,repository)] as const
    const validators = [validateTestLearnerNativePlanSql,validateTestOwnerGradingNativePlanSql,validateTestOwnerRecoveryNativePlanSql,
      validateTestOwnerDeletionNativePlanSql,validateTestOwnerUnpublicationNativePlanSql] as const
    plans.forEach((plan,index)=>{
      const validate = validators[index] as (plan: never, sql:string)=>boolean
      expect(validate(plan as never, plan.snapshot)).toBe(true)
      expect(validate(plan as never, plan.snapshot.replace('__repolight300','__removed'))).toBe(false)
    })
  })
  it.each(profiles)('%s retains the original historical snapshot shape',(_name,make)=>{
    const loader=vi.spyOn(platform,'loadAssignmentListReviewedMigrations').mockReturnValue(chain.slice(0,297))
    try {const plan=make();expect(plan.snapshot).not.toContain('__repolight300');expect(plan.setup).not.toContain('$repolight300$')}
    finally{loader.mockRestore()}
  })
  it.each(profiles)('%s rejects partial, self-hashed changed and future tails',(_name,make)=>{
    const altered=[297,298,299,300].map(index=>{const result=chain.map(x=>({...x}));result[index].sql+='\n';result[index].sha256=hash(result[index].sql);return result})
    for(const candidate of [chain.slice(0,298),chain.slice(0,299),...altered,[...chain,{name:'302_unknown.sql',sql:'select 1;',sha256:hash('select 1;')}]]) {
      const loader=vi.spyOn(platform,'loadAssignmentListReviewedMigrations').mockReturnValue(candidate)
      try{expect(make).toThrow()}finally{loader.mockRestore()}
    }
  })
})

// These scoped native plans exercise the sealed RepoLight-era inventory.
vi.mock('../../scripts/contextual-assignment-list-proof-platform', async importOriginal => {
  const actual = await importOriginal<typeof import('../../scripts/contextual-assignment-list-proof-platform')>()
  return { ...actual, loadAssignmentListReviewedMigrations: (root: string) => actual.loadAssignmentListReviewedMigrations(root).slice(0, 301) }
})
