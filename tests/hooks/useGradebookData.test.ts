import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { useGradebookData } from '@/hooks/useGradebookData'
import { fetchJSONWithCache, invalidateCachedJSONMatching } from '@/lib/request-cache'
import type {
  GradebookClassSummary,
  GradebookStudentDetail,
  GradebookStudentSummary,
} from '@/types'

vi.mock('@/lib/request-cache', () => ({
  fetchJSONWithCache: vi.fn(),
  invalidateCachedJSONMatching: vi.fn(),
}))

function makeStudentSummary(): GradebookStudentSummary {
  return {
    student_id: 'student-1',
    student_email: 'student1@example.com',
    student_number: '1001',
    student_first_name: 'Student',
    student_last_name: 'One',
    assignments_earned: 7,
    assignments_possible: 10,
    assignments_percent: 70,
    quizzes_earned: 16,
    quizzes_possible: 20,
    quizzes_percent: 80,
    tests_earned: 18,
    tests_possible: 20,
    tests_percent: 90,
    final_percent: 75,
  }
}

function makeClassSummary(): GradebookClassSummary {
  return {
    total_students: 1,
    students_with_final: 1,
    average_final_percent: 75,
    assignments: [],
    quizzes: [],
    tests: [],
  }
}

describe('useGradebookData', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Object.defineProperty(window, 'innerWidth', {
      value: 1280,
      writable: true,
      configurable: true,
    })
  })

  it('invalidates gradebook cache and refetches selected student detail when class summary changes', async () => {
    const student = makeStudentSummary()

    const firstDetail: GradebookStudentDetail = {
      ...student,
      final_percent: 75,
      assignments: [],
      quizzes: [],
      tests: [],
    }
    const secondDetail: GradebookStudentDetail = {
      ...student,
      final_percent: 92,
      assignments: [],
      quizzes: [],
      tests: [],
    }

    const cacheFetchMock = vi.mocked(fetchJSONWithCache)
    cacheFetchMock
      .mockResolvedValueOnce({ selected_student: firstDetail })
      .mockResolvedValueOnce({ selected_student: secondDetail })

    const openRight = vi.fn()
    const setRightSidebarOpen = vi.fn()

    const { result } = renderHook(() =>
      useGradebookData({
        classroomId: 'class-1',
        isTeacher: true,
        activeTab: 'gradebook',
        openRight,
        setRightSidebarOpen,
      })
    )

    act(() => {
      result.current.handleSelectGradebookStudent(student)
    })

    await waitFor(() => {
      expect(result.current.gradebookStudentDetail?.final_percent).toBe(75)
    })
    expect(cacheFetchMock).toHaveBeenCalledTimes(1)

    act(() => {
      result.current.handleGradebookClassSummaryChange(makeClassSummary())
    })

    expect(vi.mocked(invalidateCachedJSONMatching)).toHaveBeenCalledWith('gradebook:class-1:')

    await waitFor(() => {
      expect(cacheFetchMock).toHaveBeenCalledTimes(2)
    })
    await waitFor(() => {
      expect(result.current.gradebookStudentDetail?.final_percent).toBe(92)
    })
  })
})
