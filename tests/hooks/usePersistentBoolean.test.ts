import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { usePersistentBoolean } from '@/hooks/usePersistentBoolean'

describe('usePersistentBoolean', () => {
  beforeEach(() => localStorage.clear())

  it.each([
    ['teacher-classwork:reverse-order:v1', false],
    ['teacher-tests:reverse-order:v1', true],
  ])('restores %s after a remount', (key, defaultValue) => {
    const first = renderHook(() => usePersistentBoolean(key, defaultValue))
    expect(first.result.current[0]).toBe(defaultValue)
    act(() => first.result.current[1](!defaultValue))
    first.unmount()
    const second = renderHook(() => usePersistentBoolean(key, defaultValue))
    expect(second.result.current[0]).toBe(!defaultValue)
  })

  it('falls back to the default for invalid values or unavailable storage', () => {
    localStorage.setItem('preference', JSON.stringify('true'))
    const first = renderHook(() => usePersistentBoolean('preference', false))
    expect(first.result.current[0]).toBe(false)
    first.unmount()
    const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('unavailable') })
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('unavailable') })
    const second = renderHook(() => usePersistentBoolean('preference', true))
    expect(second.result.current[0]).toBe(true)
    act(() => second.result.current[1](false))
    expect(second.result.current[0]).toBe(false)
    get.mockRestore()
    set.mockRestore()
  })
})
