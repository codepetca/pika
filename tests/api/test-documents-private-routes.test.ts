import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { GET as getStudentFile } from '@/app/api/student/tests/[id]/documents/[docId]/file/route'
import { GET as getTeacherFile } from '@/app/api/teacher/tests/[id]/documents/[docId]/file/route'

vi.mock('@/lib/auth', () => ({ requireRole: vi.fn() }))
vi.mock('@/lib/server/tests', () => ({ assertTeacherOwnsTest: vi.fn() }))
vi.mock('@/lib/server/student-test-material-access', () => ({
  getStudentTestMaterialAccess: vi.fn(),
}))
vi.mock('@/lib/server/test-document-snapshots', () => ({
  findTestDocument: vi.fn(),
  buildUploadedTestDocumentResponse: vi.fn(),
}))

import { requireRole } from '@/lib/auth'
import { assertTeacherOwnsTest } from '@/lib/server/tests'
import { getStudentTestMaterialAccess } from '@/lib/server/student-test-material-access'
import {
  buildUploadedTestDocumentResponse,
  findTestDocument,
} from '@/lib/server/test-document-snapshots'

const test = { id: 'test-1', classroom_id: 'class-1', documents: [] }
const doc = {
  id: 'doc-1',
  title: 'Private.pdf',
  source: 'upload' as const,
  storage_bucket: 'test-documents' as const,
  storage_path: 'classrooms/class-1/tests/test-1/private.pdf',
}

describe('private Test document routes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(findTestDocument).mockReturnValue(doc)
    vi.mocked(buildUploadedTestDocumentResponse).mockResolvedValue(
      new Response('private document', { status: 200 }),
    )
  })

  it('delivers to an authorized student through the contextual Test route', async () => {
    vi.mocked(requireRole).mockResolvedValue({
      id: 'student-1', email: 'student@example.com', role: 'student',
    } as any)
    vi.mocked(getStudentTestMaterialAccess).mockResolvedValue({ ok: true, test } as any)

    const response = await getStudentFile(
      new NextRequest('http://localhost/api/student/tests/test-1/documents/doc-1/file'),
      { params: Promise.resolve({ id: 'test-1', docId: 'doc-1' }) },
    )
    expect(response.status).toBe(200)
    expect(buildUploadedTestDocumentResponse).toHaveBeenCalledWith({
      testId: 'test-1', classroomId: 'class-1', doc,
    })
  })

  it('does not touch Storage when the student cannot access the Test', async () => {
    vi.mocked(requireRole).mockResolvedValue({
      id: 'student-2', email: 'student@example.com', role: 'student',
    } as any)
    vi.mocked(getStudentTestMaterialAccess).mockResolvedValue({
      ok: false, status: 404, error: 'Document not found',
    })

    const response = await getStudentFile(
      new NextRequest('http://localhost/api/student/tests/test-1/documents/doc-1/file'),
      { params: Promise.resolve({ id: 'test-1', docId: 'doc-1' }) },
    )
    expect(response.status).toBe(404)
    expect(buildUploadedTestDocumentResponse).not.toHaveBeenCalled()
  })

  it('delivers to the teacher only after Test ownership succeeds', async () => {
    vi.mocked(requireRole).mockResolvedValue({
      id: 'teacher-1', email: 'teacher@example.com', role: 'teacher',
    } as any)
    vi.mocked(assertTeacherOwnsTest).mockResolvedValue({ ok: true, test } as any)

    const response = await getTeacherFile(
      new NextRequest('http://localhost/api/teacher/tests/test-1/documents/doc-1/file'),
      { params: Promise.resolve({ id: 'test-1', docId: 'doc-1' }) },
    )
    expect(response.status).toBe(200)
    expect(buildUploadedTestDocumentResponse).toHaveBeenCalledTimes(1)
  })

  it('does not touch Storage for a teacher who does not own the Test', async () => {
    vi.mocked(requireRole).mockResolvedValue({
      id: 'teacher-2', email: 'teacher@example.com', role: 'teacher',
    } as any)
    vi.mocked(assertTeacherOwnsTest).mockResolvedValue({
      ok: false, status: 403, error: 'Forbidden',
    } as any)

    const response = await getTeacherFile(
      new NextRequest('http://localhost/api/teacher/tests/test-1/documents/doc-1/file'),
      { params: Promise.resolve({ id: 'test-1', docId: 'doc-1' }) },
    )
    expect(response.status).toBe(403)
    expect(buildUploadedTestDocumentResponse).not.toHaveBeenCalled()
  })
})
