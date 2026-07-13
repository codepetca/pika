import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { POST } from '@/app/api/teacher/course-blueprints/import/route'

const operationId = '10000000-0000-4000-8000-000000000030'
const mockImportBundle = vi.fn()
const mockImportArchive = vi.fn()

vi.mock('@/lib/auth', () => ({
  requireRole: vi.fn(async () => ({ id: 'teacher-1' })),
}))

vi.mock('@/lib/server/course-blueprints', () => ({
  importCourseBlueprintBundle: (...args: any[]) => mockImportBundle(...args),
  importCourseBlueprintArchive: (...args: any[]) => mockImportArchive(...args),
}))

describe('POST /api/teacher/course-blueprints/import', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('forwards a caller idempotency key and returns operation metadata', async () => {
    mockImportBundle.mockResolvedValue({
      ok: true,
      blueprint: { id: 'blueprint-1', title: 'Imported' },
      operation_id: operationId,
      replayed: false,
    })
    const bundle = { manifest: { version: '3' }, files: {} }
    const response = await POST(new NextRequest('http://localhost/api/teacher/course-blueprints/import', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': operationId,
      },
      body: JSON.stringify(bundle),
    }))

    expect(mockImportBundle).toHaveBeenCalledWith('teacher-1', bundle, { operationId })
    expect(response.status).toBe(201)
    expect(await response.json()).toEqual({
      blueprint: { id: 'blueprint-1', title: 'Imported' },
      operation_id: operationId,
      replayed: false,
    })
  })

  it('rejects malformed idempotency keys before invoking the import service', async () => {
    const response = await POST(new NextRequest('http://localhost/api/teacher/course-blueprints/import', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': 'not-a-uuid',
      },
      body: JSON.stringify({}),
    }))

    expect(response.status).toBe(400)
    expect(mockImportBundle).not.toHaveBeenCalled()
  })

  it('returns durable operation metadata for an atomic import failure', async () => {
    mockImportBundle.mockResolvedValue({
      ok: false,
      status: 500,
      error: 'Atomic blueprint creation failed',
      operation_id: operationId,
      error_code: 'create_blueprint_assignments_failed',
      retryable: true,
    })
    const response = await POST(new NextRequest('http://localhost/api/teacher/course-blueprints/import', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': operationId,
      },
      body: JSON.stringify({ manifest: { version: '3' }, files: {} }),
    }))

    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({
      error: 'Atomic blueprint creation failed',
      operation_id: operationId,
      error_code: 'create_blueprint_assignments_failed',
      retryable: true,
    })
  })
})
