import { describe, expect, it, vi } from 'vitest'
import {
  createClassroomAtomic,
  hashClassroomCreationRequest,
  mapClassroomCreationDatabaseError,
  resolveClassroomCreationOperationId,
} from '@/lib/server/classroom-creation-entitlement'

const operationId = '11111111-1111-4111-8111-111111111111'
const teacherId = '22222222-2222-4222-8222-222222222222'

function createClient(result: { data: unknown; error: unknown }) {
  return { rpc: vi.fn().mockResolvedValue(result) }
}

describe('classroom creation entitlement database errors', () => {
  it.each([
    [
      '42501',
      'classroom_creation_entitlement_disabled',
      403,
      'Classroom creation requires Access.',
      false,
    ],
    [
      '42501',
      'classroom_creation_entitlement_not_started',
      403,
      'Your classroom creation access is not active yet.',
      false,
    ],
    [
      '42501',
      'classroom_creation_entitlement_expired',
      403,
      'Your classroom creation access has expired.',
      false,
    ],
    [
      '23514',
      'classroom_creation_active_limit_reached',
      409,
      'Archive an active classroom before creating another.',
      false,
    ],
    [
      '55000',
      'classroom_creation_entitlement_unavailable',
      503,
      'Classroom creation is temporarily unavailable. Please try again.',
      true,
    ],
  ])('maps %s %s to a safe API denial', (code, message, status, safeMessage, retryable) => {
    expect(mapClassroomCreationDatabaseError({ code, message })).toEqual({
      status,
      errorCode: message,
      message: safeMessage,
      retryable,
    })
  })

  it('does not reinterpret unrelated database failures', () => {
    expect(mapClassroomCreationDatabaseError({
      code: '23514',
      message: 'another_constraint_failed',
    })).toBeNull()
    expect(mapClassroomCreationDatabaseError({
      code: '42501',
      message: 'permission denied for table classrooms',
    })).toBeNull()
    expect(mapClassroomCreationDatabaseError({
      code: '55000',
      message: 'another_prerequisite_failed',
    })).toBeNull()
    expect(mapClassroomCreationDatabaseError(null)).toBeNull()
  })
})

describe('atomic classroom creation adapter', () => {
  it('normalizes caller operation IDs and creates one when the header is absent', () => {
    expect(resolveClassroomCreationOperationId(
      '11111111-1111-4111-8111-111111111111',
    )).toBe(operationId)
    expect(resolveClassroomCreationOperationId(null)).toMatch(/^[0-9a-f-]{36}$/)
    expect(() => resolveClassroomCreationOperationId('not-a-uuid')).toThrow()
  })

  it('fingerprints only caller-controlled classroom semantics', () => {
    const request = { title: 'Math', termLabel: 'Fall', themeColor: 'teal' }
    expect(hashClassroomCreationRequest(request)).toBe(
      hashClassroomCreationRequest({ ...request }),
    )
    expect(hashClassroomCreationRequest(request)).not.toBe(
      hashClassroomCreationRequest({ ...request, title: 'Science' }),
    )
  })

  it('calls the service-only RPC and validates a replayed classroom result', async () => {
    const client = createClient({
      data: {
        ok: true,
        status: 201,
        operation_id: operationId,
        replayed: true,
        classroom: { id: '33333333-3333-4333-8333-333333333333', title: 'Math' },
      },
      error: null,
    })

    const outcome = await createClassroomAtomic({
      operationId,
      teacherId,
      request: { title: 'Math' },
      resolvedClassCode: 'ABC123',
      resolvedThemeColor: 'blue',
      supabase: client as never,
    })

    expect(outcome).toMatchObject({
      kind: 'result',
      result: { ok: true, replayed: true },
    })
    expect(client.rpc).toHaveBeenCalledWith('create_classroom_atomic_v1', {
      p_operation_id: operationId,
      p_subject_user_id: teacherId,
      p_request_sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      p_title: 'Math',
      p_class_code: 'ABC123',
      p_term_label: null,
      p_theme_color: 'blue',
    })
  })

  it('fails closed on missing migrations, malformed results, or mismatched operations', async () => {
    const base = {
      operationId,
      teacherId,
      request: { title: 'Math' },
      resolvedClassCode: 'ABC123',
      resolvedThemeColor: 'blue',
    }
    const missing = createClient({ data: null, error: { code: 'PGRST202', message: 'missing' } })
    const malformed = createClient({ data: { ok: true }, error: null })
    const mismatched = createClient({
      data: {
        ok: true,
        status: 201,
        operation_id: '44444444-4444-4444-8444-444444444444',
        replayed: false,
        classroom: { id: '33333333-3333-4333-8333-333333333333' },
      },
      error: null,
    })

    await expect(createClassroomAtomic({ ...base, supabase: missing as never }))
      .resolves.toMatchObject({ kind: 'database_error' })
    await expect(createClassroomAtomic({ ...base, supabase: malformed as never }))
      .resolves.toEqual({ kind: 'contract_unavailable' })
    await expect(createClassroomAtomic({ ...base, supabase: mismatched as never }))
      .resolves.toEqual({ kind: 'contract_unavailable' })
  })
})
