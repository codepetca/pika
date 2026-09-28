import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  authorizeContextualAssignmentInlineImageAccess,
  assertContextualAssignmentInlineImageConfiguration,
  finalizeContextualAssignmentInlineImage,
  reserveContextualAssignmentInlineImage,
  readContextualAssignmentInlineImage,
} from '@/lib/server/contextual-assignment-inline-images'

const actorId = '11111111-1111-4111-8111-111111111111'
const otherActorId = '22222222-2222-4222-8222-222222222222'
const classroomId = '33333333-3333-4333-8333-333333333333'
const otherClassroomId = '44444444-4444-4444-8444-444444444444'
const assignmentId = '55555555-5555-4555-8555-555555555555'
const docId = '66666666-6666-4666-8666-666666666666'
const objectId = '77777777-7777-4777-8777-777777777777'

const teacher = { id: actorId, role: 'teacher', email: 'member@example.com' }

describe('contextual assignment inline-image access', () => {
  afterEach(() => vi.unstubAllEnvs())

  it('is disabled by default and only admits exact user/Classroom pairs when enabled', () => {
    expect(authorizeContextualAssignmentInlineImageAccess(teacher as any, classroomId)).toEqual({
      mode: 'legacy', user: teacher, classroomId,
    })

    vi.stubEnv('PIKA_CLASSROOM_ASSIGNMENT_IMAGE_ACCESS_ENABLED', 'true')
    vi.stubEnv('PIKA_CLASSROOM_ASSIGNMENT_IMAGE_ACCESS_PAIRS', JSON.stringify([
      { userId: actorId, classroomId },
      { userId: otherActorId, classroomId: otherClassroomId },
    ]))

    expect(authorizeContextualAssignmentInlineImageAccess(teacher as any, classroomId.toUpperCase()))
      .toEqual({ mode: 'contextual', user: teacher, classroomId })
    expect(authorizeContextualAssignmentInlineImageAccess(teacher as any, otherClassroomId))
      .toEqual({ mode: 'legacy', user: teacher, classroomId: otherClassroomId })
  })

  it.each(['', 'not-json', '{}', '[{"userId":"*","classroomId":"*"}]', ' '.repeat(20_001)])(
    'fails closed for malformed enabled cohort configuration',
    (pairs) => {
      vi.stubEnv('PIKA_CLASSROOM_ASSIGNMENT_IMAGE_ACCESS_ENABLED', 'true')
      vi.stubEnv('PIKA_CLASSROOM_ASSIGNMENT_IMAGE_ACCESS_PAIRS', pairs)
      expect(() => assertContextualAssignmentInlineImageConfiguration())
        .toThrow(/configuration is unavailable/)
      expect(() => authorizeContextualAssignmentInlineImageAccess(teacher as any, classroomId))
        .toThrow(/configuration is unavailable/)
    },
  )

  it('requires complete, matching RPC evidence for read, reserve, and finalization', async () => {
    const rpc = vi.fn(async (name: string) => {
      if (name === 'read_assignment_inline_image_for_context_v1') {
        return { data: {
          ok: true, classroom_id: classroomId, assignment_id: assignmentId,
          assignment_doc_id: docId, managed_object_id: objectId,
        }, error: null }
      }
      if (name === 'reserve_assignment_inline_image_for_member_v1') {
        return { data: {
          ok: true, classroom_id: classroomId, assignment_id: assignmentId,
          assignment_doc_id: docId, managed_object_id: objectId,
        }, error: null }
      }
      return { data: {
        ok: true, classroom_id: classroomId, assignment_id: assignmentId,
        assignment_doc_id: docId, managed_object_id: objectId,
      }, error: null }
    })

    await expect(readContextualAssignmentInlineImage({ supabase: { rpc }, actorId, classroomId, assignmentDocId: docId, managedObjectId: objectId }))
      .resolves.toEqual({ classroomId, assignmentId, assignmentDocId: docId, managedObjectId: objectId })
    await expect(reserveContextualAssignmentInlineImage({
      supabase: { rpc }, actorId, classroomId, assignmentDocId: docId, managedObjectId: objectId,
      extension: 'png', contentType: 'image/png', byteSize: 12,
    })).resolves.toEqual({ classroomId, assignmentId, assignmentDocId: docId, managedObjectId: objectId })
    await expect(finalizeContextualAssignmentInlineImage({ supabase: { rpc }, actorId, classroomId, assignmentDocId: docId, managedObjectId: objectId }))
      .resolves.toEqual({ classroomId, assignmentId, assignmentDocId: docId, managedObjectId: objectId })
  })

  it('rejects malformed RPC success envelopes instead of authorizing a resource', async () => {
    const rpc = vi.fn(async () => ({ data: {
      ok: true, classroom_id: classroomId, assignment_id: assignmentId,
      assignment_doc_id: docId, managed_object_id: otherClassroomId,
    }, error: null }))

    await expect(readContextualAssignmentInlineImage({ supabase: { rpc }, actorId, classroomId, assignmentDocId: docId, managedObjectId: objectId }))
      .rejects.toMatchObject({ statusCode: 503 })
  })
})
