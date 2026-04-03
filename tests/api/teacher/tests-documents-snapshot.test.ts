import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { GET } from '@/app/api/teacher/tests/[id]/documents/[docId]/snapshot/route'

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
      documents: [
        {
          id: 'doc-1',
          title: 'Node.js API',
          source: 'link',
          url: 'https://nodejs.org/api/fs.html',
          snapshot_path: 'link-docs/teacher-1/test-1/doc-1/snapshot',
          snapshot_content_type: 'application/pdf',
          synced_at: '2026-04-02T12:00:00.000Z',
        },
      ],
    },
  })),
}))

vi.mock('@/lib/supabase', () => ({
  getServiceRoleClient: vi.fn(() => mockSupabase),
}))

const mockDownload = vi.fn()
const mockSupabase = {
  storage: {
    from: vi.fn(() => ({
      download: mockDownload,
    })),
  },
}

function createMockDownloadBody(content: string, contentType: string) {
  const bytes = new TextEncoder().encode(content)
  return {
    type: contentType,
    stream: () =>
      new ReadableStream({
        start(controller) {
          controller.enqueue(bytes)
          controller.close()
        },
      }),
    arrayBuffer: async () => bytes.slice().buffer,
    text: async () => content,
  }
}

describe('GET /api/teacher/tests/[id]/documents/[docId]/snapshot', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDownload.mockResolvedValue({
      data: createMockDownloadBody('%PDF-1.4', 'application/pdf'),
      error: null,
    })
  })

  it('streams the stored snapshot for preview mode', async () => {
    const response = await GET(
      new NextRequest('http://localhost:3000/api/teacher/tests/test-1/documents/doc-1/snapshot'),
      { params: Promise.resolve({ id: 'test-1', docId: 'doc-1' }) }
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('application/pdf')
    expect(await (await response.blob()).text()).toContain('%PDF-1.4')
  })
})
