import { beforeEach, describe, expect, it } from 'vitest'
import {
  allocateTeacherLessonPlanMutationVersion,
  resetTeacherLessonPlanMutationQueuesForTests,
} from '@/lib/teacher-lesson-plan-mutation-queue'

describe('teacher lesson-plan mutation versions', () => {
  beforeEach(() => {
    resetTeacherLessonPlanMutationQueuesForTests()
  })

  it('keeps one browser-tab client id and advances its durable sequence', () => {
    const first = allocateTeacherLessonPlanMutationVersion()
    const second = allocateTeacherLessonPlanMutationVersion()

    expect(second.client_id).toBe(first.client_id)
    expect(first.sequence).toBe(1)
    expect(second.sequence).toBe(2)
  })

  it('replaces malformed session state before allocating a mutation', () => {
    window.sessionStorage.setItem(
      'pika:lesson-plan-mutation-session',
      JSON.stringify({ client_id: 'not-a-uuid', sequence: -1 }),
    )

    const mutation = allocateTeacherLessonPlanMutationVersion()

    expect(mutation.client_id).toMatch(/^[0-9a-f-]{36}$/i)
    expect(mutation.sequence).toBe(1)
  })
})
