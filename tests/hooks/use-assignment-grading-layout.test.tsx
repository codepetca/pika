import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { useAssignmentGradingLayout } from '@/hooks/use-assignment-grading-layout'

function clearLayoutCookie() {
  document.cookie = 'pika_assignment_grading_layout%3Aclassroom-1=; Path=/; Max-Age=0; SameSite=Lax'
}

describe('useAssignmentGradingLayout', () => {
  beforeEach(() => {
    clearLayoutCookie()
  })

  afterEach(() => {
    clearLayoutCookie()
  })

  it('restores a saved layout from cookie', async () => {
    document.cookie = `${encodeURIComponent('pika_assignment_grading_layout:classroom-1')}=${encodeURIComponent(
      JSON.stringify({
        overview: {
          inspectorCollapsed: true,
          inspectorWidth: 44,
        },
        details: {
          inspectorCollapsed: false,
          inspectorWidth: 36,
        },
      }),
    )}; Path=/; SameSite=Lax`

    const { result } = renderHook(() => useAssignmentGradingLayout('classroom-1', 1000))

    await waitFor(() => {
      expect(result.current.layout.overview.inspectorCollapsed).toBe(true)
    })

    expect(result.current.layout.overview.inspectorWidth).toBe(44)
    expect(result.current.layout.details.inspectorWidth).toBe(36)
  })

  it('does not overwrite a saved layout cookie before hydration completes', async () => {
    const cookieName = encodeURIComponent('pika_assignment_grading_layout:classroom-1')
    const savedValue = encodeURIComponent(
      JSON.stringify({
        overview: {
          inspectorCollapsed: true,
          inspectorWidth: 44,
        },
        details: {
          inspectorCollapsed: false,
          inspectorWidth: 36,
        },
      }),
    )

    document.cookie = `${cookieName}=${savedValue}; Path=/; SameSite=Lax`

    renderHook(() => useAssignmentGradingLayout('classroom-1', 1000))

    await waitFor(() => {
      expect(document.cookie).toContain(savedValue)
    })

    expect(document.cookie).not.toContain(encodeURIComponent('"inspectorWidth":40'))
  })

  it('persists mode-specific layout updates and resets to defaults', async () => {
    const { result } = renderHook(() => useAssignmentGradingLayout('classroom-1', 1000))

    act(() => {
      result.current.updateModeLayout('overview', (current) => ({
        ...current,
        inspectorCollapsed: true,
        inspectorWidth: 44,
      }))
    })

    await waitFor(() => {
      expect(document.cookie).toContain('pika_assignment_grading_layout%3Aclassroom-1=')
    })

    expect(document.cookie).toContain(encodeURIComponent('"overview":{"inspectorCollapsed":true,"inspectorWidth":44}'))

    act(() => {
      result.current.resetLayout()
    })

    await waitFor(() => {
      expect(result.current.layout).toEqual({
        overview: {
          inspectorCollapsed: false,
          inspectorWidth: 40,
        },
        details: {
          inspectorCollapsed: false,
          inspectorWidth: 40,
        },
      })
    })
  })
})
