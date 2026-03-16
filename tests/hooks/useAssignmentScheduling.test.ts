import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { useAssignmentScheduling } from '@/hooks/useAssignmentScheduling'
import type { Assignment } from '@/types'

// ─── helpers ─────────────────────────────────────────────────────────────────

function makeDraftAssignment(overrides: Partial<Assignment> = {}): Assignment {
  return {
    id: 'assignment-1',
    classroom_id: 'class-1',
    title: 'Test Assignment',
    description: '',
    rich_instructions: null,
    due_at: new Date(Date.now() + 86400_000).toISOString(),
    position: 0,
    is_draft: true,
    released_at: null,
    created_by: 'teacher-1',
    ...overrides,
  } as Assignment
}

function makeLiveAssignment(overrides: Partial<Assignment> = {}): Assignment {
  return makeDraftAssignment({
    is_draft: false,
    released_at: new Date(Date.now() - 3600_000).toISOString(), // 1 hour ago
    ...overrides,
  })
}

function makeScheduledAssignment(overrides: Partial<Assignment> = {}): Assignment {
  return makeDraftAssignment({
    is_draft: false,
    released_at: new Date(Date.now() + 3600_000 * 24).toISOString(), // tomorrow
    ...overrides,
  })
}

function makeOptions(assignment: Assignment | null = null, extra: Partial<Parameters<typeof useAssignmentScheduling>[0]> = {}) {
  return {
    currentAssignment: assignment,
    isCreateMode: false,
    creating: false,
    saving: false,
    flushPendingChanges: vi.fn().mockResolvedValue(undefined),
    onAssignmentChange: vi.fn(),
    onSuccess: vi.fn(),
    onClose: vi.fn(),
    onError: vi.fn(),
    ...extra,
  }
}

// ─── tests ────────────────────────────────────────────────────────────────────

describe('useAssignmentScheduling', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('derived status flags', () => {
    it('isDraft is true when assignment is null', () => {
      const { result } = renderHook(() => useAssignmentScheduling(makeOptions(null)))
      expect(result.current.isDraft).toBe(true)
    })

    it('isDraft is true for a draft assignment', () => {
      const { result } = renderHook(() =>
        useAssignmentScheduling(makeOptions(makeDraftAssignment()))
      )
      expect(result.current.isDraft).toBe(true)
    })

    it('isLive is true for a released assignment with no future released_at', () => {
      const { result } = renderHook(() =>
        useAssignmentScheduling(makeOptions(makeLiveAssignment()))
      )
      expect(result.current.isLive).toBe(true)
      expect(result.current.isDraft).toBe(false)
      expect(result.current.isScheduled).toBe(false)
    })

    it('isScheduled is true when released_at is in the future', () => {
      const { result } = renderHook(() =>
        useAssignmentScheduling(makeOptions(makeScheduledAssignment()))
      )
      expect(result.current.isScheduled).toBe(true)
      expect(result.current.isLive).toBe(false)
    })

    it('effectivePrimaryAction is "schedule" for a scheduled assignment', () => {
      const { result } = renderHook(() =>
        useAssignmentScheduling(makeOptions(makeScheduledAssignment()))
      )
      expect(result.current.effectivePrimaryAction).toBe('schedule')
    })

    it('splitOptions is empty for a scheduled assignment', () => {
      const { result } = renderHook(() =>
        useAssignmentScheduling(makeOptions(makeScheduledAssignment()))
      )
      expect(result.current.splitOptions).toHaveLength(0)
    })
  })

  describe('resetForAssignment', () => {
    it('sets primaryAction to "post" for a draft assignment', () => {
      const { result } = renderHook(() =>
        useAssignmentScheduling(makeOptions(makeDraftAssignment()))
      )
      act(() => {
        result.current.setPrimaryAction('schedule')
      })
      act(() => {
        result.current.resetForAssignment(makeDraftAssignment())
      })
      expect(result.current.primaryAction).toBe('post')
    })

    it('sets primaryAction to "schedule" for a future-scheduled assignment', () => {
      const scheduled = makeScheduledAssignment()
      const { result } = renderHook(() =>
        useAssignmentScheduling(makeOptions(scheduled))
      )
      act(() => {
        result.current.resetForAssignment(scheduled)
      })
      expect(result.current.primaryAction).toBe('schedule')
    })

    it('clears all confirm/modal flags on reset', () => {
      const { result } = renderHook(() =>
        useAssignmentScheduling(makeOptions(makeDraftAssignment()))
      )
      act(() => {
        result.current.setShowPostNowConfirm(true)
        result.current.setShowRevertToDraftConfirm(true)
        result.current.setShowCreateScheduleModal(true)
      })
      act(() => {
        result.current.resetForAssignment(null)
      })
      expect(result.current.showPostNowConfirm).toBe(false)
      expect(result.current.showRevertToDraftConfirm).toBe(false)
      expect(result.current.showCreateScheduleModal).toBe(false)
    })
  })

  describe('clearScheduledRelease', () => {
    it('reverts assignment to draft and keeps primaryAction as "schedule" for immediate re-scheduling', async () => {
      const scheduled = makeScheduledAssignment()
      const updatedDraft = makeDraftAssignment({ id: scheduled.id })
      const fetchSpy = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ assignment: updatedDraft }),
      })
      vi.stubGlobal('fetch', fetchSpy)

      const opts = makeOptions(scheduled)
      const { result } = renderHook(() => useAssignmentScheduling(opts))

      await act(async () => {
        await result.current.clearScheduledRelease()
      })

      await waitFor(() => {
        // primaryAction stays 'schedule' so the user can immediately pick a new time
        expect(result.current.primaryAction).toBe('schedule')
      })
      expect(opts.onAssignmentChange).toHaveBeenCalledWith(updatedDraft)

      vi.unstubAllGlobals()
    })

    it('does nothing when assignment is not scheduled', async () => {
      const opts = makeOptions(makeDraftAssignment())
      const fetchSpy = vi.fn()
      vi.stubGlobal('fetch', fetchSpy)

      const { result } = renderHook(() => useAssignmentScheduling(opts))

      await act(async () => {
        await result.current.clearScheduledRelease()
      })

      expect(fetchSpy).not.toHaveBeenCalled()
      vi.unstubAllGlobals()
    })

    it('calls onError when API fails', async () => {
      const scheduled = makeScheduledAssignment()
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: false,
        json: async () => ({ error: 'Server error' }),
      }))

      const opts = makeOptions(scheduled)
      const { result } = renderHook(() => useAssignmentScheduling(opts))

      await act(async () => {
        await result.current.clearScheduledRelease()
      })

      expect(opts.onError).toHaveBeenCalledWith('Server error')
      vi.unstubAllGlobals()
    })
  })

  describe('revertAssignmentToDraft', () => {
    it('sets primaryAction to "post" after reverting', async () => {
      const live = makeLiveAssignment()
      const updatedDraft = makeDraftAssignment({ id: live.id })
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ assignment: updatedDraft }),
      }))

      const opts = makeOptions(live)
      const { result } = renderHook(() => useAssignmentScheduling(opts))

      await act(async () => {
        await result.current.revertAssignmentToDraft()
      })

      await waitFor(() => {
        expect(result.current.primaryAction).toBe('post')
      })
      vi.unstubAllGlobals()
    })

    it('does nothing if assignment is already a draft', async () => {
      const fetchSpy = vi.fn()
      vi.stubGlobal('fetch', fetchSpy)

      const opts = makeOptions(makeDraftAssignment())
      const { result } = renderHook(() => useAssignmentScheduling(opts))

      await act(async () => {
        await result.current.revertAssignmentToDraft()
      })

      expect(fetchSpy).not.toHaveBeenCalled()
      vi.unstubAllGlobals()
    })
  })
})
