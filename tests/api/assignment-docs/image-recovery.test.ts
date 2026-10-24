import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { PATCH } from '@/app/api/assignment-docs/[id]/route'
import { POST } from '@/app/api/assignment-docs/[id]/submit/route'
import { requireAuth, requireRole } from '@/lib/auth'
import { getServiceRoleClient } from '@/lib/supabase'
import { saveAssignmentDocAtomic, submitAssignmentDocAtomic } from '@/lib/server/assignment-doc-submissions'
import { saveContextualAssignmentDoc } from '@/lib/server/contextual-assignment-doc-save'
import {
  prepareContextualAssignmentDocSubmission,
  submitContextualAssignmentDoc,
} from '@/lib/server/contextual-assignment-doc-submission'
import type { TiptapContent } from '@/types'

vi.mock('@/lib/auth', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/auth')>(),
  requireAuth: vi.fn(),
  requireRole: vi.fn(),
}))
vi.mock('@/lib/supabase', () => ({ getServiceRoleClient: vi.fn() }))
vi.mock('@/lib/server/classrooms', () => ({
  assertStudentCanAccessClassroom: vi.fn(async () => ({ ok: true })),
}))
vi.mock('@/lib/server/assignment-doc-submissions', () => ({
  saveAssignmentDocAtomic: vi.fn(),
  submitAssignmentDocAtomic: vi.fn(),
}))
vi.mock('@/lib/server/contextual-assignment-doc-save', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/server/contextual-assignment-doc-save')>(),
  saveContextualAssignmentDoc: vi.fn(),
}))
vi.mock('@/lib/server/contextual-assignment-doc-submission', () => ({
  prepareContextualAssignmentDocSubmission: vi.fn(),
  submitContextualAssignmentDoc: vi.fn(),
}))
vi.mock('@/lib/server/assignment-submission-artifacts', () => ({
  loadAssignmentSubmissionRequirements: vi.fn(async () => []),
  loadAssignmentSubmissionArtifactsForDoc: vi.fn(async () => []),
  loadUserGitHubIdentity: vi.fn(async () => null),
}))
vi.mock('@/lib/server/pal-config', () => ({
  isPalEnabled: vi.fn(() => false),
  isClassroomPalRequested: vi.fn(() => false),
}))

const studentId = '11111111-1111-4111-8111-111111111111'
const assignmentId = '22222222-2222-4222-8222-222222222222'
const docId = '33333333-3333-4333-8333-333333333333'
const classroomId = '44444444-4444-4444-8444-444444444444'
const imageId = '55555555-5555-4555-8555-555555555555'
const sessionId = '66666666-6666-4666-8666-666666666666'
const revision = '2026-10-24T12:00:00.000Z'
const storagePath = `${studentId}/${assignmentId}/evidence.png`
const priorContent = {
  type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Older saved work' }] }],
}
const savedDoc = {
  id: docId, assignment_id: assignmentId, student_id: studentId,
  is_submitted: false, content: priorContent, updated_at: revision,
}
const assignment = { id: assignmentId, classroom_id: classroomId, is_draft: false, released_at: null, due_at: null }
const ownedImage = {
  id: imageId, storage_bucket: 'submission-images', storage_path: storagePath,
  status: 'verified', purpose: 'student_inline_image', classroom_id: classroomId,
  data_subject_user_id: studentId, resource_type: 'assignment_doc', resource_id: docId,
}

function draftWithImage(attrs: Record<string, unknown>): TiptapContent {
  return {
    type: 'doc',
    content: [{
      type: 'bulletList',
      content: [{
        type: 'listItem',
        content: [
          { type: 'paragraph', content: [{ type: 'text', text: 'Latest unsaved explanation' }] },
          { type: 'image', attrs },
        ],
      }],
    }],
  }
}

function clientWithRegistry(data: unknown[] | null = [ownedImage], error: unknown = null) {
  const registry: any = {
    select: vi.fn(() => registry),
    eq: vi.fn(() => registry),
    match: vi.fn(() => registry),
    in: vi.fn(async () => ({ data, error })),
  }
  const docs: any = {
    select: vi.fn(() => docs),
    eq: vi.fn(() => docs),
    single: vi.fn(async () => ({ data: structuredClone(savedDoc), error: null })),
    limit: vi.fn(async () => ({ data: [structuredClone(savedDoc)], error: null })),
  }
  const assignments: any = {
    select: vi.fn(() => assignments),
    eq: vi.fn(() => assignments),
    single: vi.fn(async () => ({ data: assignment, error: null })),
  }
  const history: any = {
    select: vi.fn(() => history),
    eq: vi.fn(() => history),
    order: vi.fn(async () => ({ data: [], error: null })),
  }
  const client = {
    from: vi.fn((table: string) => {
      if (table === 'managed_storage_objects') return registry
      if (table === 'assignment_docs') return docs
      if (table === 'assignments') return assignments
      if (table === 'assignment_doc_history') return history
      throw new Error(`Unexpected table: ${table}`)
    }),
  }
  vi.mocked(getServiceRoleClient).mockReturnValue(client as never)
  return { client, registry }
}

const writes = [saveAssignmentDocAtomic, submitAssignmentDocAtomic, saveContextualAssignmentDoc, submitContextualAssignmentDoc]

describe.each([
  { mode: 'legacy', operation: 'save' },
  { mode: 'legacy', operation: 'submit' },
  { mode: 'contextual', operation: 'save' },
  { mode: 'contextual', operation: 'submit' },
] as const)('$mode assignment $operation image recovery', ({ mode, operation }) => {
  const writer = mode === 'contextual'
    ? operation === 'save' ? saveContextualAssignmentDoc : submitContextualAssignmentDoc
    : operation === 'save' ? saveAssignmentDocAtomic : submitAssignmentDocAtomic

  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', undefined)
    for (const scope of ['SAVE', 'SUBMISSION']) {
      vi.stubEnv(`PIKA_CLASSROOM_ASSIGNMENT_DOC_${scope}_ACCESS_ENABLED`, mode === 'contextual' ? 'true' : 'false')
      vi.stubEnv(`PIKA_CLASSROOM_ASSIGNMENT_DOC_${scope}_ACCESS_PAIRS`, JSON.stringify([{ userId: studentId, assignmentId }]))
    }
    const actor = { id: studentId, role: 'student', email: 'student@example.com' }
    vi.mocked(requireAuth).mockResolvedValue(actor as never)
    vi.mocked(requireRole).mockResolvedValue(actor as never)
    vi.mocked(prepareContextualAssignmentDocSubmission).mockResolvedValue({
      assignment, doc: structuredClone(savedDoc), submissionRequirements: [], submissionArtifacts: [],
    } as never)
    for (const write of writes) {
      vi.mocked(write).mockImplementation((async (input: { content: TiptapContent }) => ({
        ok: true, doc: { ...savedDoc, content: input.content, is_submitted: operation === 'submit' },
        historyEntry: null, classroomId,
      })) as never)
    }
  })

  afterEach(() => vi.unstubAllEnvs())

  async function invoke(content: TiptapContent) {
    const payload = {
      content, expected_updated_at: revision,
      ...(operation === 'save' ? {
        save_session_id: sessionId, save_sequence: 3, metric_session_id: sessionId,
      } : {}),
    }
    const request = new NextRequest(`http://localhost/api/assignment-docs/${assignmentId}${operation === 'submit' ? '/submit' : ''}`, {
      method: operation === 'save' ? 'PATCH' : 'POST', body: JSON.stringify(payload),
    })
    // Return the original object so mutation assertions exercise the route/helper,
    // rather than merely checking a separate JSON-serialized copy.
    vi.spyOn(request, 'json').mockResolvedValue(payload)
    return (operation === 'save' ? PATCH : POST)(request, { params: Promise.resolve({ id: assignmentId }) })
  }

  it('passes an external image and latest text to the atomic writer without null managed IDs', async () => {
    const { client } = clientWithRegistry()
    const content = draftWithImage({
      src: 'https://example.com/photo.png', alt: 'External photo', width: 420,
      managed_object_id: null, storage_bucket: null, storage_path: null,
    })
    const original = structuredClone(content)
    const response = await invoke(content)
    const expected = draftWithImage({ src: 'https://example.com/photo.png', alt: 'External photo', width: 420 })

    expect(response.status, JSON.stringify(await response.clone().json())).toBe(200)
    expect(writer).toHaveBeenCalledWith(expect.objectContaining({ content: expected }))
    expect((await response.json()).doc.content).toEqual(expected)
    expect(content).toEqual(original)
    expect(client.from).not.toHaveBeenCalledWith('managed_storage_objects')
  })

  it('restores an owned ID-only clipboard image from scoped registry evidence and retains latest text', async () => {
    const { client, registry } = clientWithRegistry()
    const content = draftWithImage({
      src: `/api/storage/submission-images?object_id=${imageId}`,
      managed_object_id: imageId, alt: 'Copied evidence', title: 'Original title', width: 480,
    })
    const original = structuredClone(content)
    const response = await invoke(content)
    const expected = draftWithImage({
      ...original.content![0].content![0].content![1].attrs,
      storage_bucket: 'submission-images', storage_path: storagePath,
    })

    expect(response.status, JSON.stringify(await response.clone().json())).toBe(200)
    expect(writer).toHaveBeenCalledWith(expect.objectContaining({ content: expected }))
    expect((await response.json()).doc.content).toEqual(expected)
    expect(content).toEqual(original)
    expect(registry.eq).toHaveBeenCalledWith('data_subject_user_id', studentId)
    expect(registry.eq).toHaveBeenCalledWith('resource_type', 'assignment_doc')
    expect(registry.eq).toHaveBeenCalledWith('resource_id', docId)
    expect(registry.in).toHaveBeenCalledWith('id', [imageId])
    expect(registry.match).toHaveBeenCalledWith(mode === 'contextual' && operation === 'save' ? {} : { classroom_id: classroomId })
    if (mode === 'contextual') expect(client.from).not.toHaveBeenCalledWith('assignments')
    for (const otherWriter of writes.filter((candidate) => candidate !== writer)) {
      expect(otherWriter).not.toHaveBeenCalled()
    }
  })

  it.each([
    '/api/storage/submission-images?path=conflicting%2Fimage.png',
    'https://legacy.supabase.co/storage/v1/object/public/submission-images/conflicting/image.png',
  ])('does not invoke any writer for conflicting URL path evidence %s', async (src) => {
    for (const fields of [{}, { storage_bucket: ownedImage.storage_bucket, storage_path: storagePath }]) {
      clientWithRegistry()
      const content = draftWithImage({ managed_object_id: imageId, src, ...fields })
      const original = structuredClone(content)
      expect((await invoke(content)).status).toBe(400)
      for (const write of writes) expect(write).not.toHaveBeenCalled()
      expect(content).toEqual(original)
    }
  })

  it.each([
    { label: 'foreign owner', records: [{ ...ownedImage, data_subject_user_id: assignmentId }], error: null, status: 400 },
    { label: 'foreign document', records: [{ ...ownedImage, resource_id: assignmentId }], error: null, status: 400 },
    { label: 'unknown object', records: [], error: null, status: 400 },
    { label: 'unavailable registry', records: null, error: { code: '08006' }, status: 503 },
  ])('rejects $label before any atomic write and preserves the input', async ({ records, error, status }) => {
    clientWithRegistry(records, error)
    const content = draftWithImage({ src: `/api/storage/submission-images?object_id=${imageId}`, managed_object_id: imageId })
    const original = structuredClone(content)
    const response = await invoke(content)

    expect(response.status).toBe(status)
    expect((await response.json()).error).toContain('Your saved work has not changed')
    expect(content).toEqual(original)
    for (const write of writes) expect(write).not.toHaveBeenCalled()
  })
})
