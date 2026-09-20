import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const actorId = '11111111-1111-4111-8111-111111111111'
const assignmentId = '22222222-2222-4222-8222-222222222222'
const classroomId = '33333333-3333-4333-8333-333333333333'
const requirementId = '44444444-4444-4444-8444-444444444444'
const assignmentDocId = '55555555-5555-4555-8555-555555555555'
const artifactId = '66666666-6666-4666-8666-666666666666'
const managedObjectId = '77777777-7777-4777-8777-777777777777'
const timestamp = '2026-09-20T14:00:00.000Z'

const mocks = vi.hoisted(() => ({
  authorize: vi.fn(),
  prepare: vi.fn(),
  upsert: vi.fn(),
  deleteArtifact: vi.fn(),
  queueCleanup: vi.fn(),
  removeQueued: vi.fn(),
  reserve: vi.fn(),
  verify: vi.fn(),
  validate: vi.fn(),
  from: vi.fn(),
  upload: vi.fn(),
  createSignedUrl: vi.fn(),
}))

vi.mock('@/lib/server/contextual-assignment-doc-access', () => ({
  authorizeContextualAssignmentArtifactRequest: mocks.authorize,
  assertContextualAssignmentGitHubIdentity: vi.fn(),
}))
vi.mock('@/lib/server/contextual-assignment-artifacts', () => ({
  prepareContextualAssignmentArtifact: mocks.prepare,
  upsertContextualAssignmentArtifact: mocks.upsert,
  deleteContextualAssignmentArtifact: mocks.deleteArtifact,
}))
vi.mock('@/lib/server/managed-storage', () => ({
  reserveManagedStorageUpload: mocks.reserve,
  verifyManagedStorageUpload: mocks.verify,
  queueManagedStorageCleanupBestEffort: mocks.queueCleanup,
}))
vi.mock('@/lib/server/assignment-artifact-storage-cleanup', () => ({
  adoptProvisionalAssignmentArtifactStorageCleanup: vi.fn(),
  assignmentArtifactStoragePathIsReferenced: vi.fn(),
  createProvisionalAssignmentArtifactStorageCleanup: vi.fn(),
  enqueueAssignmentArtifactStorageCleanupPath: vi.fn(),
  removeQueuedAssignmentArtifactStoragePath: mocks.removeQueued,
}))
vi.mock('@/lib/server/assignment-submission-validation', () => ({
  getGitHubIdentityValidationFromArtifact: vi.fn(),
  normalizeGitHubLogin: vi.fn(),
  validateAssignmentSubmissionArtifactValue: mocks.validate,
}))
vi.mock('@/lib/supabase', () => ({
  getServiceRoleClient: vi.fn(() => ({
    from: mocks.from,
    storage: {
      from: vi.fn(() => ({
        upload: mocks.upload,
        createSignedUrl: mocks.createSignedUrl,
      })),
    },
  })),
}))

import { DELETE, POST, PUT } from '@/app/api/assignment-docs/[id]/artifacts/[requirementId]/route'

const linkRequirement = {
  id: requirementId,
  artifact_id: '88888888-8888-4888-8888-888888888888',
  assignment_id: assignmentId,
  type: 'link' as const,
  label: 'Evidence',
  instructions: '',
  required: false,
  position: 0,
  validation_policy_json: {},
  source_artifact_id: null,
  source_blueprint_version_id: null,
  created_at: timestamp,
  updated_at: timestamp,
}
const linkArtifact = {
  id: artifactId,
  assignment_doc_id: assignmentDocId,
  requirement_id: requirementId,
  student_id: actorId,
  type: 'link' as const,
  url: 'https://example.com/work',
  storage_path: null,
  metadata_json: {},
  validation_status: 'valid' as const,
  validation_message: null,
  validated_at: timestamp,
  created_at: timestamp,
  updated_at: timestamp,
}

describe('contextual assignment artifact routes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.authorize.mockResolvedValue({
      mode: 'contextual',
      user: { id: actorId, role: 'teacher', email: 'member@example.com' },
      assignmentId,
    })
    mocks.prepare.mockResolvedValue({
      ok: true,
      classroomId,
      assignmentDocId,
      requirement: linkRequirement,
      artifact: null,
    })
    mocks.validate.mockResolvedValue({
      validation_status: 'valid',
      validation_message: null,
      metadata_json: {},
      normalized_url: linkArtifact.url,
    })
    mocks.upsert.mockResolvedValue({
      ok: true,
      classroomId,
      artifact: linkArtifact,
      previousStoragePath: null,
    })
    mocks.deleteArtifact.mockResolvedValue({
      ok: true,
      classroomId,
      deleted: false,
      storagePath: null,
    })
    mocks.removeQueued.mockResolvedValue({ completed: true })
    mocks.upload.mockResolvedValue({ error: null })
    mocks.createSignedUrl.mockResolvedValue({ data: { signedUrl: 'https://signed.example/image.png' }, error: null })
    mocks.reserve.mockResolvedValue({
      id: managedObjectId,
      storage_bucket: 'assignment-artifacts',
      storage_path: 'managed/image.png',
      status: 'reserved',
    })
    mocks.verify.mockResolvedValue({
      id: managedObjectId,
      storage_bucket: 'assignment-artifacts',
      storage_path: 'managed/image.png',
      status: 'verified',
    })
  })

  it('lets a teacher-valued exact member attach through the RPC without direct table writes', async () => {
    const response = await PUT(new NextRequest(
      `http://localhost/api/assignment-docs/${assignmentId}/artifacts/${requirementId}`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: linkArtifact.url }),
      },
    ), { params: Promise.resolve({ id: assignmentId, requirementId }) })

    expect(response.status).toBe(200)
    expect(mocks.prepare).toHaveBeenCalledWith(expect.objectContaining({
      actorId,
      assignmentId,
      requirementId,
    }))
    expect(mocks.upsert).toHaveBeenCalledWith(expect.objectContaining({
      actorId,
      assignmentId,
      requirementId,
      type: 'link',
    }))
    expect(mocks.from).not.toHaveBeenCalled()
  })

  it('deletes through the contextual boundary before attempting Storage cleanup', async () => {
    mocks.deleteArtifact.mockResolvedValue({
      ok: true,
      classroomId,
      deleted: true,
      storagePath: 'managed/old.png',
    })
    const response = await DELETE({} as NextRequest, {
      params: Promise.resolve({ id: assignmentId, requirementId }),
    })

    expect(response.status).toBe(200)
    expect(mocks.deleteArtifact).toHaveBeenCalled()
    expect(mocks.removeQueued).toHaveBeenCalledWith(expect.objectContaining({
      storagePath: 'managed/old.png',
    }))
    expect(mocks.deleteArtifact.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.removeQueued.mock.invocationCallOrder[0],
    )
  })

  it('queues uploaded managed bytes when membership disappears before image attach', async () => {
    mocks.prepare.mockResolvedValue({
      ok: true,
      classroomId,
      assignmentDocId,
      requirement: { ...linkRequirement, type: 'image' },
      artifact: null,
    })
    mocks.validate.mockResolvedValue({
      validation_status: 'valid',
      validation_message: null,
      metadata_json: {},
      normalized_url: null,
    })
    mocks.upsert.mockResolvedValue({
      ok: false,
      status: 403,
      error: 'Forbidden',
      errorCode: 'assignment_membership_missing',
    })
    const formData = new FormData()
    const buffer = new ArrayBuffer(16)
    const file = new File([buffer], 'work.png', { type: 'image/png' })
    ;(file as any).arrayBuffer = async () => buffer
    formData.append('file', file)

    const response = await POST(
      { formData: async () => formData } as unknown as NextRequest,
      { params: Promise.resolve({ id: assignmentId, requirementId }) },
    )

    expect(response.status).toBe(403)
    expect(mocks.upload).toHaveBeenCalled()
    expect(mocks.queueCleanup).toHaveBeenCalledWith(expect.objectContaining({
      objectId: expect.any(String),
      errorCode: 'assignment_artifact_attachment_failed',
    }))
    expect(mocks.from).not.toHaveBeenCalled()
  })
})
