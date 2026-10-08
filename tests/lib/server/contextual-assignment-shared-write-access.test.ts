import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { requireAuth, requireRole } from '@/lib/auth'
import { authorizeContextualAssignmentOwnerMutationRequest } from '@/lib/server/contextual-assignment-owner-mutation-access'
import { authorizeContextualAssignmentGradingRequest } from '@/lib/server/contextual-assignment-grading-access'
import { authorizeContextualAssignmentFeedbackReturnRequest } from '@/lib/server/contextual-assignment-feedback-return-access'
import { authorizeContextualAssignmentBulkRequest } from '@/lib/server/contextual-assignment-bulk-access'
import { authorizeContextualAssignmentRepoTargetRequest } from '@/lib/server/contextual-assignment-repo-target-access'
import { authorizeContextualClassworkCreationRequest } from '@/lib/server/contextual-classwork-creation-access'
import { authorizeContextualClassworkReorderRequest } from '@/lib/server/contextual-classwork-reorder-access'
import {
  authorizeContextualAssignmentArtifactRequest,
  authorizeContextualAssignmentDocHistoryRequest,
  authorizeContextualAssignmentDocRestoreRequest,
  authorizeContextualAssignmentDocSaveRequest,
  authorizeContextualAssignmentDocSubmissionRequest,
  resolveContextualAssignmentDocAccess,
} from '@/lib/server/contextual-assignment-doc-access'
import type { AuthenticatedUser } from '@/types'

vi.mock('@/lib/auth', async (original) => ({
  ...await original<typeof import('@/lib/auth')>(), requireAuth: vi.fn(), requireRole: vi.fn(),
}))

const actorId = '11111111-1111-4111-8111-111111111111'
const otherId = '22222222-2222-4222-8222-222222222222'
const resourceId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const otherResourceId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const sharedVariable = 'PIKA_CLASSROOM_EXPERIENCE_ADMISSION'
const adapters = [
  ['owner mutation', authorizeContextualAssignmentOwnerMutationRequest, 'ASSIGNMENT_OWNER_MUTATION', 'assignmentId', 'teacher'],
  ['grading', authorizeContextualAssignmentGradingRequest, 'ASSIGNMENT_GRADING', 'assignmentId', 'teacher'],
  ['return', authorizeContextualAssignmentFeedbackReturnRequest, 'ASSIGNMENT_FEEDBACK_RETURN', 'assignmentId', 'teacher'],
  ['bulk', authorizeContextualAssignmentBulkRequest, 'ASSIGNMENT_BULK', 'classroomId', 'teacher'],
  ['repo target', authorizeContextualAssignmentRepoTargetRequest, 'ASSIGNMENT_REPO_TARGET', 'assignmentId', 'teacher'],
  ['creation', authorizeContextualClassworkCreationRequest, 'CLASSWORK_CREATION', 'classroomId', 'teacher'],
  ['reorder', authorizeContextualClassworkReorderRequest, 'CLASSWORK_REORDER', 'classroomId', 'teacher'],
  ['artifact', authorizeContextualAssignmentArtifactRequest, 'ASSIGNMENT_ARTIFACT', 'assignmentId', 'student'],
  ['save', authorizeContextualAssignmentDocSaveRequest, 'ASSIGNMENT_DOC_SAVE', 'assignmentId', 'student'],
  ['submission', authorizeContextualAssignmentDocSubmissionRequest, 'ASSIGNMENT_DOC_SUBMISSION', 'assignmentId', 'student'],
  ['history', authorizeContextualAssignmentDocHistoryRequest, 'ASSIGNMENT_DOC_HISTORY', 'assignmentId', 'authenticated'],
  ['restore', authorizeContextualAssignmentDocRestoreRequest, 'ASSIGNMENT_DOC_HISTORY', 'assignmentId', 'student'],
] as const

function actor(role: 'teacher' | 'student'): AuthenticatedUser {
  return { id: actorId, email: 'actor@example.com', role } as AuthenticatedUser
}
function admission(ids = [actorId]) {
  vi.stubEnv(sharedVariable, JSON.stringify({ version: 1, admittedUserIds: ids }))
}

describe.each(adapters)('%s shared write admission', (_name, authorize, flag, key, legacyRole) => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.stubEnv(sharedVariable, undefined)
    vi.stubEnv(`PIKA_CLASSROOM_${flag}_ACCESS_ENABLED`, 'false')
    vi.stubEnv(`PIKA_CLASSROOM_${flag}_ACCESS_PAIRS`, 'broken-pair')
    vi.mocked(requireAuth).mockResolvedValue(actor('teacher'))
    vi.mocked(requireRole).mockImplementation(async (role) => actor(role as 'teacher' | 'student'))
  })
  afterEach(() => vi.unstubAllEnvs())

  it.each(['teacher', 'student'] as const)('routes an admitted %s through contextual access before broken pair configuration', async (role) => {
    admission()
    vi.stubEnv(`PIKA_CLASSROOM_${flag}_ACCESS_ENABLED`, 'true')
    const user = actor(role)
    vi.mocked(requireAuth).mockResolvedValue(user)
    const resolveId = vi.fn(async () => resourceId.toUpperCase())
    await expect(authorize(resolveId)).resolves.toEqual({ mode: 'contextual', user, [key]: resourceId })
    expect(resolveId).toHaveBeenCalledOnce()
    expect(requireAuth).toHaveBeenCalledOnce()
    expect(requireRole).not.toHaveBeenCalled()
    expect(requireAuth.mock.invocationCallOrder[0]).toBeLessThan(resolveId.mock.invocationCallOrder[0])
  })

  it('validates resource UUIDs only after shared admission', async () => {
    admission()
    await expect(authorize('invalid-resource')).rejects.toMatchObject({ statusCode: 400 })
    vi.stubEnv(sharedVariable, undefined)
    await expect(authorize('invalid-resource')).resolves.toMatchObject({ mode: 'legacy', [key]: 'invalid-resource' })
  })

  it.each([
    '', 'not-json', '{}', JSON.stringify({ version: 2, admittedUserIds: [] }),
    JSON.stringify({ version: 1, admittedUserIds: ['invalid'] }),
    JSON.stringify({ version: 1, admittedUserIds: [actorId, actorId.toUpperCase()] }),
    JSON.stringify({ version: 1, admittedUserIds: Array(101).fill(actorId) }),
    JSON.stringify({ version: 1, admittedUserIds: [], extra: true }), ' '.repeat(20_001),
  ])('fails malformed shared configuration after auth and before callback or pair evaluation', async (raw) => {
    vi.stubEnv(sharedVariable, raw)
    const resolveId = vi.fn(async () => resourceId)
    await expect(authorize(resolveId)).rejects.toMatchObject({ statusCode: 503, message: 'Classroom experience admission configuration is unavailable' })
    expect(resolveId).not.toHaveBeenCalled()
    expect(requireRole).not.toHaveBeenCalled()
  })

  it('keeps auth errors ahead of malformed shared configuration', async () => {
    vi.stubEnv(sharedVariable, 'bad')
    const error = new Error('unauthenticated')
    vi.mocked(requireAuth).mockRejectedValue(error)
    const resolveId = vi.fn(async () => resourceId)
    await expect(authorize(resolveId)).rejects.toBe(error)
    expect(resolveId).not.toHaveBeenCalled()
  })

  it('rejects an invalid authenticated actor before callback resolution', async () => {
    admission([])
    vi.mocked(requireAuth).mockResolvedValue({ ...actor('teacher'), id: 'invalid' })
    const resolveId = vi.fn(async () => resourceId)
    await expect(authorize(resolveId)).rejects.toMatchObject({ statusCode: 503 })
    expect(resolveId).not.toHaveBeenCalled()
  })

  it('accepts the 100-actor configuration limit through the shared reader', async () => {
    admission([actorId, ...Array.from({ length: 99 }, (_, index) => (
      `${(index + 10).toString(16).padStart(8, '0')}-3333-4333-8333-333333333333`
    ))])
    await expect(authorize(resourceId)).resolves.toMatchObject({ mode: 'contextual', [key]: resourceId })
  })

  it.each([{ ids: [] }, { ids: [otherId] }])('preserves disabled pair legacy behavior for a nonadmitted cohort', async ({ ids }) => {
    admission(ids)
    const resolveId = vi.fn(async () => resourceId.toUpperCase())
    await expect(authorize(resolveId)).resolves.toMatchObject({ mode: 'legacy', [key]: resourceId.toUpperCase() })
    expect(resolveId).toHaveBeenCalledOnce()
    if (legacyRole === 'authenticated') expect(requireRole).not.toHaveBeenCalled()
    else expect(requireRole).toHaveBeenCalledWith(legacyRole)
  })

  it('retains the exact pair decision and its malformed configuration error for nonadmitted actors', async () => {
    admission([])
    vi.stubEnv(`PIKA_CLASSROOM_${flag}_ACCESS_ENABLED`, 'true')
    const resolveId = vi.fn(async () => resourceId)
    await expect(authorize(resolveId)).rejects.toMatchObject({ statusCode: 503 })
    expect(resolveId).not.toHaveBeenCalled()
    vi.stubEnv(`PIKA_CLASSROOM_${flag}_ACCESS_PAIRS`, JSON.stringify([{ userId: actorId, [key]: resourceId }]))
    await expect(authorize(resourceId)).resolves.toMatchObject({ mode: 'contextual', [key]: resourceId })
    vi.mocked(requireAuth).mockResolvedValue(actor(legacyRole === 'teacher' ? 'student' : 'teacher'))
    if (legacyRole === 'authenticated') {
      await expect(authorize(otherResourceId)).resolves.toMatchObject({ mode: 'legacy' })
    } else {
      await expect(authorize(otherResourceId)).rejects.toMatchObject({ name: 'AuthorizationError' })
    }
  })
})

it('leaves document open admission on its separate exact pair contract', () => {
  admission()
  vi.stubEnv('PIKA_CLASSROOM_ASSIGNMENT_DOC_OPEN_ACCESS_ENABLED', 'false')
  expect(resolveContextualAssignmentDocAccess(actor('teacher'), resourceId)).toMatchObject({ mode: 'legacy' })
  vi.unstubAllEnvs()
})
