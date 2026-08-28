import { describe, expect, it } from 'vitest'
import { acquireCourseGuideImportExtractionSlot } from '@/lib/server/course-guide-import-rate-limit'

describe('course guide curriculum import rate limit', () => {
  it('allows one active extraction per teacher and classroom', () => {
    const key = { teacherId: 'teacher-active', classroomId: 'classroom-active' }
    const release = acquireCourseGuideImportExtractionSlot(key, 1_000)

    expect(() => acquireCourseGuideImportExtractionSlot(key, 1_001)).toThrow(
      'A curriculum import is already running for this Course Guide.',
    )

    release()
    const nextRelease = acquireCourseGuideImportExtractionSlot(key, 1_002)
    nextRelease()
  })

  it('limits repeated provider calls while preserving bounded retries', () => {
    const key = { teacherId: 'teacher-window', classroomId: 'classroom-window' }

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const release = acquireCourseGuideImportExtractionSlot(key, 2_000 + attempt)
      release()
    }

    expect(() => acquireCourseGuideImportExtractionSlot(key, 2_010)).toThrow(
      'Too many curriculum import attempts. Try again in a few minutes.',
    )

    const release = acquireCourseGuideImportExtractionSlot(key, 2_000 + 10 * 60 * 1000)
    release()
  })
})
