import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { POST, PATCH, DELETE } from '@/app/api/teacher/authoring-images/route'
import { GET } from '@/app/api/storage/authoring-images/route'
import { requireAuth, requireRole } from '@/lib/auth'
import { getServiceRoleClient } from '@/lib/supabase'
import { assertStudentCanAccessClassroom, assertTeacherCanMutateClassroom, assertTeacherOwnsClassroom } from '@/lib/server/classrooms'
import { memberCanReadAuthoringImage, validateStoredAuthoringImage } from '@/lib/server/authoring-images'
import { reserveManagedStorageUpload, verifyManagedStorageUpload, queueManagedStorageCleanupBestEffort } from '@/lib/server/managed-storage'
import { resolveClassroomAccess } from '@/lib/server/classroom-access'
import { ApiError } from '@/lib/api-error'

vi.mock('@/lib/auth', () => ({ requireAuth: vi.fn(), requireRole: vi.fn() }))
vi.mock('@/lib/supabase', () => ({ getServiceRoleClient: vi.fn() }))
vi.mock('@/lib/server/classrooms', () => ({ assertStudentCanAccessClassroom: vi.fn(), assertTeacherCanMutateClassroom: vi.fn(), assertTeacherOwnsClassroom: vi.fn() }))
vi.mock('@/lib/server/managed-storage', () => ({ reserveManagedStorageUpload: vi.fn(), verifyManagedStorageUpload: vi.fn(), queueManagedStorageCleanupBestEffort: vi.fn() }))
vi.mock('@/lib/server/authoring-images', async original => ({ ...await original<typeof import('@/lib/server/authoring-images')>(), memberCanReadAuthoringImage: vi.fn(), validateStoredAuthoringImage: vi.fn() }))
vi.mock('@/lib/server/classroom-access', async original => ({ ...await original<typeof import('@/lib/server/classroom-access')>(), resolveClassroomAccess: vi.fn() }))
const classroomId = '11111111-1111-4111-8111-111111111111', objectId = '22222222-2222-4222-8222-222222222222', teacherId = '33333333-3333-4333-8333-333333333333'
const body = { classroom_id: classroomId, file_name: 'diagram.png', content_type: 'image/png', byte_size: 2097152 }
const request = (method: string, data: unknown) => new NextRequest('http://localhost/api/teacher/authoring-images', { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) })
let object: Record<string, unknown>
const info = vi.fn(), rpc = vi.fn(), createSignedUrl = vi.fn(), createSignedUploadUrl = vi.fn()
beforeEach(() => {
 vi.clearAllMocks()
 object = { id: objectId, classroom_id: classroomId, storage_bucket: 'test-documents', storage_path: `classrooms/${classroomId}/authoring-images/${objectId}.png`, resource_type: 'classroom', resource_id: classroomId, purpose: 'teacher_authoring_image', created_by_user_id: teacherId, status: 'reserved', content_type: 'image/png', byte_size: 2097152 }
 const user = { id: teacherId, role: 'teacher' as const, email: 'teacher@example.com' }
 vi.mocked(requireRole).mockResolvedValue(user);vi.mocked(requireAuth).mockResolvedValue(user)
 const ownership = { ok: true as const, classroom: { id: classroomId, teacher_id: teacherId, archived_at: null } }
 vi.mocked(assertTeacherCanMutateClassroom).mockResolvedValue(ownership as never);vi.mocked(assertTeacherOwnsClassroom).mockResolvedValue(ownership as never);vi.mocked(assertStudentCanAccessClassroom).mockResolvedValue(ownership as never)
 rpc.mockResolvedValue({ data: { ...object, status: 'ready' }, error: null });info.mockResolvedValue({ data: { size: 2097152, contentType: 'image/png' }, error: null })
 createSignedUploadUrl.mockResolvedValue({ data: { signedUrl: 'https://storage.example/upload', token: 'token' }, error: null });createSignedUrl.mockResolvedValue({ data: { signedUrl: 'https://storage.example/read' }, error: null })
 vi.mocked(getServiceRoleClient).mockReturnValue({ from: () => { const q = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: object, error: null }) };return q }, storage: { from: () => ({ info, createSignedUrl, createSignedUploadUrl }) }, rpc } as never)
})
afterEach(() => vi.unstubAllEnvs())
describe('teacher Markdown image API', () => {
 it('enforces 2 MB at reservation before generating a storage URL', async () => {
  expect((await POST(request('POST', { ...body, byte_size: 2097153 }))).status).toBe(400)
  expect(reserveManagedStorageUpload).not.toHaveBeenCalled()
  expect((await POST(request('POST', body))).status).toBe(200)
  expect(reserveManagedStorageUpload).toHaveBeenCalledWith(expect.objectContaining({ purpose: 'teacher_authoring_image', classroomId, resourceType: 'classroom', resourceId: classroomId, byteSize: 2097152 }))
 })
 it('denies upload to a foreign or archived classroom', async () => {
  vi.mocked(assertTeacherCanMutateClassroom).mockResolvedValue({ ok: false, status: 403, error: 'Forbidden' })
  expect((await POST(request('POST', body))).status).toBe(403);expect(reserveManagedStorageUpload).not.toHaveBeenCalled()
 })
 it('verifies actual stored bytes and returns only the protected reference', async () => {
  const response = await PATCH(request('PATCH', { classroom_id: classroomId, managed_object_id: objectId }))
  expect(response.status).toBe(200);expect(validateStoredAuthoringImage).toHaveBeenCalledWith(object.storage_path, 'image/png');expect(verifyManagedStorageUpload).toHaveBeenCalled()
  expect((await response.json()).url).toBe(`/api/storage/authoring-images?object_id=${objectId}`)
 })
 it('does not finalize a larger, mismatched, or foreign image', async () => {
  object.byte_size = 2097153
  expect((await PATCH(request('PATCH', { classroom_id: classroomId, managed_object_id: objectId }))).status).toBe(400)
  object.byte_size = 2097152;info.mockResolvedValue({ data: { size: 2097153, contentType: 'image/png' }, error: null })
  expect((await PATCH(request('PATCH', { classroom_id: classroomId, managed_object_id: objectId }))).status).toBe(400)
  object.classroom_id = teacherId
  expect((await PATCH(request('PATCH', { classroom_id: classroomId, managed_object_id: objectId }))).status).toBe(404)
  expect(verifyManagedStorageUpload).not.toHaveBeenCalled()
 })
 it('keeps successful finalize retries idempotent', async () => {
  object.status = 'ready'
  expect((await PATCH(request('PATCH', { classroom_id: classroomId, managed_object_id: objectId }))).status).toBe(200)
  expect(validateStoredAuthoringImage).not.toHaveBeenCalled();expect(verifyManagedStorageUpload).not.toHaveBeenCalled()
 })
 it('does not clean up a successful asset during cancellation races', async () => {
  object.status = 'ready'
  expect((await DELETE(request('DELETE', { managed_object_id: objectId }))).status).toBe(204)
  expect(queueManagedStorageCleanupBestEffort).not.toHaveBeenCalled()
 })
 it('does not expose drafts or guessable image ids to students', async () => {
  object.status = 'ready';vi.mocked(requireAuth).mockResolvedValue({ id: teacherId, role: 'student', email: 'student@example.com' })
  vi.mocked(memberCanReadAuthoringImage).mockResolvedValue(false)
  expect((await GET(new NextRequest(`http://localhost/api/storage/authoring-images?object_id=${objectId}`))).status).toBe(404);expect(createSignedUrl).not.toHaveBeenCalled()
  vi.mocked(memberCanReadAuthoringImage).mockResolvedValue(true)
  const allowed = await GET(new NextRequest(`http://localhost/api/storage/authoring-images?object_id=${objectId}`))
  expect(allowed.status).toBe(302);expect(allowed.headers.get('cache-control')).toBe('private, no-store')
 })
 it('blocks a non-member even when the image is published', async () => {
  object.status = 'ready';vi.mocked(requireAuth).mockResolvedValue({ id: teacherId, role: 'student', email: 'student@example.com' });vi.mocked(assertStudentCanAccessClassroom).mockResolvedValue({ ok: false, status: 403, error: 'Not enrolled' })
  expect((await GET(new NextRequest(`http://localhost/api/storage/authoring-images?object_id=${objectId}`))).status).toBe(404);expect(memberCanReadAuthoringImage).not.toHaveBeenCalled()
 })
 it('keeps retained previews private to the owner and denies expired or claimed cleanup', async () => {
  Object.assign(object, { status: 'cleanup_pending', cleanup_reason_code: 'authoring_image_reference_removed', attempt_count: 0,
    next_attempt_at: '2099-01-01T00:00:00Z', lease_token: null, lease_expires_at: null, verified_at: '2026-10-01T00:00:00Z', ready_at: '2026-10-01T00:00:00Z' })
  const read = () => GET(new NextRequest(`http://localhost/api/storage/authoring-images?object_id=${objectId}`))
  expect((await read()).status).toBe(302)
  vi.mocked(requireAuth).mockResolvedValue({ id: teacherId, role: 'student', email: 'student@example.com' })
  vi.mocked(memberCanReadAuthoringImage).mockResolvedValue(true)
  expect((await read()).status).toBe(404)
  vi.mocked(requireAuth).mockResolvedValue({ id: teacherId, role: 'teacher', email: 'teacher@example.com' })
  object.next_attempt_at = '2020-01-01T00:00:00Z'
  expect((await read()).status).toBe(404)
  object.next_attempt_at = '2099-01-01T00:00:00Z'; object.status = 'cleanup_processing'; object.lease_token = teacherId
  expect((await read()).status).toBe(404)
 })
})

describe('protected images in the exact live-home cohort', () => {
 const read = () => GET(new NextRequest(`http://localhost/api/storage/authoring-images?object_id=${objectId}`))
 const asRole = (role: 'teacher' | 'student') => {
  const user = { id: teacherId, role, email: 'actor@example.invalid' }
  vi.mocked(requireAuth).mockResolvedValue(user)
  vi.mocked(requireRole).mockImplementation(async required => {
   if (required !== role) throw new ApiError(403, 'Forbidden')
   return user
  })
 }
 beforeEach(() => {
  vi.stubEnv('PIKA_CLASSROOM_HOME_ACCESS_ENABLED', 'true')
  vi.stubEnv('PIKA_CLASSROOM_HOME_ACCESS_USER_IDS', JSON.stringify([teacherId]))
  vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', JSON.stringify({ version: 1, admittedUserIds: [teacherId] }))
  asRole('student')
  vi.mocked(resolveClassroomAccess).mockResolvedValue({ userId: teacherId, classroomId, ownerId: teacherId, relationship: 'owner', archived: false })
 })
 it.each(['teacher', 'student'] as const)('allows the actual %s-valued owner to reserve/finalize without changing identity', async role => {
  asRole(role)
  expect((await POST(request('POST', body))).status).toBe(200)
  expect((await PATCH(request('PATCH', { classroom_id: classroomId, managed_object_id: objectId }))).status).toBe(200)
  expect(requireRole).not.toHaveBeenCalled()
  expect(assertTeacherCanMutateClassroom).toHaveBeenCalledWith(teacherId, classroomId)
  expect(reserveManagedStorageUpload).toHaveBeenCalledWith(expect.objectContaining({ createdByUserId: teacherId, classroomId }))
 })
 it('keeps cancellation inert and creator-bound for an admitted student-valued owner', async () => {
  expect((await DELETE(request('DELETE', { managed_object_id: objectId }))).status).toBe(204)
  expect(assertTeacherCanMutateClassroom).toHaveBeenCalledWith(teacherId, classroomId)
  expect(queueManagedStorageCleanupBestEffort).not.toHaveBeenCalled()
  expect(requireRole).not.toHaveBeenCalled()
 })
 it.each(['teacher', 'student'] as const)('lets a %s-valued owner preview verified images without learner enrollment/disclosure', async role => {
  asRole(role); object.status = 'verified'
  vi.mocked(assertStudentCanAccessClassroom).mockResolvedValue({ ok: false, status: 403, error: 'Not enrolled' })
  vi.mocked(memberCanReadAuthoringImage).mockResolvedValue(false)
  expect((await read()).status).toBe(302)
  expect(resolveClassroomAccess).toHaveBeenCalledWith(teacherId, classroomId, { supabase: expect.anything() })
  expect(memberCanReadAuthoringImage).not.toHaveBeenCalled()
  expect(assertStudentCanAccessClassroom).not.toHaveBeenCalled()
 })
 it.each(['teacher', 'student'] as const)('lets a current %s-valued member read only published ready images', async role => {
  asRole(role); object.status = 'ready'
  vi.mocked(resolveClassroomAccess).mockResolvedValue({ userId: teacherId, classroomId, ownerId: objectId, relationship: 'member', archived: false })
  vi.mocked(assertTeacherOwnsClassroom).mockResolvedValue({ ok: false, status: 403, error: 'Forbidden' })
  vi.mocked(memberCanReadAuthoringImage).mockResolvedValue(true)
  expect((await read()).status).toBe(302)
  expect(memberCanReadAuthoringImage).toHaveBeenCalledWith(classroomId, teacherId, objectId)
  expect(assertTeacherOwnsClassroom).not.toHaveBeenCalled()
  createSignedUrl.mockClear(); vi.mocked(memberCanReadAuthoringImage).mockResolvedValue(false)
  expect((await read()).status).toBe(404)
  expect(createSignedUrl).not.toHaveBeenCalled()
 })
 it.each(['removed', 'archived', 'verified', 'retained'] as const)('does not expose %s images/memberships through the new reader', async condition => {
  asRole('teacher'); object.status = 'ready'
  vi.mocked(resolveClassroomAccess).mockResolvedValue({ userId: teacherId, classroomId, ownerId: objectId, relationship: condition === 'removed' ? 'none' : 'member', archived: condition === 'archived' })
  vi.mocked(memberCanReadAuthoringImage).mockResolvedValue(true)
  if (condition === 'verified') object.status = 'verified'
  if (condition === 'retained') Object.assign(object, { status: 'cleanup_pending', cleanup_reason_code: 'authoring_image_reference_removed', attempt_count: 0, next_attempt_at: '2099-01-01T00:00:00Z', lease_token: null, lease_expires_at: null, verified_at: '2026-10-01T00:00:00Z', ready_at: '2026-10-01T00:00:00Z' })
  expect((await read()).status).toBe(404)
  expect(createSignedUrl).not.toHaveBeenCalled()
  expect(memberCanReadAuthoringImage).not.toHaveBeenCalled()
 })
 it('fails relationship uncertainty closed without legacy fallback', async () => {
  object.status = 'ready'
  vi.mocked(resolveClassroomAccess).mockRejectedValue(new ApiError(503, 'Unable to resolve classroom access'))
  expect((await read()).status).toBe(503)
  expect(assertTeacherOwnsClassroom).not.toHaveBeenCalled()
  expect(assertStudentCanAccessClassroom).not.toHaveBeenCalled()
  expect(createSignedUrl).not.toHaveBeenCalled()
 })
 it('preserves retained owner preview but rejects expired or claimed cleanup', async () => {
  Object.assign(object, { status: 'cleanup_pending', cleanup_reason_code: 'authoring_image_reference_removed', attempt_count: 0, next_attempt_at: '2099-01-01T00:00:00Z', lease_token: null, lease_expires_at: null, verified_at: '2026-10-01T00:00:00Z', ready_at: '2026-10-01T00:00:00Z' })
  expect((await read()).status).toBe(302)
  expect(memberCanReadAuthoringImage).not.toHaveBeenCalled()
  createSignedUrl.mockClear(); object.next_attempt_at = '2020-01-01T00:00:00Z'
  expect((await read()).status).toBe(404)
  object.next_attempt_at = '2099-01-01T00:00:00Z'; object.status = 'cleanup_processing'; object.lease_token = teacherId
  expect((await read()).status).toBe(404)
  expect(createSignedUrl).not.toHaveBeenCalled()
 })
 it.each(['home', 'shared'] as const)('does not sign or reserve when the %s admission is malformed', async gate => {
  vi.stubEnv(gate === 'home' ? 'PIKA_CLASSROOM_HOME_ACCESS_USER_IDS' : 'PIKA_CLASSROOM_EXPERIENCE_ADMISSION', '{bad')
  object.status = 'ready'
  expect((await read()).status).toBe(503)
  expect((await POST(request('POST', body))).status).toBe(503)
  expect(createSignedUrl).not.toHaveBeenCalled()
  expect(reserveManagedStorageUpload).not.toHaveBeenCalled()
 })
 it.each(['home', 'shared'] as const)('preserves legacy authorization outside the %s cohort', async gate => {
  vi.stubEnv(gate === 'home' ? 'PIKA_CLASSROOM_HOME_ACCESS_USER_IDS' : 'PIKA_CLASSROOM_EXPERIENCE_ADMISSION',
   gate === 'home' ? '[]' : JSON.stringify({ version: 1, admittedUserIds: [] }))
  expect((await POST(request('POST', body))).status).toBe(403)
  object.status = 'verified'
  expect((await read()).status).toBe(404)
  expect(resolveClassroomAccess).not.toHaveBeenCalled()
  expect(reserveManagedStorageUpload).not.toHaveBeenCalled()
 })
 it('retains actual owner/active-classroom checks and finalize creator binding', async () => {
  vi.mocked(assertTeacherCanMutateClassroom).mockResolvedValueOnce({ ok: false, status: 403, error: 'Forbidden' })
  expect((await POST(request('POST', body))).status).toBe(403)
  expect(reserveManagedStorageUpload).not.toHaveBeenCalled()
  object.created_by_user_id = objectId
  expect((await PATCH(request('PATCH', { classroom_id: classroomId, managed_object_id: objectId }))).status).toBe(404)
  expect(verifyManagedStorageUpload).not.toHaveBeenCalled()
 })
})
