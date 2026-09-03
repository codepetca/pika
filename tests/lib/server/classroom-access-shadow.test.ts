import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { observeClassroomAccessShadow, observeClassroomCreationShadow } from '@/lib/server/classroom-access-shadow'

const ownerId = '11111111-1111-4111-8111-111111111111'
const memberId = '22222222-2222-4222-8222-222222222222'
const classroomId = '33333333-3333-4333-8333-333333333333'
const classroom = { id: classroomId, teacher_id: ownerId, archived_at: null }
const evidence = () => ({ classroom, classroomError: null })
const input = { check: 'owner' as const, userId: ownerId, classroomId, legacyAllowed: true, evidence }

describe('non-authoritative access shadow observer', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-02T12:00:00Z'))
    vi.stubEnv('PIKA_ACCESS_SHADOW_ENABLED', 'true')
    vi.stubEnv('PIKA_ACCESS_SHADOW_CLASSROOM_IDS', classroomId)
    vi.stubEnv('PIKA_ACCESS_SHADOW_USER_IDS', ownerId)
    vi.stubEnv('PIKA_ACCESS_SHADOW_SAMPLE_RATE', '1')
    vi.spyOn(console, 'info').mockImplementation(() => {})
    // Reset the process-local window without exposing a production reset API.
    vi.setSystemTime(new Date('2026-09-02T11:00:00Z'))
    observeClassroomAccessShadow(input)
    vi.setSystemTime(new Date('2026-09-02T12:00:00Z'))
    vi.mocked(console.info).mockClear()
  })
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.useRealTimers() })

  function event() { return vi.mocked(console.info).mock.calls.at(-1)?.[1] }

  it.each(['', 'false', 'TRUE', '1'])('is inert when the enable flag is %j', (value) => {
    vi.stubEnv('PIKA_ACCESS_SHADOW_ENABLED', value)
    const read = vi.fn(evidence)
    expect(observeClassroomAccessShadow({ ...input, evidence: read })).toBeUndefined()
    expect(read).not.toHaveBeenCalled()
    expect(console.info).not.toHaveBeenCalled()
  })

  it.each(['', '*', 'invalid', `${classroomId},invalid`, Array(101).fill(classroomId).join(',')])(
    'does not evaluate with an absent or invalid classroom cohort %j', (cohort) => {
      vi.stubEnv('PIKA_ACCESS_SHADOW_CLASSROOM_IDS', cohort)
      const read = vi.fn(evidence)
      observeClassroomAccessShadow({ ...input, evidence: read })
      expect(read).not.toHaveBeenCalled()
    },
  )

  it('only observes exact cohort identifiers, never a prefix', () => {
    observeClassroomAccessShadow({ ...input, classroomId: memberId })
    observeClassroomAccessShadow({ ...input, classroomId: '3333' })
    expect(console.info).not.toHaveBeenCalled()
  })

  it('requires a cohort and a valid server clock', () => {
    vi.stubEnv('PIKA_ACCESS_SHADOW_CLASSROOM_IDS', undefined)
    observeClassroomAccessShadow(input)
    vi.stubEnv('PIKA_ACCESS_SHADOW_CLASSROOM_IDS', classroomId)
    vi.spyOn(Date, 'now').mockReturnValue(NaN)
    observeClassroomAccessShadow(input)
    expect(console.info).not.toHaveBeenCalled()
  })

  it.each(['', '-1', '2', 'NaN', 'Infinity', '0x1', '1oops', '0'])('disables invalid/zero sampling %j', (rate) => {
    vi.stubEnv('PIKA_ACCESS_SHADOW_SAMPLE_RATE', rate)
    observeClassroomAccessShadow(input)
    expect(console.info).not.toHaveBeenCalled()
  })

  it('samples at the configured fraction, defaulting to one percent', () => {
    vi.stubEnv('PIKA_ACCESS_SHADOW_SAMPLE_RATE', undefined)
    vi.spyOn(Math, 'random').mockReturnValue(0.01)
    observeClassroomAccessShadow(input)
    expect(console.info).not.toHaveBeenCalled()
    vi.mocked(Math.random).mockReturnValue(0.009)
    observeClassroomAccessShadow(input)
    expect(event()).toMatchObject({ comparison: 'match' })
  })

  it.each([
    ['owner', ownerId, false, true],
    ['owner', ownerId, true, true],
    ['owner', memberId, false, false],
    ['manage', ownerId, false, true],
    ['manage', ownerId, true, false],
    ['manage', memberId, false, false],
    ['participate', memberId, false, true],
    ['participate', memberId, true, false],
    ['participate', ownerId, false, false],
  ] as const)('compares %s for %s archived=%s', (check, userId, archived, allowed) => {
    observeClassroomAccessShadow({ ...input, check, userId, legacyAllowed: allowed,
      evidence: () => ({ classroom: { ...classroom, archived_at: archived ? '2026-09-01T00:00:00Z' : null },
        enrollment: { data: { id: memberId }, error: null } }) })
    expect(event()).toMatchObject({ check, candidate: allowed ? 'allow' : 'deny', comparison: 'match' })
  })

  it('distinguishes widening and narrowing without changing the caller result', () => {
    observeClassroomAccessShadow({ ...input, legacyAllowed: false })
    expect(event()).toMatchObject({ comparison: 'would_allow' })
    observeClassroomAccessShadow({ ...input, userId: memberId })
    expect(event()).toMatchObject({ comparison: 'would_deny' })
  })

  it.each([
    [{ classroom, classroomError: { message: 'private database error' } }, 'classroom_read_failed'],
    [{ classroom: { ...classroom, id: memberId } }, 'invalid_evidence'],
    [{ classroom: { ...classroom, archived_at: undefined } }, 'invalid_evidence'],
    [{ classroom: undefined }, 'invalid_evidence'],
    [{ classroom }, 'enrollment_not_observed'],
    [{ classroom, enrollment: { data: null, error: { code: 'PGRST116' } } }, 'enrollment_read_failed'],
    [{ classroom, enrollment: { data: {}, error: null } }, 'invalid_evidence'],
  ])('marks unreliable observations unavailable, not matching denials', (observation, reason) => {
    observeClassroomAccessShadow({ ...input, check: 'participate', userId: memberId,
      legacyAllowed: false, evidence: () => observation })
    expect(event()).toMatchObject({ candidate: 'unavailable', comparison: 'unavailable', reason })
  })

  it('rejects malformed user evidence and treats confirmed absence as deny', () => {
    observeClassroomAccessShadow({ ...input, userId: 'invalid' })
    expect(event()).toMatchObject({ comparison: 'unavailable', reason: 'invalid_evidence' })
    observeClassroomAccessShadow({ ...input, legacyAllowed: false, evidence: () => ({ classroom: null }) })
    expect(event()).toMatchObject({ candidate: 'deny', comparison: 'match', reason: 'missing_classroom' })
    observeClassroomAccessShadow({ ...input, check: 'participate', userId: memberId,
      legacyAllowed: false, evidence: () => ({ classroom, enrollment: { data: null, error: null } }) })
    expect(event()).toMatchObject({ candidate: 'deny', comparison: 'match' })
  })

  it('emits only closed labels, without identifiers, raw rows, or arbitrary user fields', () => {
    observeClassroomAccessShadow({ ...input, evidence: () => ({
      classroom: { ...classroom, title: 'Private classwork', class_code: 'SECRET', email: 'private@example.com' },
    }) })
    expect(vi.mocked(console.info).mock.calls).toEqual([['PikaAccessShadow', {
      version: 1, check: 'owner', legacy: 'allow', candidate: 'allow', comparison: 'match', reason: 'policy',
    }]])
  })

  it('caps observations to 100 per process-minute and recovers at the window boundary', () => {
    const read = vi.fn(evidence)
    for (let i = 0; i < 105; i++) observeClassroomAccessShadow({ ...input, evidence: read })
    expect(read).toHaveBeenCalledTimes(100)
    expect(console.info).toHaveBeenCalledTimes(100)
    vi.advanceTimersByTime(60_000)
    observeClassroomAccessShadow(input)
    expect(console.info).toHaveBeenCalledTimes(101)
  })

  it('contains evidence and logger failures; a failed logger still consumes the cap', () => {
    expect(() => observeClassroomAccessShadow({ ...input, evidence: () => { throw new Error('private') } })).not.toThrow()
    expect(console.info).not.toHaveBeenCalled()
    vi.mocked(console.info).mockImplementation(() => { throw new Error('logger down') })
    for (let i = 0; i < 105; i++) expect(() => observeClassroomAccessShadow(input)).not.toThrow()
    expect(console.info).toHaveBeenCalledTimes(99)
  })

  it('compares creation only after legacy authentication and only for the explicit user cohort', () => {
    observeClassroomCreationShadow({ id: ownerId, role: 'teacher', email: 'private@example.com' })
    expect(event()).toEqual({ version: 1, check: 'create', legacy: 'allow', candidate: 'allow',
      comparison: 'match', reason: 'legacy_creation' })
    vi.mocked(console.info).mockClear()
    observeClassroomCreationShadow({ id: memberId, role: 'teacher' })
    observeClassroomCreationShadow(null)
    expect(console.info).not.toHaveBeenCalled()
    observeClassroomCreationShadow({ id: ownerId, role: 'student' })
    expect(event()).toMatchObject({ comparison: 'would_deny' })
    observeClassroomCreationShadow({ id: ownerId, role: 'pro' })
    expect(event()).toMatchObject({ comparison: 'unavailable' })
  })

  it('contains creation telemetry failures', () => {
    vi.mocked(console.info).mockImplementation(() => { throw new Error('logger down') })
    expect(() => observeClassroomCreationShadow({ id: ownerId, role: 'teacher' })).not.toThrow()
  })
})
