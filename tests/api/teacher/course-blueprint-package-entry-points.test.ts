import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { POST as POST_IMPORT } from '@/app/api/teacher/course-blueprints/import/route'
import { POST as POST_PROPOSAL } from '@/app/api/teacher/course-blueprints/[id]/proposals/route'
import { COURSE_BLUEPRINT_PACKAGE_MAX_BYTES } from '@/lib/contracts/course-blueprint-package'

const mockImportPlan = vi.fn()
const mockGetDetail = vi.fn()
const mockBuildCandidate = vi.fn()
const mockSubmitProposal = vi.fn()
const mockGetServiceRoleClient = vi.fn()
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
  getCourseBlueprintDetail: (...args: any[]) => mockGetDetail(...args),
}))

vi.mock('@/lib/server/course-blueprint-proposals', () => ({
  buildCourseBlueprintPackageCandidate: (...args: any[]) => mockBuildCandidate(...args),
  submitCourseBlueprintProposal: (...args: any[]) => mockSubmitProposal(...args),
}))

vi.mock('@/lib/supabase', () => ({
  getServiceRoleClient: (...args: any[]) => mockGetServiceRoleClient(...args),
}))

describe('course package application entry points', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetDetail.mockResolvedValue({
      detail: {
        id: validBundle.manifest.blueprint_id,
        authority_mode: 'repository',
      },
    })
  })

  it.each([
    ['upload source', (bundle: any) => {
      bundle.files['tests.md'] = bundle.files['tests.md'].replace(
        'Source: link',
        'Source: upload',
      )
    }],
    ['runtime storage identity', (bundle: any) => {
      bundle.files['tests.md'] = bundle.files['tests.md'].replace(
        'Title: Version 5 Reference',
        'Title: Version 5 Reference\nmanaged_object_id: 90000000-0000-4000-8000-000000000000',
      )
    }],
    ['managed URL', (bundle: any) => {
      bundle.files['tests.md'] = bundle.files['tests.md'].replace(
        'https://example.com/version-5-reference',
        'https://test.supabase.co/storage/v1/object/public/test-documents/reference.pdf',
      )
    }],
    ['encoded relative managed URL', (bundle: any) => {
      bundle.files['course-overview.md'] =
        '/%73torage%2Fv1%2Fobject%2Fpublic%2Ftest-documents%2Freference.pdf'
    }],
    ['encoded leading slash managed URL', (bundle: any) => {
      bundle.files['course-overview.md'] =
        '%2Fstorage%2Fv1%2Fobject%2Fpublic%2Ftest-documents%2Freference.pdf'
    }],
    ['double-encoded leading slash managed URL', (bundle: any) => {
      bundle.files['course-overview.md'] =
        '%252Fstorage%252Fv1%252Fobject%252Fpublic%252Ftest-documents%252Freference.pdf'
    }],
    ['managed inline URL with object-key parentheses', (bundle: any) => {
      bundle.files['course-overview.md'] =
        '[Reference](https://test.supabase.co/storage/v1/object/public/test-documents/(reference).pdf)'
    }],
    ['managed URL with object-key comma', (bundle: any) => {
      bundle.files['course-overview.md'] =
        'https://test.supabase.co/storage/v1/object/public/test-documents/,reference.pdf'
    }],
    ['managed protocol-relative render URL with object-key parentheses', (bundle: any) => {
      bundle.files['course-overview.md'] =
        '//test.supabase.co/storage/v1/render/image/public/submission-images/(reference).png'
    }],
    ['managed image-render URL', (bundle: any) => {
      bundle.files['tests.md'] = bundle.files['tests.md'].replace(
        'https://example.com/version-5-reference',
        'https://test.supabase.co/storage/v1/render/image/public/submission-images/reference.png?width=500',
      )
    }],
    ['managed DNS-root alias', (bundle: any) => {
      bundle.files['tests.md'] = bundle.files['tests.md'].replace(
        'https://example.com/version-5-reference',
        'https://test.supabase.co%2e/storage/v1/object/public/test-documents/reference.pdf',
      )
    }],
  ])('rejects %s identically before any write-capable operation', async (_label, mutate) => {
    const bundle = structuredClone(validBundle)
    mutate(bundle)

    const importResponse = await POST_IMPORT(new NextRequest(
      'http://localhost/api/teacher/course-blueprints/import',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(bundle),
      },
    ))
    const proposalResponse = await POST_PROPOSAL(new NextRequest(
      `http://localhost/api/teacher/course-blueprints/${validBundle.manifest.blueprint_id}/proposals`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(bundle),
      },
    ), {
      params: Promise.resolve({ id: validBundle.manifest.blueprint_id }),
    } as any)

    expect(importResponse.status).toBe(400)
    expect(proposalResponse.status).toBe(400)
    expect(await proposalResponse.json()).toEqual(await importResponse.json())
    expect(mockImportPlan).not.toHaveBeenCalled()
    expect(mockGetDetail).not.toHaveBeenCalled()
    expect(mockBuildCandidate).not.toHaveBeenCalled()
    expect(mockSubmitProposal).not.toHaveBeenCalled()
    expect(mockGetServiceRoleClient).not.toHaveBeenCalled()
  })

  it('applies the same byte limit before either entry point reaches server operations', async () => {
    const headers = {
      'Content-Type': 'application/json',
      'Content-Length': String(COURSE_BLUEPRINT_PACKAGE_MAX_BYTES + 1),
    }
    const importResponse = await POST_IMPORT(new NextRequest(
      'http://localhost/api/teacher/course-blueprints/import',
      { method: 'POST', headers, body: '{}' },
    ))
    const proposalResponse = await POST_PROPOSAL(new NextRequest(
      `http://localhost/api/teacher/course-blueprints/${validBundle.manifest.blueprint_id}/proposals`,
      { method: 'POST', headers, body: '{}' },
    ), {
      params: Promise.resolve({ id: validBundle.manifest.blueprint_id }),
    } as any)

    expect(importResponse.status).toBe(413)
    expect(proposalResponse.status).toBe(413)
    expect(await proposalResponse.json()).toEqual(await importResponse.json())
    expect(mockImportPlan).not.toHaveBeenCalled()
    expect(mockGetDetail).not.toHaveBeenCalled()
    expect(mockBuildCandidate).not.toHaveBeenCalled()
    expect(mockSubmitProposal).not.toHaveBeenCalled()
    expect(mockGetServiceRoleClient).not.toHaveBeenCalled()
  })
})
