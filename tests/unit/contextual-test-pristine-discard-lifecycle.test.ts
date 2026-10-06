import { describe, expect, it } from 'vitest'
import { AssignmentListLifecycleError } from '../../scripts/contextual-assignment-list-proof-lifecycle'
import { parseTestOwnerPristineDiscardLifecycleArgs, testOwnerPristineDiscardForcedReceipt,
  testOwnerPristineDiscardRequestManifest, validateTestOwnerPristineDiscardGeneratedTypes } from '../../scripts/check-contextual-test-owner-pristine-discard-lifecycle'
import { newAssignmentListProofFixture } from '../../scripts/contextual-assignment-list-proof-fixture'
import { newTestOwnerPristineDiscardFixture } from '../../scripts/contextual-test-pristine-discard-proof-fixture'
import { testOwnerDigest } from '../../scripts/contextual-test-owner-detail-proof-fixture'
const head = 'dba18a9e167a9a7cd296ecffdbfb54da9c206e89'
describe('inert pristine-discard lifecycle contract', () => {
  it('admits only exact head/mode and genuine generation in normal mode', () => {
    expect(parseTestOwnerPristineDiscardLifecycleArgs(['--reviewed-head', head, '--mode', 'normal', '--generate-types'])).toEqual({head, mode: 'normal', generateTypes: true})
    expect(() => parseTestOwnerPristineDiscardLifecycleArgs(['--reviewed-head', head, '--mode', 'after-fixture', '--generate-types'])).toThrow()
    expect(() => parseTestOwnerPristineDiscardLifecycleArgs(['--reviewed-head', head, '--mode', 'normal', '--profile', 'caller'])).toThrow()
  })
  it('requires complete expected teardown before emitting exactly two forced markers', () => {
    const error = new AssignmentListLifecycleError({stage: 'after-fixture', error: new Error('Forced isolated lifecycle failure')}, [])
    expect(testOwnerPristineDiscardForcedReceipt('after-fixture', error, true)).toEqual({
      stdout: 'PASS isolated test-owner-pristine-discard exact teardown and unchanged canonical baseline.\n',
      stderr: 'FAIL forced isolated test-owner-pristine-discard lifecycle: after-fixture.\n', exitCode: 1})
    expect(testOwnerPristineDiscardForcedReceipt('normal', error, true)).toBeNull()
    expect(testOwnerPristineDiscardForcedReceipt('after-fixture', error, false)).toBeNull()
  })
  it('keeps exactly18 cases/two different probes/20RPCs and zeroStorage under existing limits', () => {
    const f = newTestOwnerPristineDiscardFixture(newAssignmentListProofFixture())
    const m = testOwnerPristineDiscardRequestManifest(f)
    expect(m.expected).toEqual({cases:18, privilegeProbes:2, rpcRequests:20, discards:6, storageRequests:0})
    expect(m.rollbackReservedIds).toHaveLength(1002)
    expect(new Set(m.rollbackReservedIds).size).toBe(1002)
    expect(Object.isFrozen(m.expected)).toBe(true)
  })
  it('validates genuine complete CLI RPC declaration, including required numeric CAS argument', () => {
    const source = 'export type Json = string | number; export type Database = {public:{Functions:{discard_pristine_test_draft_for_owner_v1:{Args:{p_actor_id:string;p_test_id:string;p_deadline:string;p_expected_draft_version:number;p_expected_test_updated_at:string};Returns:Json}}}}'
    expect(validateTestOwnerPristineDiscardGeneratedTypes(source, testOwnerDigest(source))).toBe(true)
    for (const bad of [source.replace('p_expected_draft_version:number', 'p_expected_draft_version:string'),
      source.replace('p_test_id:string', 'p_test_id?:string'), source.replace('Returns:Json', 'Returns:string')])
      expect(() => validateTestOwnerPristineDiscardGeneratedTypes(bad, testOwnerDigest(bad))).toThrow()
  })
})
