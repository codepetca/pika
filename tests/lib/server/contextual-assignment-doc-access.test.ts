import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  assertContextualAssignmentGitHubIdentity,
  resolveContextualAssignmentDocAccess,
} from '@/lib/server/contextual-assignment-doc-access'
import type { AuthenticatedUser } from '@/types'

const actorId = '11111111-1111-4111-8111-111111111111'
const otherActorId = '22222222-2222-4222-8222-222222222222'
const assignmentId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const otherAssignmentId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const identityId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const actor = { id: actorId, role: 'teacher', email: 'member@example.com' } as AuthenticatedUser

describe('contextual assignment document access', () => {
  beforeEach(() => {
    vi.stubEnv('PIKA_CLASSROOM_ASSIGNMENT_DOC_OPEN_ACCESS_ENABLED', 'true')
    vi.stubEnv('PIKA_CLASSROOM_ASSIGNMENT_DOC_OPEN_ACCESS_PAIRS', JSON.stringify([{
      userId: actorId,
      assignmentId,
    }]))
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it.each(['false', '', 'TRUE', '1'])('preserves legacy access with flag %j', (flag) => {
    vi.stubEnv('PIKA_CLASSROOM_ASSIGNMENT_DOC_OPEN_ACCESS_ENABLED', flag)
    expect(resolveContextualAssignmentDocAccess(actor, 'legacy-assignment')).toEqual({
      mode: 'legacy',
      user: actor,
      assignmentId: 'legacy-assignment',
    })
  })

  it.each([
    '',
    'not-json',
    '{}',
    '[{"userId":"*","assignmentId":"*"}]',
    JSON.stringify([{ userId: actorId, assignmentId, extra: true }]),
    JSON.stringify(Array(101).fill({ userId: actorId, assignmentId })),
    ' '.repeat(20_001),
  ])('fails closed for invalid enabled configuration', (pairs) => {
    vi.stubEnv('PIKA_CLASSROOM_ASSIGNMENT_DOC_OPEN_ACCESS_PAIRS', pairs)
    expect(() => resolveContextualAssignmentDocAccess(actor, assignmentId))
      .toThrow(expect.objectContaining({ statusCode: 503 }))
  })

  it('matches exact pairs without cross-producting users and assignments', () => {
    vi.stubEnv('PIKA_CLASSROOM_ASSIGNMENT_DOC_OPEN_ACCESS_PAIRS', JSON.stringify([
      { userId: actorId, assignmentId },
      { userId: otherActorId, assignmentId: otherAssignmentId },
    ]))

    expect(resolveContextualAssignmentDocAccess(actor, assignmentId)).toEqual({
      mode: 'contextual',
      user: actor,
      assignmentId,
    })
    expect(resolveContextualAssignmentDocAccess(actor, otherAssignmentId).mode).toBe('legacy')
  })

  it('canonicalizes an exact uppercase request', () => {
    expect(resolveContextualAssignmentDocAccess(actor, assignmentId.toUpperCase())).toEqual({
      mode: 'contextual',
      user: actor,
      assignmentId,
    })
  })

  it('binds optional GitHub identity evidence to the authenticated user', () => {
    expect(() => assertContextualAssignmentGitHubIdentity(actorId, null)).not.toThrow()
    expect(() => assertContextualAssignmentGitHubIdentity(actorId, {
      id: identityId,
      user_id: actorId,
    })).not.toThrow()
    expect(() => assertContextualAssignmentGitHubIdentity(actorId, {
      id: identityId,
      user_id: otherActorId,
    })).toThrow(expect.objectContaining({ statusCode: 503 }))
    expect(() => assertContextualAssignmentGitHubIdentity(actorId, {
      id: 'not-a-uuid',
      user_id: actorId,
    })).toThrow(expect.objectContaining({ statusCode: 503 }))
  })
})
