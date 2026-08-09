import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ManagedDeletionHealthError,
  managedDeletionDeepHealthSnapshotSchema,
  readManagedDeletionHealth,
} from '@/lib/server/managed-deletion-health'

const operationHealth = {
  terminal_failures: 0,
  stale_operations: 0,
  stale_partial_operations: 0,
  expired_object_leases: 0,
  due_failed_objects: 0,
  fences_without_active_operation: 0,
  active_operations_without_fence: 0,
  deleted_objects_reappeared: 0,
}

const managedStorageHealth = {
  unregistered_storage_objects: 0,
  registered_objects_missing_storage: 0,
  referenced_objects_not_ready: 0,
  raw_references_missing_identity: 0,
  relational_identity_mismatches: 0,
  embedded_ownership_mismatches: 0,
  objects_without_durable_owner: 0,
  settled_provisional_objects: 0,
  ready_objects_unreferenced: 0,
  expired_reservations: 0,
  expired_provisional_owners: 0,
  stale_cleanup_pending: 0,
  expired_cleanup_leases: 0,
}

function snapshot(overrides: Record<string, unknown> = {}) {
  return {
    version: 1,
    generated_at: '2026-08-08T16:00:00.000Z',
    stuck_after_seconds: 3600,
    healthy: true,
    critical_count: 0,
    warning_count: 0,
    operations: {
      classroom: operationHealth,
      course_blueprint: operationHealth,
    },
    managed_storage: managedStorageHealth,
    ...overrides,
  }
}

describe('managed deletion health reader', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('returns a validated aggregate-only health snapshot', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: snapshot(), error: null })

    await expect(readManagedDeletionHealth({
      supabase: { rpc } as any,
      stuckAfterSeconds: 3600,
    })).resolves.toEqual({
      schemaAvailable: true,
      snapshot: snapshot(),
    })
    expect(rpc).toHaveBeenCalledWith('get_managed_deletion_health_snapshot', {
      p_stuck_after_seconds: 3600,
    })
  })

  it('treats the exact missing-RPC signal as code-first compatibility', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: { code: 'PGRST202', message: 'raw provider detail must not escape' },
    })

    await expect(readManagedDeletionHealth({ supabase: { rpc } as any })).resolves.toEqual({
      schemaAvailable: false,
    })
    expect(console.warn).toHaveBeenCalledWith(
      '[managed-deletion-health] schema unavailable',
      { error_code: 'PGRST202' },
    )
  })

  it.each(['42883', 'PGRST205', '42P01'])(
    'fails closed when an installed RPC reports dependency error %s',
    async (code) => {
      const rpc = vi.fn().mockResolvedValue({
        data: null,
        error: { code, message: 'raw provider detail must not escape' },
      })

      await expect(readManagedDeletionHealth({ supabase: { rpc } as any })).rejects.toMatchObject({
        code: 'managed_deletion_health_query_failed',
      })
    },
  )

  it('throws a sanitized error when the health query fails', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: { code: '57014', message: 'sensitive provider detail' },
    })

    await expect(readManagedDeletionHealth({ supabase: { rpc } as any })).rejects.toMatchObject({
      name: 'ManagedDeletionHealthError',
      code: 'managed_deletion_health_query_failed',
    })
  })

  it('rejects malformed or identity-bearing RPC results', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: snapshot({ classroom_id: '00000000-0000-4000-8000-000000000001' }),
      error: null,
    })

    await expect(readManagedDeletionHealth({ supabase: { rpc } as any })).rejects.toBeInstanceOf(
      ManagedDeletionHealthError,
    )
  })

  it.each([299, 604801, 12.5])('rejects an unsafe stuck threshold: %s', async (value) => {
    await expect(readManagedDeletionHealth({
      supabase: { rpc: vi.fn() } as any,
      stuckAfterSeconds: value,
    })).rejects.toMatchObject({ code: 'managed_deletion_health_threshold_invalid' })
  })

  it('strictly validates aggregate-only deep diagnostic results', () => {
    const result = managedDeletionDeepHealthSnapshotSchema.safeParse({
      version: 1,
      generated_at: '2026-08-08T16:00:00.000Z',
      healthy: false,
      critical_count: 1,
      findings: {
        embedded_hosts_missing_registry: 0,
        embedded_payload_identity_mismatches: 1,
        embedded_evidence_mismatches: 0,
      },
    })
    expect(result.success).toBe(true)
    expect(managedDeletionDeepHealthSnapshotSchema.safeParse({
      ...(result.success ? result.data : {}),
      classroom_id: '00000000-0000-4000-8000-000000000001',
    }).success).toBe(false)
  })
})
