/**
 * Unit tests for use-bidirectional-sidebar hook
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useBidirectionalSidebar } from '@/hooks/use-bidirectional-sidebar'

// Mock the useRightSidebar hook
const mockToggle = vi.fn()
const mockSetOpen = vi.fn()
let mockIsOpen = false

vi.mock('@/components/layout', () => ({
  useRightSidebar: () => ({
    isOpen: mockIsOpen,
    toggle: mockToggle,
    setOpen: mockSetOpen,
  }),
}))

describe('useBidirectionalSidebar', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockIsOpen = false
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('should return initial state', () => {
    const { result } = renderHook(() =>
      useBidirectionalSidebar({
        loadContent: async () => 'loaded content',
        saveContent: async () => ({ success: true }),
        initialContent: 'initial',
      })
    )

    expect(result.current.isOpen).toBe(false)
    expect(result.current.loading).toBe(false)
    expect(result.current.state.content).toBe('initial')
    expect(result.current.state.error).toBeNull()
    expect(result.current.state.saving).toBe(false)
  })

  it('should load content when sidebar opens', async () => {
    const loadContent = vi.fn().mockResolvedValue('loaded content')

    const { result, rerender } = renderHook(() =>
      useBidirectionalSidebar({
        loadContent,
        saveContent: async () => ({ success: true }),
        initialContent: 'initial',
      })
    )

    // Simulate sidebar opening
    mockIsOpen = true
    rerender()

    await waitFor(() => {
      expect(loadContent).toHaveBeenCalled()
    })

    await waitFor(() => {
      expect(result.current.state.content).toBe('loaded content')
    })
  })

  it('should handle load error', async () => {
    const loadContent = vi.fn().mockRejectedValue(new Error('Load failed'))

    const { result, rerender } = renderHook(() =>
      useBidirectionalSidebar({
        loadContent,
        saveContent: async () => ({ success: true }),
        initialContent: 'initial',
      })
    )

    // Simulate sidebar opening
    mockIsOpen = true
    rerender()

    await waitFor(() => {
      expect(result.current.state.error).toBe('Load failed')
    })
  })

  it('should debounce content changes', async () => {
    vi.useFakeTimers()

    const { result } = renderHook(() =>
      useBidirectionalSidebar({
        loadContent: async () => 'loaded',
        saveContent: async () => ({ success: true }),
        initialContent: 'initial',
        syncDebounceMs: 300,
      })
    )

    // Make multiple rapid changes
    act(() => {
      result.current.state.onChange('change 1')
      result.current.state.onChange('change 2')
      result.current.state.onChange('change 3')
    })

    // Content shouldn't update immediately
    expect(result.current.state.content).toBe('initial')

    // Fast-forward past debounce delay
    await act(async () => {
      vi.advanceTimersByTime(350)
    })

    // Now content should be the final value
    expect(result.current.state.content).toBe('change 3')
  })

  it('should save content and close sidebar on success', async () => {
    const saveContent = vi.fn().mockResolvedValue({ success: true })
    const onSaveSuccess = vi.fn()

    mockIsOpen = true

    const { result } = renderHook(() =>
      useBidirectionalSidebar({
        loadContent: async () => 'loaded',
        saveContent,
        initialContent: 'initial',
        closeOnSave: true,
        onSaveSuccess,
      })
    )

    // Trigger save
    await act(async () => {
      await result.current.state.onSave()
    })

    expect(saveContent).toHaveBeenCalled()
    expect(mockSetOpen).toHaveBeenCalledWith(false)
    expect(onSaveSuccess).toHaveBeenCalled()
  })

  it('should handle save error', async () => {
    const saveContent = vi.fn().mockResolvedValue({ success: false, error: 'Save failed' })

    const { result } = renderHook(() =>
      useBidirectionalSidebar({
        loadContent: async () => 'loaded',
        saveContent,
        initialContent: 'initial',
      })
    )

    await act(async () => {
      await result.current.state.onSave()
    })

    expect(result.current.state.error).toBe('Save failed')
    expect(mockSetOpen).not.toHaveBeenCalled()
  })

  it('should not close sidebar on save when closeOnSave is false', async () => {
    const saveContent = vi.fn().mockResolvedValue({ success: true })

    const { result } = renderHook(() =>
      useBidirectionalSidebar({
        loadContent: async () => 'loaded',
        saveContent,
        initialContent: 'initial',
        closeOnSave: false,
      })
    )

    await act(async () => {
      await result.current.state.onSave()
    })

    expect(mockSetOpen).not.toHaveBeenCalled()
  })

  it('should mark content stale for refresh', async () => {
    const loadContent = vi.fn().mockResolvedValue('loaded content')

    const { result, rerender } = renderHook(() =>
      useBidirectionalSidebar({
        loadContent,
        saveContent: async () => ({ success: true }),
        initialContent: 'initial',
      })
    )

    // Open sidebar - should load
    mockIsOpen = true
    rerender()

    await waitFor(() => {
      expect(loadContent).toHaveBeenCalledTimes(1)
    })

    // Close sidebar
    mockIsOpen = false
    rerender()

    // Open again - should NOT load (not marked stale)
    mockIsOpen = true
    rerender()

    // Still only 1 call since not marked stale
    expect(loadContent).toHaveBeenCalledTimes(1)

    // Mark stale and reopen
    mockIsOpen = false
    rerender()

    act(() => {
      result.current.markStale()
    })

    mockIsOpen = true
    rerender()

    await waitFor(() => {
      expect(loadContent).toHaveBeenCalledTimes(2)
    })
  })
})
