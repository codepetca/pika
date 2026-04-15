import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { GET } from '@/app/api/student/tests/[id]/documents/[docId]/snapshot/route'

vi.mock('@/lib/auth', () => ({
  requireRole: vi.fn(async () => ({
    id: 'student-1',
    email: 'student1@example.com',
    role: 'student',
  })),
}))

vi.mock('@/lib/server/tests', () => ({
  assertStudentCanAccessTest: vi.fn(async () => ({
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
          snapshot_content_type: 'text/html',
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

async function readResponseText(response: Response) {
  return Buffer.from(await response.arrayBuffer()).toString('utf8')
}

describe('GET /api/student/tests/[id]/documents/[docId]/snapshot', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDownload.mockResolvedValue({
      data: createMockDownloadBody('<html><body>Snapshot</body></html>', 'text/html'),
      error: null,
    })
  })

  it('streams the stored snapshot', async () => {
    const response = await GET(
      new NextRequest('http://localhost:3000/api/student/tests/test-1/documents/doc-1/snapshot'),
      { params: Promise.resolve({ id: 'test-1', docId: 'doc-1' }) }
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('text/html')
    expect(response.headers.get('content-security-policy')).toContain("script-src 'none'")
    expect(await readResponseText(response)).toContain('Snapshot')
  })

  it('returns 404 when the link doc has no snapshot', async () => {
    const serverTests = await import('@/lib/server/tests')
    vi.mocked(serverTests.assertStudentCanAccessTest).mockResolvedValueOnce({
      ok: true,
      test: {
        id: 'test-1',
        documents: [
          {
            id: 'doc-1',
            title: 'Node.js API',
            source: 'link',
            url: 'https://nodejs.org/api/fs.html',
          },
        ],
      } as any,
    })

    const response = await GET(
      new NextRequest('http://localhost:3000/api/student/tests/test-1/documents/doc-1/snapshot'),
      { params: Promise.resolve({ id: 'test-1', docId: 'doc-1' }) }
    )
    const data = await response.json()

    expect(response.status).toBe(404)
    expect(data.error).toBe('Snapshot not found')
  })
})
