import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { POST } from '@/app/api/teacher/tests/[id]/documents/[docId]/sync/route'

vi.mock('@/lib/auth', () => ({
  requireRole: vi.fn(async () => ({
    id: 'teacher-1',
    email: 'teacher@example.com',
    role: 'teacher',
  })),
}))

vi.mock('@/lib/server/tests', () => ({
  assertTeacherOwnsTest: vi.fn(async () => ({
    ok: true,
    test: {
      id: 'test-1',
      classroom_id: 'classroom-1',
      title: 'Unit Test',
      status: 'draft',
      show_results: false,
      position: 0,
      created_at: '2026-04-02T00:00:00.000Z',
      updated_at: '2026-04-02T00:00:00.000Z',
      documents: [
        {
          id: 'doc-1',
          title: 'Node.js API',
          source: 'link',
          url: 'https://nodejs.org/api/fs.html',
        },
      ],
      classrooms: { archived_at: null },
    },
  })),
}))

vi.mock('@/lib/supabase', () => ({
  getServiceRoleClient: vi.fn(() => mockSupabase),
}))

const mockUpload = vi.fn()
const mockUpdate = vi.fn()
const mockSupabase = {
  storage: {
    from: vi.fn(() => ({
      upload: mockUpload,
    })),
  },
  from: vi.fn((table: string) => {
    if (table !== 'tests') {
      throw new Error(`Unexpected table: ${table}`)
    }
    return {
      update: mockUpdate,
    }
  }),
}

describe('POST /api/teacher/tests/[id]/documents/[docId]/sync', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('<html><head><script>bad()</script></head><body>Docs</body></html>', {
        status: 200,
        headers: { 'content-type': 'text/html; charset=utf-8' },
      }))
    )
    mockUpload.mockResolvedValue({ error: null })
    mockUpdate.mockImplementation((payload: Record<string, unknown>) => ({
      eq: vi.fn(() => ({
        select: vi.fn(() => ({
          single: vi.fn().mockResolvedValue({
            data: {
              id: 'test-1',
              documents: payload.documents,
            },
            error: null,
          }),
        })),
      })),
    }))
  })

  it('syncs a link document and saves snapshot metadata', async () => {
    const response = await POST(
      new NextRequest('http://localhost:3000/api/teacher/tests/test-1/documents/doc-1/sync', {
        method: 'POST',
      }),
      { params: Promise.resolve({ id: 'test-1', docId: 'doc-1' }) }
    )
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(global.fetch).toHaveBeenCalledWith(
      'https://nodejs.org/api/fs.html',
      expect.objectContaining({ method: 'GET' })
    )
    expect(mockUpload).toHaveBeenCalledWith(
      'link-docs/teacher-1/test-1/doc-1/snapshot',
      expect.any(Buffer),
      expect.objectContaining({
        contentType: 'text/html',
        upsert: true,
      })
    )
    expect(data.doc.snapshot_path).toBe('link-docs/teacher-1/test-1/doc-1/snapshot')
    expect(data.doc.snapshot_content_type).toBe('text/html')
    expect(data.doc.synced_at).toBeTruthy()
  })

  it('returns 400 for unsupported source types', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('body', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }))
    )

    const response = await POST(
      new NextRequest('http://localhost:3000/api/teacher/tests/test-1/documents/doc-1/sync', {
        method: 'POST',
      }),
      { params: Promise.resolve({ id: 'test-1', docId: 'doc-1' }) }
    )
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toBe('Unsupported document type')
  })
})
