import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  safeLocalGetJson,
  safeLocalRemove,
  safeLocalSetJson,
  readCookieValue,
  safeSessionGetJson,
  safeSessionSetJson,
} from '@/lib/client-storage'

describe('client-storage', () => {
  beforeEach(() => {
    window.sessionStorage.clear()
    window.localStorage.clear()
  })

  describe('readCookieValue', () => {
    it('returns null when missing', () => {
      expect(readCookieValue('a=1; b=2', 'c')).toBeNull()
    })

    it('parses and decodes cookie values', () => {
      expect(readCookieValue('pika=hello%20world', 'pika')).toBe('hello world')
    })
  })

  describe('session JSON helpers', () => {
    it('round-trips JSON safely', () => {
      safeSessionSetJson('k', { a: 1 })
      expect(safeSessionGetJson<{ a: number }>('k')).toEqual({ a: 1 })
    })

    it('returns null for invalid JSON', () => {
      window.sessionStorage.setItem('k', '{not json')
      expect(safeSessionGetJson('k')).toBeNull()
    })
  })

  describe('durable JSON helpers', () => {
    it('round-trips and removes local recovery data', () => {
      expect(safeLocalSetJson('draft', { content: 'work' })).toBe(true)
      expect(safeLocalGetJson('draft')).toEqual({ content: 'work' })
      safeLocalRemove('draft')
      expect(safeLocalGetJson('draft')).toBeNull()
    })

    it('reports unavailable browser storage', () => {
      const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new DOMException('Quota exceeded', 'QuotaExceededError')
      })

      expect(safeLocalSetJson('draft', { content: 'work' })).toBe(false)
      expect(safeSessionSetJson('draft', { content: 'work' })).toBe(false)
      setItem.mockRestore()
    })
  })
})
