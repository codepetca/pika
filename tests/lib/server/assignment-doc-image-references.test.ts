import { describe, expect, it, vi } from 'vitest'
import { normalizeAssignmentDocImageReferences } from '@/lib/server/assignment-doc-image-references'
import type { TiptapContent } from '@/types'

const id = '10000000-0000-4000-8000-000000000001'
const context = { assignmentDocId: 'doc-1', studentId: 'student-1', classroomId: 'class-1', origin: 'https://pika.test' }
const object = {
  id, storage_bucket: 'submission-images', storage_path: 'owned/image.png', status: 'ready',
  purpose: 'student_inline_image', classroom_id: context.classroomId,
  data_subject_user_id: context.studentId, resource_type: 'assignment_doc', resource_id: context.assignmentDocId,
}
function client(rows: unknown[] = [object], error: unknown = null) {
  const query = { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), match: vi.fn().mockReturnThis(), in: vi.fn().mockResolvedValue({ data: rows, error }) }
  return { from: vi.fn(() => query), query }
}
function document(attrs: Record<string, unknown>): TiptapContent {
  return { type: 'doc', content: [{ type: 'blockquote', content: [
    { type: 'paragraph', content: [{ type: 'text', text: 'Keep my latest unsaved work.' }] },
    { type: 'image', attrs },
  ] }] }
}
const imageAttrs = (doc: TiptapContent) => doc.content![0].content![1].attrs!

describe('assignment document image recovery', () => {
  it('recovers a copied owned image without changing text, image presentation or the input', async () => {
    const supabase = client()
    const content = document({ src: `/api/storage/submission-images?object_id=${id}`, managed_object_id: id, storage_bucket: null, storage_path: null, alt: 'My evidence', width: 360 })
    const before = structuredClone(content)
    const normalized = await normalizeAssignmentDocImageReferences({ ...context, supabase: supabase as any, content })
    expect(content).toEqual(before)
    expect(normalized.content![0].content![0]).toEqual(before.content![0].content![0])
    expect(imageAttrs(normalized)).toEqual({ ...imageAttrs(content), storage_bucket: object.storage_bucket, storage_path: object.storage_path })
    expect(supabase.query.eq).toHaveBeenCalledWith('resource_id', context.assignmentDocId)
    expect(supabase.query.eq).toHaveBeenCalledWith('data_subject_user_id', context.studentId)
    expect(supabase.query.match).toHaveBeenCalledWith({ classroom_id: context.classroomId })
  })

  it('recovers a same-origin protected image URL even when the clipboard lost its ID attribute', async () => {
    const supabase = client([{ ...object, status: 'verified' }])
    const normalized = await normalizeAssignmentDocImageReferences({ ...context, supabase: supabase as any, content: document({ src: `https://pika.test/api/storage/submission-images?object_id=${id}`, managed_object_id: null }) })
    expect(imageAttrs(normalized)).toMatchObject({ managed_object_id: id, storage_bucket: object.storage_bucket, storage_path: object.storage_path })
  })

  it.each([
    '/api/storage/submission-images?path=owned%2Fimage.png',
    'https://legacy.supabase.co/storage/v1/object/public/submission-images/owned/image.png',
  ])('recovers an owned legacy image path %s', async (src) => {
    const supabase = client()
    const normalized = await normalizeAssignmentDocImageReferences({ ...context, supabase: supabase as any, content: document({ src, managed_object_id: null }) })
    expect(supabase.query.in).toHaveBeenCalledWith('storage_path', [object.storage_path])
    expect(imageAttrs(normalized)).toMatchObject({ managed_object_id: id, storage_path: object.storage_path, src: `/api/storage/submission-images?object_id=${id}` })
  })

  it('does not treat another origin protected URL as evidence of a local managed image', async () => {
    const supabase = client()
    const src = `https://other.example/api/storage/submission-images?object_id=${id}`
    const normalized = await normalizeAssignmentDocImageReferences({ ...context, supabase: supabase as any, content: document({ src, managed_object_id: null }) })
    expect(imageAttrs(normalized)).toEqual({ src })
    expect(supabase.from).not.toHaveBeenCalled()
  })

  it('does not attach a managed image before its assignment document exists', async () => {
    const supabase = client()
    await expect(normalizeAssignmentDocImageReferences({ ...context, assignmentDocId: null, supabase: supabase as any, content: document({ managed_object_id: id }) })).rejects.toMatchObject({ statusCode: 400 })
    expect(supabase.from).not.toHaveBeenCalled()
  })

  it('retains an external pasted image and removes null identity keys before the database sees them', async () => {
    const supabase = client()
    const content = document({ src: 'https://example.com/evidence.png', managed_object_id: null, storage_bucket: null, storage_path: null, alt: 'External evidence' })
    const normalized = await normalizeAssignmentDocImageReferences({ ...context, supabase: supabase as any, content })
    expect(imageAttrs(normalized)).toEqual({ src: 'https://example.com/evidence.png', alt: 'External evidence' })
    expect(content.content![0].content![0]).toEqual(normalized.content![0].content![0])
    expect(supabase.from).not.toHaveBeenCalled()
  })

  it('leaves complete managed references for the transaction to validate', async () => {
    const supabase = client()
    const content = document({ managed_object_id: id, storage_bucket: object.storage_bucket, storage_path: object.storage_path, src: `/api/storage/submission-images?object_id=${id}` })
    expect(await normalizeAssignmentDocImageReferences({ ...context, supabase: supabase as any, content })).toEqual(content)
    expect(supabase.from).not.toHaveBeenCalled()
  })

  it.each([
    { resource_id: 'another-doc' }, { data_subject_user_id: 'another-student' }, { classroom_id: 'another-class' },
    { storage_bucket: 'test-documents' }, { purpose: 'teacher_authoring_image' }, { resource_type: 'test' },
    { status: 'cleanup_pending' }, { status: 'deleted' }, { storage_path: null },
  ])('rejects ineligible image evidence %j without changing the draft', async (override) => {
    const supabase = client([{ ...object, ...override }])
    const content = document({ managed_object_id: id, src: `/api/storage/submission-images?object_id=${id}` })
    const before = structuredClone(content)
    await expect(normalizeAssignmentDocImageReferences({ ...context, supabase: supabase as any, content })).rejects.toMatchObject({ statusCode: 400 })
    expect(content).toEqual(before)
  })

  it('does not overwrite an explicit conflicting storage location', async () => {
    const supabase = client()
    await expect(normalizeAssignmentDocImageReferences({ ...context, supabase: supabase as any, content: document({ managed_object_id: id, storage_path: 'someone-else/image.png' }) })).rejects.toMatchObject({ statusCode: 400 })
  })

  it('rejects unknown IDs and a registry outage instead of dropping an image', async () => {
    const content = document({ managed_object_id: id })
    await expect(normalizeAssignmentDocImageReferences({ ...context, supabase: client([]) as any, content })).rejects.toMatchObject({ statusCode: 400 })
    await expect(normalizeAssignmentDocImageReferences({ ...context, supabase: client([], { message: 'unavailable' }) as any, content })).rejects.toMatchObject({ statusCode: 503 })
  })

  it('rejects a conflicting protected URL identity', async () => {
    await expect(normalizeAssignmentDocImageReferences({ ...context, supabase: client() as any, content: document({ managed_object_id: id, src: '/api/storage/submission-images?object_id=10000000-0000-4000-8000-000000000002' }) })).rejects.toMatchObject({ statusCode: 400 })
  })

  it.each([
    '/api/storage/submission-images?path=owned%2Fother.png',
    'https://legacy.supabase.co/storage/v1/object/public/submission-images/owned/other.png',
  ])('rejects a conflicting URL storage path %s with either partial or complete attributes', async (src) => {
    for (const fields of [{}, { storage_bucket: object.storage_bucket, storage_path: object.storage_path }]) {
      const content = document({ managed_object_id: id, src, ...fields })
      const before = structuredClone(content)
      await expect(normalizeAssignmentDocImageReferences({ ...context, supabase: client() as any, content })).rejects.toMatchObject({ statusCode: 400 })
      expect(content).toEqual(before)
    }
  })

  it.each([
    '/api/storage/submission-images?path=owned%2Fimage.png',
    'https://legacy.supabase.co/storage/v1/object/public/submission-images/owned/image.png',
  ])('accepts matching URL path evidence alongside a managed ID: %s', async (src) => {
    const normalized = await normalizeAssignmentDocImageReferences({ ...context, supabase: client() as any, content: document({ managed_object_id: id, src }) })
    expect(imageAttrs(normalized)).toMatchObject({ managed_object_id: id, storage_path: object.storage_path })
  })
})
