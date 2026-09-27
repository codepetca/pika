import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  isClassroomExperienceAdmissionConfigured,
  resolveClassroomExperienceAdmission,
} from '@/lib/server/classroom-experience-admission'

const admittedId = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d'
const otherId = 'b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e'

describe('classroom experience admission', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('treats an absent variable as the legacy installation', () => {
    vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', undefined)

    expect(isClassroomExperienceAdmissionConfigured()).toBe(false)
    expect(resolveClassroomExperienceAdmission({ id: admittedId })).toEqual({ status: 'not-admitted' })
  })

  it('distinguishes an explicitly configured empty cohort from an absent variable', () => {
    vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', JSON.stringify({
      version: 1,
      admittedUserIds: [],
    }))

    expect(isClassroomExperienceAdmissionConfigured()).toBe(true)
    expect(resolveClassroomExperienceAdmission({ id: admittedId })).toEqual({ status: 'not-admitted' })
  })

  it('canonicalizes UUID casing before matching an admitted identity', () => {
    vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', JSON.stringify({
      version: 1,
      admittedUserIds: [admittedId.toUpperCase()],
    }))

    expect(resolveClassroomExperienceAdmission({ id: admittedId.toUpperCase() })).toEqual({ status: 'admitted' })
    expect(resolveClassroomExperienceAdmission({ id: otherId })).toEqual({ status: 'not-admitted' })
  })

  it.each([
    '',
    'not-json',
    '{}',
    JSON.stringify({ version: 2, admittedUserIds: [] }),
    JSON.stringify({ version: 1, admittedUserIds: [admittedId], extra: true }),
    JSON.stringify({ version: 1, admittedUserIds: ['invalid'] }),
    JSON.stringify({ version: 1, admittedUserIds: [admittedId, admittedId.toUpperCase()] }),
    ' '.repeat(20_001),
  ])('fails closed for malformed or unsafe configuration', (configuration) => {
    vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', configuration)

    expect(() => resolveClassroomExperienceAdmission({ id: admittedId }))
      .toThrowError(expect.objectContaining({ statusCode: 503 }))
  })

  it('rejects a cohort larger than 100 identities', () => {
    const admittedUserIds = Array.from({ length: 101 }, (_, index) => (
      `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`
    ))
    vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', JSON.stringify({ version: 1, admittedUserIds }))

    expect(() => resolveClassroomExperienceAdmission({ id: admittedId }))
      .toThrowError(expect.objectContaining({ statusCode: 503 }))
  })

  it('accepts exactly 100 admitted identities', () => {
    const admittedUserIds = [admittedId, ...Array.from({ length: 99 }, (_, index) => (
      `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`
    ))]
    vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', JSON.stringify({ version: 1, admittedUserIds }))

    expect(resolveClassroomExperienceAdmission({ id: admittedId.toUpperCase() })).toEqual({ status: 'admitted' })
  })

  it('fails closed when the authenticated identity is not a canonical UUID', () => {
    vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', JSON.stringify({
      version: 1,
      admittedUserIds: [admittedId],
    }))

    expect(() => resolveClassroomExperienceAdmission({ id: 'not-a-user-id' }))
      .toThrowError(expect.objectContaining({ statusCode: 503 }))
  })
})
