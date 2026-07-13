import { describe, expect, it } from 'vitest'
import {
  classroomLifecycleTransitionSchema,
  isAllowedClassroomLifecycleTransition,
} from '@/lib/contracts/classroom-lifecycle'

const archiveVerification = {
  operation_id: '10000000-0000-4000-8000-000000000001',
  artifact_sha256: 'a'.repeat(64),
  verified_at: '2026-07-13T12:00:00.000Z',
  manifest_verified: true,
  resource_checksums_verified: true,
  resource_counts_verified: true,
  storage_objects_verified: true,
  actor_snapshots_verified: true,
}

const restoreVerification = {
  ...archiveVerification,
  schema_adapter_verified: true,
  actor_references_resolved: true,
  restored_resource_counts_verified: true,
  restored_storage_objects_verified: true,
  referential_integrity_verified: true,
}

describe('classroom lifecycle contract', () => {
  it('allows only reversible adjacent lifecycle transitions', () => {
    expect(isAllowedClassroomLifecycleTransition('active', 'archived_hot')).toBe(true)
    expect(isAllowedClassroomLifecycleTransition('archived_hot', 'active')).toBe(true)
    expect(isAllowedClassroomLifecycleTransition('archived_hot', 'archived_cold')).toBe(true)
    expect(isAllowedClassroomLifecycleTransition('archived_cold', 'archived_hot')).toBe(true)

    expect(isAllowedClassroomLifecycleTransition('active', 'archived_cold')).toBe(false)
    expect(isAllowedClassroomLifecycleTransition('archived_cold', 'active')).toBe(false)
  })

  it('requires verified archive evidence before hot data can become cold', () => {
    expect(classroomLifecycleTransitionSchema.safeParse({
      from: 'archived_hot',
      to: 'archived_cold',
    }).success).toBe(false)

    expect(classroomLifecycleTransitionSchema.safeParse({
      from: 'archived_hot',
      to: 'archived_cold',
      verification: archiveVerification,
    }).success).toBe(true)
  })

  it('requires verified restore evidence before cold data becomes hot', () => {
    expect(classroomLifecycleTransitionSchema.safeParse({
      from: 'archived_cold',
      to: 'archived_hot',
    }).success).toBe(false)

    expect(classroomLifecycleTransitionSchema.safeParse({
      from: 'archived_cold',
      to: 'archived_hot',
      verification: restoreVerification,
    }).success).toBe(true)

    expect(classroomLifecycleTransitionSchema.safeParse({
      from: 'archived_cold',
      to: 'archived_hot',
      verification: archiveVerification,
    }).success).toBe(false)
  })

  it('rejects deletion as a lifecycle transition', () => {
    expect(classroomLifecycleTransitionSchema.safeParse({
      from: 'archived_cold',
      to: 'purged',
      verification: restoreVerification,
    }).success).toBe(false)
  })
})
