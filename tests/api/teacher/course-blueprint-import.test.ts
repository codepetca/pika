import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { POST } from '@/app/api/teacher/course-blueprints/import/route'
import { COURSE_BLUEPRINT_PACKAGE_MAX_BYTES } from '@/lib/contracts/course-blueprint-package'

const operationId = '10000000-0000-4000-8000-000000000030'
const mockImportPlan = vi.fn()
const testDir = dirname(fileURLToPath(import.meta.url))
const validBundle = JSON.parse(readFileSync(
  resolve(testDir, '../../fixtures/course-blueprint-package-v5.json'),
  'utf8',
))

vi.mock('@/lib/auth', () => ({
  requireRole: vi.fn(async () => ({ id: 'teacher-1' })),
}))

vi.mock('@/lib/server/course-blueprints', () => ({
  importCourseBlueprintPlan: (...args: any[]) => mockImportPlan(...args),
}))

describe('POST /api/teacher/course-blueprints/import', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('forwards a caller idempotency key and returns operation metadata', async () => {
    mockImportPlan.mockResolvedValue({
      ok: true,
      blueprint: { id: 'blueprint-1', title: 'Imported' },
      operation_id: operationId,
      replayed: false,
    })
    const bundle = structuredClone(validBundle)
    const response = await POST(new NextRequest('http://localhost/api/teacher/course-blueprints/import', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': operationId,
      },
      body: JSON.stringify(bundle),
    }))

    expect(mockImportPlan).toHaveBeenCalledWith(
      'teacher-1',
      expect.objectContaining({
        manifest: expect.objectContaining({ version: '5' }),
        errors: [],
      }),
      { operationId },
    )
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
    expect(mockImportPlan).not.toHaveBeenCalled()
  })

  it('returns durable operation metadata for an atomic import failure', async () => {
    mockImportPlan.mockResolvedValue({
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
      body: JSON.stringify(validBundle),
    }))

    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({
      error: 'Atomic blueprint creation failed',
      operation_id: operationId,
      error_code: 'create_blueprint_assignments_failed',
      retryable: true,
    })
  })

  it('rejects package bodies over the byte limit before invoking the import service', async () => {
    const response = await POST(new NextRequest('http://localhost/api/teacher/course-blueprints/import', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': String(COURSE_BLUEPRINT_PACKAGE_MAX_BYTES + 1),
      },
      body: '{}',
    }))

    expect(response.status).toBe(413)
    expect(mockImportPlan).not.toHaveBeenCalled()
  })

  it('maps malformed bounded JSON to a client error', async () => {
    const response = await POST(new NextRequest('http://localhost/api/teacher/course-blueprints/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{',
    }))

    expect(response.status).toBe(400)
    expect(mockImportPlan).not.toHaveBeenCalled()
  })

  it('does not invoke server operations for a semantically invalid package', async () => {
    const invalidBundle = structuredClone(validBundle)
    invalidBundle.files['tests.md'] = invalidBundle.files['tests.md'].replace(
      'Source: link',
      'Source: upload',
    )
    const response = await POST(new NextRequest('http://localhost/api/teacher/course-blueprints/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(invalidBundle),
    }))

    expect(response.status).toBe(400)
    expect(mockImportPlan).not.toHaveBeenCalled()
  })
})
