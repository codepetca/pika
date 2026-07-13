import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useAutosaveQueue } from '@/hooks/useAutosaveQueue'

describe('useAutosaveQueue', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('serializes writes and persists the newest queued values', async () => {
    vi.useFakeTimers()
    let resolveFirstSave: (value: { value: string }) => void = () => {}
    const onSave = vi.fn()
      .mockImplementationOnce(() => new Promise((resolve) => {
        resolveFirstSave = resolve
      }))
      .mockImplementationOnce(async (values) => values)

    const { result } = renderHook(() => useAutosaveQueue({
      isEqual: (left: { value: string }, right: { value: string }) => left.value === right.value,
      onSave,
    }))

    act(() => {
      result.current.reset({ value: 'initial' })
      result.current.schedule({ value: 'first' })
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000)
    })
    expect(onSave).toHaveBeenCalledTimes(1)

    let flushPromise: Promise<boolean> | undefined
    act(() => {
      result.current.schedule({ value: 'latest' })
      flushPromise = result.current.flush()
    })
    expect(onSave).toHaveBeenCalledTimes(1)

    await act(async () => {
      resolveFirstSave({ value: 'first' })
      await flushPromise
    })

    expect(onSave).toHaveBeenCalledTimes(2)
    expect(onSave).toHaveBeenNthCalledWith(2, { value: 'latest' })
    expect(result.current.status).toBe('saved')
  })
})
